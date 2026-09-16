import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigProbe } from "../types.js";
import { writeSecureFile } from "./secure-file.js";

/**
 * Merge-writes the Grok Build CLI config the same way the CLI Hop one-line
 * installer (grok-install.sh) does: a managed `[model."id"]` block inside
 * `# >>> CLI Hop Grok Build >>>` / `<<<` markers, preserving every
 * unrelated TOML section, key and comment the user already has.
 *
 * The block uses the OpenAI Chat Completions wire (`api_backend = "chat_completions"`)
 * with the gateway URL and key inline, so Grok never depends on a shell
 * environment variable (installer parity).
 */

export const GROK_CONFIG_MARKER_START = "# >>> CLI Hop Grok Build >>>";
export const GROK_CONFIG_MARKER_END = "# <<< CLI Hop Grok Build <<<";

export interface GrokConfigInput {
  /** Primary API key (ccsk-...). */
  apiKey: string;
  /** Endpoint root WITHOUT /v1, e.g. https://api.cli-hop.cc */
  endpoint: string;
  /** Model id to configure, e.g. grok-4.5. */
  model: string;
  /** Display name recorded in the managed block. */
  displayName?: string;
  /** Upstream context window recorded in the managed block. */
  contextWindow?: number;
}

function isSectionHeading(line: string): boolean {
  return /^[ \t]*\[[^[\]]+\][ \t]*(#.*)?$/.test(line) ||
    /^[ \t]*\[\[[^[\]]+\]\][ \t]*(#.*)?$/.test(line);
}

/** `[model."id"]` / `[model."other"]` heading of a CLI Hop-managed model. */
function isManagedModelHeading(line: string, modelId: string): boolean {
  const bare = line.replace(/#.*$/, "").replace(/[[\]"\s]/g, "");
  return bare === `model.${modelId}` || bare === "model.cli-hop-grok-build";
}

function renderManagedBlock(input: GrokConfigInput): string {
  const baseUrl = `${input.endpoint.replace(/\/+$/, "")}/v1`;
  const name = input.displayName?.trim() || input.model;
  const contextWindow = input.contextWindow ?? 200000;
  return [
    GROK_CONFIG_MARKER_START,
    `[model."${input.model}"]`,
    `model = "${input.model}"`,
    `base_url = "${baseUrl}"`,
    `name = "${name}"`,
    `description = "${name}"`,
    `api_key = "${input.apiKey}"`,
    'api_backend = "chat_completions"',
    `context_window = ${contextWindow}`,
    GROK_CONFIG_MARKER_END,
    "",
  ].join("\n");
}

/**
 * Replace any previous CLI Hop-managed content (marker blocks, stale managed
 * `[model."id"]` sections, and managed scalars inside `[models]`,
 * `[endpoints]`, `[marketplace]`) while keeping every other line
 * byte-for-byte, then append the fresh sections and managed model block.
 * Mirrors the awk merge in grok-install.sh. Returns the new file content.
 */
export function mergeGrokToml(existing: string, input: GrokConfigInput): string {
  const lines = existing.split("\n");
  const kept: string[] = [];

  let skippingMarkerBlock = false;
  let skippingManagedModel = false;
  let currentSection: string | null = null;
  let sawModels = false;
  let sawEndpoints = false;
  let sawMarketplace = false;

  const isSectionHeading = (line: string): string | null => {
    const match = line.match(/^[ \t]*\[+([^[\]]+)\]+[ \t]*(?:#.*)?$/);
    return match ? match[1].replace(/[\"\s]/g, "").toLowerCase() : null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === GROK_CONFIG_MARKER_START) {
      skippingMarkerBlock = true;
      continue;
    }
    if (skippingMarkerBlock) {
      if (trimmed === GROK_CONFIG_MARKER_END) skippingMarkerBlock = false;
      continue;
    }
    if (trimmed === GROK_CONFIG_MARKER_END) continue;

    if (isManagedModelHeading(line, input.model)) {
      skippingManagedModel = true;
      continue;
    }
    if (skippingManagedModel) {
      // A section heading ends the stale managed model; anything else inside
      // it (including comments) belongs to the block being replaced.
      if (isSectionHeading(line) === null) continue;
      skippingManagedModel = false;
    }

    const section = isSectionHeading(line);
    if (section !== null) currentSection = section;

    if (section === "models") {
      sawModels = true;
      kept.push(line, `default = "${input.model}"`, `web_search = "${input.model}"`);
      continue;
    }
    if (section === "endpoints") {
      sawEndpoints = true;
      kept.push(line, `models_base_url = "${input.endpoint}"`);
      continue;
    }
    if (section === "marketplace") {
      sawMarketplace = true;
      kept.push(line, "default_skills_installs_purged = true");
      continue;
    }

    if (
      (currentSection === "models" && /^(default|web_search)\s*=/.test(trimmed)) ||
      (currentSection === "endpoints" && /^models_base_url\s*=/.test(trimmed)) ||
      (currentSection === "marketplace" && /^default_skills_installs_purged\s*=/.test(trimmed))
    ) {
      continue;
    }

    kept.push(line);
  }

  if (!sawModels) {
    kept.push("", "[models]", `default = "${input.model}"`, `web_search = "${input.model}"`);
  }
  if (!sawEndpoints) {
    kept.push("", "[endpoints]", `models_base_url = "${input.endpoint}"`);
  }
  if (!sawMarketplace) {
    kept.push("", "[marketplace]", "default_skills_installs_purged = true");
  }

  const body = kept.join("\n").replace(/\n+$/, "");
  const block = renderManagedBlock(input);
  return body ? `${body}\n\n${block}` : block;
}
export class GrokConfigService {
  readonly configPath: string;

  constructor(configPath?: string) {
    const grokHome = process.env.GROK_HOME ?? join(homedir(), ".grok");
    this.configPath = configPath ?? join(grokHome, "config.toml");
  }

  async apply(input: GrokConfigInput): Promise<string[]> {
    let existing = "";
    try {
      existing = await readFile(this.configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`${this.configPath} is not readable - fix it before switching pools`);
      }
    }

    const merged = mergeGrokToml(existing, input);
    await writeSecureFile(this.configPath, merged.endsWith("\n") ? merged : `${merged}\n`);
    return [this.configPath];
  }

  /** The `[models] default` model, when present (Resync). */
  async probe(): Promise<ConfigProbe> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      const match = raw.match(/^\[models\][\s\S]*?^default\s*=\s*"([^"]+)"/m);
      return { exists: true, model: match?.[1] };
    } catch {
      return { exists: false };
    }
  }
}
