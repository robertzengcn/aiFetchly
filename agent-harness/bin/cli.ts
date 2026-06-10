#!/usr/bin/env node
/**
 * aiFetchly CLI - Command-line interface for aiFetchly marketing automation.
 *
 * Usage:
 *   cli-anything-aifetchly [options] [command]
 *   cli-anything-aifetchly                    # Enter REPL mode
 *   cli-anything-aifetchly task list --json   # One-shot command
 *   cli-anything-aifetchly --db /path task list  # Specify database
 */

import { Command } from "commander";
import { CliDatabase } from "../src/adapter/cli-database";
import { resolveDbPath, isDatabaseInUse } from "../src/adapter/cli-config";
import { registerAllCommands } from "../src/commands";
import { CliRepl } from "../src/repl/repl";
import { SessionManager } from "../src/session/session-manager";
import { formatError } from "../src/output/formatter";
import chalk from "chalk";

const program = new Command();

program
  .name("cli-anything-aifetchly")
  .description("CLI for aiFetchly - AI-powered marketing automation")
  .version("1.0.0")
  .option("--db <path>", "Database directory path (containing scraper.db)")
  .option("--read-only", "Prevent write operations")
  .option("--verbose", "Enable verbose logging")
  .option("--session <id>", "Resume a saved session")
  .option("--no-repl", "Do not enter REPL mode when no command given");

// Register all command groups
registerAllCommands(program);

// Pre-hook: initialize database before any command runs
program.hook("preAction", async () => {
  const opts = program.opts();
  CliDatabase.setReadOnly(opts.readOnly || false);
  if (!CliDatabase["instance"]) {
    try {
      const dbDir = resolveDbPath(opts.db);
      CliDatabase.getInstance(dbDir);
      await CliDatabase.ensureInitialized();

      if (opts.verbose) {
        console.log(chalk.gray(`Connected to database: ${dbDir}/scraper.db`));
      }

      if (isDatabaseInUse(dbDir)) {
        console.log(
          chalk.yellow(
            "Warning: Database appears to be in use by the aiFetchly app."
          )
        );
        console.log(
          chalk.yellow(
            "Write operations may conflict. Use --read-only for safety.\n"
          )
        );
      }
    } catch (error) {
      formatError(error, false, "init");
      process.exit(1);
    }
  }
});

// Custom action for when no subcommand is provided - enter REPL
program.action(async (opts) => {
  try {
    const dbDir = resolveDbPath(opts.db);
    CliDatabase.getInstance(dbDir);
    await CliDatabase.ensureInitialized();

    const sessionManager = new SessionManager();
    if (opts.session) {
      sessionManager.load(opts.session);
    } else {
      sessionManager.create(dbDir);
    }

    if (opts.repl !== false) {
      const repl = new CliRepl(program, sessionManager);
      await repl.start();
    }
  } catch (error) {
    formatError(error, false, "init");
    process.exit(1);
  }
});

// Parse and execute
program.parseAsync(process.argv).catch((error: unknown) => {
  const args = process.argv.slice(2);
  formatError(error, args.includes("--json"), "cli");
  process.exit(1);
});
