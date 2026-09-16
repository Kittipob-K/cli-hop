# cli-hop

CLI that launches agent CLIs against the CLI Hop gateway. One credential
is configured once and delivered to each agent through its own config file.

## Language

**Primary API Key**:
The single CLI Hop key the user configures once; every supported agent CLI
authenticates to the gateway with it, delivered through each Agent Config.
No launch-time env injection.
_Avoid_: token, secret, password

**Credential Store**:
The authoritative home of the Primary API Key while at rest: the OS keychain
when one is usable, otherwise the Settings File. The only place the key is
*entered*.
_Avoid_: single source of truth (ambiguous — the store is a single *input*, not
a single *copy*)

**Settings File**:
The user's non-secret configuration. Also serves as the Credential Store's
fallback location on systems with no usable keychain.
_Avoid_: config, profile

**Agent Config**:
A per-agent file the tool writes so that agent talks to CLI Hop when launched
directly — the sole delivery channel for the Primary API Key and endpoint. It
is always a *derived copy* of the Credential Store + Settings File — never an
independent input, freely overwritten or removed by the tool, and never
bypassed by launch-time environment variables.
_Avoid_: credential (it may contain one, but it is not where one is entered)
# Model capabilities and wire selection

- **Capability**: A named operation a model exposes, such as `messages`, `chat_completions`, `responses`, `generateContent`, `streamGenerateContent`, or `countTokens`.
- **Wire**: The protocol/capability path an agent uses to communicate with a model.
- **Wire preference**: A user's remembered wire choice scoped to a model and agent; it can be changed through normal launch flows or settings.
- **Unsupported model**: A model with no capability supported by the selected agent; it cannot be launched automatically.
