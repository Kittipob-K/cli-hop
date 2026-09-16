# 07: Resync agent configs in Settings

**What to build:** The Settings menu offers a Resync action that rewrites every agent's config with the current Primary API Key and endpoint after the user changes them. Resync only touches agents whose CLI is installed and that already have a config file on disk. Each agent's existing model selection is preserved; when a config is missing or the model cannot be read, the first model that agent supports from the catalogue is used. One agent failing does not abort the others, and each rewritten file is reported to the user.

**Blocked by:** 02, 03, 04 — Resync rewrites via the same config writers, which must be writing literal keys by then.

**Status:** ready-for-agent

- [ ] The Settings menu exposes a Resync action
- [ ] Only agents that are installed and have an existing config are rewritten
- [ ] Each rewritten config keeps the agent's existing model selection
- [ ] Rewritten configs carry the current key and endpoint from Settings
- [ ] A failure for one agent is reported without stopping the rest
- [ ] Rewritten files are reported to the user
- [ ] A unit test asserts the installed-and-existing-config filter and model preservation