# Keychain-first Credential Store with Settings File fallback

The Primary API Key lived as plaintext in `settings.json` and was copied by
`claude-config` into Claude's own config. We decided the key moves to the OS
keychain — accessed cross-platform via `@napi-rs/keyring` (macOS/Linux/Windows
all have real users), with the existing 0600 Settings File kept as an automatic
fallback when no keychain is usable. Reads check keychain first; if the keychain
is empty but the Settings File holds a key, the first read migrates it into the
keychain and removes it from the file (no migration script).

## Considered Options

- **macOS-only `/usr/bin/security` CLI shell-out** — zero new deps, but ruled
  out by the cross-OS requirement.
- **`keytar`** — archived upstream; `@napi-rs/keyring` ships prebuilt binaries
  per platform without node-gyp.
- **Fail hard when no keychain** — rejected; headless Linux/CI/Docker is a
  supported state and the file fallback already works there.
- **File-wins on conflict** — rejected; it would let a plaintext key re-establish
  itself permanently via synced dotfiles.

## Consequences

- "No plaintext secrets anywhere" was deliberately **not** achieved: Agent
  Configs (e.g. `~/.claude/settings.json`, 0600) still carry a derived copy so
  that launching the agent directly keeps working — installer parity is a
  product promise. The store is the single *input*, not the single copy. As of
  ADR 0003 the Agent Config is the *only* delivery channel (no launch-time env
  injection).
- Error handling degrades rather than dead-ends: if the keychain cannot be
  reached or read (macOS access prompt denied — unsigned `node` gets prompted
  for items it didn't create), reads fall back to the Settings File, and writes
  land in the file with the post-save message naming where the key actually
  went. The save flow carries the guidance: "If macOS asks about keychain
  access, choose Always Allow." The known rare cost: a *migrated* key whose
  access is denied reads as unset and the user is prompted to re-enter it
  (which then stores in the file).
- Ordinary `save()` calls never delete a keychain item — clearing the key is
  an explicit `setApiKey(undefined)`, so a transient keychain failure cannot
  wipe the key through an unrelated settings write.
- Keychain item identity: service `cli-hop`, account = login username.
- Key rotation propagates to Agent Configs on the next wrapper launch (that
  flow already re-applies them) or via the Settings Resync action (ADR 0003);
  the post-save message tells the user to run `cli-hop <agent>` once after
  changing the key.
