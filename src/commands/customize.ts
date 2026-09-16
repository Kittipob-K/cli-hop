import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import { AgentService } from "../services/agent.js";
import { LaunchCoordinator } from "../services/launch.js";
import { PoolService } from "../services/pool.js";
import { SettingsService } from "../services/settings.js";
import { endpointFromModelsBaseUrl } from "../services/endpoint.js";
import { getAgentById, listAgentOptions } from "../services/registry.js";
import { ensureAgentInstalled } from "../services/installer.js";
import { ensurePrerequisites } from "../services/prereq.js";
import { sectionTabs } from "../prompts/section-tabs.js";
import type { Pool } from "../types.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import * as ui from "../ui.js";

/**
 * Default cli-hop flow: choose an AGENTS or SETTINGS section, then pick an
 * agent to customize, clear (unset) inherited environment, and launch it.
 */
async function pickPool(pools: Pool[]): Promise<string> {
  return select({
    message: "Select a model/pool:",
    choices: pools.map((p) => ({ name: `${p.name} (${p.model})`, value: p.id })),
  });
}

export const customizeCommand = new Command("customize")
  .description("Choose an agent CLI to customize and launch it")
  .action(async () => {
    const agentService = new AgentService();
    const poolService = new PoolService();
    const launch = new LaunchCoordinator(poolService, agentService);
    const settingsService = new SettingsService();

    try {
      // Show logo before anything else.
      ui.logo();

      // Main loop: the tab and its list share one screen. Switching tabs
      // immediately replaces the list; Enter activates its highlighted item.
      let initialSection: "agents" | "settings" = "agents";
      for (;;) {
        const savedSettings = await settingsService.load();
        const action = await sectionTabs({
          agents: listAgentOptions(savedSettings.lastAgentId),
          apiKey: savedSettings.apiKey,
          baseUrl: savedSettings.baseUrl,
          initialSection,
        });

        if (action.type === "back") return;

        if (action.type !== "agent") {
          // Settings actions are handled by the settings command's shared menu.
          // Import lazily to avoid a module cycle with this default flow.
          const { handleSettingsAction } = await import("./settings.js");
          await handleSettingsAction(action, settingsService);
          initialSection = "settings";
          console.log();
          continue;
        }
        initialSection = "agents";

        // Defer this until AGENTS is selected. This lets a user enter Settings
        // without first being forced through the credentials prompt.
        const settings = await ensurePrerequisites(settingsService);

        const agent = getAgentById(action.id);
        if (!agent) {
          ui.danger(`Agent "${action.id}" is not available yet.`);
          process.exit(1);
        }

        ui.h2(`Customizing ${agent.name}`);

        // 0. Install check (next-best-step): offer the official installer
        // when the CLI is missing; without it the later spawn would ENOENT.
        if (!(await ensureAgentInstalled(agent))) continue;

        // 1. Unset inherited credentials/proxy env before anything else.
        const removed = agentService.applyUnset(agent);
        if (removed.length > 0) {
          ui.text(`  ${ui.envvar("unset")} ${ui.envvar(removed.join(" "))}`);
        } else {
          ui.muted("  (no env vars to unset)");
        }

        // 2. The key + endpoint are written into the Agent Config (ADR 0003);
        // nothing is injected into the environment.
        const endpoint = endpointFromModelsBaseUrl(
          settings.baseUrl ?? DEFAULT_MODELS_BASE_URL
        );
        ui.muted(
          `  credentials delivered via ${agent.name}'s config — no env export`
        );

        // 3. Pull the model list from the CLI Hop API and let the user choose.
        const spinner = new ui.Spinner("Fetching models from CLI Hop API");
        const { pools, source, error, models } = await launch.resolvePools(settings);
        spinner.stop();
        if (source === "local" && error) {
          ui.warn(`${error} — using local pools`);
        } else if (source === "local" && !settings.apiKey) {
          ui.warn("No API key set — using local pools (set one in Settings)");
        } else if (source === "remote") {
          ui.ok(`${pools.length} models loaded from API`);
        }

        const compatiblePools = launch.compatiblePools(pools, agent);
        if (compatiblePools.length === 0) {
          ui.danger(`No available CLI Hop models support ${agent.name}.`);
          continue;
        }
        const poolId = await pickPool(compatiblePools);
        const pool = compatiblePools.find((p) => p.id === poolId);
        if (!pool) {
          ui.danger(`Pool "${poolId}" not found`);
          process.exit(1);
        }

        ui.info(
          `Configuring ${agent.name} → ${ui.url(endpoint)} (${ui.val(pool.model)})`
        );
        const prepared = await launch.prepare({
          agent,
          poolId,
          model: pool.model,
          settings,
          models,
        });
        for (const file of prepared.changedFiles) ui.ok(ui.filepath(file));
        if (agent.scrubShellConfig && await confirm({
          message: `Remove stale ${agent.name} exports from your shell rc files?`,
          default: false,
        })) {
          const touched = await agentService.scrubShellConfig(agent);
          touched.length > 0
            ? ui.ok(`scrubbed ${touched.map(ui.filepath).join(", ")}`)
            : ui.muted("  (no stale exports found)");
        }

        ui.h2(`🚀 Starting ${agent.name} with model ${pool.model}`);
        await settingsService.save({ ...settings, lastAgentId: agent.id });
        process.exit(await launch.runPrepared(agent, prepared));
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        process.exit(0);
      }
      ui.danger(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
