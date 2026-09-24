# Build Prompt: `cli-hop` — AI Gateway Pool Switcher & Agent Launcher

> **For the receiving agent:** This document is a self-contained specification.
> Implement `cli-hop` from scratch as described below — do not invent behavior,
> do not skip the invariants, and verify with the test workflow in §13.
> If anything is ambiguous, prefer the explicit detail in this document over
> guesswork, and call out the ambiguity in your final report.

---

## 0. Mission

Build a production-quality **Node.js CLI** named **`cli-hop`** whose job is:

1. Let a user pick an **AI agent CLI** (Claude Code, Oh My Pi, Pi, OpenCode,
   Codex CLI, Grok Build) and a **model/pool** from an AI gateway ("CLI Hop")
   catalogue.
2. **Write that gateway's API key + endpoint into the chosen agent's own config
   file** (0600 permissions) so the agent runs *standalone* — no wrapper needed,
   no environment injection at launch time.
3. **Launch the agent** with a deliberately cleaned environment (inherited AI
   provider credentials are unset first).
4. Do all of this through a polished **interactive tabbed menu** by default,
   with equivalent non-interactive commands for scripting.

The tool must be installable globally (`npm install -g cli-hop`), expose a
`cli-hop` binary, and degrade gracefully everywhere (offline, missing config,
non-TTY, missing agents).

---

## 1. Product behavior (what the user experiences)

### 1.1 Default flow — `cli-hop` (no arguments)

Opens a terminal UI with two tabs: `AGENTS` and `SETTINGS`.

- **Navigation:** `←` / `→` / `Tab` switch tabs (the list swaps instantly),
  `↑` / `↓` move the cursor, `Enter` activates the highlighted row,
  `Esc` goes back (from SETTINGS it returns to AGENTS; from AGENTS it exits
  the CLI).
- **AGENTS tab** lists the six agent CLIs. The most recently launched agent
  is moved to the top and labeled `(latest)`.
- **SETTINGS tab** lists actions:
  - `API Key: <masked>` → change the primary API key (hidden input)
  - `Base URL: <url>` → change the base URL
  - `Resync agent configs` → rewrite key/endpoint into every installed agent
    config, preserving each agent's chosen model
  - `Reset API key and Base URL` → confirm, clear both (keeps `lastAgentId`)
  - Entering Settings must never force the credentials prompt — credentials
    are only prompted when an agent is actually being launched.

Selecting an agent starts the **customize flow** (below).

### 1.2 The customize flow (shared by default menu and `cli-hop customize`)

Order matters; keep it exactly:

1. Print the logo.
2. Enter the tabbed menu loop.
3. On agent selection, run the **prerequisite check**: if `baseUrl` or
   `apiKey` is not configured, prompt inline right there
   ("next best step" style — base URL is a normal input defaulting to
   `https://api.cli-hop.cc/v1`, API key is a hidden input), then persist to
   Settings immediately.
4. Print `Customizing <agent name>`.
5. **Install check**: if the agent binary is not on `PATH`, offer to run the
   agent's *official* installer for the current platform (see §7.12). Decline,
   non-TTY, or failure → print the docs URL and go back; never crash.
6. **Unset** inherited credential env vars for this agent (see §7.8) and print
   the names that were actually removed (or a muted "no env vars to unset").
7. Print a muted note: credentials are delivered via the agent's config — no
   env export.
8. **Fetch models** from the gateway API with a spinner.
   - Success → `✔ N models loaded from API`
   - API rejected the key / offline → warning + fall back to local pools
   - No key configured → warning + local pools
9. **Filter** pools to those compatible with the agent's wire protocol
   (see §7.7). If none remain → `✖ No available ... models support <agent>` and
   return to the menu.
10. Let the user pick a model/pool (inquirer select; rows show
    `<display name> (<model id>)`).
11. Print `Configuring <agent> → <endpoint> (<model>)`.
12. **Write the agent config** (see §7.10) and print each file written.
13. Optionally offer to **scrub stale credential exports** from shell rc files
    (only for agents that support it; default answer: no).
14. Save `lastAgentId` to Settings.
15. Print `🚀 Starting <agent> with model <model>` and **launch** with cleaned
    env, inheriting stdio. The CLI process exits with the agent's exit code.

### 1.3 Non-interactive commands

```bash
cli-hop run -a <agent> [-p <pool>] [-m <model>] [-- args...]
#   -a, --agent <id>   claude-code | omp | pi | opencode | codex | grok
#   -p, --pool <id>    skip the pool picker
#   -m, --model <id>   override the pool's model
#   args...            forwarded verbatim to the agent CLI

cli-hop list                # models from the gateway API
cli-hop list --local        # built-in local pools only

cli-hop check               # non-intrusive gateway health check (see §8.5)

cli-hop settings            # SETTINGS menu only (same tabbed UI)

cli-hop customize           # same as the default no-arg flow

cli-hop --update            # check npm registry + npm install -g
cli-hop update              # alias
cli-hop --version
```

`cli-hop run` behaves like the interactive flow minus the menu:
prerequisites → install check (for an explicitly requested agent) → fetch
pools → pick pool (prompt if not given) → pick agent (prompt if pool supports
several) → validate model/agent compatibility → write config → launch.

### 1.4 Passive update notice

On startup (except `update` invocations), check the npm registry at most once
per 24h (cache in the settings dir). If a newer version exists, print a
one-line `Update available` notice. Never block, never fail the flow.
`CLI_HOP_NO_UPDATE_CHECK=1` disables the passive check.

---

## 2. Non-negotiable invariants

These are the design's backbone. Every implementation decision must respect
them; the test suite must assert them.

1. **Unset before export.** Before any agent spawn, remove all inherited
   Anthropic / OpenAI / CLI Hop proxy credentials from `process.env`
   (`ANTHROPIC_*`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_TOKEN`,
   `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `OPENAI_API_BASE`,
   `OPENAI_BASE_URL`, `CLI_HOP_API_KEY`, plus per-agent variables). The child
   process must never see inherited proxy credentials; its key comes from its
   own Agent Config, not the environment.
2. **One key, delivered via each Agent Config.** The primary API key is written
   literally into each agent's own config file (0600) so agents run standalone
   without the wrapper. `cli-hop run` **never injects env vars** — it only
   unsets inherited credentials and spawns. Never hardcode agent env names in
   spawn commands.
3. **Settings are the single source of truth.** Anything the flow needs
   (`baseUrl`, `apiKey`) comes from `SettingsService` (via
   `ensurePrerequisites` in interactive flows), never from `process.env`.
4. **Graceful degradation everywhere.** Models API failure → local pools +
   warning; missing settings → prerequisite prompts; non-TTY → static output,
   no spinner; missing agent binary → install offer then docs URL. Never crash
   the flow for an optional path.
5. **Spawn without shell.** Every child process uses
   `spawn(cmd, args, { shell: false })` (avoid DEP0190, keep argv correct).
   Official install one-liners such as `curl ... | bash` are executed by
   spawning the interpreter with `["-c", <verbatim command>]` — never by
   interpolating user input into a shell string.
6. **Consistent interactive navigation.** Tabs swap lists instantly; `Esc`
   goes back (SETTINGS → AGENTS) or exits (AGENTS); the last launched agent
   stays first with `(latest)`.

---

## 3. Tech stack & constraints

- **Node.js >= 24** (you may use `Promise.withResolvers`).
- **TypeScript, strict mode**, compiled to **ESM** (`"type": "module"`,
  `moduleResolution: "bundler"`). Imports use `.js` extensions even for
  `.ts` files.
- No `any` in public signatures.
- Allowed runtime deps: `commander` (CLI parsing), `@inquirer/prompts`
  (interactive prompts), `@napi-rs/keyring` (OS keychain),
  `chalk` (colors — imported ONLY by `ui.ts`), `yaml` (for Oh My Pi's
  `models.yml`).
- Dev deps: `typescript`, `tsx`, `@types/node`.
- Binary name is exactly **`cli-hop`** everywhere (`package.json` `bin`,
  help text, docs). The old/working name `masp` must never appear.
- `package.json` scripts: `build` (tsc), `dev` (tsx src/index.ts),
  `test` (`npm run build && node --test tests/*.test.mjs`),
  `typecheck` (`tsc --noEmit`).

---

## 4. Source layout

```
src/
  index.ts                  commander program; no-arg entry -> customize flow
  types.ts                  shared types, env-key constants, contracts
  ui.ts                     semantic CLI output primitives (the ONLY file
                            allowed to import chalk)
  prompts/section-tabs.ts   custom AGENTS | SETTINGS tab/list prompt
  commands/
    customize.ts            default tabbed flow (agent -> fetch models -> launch)
    settings.ts             API key / base URL / reset / resync actions
    run.ts                  non-interactive launch
    list.ts                 model list (remote, --local fallback)
    check.ts                gateway health check
    update.ts               self-update + passive notice
  services/
    settings.ts             SettingsService (keychain-first credential store)
    keychain.ts             openKeychain(): OS keychain entry or null
    prereq.ts               ensurePrerequisites(): inline prompts for missing
                            baseUrl / apiKey
    pool.ts                 PoolService: local pools + gateway /models fetch
    launch.ts               LaunchCoordinator: shared selection/prepare/launch
    agent.ts                AgentService: clean env, build args, spawn
    registry.ts             agent adapters (the only agent-specific file)
    endpoint.ts             endpointFromModelsBaseUrl()
    config-document.ts      shared JSON/JSONC reader (object-shaped)
    claude-config.ts        Claude Code config writer
    codex-config.ts         Codex config writer
    grok-config.ts          Grok Build config writer
    omp-config.ts           Oh My Pi config writer
    pi-config.ts            Pi config writer
    opencode-config.ts      OpenCode config writer
    shell-scrub.ts          rc-file export scrubber
    secure-file.ts          atomic 0600 writes, managed-dir 0700
    installer.ts            PATH scan, official per-platform installers
    resync.ts               rewrite installed agents' configs with current
                            key/endpoint, preserving each model
    update.ts               npm registry check + semver + self-update
tests/                      node:test suite (see §12)
```

---

## 5. Shared types (contracts)

```ts
type WireProtocol =
  | "messages" | "chat_completions" | "responses"
  | "generateContent" | "streamGenerateContent" | "countTokens";

interface Agent {
  id: string;                    // "claude-code" | "omp" | "pi" | "opencode" | "codex" | "grok"
  name: string;                  // human name
  command: string;               // binary on PATH
  args?: string[];
  envToUnset?: readonly string[];         // extra env vars wiped before spawn
  modelPrefix?: string;                   // e.g. "cli-hop/" for omp/pi
  supportedProtocols: readonly WireProtocol[];
  buildArgs?: (options: RunOptions) => string[];   // per-agent override
  probeConfig?: () => Promise<ConfigProbe>;        // read current model (Resync)
  prepare?: (input: AgentPreparationInput) => Promise<string[]>;  // config writer
  scrubShellConfig?: () => Promise<string[]>;      // rc scrubbing (optional)
  installUrl?: string;                            // docs URL fallback
}

interface ConfigProbe { exists: boolean; model?: string; }
interface Settings { apiKey?: string; baseUrl?: string; lastAgentId?: string; }
interface RemoteModel { id: string; displayName?: string; type?: string; apis?: WireProtocol[]; }
interface RunOptions { pool?: string; model?: string; args?: string[]; }
interface LaunchPlan { command: string; args: string[]; env: NodeJS.ProcessEnv; }
interface AgentPreparationInput { apiKey: string; endpoint: string; models: RemoteModel[]; selected: string; }
interface Pool { id: string; name: string; model: string; agents: Agent[]; }
```

**Env-var key groups** (module constants in `types.ts`, used by every adapter):

- `CLAUDE_CODE_ENV_KEYS` = `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`
- `OMP_ENV_KEYS` = Claude keys + `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`,
  `OMP_PROFILE`, `PI_PROFILE`
- `PI_ENV_KEYS` = Claude keys + `CLI_HOP_API_KEY`, `PI_CODING_AGENT_DIR`
- `OPENAI_COMPATIBLE_ENV_KEYS` = `OPENAI_API_KEY`, `OPENAI_API_BASE`,
  `OPENAI_BASE_URL`
- `CODEX_ENV_KEYS` = `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`
- `GROK_ENV_KEYS` = `GROK_HOME`
- `GATEWAY_CREDENTIAL_ENV_KEYS` = Claude keys + OpenAI-compatible keys +
  `CLI_HOP_API_KEY`

**Default endpoint:** `DEFAULT_MODELS_BASE_URL = "https://api.cli-hop.cc/v1"`.

---

## 6. UI module (`ui.ts`) — r-lib "semantic CLI" style

All terminal output flows through these primitives; raw `chalk` is banned
outside this file. Style decisions live here alone (like HTML vs CSS).

- **Symbols with ASCII fallback** (`sym`): `✔`→`v`, `✖`→`x`, `!`, `ℹ`→`i`,
  `→`->`->`, `❯`->`>`, `•`->`*`, `─`->`-`, `…`->`...` — chosen by a UTF-8
  detection (Windows: `WT_SESSION`/`MSYSTEM`/LC vars).
- **Alerts:** `ui.ok` (green ✔), `ui.info` (cyan ℹ), `ui.warn` (yellow !),
  `ui.danger` (red ✖ → stderr), `ui.muted` (gray). Format:
  `<symbol> <message>`.
- **Headings:** `ui.h1` / `ui.h2` / `ui.h3` — padded cyan rules sized to
  terminal width (default 80 when unknown).
- **Lists/rows:** `ui.li`, `ui.dlRow(term, value)` with aligned term column,
  `ui.blank`, `ui.text`.
- **Inline markup:** `ui.code` (bold), `ui.envvar` (yellow),
  `ui.filepath` (underline), `ui.url` (blue underline), `ui.dim`,
  `ui.strong`, `ui.val` (cyan).
- **`ui.logo()`** — the ASCII-art logo (or a one-line fallback when the
  terminal is narrower than the art). Run before the menu.
- **`ui.Spinner`** — single-line status spinner. UTF-8: dot frames
  `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`; ASCII: `|/-\`. **No-op animation on non-TTY/CI** —
  prints one static line instead (`… <text>`) and never uses `\r` or
  `\x1b[K` unless `isDynamic()` (TTY and not CI).
- **`ui.tabBar(active)` / `ui.tabs(active)`** — compact tab bar,
  active tab rendered `[ AGENTS ]` in bright cyan, inactive gray.

---

## 7. Service specs

### 7.1 `settings.ts` — SettingsService (keychain-first, ADR 0001)

Non-secret settings live in
`${XDG_CONFIG_HOME:-~/.config}/cli-hop/settings.json` (created 0600; parent
dir 0700). The **API key lives in the OS keychain** when one is usable
(@napi-rs/keyring: service `cli-hop`, account = login username) and in the
settings file otherwise.

- `load()`: read file; if a keychain is available, read the key from the
  keychain and merge it over the file (keychain wins). If the keychain is
  empty but the file holds a key, **auto-migrate** the key into the keychain
  on first read and remove it from the file (no migration script). If the
  keychain exists but is unreadable (macOS permission prompt declined, locked
  wallet), degrade to the file — never dead-end.
- `setApiKey(key?)`: persist a new key — to the keychain if usable (removing
  the file copy), else to the file. `undefined` clears it from both locations.
  On keychain write failure, fall back to the file (the key is never lost).
  Returns where the key was actually stored (`"keychain" | "file" | "none"`).
- `save(settings)`: persist non-secret settings. **A save without a key must
  NEVER delete an existing keychain item** — that is `setApiKey(undefined)`'s
  job — so a transient keychain failure can't wipe the user's key. Returns
  where the key landed, for the post-save message ("Saved to the OS keychain."
  / `Saved to <path>`) — no out-of-band mutable field.
- `maskKey(key)`: show `first4…last4` (e.g. `ccsk…26f3`); never print the key.
- Constructor accepts an injectable `{ keychain }` for unit tests.
- `CLI_HOP_DISABLE_KEYCHAIN=1` forces file-only storage.
- `keychain.ts` exports `openKeychain()` returning a minimal
  `{ getPassword, setPassword, deletePassword }` or `null` when unavailable.

### 7.2 `prereq.ts` — ensurePrerequisites(settingsService, ask?)

If `baseUrl` is missing → info line + prompt (`CLI_HOP_BASE_URL =`, default
the gateway URL, validate as URL). If `apiKey` is missing → info line + hidden
password prompt (`CLI_HOP_API_KEY =`, must be non-empty) with a muted hint
showing the dashboard URL to create a key. Save to settings when anything
changed; report where the key was stored. Return settings guaranteed to have
both fields. The prompt function (`ask`) is injectable so the decision logic
is unit-testable without a TTY.

### 7.3 `pool.ts` — PoolService

- **Built-in local pools** (fallback): `claude-default` → model
  `claude-sonnet-4-20250514` covering `messages` agents; `claude-fast` → model
  `claude-haiku-3` covering `messages` agents.
- `fetchRemoteModels(apiKey, baseUrl, signal?)`: GET `{baseUrl}/models`
  (normalize trailing slashes) with headers
  `Authorization: Bearer <key>` and `anthropic-version: 2023-06-01`,
  AbortSignal timeout ~10s. Follow **cursor pagination**:
  response `{ data: [{id, display_name, type}], first_id, last_id, has_more,
  "cli-hop": { capabilities, models: { <protocol>: [<ids>] } } }`; loop while
  `has_more && last_id`, sending `after_id`; guard against repeated cursors.
  Invert the `cli-hop.models` map to attach each model's `apis` (only the six
  known `WireProtocol` values count). Throw on non-2xx (with status attached),
  invalid JSON, repeated cursor, or malformed entries.
- Error messages: 401 → `Models API returned 401 … — check your API key in
  Settings`; 402 → `… — insufficient credits`.
- `resolvePools({apiKey, baseUrl, onProgress})`: **never throws**. No key →
  local pools. API success → pools built from remote models (`remote:<id>`
  ids; agents filtered by protocol intersection — see §7.4). API failure or
  empty result → local pools + `error` string for the caller to warn about.

### 7.4 Protocol-aware model selection (ADR 0002)

- `agentSupportsModel(agent, model)`: if the model advertises no `apis`
  (metadata absent), it remains eligible for every agent — degraded fallback,
  warn because capabilities may be incomplete. If it advertises any, the agent
  must share at least one protocol.
- Agent protocol sets: Claude Code → `messages`; Codex → `responses`;
  Oh My Pi, Pi, OpenCode, Grok Build → `chat_completions`.
- Generated agent configs treat the current catalogue as **authoritative**:
  entries no longer present are removed from generated catalogues (even when
  current metadata is absent), and persisted display labels for models still
  present are preserved.

### 7.5 `launch.ts` — LaunchCoordinator

Shared policy for interactive and `run` flows: `resolvePools(settings)`,
`compatiblePools(pools, agent)`, `endpointFor(settings)` (the single endpoint
derivation point — commands never compute it themselves), `prepare(request)`
(strips a trailing `/v1` from the endpoint, then runs the agent's `prepare`
config writer), `runPrepared(agent, prepared)` (delegates to AgentService and
returns the exit code), and `compatibilityProblem(agent, pool, model, models?)`
— the one selection-validation policy: the pool's protocol fit applies to its
default model; an explicit `-m` override is validated against the catalogue
and the model's own capabilities (skipped when only pool data is available,
i.e. Models API down). No agent-specific branches live here.

### 7.6 `agent.ts` — AgentService

- `cleanEnv(agent)`: the inherited env minus
  `GATEWAY_CREDENTIAL_ENV_KEYS` and the agent's `envToUnset`. Nothing is
  injected.
- `getUnsetVars(agent)` / `applyUnset(agent)`: report / actually remove those
  variables from `process.env` (perform the `unset` for real, so later steps
  and spawned children see a clean world). Used by the interactive flow before
  anything else touches the agent.
- `createLaunchPlan(agent, options)`: command = agent.command; args via
  `buildArgs` (default: `args` then `--model <modelPrefix + model>`
  if a model is set, then extra args; per-agent override allowed); env as
  above.
- `run(agent, options)`: `spawn(plan.command, plan.args, { stdio: "inherit",
  shell: false, env: plan.env })`; resolve with the child's exit code; on
  `ENOENT` reject with a helpful message naming the agent and its docs URL.

### 7.7 `registry.ts` — the agent adapters

Exactly six agents. All agent-specific behavior (unset rules, protocols,
model arg construction, config writing) lives here or behind these adapters —
never inside `run.ts`/`customize.ts`. `listAgentOptions(lastAgentId)` puts
the `(latest)` agent first.

| id | name | command | envToUnset (extra) | protocol | --model | modelPrefix |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | `claude` | — | `messages` | `--model <model>` | — |
| `omp` | Oh My Pi | `omp` | `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`, `OMP_PROFILE`, `PI_PROFILE` | `chat_completions` | `--model cli-hop/<model>` | `cli-hop/` |
| `pi` | Pi | `pi` | `CLI_HOP_API_KEY`, `PI_CODING_AGENT_DIR` | `chat_completions` | `--model cli-hop/<model>` | `cli-hop/` |
| `opencode` | OpenCode | `opencode` | `CLI_HOP_API_KEY`, `OPENAI_API_KEY`, `OPENAI_API_BASE`, `OPENAI_BASE_URL` | `chat_completions` | `--model cli-hop/<model>` | `cli-hop/` |
| `codex` | Codex CLI | `codex` | `CLI_HOP_API_KEY`, `OPENAI_API_KEY`, `OPENAI_API_BASE`, `OPENAI_BASE_URL`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN` | `responses` | `--model <model>` | — |
| `grok` | Grok Build | `grok` | `GROK_HOME` | `chat_completions` | none (config pins model) | — |

Special arg-building:
- **opencode**: when extra args are passed, insert the `run` subcommand first
  (`opencode run --model cli-hop/<m> <args...>`), because bare positional
  arguments would be treated as a directory by OpenCode.
- **codex**: provider config lives in its deployed config.toml, so launch only
  passes `--model <model>` + user args.
- **grok**: managed config block pins the model; launch forwards only user
  args.

Also attach to each adapter: `probeConfig`, `prepare` (config writer),
optionally `scrubShellConfig`, and `installSpec` (official per-platform
installer commands — see 7.11). `installUrl` = official docs URL.
`installSpecFor(agentId, platform)` reads the spec from the adapter.

### 7.8 Config writers (each agent's `prepare`) — ADR 0003

All writers are **merge-safe** (never clobber unrelated user config). Managed
directories 0700, managed files 0600. Merge failures are reported, not
overwritten.

- **Claude Code** (`claude-config.ts`):
  - `~/.claude.json`: approval of the key's **last-20-char tail** in
    `customApiKeyResponses.approved`, `hasCompletedOnboarding = true`,
    `bypassPermissionsModeAccepted = true`.
  - `~/.claude/settings.json`: env `ANTHROPIC_BASE_URL` = endpoint (no `/v1`),
    `ANTHROPIC_API_KEY` = key, `CLAUDE_CODE_ATTRIBUTION_HEADER = "0"`;
    delete `ANTHROPIC_AUTH_TOKEN`; `hasCompletedOnboarding = true`; add
    `cleanupPeriodDays: 30` only if unset; default `permissions` block with
    the tool allow-list and `defaultMode: "bypassPermissions"` if absent;
    set `model` only if unset (never overwrite the user's choice).
  - Remove stale `~/.claude/.credentials.json` and `~/.claude/auth.json` so
    the API key (not OAuth) takes over.
  - `scrubShellRc()` rewrites bash/zsh rc files removing
    `export ANTHROPIC_*` lines for the Claude credential vars.
- **Oh My Pi** (`omp-config.ts`): merge-write `~/.omp/agent/models.yml` —
  a `cli-hop` provider block with the key inline (0600), and every model
  available through Chat Completions written as an `openai-completions`
  entry (wire api per model from the catalogue).
- **Pi** (`pi-config.ts`): merge-write `~/.pi/agent/models.json` — the Chat
  Completions catalogue under provider `cli-hop`, key inline (0600); launch
  passes `--model cli-hop/<model>`.
- **OpenCode** (`opencode-config.ts`): merge-write
  `~/.config/opencode/opencode.json`:
  - Providers `cli-hop` (anthropic wire) and `cli-hop-openai`
    (openai-compatible); key inline in provider options.
  - `model` and `small_model` pinned to `cli-hop/<selected-model>`.
  - Only models compatible with Chat Completions are included. The current
    catalogue is authoritative: stale `cli-hop` model entries no longer
    returned by the gateway are removed, even when capability metadata is
    absent; saved settings/labels for models still present are preserved, as
    are unrelated providers and top-level options.
  - Migrates any legacy single-provider `cli-hop` chat-model config
    (`cli-hop-openai` provider is removed).
  - Add `$schema` only when the file is newly created.
- **Codex CLI** (`codex-config.ts`): deploy `~/.codex/config.toml`
  (marker-managed regions merged into the user's existing config),
  `~/.codex/cli-hop.config.toml` (profile), and `~/.codex/auth.json` (0600)
  so `codex` works standalone. The provider + endpoint live in the deployed
  config; launch only passes `--model`.
  - `scrubShellConfig`: remove `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`,
    `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and the legacy `CLI_HOP_*_CODEX_API_KEY`
    variants from rc files.
- **Grok Build** (`grok-config.ts`): merge-write `~/.grok/config.toml`:
  - A marker-delimited managed `[model]` block: model id, `provider` with the
    pool base URL, inline `api_key` (0600), responses wire, plus
    `displayName` and `contextWindow` (1,000,000 for `grok-4.5`) when known.
  - The `[models]` / `[endpoints]` / `[marketplace]` defaults the official
    installer writes when absent.
  - `scrubShellConfig`: remove `CLI_HOP_API_KEY`, `CLI_HOP_AI_API_KEY`, the
    legacy `CLI_HOP_*_CODEX_API_KEY` variants, and `CUSTOM_API_KEY` from rcs.

### 7.9 `resync.ts` — ResyncService

For every **installed** agent that already has a config file (`probeConfig`
→ `exists`), rewrite its config with the current key + endpoint, preserving
the agent's existing model selection (fall back to the first model it
supports from the catalogue when missing). One agent failing never aborts the
others; report each result.

### 7.10 `shell-scrub.ts`, `secure-file.ts`, `config-document.ts`

- `shell-scrub.ts`: remove stale `export VAR=...` and `set -xe VAR ...` lines
  for a given list of variables from common shell rc files; return modified
  paths.
- `secure-file.ts`: atomic writes with mode 0600; managed directories created
  0700.
- `config-document.ts`: object-shaped JSON/JSONC reader returning
  `{ value, existed }`; malformed configs report a clear error instead of
  being overwritten silently.

### 7.11 `installer.ts` — official per-platform installers

- `isInstalled(command)` scans `PATH` with `access(X_OK)` (Windows: probe
  `PATHEXT` extensions). Special case: an on-PATH `grok` whose file is a text
  script containing `cmux grok wrapper` is *not* the real CLI — skip it.
- `AGENT_INSTALL_SPECS` live on each registry adapter as `installSpec`: every
  agent id must have verified official commands for macOS / Linux / Windows,
  plus a docs URL:
  - claude-code: `curl -fsSL https://claude.ai/install.sh | bash` (posix) /
    `irm https://claude.ai/install.ps1 | iex`; docs
    code.claude.com/docs/en/setup
  - omp: `curl -fsSL https://omp.sh/install | sh` / `irm https://omp.sh/install.ps1 | iex`
  - pi: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
  - opencode: `npm install -g opencode-ai` **then** run its
    `postinstall.mjs` from `$(npm root -g)/opencode-ai` (the npm package is a
    stub until postinstall downloads the platform binary)
  - codex: `curl -fsSL https://chatgpt.com/codex/install.sh | sh` /
    `irm https://chatgpt.com/codex/install.ps1 | iex`
  - grok: `curl -fsSL https://x.ai/cli/install.sh | bash` /
    `irm https://x.ai/cli/install.ps1 | iex` — never the third-party npm
    package
- Executing: structured `InstallStep` kinds — `script` (spawn `bash`/`sh`
  with `["-c", <verbatim>]`), `powershell` (spawn `powershell -NoProfile
  -ExecutionPolicy Bypass -Command <verbatim>`), `npm` (args only; on Windows
  resolve `npm-cli.js` next to `node` to avoid `.cmd` shim EINVAL; `cmd.exe
  /d /s /c npm ...` as last resort), `sequential` (stop at first failure).
  15-minute timeout (AbortSignal), collect stdout+stderr.
- `ensureAgentInstalled(agent, confirmFn?)`: if installed → true. Otherwise
  warn, print the official one-liner, and (TTY only) ask `Install <agent> now?`
  with a spinner (the confirm prompt is injectable); on decline / non-TTY /
  failure print the docs URL and return false — never crash the flow. After a
  successful install, re-check PATH; if the binary still isn't found, tell the
  user to open a new terminal.

### 7.12 `update.ts`

- Passive notice: read last check timestamp from a 24h cache file under the
  settings dir; when stale, query the npm registry for the latest version,
  semver-compare, and print one line if newer. Never throw into the flow.
- `--update`: same check then spawn `npm install -g cli-hop` (argv array,
  shell: false) and report the result. `CLI_HOP_NO_UPDATE_CHECK=1` disables
  the passive check.

### 7.13 `prompts/section-tabs.ts`

Custom interactive prompt rendering the tab bar + list in one screen. Rows:
AGENTS = agent names (with `(latest)` suffix), SETTINGS = the four actions
(masked key / current URL shown inline). Returns a discriminated action:
`{ type: "agent", id }`, `{ type: "settings-action", id }`, or
`{ type: "back" }`. Same key handling as §1.1.

---

## 8. Command specs

### 8.1 `index.ts`

Commander program named `cli-hop` with version, `--update` flag, and the six
subcommands. The passive update notice hooks in for every action except
`update`. **No-args entry:** run the customize flow directly.

### 8.2 `customize.ts` — the default tabbed flow

Implements §1.2 exactly. `ExitPromptError` (user hit Ctrl+C / Esc out of a
prompt) exits 0; any other error prints `✖` and exits 1. Settings actions
delegate to the settings command's shared handler.

### 8.3 `settings.ts`

The tabbed menu handler for Settings actions: change API key (hidden input +
persist, masked confirmation), change base URL (validated input), resync
(runs ResyncService with a spinner and per-agent results), reset (confirm;
clear key + base URL; keep `lastAgentId`; return to the menu). Also exposes
`cli-hop settings` as a standalone command.

### 8.4 `run.ts`

Non-interactive launch per §1.3:
prerequisites → validate `-a` against known ids (exit 1 with the list if
unknown) → install check for an explicitly requested agent → fetch pools
(spinner) → select pool (flag or prompt) → validate pool exists → select
agent (flag; else prompt when the pool supports several; else the pool's
only agent) → validate model compatibility when the gateway catalogue is
available (`✖ <agent> does not support the protocols advertised by
<model>`) → `launch.prepare` → print changed files → launch and exit with
the agent's code. `ExitPromptError` → 0.

### 8.5 `list.ts` and `check.ts`

- `list`: fetch remote models (Bearer, spinner); print id + display name
  rows; `--local` prints built-in pools; API failure warns and falls back to
  local.
- `check`: non-intrusive GET on the models endpoint with the saved key.
  Distinguish **401** (rejected key), **402** (insufficient credits), other
  HTTP failures, and network errors. Success prints
  `Gateway reachable — N models available`. Exit non-zero on any failure.
  **Never print the API key or response bodies.**

---

## 9. Security requirements

- API key shown masked everywhere (`first4…last4`).
- Key lives in the OS keychain by default (service `cli-hop`,
  account = username); the settings file (0600) is the fallback only.
- Every agent config carrying the key: file 0600, parent dir 0700.
- Never log, echo, or persist the key outside the store and the Agent Configs.
- Never add secrets to git; settings dir and configs resolve via
  `XDG_CONFIG_HOME` / `$HOME` and are never hardcoded.
- Spawn shell: false everywhere; no user input interpolated into shell
  strings.

---

## 10. Error handling & degradation rules

- Fetch models fails → `ui.warn("<cause> — using local pools")`; flow continues.
- No settings → prompt inline; decline/cancel → clean 0 exit.
- Agent missing → install offer → docs URL; never crash.
- Malformed agent config → report the JSON/JSONC error path, do not overwrite.
- Non-TTY → static output only (no spinner animation, no `\r`), answers
  `false` to interactive install requests and prints the docs URL.
- Keychain unavailable/unreadable → file fallback, honest post-save message.
- One Resync/scrub failure never aborts the remaining agents.

---

## 11. Design decisions to respect (write these as ADRs in `docs/adr/`)

1. **Keychain-first credential store** (ADR 0001): keychain is the single
   *input*; Agent Configs carry derived 0600 copies; file fallback on
   keychain-less systems; auto-migration on first read; `save()` never
   deletes a keychain item — only explicit `setApiKey(undefined)` does.
2. **Capability-aware selection** (ADR 0002): wire protocols advertised by the
   gateway are the source of truth; metadata-less models stay eligible as
   degraded fallback; generated catalogues are authoritative (stale entries
   pruned), labels preserved.
3. **Config as the delivery channel** (ADR 0003): no launch-time env
   injection; each agent config carries key + endpoint; `run` only unsets and
   spawns; a "Resync" action exists because configs go stale on key rotation.

---

## 12. Testing requirements (node:test, `tests/*.test.mjs`)

Write unit, integration, and E2E tests following this recipe:

- **Isolate everything.** Point settings elsewhere with
  `export XDG_CONFIG_HOME=$(mktemp -d)` **before** writing any settings
  file. Set `CLI_HOP_DISABLE_KEYCHAIN=1` in any process touching settings
  (HOME/XDG redirection does not isolate the OS keychain). Unit-test
  keychain behavior by injecting a fake keychain into `SettingsService`.
- **E2E:** fake `$HOME` + a stub `claude` shell script on `PATH` that echoes
  received env/args, to assert exactly what the spawn receives.
- **Models API:** mock with a tiny `node:http` server on `localhost:9099`
  that checks the `Authorization: Bearer ...` header and serves **two
  paginated pages** to exercise cursor pagination.
- Key assertions:
  - Spawned agent env contains **none** of the gateway credential vars
    (invariant 1); agent config files exist with mode 0600 and contain the
    key + endpoint (invariant 2); nothing is injected via env.
  - Compatibility filtering hides/rejects unsupported agent-model pairs.
  - Local-pool fallback on API failure; non-TTY static output.
  - `cli-hop run` bypasses prompts when `-p`/`-m`/`-a` are given.
  - Settings key migration: file → keychain on first read.
- Test scripts: `tsx -e` fails in this repo (CJS eval context) — put scratch
  scripts in `/tmp` instead. `package.json` is `"type": "module"`.

---

## 13. Definition of done

1. `npm run build` and `npx tsc --noEmit` pass with zero errors.
2. `npm test` passes (unit + E2E).
3. All six invariants (§2) are implemented and covered by tests.
4. Manual smoke (in an isolated env): `XDG_CONFIG_HOME=$(mktemp -d)`,
   `CLI_HOP_DISABLE_KEYCHAIN=1`, a stub agent on PATH, and a local mock
   models server — run `cli-hop` end to end: tab navigation works, model
   fetch + compatibility filter work, config files are written 0600 with the
   key, the stub agent receives a clean env and the right `--model`.
5. `npm pack --dry-run` ships `dist/`, `README.md`, `LICENSE`.
6. No `chalk` outside `ui.ts`, no `any` in public signatures, ESM `.js`
   imports, conventional commits (`feat:`/`fix:`/`chore:`), binary named
   `cli-hop` everywhere.
7. Document the README with: features, install, quick start, usage (default
   flow + all commands), agent compatibility table, config/settings
   reference, troubleshooting. Write the three ADRs from §11.

## 14. Suggested build order

1. Types + `ui.ts` + `endpoint.ts`/`secure-file.ts`/`config-document.ts`.
2. `SettingsService` (+ keychain) and `ensurePrerequisites`.
3. `PoolService` + `registry.ts` (six adapters) + `AgentService` +
   `LaunchCoordinator`.
4. Config writers (Claude → omp/pi → codex → grok → opencode).
5. Commands: `run` → `customize` (tabbed flow) → `settings` → `list`/`check`
   → `update`.
6. `installer.ts`, `resync.ts`, `shell-scrub.ts`.
7. Tests alongside each step; E2E last.
8. README + ADRs; full verification (Definition of done).

Deliver: the complete repository, a runnable `cli-hop` binary, tests green,
and a short report of any spec ambiguities you resolved and how.