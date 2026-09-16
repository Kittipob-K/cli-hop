# Agent Configs as the credential delivery channel

Status: ready-for-agent

## Problem Statement

Every agent launch currently depends on cli-hop: the Primary API Key is
delivered to the child process at spawn time via environment variables
(`prepareEnv`/`apiKeyEnvVars`), so `claude`, `codex`, `omp`, `pi` etc. only
work while cli-hop is in the loop. Launching an agent directly (e.g. `claude
-p "Reply only with OK"`) either fails or silently uses a different
credential. Aider has no persistent config at all and only works through
cli-hop's env injection. Some agent configs (omp, pi, opencode) store an
environment-variable *reference* instead of the key itself, so they too
depend on cli-hop exporting the variable every launch.

## Solution

The Primary API Key and endpoint are written into each agent's own Agent
Config (0600) so every supported agent works standalone without the wrapper.
`cli-hop run` stops injecting environment variables — it only unsets
inherited credentials before spawning, and the Agent Config is the sole
delivery channel. A new Settings action (Resync) rewrites existing Agent
Configs after the key or base URL changes. Aider is removed from the project
because it has no supported persistent key+endpoint config.

## User Stories

1. As a user who configured claude-code through cli-hop once, I want to run `claude -p "Reply only with OK"` directly, so that I can use Claude Code without launching it through cli-hop every time.
2. As a user who configured codex through cli-hop once, I want to run `codex` directly with the CLI Hop key, so that Codex works standalone.
3. As a user who configured grok through cli-hop once, I want to run `grok` directly with the CLI Hop key, so that Grok Build works standalone.
4. As a user who configured omp through cli-hop once, I want to run `omp` directly with the CLI Hop key, so that Oh My Pi works standalone.
5. As a user who configured pi through cli-hop once, I want to run `pi` directly with the CLI Hop key, so that Pi works standalone.
6. As a user who configured opencode through cli-hop once, I want to run `opencode` directly with the CLI Hop key, so that OpenCode works standalone.
7. As a user, I want every agent's config to contain the actual key (not an env-var reference), so that no agent depends on cli-hop exporting an environment variable at launch.
8. As a user who runs `cli-hop run -a claude-code`, I want the launched agent to receive a clean environment with inherited Anthropic/OpenAI/CLI Hop proxy credentials unset, so that the child process never sees inherited credentials that could override its Agent Config.
9. As a user who changes their key or base URL in Settings, I want a Resync action that rewrites every installed agent's existing config with the new credential, so that standalone agents keep working after a rotation.
10. As a user who has not installed a particular agent, I want Resync to skip it, so that cli-hop does not create config files for tools I do not have.
11. As a user whose agent config already exists, I want Resync to preserve that agent's selected model while refreshing the credential, so that my model choice is not reset.
12. As a user who has a config written by an older cli-hop version (env-reference style), I want launching the agent through cli-hop to rewrite it with the literal key, so that stale references never survive.
13. As a developer, I want `apiKeyEnvVars`, `baseUrlEnvVars`, and `prepareEnv` removed, so that there is no dead env-injection code path left behind.
14. As a developer, I want aider removed from the registry, install specs, README, tests, and docs, so that the project does not claim support for an agent that cannot be made standalone.
15. As a developer, I want the registry to keep `envToUnset`/`applyUnset`, so that inherited proxy credentials are still cleared before spawn.
16. As a user, I want config files written by cli-hop to stay owner-only (0600), so that the key copy on disk is not exposed to other users.
17. As a developer, I want the opencode config to be migrated from the stashed WIP (literal key) rather than rewritten from scratch, so that existing work is reused.
18. As a user, I want a non-intrusive `cli-hop check` to keep reporting gateway status, so that I can verify connectivity without triggering any config rewrite.
19. As a user, I want key rotation to reach all installed agents' configs without me remembering which agents I configured, so that standalone agents never run with a dead key.
20. As a user who edits their agent config manually, I want Resync to preserve my model selection but still refresh the credential fields, so that manual model choices are respected.

## Implementation Decisions

### A. Registry and launch contract

- The `Agent` type drops `apiKeyEnvVars` and `baseUrlEnvVars`; `apiKeyEnvVarsFor` and `baseUrlEnvVarsFor` are removed.
- `AgentService.prepareEnv` is removed. The launch env is built by cloning `process.env` and applying `applyUnset` only — no values are injected. `agent.envToUnset` and the shared `GATEWAY_CREDENTIAL_ENV_KEYS` stay.
- `RunOptions.apiKey`/`baseUrl` no longer drive env construction; they remain only where the launch flow still needs them for prepare input. `customize.ts`'s display of injected env vars is removed or replaced with a note that credentials live in the Agent Config.
- Aider is removed from `CUSTOMIZABLE_AGENTS` and from `AGENT_INSTALL_SPECS`; the `OPENAI_COMPATIBLE_ENV_KEYS` handling that only aider used is reviewed (kept only if still referenced).

### B. Per-agent config writers (literal keys)

- **omp** (`OmpConfigService`): write the literal API key as `providers.cli-hop.apiKey` (currently `CLI_HOP_API_KEY` env name). Input gains `apiKey`.
- **pi** (`PiConfigService`): write the literal API key as `providers.cli-hop.apiKey` (currently `$CLI_HOP_API_KEY`). Input gains `apiKey`.
- **opencode** (`OpenCodeConfigService`): adopt the stashed WIP — write the literal key into the provider options instead of `{env:CLI_HOP_API_KEY}`.
- **codex** (`CodexConfigService`): keep `auth.json` (already carries the key) but remove the launch-time `-c model_providers.cli-hop.env_key="CLI_HOP_API_KEY"` overrides that depend on an env var.
- **claude-code**, **grok**: already write the literal key; no writer change.
- Before committing to literal keys for omp/pi, verify against each agent's resolution logic that a plain string is used as the literal secret. If either agent resolves a bare value as an env-var name, fall back to writing a managed `.env` file in that agent's config dir (still 0600). This fallback is documented in ADR 0003.

### C. Resync action in Settings

- New Settings action "Resync agent configs" in the existing settings menu.
- Resync iterates registered agents and rewrites only those that are **installed** (`isInstalled`) **and already have a config file on disk**.
- For each agent, the model is read from its existing Agent Config; if the config is missing or the model cannot be read, fall back to the first model the agent supports from the fetched catalogue (remote, else local pools).
- It reuses each agent's `prepare` writer with the current Settings values (key, endpoint) — no new writer logic.
- The rewritten files are reported with the same `ui.ok(filepath)` output as the launch flow.
- Failure of one agent's rewrite does not abort the rest (graceful degradation).

### D. Stale-reference migration

- Launching an agent through `cli-hop run`/customize always runs `prepare` before spawn (unchanged), so a config written by an older version with an env reference is rewritten with the literal key on the next launch. No separate migration pass.

## Testing Decisions

- **Good tests assert external behavior at the chosen seams, not internals**: what config bytes are written, what env a spawned child actually receives, and which files Resync reports — not which helper method was called.
- **Seam 1 — config writers** (`OmpConfigService`, `PiConfigService`, `OpenCodeConfigService`, `CodexConfigService` via `prepare`): unit tests assert the literal key appears in the written config and no `$CLI_HOP_API_KEY` / `{env:...}` reference survives. Prior art: `tests/grok-config.test.mjs`, `tests/claude-config.test.mjs`, `tests/config-security.test.mjs`.
- **Seam 2 — launch plan** (`AgentService`): unit tests assert `createLaunchPlan` produces an env that contains no injected key/base-url vars and that `applyUnset` still removes inherited credentials. Prior art: `tests/agent-launch.test.mjs`.
- **Seam 3 — settings menu** (`handleSettingsAction`): unit tests drive Resync with a fake settings service / temp dirs and assert only installed-with-existing-config agents are rewritten and that their model survives. Prior art: `tests/config-security.test.mjs` (fake keychain pattern) and `tests/credential-store.test.mjs`.
- **E2E**: extend `tests/cli-e2e.test.mjs` — stub agents capture the child env to prove no `ANTHROPIC_API_KEY`/`CLI_HOP_API_KEY` is injected while the literal key lands in the config; the aider stub and its test are deleted.
- **Removal**: `tests/installer.test.mjs` and `tests/registry.test.mjs` are updated to reflect the smaller agent set; references to aider anywhere in `tests/` are deleted.

## Out of Scope

- Per-agent keys (the Primary API Key remains one key for all agents).
- Encrypting Agent Configs at rest (0600 file permissions remain the protection; ADR 0001 documents the accepted plaintext copies).
- Aider: any attempt to add a persistent config writer for it — it is removed, not fixed.
- Changing the Credential Store / Settings File layout or keychain behavior.
- `cli-hop check` behavior (unchanged, existing).
- The shell-rc scrub flow (unchanged, existing).

## Further Notes

- ADR 0003 (`docs/adr/0003-config-as-delivery-channel.md`) records the decision and its consequences; ADR 0001's consequences were updated to reference it.
- `CONTEXT.md` now defines the Primary API Key as delivered "through each Agent Config" and the Agent Config as the "sole delivery channel … never bypassed by launch-time environment variables".
- `AGENTS.md` invariants 1 and 2 were rewritten to "Unset before export" and "One key, delivered via each Agent Config"; the "Adding a new agent CLI" checklist now requires a `prepare` config writer (ADR 0003).
- A stashed WIP (`git stash` on `main`) contains the opencode literal-key change; the spec treats it as the starting point for that adapter rather than discarding it.
- The grill that produced this spec settled: Q1/Q2 = stop env injection; Q4 = one primary key for all agents; Q5 = adopt opencode WIP; Q6 = literal keys for omp/pi; Q7/Q12 = remove aider; Q8 = drop codex `-c env_key`; Q9 = delete dead env code; Q10/Q13/Q14 = Resync (installed ∩ existing config, preserve model).