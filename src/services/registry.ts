import type { Agent } from "../types.js";
import type { RemoteModel } from "../types.js";
import {
  CLAUDE_CODE_ENV_KEYS,
  CODEX_ENV_KEYS,
  GROK_ENV_KEYS,
  OMP_ENV_KEYS,
  OPENAI_COMPATIBLE_ENV_KEYS,
  PI_ENV_KEYS,
} from "../types.js";
import { ClaudeConfigService } from "./claude-config.js";
import { CodexConfigService } from "./codex-config.js";
import { GrokConfigService } from "./grok-config.js";
import { OmpConfigService } from "./omp-config.js";
import { OpenCodeConfigService } from "./opencode-config.js";
import { PiConfigService } from "./pi-config.js";
import { scrubShellRc } from "./shell-scrub.js";
import {
  curlPipe,
  irmPipe,
  npmGlobal,
  npmGlobalWithPostinstall,
} from "./installer.js";
import * as ui from "../ui.js";

/** Upstream context windows recorded in managed configs; catalogue facts. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "grok-4.5": 1000000,
};

/** Codex rc-scrub list: the adapter's envToUnset, scrubbed at the shell too. */
const CODEX_SCRUB_VARS = [
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
];

/** Grok rc-scrub list: legacy installer exports plus the gateway key. */
const GROK_SCRUB_VARS = [
  "CLI_HOP_API_KEY",
  "CLI_HOP_AI_API_KEY",
  "CLI_HOP_CODEX_API_KEY",
  "CLI_HOP_OC_CODEX_API_KEY",
  "CLI_HOP_HERMES_CODEX_API_KEY",
  "CUSTOM_API_KEY",
];

/**
 * Registry of agent CLIs that can be customized through cli-hop.
 * Extend this list as more agents are supported (openai, custom, ...).
 */
export const CUSTOMIZABLE_AGENTS: Agent[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    // Before launching Claude Code, unset the inherited Anthropic/proxy
    // credentials so the Agent Config (its only key source, ADR 0003) wins.
    envToUnset: CLAUDE_CODE_ENV_KEYS,
    supportedProtocols: ["messages"],
    prepare: async ({ apiKey, endpoint, selected }) =>
      new ClaudeConfigService().apply({ apiKey, endpoint, model: selected }),
    probeConfig: () => new ClaudeConfigService().probe(),
    scrubShellConfig: () => new ClaudeConfigService().scrubShellRc(),
    installUrl: "https://docs.anthropic.com/en/docs/claude-code",
    installSpec: {
      macos: curlPipe("https://claude.ai/install.sh", "bash"),
      linux: curlPipe("https://claude.ai/install.sh", "bash"),
      windows: irmPipe("https://claude.ai/install.ps1"),
      docsUrl: "https://code.claude.com/docs/en/setup",
    },
  },
  {
    id: "omp",
    name: "Oh My Pi",
    command: "omp",
    // Inherited Anthropic/proxy vars plus pi/omp config-dir pointers that
    // would relocate ~/.omp away from the models.yml we write.
    envToUnset: OMP_ENV_KEYS,
    // omp's --model selector is provider/modelId; prefix disambiguates the
    // CLI Hop copy from built-in providers with the same ids.
    modelPrefix: "cli-hop/",
    supportedProtocols: ["chat_completions"],
    prepare: async ({ apiKey, endpoint, models, selected }) => [
      await new OmpConfigService().apply({ apiKey, endpoint, models, selected }),
    ],
    probeConfig: () => new OmpConfigService().probe(),
    installUrl: "https://github.com/can1357/oh-my-pi",
    installSpec: {
      macos: curlPipe("https://omp.sh/install", "sh"),
      linux: curlPipe("https://omp.sh/install", "sh"),
      windows: irmPipe("https://omp.sh/install.ps1"),
      docsUrl: "https://github.com/can1357/oh-my-pi",
    },
  },
  {
    id: "pi",
    name: "Pi",
    command: "pi",
    envToUnset: PI_ENV_KEYS,
    modelPrefix: "cli-hop/",
    supportedProtocols: ["chat_completions"],
    prepare: async ({ apiKey, endpoint, models, selected }) => [
      await new PiConfigService().apply({ apiKey, endpoint, models, selected }),
    ],
    probeConfig: () => new PiConfigService().probe(),
    installUrl: "https://pi.dev/docs/latest",
    installSpec: {
      macos: npmGlobal("--ignore-scripts", "@earendil-works/pi-coding-agent"),
      linux: npmGlobal("--ignore-scripts", "@earendil-works/pi-coding-agent"),
      windows: npmGlobal("--ignore-scripts", "@earendil-works/pi-coding-agent"),
      docsUrl: "https://pi.dev/docs/latest",
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    envToUnset: ["CLI_HOP_API_KEY", ...OPENAI_COMPATIBLE_ENV_KEYS],
    supportedProtocols: ["chat_completions"],
    // OpenCode treats bare positional arguments as a directory. Use its `run`
    // subcommand when cli-hop forwards a non-interactive prompt.
    buildArgs: (options) => {
      const args = options.args?.length ? ["run"] : [];
      if (options.model) args.push("--model", `cli-hop/${options.model}`);
      if (options.args) args.push(...options.args);
      return args;
    },
    prepare: async ({ apiKey, endpoint, models, selected }) => {
      const result = await new OpenCodeConfigService().apply({
        apiKey,
        endpoint,
        models,
        selected,
      });
      for (const modelId of result.staleModels) {
        ui.warn(
          `stale CLI Hop model ${ui.val(`cli-hop/${modelId}`)} kept in opencode.json - the gateway no longer serves it; remove it from the file to prune`
        );
      }
      return [result.path];
    },
    probeConfig: () => new OpenCodeConfigService().probe(),
    installUrl: "https://opencode.ai/docs/",
    // OpenCode's npm package ships a stub; its postinstall script must run
    // to download the platform-specific native binary.
    installSpec: {
      macos: npmGlobalWithPostinstall("opencode-ai"),
      linux: npmGlobalWithPostinstall("opencode-ai"),
      windows: npmGlobalWithPostinstall("opencode-ai"),
      docsUrl: "https://opencode.ai/docs/",
    },
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    envToUnset: ["CLI_HOP_API_KEY", ...OPENAI_COMPATIBLE_ENV_KEYS, ...CODEX_ENV_KEYS],
    supportedProtocols: ["responses"],
    buildArgs: (options) => {
      // The provider config lives in the deployed ~/.codex/config.toml
      // (ADR 0003); launch only passes the model and the user's arguments.
      const args = options.model ? ["--model", options.model] : [];
      if (options.args) args.push(...options.args);
      return args;
    },
    // Installer parity: deploy ~/.codex/config.toml, cli-hop.config.toml,
    // and auth.json so `codex` works standalone, not only through cli-hop.
    prepare: async ({ apiKey, endpoint, selected }) =>
      new CodexConfigService().apply({ apiKey, endpoint, model: selected }),
    probeConfig: () => new CodexConfigService().probe(),
    scrubShellConfig: () =>
      scrubShellRc([
        ...CODEX_SCRUB_VARS,
        "CLI_HOP_CODEX_API_KEY",
        "CLI_HOP_OC_CODEX_API_KEY",
        "CLI_HOP_HERMES_CODEX_API_KEY",
      ]),
    installUrl: "https://developers.openai.com/codex/cli/",
    installSpec: {
      macos: curlPipe("https://chatgpt.com/codex/install.sh", "sh"),
      linux: curlPipe("https://chatgpt.com/codex/install.sh", "sh"),
      windows: irmPipe("https://chatgpt.com/codex/install.ps1"),
      docsUrl: "https://developers.openai.com/codex/cli/",
    },
  },
  {
    id: "grok",
    name: "Grok Build",
    command: "grok",
    // Grok reads the key from the inline api_key inside the managed
    // ~/.grok/config.toml block — no API-key env var, installer parity.
    envToUnset: [...GROK_ENV_KEYS],
    supportedProtocols: ["chat_completions"],
    // The managed config block pins the default model; the launch only
    // forwards the user's own arguments.
    buildArgs: (options) => (options.args ? [...options.args] : []),
    prepare: async ({ apiKey, endpoint, models, selected }) => {
      const model = models.find((candidate) => candidate.id === selected);
      return new GrokConfigService().apply({
        apiKey,
        endpoint,
        model: selected,
        displayName: model?.displayName,
        contextWindow: MODEL_CONTEXT_WINDOWS[selected],
      });
    },
    probeConfig: () => new GrokConfigService().probe(),
    scrubShellConfig: () => scrubShellRc(GROK_SCRUB_VARS),
    installUrl: "https://x.ai/cli",
    // xAI ships no npm package — the npm `grok-cli` is third-party, never offered.
    installSpec: {
      macos: curlPipe("https://x.ai/cli/install.sh", "bash"),
      linux: curlPipe("https://x.ai/cli/install.sh", "bash"),
      windows: irmPipe("https://x.ai/cli/install.ps1"),
      docsUrl: "https://docs.x.ai/build/overview",
    },
  },
];

/** Agents shown in the "select which CLI to customize" prompt. */
export interface AgentOption {
  name: string;
  value: string;
  disabled?: boolean | string;
}

export function listAgentOptions(lastAgentId?: string): AgentOption[] {
  const options = CUSTOMIZABLE_AGENTS.map((agent) => ({
    name: agent.id === lastAgentId ? `${agent.name} (latest)` : agent.name,
    value: agent.id,
  }));
  const latestIndex = options.findIndex((option) => option.value === lastAgentId);

  if (latestIndex > 0) {
    const [latest] = options.splice(latestIndex, 1);
    options.unshift(latest);
  }
  return options;
}

export function getAgentById(id: string): Agent | undefined {
  return CUSTOMIZABLE_AGENTS.find((a) => a.id === id);
}

export function isAgentId(value: string): boolean {
  return CUSTOMIZABLE_AGENTS.some((agent) => agent.id === value);
}

export function agentSupportsModel(agent: Agent, model: RemoteModel): boolean {
  return !model.apis?.length || agent.supportedProtocols.some((protocol) =>
    model.apis?.includes(protocol)
  );
}

/**
 * The install spec for the running platform, or undefined when cli-hop has
 * no verified install command there — the flow then degrades to the docs URL.
 */
export function installSpecFor(
  agentId: string,
  platform: "macos" | "linux" | "windows" | undefined
): Agent["installSpec"] {
  const spec = getAgentById(agentId)?.installSpec;
  if (!spec || !platform) return undefined;
  return spec[platform] ? spec : undefined;
}
