import { createPrompt, isDownKey, isEnterKey, isUpKey, useKeypress, useState } from "@inquirer/core";
import type { AgentOption } from "../services/registry.js";
import * as ui from "../ui.js";

export type SectionMenuAction =
  | { type: "agent"; id: string }
  | { type: "apiKey" }
  | { type: "baseUrl" }
  | { type: "resync" }
  | { type: "reset" }
  | { type: "back" };

export interface SectionMenuConfig {
  agents: AgentOption[];
  apiKey: string | undefined;
  baseUrl: string | undefined;
  settingsOnly?: boolean;
  /** Section selected when the menu is redrawn after a settings action. */
  initialSection?: Section;
}

type Section = "agents" | "settings";

/**
 * One terminal screen for the top-level tabs and their content. Left/right
 * updates the selected tab and its list immediately; Enter opens an item.
 */
export const sectionTabs = createPrompt<SectionMenuAction, SectionMenuConfig>(
  (config, done) => {
    const [section, setSection] = useState<Section>(
      config.settingsOnly ? "settings" : (config.initialSection ?? "agents")
    );
    const [active, setActive] = useState(0);
    const settingsItems: SectionMenuAction[] = [
      { type: "apiKey" },
      { type: "baseUrl" },
      { type: "resync" },
      { type: "reset" },
    ];
    const items = section === "agents"
      ? config.agents.map((agent) => ({ type: "agent" as const, id: agent.value }))
      : settingsItems;

    useKeypress((key, readline) => {
      if ((key.name === "left" || key.name === "right" || key.name === "tab") && !config.settingsOnly) {
        readline.clearLine(0);
        setSection(section === "agents" ? "settings" : "agents");
        setActive(0);
      } else if (isUpKey(key)) {
        readline.clearLine(0);
        setActive((active - 1 + items.length) % items.length);
      } else if (isDownKey(key)) {
        readline.clearLine(0);
        setActive((active + 1) % items.length);
      } else if (key.name === "escape") {
        if (section === "settings" && !config.settingsOnly) {
          setSection("agents");
          setActive(0);
        } else {
          done({ type: "back" });
        }
      } else if (isEnterKey(key)) {
        done(items[active]);
      }
    });

    const names = section === "agents"
      ? config.agents.map((agent) => agent.name)
      : [
          `API Key: ${config.apiKey ? ui.val("Change " + config.apiKey.slice(0, 4) + "…" + config.apiKey.slice(-4)) : ui.dim("Set API key")}`,
          `Base URL: ${config.baseUrl ? ui.url(config.baseUrl) : ui.dim("Set base URL")}`,
          "Resync agent configs",
          "Reset API key and base URL",
        ];
    const list = names.map((name, index) =>
      `${index === active ? ui.sym.pointer : " "} ${name}`
    );

    return [
      ui.tabBar(section),
      ...list,
      ui.dim(config.settingsOnly
        ? "  ↑↓ navigate · Enter select · Esc back"
        : "  ← → switch tab · ↑↓ navigate · Enter select · Esc back"),
    ].join("\n");
  }
);
