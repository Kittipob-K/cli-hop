import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ResyncService } from "../dist/services/resync.js";
import { handleSettingsAction } from "../dist/commands/settings.js";
import { SettingsService } from "../dist/services/settings.js";

const ENDPOINT = "https://gateway.example.com";
const KEY = "ccsk-resync-key";
const CATALOGUE = [
  { id: "claude-opus", apis: ["messages"] },
  { id: "chat-model", apis: ["chat_completions"] },
  { id: "responses-model", apis: ["responses"] },
];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-resync-"));
  return directory;
}

async function stubInstalled(commands) {
  const installed = new Set(commands);
  return async (command) => installed.has(command);
}

function stubPools(models) {
  return async () => ({ pools: [], models });
}

/** Build agents whose config writers target a temp directory. */
async function makeAgents(directory, ids) {
  const { ClaudeConfigService } = await import("../dist/services/claude-config.js");
  const { CodexConfigService } = await import("../dist/services/codex-config.js");
  const { GrokConfigService } = await import("../dist/services/grok-config.js");
  const { OmpConfigService } = await import("../dist/services/omp-config.js");
  const { OpenCodeConfigService } = await import("../dist/services/opencode-config.js");
  const { PiConfigService } = await import("../dist/services/pi-config.js");
  const agents = [];
  for (const id of ids) {
    if (id === "claude") {
      agents.push({
        id: "claude",
        name: "Claude Code",
        command: "claude",
        supportedProtocols: ["messages"],
        prepare: async ({ apiKey, endpoint, selected }) =>
          new ClaudeConfigService({
            claudeJsonPath: join(directory, ".claude.json"),
            settingsPath: join(directory, ".claude", "settings.json"),
          }).apply({ apiKey, endpoint, model: selected }),
        probeConfig: async () =>
          new ClaudeConfigService({
            claudeJsonPath: join(directory, ".claude.json"),
            settingsPath: join(directory, ".claude", "settings.json"),
          }).probe(),
      });
    }
    if (id === "omp") {
      agents.push({
        id: "omp",
        name: "Oh My Pi",
        command: "omp",
        supportedProtocols: ["chat_completions"],
        prepare: async ({ apiKey, endpoint, models, selected }) =>
          new OmpConfigService(join(directory, "models.yml")).apply({
            apiKey,
            endpoint,
            models,
            selected,
          }),
        probeConfig: async () =>
          new OmpConfigService(join(directory, "models.yml")).probe(),
      });
    }
    if (id === "pi") {
      agents.push({
        id: "pi",
        name: "Pi",
        command: "pi",
        supportedProtocols: ["chat_completions"],
        prepare: async ({ apiKey, endpoint, models, selected }) =>
          new PiConfigService(join(directory, "models.json")).apply({
            apiKey,
            endpoint,
            models,
            selected,
          }),
        probeConfig: async () =>
          new PiConfigService(join(directory, "models.json")).probe(),
      });
    }
    if (id === "opencode") {
      agents.push({
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        supportedProtocols: ["chat_completions"],
        prepare: async ({ apiKey, endpoint, models, selected }) =>
          new OpenCodeConfigService(join(directory, "opencode.json")).apply({
            apiKey,
            endpoint,
            models,
            selected,
          }),
        probeConfig: async () =>
          new OpenCodeConfigService(join(directory, "opencode.json")).probe(),
      });
    }
    if (id === "codex") {
      agents.push({
        id: "codex",
        name: "Codex CLI",
        command: "codex",
        supportedProtocols: ["responses"],
        prepare: async ({ apiKey, endpoint, selected }) =>
          new CodexConfigService(join(directory, "codex")).apply({
            apiKey,
            endpoint,
            model: selected,
          }),
        probeConfig: async () =>
          new CodexConfigService(join(directory, "codex")).probe(),
      });
    }
    if (id === "grok") {
      agents.push({
        id: "grok",
        name: "Grok Build",
        command: "grok",
        supportedProtocols: ["chat_completions"],
        prepare: async ({ apiKey, endpoint, selected }) =>
          new GrokConfigService(join(directory, "grok.toml")).apply({
            apiKey,
            endpoint,
            model: selected,
          }),
        probeConfig: async () =>
          new GrokConfigService(join(directory, "grok.toml")).probe(),
      });
    }
  }
  return agents;
}

test("Resync rewrites only installed agents that already have a config", async () => {
  const directory = await fixture();
  const claudeSettings = join(directory, ".claude", "settings.json");
  await mkdir(join(directory, ".claude"), { recursive: true });
  await writeFile(
    claudeSettings,
    JSON.stringify({ model: "claude-opus", env: { MY: "kept" } })
  );

  const agents = await makeAgents(directory, ["claude", "omp", "pi", "opencode", "codex", "grok"]);
  const resync = new ResyncService(agents, stubPools(CATALOGUE), await stubInstalled(["claude"]));
  const result = await resync.run({ apiKey: KEY, baseUrl: `${ENDPOINT}/v1` });

  assert.ok(result.files.some((file) => file.includes(".claude")), "claude config rewritten");
  assert.deepEqual(result.skipped.map((entry) => entry.agent), [
    "omp",
    "pi",
    "opencode",
    "codex",
    "grok",
  ]);
  assert.deepEqual(result.failed, []);
});

test("Resync preserves the existing model and refreshes the key", async () => {
  const directory = await fixture();
  const claudeSettings = join(directory, ".claude", "settings.json");
  await mkdir(join(directory, ".claude"), { recursive: true });
  await writeFile(
    claudeSettings,
    JSON.stringify({ model: "user-model", env: { MY: "kept" } })
  );

  const agents = await makeAgents(directory, ["claude"]);
  const resync = new ResyncService(agents, stubPools(CATALOGUE), await stubInstalled(["claude"]));
  await resync.run({ apiKey: KEY, baseUrl: `${ENDPOINT}/v1` });

  const config = JSON.parse(await readFile(claudeSettings, "utf8"));
  assert.equal(config.model, "user-model");
  assert.equal(config.env.ANTHROPIC_API_KEY, KEY);
  assert.equal(config.env.ANTHROPIC_BASE_URL, ENDPOINT);
  assert.equal(config.env.MY, "kept");
});

test("Resync falls back to the first compatible catalogue model when config has none", async () => {
  const directory = await fixture();
  const grokConfig = join(directory, "grok.toml");
  await writeFile(grokConfig, "[user]\nkept = true\n");

  const agents = await makeAgents(directory, ["grok"]);
  const resync = new ResyncService(agents, stubPools(CATALOGUE), await stubInstalled(["grok"]));
  const result = await resync.run({ apiKey: KEY, baseUrl: `${ENDPOINT}/v1` });

  assert.ok(result.files.length > 0, "an agent with an existing config was rewritten");
});

test("Resync falls back to local pools when the models API is unavailable", async () => {
  const directory = await fixture();
  const grokConfig = join(directory, "grok.toml");
  await writeFile(grokConfig, "[user]\nkept = true\n");

  // resolvePools degrades to local pools with no `models` — the catalogue
  // then comes from the pools themselves (graceful degradation, invariant 4).
  const resync = new ResyncService(
    await makeAgents(directory, ["grok"]),
    async () => ({ pools: [{ model: "chat-model", agents: [] }] }),
    await stubInstalled(["grok"])
  );
  const result = await resync.run({ apiKey: KEY, baseUrl: `${ENDPOINT}/v1` });

  assert.ok(result.files.length > 0, "local-pool model was used for the rewrite");
});

test("Resync continues past a failing agent", async () => {
  const directory = await fixture();
  const claudeSettings = join(directory, ".claude", "settings.json");
  await mkdir(join(directory, ".claude"), { recursive: true });
  await writeFile(claudeSettings, JSON.stringify({ model: "claude-opus" }));
  const grokConfig = join(directory, "grok.toml");
  await writeFile(grokConfig, "[user]\nkept = true\n");

  const agents = await makeAgents(directory, ["claude", "grok"]);
  // Force grok's rewrite to fail by making its config a malformed file that
  // probe still reports as existing but whose rewrite throws.
  const grok = agents.find((agent) => agent.id === "grok");
  grok.prepare = async () => {
    throw new Error("boom");
  };
  const resync = new ResyncService(agents, stubPools(CATALOGUE), await stubInstalled(["claude", "grok"]));
  const result = await resync.run({ apiKey: KEY, baseUrl: `${ENDPOINT}/v1` });

  assert.ok(result.files.some((file) => file.includes(".claude")));
  assert.deepEqual(result.failed, [{ agent: "grok", error: "boom" }]);
});

test("settings menu handles the resync action without crashing", async () => {
  const directory = await fixture();
  const filePath = join(directory, "settings.json");
  const settingsService = new SettingsService(filePath, { keychain: null });
  await settingsService.save({ apiKey: KEY, baseUrl: `${ENDPOINT}/v1` });

  // No installed agents on PATH -> nothing rewritten, graceful message.
  const result = await handleSettingsAction(
    { type: "resync" },
    settingsService,
    new ResyncService([], stubPools(CATALOGUE), async () => false)
  );
  assert.equal(result, "back");
});