import { AgentService } from "./agent.js";
import { PoolService } from "./pool.js";
import { endpointFromModelsBaseUrl } from "./endpoint.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import type { Agent, Pool, RemoteModel, RunOptions, Settings } from "../types.js";

export interface LaunchRequest {
  agent: Agent;
  poolId: string;
  model: string;
  settings: Settings;
  args?: string[];
  models?: RemoteModel[];
}

export interface PreparedLaunch {
  endpoint: string;
  changedFiles: string[];
  options: RunOptions;
}

/** Coordinates policy shared by interactive and non-interactive launch flows. */
export class LaunchCoordinator {
  constructor(
    readonly poolService = new PoolService(),
    readonly agentService = new AgentService()
  ) {}

  async resolvePools(settings: Settings) {
    return this.poolService.resolvePools({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
    });
  }

  compatiblePools(pools: Pool[], agent: Agent): Pool[] {
    return pools.filter((pool) => pool.agents.some((candidate) => candidate.id === agent.id));
  }

  async prepare(request: LaunchRequest): Promise<PreparedLaunch> {
    const endpoint = endpointFromModelsBaseUrl(
      request.settings.baseUrl ?? DEFAULT_MODELS_BASE_URL
    );
    const changedFiles = await this.agentService.prepare(request.agent, {
      apiKey: request.settings.apiKey!,
      endpoint,
      models: request.models ?? [{ id: request.model }],
      selected: request.model,
    });
    return {
      endpoint,
      changedFiles,
      options: {
        pool: request.poolId,
        model: request.model,
        args: request.args,
      },
    };
  }

  async run(request: LaunchRequest): Promise<{ prepared: PreparedLaunch; exitCode: number }> {
    const prepared = await this.prepare(request);
    const exitCode = await this.runPrepared(request.agent, prepared);
    return { prepared, exitCode };
  }

  async runPrepared(agent: Agent, prepared: PreparedLaunch): Promise<number> {
    return this.agentService.run(agent, prepared.options);
  }
}
