import { Command } from "commander";
import { PoolService } from "../services/pool.js";
import { SettingsService } from "../services/settings.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import * as ui from "../ui.js";

/**
 * User-invoked gateway health check. It never runs as part of another flow:
 * a launch must not block on the network. Only the connection outcome is
 * reported (reachable / key rejected / insufficient credits / network
 * failure) — never the API key or any response body.
 */
export const checkCommand = new Command("check")
  .description("Verify the CLI Hop gateway connection (reports status only, no secrets)")
  .action(async () => {
    const settingsService = new SettingsService();
    const settings = await settingsService.load();
    const baseUrl = settings.baseUrl ?? DEFAULT_MODELS_BASE_URL;

    if (!settings.apiKey) {
      ui.warn("No API key configured — add one in `cli-hop settings` first");
      process.exit(1);
    }

    const spinner = new ui.Spinner("Checking CLI Hop gateway");
    try {
      const models = await new PoolService().fetchRemoteModels(settings.apiKey, baseUrl);
      spinner.stop();
      ui.ok(
        `Gateway reachable at ${ui.url(baseUrl)} — ${models.length} model${models.length === 1 ? "" : "s"} available`
      );
    } catch (err) {
      spinner.stop();
      const status = (err as { status?: number }).status;
      if (status === 401) {
        ui.danger("API key rejected (401) — check your key in `cli-hop settings`");
      } else if (status === 402) {
        ui.danger("Insufficient credits (402) — top up your CLI Hop account");
      } else if (typeof status === "number") {
        ui.danger(`Gateway returned HTTP ${status} — the service may be unavailable`);
      } else {
        ui.danger("Network failure — could not reach the CLI Hop gateway");
      }
      process.exit(1);
    }
  });
