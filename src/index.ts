#!/usr/bin/env node

import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { customizeCommand } from "./commands/customize.js";
import { settingsCommand } from "./commands/settings.js";
import { checkCommand } from "./commands/check.js";
import { updateCommand, performUpdate, startUpdateNotice } from "./commands/update.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("cli-hop")
  .description("CLI Hop Switch Pools - Switch AI models and agents easily")
  .version(VERSION)
  .option("--update", "Check npm for a newer release and install it", false)
  .hook("preAction", (_command, action) => {
    if (action.name() !== "update") startUpdateNotice();
  });

program.addCommand(runCommand);
program.addCommand(listCommand);
program.addCommand(customizeCommand);
program.addCommand(settingsCommand);
program.addCommand(checkCommand);
program.addCommand(updateCommand);

// Default flow: opening `cli-hop` with no subcommand launches the
// top-level AGENTS | SETTINGS interactive menu.
const userArgs = process.argv.slice(2);
if (userArgs.length === 0) {
  startUpdateNotice();
  await customizeCommand.parseAsync(["node", "cli-hop"]);
} else if (userArgs[0] === "--update") {
  await performUpdate();
} else {
  await program.parseAsync();
}
