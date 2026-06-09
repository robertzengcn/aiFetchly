/**
 * REPL mode - interactive command-line interface for aiFetchly.
 * Uses readline for input/output with tab completion.
 */

import * as readline from 'readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { SessionManager } from '../session/session-manager';

const COMMAND_LIST = [
  'task list', 'task detail', 'task create', 'task update', 'task delete', 'task results',
  'search list', 'search detail', 'search results', 'search export',
  'contact list', 'contact search', 'contact export', 'contact detail',
  'email-extraction list-searches', 'email-extraction get-results', 'email-extraction export',
  'email-marketing list-campaigns', 'email-marketing get-templates', 'email-marketing send-log',
  'schedule list', 'schedule detail', 'schedule create', 'schedule update', 'schedule delete',
  'schedule enable', 'schedule disable', 'schedule execution-history',
  'proxy list', 'proxy add', 'proxy check', 'proxy delete', 'proxy import',
  'social-account list', 'social-account detail', 'social-account delete',
  'yellow-pages list', 'yellow-pages results', 'yellow-pages platforms', 'yellow-pages statistics',
  'maps history', 'maps history-detail',
  'knowledge list-documents', 'knowledge search', 'knowledge stats',
  'dashboard summary', 'dashboard trends',
  'system settings', 'system db-path', 'system db-stats', 'system status',
];

const DOT_COMMANDS = ['.help', '.exit', '.quit', '.session', '.context', '.json', '.table', '.history'];

export class CliRepl {
  private rl: readline.Interface;
  private program: Command;
  private sessionManager: SessionManager;

  constructor(program: Command, sessionManager: SessionManager) {
    this.program = program;
    this.sessionManager = sessionManager;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: this.completer.bind(this),
      historySize: 100,
    });
  }

  async start(): Promise<void> {
    this.printBanner();
    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      if (trimmed.startsWith('.')) {
        this.handleDotCommand(trimmed);
        this.rl.prompt();
        return;
      }

      this.sessionManager.addToHistory(trimmed);

      try {
        const args = this.parseLine(trimmed);
        await this.program.parseAsync(args, { from: 'user' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error: ${message}`));
      }

      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.printGoodbye();
      process.exit(0);
    });

    this.rl.setPrompt('aifetchly> ');
    this.rl.prompt();
  }

  private handleDotCommand(cmd: string): void {
    const session = this.sessionManager.getCurrent();
    switch (cmd) {
      case '.help':
        this.printHelp();
        break;
      case '.exit':
      case '.quit':
        this.rl.close();
        break;
      case '.session':
        if (session) {
          console.log(`Session: ${session.id}`);
          console.log(`  DB: ${session.dbPath}`);
          console.log(`  Created: ${session.createdAt}`);
          console.log(`  Commands: ${session.commandHistory.length}`);
        } else {
          console.log(chalk.yellow('No active session'));
        }
        break;
      case '.context':
        if (session) {
          console.log('Context:', JSON.stringify(session.context, null, 2));
        }
        break;
      case '.json':
        this.sessionManager.updateContext({ outputFormat: 'json' });
        console.log(chalk.green('Output mode: JSON'));
        break;
      case '.table':
        this.sessionManager.updateContext({ outputFormat: 'table' });
        console.log(chalk.green('Output mode: Table'));
        break;
      case '.history':
        if (session) {
          const history = session.commandHistory.slice(-20);
          history.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
        }
        break;
      default:
        console.log(chalk.yellow(`Unknown command: ${cmd}`));
    }
  }

  private completer(line: string): [string[], string] {
    const allCompletions = [...COMMAND_LIST, ...DOT_COMMANDS];
    const hits = allCompletions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : allCompletions, line];
  }

  private parseLine(line: string): string[] {
    // Simple argument parsing - split by spaces, respecting quotes
    const args: string[] = ['node', 'cli'];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of line) {
      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === ' ') {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    if (current) args.push(current);
    return args;
  }

  private printBanner(): void {
    console.log(chalk.cyan.bold(`
  ╔═══════════════════════════════════════════╗
  ║   aiFetchly CLI v1.0.0                   ║
  ║   AI-Powered Marketing Automation        ║
  ╚═══════════════════════════════════════════╝
`));
    console.log(chalk.gray('Type .help for commands, .exit to quit'));
  }

  private printHelp(): void {
    console.log(chalk.bold('\nCommand Groups:'));
    const groups = [
      { name: 'task', desc: 'Manage automation tasks' },
      { name: 'search', desc: 'Web search operations' },
      { name: 'contact', desc: 'Contact management' },
      { name: 'email-extraction', desc: 'Email extraction' },
      { name: 'email-marketing', desc: 'Email marketing' },
      { name: 'schedule', desc: 'Task scheduling' },
      { name: 'proxy', desc: 'Proxy management' },
      { name: 'social-account', desc: 'Social media accounts' },
      { name: 'yellow-pages', desc: 'Yellow Pages scraping' },
      { name: 'maps', desc: 'Maps search history' },
      { name: 'knowledge', desc: 'Knowledge base (RAG)' },
      { name: 'dashboard', desc: 'Dashboard statistics' },
      { name: 'system', desc: 'System settings & status' },
    ];
    for (const g of groups) {
      console.log(`  ${chalk.cyan(g.name.padEnd(20))} ${g.desc}`);
    }
    console.log(chalk.bold('\nREPL Commands:'));
    console.log('  .help      Show this help');
    console.log('  .exit      Exit REPL');
    console.log('  .session   Show session info');
    console.log('  .context   Show/set context');
    console.log('  .json      Switch to JSON output');
    console.log('  .table     Switch to table output');
    console.log('  .history   Show command history');
  }

  private printGoodbye(): void {
    console.log(chalk.cyan('\nGoodbye from aiFetchly CLI!'));
  }
}
