import { constants, existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { confirm } from "@inquirer/prompts";
import type { Agent } from "../types.js";
import * as ui from "../ui.js";
/**
 * Install commands are the verbatim one-liners from each agent's official
 * documentation (verified 2026-09): code.claude.com/docs/en/setup,
 * developers.openai.com/codex/cli/, docs.x.ai/build/overview,
 * opencode.ai/docs/, pi.dev/docs/latest, omp.sh / github.com/can1357/oh-my-pi.
 */

/** The platforms cli-hop distinguishes for install commands. */
export type PlatformKey = "macos" | "linux" | "windows";

/**
 * A structured execution plan for one official install command. Commands that
 * are shell pipelines in the official docs (`curl … | bash`, `irm … | iex`)
 * run by handing the verbatim command string to the interpreter as a single
 * argument — no user input is ever interpolated, and argv stays an array
 * (DEP0190-safe, invariant 5).
 */
export type InstallStep =
  /** `curl -fsSL <url> | bash` / `… | sh` — verbatim POSIX one-liner. */
  | { kind: "script"; shell: "bash" | "sh"; command: string }
  /** `irm <url> | iex` — verbatim PowerShell one-liner. */
  | { kind: "powershell"; command: string }
  /** `npm <args...>` — npm global install (npm resolved per platform). */
  | { kind: "npm"; args: readonly string[] }
  /** Run steps in order; stops at the first failure (docs' `a && b`). */
  | { kind: "sequential"; steps: readonly InstallStep[] };

/** One official install command: display string + structured exec plan. */
export interface InstallCommand {
  /** Execution plan. */
  readonly steps: readonly InstallStep[];
}

/** Official install instructions for one agent on one platform. */
export interface AgentInstallSpec {
  readonly macos?: InstallCommand;
  readonly linux?: InstallCommand;
  readonly windows?: InstallCommand;
  /** Docs URL printed when the user declines or installation fails. */
  readonly docsUrl: string;
}

/** Human-readable rendering of a step (shown in the spinner). */
function describeStep(step: InstallStep): string {
  switch (step.kind) {
    case "script":
      return `${step.shell}: ${step.command}`;
    case "powershell":
      return `PowerShell: ${step.command}`;
    case "npm":
      return `npm ${step.args.join(" ")}`;
    case "sequential":
      return step.steps.map(describeStep).join(" && ");
  }
}

/** The verbatim official one-liner for an install command (for the UI). */
export function displayInstallCommand(command: InstallCommand): string {
  const parts: string[] = [];
  for (const step of command.steps) {
    switch (step.kind) {
      case "script":
      case "powershell":
        parts.push(step.command);
        break;
      case "npm":
        parts.push(`npm ${step.args.join(" ")}`);
        break;
      case "sequential":
        parts.push(step.steps.map((s) => displayInstallCommand({ steps: [s] })).join(" && "));
        break;
    }
  }
  return parts.join(" && ");
}

/** Helpers keeping the spec table readable. */
const curlPipe = (url: string, shell: "bash" | "sh"): InstallCommand => ({
  steps: [{ kind: "script", shell, command: `curl -fsSL ${url} | ${shell}` }],
});
const irmPipe = (url: string): InstallCommand => ({
  steps: [{ kind: "powershell", command: `irm ${url} | iex` }],
});
const npmGlobal = (...pkgs: readonly string[]): InstallCommand => ({
  steps: [{ kind: "npm", args: ["install", "-g", ...pkgs] }],
});
const npmGlobalWithPostinstall = (...pkgs: readonly string[]): InstallCommand => ({
  steps: [
    { kind: "npm", args: ["install", "-g", ...pkgs] },
    {
      kind: "script",
      shell: "sh",
      command: `cd "$(npm root -g)/${pkgs[0]}" && node postinstall.mjs`,
    },
  ],
});

/**
 * Official install command spec per agent id. Every CUSTOMIZABLE_AGENTS entry
 * must appear here (enforced by tests) — `installSpecFor` degrades to the
 * docs URL when a platform has no verified command.
 */
export const AGENT_INSTALL_SPECS: Record<string, AgentInstallSpec> = {
  "claude-code": {
    macos: curlPipe("https://claude.ai/install.sh", "bash"),
    linux: curlPipe("https://claude.ai/install.sh", "bash"),
    windows: irmPipe("https://claude.ai/install.ps1"),
    docsUrl: "https://code.claude.com/docs/en/setup",
  },
  omp: {
    macos: curlPipe("https://omp.sh/install", "sh"),
    linux: curlPipe("https://omp.sh/install", "sh"),
    windows: irmPipe("https://omp.sh/install.ps1"),
    docsUrl: "https://github.com/can1357/oh-my-pi",
  },
  pi: {
    macos: npmGlobal("--ignore-scripts", "@earendil-works/pi-coding-agent"),
    linux: npmGlobal("--ignore-scripts", "@earendil-works/pi-coding-agent"),
    windows: npmGlobal("--ignore-scripts", "@earendil-works/pi-coding-agent"),
    docsUrl: "https://pi.dev/docs/latest",
  },
  opencode: {
    // OpenCode's npm package ships a stub that requires its postinstall script
    // to download the platform-specific native binary. Re-run postinstall.mjs
    // after the global install so the real `bin/opencode.exe` is produced.
    macos: npmGlobalWithPostinstall("opencode-ai"),
    linux: npmGlobalWithPostinstall("opencode-ai"),
    windows: npmGlobalWithPostinstall("opencode-ai"),
    docsUrl: "https://opencode.ai/docs/",
  },
  codex: {
    macos: curlPipe("https://chatgpt.com/codex/install.sh", "sh"),
    linux: curlPipe("https://chatgpt.com/codex/install.sh", "sh"),
    windows: irmPipe("https://chatgpt.com/codex/install.ps1"),
    docsUrl: "https://developers.openai.com/codex/cli/",
  },
  grok: {
    macos: curlPipe("https://x.ai/cli/install.sh", "bash"),
    linux: curlPipe("https://x.ai/cli/install.sh", "bash"),
    // xAI ships no npm package — the npm `grok-cli` is third-party, never offered.
    windows: irmPipe("https://x.ai/cli/install.ps1"),
    docsUrl: "https://docs.x.ai/build/overview",
  },
};

/** Map the running platform to a PlatformKey; undefined on exotic systems. */
export function currentPlatformKey(): PlatformKey | undefined {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return undefined;
  }
}

/**
 * The install spec for the running platform, or undefined when cli-hop has
 * no verified install command there — the flow then degrades to the docs URL.
 */
export function installSpecFor(
  agentId: string,
  platform: PlatformKey | undefined = currentPlatformKey()
): AgentInstallSpec | undefined {
  const spec = AGENT_INSTALL_SPECS[agentId];
  if (!spec || !platform) return undefined;
  const command = spec[platform];
  return command ? spec : undefined;
}

/** Windows executable extensions probed when scanning PATH. */
const WIN_PATHEXT = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");

/** True when `command` resolves to an executable file on PATH. */
export async function isInstalled(command: string): Promise<boolean> {
  const isWindows = process.platform === "win32";
  const pathEnv = process.env.PATH ?? "";
  const separator = isWindows ? ";" : ":";
  for (const rawDir of pathEnv.split(separator)) {
    const dir = isWindows ? rawDir.trim().replace(/^"|"$/g, "") : rawDir;
    if (!dir) continue;
    const candidates = isWindows
      ? WIN_PATHEXT.map((ext) => `${dir}\\${command}${ext}`)
      : [`${dir}/${command}`];
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        if (command === "grok") {
          try {
            if ((await readFile(candidate, "utf8")).includes("cmux grok wrapper")) continue;
          } catch {
            // A non-text executable cannot be the cmux shell wrapper.
          }
        }
        return true;
      } catch {
        // keep scanning
      }
    }
  }
  return false;
}

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

export interface AgentInstallResult {
  ok: boolean;
  output: string;
}

/** Run one npm global-install step, resolving npm per platform. */
function spawnNpm(args: readonly string[]): ChildProcessByStdio<null, Readable, Readable> {
  if (process.platform !== "win32") {
    return spawn("npm", [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    });
  }
  // Windows: .cmd shims cannot be spawned with shell:false (Node EINVAL), so
  // prefer the npm-cli.js shipped next to the node binary; cmd.exe is the
  // last resort — argv stays an array, no string interpolation.
  const execDir = dirname(process.execPath);
  const cliCandidates = [
    join(execDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(execDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const cli of cliCandidates) {
    if (existsSync(cli)) {
      return spawn(process.execPath, [cli, ...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
      });
    }
  }
  return spawn("cmd.exe", ["/d", "/s", "/c", "npm", ...args], {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
  });
}

/** Spawn one install step; resolves on close/error, never throws. */
function runStep(
  step: InstallStep,
  opts: { signal?: AbortSignal }
): Promise<AgentInstallResult> {
  const { promise, resolve } = Promise.withResolvers<AgentInstallResult>();
  let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
  const signal = opts.signal ?? AbortSignal.timeout(INSTALL_TIMEOUT_MS);
  switch (step.kind) {
    case "script":
      child = spawn(step.shell, ["-c", step.command], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        signal,
      });
      break;
    case "powershell":
      child = spawn(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", step.command],
        { shell: false, stdio: ["ignore", "pipe", "pipe"], signal }
      );
      break;
    case "npm":
      child = spawnNpm(step.args);
      break;
    case "sequential":
      return runSteps(step.steps, opts);
  }
  const proc = child as ChildProcessByStdio<null, Readable, Readable>;
  let output = "";
  proc.stdout.on("data", (chunk: Buffer) => (output += chunk));
  proc.stderr.on("data", (chunk: Buffer) => (output += chunk));
  proc.once("error", (err: Error) => {
    resolve({
      ok: false,
      output: output.trim() ? `${output.trim()}\n${err.message}` : err.message,
    });
  });
  proc.once("close", (code) => {
    resolve({ ok: code === 0, output: output.trim() });
  });
  return promise;
}

/** Run steps in order, short-circuiting on the first failure. */
async function runSteps(
  steps: readonly InstallStep[],
  opts: { onProgress?: (msg: string) => void; signal?: AbortSignal }
): Promise<AgentInstallResult> {
  for (const step of steps) {
    opts.onProgress?.(describeStep(step));
    const result = await runStep(step, opts);
    if (!result.ok) return result;
  }
  return { ok: true, output: "" };
}

/** Execute an official install command (structured steps, no shell strings). */
export function runInstallCommand(
  command: InstallCommand,
  opts: { onProgress?: (msg: string) => void; signal?: AbortSignal } = {}
): Promise<AgentInstallResult> {
  return runSteps(command.steps, opts);
}

/** Last lines of installer output shown when an install fails. */
function printOutputTail(output: string, lines = 5): void {
  const tail = output.split("\n").slice(-lines);
  if (tail.length > 0) ui.muted(tail.map((l) => `  ${l}`).join("\n"));
}

/**
 * Next-best-step install check (forge-login style, like ensurePrerequisites):
 * before launching, verify the agent CLI resolves on PATH; when missing, ask
 * whether to run the official installer for the current platform right there.
 *
 * Never crashes the flow (invariant 4): on decline, non-interactive stdin, or
 * install failure it prints the docs URL and returns false.
 */
export async function ensureAgentInstalled(agent: Agent): Promise<boolean> {
  if (await isInstalled(agent.command)) return true;

  const spec = installSpecFor(agent.id);
  ui.warn(
    `${agent.name} (${ui.code(agent.command)}) is not installed or not on PATH.`
  );

  if (!spec) {
    const url = agent.installUrl ?? "";
    if (url) ui.muted(`  Install it manually: ${ui.url(url)}`);
    return false;
  }

  const command = spec[currentPlatformKey()!]!;
  ui.info(`Official ${agent.name} installer for ${currentPlatformKey()}:`);
  ui.muted(`  ${displayInstallCommand(command)}`);

  if (!process.stdin.isTTY) {
    ui.muted(`  Install it manually: ${ui.url(spec.docsUrl)}`);
    return false;
  }

  let confirmed: boolean;
  try {
    confirmed = await confirm({
      message: `Install ${agent.name} now?`,
      default: true,
    });
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    ui.muted(`  When ready: ${ui.url(spec.docsUrl)}`);
    return false;
  }

  const spinner = new ui.Spinner(`Installing ${agent.name}`);
  const result = await runInstallCommand(command, {
    onProgress: (msg) => spinner.update(msg),
  });
  spinner.stop();

  if (!result.ok) {
    ui.danger(`${agent.name} installation failed.`);
    if (result.output) printOutputTail(result.output);
    ui.muted(`  Install it manually: ${ui.url(spec.docsUrl)}`);
    return false;
  }

  if (await isInstalled(agent.command)) {
    ui.ok(`${agent.name} installed.`);
    return true;
  }
  ui.warn(
    `Installer finished but ${ui.code(agent.command)} is not on PATH yet — open a new terminal or add its install dir to PATH.`
  );
  ui.muted(`  Docs: ${ui.url(spec.docsUrl)}`);
  return false;
}
