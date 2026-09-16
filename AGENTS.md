# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

`cli-hop` is a TypeScript ESM CLI (binary: **`cli-hop`**) that
switches AI pools/models and configures agent CLIs to
use the CLI Hop gateway with one primary API key. See `README.md` for
user-facing docs.

## Commands

```bash
npm run build        # tsc -> dist/ (ESM)
npx tsc --noEmit     # typecheck only
npm test             # build + node:test unit/config/E2E suite
npm run dev          # run via tsx without building
node dist/index.js   # built CLI; `cli-hop` = npm link global
```

- Node.js **>= 22** required (`Promise.withResolvers` is used).
- Tests use the built-in `node:test` runner (see Testing below).

## Architecture

```bash
src/
  index.ts              commander program; no-args entry -> customize flow
  types.ts              shared types, protocols, launch/config contracts
  ui.ts                 semantic CLI output primitives (r-lib cli style)
  prompts/section-tabs.ts custom interactive AGENTS | SETTINGS tab/list prompt
  commands/
    customize.ts        default tabbed flow (agent -> fetch models -> launch)
    settings.ts         API key / base URL / reset actions + `cli-hop settings`
    run.ts              non-interactive launch: cli-hop run [-p pool] [-m model] [-- args]
    list.ts             model list (remote, --local fallback)
    check.ts            `cli-hop check` non-intrusive gateway health check
    update.ts           `--update` self-update flow + passive "update available" notice
  services/
    settings.ts         SettingsService: Credential Store — keychain-first API key, base URL,
                        last-used agent + ~/.config/cli-hop/settings.json
    keychain.ts         openKeychain(): OS keychain entry (service cli-hop, account = username); null when unavailable/disabled
    prereq.ts           ensurePrerequisites(): inline prompts for missing baseUrl/apiKey
    pool.ts             PoolService: local pools + CLI Hop /models API (Bearer, pagination)
    launch.ts           LaunchCoordinator: shared pool selection, compatibility,
                        config preparation, and agent launch policy
    update.ts           npm registry check (24h cache file), semver compare, `npm install -g` spawn
    agent.ts            AgentService: prepare launch plan, clean env, spawn agent
    config-document.ts  shared optional object-shaped JSON/JSONC config reader
    claude-config.ts    installer-parity writes of ~/.claude.json + ~/.claude/settings.json
    codex-config.ts     installer-parity ~/.codex config.toml (marker-managed regions),
                        cli-hop.config.toml profile, and auth.json (0600)
    grok-config.ts      merge-write ~/.grok/config.toml managed [model] block
                        (marker-delimited, key inline, responses wire)
    omp-config.ts       merge-write ~/.omp/agent/models.yml (per-model wire api
                        from CLI Hop /models capabilities)
    pi-config.ts        merge-write ~/.pi/agent/models.json
    opencode-config.ts  merge-write ~/.config/opencode/opencode.json (dual-wire:
                        cli-hop=anthropic, cli-hop-openai=openai-compatible,
                        model/small_model refs; migrates legacy single-provider
                        chat models)
    shell-scrub.ts      shared stale rc-export scrubber for installer parity
    secure-file.ts      atomic 0600 writes + managed-directory permissions
    installer.ts        isInstalled() PATH scan + AGENT_INSTALL_SPECS official
                        per-platform installers + ensureAgentInstalled() prompt
    resync.ts           ResyncService: rewrite installed agents' existing configs
                        with the current key/endpoint, preserving each model
    registry.ts         agent adapters: unset rules, protocols, args, config preparation
```

### Core invariants (do not break)

1. **Unset before export.** `AgentService.applyUnset()` removes inherited
   Anthropic/OpenAI/CLI Hop proxy credentials from `process.env` before any
   agent spawn. The child process must never see inherited proxy credentials;
   the key it needs comes from its own Agent Config, not the environment.
2. **One key, delivered via each Agent Config.** The primary API key is
   written into each agent's own config file (0600, ADR 0003) so agents run
   standalone without the wrapper. `cli-hop run` never injects env vars —
   it only unsets inherited credentials and spawns. Never hardcode agent env
   names in commands.
3. **Settings are the single source of truth.** Anything the flow needs
   (baseUrl, apiKey) must come from `SettingsService` (via
   `ensurePrerequisites` in interactive flows), never from `process.env`.
4. **Graceful degradation everywhere.** Models API failure -> local pools +
   `ui.warn`; missing settings -> prerequisite prompts; non-TTY -> static
   output, no spinner. Never crash the flow for an optional path.
5. **Spawn without shell.** `spawn(cmd, args, { shell: false })` — required for
   DEP0190 avoidance and correct arg passing.
6. **Interactive navigation stays consistent.** In the top-level tabbed menu,
   `←`/`→`/`Tab` switch sections, `↑`/`↓` move, `Enter` selects, and `Esc`
   goes back (or exits from AGENTS). Keep the last launched agent first with
   a `(latest)` label.

## Code style

- **Never import `chalk` directly in commands/services** — all terminal output
  goes through `src/ui.ts` semantic primitives (`ui.ok/info/warn/danger`,
  `ui.h1/h2`, `ui.dlRow`, `ui.envvar/url/val/filepath/dim`, `ui.Spinner`).
  This mirrors the r-lib "semantic CLI" article; ui.ts is the only place
  styling may live.
- Symbols must have ASCII fallback via `sym` (ui.ts); dynamic output must check
  `isDynamic()` before using `\r`.
- ESM imports with `.js` extension even for `.ts` files (`moduleResolution:
  bundler` handles it, keep consistency).
- `strict` TypeScript; no `any` in public signatures.

## Adding a new agent CLI

1. Add one `Agent` adapter to `CUSTOMIZABLE_AGENTS` in
   `src/services/registry.ts`: command, unset rules, supported protocols, model
   argument behavior, and the required `prepare` config writer. Every agent
   must have a config writer — launch-time env injection was removed (ADR 0003).
2. Do not add agent-specific branches to `run.ts` or `customize.ts`; shared
   pool, preparation, and launch policy belongs in `LaunchCoordinator`, while
   agent-specific behavior stays behind `AgentService` and registry adapters.
3. Add launch-plan/config tests plus an isolated E2E test using temporary
   HOME/XDG and a stub executable.

## Testing

Run `npm test`. E2E tests follow this recipe without touching the developer's
real config:

- Point settings elsewhere: `export XDG_CONFIG_HOME=$(mktemp -d)` **before**
  writing any test settings file (past mistake: a test seeded the real
  `~/.config/cli-hop/settings.json`).
- Set `CLI_HOP_DISABLE_KEYCHAIN=1` in any process that exercises settings —
  HOME/XDG redirection does **not** isolate the OS keychain, and tests must not
  touch (or prompt against) the developer's real one. Unit-test keychain
  behavior by passing a fake `{ keychain }` to `SettingsService`.
- Fake HOME + a stub `claude` shell script on `PATH` that echoes received
  env/args, to assert what the spawn actually gets.
- Mock the models API with a tiny `node:http` server on `localhost:9099`
  (Bearer-checked, 2 pages to exercise pagination).
- `tsx -e` fails in this repo (CJS eval context) — put scratch scripts in
  `/tmp` instead. `package.json` is type: module; plain `node -e` is CJS.
- Always finish with `npx tsc --noEmit` and `npm run build`.

## Repository notes

- Binary name is **`cli-hop`** everywhere (package.json `bin`, help text,
  docs). The old name `masp` must not reappear.
- Settings/config paths always honor `XDG_CONFIG_HOME` and are created `0700`
  / files `0600` (the fallback home for the API key; keychain-first per ADR 0001).
- `dist/`, `node_modules/`, `.recall/`, `.DS_Store` are git-ignored; don't
  commit build output.
- Conventional commits (`feat:` / `fix:` / `chore:`), small focused commits.

## Agent skills

### Issue tracker

Issues/specs live as markdown files under `.scratch/<feature>/` (local tracker). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map 1:1 to their label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
