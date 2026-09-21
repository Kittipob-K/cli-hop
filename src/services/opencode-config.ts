import { homedir } from "node:os";
import { join } from "node:path";
import type { ConfigProbe, RemoteModel } from "../types.js";
import { writeSecureFile } from "./secure-file.js";
import { readJsonDocument } from "./config-document.js";
import { chatCapableCatalogue, endpointV1 } from "./catalogue.js";

const OPEN_CODE_SCHEMA_URL = "https://opencode.ai/config.json";
const OPEN_CODE_PROVIDER_ID = "cli-hop";
const FIX_HINT = " - fix it manually before switching pools";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface OpenCodeConfigInput {
  /** Primary API Key written literally so opencode runs standalone (ADR 0003). */
  apiKey: string;
  endpoint: string;
  models: RemoteModel[];
  selected: string;
}

export interface OpenCodeConfigResult {
  path: string;
  staleModels: string[];
}

/**
 * OpenCode uses one CLI Hop provider and the gateway's OpenAI Chat
 * Completions wire. Claude Code is the only Anthropic Messages adapter.
 */
export class OpenCodeConfigService {
  readonly configPath: string;

  constructor(configPath?: string) {
    const configBase = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    this.configPath = configPath ?? join(configBase, "opencode", "opencode.json");
  }

  async apply(input: OpenCodeConfigInput): Promise<OpenCodeConfigResult> {
    const documentResult = await readJsonDocument(this.configPath, {
      jsonc: true,
      invalidMessage: (path) => `${path} is not valid JSON/JSONC${FIX_HINT}`,
    });
    const document = documentResult.value;
    const existingProviders = document.provider;
    if (existingProviders !== undefined && !isRecord(existingProviders)) {
      throw new Error(`${this.configPath} has an invalid provider object${FIX_HINT}`);
    }

    const existingProvider = existingProviders?.[OPEN_CODE_PROVIDER_ID];
    if (existingProvider !== undefined && !isRecord(existingProvider)) {
      throw new Error(`${this.configPath} has an invalid cli-hop provider object${FIX_HINT}`);
    }
    const provider = existingProvider ?? {};
    if (provider.options !== undefined && !isRecord(provider.options)) {
      throw new Error(`${this.configPath} has an invalid cli-hop options object${FIX_HINT}`);
    }
    if (provider.models !== undefined && !isRecord(provider.models)) {
      throw new Error(`${this.configPath} has an invalid cli-hop models object${FIX_HINT}`);
    }

    const existingModels = isRecord(provider.models) ? provider.models : {};
    const catalogue = chatCapableCatalogue(input.models, input.selected);
    const models: Record<string, unknown> = {};

    for (const model of catalogue) {
      const saved = existingModels[model.id];
      if (saved !== undefined && !isRecord(saved)) {
        throw new Error(
          `${this.configPath} has an invalid cli-hop model configuration for ${model.id}${FIX_HINT}`
        );
      }
      models[model.id] = {
        ...(saved ?? {}),
        name: model.displayName?.trim() ||
          (typeof saved?.name === "string" ? saved.name : model.id),
      };
    }

    const staleModels: string[] = [];

    const providers = { ...(existingProviders ?? {}) };
    providers[OPEN_CODE_PROVIDER_ID] = {
      ...provider,
      npm: "@ai-sdk/openai-compatible",
      name: "CLI Hop",
      options: {
        ...(provider.options ?? {}),
        baseURL: endpointV1(input.endpoint),
        apiKey: input.apiKey,
      },
      models,
    };
    delete providers["cli-hop-openai"];

    const output: Record<string, unknown> = {
      ...document,
      provider: providers,
      model: `cli-hop/${input.selected}`,
      small_model: `cli-hop/${input.selected}`,
    };
    if (!documentResult.existed) output.$schema = OPEN_CODE_SCHEMA_URL;

    await writeSecureFile(this.configPath, `${JSON.stringify(output, null, 2)}\n`);
    return { path: this.configPath, staleModels };
  }

  /** The configured `model` ref, with its `cli-hop/` prefix stripped (Resync). */
  async probe(): Promise<ConfigProbe> {
    try {
      const { value } = await readJsonDocument(this.configPath, {
        jsonc: true,
        invalidMessage: () => "",
      });
      const model = typeof value.model === "string" ? value.model.replace(/^cli-hop\//, "") : undefined;
      return { exists: true, model };
    } catch {
      return { exists: false };
    }
  }
}
