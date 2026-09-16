import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ClaudeConfigService } from "../dist/services/claude-config.js";

const ENDPOINT = "https://gateway.example.com";
const API_KEY = "ccsk-test-key-with-a-long-tail-0001";
const MODEL = "claude-opus-4-8";

async function makePaths() {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-claude-unit-"));
  return {
    directory,
    claudeJsonPath: join(directory, ".claude.json"),
    settingsPath: join(directory, ".claude", "settings.json"),
  };
}

function service(paths) {
  return new ClaudeConfigService(paths);
}

test("Claude config merge keeps user env/permissions/model and adds CLI Hop values", async () => {
  const paths = await makePaths();
  await mkdir(join(paths.directory, ".claude"), { recursive: true });
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      env: {
        MY_TOOL: "kept",
        ANTHROPIC_AUTH_TOKEN: "stale-token",
      },
      permissions: { allow: ["Read"], deny: ["Bash"] },
      model: "user-picked-model",
      cleanupPeriodDays: 7,
    })
  );
  await writeFile(paths.claudeJsonPath, JSON.stringify({ theme: "dark" }));

  await service(paths).apply({ apiKey: API_KEY, endpoint: ENDPOINT, model: MODEL });

  const settings = JSON.parse(await readFile(paths.settingsPath, "utf8"));
  assert.equal(settings.env.MY_TOOL, "kept");
  assert.equal(settings.env.ANTHROPIC_BASE_URL, ENDPOINT);
  assert.equal(settings.env.ANTHROPIC_API_KEY, API_KEY);
  assert.equal(settings.env.CLAUDE_CODE_ATTRIBUTION_HEADER, "0");
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.deepEqual(settings.permissions, { allow: ["Read"], deny: ["Bash"] });
  assert.equal(settings.model, "user-picked-model");
  assert.equal(settings.cleanupPeriodDays, 7);

  const state = JSON.parse(await readFile(paths.claudeJsonPath, "utf8"));
  assert.equal(state.theme, "dark");
  assert.equal(state.hasCompletedOnboarding, true);
  assert.equal(state.bypassPermissionsModeAccepted, true);
});

test("Claude config approves the key tail and sets onboarding in both files", async () => {
  const paths = await makePaths();

  await service(paths).apply({ apiKey: API_KEY, endpoint: ENDPOINT, model: MODEL });

  const tail = API_KEY.slice(-20);
  for (const file of [paths.claudeJsonPath, paths.settingsPath]) {
    const config = JSON.parse(await readFile(file, "utf8"));
    assert.equal(config.hasCompletedOnboarding, true);
    assert.ok(config.customApiKeyResponses.approved.includes(tail));
    assert.deepEqual(config.customApiKeyResponses.rejected, []);
  }
});

test("Claude config defaults permissions and model when absent", async () => {
  const paths = await makePaths();

  await service(paths).apply({ apiKey: API_KEY, endpoint: ENDPOINT, model: MODEL });

  const settings = JSON.parse(await readFile(paths.settingsPath, "utf8"));
  assert.equal(settings.model, MODEL);
  assert.ok(Array.isArray(settings.permissions.allow));
  assert.equal(settings.permissions.defaultMode, "bypassPermissions");
  assert.equal(settings.cleanupPeriodDays, 30);
});

test("Claude config removes stale OAuth/credential files", async () => {
  const paths = await makePaths();
  const claudeDir = join(paths.directory, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(join(claudeDir, ".credentials.json"), "{}");
  await writeFile(join(claudeDir, "auth.json"), "{}");

  const changed = await service(paths).apply({
    apiKey: API_KEY,
    endpoint: ENDPOINT,
    model: MODEL,
  });

  await assert.rejects(readFile(join(claudeDir, ".credentials.json"), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(join(claudeDir, "auth.json"), "utf8"), { code: "ENOENT" });
  assert.ok(changed.some((entry) => entry.includes(".credentials.json")));
  assert.ok(changed.some((entry) => entry.includes("auth.json")));
});

test("Claude config writes 0600 files and a 0700 .claude directory", async () => {
  const paths = await makePaths();

  await service(paths).apply({ apiKey: API_KEY, endpoint: ENDPOINT, model: MODEL });

  assert.equal((await stat(paths.settingsPath)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.claudeJsonPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(paths.directory, ".claude"))).mode & 0o777, 0o700);
});

test("Claude config refills the approved tail without duplicating it", async () => {
  const paths = await makePaths();
  await service(paths).apply({ apiKey: API_KEY, endpoint: ENDPOINT, model: MODEL });

  const before = JSON.parse(await readFile(paths.settingsPath, "utf8"));
  await service(paths).apply({ apiKey: API_KEY, endpoint: ENDPOINT, model: MODEL });
  const after = JSON.parse(await readFile(paths.settingsPath, "utf8"));

  assert.equal(before.customApiKeyResponses.approved.length, 1);
  assert.deepEqual(after.customApiKeyResponses.approved, before.customApiKeyResponses.approved);
});

test("Claude scrub removes stale Anthropic exports from shell rc files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-claude-scrub-"));
  const rcFiles = [
    ".zshrc",
    ".zprofile",
    ".bashrc",
    ".bash_profile",
    ".profile",
    ".config/fish/config.fish",
  ];
  for (const rc of rcFiles) {
    const file = join(directory, rc);
    await mkdir(join(directory, ".config", "fish"), { recursive: true });
    const content = [
      'export ANTHROPIC_API_KEY="stale"',
      "export ANTHROPIC_BASE_URL=https://stale.example.com",
      'export PATH="/usr/local/bin:$PATH"',
      "set -xe ANTHROPIC_AUTH_TOKEN stale-token",
      "alias g=git",
    ].join("\n");
    await writeFile(file, content);
  }

  const touched = await new ClaudeConfigService().scrubShellRc(directory);

  for (const rc of rcFiles) {
    const file = join(directory, rc);
    assert.ok(touched.includes(file), `${file} should be reported`);
    const kept = await readFile(file, "utf8");
    assert.equal(kept.includes("ANTHROPIC_API_KEY"), false);
    assert.equal(kept.includes("ANTHROPIC_BASE_URL"), false);
    assert.equal(kept.includes("ANTHROPIC_AUTH_TOKEN"), false);
    assert.equal(kept.includes('export PATH="/usr/local/bin:$PATH"'), true);
    assert.equal(kept.includes("alias g=git"), true);
  }
});

test("Claude scrub keeps files without stale exports untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-claude-scrub-keep-"));
  const file = join(directory, ".zshrc");
  await writeFile(file, 'export PATH="/usr/local/bin:$PATH"\nalias g=git\n');

  const touched = await new ClaudeConfigService().scrubShellRc(directory);

  assert.deepEqual(touched, []);
  assert.equal(await readFile(file, "utf8"), 'export PATH="/usr/local/bin:$PATH"\nalias g=git\n');
});