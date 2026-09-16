# 04: opencode writes the literal Primary API Key (adopt the stashed WIP)

**What to build:** Launching OpenCode through cli-hop writes the actual Primary API Key into the cli-hop provider's options instead of the `{env:CLI_HOP_API_KEY}` reference. After one run, `opencode` works standalone — it authenticates to the CLI Hop gateway from its own config without cli-hop exporting a variable. The stashed WIP on the main branch contains the start of this change and is the starting point, not discarded.

**Blocked by:** 01 (Remove Aider) — both touch the agent registry.

**Status:** ready-for-agent

- [ ] The opencode provider options contain the literal key value, not an env reference
- [ ] `opencode` launched directly after one cli-hop run authenticates to the CLI Hop gateway
- [ ] `cli-hop run -a opencode` still launches successfully
- [ ] The written config file is 0600
- [ ] The E2E test that asserted the key is absent from opencode.json is updated to assert it is present as a literal