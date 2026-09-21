import { AgentService } from "./agent.js";
import { PoolService } from "./pool.js";
import { endpointFromModelsBaseUrl } from "./endpoint.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import { agentSupportsModel } from "./registry.js";
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

  /** Endpoint root derived from the Settings File (single derivation point). */
  endpointFor(settings: Settings): string {
    return endpointFromModelsBaseUrl(settings.baseUrl ?? DEFAULT_MODELS_BASE_URL);
  }

  /**
   * The reason a selection cannot launch, or null when it is compatible.
   * One policy for both flows: the pool's protocol fit applies to its
   * default model; an explicit `-m` override is validated against the
   * catalogue and the model's own capabilities — including when only
   * pool data is available (Models API down).
   */
  compatibilityProblem(
    agent: Agent,
    pool: Pool,
    selectedModel: string,
    models?: RemoteModel[]
  ): string | null {
    if (
      selectedModel === pool.model &&
      !pool.agents.some((candidate) => candidate.id === agent.id)
    ) {
      return `${agent.name} does not support the protocols advertised by ${pool.model}`;
    }
    if (!models) return null;
    const remoteModel = models.find((model) => model.id === selectedModel);
    if (!remoteModel) {
      return `Model "${selectedModel}" is not in the CLI Hop catalogue.`;
    }
    if (!agentSupportsModel(agent, remoteModel)) {
      return `${agent.name} does not support the protocols advertised by ${selectedModel}`;
    }
    return null;
  }

  async prepare(request: LaunchRequest): Promise<PreparedLaunch> {
    const endpoint = this.endpointFor(request.settings);
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
