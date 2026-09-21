import { Command } from "commander";
import { confirm, input, password } from "@inquirer/prompts";
import { SettingsService } from "../services/settings.js";
import { ResyncService } from "../services/resync.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import { sectionTabs, type SectionMenuAction } from "../prompts/section-tabs.js";
import * as ui from "../ui.js";

export type SettingsMenuResult = "back";

/** The prompts the settings menu needs; fakes implement these for tests. */
export interface SettingsPrompts {
  /** API key entry — hidden input. */
  password: (options: { message: string; validate?: (value: string) => boolean | string }) => Promise<string>;
  /** Base URL entry — visible input with a default. */
  input: (options: { message: string; default?: string; validate?: (value: string) => boolean | string }) => Promise<string>;
  /** Yes/no confirmation. */
  confirm: (options: { message: string; default?: boolean }) => Promise<boolean>;
}

const inquirerPrompts: SettingsPrompts = { password, input, confirm };

export async function handleSettingsAction(
  action: Exclude<SectionMenuAction, { type: "agent" } | { type: "back" }>,
  settingsService: SettingsService,
  resyncService?: ResyncService,
  prompts: SettingsPrompts = inquirerPrompts
): Promise<SettingsMenuResult> {
  const settings = await settingsService.load();

  if (action.type === "apiKey") {
    const apiKey = await prompts.password({
      message: `${ui.envvar("CLI_HOP_API_KEY")} =`,
      validate: (value) => value.trim() ? true : "API key cannot be empty",
    });
    const location = await settingsService.setApiKey(apiKey.trim());
    ui.ok(location === "keychain"
      ? "API key saved to the OS keychain."
      : `API key saved to ${settingsService.filePath}`);
    return "back";
  }

  if (action.type === "baseUrl") {
    const baseUrl = await prompts.input({
      message: `${ui.envvar("CLI_HOP_BASE_URL")} =`,
      default: settings.baseUrl ?? DEFAULT_MODELS_BASE_URL,
      validate: (value) => {
        try { new URL(value.trim()); return true; }
        catch { return "Enter a valid URL, e.g. https://api.cli-hop.cc/v1"; }
      },
    });
    await settingsService.save({ ...settings, baseUrl: baseUrl.trim() });
    ui.ok(`Base URL saved to ${settingsService.filePath}`);
    return "back";
  }

  if (action.type === "resync") {
    if (!settings.apiKey) {
      ui.warn("Set an API key first — Resync needs it to rewrite agent configs.");
      return "back";
    }
    const spinner = new ui.Spinner("Resyncing agent configs");
    const result = await (resyncService ?? new ResyncService()).run(settings);
    spinner.stop();
    for (const file of result.files) ui.ok(ui.filepath(file));
    for (const { agent, reason } of result.skipped) {
      ui.muted(
        `  skipped ${ui.val(agent)} (${reason === "not-installed" ? "not installed" : reason === "no-config" ? "no config yet" : "no supported model"})`
      );
    }
    for (const { agent, error } of result.failed) {
      ui.danger(`${agent} resync failed: ${error}`);
    }
    if (result.files.length === 0 && result.failed.length === 0) {
      ui.muted("  nothing to resync — no installed agents with existing configs");
    }
    return "back";
  }

  const shouldReset = await prompts.confirm({
    message: "Clear the API key and Base URL?",
    default: false,
  });
  if (!shouldReset) return "back";

  // Keep lastAgentId: credential reset should not erase the user's menu history.
  await settingsService.setApiKey(undefined);
  await settingsService.save({ lastAgentId: settings.lastAgentId });
  ui.warn("API key and Base URL cleared.");
  return "back";
}

/** Interactive settings menu — also exposed as `cli-hop settings`. */
export async function runSettingsMenu(): Promise<SettingsMenuResult> {
  const settingsService = new SettingsService();
  for (;;) {
    const settings = await settingsService.load();
    const action = await sectionTabs({
      agents: [],
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      settingsOnly: true,
    });
    if (action.type === "back") return "back";
    if (action.type === "agent") continue;
    await handleSettingsAction(action, settingsService);
  }
}

export const settingsCommand = new Command("settings")
  .description("Configure cli-hop settings, e.g. the primary API key")
  .action(async () => {
    try {
      await runSettingsMenu();
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        process.exit(0);
      }
      ui.danger(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
