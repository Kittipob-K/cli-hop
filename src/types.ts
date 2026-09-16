export type WireProtocol =
  | "messages"
  | "chat_completions"
  | "responses"
  | "generateContent"
  | "streamGenerateContent"
  | "countTokens";

/**
 * Environment variables that must be cleared (unset) before launching
 * Claude Code so it falls back to its own credential/OAuth state instead
 * of an inherited proxy configuration.
 *
 * Equivalent to:
 *   unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN \
 *         ANTHROPIC_TOKEN CLAUDE_CODE_OAUTH_TOKEN
 */
export const CLAUDE_CODE_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

/**
 * Environment variables cleared before launching Oh My Pi: the same
 * Anthropic/proxy inheritance as Claude Code, plus omp/pi config-dir and
 * profile pointers that would relocate ~/.omp away from the file we wrote.
 */
export const OMP_ENV_KEYS = [
  ...CLAUDE_CODE_ENV_KEYS,
  "PI_CODING_AGENT_DIR",
  "PI_CONFIG_DIR",
  "OMP_PROFILE",
  "PI_PROFILE",
] as const;

/**
 * Environment variables cleared before launching Pi. Pi reads its managed
 * provider configuration from ~/.pi/agent/models.json; an inherited config
 * directory or CLI Hop key must not override settings managed by this CLI.
 */
export const PI_ENV_KEYS = [
  ...CLAUDE_CODE_ENV_KEYS,
  "CLI_HOP_API_KEY",
  "PI_CODING_AGENT_DIR",
] as const;

export const OPENAI_COMPATIBLE_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_API_BASE",
  "OPENAI_BASE_URL",
] as const;

/**
 * Environment variables cleared before launching Codex CLI: inherited Codex
 * credentials would otherwise take precedence over the CLI Hop auth.json the
 * config writer deploys (installer parity with codex-install.sh).
 */
export const CODEX_ENV_KEYS = ["CODEX_API_KEY", "CODEX_ACCESS_TOKEN"] as const;

/**
 * Environment variables cleared before launching Grok Build: an inherited
 * GROK_HOME would relocate ~/.grok away from the config.toml this CLI writes.
 */
export const GROK_ENV_KEYS = ["GROK_HOME"] as const;

export const GATEWAY_CREDENTIAL_ENV_KEYS = [
  ...CLAUDE_CODE_ENV_KEYS,
  ...OPENAI_COMPATIBLE_ENV_KEYS,
  "CLI_HOP_API_KEY",
] as const;

export interface Agent {
  id: string;
  name: string;
  command: string;
  args?: string[];
  /** Env var names removed from the child process environment before spawn. */
  envToUnset?: readonly string[];
  /**
   * Prefix prepended to the model id when passing --model to the agent CLI
   * (e.g. "cli-hop/" for omp, whose model selector is provider/modelId).
   */
  modelPrefix?: string;
  /** CLI Hop wire protocols this CLI can use. */
  supportedProtocols: readonly WireProtocol[];
  /** Override the generic --model argument construction when needed. */
  buildArgs?: (options: RunOptions) => string[];
  /**
   * Read the currently configured model from the agent's existing config
   * (used by the Settings Resync action, ADR 0003). `exists: false` when the
   * agent has no config file on disk yet.
   */
  probeConfig?: () => Promise<ConfigProbe>;
  /** Prepare persistent CLI configuration before launch. */
  prepare?: (input: AgentPreparationInput) => Promise<string[]>;
  /** Optional cleanup offered only in the interactive customize flow. */
  scrubShellConfig?: () => Promise<string[]>;
  installUrl?: string;
}

/** What the Resync action needs to know about an agent's existing config. */
export interface ConfigProbe {
  /** Whether the agent's config file exists on disk. */
  exists: boolean;
  /** The model currently configured there, when readable. */
  model?: string;
}

/** User settings persisted in ~/.config/cli-hop/settings.json */
export interface Settings {
  /**
   * Primary API key delivered to each agent through its own Agent Config
   * (ADR 0003). The Credential Store (OS keychain) is authoritative at rest:
   * SettingsService returns it from the keychain when available and persists
   * it there, using
   * this file only as the fallback location on systems with no usable keychain.
   */
  apiKey?: string;
  /** Base URL of the CLI Hop models API. Default: https://api.cli-hop.cc/v1 */
  baseUrl?: string;
  /** Agent most recently launched through the interactive menu. */
  lastAgentId?: string;
  /** Remembered wire choice, keyed by agent id then model id. */
  wirePreferences?: Record<string, Record<string, WireProtocol>>;
}

/** Default CLI Hop API endpoint used to list selectable models/pools. */
export const DEFAULT_MODELS_BASE_URL = "https://api.cli-hop.cc/v1";

/** A model/pool entry returned by the CLI Hop /models endpoint. */
export interface RemoteModel {
  id: string;
  displayName?: string;
  type?: string;
  /**
   * Wire protocols the gateway serves this model on, from the response's
   * cli-hop.models capability map (e.g. ["messages", "chat_completions"]).
   */
  apis?: WireProtocol[];
}

/** Shape of the Anthropic-style paginated /models response. */
export interface ModelsResponse {
  data?: Array<{ id: string; display_name?: string; type?: string }>;
  first_id?: string;
  last_id?: string;
  has_more?: boolean;
  /** CLI Hop extension: model ids grouped by supported wire protocol. */
  "cli-hop"?: {
    capabilities?: string[];
    models?: Record<string, string[]>;
  };
}

export interface RunOptions {
  pool?: string;
  model?: string;
  args?: string[];
}

export interface LaunchPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface AgentPreparationInput {
  apiKey: string;
  endpoint: string;
  models: RemoteModel[];
  selected: string;
}

export interface Pool {
  id: string;
  name: string;
  model: string;
  agents: Agent[];
}
