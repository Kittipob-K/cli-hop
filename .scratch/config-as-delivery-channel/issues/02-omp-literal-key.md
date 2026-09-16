# 02: omp writes the literal Primary API Key into models.yml

**What to build:** Launching Oh My Pi through cli-hop writes the actual Primary API Key (not an environment-variable reference) into the cli-hop provider's config. After one run, `omp` works standalone — it authenticates to the CLI Hop gateway from its own config without cli-hop exporting a variable. The agent still launches correctly when run through cli-hop, and the config file stays owner-only.

**Blocked by:** 01 (Remove Aider) — both touch the agent registry.

**Status:** ready-for-agent

- [ ] The omp provider config contains the literal key value, not an env-var reference
- [ ] Before committing, verify against omp's resolution logic that a plain string is used as a literal secret; if not, fall back to a managed env file in omp's config dir and note the deviation
- [ ] `omp` launched directly after one cli-hop run authenticates to the CLI Hop gateway
- [ ] `cli-hop run -a omp` still launches successfully
- [ ] The written config file is 0600
- [ ] A unit test asserts the literal key appears and no `$CLI_HOP_API_KEY` reference survives