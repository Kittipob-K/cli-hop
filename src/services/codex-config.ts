import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigProbe } from "../types.js";
import { writeSecureFile } from "./secure-file.js";

/**
 * Writes the persistent Codex CLI configuration the same way the CLI Hop
 * one-line installer (codex-install.sh) does:
 *
 *   ~/.codex/config.toml         managed CLI Hop scalars + provider table
 *   ~/.codex/cli-hop.config.toml profile copy of the managed scalars
 *   ~/.codex/auth.json           { OPENAI_API_KEY: <primary key> } (0600)
 *
 * config.toml is MERGED, unlike the installer's full rewrite: two
 * marker-delimited regions are replaced in place on every run — the managed
 * scalars at the top of the file (before any user table can start) and the
 * `[model_providers.cli-hop]` table at the end (so it cannot swallow user
 * top-level keys below it). Outside the markers, occurrences of the managed
 * scalars and of a user-copied `[model_providers.cli-hop]` table are removed
 * because a duplicate key would make Codex reject the whole file. Every
 * other line of the user's config is preserved byte-for-byte.
 */

export const CODEX_SCALARS_MARKER_START = "# >>> CLI Hop Codex >>>";
export const CODEX_SCALARS_MARKER_END = "# <<< CLI Hop Codex <<<";
export const CODEX_PROVIDER_MARKER_START = "# >>> CLI Hop Codex provider >>>";
export const CODEX_PROVIDER_MARKER_END = "# <<< CLI Hop Codex provider <<<";

/** Top-level keys the managed scalar region owns (installer parity). */
const MANAGED_SCALARS: ReadonlyArray<[key: string, value: string]> = [
  ["model_provider", '"cli-hop"'],
  ["model", '"<model>"'],
  ["disable_response_storage", "true"],
  ["model_reasoning_effort", '"max"'],
  ["approval_policy", '"never"'],
  ["sandbox_mode", '"danger-full-access"'],
  ["cli_auth_credentials_store", '"file"'],
];
const MANAGED_SCALAR_KEYS = new Set(MANAGED_SCALARS.map(([key]) => key));

export interface CodexConfigInput {
  /** Primary API key (ccsk-...). */
  apiKey: string;
  /** Endpoint root WITHOUT /v1, e.g. https://api.cli-hop.cc */
  endpoint: string;
  /** Model id to configure, e.g. gpt-5.6-sol. */
  model: string;
}

function isSectionHeading(line: string): boolean {
  return /^[ \t]*\[+[^[\]]+\]+[ \t]*(?:#.*)?$/.test(line);
}

function isManagedScalar(line: string): boolean {
  const key = line.match(/^[ \t]*([A-Za-z0-9_-]+)[ \t]*=/)?.[1];
  return key !== undefined && MANAGED_SCALAR_KEYS.has(key);
}

function isClihopProviderHeading(line: string): boolean {
  return /^[ \t]*\[model_providers\.cli-hop\][ \t]*(?:#.*)?$/.test(line);
}

function renderScalarRegion(model: string): string {
  return [
    CODEX_SCALARS_MARKER_START,
    ...MANAGED_SCALARS.map(([key, value]) => `${key} = ${value.replace("<model>", model)}`),
    CODEX_SCALARS_MARKER_END,
  ].join("\n");
}

function renderProviderRegion(baseUrl: string): string {
  return [
    CODEX_PROVIDER_MARKER_START,
    "[model_providers.cli-hop]",
    'name = "CLI Hop"',
    `base_url = "${baseUrl}"`,
    'wire_api = "responses"',
    "requires_openai_auth = true",
    CODEX_PROVIDER_MARKER_END,
  ].join("\n");
}

/**
 * Merge the managed regions into existing config.toml content.
 * Returns the new file content.
 */
export function mergeCodexToml(existing: string, input: CodexConfigInput): string {
  const lines = existing.split("\n");
  const kept: string[] = [];

  let skippingMarkers = false;
  let skippingProviderTable = false;
  let insideAnyTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      trimmed === CODEX_SCALARS_MARKER_START ||
      trimmed === CODEX_PROVIDER_MARKER_START
    ) {
      skippingMarkers = true;
      continue;
    }
    if (skippingMarkers) {
      if (
        trimmed === CODEX_SCALARS_MARKER_END ||
        trimmed === CODEX_PROVIDER_MARKER_END
      ) {
        skippingMarkers = false;
      }
      continue;
    }
    if (
      trimmed === CODEX_SCALARS_MARKER_END ||
      trimmed === CODEX_PROVIDER_MARKER_END
    ) {
      continue;
    }

    if (isClihopProviderHeading(line)) {
      skippingProviderTable = true;
      insideAnyTable = true;
      continue;
    }
    if (skippingProviderTable) {
      if (!isSectionHeading(line)) continue;
      skippingProviderTable = false;
    }

    if (isSectionHeading(line)) insideAnyTable = true;

    // Managed scalars are owned at the top level only; the same key inside a
    // user table (e.g. [profiles.work] model = "...") is the user's own.
    if (!insideAnyTable && isManagedScalar(line)) continue;

    kept.push(line);
  }

  const body = kept.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  const scalars = renderScalarRegion(input.model);
  const provider = renderProviderRegion(input.endpoint.replace(/\/+$/, ""));
  return [scalars, body, provider].filter(Boolean).join("\n\n");
}

export class CodexConfigService {
  readonly codexHome: string;

  constructor(codexHome?: string) {
    this.codexHome = codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  }

  get configPath(): string {
    return join(this.codexHome, "config.toml");
  }

  get profilePath(): string {
    return join(this.codexHome, "cli-hop.config.toml");
  }

  get authPath(): string {
    return join(this.codexHome, "auth.json");
  }

  async apply(input: CodexConfigInput): Promise<string[]> {
    let existing = "";
    try {
      existing = await readFile(this.configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`${this.configPath} is not readable - fix it before switching pools`);
      }
    }

    const merged = mergeCodexToml(existing, input);
    await writeSecureFile(this.configPath, `${merged}\n`);

    // Profile copy: the managed scalars only (installer parity).
    await writeSecureFile(
      this.profilePath,
      `${renderScalarRegion(input.model)
        .split("\n")
        .slice(1, -1)
        .join("\n")}\n`
    );

    // auth.json is fully owned by the primary key (installer parity).
    await writeSecureFile(
      this.authPath,
      `${JSON.stringify({ OPENAI_API_KEY: input.apiKey }, null, 2)}\n`
    );

    return [this.configPath, this.profilePath, this.authPath];
  }

  /** The model pinned in the managed scalar region, when present (Resync). */
  async probe(): Promise<ConfigProbe> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const match = raw.match(
        new RegExp(
          `${CODEX_SCALARS_MARKER_START}[\\s\\S]*?^model\\s*=\\s*"([^"]+)"`,
          "m"
        )
      );
      return { exists: true, model: match?.[1] };
    } catch {
      return { exists: false };
    }
  }
}
