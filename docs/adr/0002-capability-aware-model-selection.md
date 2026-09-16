# ADR 0002: Capability-aware model selection

## Status

Accepted

## Context

Models may expose different request protocols. Claude uses `messages`; OpenAI models use `chat_completions` or `responses`; Gemini exposes `generateContent`, `streamGenerateContent`, and `countTokens`. Other providers may advertise additional capabilities.

## Decision

Treat API-advertised capabilities as the source of truth. Agents declare supported capabilities, and selection filters to their intersection. Oh My Pi, Pi, OpenCode, and Grok Build use the CLI Hop OpenAI Chat Completions wire and therefore advertise only `chat_completions`; their generated catalogues exclude models that explicitly lack that capability. Models without capability metadata remain eligible as degraded fallback data. When multiple supported capabilities exist for other adapters, let the user choose; remember the choice per model and agent, while allowing it to be changed from launch flows or settings. `countTokens` is supplementary and cannot alone make a model launchable.

## Consequences

Unknown capabilities remain visible as unsupported until an agent adapter supports them. Adding support happens in an adapter rather than in shared selection logic. Fallback catalogue data must produce a warning because capabilities may be incomplete.

Generated agent configuration treats the current input catalogue as authoritative. Entries no longer present are removed rather than copied back from an older configuration, including when the current models omit capability metadata. Settings and display labels for model IDs that remain in the catalogue are preserved.

When metadata is absent, protocol-specific adapters accept their configured wire as the conservative fallback. GPT/Codex use OpenAI Responses, Claude uses Anthropic Messages, and Oh My Pi, Pi, OpenCode, and Grok Build use Chat Completions. Explicitly advertised capabilities always take precedence.
