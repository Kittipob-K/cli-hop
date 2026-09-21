import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensurePrerequisites } from "../dist/services/prereq.js";
import { SettingsService } from "../dist/services/settings.js";
import { handleSettingsAction } from "../dist/commands/settings.js";

/** Fake ask: records messages, returns scripted answers in order. */
function fakeAsk(answers) {
  const messages = [];
  const ask = async (options) => {
    messages.push(options.message);
    return answers.shift();
  };
  ask.messages = messages;
  return ask;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-prereq-"));
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, "settings.json");
  return { filePath, service: new SettingsService(filePath, { keychain: null }) };
}

test("ensurePrerequisites prompts only for missing values and persists them", async () => {
  const { service } = await fixture();
  const ask = fakeAsk(["https://custom.example.com/v1", "  ccsk-key  "]);

  const settings = await ensurePrerequisites(service, ask);

  assert.equal(ask.messages.length, 2);
  assert.equal(settings.baseUrl, "https://custom.example.com/v1");
  assert.equal(settings.apiKey, "ccsk-key");
  const onDisk = JSON.parse(await readFile(service.filePath, "utf8"));
  assert.equal(onDisk.baseUrl, "https://custom.example.com/v1");
  assert.equal(onDisk.apiKey, "ccsk-key");
});

test("ensurePrerequisites is a no-op when both values are already set", async () => {
  const { service } = await fixture();
  await service.save({ baseUrl: "https://x/v1", apiKey: "ccsk-key" });
  const ask = fakeAsk([]);

  const settings = await ensurePrerequisites(service, ask);

  assert.deepEqual(ask.messages, []);
  assert.equal(settings.apiKey, "ccsk-key");
});

test("an empty base URL answer keeps the default endpoint", async () => {
  const { service } = await fixture();
  const ask = fakeAsk(["", "ccsk-key"]);

  const settings = await ensurePrerequisites(service, ask);

  assert.equal(settings.baseUrl, "https://api.cli-hop.cc/v1");
});

test("handleSettingsAction stores the API key through a fake prompt", async () => {
  const { service } = await fixture();
  const result = await handleSettingsAction(
    { type: "apiKey" },
    service,
    undefined,
    {
      password: async () => "  ccsk-menu-key  ",
      input: async () => { throw new Error("not used"); },
      confirm: async () => { throw new Error("not used"); },
    }
  );

  assert.equal(result, "back");
  assert.equal((await service.load()).apiKey, "ccsk-menu-key");
});

test("handleSettingsAction saves the base URL without touching the key", async () => {
  const { service } = await fixture();
  await service.setApiKey("ccsk-key");
  const result = await handleSettingsAction(
    { type: "baseUrl" },
    service,
    undefined,
    {
      password: async () => { throw new Error("not used"); },
      input: async () => "https://menu.example.com/v1",
      confirm: async () => { throw new Error("not used"); },
    }
  );

  assert.equal(result, "back");
  const loaded = await service.load();
  assert.equal(loaded.baseUrl, "https://menu.example.com/v1");
  assert.equal(loaded.apiKey, "ccsk-key");
});

test("handleSettingsAction reset clears the key but keeps menu history", async () => {
  const { service } = await fixture();
  await service.setApiKey("ccsk-key");
  await service.save({ lastAgentId: "omp" });

  const result = await handleSettingsAction(
    { type: "reset" },
    service,
    undefined,
    {
      password: async () => { throw new Error("not used"); },
      input: async () => { throw new Error("not used"); },
      confirm: async () => true,
    }
  );

  assert.equal(result, "back");
  const onDisk = JSON.parse(await readFile(service.filePath, "utf8"));
  assert.equal(onDisk.apiKey, undefined);
  assert.equal(onDisk.lastAgentId, "omp");
});
