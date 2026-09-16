import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigProbe, RemoteModel } from "../types.js";
import { writeSecureFile } from "./secure-file.js";
import { readJsonDocument } from "./config-document.js";

/** Provider id written into Pi's models.json; also Pi's --model prefix. */
export const PI_PROVIDER_ID = "cli-hop";

export interface PiModelsInput {
  /** Primary API Key written literally so pi runs standalone (ADR 0003). */
  apiKey: string;
  /** Endpoint root WITHOUT /v1, e.g. https://api.cli-hop.cc */
  endpoint: string;
  /** Full catalogue to write (all pools from the CLI Hop API). */
  models: RemoteModel[];
  /** Selected model id; written first in the models list. */
  selected: string;
}

/** Resolve the Pi wire API for a CLI Hop model from its advertised capabilities. */
export function piApiFor(model: RemoteModel): string {
  return "openai-completions";
}

/**
 * Keeps the user's existing Pi providers and replaces only providers.cli-hop
 * so Pi's /model picker always reflects the selected CLI Hop catalogue.
 */
export class PiConfigService {
  readonly modelsPath: string;

  constructor(modelsPath?: string) {
    this.modelsPath = modelsPath ?? join(homedir(), ".pi", "agent", "models.json");
  }

  /**
   * Read-merge-write models.json. Returns the path written. Refuses to
   * overwrite an existing file that cannot be parsed as a JSON object.
   */
  async apply(input: PiModelsInput): Promise<string> {
    let { value: doc } = await readJsonDocument(this.modelsPath, {
      jsonc: true,
      invalidMessage: (path) =>
        `${path} exists but is not valid JSON - fix it manually before switching pools`,
    });

    const currentProviders = doc.providers;
    if (
      currentProviders !== undefined &&
      (currentProviders === null ||
        typeof currentProviders !== "object" ||
        Array.isArray(currentProviders))
    ) {
      throw new Error(
        `${this.modelsPath} has an invalid providers object - fix it manually before switching pools`
      );
    }
    const providers = {
      ...(currentProviders as Record<string, unknown> | undefined),
    };
    const chatModels = input.models.filter(
      (model) => !model.apis?.length || model.apis.includes("chat_completions")
    );
    const chatSelected = chatModels.find((model) => model.id === input.selected);
    const catalogue = chatSelected
      ? [chatSelected, ...chatModels.filter((model) => model.id !== chatSelected.id)]
      : chatModels;

    providers[PI_PROVIDER_ID] = {
      baseUrl: `${input.endpoint.replace(/\/+$/, "")}/v1`,
      apiKey: input.apiKey,
      authHeader: true,
      models: catalogue.map((model) => ({
        id: model.id,
        name: model.displayName ?? model.id,
        api: piApiFor(model),
      })),
    };
    doc = { ...doc, providers };

    await writeSecureFile(
      this.modelsPath,
      `${JSON.stringify(doc, null, 2)}\n`
    );
    return this.modelsPath;
  }

  /** The first model listed under the cli-hop provider, when present (Resync). */
  async probe(): Promise<ConfigProbe> {
    try {
      const { value } = await readJsonDocument(this.modelsPath, {
        jsonc: true,
        invalidMessage: () => "",
      });
      const providers = value.providers as Record<string, unknown> | undefined;
      const provider = providers?.[PI_PROVIDER_ID] as
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
