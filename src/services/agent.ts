import { spawn } from "node:child_process";
import type { Agent, AgentPreparationInput, LaunchPlan, RunOptions } from "../types.js";
import { GATEWAY_CREDENTIAL_ENV_KEYS } from "../types.js";

export class AgentService {
  async prepare(agent: Agent, input: AgentPreparationInput): Promise<string[]> {
    return agent.prepare ? agent.prepare(input) : [];
  }

  async scrubShellConfig(agent: Agent): Promise<string[]> {
    return agent.scrubShellConfig ? agent.scrubShellConfig() : [];
  }
  /**
   * Build the child environment: the inherited environment with every
   * credential/proxy variable cli-hop manages removed (ADR 0003). Nothing is
   * injected — each agent reads its key + endpoint from its own Agent Config.
   */
  cleanEnv(agent: Agent): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const keysToUnset = new Set([
      ...GATEWAY_CREDENTIAL_ENV_KEYS,
      ...(agent.envToUnset ?? []),
    ]);
    for (const key of keysToUnset) {
      delete env[key];
    }
    return env;
  }

  /** Report which env vars were unset (those that were actually present). */
  getUnsetVars(agent: Agent): string[] {
    return [...new Set([...GATEWAY_CREDENTIAL_ENV_KEYS, ...(agent.envToUnset ?? [])])].filter(
      (key) => key in process.env
    );
  }

  /**
   * Perform the `unset` for real on the current process environment so every
   * later step (and any spawned agent) sees a clean environment.
   * Returns the names of the variables that were actually removed.
   */
  applyUnset(agent: Agent): string[] {
    const removed = this.getUnsetVars(agent);
    for (const key of removed) {
      delete process.env[key];
    }
    return removed;
  }

  async run(agent: Agent, options: RunOptions = {}): Promise<number> {
    const plan = this.createLaunchPlan(agent, options);
    const { promise, resolve, reject } = Promise.withResolvers<number>();

    const child = spawn(plan.command, plan.args, {
      stdio: "inherit",
      shell: false,
      env: plan.env,
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const installHint = agent.installUrl
          ? ` Install it from ${agent.installUrl}`
          : "";
        reject(new Error(`${agent.name} is not installed or is not on PATH.${installHint}`));
        return;
      }
      reject(err);
    });

    return promise;
  }

  createLaunchPlan(agent: Agent, options: RunOptions = {}): LaunchPlan {
    return {
      command: agent.command,
      args: this.buildArgs(agent, options),
      env: this.cleanEnv(agent),
    };
  }

  private buildArgs(agent: Agent, options: RunOptions): string[] {
    if (agent.buildArgs) return agent.buildArgs(options);
    const args: string[] = [...(agent.args ?? [])];

    // Add model flag if specified; agent may need a provider prefix.
    if (options.model) {
      args.push("--model", (agent.modelPrefix ?? "") + options.model);
    }

    // Add any extra args
    if (options.args) {
      args.push(...options.args);
    }

    return args;
  }
}
