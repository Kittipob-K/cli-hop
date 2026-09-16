# cli-hop

[![npm version](https://img.shields.io/npm/v/cli-hop.svg)](https://www.npmjs.com/package/cli-hop)
[![npm downloads](https://img.shields.io/npm/dm/cli-hop.svg)](https://www.npmjs.com/package/cli-hop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI for switching AI pools / models and configuring agent CLIs (Claude Code,
Oh My Pi, Pi, OpenCode, Codex CLI, and Grok Build) to talk
to the **CLI Hop** gateway — with one primary API key that works across
every agent.

```bash
$ cli-hop
[ AGENTS ]    SETTINGS
❯ Grok Build (latest)
  Claude Code
  Oh My Pi
  Pi
  OpenCode
  Codex CLI
  ← → switch tab · ↑↓ navigate · Enter select · Esc back

  AGENTS    [ SETTINGS ]
❯ API Key: Change ccsk…26f3
  Base URL: https://api.cli-hop.cc/v1
  Reset API key and Base URL
  ← → switch tab · ↑↓ navigate · Enter select · Esc back

── Customizing Claude Code ────────────────────────────────────────────
✔ ANTHROPIC_API_KEY=ccsk…26f3 (primary API key)
✔ ANTHROPIC_BASE_URL=https://api.cli-hop.cc
✔ 4 models loaded from API
? Select a model/pool:
❯ qwen3.8-flash (qwen3.8-flash)
  glm-5.3-flash (glm-5.3-flash)
  mimo-v2.5 (mimo-v2.5)
```

## Features

- **Interactive by default** — running `cli-hop` with no arguments opens a
  terminal-friendly `AGENTS | SETTINGS` menu. Switch tabs with `←`/`→` or
  `Tab`; their lists update immediately. The last agent launched is moved to
  the top and labelled `(latest)`.
- **Clean environment per launch** — inherited Anthropic, OpenAI, and CLI Hop
  credentials (including `ANTHROPIC_*`, `OPENAI_*`, and
  `CLI_HOP_API_KEY`) are unset first, so the agent always starts from
  cli-hop-managed state.
- **One primary API key for every agent CLI** — the key you save in Settings is
  exported into the env vars each agent reads. Inherited Anthropic, OpenAI, and
  CLI Hop proxy credentials are removed first so only Settings values reach the
  child process.
- **Protocol-aware selection** — models are matched to agents using the gateway's
  advertised `messages`, `chat_completions`, and `responses`
  capabilities. Unsupported model/agent combinations are hidden or rejected
  before launch.
- **Oh My Pi model sync** — every selection rewrites the `cli-hop` provider in
  `~/.omp/agent/models.yml` with models available through OpenAI Chat
  Completions, using `openai-completions` for every entry. The key itself stays
  off disk (`CLI_HOP_API_KEY` env).
- **Pi model sync** — every Pi launch merge-writes the Chat Completions
  catalogue into `~/.pi/agent/models.json` under provider `cli-hop`, then starts
  Pi with `--model cli-hop/<model>`. Its config stores only
  `$CLI_HOP_API_KEY`, never the primary key itself.
- **OpenCode model sync** — merge-writes
  `~/.config/opencode/opencode.json` with one `@ai-sdk/openai-compatible`
  provider named `cli-hop`. Only models compatible with Chat Completions are
  included, and `model` plus `small_model` are pinned to
  `cli-hop/<selected-model>`. The current catalogue is authoritative, so old
  CLI Hop model entries that are no longer returned are removed even when
  capability metadata is absent. Saved settings and labels for models still in
  the catalogue are preserved, as are unrelated providers and top-level
  options. The key is referenced as `{env:CLI_HOP_API_KEY}`, never stored, and
  `$schema` is added only when the file is newly created. Forwarded prompts use
  `opencode run` so OpenCode treats them as non-interactive prompts rather than
  directory arguments.
- **Live model catalogue** — pools are fetched from the CLI Hop API
  (`GET /v1/models`, Bearer auth, cursor pagination). If the API is
  unreachable, falls back to built-in local pools with a warning.
- **Prerequisite prompts (next-best-step)** — if base URL or API key are not
  configured yet, `cli-hop` asks for them inline (hidden input for the key)
  and saves them — no need to remember the right command.
- **Agent install check (next-best-step)** — before launching, cli-hop
  verifies the selected agent CLI is on `PATH`; when missing it offers to run
  the agent's **official installer** for your platform (macOS / Linux /
  Windows) right there, with a progress spinner and failure output. Decline,
  non-interactive sessions, or exotic platforms degrade to printing the
  official docs URL — the flow never crashes. Install commands are the
  verbatim one-liners from each vendor's docs, e.g. `curl -fsSL
  https://claude.ai/install.sh | bash` (Claude Code),
  `npm install -g --ignore-scripts @earendil-works/pi-coding-agent` (Pi),
  `npm install -g opencode-ai` followed by its postinstall script
  (OpenCode on every supported platform — the npm package is a stub until
  postinstall downloads the platform-specific native binary), and
  `irm https://x.ai/cli/install.ps1 | iex` (Grok Build on Windows).
- **Claude Code configuration (installer parity)** — mirrors the official
  CLI Hop installer: writes `~/.claude.json` and `~/.claude/settings.json`
  (endpoint, key, model, permissions, onboarding flags, key approval), removes
  stale credential files, and can scrub stale `export ANTHROPIC_*` lines from
  your shell rc files.
- **Codex installer-parity config** — deploys `~/.codex/config.toml`
  (marker-managed regions merged into your existing config),
  `~/.codex/cli-hop.config.toml`, and `~/.codex/auth.json` (0600) so `codex`
  works standalone, plus per-run `-c` provider overrides at launch.
- **Grok Build configuration (installer parity)** — merge-writes a
  marker-delimited `[model]` block into `~/.grok/config.toml` (Responses wire,
  pool base URL, key inline at 0600) plus the `[models]` / `[endpoints]` /
  `[marketplace]` defaults the official CLI Hop Grok installer writes, and can
  scrub legacy `CLI_HOP_*` exports from your shell rc files.
- **Update check** — a once-per-day background check against the npm registry
  prints an `Update available` notice (never blocking or crashing the flow);
  run `cli-hop --update` to self-update via `npm install -g`. Set
  `CLI_HOP_NO_UPDATE_CHECK=1` to disable the passive check.
- **Semantic CLI output** — consistent ✔/ℹ/!/✖ alerts, headings, aligned
  definition lists, inline markup and a status spinner, with ASCII fallback for
  dumb terminals (see [`src/ui.ts`](src/ui.ts)).

## Requirements

- Node.js **>= 22**
- The agent CLI you want to launch — if it is missing, cli-hop offers to
  install it with the official per-platform installer before launching.

## Install

```bash
npm install -g cli-hop
```

Or from source:

```bash
git clone https://github.com/Kittipob-K/cli-hop.git
cd cli-hop
npm install
npm run build
npm test
npm link            # provides the global `cli-hop` command
```

## Quick Start

```bash
# Install globally
npm install -g cli-hop

# Run interactive setup (will prompt for API key and base URL)
cli-hop

# Select your agent CLI (Claude Code, Oh My Pi, Pi, OpenCode, Codex, or Grok Build)
# Choose a model/pool from the list
# The agent launches automatically with your configuration
```

## Usage

### Interactive mode (recommended)

```bash
cli-hop                      # Opens the AGENTS | SETTINGS interactive menu
```

### Direct commands

```bash
cli-hop customize            # Same as default interactive mode
cli-hop settings             # Edit API key / base URL in the Settings menu
cli-hop list                 # List models from the CLI Hop API
cli-hop list --local         # List built-in local pools only
cli-hop check                # Verify the CLI Hop gateway connection (status only)
```

### Update the CLI

```bash
cli-hop --update             # Check npm and install the latest release
# Alias: cli-hop update
```

### Check the gateway connection

`cli-hop check` performs a non-intrusive health check against the CLI Hop
models API (Bearer key from Settings) and reports only the connection
outcome — never the API key or any response body:

```bash
cli-hop check                # "Gateway reachable — N models available"
```

It distinguishes a rejected key (401), insufficient credits (402), other
HTTP failures, and network errors, exiting non-zero on any failure.

### Launch specific agent

```bash
cli-hop run -a claude-code   # Launch Claude Code
cli-hop run -a omp           # Launch Oh My Pi
cli-hop run -a pi            # Launch Pi
cli-hop run -a opencode      # Launch OpenCode
cli-hop run -a codex         # Launch Codex CLI
cli-hop run -a grok          # Launch Grok Build (xAI CLI)
```

### Advanced options

```bash
cli-hop run -p <pool-id>     # Launch with specific pool directly
cli-hop run -m <model>       # Override the model
cli-hop run -- <args...>     # Pass extra args to the agent CLI
```

### Example workflow

```bash
# First time setup
cli-hop
# ✔ Select agent: Claude Code
# ✔ Enter API key: ccsk_... (hidden input)
# ✔ Base URL: https://api.cli-hop.cc/v1
# ✔ Select model: qwen3.8-flash
# Claude Code launches automatically!

# Next time - just run and select
cli-hop
# Settings already saved, just pick agent and model
```

### Interactive navigation

| Key | Action |
| --- | --- |
| `←` / `→` / `Tab` | Switch between AGENTS and SETTINGS; the list changes immediately. |
| `↑` / `↓` | Move through the current tab's list. |
| `Enter` | Select the highlighted agent or settings action. |
| `Esc` | From SETTINGS, return to AGENTS; from AGENTS, exit the CLI. |

The **SETTINGS** tab provides direct actions for **API Key**, **Base URL**, and
**Reset API key and Base URL**. Reset asks for confirmation, keeps the last-used
agent shortcut, and returns to the Settings menu.

### The customize flow

1. **Choose an agent** — use the *AGENTS* tab; the most recently launched agent
   appears first as `(latest)`.
2. **Unset** inherited credential env vars.
3. **Check prerequisites** — prompts for `ANTHROPIC_BASE_URL` and
   `ANTHROPIC_API_KEY` if not configured, saves them to Settings.
4. **Fetch models** from `GET {baseURL}/models` and pick a pool.
5. **Filter compatibility** using each model's advertised wire protocols.
6. **Write agent config** — Claude Code, Oh My Pi, Pi,
   OpenCode, Codex, and Grok Build each receive merge-safe
   configuration carrying the key + endpoint, so they also work standalone.
7. **Launch** the agent with a clean environment and remember it as `(latest)`.

## Agent compatibility

| Agent | Model selector | Required CLI Hop protocol | Persistent config |
| --- | --- | --- | --- |
| Claude Code | `--model <model>` | `messages` | `~/.claude.json`, `~/.claude/settings.json` |
| Oh My Pi | `--model cli-hop/<model>` | any advertised protocol | `~/.omp/agent/models.yml` |
| Pi | `--model cli-hop/<model>` | any advertised protocol | `~/.pi/agent/models.json` |
| OpenCode | `--model cli-hop/<model>` | `chat_completions` | `~/.config/opencode/opencode.json` (`cli-hop` provider + `model`/`small_model` refs) |
| Codex CLI | `--model <model>` | `responses` | `~/.codex/config.toml`, `cli-hop.config.toml`, `auth.json` |
| Grok Build | default from `~/.grok/config.toml` | `chat_completions` | `~/.grok/config.toml` (managed block, key inline) |

Agent config directories are created with `0700` permissions and managed files
with `0600` permissions. Merge failures are reported instead of overwriting a
malformed existing config.

## Configuration

Settings live at `${XDG_CONFIG_HOME:-~/.config}/cli-hop/settings.json`
(created with `0600` permissions, key shown masked everywhere). The primary API
key prefers the OS **keychain** (macOS Keychain, Linux Secret Service, Windows
Credential Manager); the settings file is the fallback home on systems with no
usable keychain (headless, CI) and a key found there migrates to the keychain
automatically. Set `CLI_HOP_DISABLE_KEYCHAIN=1` to force file-only storage:

```json
{
  "baseUrl": "https://api.cli-hop.cc/v1"
}
```

| Field     | Purpose                                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`  | Primary API key — Bearer token for the models API and exported to every agent CLI. Present in this file only on keychain-less systems; otherwise the key lives in the OS keychain. |
| `baseUrl` | CLI Hop models endpoint including `/v1`; cli-hop normalizes it for each agent's protocol. Default: `https://api.cli-hop.cc/v1`.                                              |
| `lastAgentId` | ID of the most recently launched interactive agent; used to put it first in the AGENTS tab. No credential data is stored in this field. |

## Verification

```bash
npm test             # unit, config-security, and isolated CLI E2E tests
npm run typecheck    # strict TypeScript validation
npm pack --dry-run   # verify the publishable package contents
```

## Troubleshooting

- **`⚠ Models API returned 401 … — using local pools`** — the saved key is
  wrong/revoked. Re-create it at <https://cli-hop.cc/dashboard> and update
  via `cli-hop settings`.
- **`"<model>" isn't described by this version's model catalog …`** — warning
  from Claude Code itself (not from this CLI): the chosen model id is unknown
  to its built-in catalog, so it assumes a 200k window. Update Claude Code,
  append `[1m]` for a 1M window, or set
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the model's real window.
- **No colors/spinner in CI or piped output** — intended: dynamic elements are
  no-ops on non-TTY output, symbols fall back to ASCII on non-UTF-8 terminals.

## License

MIT
