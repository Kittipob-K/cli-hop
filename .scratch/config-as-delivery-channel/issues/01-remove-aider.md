# 01: Remove Aider from the project

**What to build:** The project no longer claims or attempts support for Aider. The agent disappears from the customisable agent list, the install-check flow, the docs, and every test. No new config writer is added for it — Aider cannot be made standalone because it has no supported persistent key+endpoint config, and keeping it would force an env-injection exception that the feature is removing.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Aider is not offered as a selectable agent anywhere in the interactive or run flows
- [ ] No install command or install check remains for Aider
- [ ] The README and user-facing docs no longer mention Aider support
- [ ] No test references Aider
- [ ] The agent registry exposes only the six remaining agents