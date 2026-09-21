import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ConfigProbe } from "../types.js";
import { CLAUDE_CODE_ENV_KEYS } from "../types.js";
import { writeSecureFile } from "./secure-file.js";
import { readJsonDocument } from "./config-document.js";
import { scrubShellRc } from "./shell-scrub.js";

/**
 * Configures Claude Code the same way the CLI Hop one-line installer does:
 * writes ~/.claude.json and ~/.claude/settings.json so the `claude` CLI
 * talks to the CLI Hop endpoint with the user's key — no onboarding,
 * no stale OAuth credentials, key pre-approved.
 */
export interface ClaudeConfigInput {
  /** Primary API key (ccsk-...). */
  apiKey: string;
  /** Endpoint root WITHOUT the /v1 suffix, e.g. https://api.cli-hop.cc */
  endpoint: string;
  /** Model id to configure, e.g. claude-opus-4-8. */
  model: string;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return (await readJsonDocument(file, {
    invalidMessage: (path) => `${path} is not valid JSON - fix it before switching pools`,
  })).value;
}

async function writeJson(
  file: string,
  data: unknown,
  secureParent: boolean
): Promise<void> {
  await writeSecureFile(file, `${JSON.stringify(data, null, 2)}\n`, { secureParent });
}

/** Approve the key's last-20-char tail so claude does not prompt about it. */
function approveKeyTail(
  state: Record<string, unknown>,
  apiKey: string
): Record<string, unknown> {
  const tail = apiKey.slice(-20);
  const old = (state.customApiKeyResponses ?? {}) as Record<string, unknown>;
  const approved = Array.isArray(old.approved) ? [...(old.approved as string[])] : [];
  const rejected = Array.isArray(old.rejected) ? [...(old.rejected as string[])] : [];
  if (!approved.includes(tail)) approved.push(tail);
  return { ...state, customApiKeyResponses: { approved, rejected } };
}

export class ClaudeConfigService {
  readonly claudeJsonPath: string;
  readonly settingsPath: string;

  constructor(paths?: { claudeJsonPath: string; settingsPath: string }) {
    const home = homedir();
    this.claudeJsonPath = paths?.claudeJsonPath ?? join(home, ".claude.json");
    this.settingsPath = paths?.settingsPath ?? join(home, ".claude", "settings.json");
  }

  /** The currently configured model, when settings.json exists (Resync). */
  async probe(): Promise<ConfigProbe> {
    try {
      const { value, existed } = await readJsonDocument(this.settingsPath, {
        invalidMessage: () => "",
      });
      return {
        exists: existed,
        model: typeof value.model === "string" ? value.model : undefined,
      };
    } catch {
      // Malformed config still counts as existing — Resync rewrites it.
      return { exists: true };
    }
  }

  async apply(input: ClaudeConfigInput): Promise<string[]> {
    const changed: string[] = [];
    const { apiKey, endpoint, model } = input;

    // 1. ~/.claude.json — onboarding flags + key approval (installer parity).
    const state = approveKeyTail(await readJson(this.claudeJsonPath), apiKey);
    state.hasCompletedOnboarding = true;
    state.bypassPermissionsModeAccepted = true;
    await writeJson(this.claudeJsonPath, state, false);
    changed.push(this.claudeJsonPath);

    // 2. ~/.claude/settings.json — env, model, permissions (installer parity).
    const settings = approveKeyTail(await readJson(this.settingsPath), apiKey);
    settings.hasCompletedOnboarding = true;
    if (settings.cleanupPeriodDays == null) settings.cleanupPeriodDays = 30;

    const env = (settings.env ?? {}) as Record<string, string>;
    env.ANTHROPIC_BASE_URL = endpoint;
    env.ANTHROPIC_API_KEY = apiKey;
    env.CLAUDE_CODE_ATTRIBUTION_HEADER = "0";
    delete env.ANTHROPIC_AUTH_TOKEN;
    settings.env = env;

    if (!settings.permissions) {
      settings.permissions = {
        allow: [
          "Edit", "Read", "Write", "Bash", "Agent", "Glob", "Grep",
          "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop",
          "WebSearch", "WebFetch", "NotebookEdit", "Skill",
          "AskUserQuestion", "EnterPlanMode", "ExitPlanMode",
        ],
        deny: [],
        ask: [],
        defaultMode: "bypassPermissions",
      };
    }
    if (!settings.model) settings.model = model;

    await writeJson(this.settingsPath, settings, true);
    changed.push(this.settingsPath);

    // 3. Remove stale OAuth/credential files so the API key takes over.
    const claudeDir = dirname(this.settingsPath);
    for (const stale of [
      join(claudeDir, ".credentials.json"),
      join(claudeDir, "auth.json"),
    ]) {
      try {
        await unlink(stale);
        changed.push(`removed ${stale}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    return changed;
  }

  /**
   * Remove stale `export VAR=...` / `set -xe VAR ...` lines for the Claude
   * credential vars from common shell rc files (installer parity).
   * Returns the files that were modified.
   */
  async scrubShellRc(home: string = homedir()): Promise<string[]> {
    return scrubShellRc(CLAUDE_CODE_ENV_KEYS, home);
  }
}
