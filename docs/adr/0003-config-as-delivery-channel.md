# Agent Configs as the credential delivery channel

The Primary API Key used to reach every agent was previously delivered through
launch-time environment variables (`prepareEnv`/`apiKeyEnvVars` per adapter).
We decided each Agent Config now carries the key + endpoint itself (0600), so
every agent runs standalone without `cli-hop` in the loop — and `cli-hop run`
only unsets inherited credentials before spawning.

## Considered Options

- **Keep env injection as the channel** — every launch depends on the wrapper;
  agents cannot run directly. Rejected: the whole point is standalone use.
- **Per-agent keys** — separate credentials per agent. Rejected: the gateway
  issues one key usable everywhere; multiplying keys multiplies rotation cost
  with no security gain beyond what 0600 files already give.
- **Hybrid (config default + env override)** — rejected; two delivery paths
  means two sources of confusion at debug time. Config is the only channel.

## Consequences

- `apiKeyEnvVars` / `baseUrlEnvVars` / `prepareEnv` are removed; `envToUnset`
  stays (inherited credentials must still be cleared before spawn).
- Aider has no supported persistent key+endpoint config and is removed from
  the registry rather than kept as an env-injection exception.
- Changing the key/base URL leaves previously written Agent Configs stale;
  the Settings menu offers an explicit Resync that rewrites every installed
  agent's config from its existing model selection.
- omp/pi write the literal key (not an env reference); verified against their
  resolution logic during implementation — if either ever stops accepting
  literals, fall back to a managed `.env` in that agent's config dir.
