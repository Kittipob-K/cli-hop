import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SettingsService } from "../dist/services/settings.js";

/** In-memory Credential Store double matching services/keychain.ts Keychain. */
function fakeKeychain({ available = true } = {}) {
  const state = { secret: undefined };
  return {
    state,
    getPassword() {
      if (!available) throw new Error("keychain unreachable");
      return state.secret ?? null;
    },
    setPassword(secret) {
      if (!available) throw new Error("keychain unreachable");
      state.secret = secret;
    },
    deletePassword() {
      const had = state.secret !== undefined;
      state.secret = undefined;
      return had;
    },
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "cli-hop-store-"));
  const filePath = join(directory, "settings.json");
  await mkdir(directory, { recursive: true });
  return { filePath };
}

test("keychain wins on read and a file key migrates in on first load", async () => {
  const { filePath } = await fixture();
  await writeFile(filePath, JSON.stringify({ apiKey: "ccsk-old", baseUrl: "https://x/v1" }));

  const kc = fakeKeychain();
  const service = new SettingsService(filePath, { keychain: kc });

  const loaded = await service.load();
  assert.equal(loaded.apiKey, "ccsk-old");
  assert.equal(kc.state.secret, "ccsk-old");

  // The plaintext copy is gone from the file, baseUrl survives.
  const onDisk = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(onDisk.apiKey, undefined);
  assert.equal(onDisk.baseUrl, "https://x/v1");

  // Subsequent reads come from the keychain, even if a stale file key returns.
  kc.state.secret = "ccsk-new";
  await writeFile(filePath, JSON.stringify({ apiKey: "stale", baseUrl: "https://x/v1" }));
  assert.equal((await service.load()).apiKey, "ccsk-new");
});

test("setApiKey targets the keychain and save never writes a key into the file there", async () => {
  const { filePath } = await fixture();
  const kc = fakeKeychain();
  const service = new SettingsService(filePath, { keychain: kc });

  await service.setApiKey("ccsk-abc");
  assert.equal(kc.state.secret, "ccsk-abc");
  assert.equal(await service.setApiKey("ccsk-abc"), "keychain");
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).apiKey, undefined);

  // save() without a key must not destroy the stored key (only setApiKey clears).
  await service.save({ baseUrl: "https://y/v1" });
  assert.equal(kc.state.secret, "ccsk-abc");
  assert.equal((await service.load()).apiKey, "ccsk-abc");

  await service.setApiKey(undefined);
  assert.equal(kc.state.secret, undefined);
  assert.equal((await service.load()).apiKey, undefined);
});

test("unreachable keychain degrades to the settings file without losing the key", async () => {
  const { filePath } = await fixture();
  const dead = fakeKeychain({ available: false });
  const service = new SettingsService(filePath, { keychain: dead });

  await service.setApiKey("ccsk-file-only");
  assert.equal(await service.setApiKey("ccsk-file-only"), "file");
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).apiKey, "ccsk-file-only");
  assert.equal((await service.load()).apiKey, "ccsk-file-only");
});
