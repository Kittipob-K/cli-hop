import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("run launches Claude Code with paginated CLI Hop models and a clean environment", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "cli-hop-e2e-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  const capturePath = join(root, "capture.json");
  await Promise.all([mkdir(homeDir), mkdir(binDir), mkdir(join(configDir, "cli-hop"), { recursive: true })]);

  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer e2e-key");
    const url = new URL(request.url, "http://localhost");
    response.setHeader("content-type", "application/json");
    if (!url.searchParams.has("after_id")) {
      response.end(JSON.stringify({
        data: [{ id: "messages-only" }],
        has_more: true,
        last_id: "page-1",
        "cli-hop": { models: { messages: ["messages-only"] } },
      }));
      return;
    }
    response.end(JSON.stringify({
      data: [{ id: "claude-model" }],
      has_more: false,
      "cli-hop": { models: { messages: ["claude-model"] } },
    }));
  });
  const address = await listen(server);
  context.after(() => server.close());
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  await writeFile(
    join(configDir, "cli-hop", "settings.json"),
    JSON.stringify({ apiKey: "e2e-key", baseUrl })
  );
  const stubPath = join(binDir, "claude");
  await writeFile(
    stubPath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({args:process.argv.slice(1),anthropicKey:process.env.ANTHROPIC_API_KEY ?? null,anthropicBase:process.env.ANTHROPIC_BASE_URL ?? null,authToken:process.env.ANTHROPIC_AUTH_TOKEN ?? null}));' -- "$@"\n`
  );
  await chmod(stubPath, 0o700);

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "claude-code", "-p", "remote:claude-model"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: homeDir,
        XDG_CONFIG_HOME: configDir,
        PATH: `${binDir}:${process.env.PATH}`,
        CAPTURE_PATH: capturePath,
        CLI_HOP_DISABLE_KEYCHAIN: "1",
        CLI_HOP_NO_UPDATE_CHECK: "1",
        OPENAI_API_KEY: "inherited-openai",
        OPENAI_API_BASE: "https://inherited.example.com",
        ANTHROPIC_API_KEY: "inherited-anthropic",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  assert.deepEqual(capture.args, ["--model", "claude-model"]);
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.anthropicBase, null);
  assert.equal(capture.authToken, null);
});

async function createFixture(context) {
  const root = await mkdtemp(join(tmpdir(), "cli-hop-agent-e2e-"));
  const homeDir = join(root, "home");
  const configDir = join(root, "config");
  const binDir = join(root, "bin");
  const capturePath = join(root, "capture.json");
  await Promise.all([mkdir(homeDir), mkdir(binDir), mkdir(join(configDir, "cli-hop"), { recursive: true })]);

  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer e2e-key");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      data: [
        { id: "chat-model" },
        { id: "responses-model" },
        { id: "claude-model" },
      ],
      has_more: false,
      "cli-hop": {
        models: {
          chat_completions: ["chat-model"],
          responses: ["responses-model"],
          messages: ["claude-model"],
        },
      },
    }));
  });
  const address = await listen(server);
  context.after(() => server.close());
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  await writeFile(
    join(configDir, "cli-hop", "settings.json"),
    JSON.stringify({ apiKey: "e2e-key", baseUrl })
  );

  return { root, homeDir, configDir, binDir, capturePath, baseUrl };
}

async function writeCaptureStub(binDir, command) {
  const stubPath = join(binDir, command);
  await writeFile(
    stubPath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({args:process.argv.slice(1),cliHopKey:process.env.CLI_HOP_API_KEY ?? null,anthropicKey:process.env.ANTHROPIC_API_KEY ?? null,openaiKey:process.env.OPENAI_API_KEY ?? null,piDir:process.env.PI_CODING_AGENT_DIR ?? null}));' -- "$@"\n`
  );
  await chmod(stubPath, 0o700);
}

function fixtureEnv(fixture) {
  return {
    ...process.env,
    HOME: fixture.homeDir,
    XDG_CONFIG_HOME: fixture.configDir,
    PATH: `${fixture.binDir}:${process.env.PATH}`,
    CAPTURE_PATH: fixture.capturePath,
    CLI_HOP_DISABLE_KEYCHAIN: "1",
    CLI_HOP_NO_UPDATE_CHECK: "1",
    CLI_HOP_API_KEY: "inherited-cli-hop",
    ANTHROPIC_API_KEY: "inherited-anthropic",
    OPENAI_API_KEY: "inherited-openai",
    PI_CODING_AGENT_DIR: "/inherited/pi",
  };
}

test("run syncs Pi config and launches the selected provider model", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "pi");
  const piConfigPath = join(fixture.homeDir, ".pi", "agent", "models.json");
  await mkdir(join(fixture.homeDir, ".pi", "agent"), { recursive: true });
  await writeFile(piConfigPath, JSON.stringify({ providers: { existing: { name: "Existing" } } }));

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "pi", "-p", "remote:chat-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.deepEqual(capture.args, ["--model", "cli-hop/chat-model"]);
  assert.equal(capture.cliHopKey, null);
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.openaiKey, null);
  assert.equal(capture.piDir, null);
  const config = JSON.parse(await readFile(piConfigPath, "utf8"));
  assert.equal(config.providers.existing.name, "Existing");
  assert.equal(config.providers["cli-hop"].apiKey, "e2e-key");
  assert.deepEqual(config.providers["cli-hop"].models.map((model) => model.id), ["chat-model"]);
});

test("run syncs OpenCode and writes the literal key", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "opencode");

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "opencode", "-p", "remote:chat-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.deepEqual(capture.args, ["--model", "cli-hop/chat-model"]);
  const raw = await readFile(join(fixture.configDir, "opencode", "opencode.json"), "utf8");
  assert.equal(JSON.parse(raw).provider["cli-hop"].options.apiKey, "e2e-key");
});

test("run removes OpenCode models the gateway no longer serves", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "opencode");
  const opencodeConfigPath = join(fixture.configDir, "opencode", "opencode.json");
  await mkdir(dirname(opencodeConfigPath), { recursive: true });
  await writeFile(
    opencodeConfigPath,
    JSON.stringify({
      provider: {
        "cli-hop": { models: { "retired-model": { name: "Retired model" } } },
      },
    })
  );

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "opencode", "-p", "remote:chat-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /retired-model/);
  const config = JSON.parse(await readFile(opencodeConfigPath, "utf8"));
  assert.equal(config.provider["cli-hop"].models["retired-model"], undefined);
});

test("run launches Codex with only the model and user args", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "codex");

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "codex", "-p", "remote:responses-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.equal(capture.cliHopKey, null);
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.openaiKey, null);
  assert.deepEqual(capture.args, ["--model", "responses-model"]);
});

test("run writes the Grok managed config block and launches without a key env var", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "grok");

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "grok", "-p", "remote:chat-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.equal(capture.cliHopKey, null);
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.openaiKey, null);
  assert.deepEqual(capture.args, []);
  const raw = await readFile(join(fixture.homeDir, ".grok", "config.toml"), "utf8");
  assert.equal(raw.includes("# >>> CLI Hop Grok Build >>>"), true);
  assert.match(raw, /\[model\."chat-model"\]/);
  assert.match(raw, /base_url = ".*\/v1"/);
  assert.match(raw, /api_key = "e2e-key"/);
  assert.match(raw, /api_backend = "chat_completions"/);
  assert.match(raw, /default = "chat-model"/);
  assert.match(raw, /models_base_url = /);
  assert.match(raw, /default_skills_installs_purged = true/);
});

test("run deploys the Codex installer-parity config files before launching", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "codex");

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "codex", "-p", "remote:responses-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const codexHome = join(fixture.homeDir, ".codex");
  const raw = await readFile(join(codexHome, "config.toml"), "utf8");
  assert.match(raw, /model = "responses-model"/);
  assert.match(raw, /\[model_providers\.cli-hop\]/);
  assert.match(raw, /base_url = ".*"/);
  const auth = JSON.parse(await readFile(join(codexHome, "auth.json"), "utf8"));
  assert.equal(auth.OPENAI_API_KEY, "e2e-key");
  assert.equal(
    (await readFile(join(codexHome, "cli-hop.config.toml"), "utf8")).includes("responses-model"),
    true
  );
});

test("model override uses the effective model protocol instead of the pool protocol", async (context) => {
  const fixture = await createFixture(context);
  await writeCaptureStub(fixture.binDir, "codex");

  const result = await run(
    process.execPath,
    [
      "dist/index.js",
      "run",
      "-a",
      "codex",
      "-p",
      "remote:chat-model",
      "-m",
      "responses-model",
    ],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.deepEqual(capture.args.slice(0, 2), ["--model", "responses-model"]);
});

test("run configures Claude Code installer-parity config and launches with a clean env", async (context) => {
  const fixture = await createFixture(context);
  const stubPath = join(fixture.binDir, "claude");
  await writeFile(
    stubPath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({args:process.argv.slice(1),anthropicKey:process.env.ANTHROPIC_API_KEY ?? null,anthropicBase:process.env.ANTHROPIC_BASE_URL ?? null,authToken:process.env.ANTHROPIC_AUTH_TOKEN ?? null}));' -- "$@"\n`
  );
  await chmod(stubPath, 0o700);

  const result = await run(
    process.execPath,
    ["dist/index.js", "run", "-a", "claude-code", "-p", "remote:claude-model"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  const capture = JSON.parse(await readFile(fixture.capturePath, "utf8"));
  assert.deepEqual(capture.args, ["--model", "claude-model"]);
  assert.equal(capture.anthropicKey, null);
  assert.equal(capture.anthropicBase, null);
  assert.equal(capture.authToken, null);

  const state = JSON.parse(await readFile(join(fixture.homeDir, ".claude.json"), "utf8"));
  assert.equal(state.hasCompletedOnboarding, true);
  assert.equal(state.bypassPermissionsModeAccepted, true);
  assert.ok(state.customApiKeyResponses.approved.includes("e2e-key".slice(-20)));

  const settings = JSON.parse(
    await readFile(join(fixture.homeDir, ".claude", "settings.json"), "utf8")
  );
  assert.equal(settings.model, "claude-model");
  assert.equal(settings.env.ANTHROPIC_BASE_URL, fixture.baseUrl.replace(/\/v1$/, ""));
  assert.equal(settings.env.ANTHROPIC_API_KEY, "e2e-key");
  assert.equal(settings.env.CLAUDE_CODE_ATTRIBUTION_HEADER, "0");
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(settings.hasCompletedOnboarding, true);
});

test("check reports a reachable gateway without exposing the key", async (context) => {
  const fixture = await createFixture(context);

  const result = await run(
    process.execPath,
    ["dist/index.js", "check"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Gateway reachable/);
  assert.match(result.stdout, /3 models available/);
  assert.equal(result.stdout.includes("e2e-key"), false);
});

test("check reports a rejected key and exits non-zero", async (context) => {
  const fixture = await createFixture(context);
  const server = http.createServer((request, response) => {
    response.statusCode = 401;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "unauthorized" }));
  });
  const address = await listen(server);
  context.after(() => server.close());
  await writeFile(
    join(fixture.configDir, "cli-hop", "settings.json"),
    JSON.stringify({ apiKey: "bad-key", baseUrl: `http://127.0.0.1:${address.port}/v1` })
  );

  const result = await run(
    process.execPath,
    ["dist/index.js", "check"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /rejected \(401\)/);
  assert.equal(result.stderr.includes("bad-key"), false);
});

test("check degrades gracefully without an API key", async (context) => {
  const fixture = await createFixture(context);
  await writeFile(
    join(fixture.configDir, "cli-hop", "settings.json"),
    JSON.stringify({ baseUrl: fixture.baseUrl })
  );

  const result = await run(
    process.execPath,
    ["dist/index.js", "check"],
    { cwd: process.cwd(), env: fixtureEnv(fixture), stdio: ["ignore", "pipe", "pipe"] }
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /No API key configured/);
});
