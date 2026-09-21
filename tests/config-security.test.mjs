import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { PiConfigService } from "../dist/services/pi-config.js";
import { SettingsService } from "../dist/services/settings.js";
import { ClaudeConfigService } from "../dist/services/claude-config.js";
import { OmpConfigService } from "../dist/services/omp-config.js";
import { OpenCodeConfigService } from "../dist/services/opencode-config.js";

test("Pi config merge keeps other providers, writes the literal key, and uses private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-pi-"));
  const modelsPath = join(directory, "agent", "models.json");
  await mkdir(dirname(modelsPath), { recursive: true });
  await writeFile(modelsPath, '{\n  // keep provider\n  "providers": { "existing": {} }\n}\n');

  await new PiConfigService(modelsPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "model", apis: ["responses"] }],
    selected: "model",
  });

  const raw = await readFile(modelsPath, "utf8");
  const config = JSON.parse(raw);
  assert.ok(config.providers.existing);
  assert.equal(config.providers["cli-hop"].apiKey, "test-key");
  assert.equal(raw.includes("CLI_HOP_API_KEY"), false);
  assert.equal((await stat(dirname(modelsPath))).mode & 0o777, 0o700);
  assert.equal((await stat(modelsPath)).mode & 0o777, 0o600);
});

test("Settings save enforces private file permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-settings-"));
  const filePath = join(directory, "cli-hop", "settings.json");
  const settings = new SettingsService(filePath, { keychain: null });

  await settings.save({ apiKey: "test-key", baseUrl: "https://example.com/v1" });

  assert.equal((await stat(dirname(filePath))).mode & 0o777, 0o700);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});

test("explicitly disabled keychain keeps credentials in the settings file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-settings-file-only-"));
  const filePath = join(directory, "cli-hop", "settings.json");
  const settings = new SettingsService(filePath, { keychain: null });

  await settings.setApiKey("file-only-key");

  assert.equal(JSON.parse(await readFile(filePath, "utf8")).apiKey, "file-only-key");
  assert.equal(await settings.setApiKey("file-only-key"), "file");
});

test("Claude config refuses to overwrite malformed JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-claude-"));
  const claudeJsonPath = join(directory, ".claude.json");
  const settingsPath = join(directory, ".claude", "settings.json");
  await writeFile(claudeJsonPath, "{ malformed");

  await assert.rejects(
    new ClaudeConfigService({ claudeJsonPath, settingsPath }).apply({
      apiKey: "test-key",
      endpoint: "https://example.com",
      model: "model",
    }),
    /is not valid JSON/
  );
  assert.equal(await readFile(claudeJsonPath, "utf8"), "{ malformed");
});

test("Claude root config preserves the parent directory permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-claude-parent-"));
  await chmod(directory, 0o750);
  const claudeJsonPath = join(directory, ".claude.json");
  const settingsPath = join(directory, ".claude", "settings.json");

  await new ClaudeConfigService({ claudeJsonPath, settingsPath }).apply({
    apiKey: "test-key",
    endpoint: "https://example.com",
    model: "model",
  });

  assert.equal((await stat(directory)).mode & 0o777, 0o750);
  assert.equal((await stat(join(directory, ".claude"))).mode & 0o777, 0o700);
  assert.equal((await stat(claudeJsonPath)).mode & 0o777, 0o600);
  assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);
});

test("OMP config refuses an invalid providers value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-omp-"));
  const modelsPath = join(directory, "agent", "models.yml");
  await mkdir(dirname(modelsPath), { recursive: true });
  await writeFile(modelsPath, "providers: invalid\n");

  await assert.rejects(
    new OmpConfigService(modelsPath).apply({
      apiKey: "test-key",
      endpoint: "https://example.com",
      models: [{ id: "model" }],
      selected: "model",
    }),
    /invalid providers object/
  );
  assert.equal(await readFile(modelsPath, "utf8"), "providers: invalid\n");
});

async function openCodeCase(seed, expectedMessage, apis = ["chat_completions"]) {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(configPath, seed);

  await assert.rejects(
    new OpenCodeConfigService(configPath).apply({
      endpoint: "https://example.com",
      models: [{ id: "model", apis }],
      selected: "model",
    }),
    expectedMessage
  );
  assert.equal(await readFile(configPath, "utf8"), seed);
}

test("OpenCode config refuses a malformed provider value", () =>
  openCodeCase('{"provider":"invalid"}', /invalid provider object/));

test("OpenCode config refuses a malformed cli-hop provider value", () =>
  openCodeCase('{"provider":{"cli-hop":"invalid"}}', /invalid cli-hop provider object/));

test("OpenCode config refuses a malformed cli-hop options value", () =>
  openCodeCase('{"provider":{"cli-hop":{"options":[]}}}', /invalid cli-hop options object/));

test("OpenCode config refuses a malformed cli-hop models value", () =>
  openCodeCase('{"provider":{"cli-hop":{"models":"invalid"}}}', /invalid cli-hop models value|invalid cli-hop models object/));

test("OpenCode config refuses a malformed entry for a catalogue model", () =>
  openCodeCase(
    '{"provider":{"cli-hop":{"models":{"model":"invalid"}}}}',
    /invalid cli-hop model configuration for model/,
    ["chat_completions"]
  ));

test("OpenCode config refuses a malformed entry in the legacy provider", () =>
  openCodeCase(
    '{"provider":{"cli-hop":{"models":{"model":"invalid"}}}}',
    /invalid cli-hop model configuration for model/
  ));

test("OpenCode config refuses to overwrite malformed JSON", () =>
  openCodeCase("{ malformed", /is not valid JSON/));
