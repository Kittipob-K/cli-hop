import { input, password } from "@inquirer/prompts";
import type { Settings } from "../types.js";
import { DEFAULT_MODELS_BASE_URL } from "../types.js";
import type { SettingsService } from "./settings.js";
import * as ui from "../ui.js";

/**
 * "Next best step" prerequisite check (forge-login style): before launching
 * an agent, verify the base URL and API key are configured; when missing,
 * show an input row right there instead of failing later.
 *
 *   ? CLI_HOP_BASE_URL = https://api.cli-hop.cc/v1
 *   ? CLI_HOP_API_KEY  = [input is hidden]
 *
 * Newly entered values are persisted to settings so the user is never
 * asked again.
 */

/** One text prompt. Hidden-entry prompts omit `default`; fakes implement this. */
export type Ask = (options: {
  message: string;
  default?: string;
  validate?: (value: string) => boolean | string;
}) => Promise<string>;

const inquirerAsk: Ask = (options) =>
  options.default === undefined
    ? password({ message: options.message, validate: options.validate })
    : input({ message: options.message, default: options.default, validate: options.validate });

/** Returns settings guaranteed to have both baseUrl and apiKey set. */
export async function ensurePrerequisites(
  settingsService: SettingsService,
  ask: Ask = inquirerAsk
): Promise<Settings> {
  let settings = await settingsService.load();
  let changed = false;

  if (!settings.baseUrl) {
    ui.info("Base URL is not configured yet.");
    const url = await ask({
      message: `${ui.envvar("CLI_HOP_BASE_URL")} =`,
      default: DEFAULT_MODELS_BASE_URL,
      validate: (v) => {
        const s = v.trim();
        if (!s) return true; // empty keeps the default
        try {
          new URL(s);
          return true;
        } catch {
          return "Enter a valid URL, e.g. https://api.cli-hop.cc/v1";
        }
      },
    });
    settings = { ...settings, baseUrl: url.trim() || DEFAULT_MODELS_BASE_URL };
    changed = true;
  }

  if (!settings.apiKey) {
    ui.info("API key is not configured yet.");
    ui.muted(`  Don't have a key? Create one at ${ui.url("https://cli-hop.cc/dashboard")}`);
    const key = await ask({
      message: `${ui.envvar("CLI_HOP_API_KEY")} =`,
      validate: (v) => (v.trim().length > 0 ? true : "API key cannot be empty"),
    });
    settings = { ...settings, apiKey: key.trim() };
    changed = true;
  }

  if (changed) {
    const location = await settingsService.save(settings);
    ui.ok(
      location === "keychain"
        ? "Saved to the OS keychain."
        : `Saved to ${settingsService.filePath}`
    );
  }

  return settings;
}
