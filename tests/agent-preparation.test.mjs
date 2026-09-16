import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OpenCodeConfigService } from "../dist/services/opencode-config.js";

test("OpenCode config preserves other providers and references the key from env", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({ provider: { existing: { name: "Existing" } } })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [
      { id: "claude-model", apis: ["messages"] },
      { id: "chat-model", apis: ["chat_completions"] },
      { id: "responses-model", apis: ["responses"] },
    ],
    selected: "chat-model",
  });
  assert.deepEqual(result.staleModels, []);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider.existing.name, "Existing");
  assert.equal(config.provider["cli-hop"].options.apiKey, "test-key");
  assert.equal(
    config.provider["cli-hop"].options.baseURL,
    "https://gateway.example.com/v1"
  );
  assert.equal(config.$schema, undefined);
  assert.deepEqual(Object.keys(config.provider["cli-hop"].models), ["chat-model"]);
  assert.equal(config.model, "cli-hop/chat-model");
  assert.equal(config.small_model, "cli-hop/chat-model");
  assert.equal(config.provider["cli-hop"].options.apiKey, "test-key");
});

test("OpenCode config adds the schema only when it creates the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");

  const created = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "chat-model", apis: ["chat_completions"] }],
    selected: "chat-model",
  });
  assert.deepEqual(created.staleModels, []);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.equal(config.model, "cli-hop/chat-model");
  assert.deepEqual(Object.keys(config.provider["cli-hop"].models), ["chat-model"]);

  await writeFile(configPath, JSON.stringify({ theme: "dark" }));

  await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "chat-model", apis: ["chat_completions"] }],
    selected: "chat-model",
  });

  const untouchedSchema = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(untouchedSchema.$schema, undefined);
  assert.equal(untouchedSchema.theme, "dark");
});

test("OpenCode config adds new models without dropping existing model settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        existing: { name: "Existing" },
        "cli-hop": {
          options: {
            timeout: 60000,
            headers: { "X-Workspace": "keep" },
          },
          models: {
            "old-model": {
              name: "Old model",
              limit: { context: 100000 },
            },
            "shared-model": {
              name: "Original shared name",
              limit: { output: 4096 },
            },
          },
        },
      },
      mcp: { existing: { type: "remote" } },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [
      { id: "new-model", displayName: "New model", apis: ["chat_completions"] },
      { id: "shared-model", displayName: "Updated shared name", apis: ["chat_completions"] },
      { id: "responses-model", apis: ["responses"] },
    ],
    selected: "new-model",
  });
  assert.equal(result.path, configPath);
  // Chat-capable saved models migrate to the OpenAI-compatible provider;
  // old-model has no live wire and stays in the Anthropic provider as stale.
  assert.deepEqual(result.staleModels, []);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider.existing.name, "Existing");
  assert.deepEqual(config.mcp.existing, { type: "remote" });
  assert.equal(config.provider["cli-hop"].npm, "@ai-sdk/openai-compatible");
  assert.equal(config.provider["cli-hop"].options.timeout, 60000);
  assert.deepEqual(config.provider["cli-hop"].options.headers, { "X-Workspace": "keep" });
  assert.deepEqual(Object.keys(config.provider["cli-hop"].models), [
    "new-model",
    "shared-model",
  ]);
  assert.deepEqual(config.provider["cli-hop"].models["new-model"], { name: "New model" });
  assert.equal(config.provider["cli-hop"].models["shared-model"].name, "Updated shared name");
  assert.deepEqual(config.provider["cli-hop"].models["shared-model"].limit, { output: 4096 });
  assert.equal(config.model, "cli-hop/new-model");

  const second = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "another-model", apis: ["chat_completions"] }],
    selected: "another-model",
  });
  assert.deepEqual(second.staleModels, []);

  const updated = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(Object.keys(updated.provider["cli-hop"].models), [
    "another-model",
  ]);
});

test("OpenCode config resolves the model name from displayName, then the saved name, then the id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": {
          models: {
            "renamed-model": { name: "User edited label", limit: { context: 100000 } },
          },
        },
      },
    })
  );

  await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [
      { id: "renamed-model", apis: ["chat_completions"] },
      { id: "gateway-named", displayName: "Gateway name", apis: ["chat_completions"] },
      { id: "unlabeled", apis: ["chat_completions"] },
    ],
    selected: "renamed-model",
  });

  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.equal(models["renamed-model"].name, "User edited label");
  assert.deepEqual(models["renamed-model"].limit, { context: 100000 });
  assert.equal(models["gateway-named"].name, "Gateway name");
  assert.equal(models["unlabeled"].name, "unlabeled");
});

test("OpenCode config removes entries outside the catalogue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": { models: { "stray-null": null, "stray-string": "kept" } },
      },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "model", apis: ["chat_completions"] }],
    selected: "model",
  });

  assert.deepEqual(result.staleModels, []);
  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.equal(models["stray-null"], undefined);
  assert.equal(models["stray-string"], undefined);
  assert.deepEqual(models.model, { name: "model" });
});

test("OpenCode config removes old entries when the API omits capability metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": {
          models: {
            "current-model": { name: "Saved current label" },
            "retired-model": { name: "Retired model" },
          },
        },
      },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "current-model" }],
    selected: "current-model",
  });

  assert.deepEqual(result.staleModels, []);
  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.deepEqual(models["current-model"], { name: "Saved current label" });
  assert.equal(models["retired-model"], undefined);
});

test("OpenCode config routes each wire to its own provider without calling models retired", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": { models: { "messages-only": { name: "Messages only" } } },
      },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [
      { id: "messages-only", apis: ["chat_completions"] },
      { id: "chat-model", apis: ["chat_completions"] },
    ],
    selected: "chat-model",
  });

  // The gateway still serves both models; each wire just gets its own provider.
  assert.deepEqual(result.staleModels, []);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider["cli-hop"].models["chat-model"].name, "chat-model");
  assert.equal(config.model, "cli-hop/chat-model");
});

test("OpenCode config prefers the Anthropic provider ref for a messages-only selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");

  await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [
      { id: "claude-model", apis: ["messages"] },
      { id: "chat-model", apis: ["chat_completions"] },
    ],
    selected: "claude-model",
  });

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.model, "cli-hop/claude-model");
  assert.equal(config.small_model, "cli-hop/claude-model");
});

test("OpenCode config treats models without capability metadata as authoritative", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": {
          models: {
            "saved-a": { name: "A" },
            "saved-b": { name: "B" },
          },
        },
      },
    })
  );

  const result = await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "local-model" }],
    selected: "local-model",
  });

  assert.deepEqual(result.staleModels, []);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(config.provider["cli-hop"].models["saved-a"], undefined);
  assert.equal(config.provider["cli-hop"].models["saved-b"], undefined);
  assert.equal(config.provider["cli-hop"].models["local-model"].name, "local-model");
  assert.equal(config.model, "cli-hop/local-model");
  assert.equal(config.small_model, "cli-hop/local-model");
});

test("OpenCode config keeps a saved label when the gateway sends an empty displayName", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      provider: {
        "cli-hop": { models: { "blank-name": { name: "Saved label" } } },
      },
    })
  );

  await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "blank-name", displayName: "", apis: ["chat_completions"] }],
    selected: "blank-name",
  });

  const models = JSON.parse(await readFile(configPath, "utf8")).provider["cli-hop"].models;
  assert.equal(models["blank-name"].name, "Saved label");
});

test("OpenCode config keeps a pre-existing $schema value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-opencode-"));
  const configPath = join(directory, "opencode.json");
  await writeFile(
    configPath,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {},
    })
  );

  await new OpenCodeConfigService(configPath).apply({
    apiKey: "test-key",
    endpoint: "https://gateway.example.com",
    models: [{ id: "chat-model", apis: ["chat_completions"] }],
    selected: "chat-model",
  });

  assert.equal(
    (await readFile(configPath, "utf8")).includes("https://opencode.ai/config.json"),
    true
  );
  assert.equal(
    JSON.parse(await readFile(configPath, "utf8")).$schema,
    "https://opencode.ai/config.json"
  );
});
