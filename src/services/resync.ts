import type { Agent, RemoteModel, Settings } from "../types.js";
import { endpointFromModelsBaseUrl } from "./endpoint.js";
import { isInstalled } from "./installer.js";
import { PoolService } from "./pool.js";
import { agentSupportsModel, CUSTOMIZABLE_AGENTS } from "./registry.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";

export interface ResyncResult {
  /** Config files rewritten. */
  files: string[];
  /** Agents skipped because their CLI is missing or they have no config yet. */
  skipped: Array<{ agent: string; reason: "not-installed" | "no-config" | "no-model" }>;
  /** Agents whose rewrite failed; the rest of the run continues. */
  failed: Array<{ agent: string; error: string }>;
}

/**
 * Rewrites every installed agent's existing config with the current Primary
 * API Key and endpoint (ADR 0003, Settings Resync action). Only agents whose
 * CLI is on PATH and whose config already exists on disk are touched; each
 * agent's existing model selection is preserved, falling back to the first
 * model it supports from the catalogue. One agent failing never aborts the
 * others.
 */
export class ResyncService {
  constructor(
    private readonly agents: Agent[] = CUSTOMIZABLE_AGENTS,
    private readonly resolvePools: (
      opts: { apiKey?: string; baseUrl?: string }
    ) => Promise<{
      pools: Array<{ model: string; agents: Agent[] }>;
      models?: RemoteModel[];
    }> = (opts) => new PoolService().resolvePools(opts),
    private readonly installed: (command: string) => Promise<boolean> = isInstalled
  ) {}

  async run(settings: Settings): Promise<ResyncResult> {
    const endpoint = endpointFromModelsBaseUrl(
      settings.baseUrl ?? DEFAULT_MODELS_BASE_URL
    );
    const resolved = await this.resolvePools({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
    });
    // Catalogue of candidate models: the live remote list when available,
    // otherwise the built-in local pools (graceful degradation, invariant 4).
    const catalogue: RemoteModel[] = resolved.models ??
      resolved.pools.map((pool) => ({ id: pool.model }));

    const files: string[] = [];
    const skipped: ResyncResult["skipped"] = [];
    const failed: ResyncResult["failed"] = [];

    for (const agent of this.agents) {
      if (!(await this.installed(agent.command))) {
        skipped.push({ agent: agent.id, reason: "not-installed" });
        continue;
      }
      if (!agent.prepare) {
        skipped.push({ agent: agent.id, reason: "no-config" });
        continue;
      }

      const probe = await agent.probeConfig?.();
      if (!probe?.exists) {
        skipped.push({ agent: agent.id, reason: "no-config" });
        continue;
      }

      const selected =
        probe.model ??
        catalogue.find((model) => agentSupportsModel(agent, model))?.id;
      if (!selected) {
        skipped.push({ agent: agent.id, reason: "no-model" });
        continue;
      }

      try {
        const changed = await agent.prepare({
          apiKey: settings.apiKey!,
          endpoint,
          models: catalogue,
          selected,
        });
        files.push(...changed);
      } catch (err) {
        failed.push({
          agent: agent.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { files, skipped, failed };
  }
}