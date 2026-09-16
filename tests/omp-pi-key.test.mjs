import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OmpConfigService } from "../dist/services/omp-config.js";
import { PiConfigService } from "../dist/services/pi-config.js";

const ENDPOINT = "https://gateway.example.com";
const API_KEY = "ccsk-literal-key-0001";
const MODELS = [{ id: "chat-model", apis: ["chat_completions"] }];

test("omp writes the literal key into models.yml (ADR 0003)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-omp-key-"));
  const modelsPath = join(directory, "agent", "models.yml");

  await new OmpConfigService(modelsPath).apply({
    apiKey: API_KEY,
    endpoint: ENDPOINT,
    models: MODELS,
    selected: "chat-model",
  });

  const raw = await readFile(modelsPath, "utf8");
  assert.equal(raw.includes(`apiKey: ${API_KEY}`), true);
  assert.equal(raw.includes("CLI_HOP_API_KEY"), false);
  assert.equal(raw.includes(`baseUrl: ${ENDPOINT}/v1`), true);
  assert.equal((await stat(modelsPath)).mode & 0o777, 0o600);
});

test("pi writes the literal key into models.json (ADR 0003)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-pi-key-"));
  const modelsPath = join(directory, "agent", "models.json");

  await new PiConfigService(modelsPath).apply({
    apiKey: API_KEY,
    endpoint: ENDPOINT,
    models: MODELS,
    selected: "chat-model",
  });

  const config = JSON.parse(await readFile(modelsPath, "utf8"));
  assert.equal(config.providers["cli-hop"].apiKey, API_KEY);
  assert.equal(JSON.stringify(config).includes("CLI_HOP_API_KEY"), false);
  assert.equal(config.providers["cli-hop"].baseUrl, `${ENDPOINT}/v1`);
  assert.equal((await stat(modelsPath)).mode & 0o777, 0o600);
});

test("omp merge keeps unrelated providers while writing the literal key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-omp-merge-"));
  const modelsPath = join(directory, "agent", "models.yml");
  await mkdir(join(directory, "agent"), { recursive: true });
  await writeFile(
    modelsPath,
    "providers:\n  existing:\n    baseUrl: https://existing.example.com\n"
  );

  await new OmpConfigService(modelsPath).apply({
    apiKey: API_KEY,
    endpoint: ENDPOINT,
    models: MODELS,
    selected: "chat-model",
  });

  const raw = await readFile(modelsPath, "utf8");
  assert.equal(raw.includes("existing.example.com"), true);
  assert.equal(raw.includes(`apiKey: ${API_KEY}`), true);
});