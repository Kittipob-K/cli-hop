# 05: codex drops launch-time env_key overrides

**What to build:** Launching Codex no longer passes command-line overrides that point at an environment variable for the credential (`env_key`). The key comes only from the deployed auth file and provider config, which already carry the literal Primary API Key. The launch args that remain are the model selection and any user-passed arguments. Codex still authenticates to the CLI Hop gateway when launched through cli-hop and directly.

**Blocked by:** 01 (Remove Aider) — both touch the agent registry.

**Status:** ready-for-agent

- [ ] No launch args reference an environment variable for the credential
- [ ] `cli-hop run -a codex` still launches successfully and authenticates
- [ ] `codex` launched directly after one cli-hop run authenticates to the CLI Hop gateway
- [ ] The E2E test that asserted the `env_key` provider override is updated to assert it is gone