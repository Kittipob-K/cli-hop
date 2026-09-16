# 06: Remove launch-time env injection

**What to build:** `cli-hop run` stops injecting the Primary API Key or endpoint into the child process environment. The launch environment is the inherited environment with inherited Anthropic/OpenAI/CLI Hop proxy credentials unset — nothing added. The Agent Config is the sole delivery channel. The env-mapping fields and the env-preparation method that performed the injection are removed from the agent type and service, and every test that asserted env injection is updated to assert its absence.

**Blocked by:** 02, 03, 04, 05 — every remaining agent must write the literal key to its own config before injection can stop, or those agents would lose their credential entirely.

**Status:** ready-for-agent

- [ ] `cli-hop run` produces a child env with only inherited credentials removed and nothing injected
- [ ] The env-mapping fields are gone from the agent type and registry
- [ ] The env-preparation method that injected values is removed
- [ ] The interactive flow no longer displays injected env vars as part of launching
- [ ] Every E2E/unit test that asserted injected env values now asserts the values are absent
- [ ] Each of the six agents still authenticates when launched through `cli-hop run`