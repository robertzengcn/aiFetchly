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
  .option("--json", "Output all responses as JSON")
  .option("--read-only", "Prevent write operations")
  .option("--verbose", "Enable verbose logging")
  .option("--session <id>", "Resume a saved session")
  .option("--no-repl", "Do not enter REPL mode when no command given");

// Register all command groups
registerAllCommands(program);

// Custom action for when no subcommand is provided
program.action(async (opts) => {
  try {
    // Resolve database path
    const dbDir = resolveDbPath(opts.db);

    // Warn if database appears to be in use
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

    // Initialize database connection
    CliDatabase.getInstance(dbDir);
    await CliDatabase.ensureInitialized();

    if (opts.verbose) {
      console.log(chalk.gray(`Connected to database: ${dbDir}/scraper.db`));
    }

    // Handle session
    const sessionManager = new SessionManager();
    if (opts.session) {
      sessionManager.load(opts.session);
    } else {
      sessionManager.create(dbDir);
    }

    // Enter REPL mode
    if (opts.repl !== false) {
      const repl = new CliRepl(program, sessionManager);
      await repl.start();
    }
  } catch (error) {
    formatError(error, opts.json || false, "init");
    process.exit(1);
  }
});

// Parse arguments - if a subcommand is given, execute it
const args = process.argv.slice(2);
if (args.length > 0 && !args[0].startsWith("-")) {
  // One-shot command mode
  (async () => {
    try {
      // Pre-parse global options for DB path
      const dbIdx = args.indexOf("--db");
      const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : undefined;

      const dbDir = resolveDbPath(dbPath);
      CliDatabase.getInstance(dbDir);
      await CliDatabase.ensureInitialized();

      await program.parseAsync(process.argv);
    } catch (error) {
      formatError(error, args.includes("--json"), "cli");
      process.exit(1);
    }
  })();
} else {
  // No subcommand or only flags - will enter REPL via action handler
  program.parseAsync(process.argv).catch((error: unknown) => {
    formatError(error, args.includes("--json"), "cli");
    process.exit(1);
  });
}
