import type { ModelsResponse, Pool, RemoteModel, WireProtocol } from "../types.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import { agentSupportsModel, CUSTOMIZABLE_AGENTS } from "./registry.js";

// Default pools configuration - will be extended with config file support
const DEFAULT_POOLS: Pool[] = [
  {
    id: "claude-default",
    name: "Claude Default",
    model: "claude-sonnet-4-20250514",
    agents: CUSTOMIZABLE_AGENTS.filter((agent) =>
      agent.supportedProtocols.includes("messages")
    ),
  },
  {
    id: "claude-fast",
    name: "Claude Fast",
    model: "claude-haiku-3",
    agents: CUSTOMIZABLE_AGENTS.filter((agent) =>
      agent.supportedProtocols.includes("messages")
    ),
  },
];

export class PoolService {
  private pools: Pool[];

  constructor() {
    this.pools = DEFAULT_POOLS;
  }

  listPools(): Pool[] {
    return this.pools;
  }

  getPool(id: string): Pool | undefined {
    return this.pools.find((p) => p.id === id);
  }

  getPoolByModel(model: string): Pool | undefined {
    return this.pools.find((p) => p.model === model);
  }

  /**
   * Pull the model/pool catalogue from the CLI Hop API
   * (GET {baseUrl}/models with "Authorization: Bearer <apiKey>"),
   * following cursor pagination until exhausted.
   */
  async fetchRemoteModels(
    apiKey: string,
    baseUrl: string = DEFAULT_MODELS_BASE_URL,
    signal?: AbortSignal
  ): Promise<RemoteModel[]> {
    const models: RemoteModel[] = [];
    let afterId: string | undefined;
    const seenCursors = new Set<string>();

    for (;;) {
      const url = new URL("models", baseUrl.replace(/\/+$/, "") + "/");
      if (afterId) url.searchParams.set("after_id", afterId);

      const res = await fetch(url, {
        signal: signal ?? AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "anthropic-version": "2023-06-01",
        },
      });

      if (!res.ok) {
        const error = new Error(
          `Models API returned ${res.status} ${res.statusText}` +
            (res.status === 401 ? " — check your API key in Settings" : "") +
            (res.status === 402 ? " — insufficient credits" : "")
        ) as Error & { status?: number };
        error.status = res.status;
        throw error;
      }

      const body: unknown = await res.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("Models API returned an invalid response object");
      }
      const response = body as ModelsResponse;
      if (response.data !== undefined && !Array.isArray(response.data)) {
        throw new Error("Models API returned invalid data");
      }
      // cli-hop.models groups ids by wire protocol (messages,
      // chat_completions, responses, …) — invert it for per-model lookup.
      const caps = new Map<string, string[]>();
      for (const [api, ids] of Object.entries(response["cli-hop"]?.models ?? {})) {
        if (!Array.isArray(ids)) continue;
        for (const id of ids) caps.set(id, [...(caps.get(id) ?? []), api]);
      }
      for (const m of response.data ?? []) {
        if (!m || typeof m.id !== "string" || m.id.length === 0) {
          throw new Error("Models API returned an invalid model entry");
        }
        models.push({
          id: m.id,
          displayName: m.display_name,
          type: m.type,
          apis: caps.get(m.id)?.filter((api): api is WireProtocol =>
            ["messages", "chat_completions", "responses", "generateContent", "streamGenerateContent", "countTokens"].includes(api)
          ),
        });
      }

      if (!response.has_more || !response.last_id) break;
      if (seenCursors.has(response.last_id)) {
        throw new Error("Models API returned a repeated pagination cursor");
      }
      seenCursors.add(response.last_id);
      afterId = response.last_id;
    }

    return models;
  }

  /**
   * Build selectable Pool entries from remote models. Every CLI Hop model
   * is reachable through all registered agent CLIs; the wire protocol is
   * resolved per model (see RemoteModel.apis).
   */
  poolsFromRemoteModels(models: RemoteModel[]): Pool[] {
    return models.map((m) => ({
      id: `remote:${m.id}`,
      name: m.displayName ?? m.id,
      model: m.id,
      agents: m.apis?.length
        ? CUSTOMIZABLE_AGENTS.filter((agent) => agentSupportsModel(agent, m))
        : CUSTOMIZABLE_AGENTS,
    }));
  }

  /**
   * Resolve the pools offered to the user: the live CLI Hop model catalogue
   * when an API key is configured and reachable, otherwise the built-in
   * local pools. Never throws — API problems are reported via `error`.
   */
  async resolvePools(opts: {
    apiKey?: string;
    baseUrl?: string;
    onProgress?: (msg: string) => void;
  }): Promise<{
    pools: Pool[];
    source: "remote" | "local";
    error?: string;
    /** Raw catalogue (with wire capabilities) when source is "remote". */
    models?: RemoteModel[];
  }> {
    if (!opts.apiKey) {
      return { pools: this.pools, source: "local" };
    }

    try {
      opts.onProgress?.("Fetching models from CLI Hop API…");
      const models = await this.fetchRemoteModels(
        opts.apiKey,
        opts.baseUrl ?? DEFAULT_MODELS_BASE_URL
      );
      if (models.length === 0) {
        return {
          pools: this.pools,
          source: "local",
          error: "API returned no models",
        };
      }
      return {
        pools: this.poolsFromRemoteModels(models),
        source: "remote",
        models,
      };
    } catch (err) {
      return {
        pools: this.pools,
        source: "local",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
