import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { ConfigProbe, RemoteModel } from "../types.js";
import { writeSecureFile } from "./secure-file.js";
import { chatCapableCatalogue, endpointV1, OPENAI_COMPLETIONS_API } from "./catalogue.js";

/** Provider id written into models.yml; also omp's --model prefix. */
export const OMP_PROVIDER_ID = "cli-hop";

export interface OmpModelsInput {
  /** Primary API Key written literally so omp runs standalone (ADR 0003). */
  apiKey: string;
  /** Endpoint root WITHOUT /v1, e.g. https://api.cli-hop.cc */
  endpoint: string;
  /** Full catalogue to write (all pools from the CLI Hop API). */
  models: RemoteModel[];
  /** Selected model id; written first in the models list. */
  selected: string;
}

/**
 * Keeps the user's existing models.yml (other providers, comments aside)
 * always show the live CLI Hop catalogue through the Chat Completions wire.
 */
export class OmpConfigService {
  readonly modelsPath: string;

  constructor(modelsPath?: string) {
    this.modelsPath = modelsPath ?? join(homedir(), ".omp", "agent", "models.yml");
  }

  /**
   * Read-merge-write models.yml. Returns the path written.
   * Throws if an existing file fails to parse - we refuse to clobber it.
   */
  async apply(input: OmpModelsInput): Promise<string> {
    let doc: Record<string, unknown> = {};
    try {
      const raw = await readFile(this.modelsPath, "utf8");
      const parsed = parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("models.yml root must be an object");
      }
      doc = parsed as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(
          `${this.modelsPath} exists but is not valid YAML - fix it manually before switching pools`
        );
      }
    }

    const currentProviders = doc.providers;
    if (currentProviders !== undefined && (
      !currentProviders ||
      typeof currentProviders !== "object" ||
      Array.isArray(currentProviders)
    )) {
      throw new Error(`${this.modelsPath} has an invalid providers object`);
    }
    const providers = {
      ...(currentProviders as Record<string, unknown> | undefined),
    };
    const catalogue = chatCapableCatalogue(input.models, input.selected);

    providers[OMP_PROVIDER_ID] = {
      baseUrl: endpointV1(input.endpoint),
      apiKey: input.apiKey,
      // CLI Hop speaks Bearer auth on both wires (like the /models API).
      authHeader: true,
      // Anthropic-fronted proxies commonly reject the `strict` tool field.
      disableStrictTools: true,
      models: catalogue.map((m) => ({
        id: m.id,
        name: m.displayName ?? m.id,
        api: OPENAI_COMPLETIONS_API,
      })),
    };
    doc = { ...doc, providers };

    await writeSecureFile(this.modelsPath, stringify(doc));
    return this.modelsPath;
  }

  /** The first model listed under the cli-hop provider, when present (Resync). */
  async probe(): Promise<ConfigProbe> {
    try {
      const raw = await readFile(this.modelsPath, "utf8");
      const doc = parse(raw) as { providers?: Record<string, unknown> };
      const provider = doc?.providers?.[OMP_PROVIDER_ID] as
        | { models?: Array<{ id?: unknown }> }
        | undefined;
      const first = provider?.models?.[0]?.id;
      return {
        exists: true,
        model: typeof first === "string" ? first : undefined,
      };
    } catch {
      return { exists: false };
    }
  }
}
