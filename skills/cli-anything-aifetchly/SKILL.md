---
name: "cli-anything-aifetchly"
description: "CLI for aiFetchly - AI-powered marketing automation. Manage tasks, contacts, email extraction, search scraping, scheduling from the command line."
---

# cli-anything-aifetchly

Command-line interface for aiFetchly marketing automation.

## Install

```bash
cd agent-harness && npm install && npm run build && npm link
cli-anything-aifetchly --help
```

## Global Options

- `--db <path>` Database directory (containing scraper.db)
- `--json` Machine-readable JSON output
- `--read-only` Block write operations
- `--verbose` Verbose logging
- `--session <id>` Resume session

## Commands

### task - Manage automation tasks
```
task list [--page N] [--size N] [--search QUERY] [--json]
task detail <id> [--json]
task create --name NAME --platform PLATFORM [--keywords KW1,KW2] [--json]
task update <id> [--name NAME] [--status STATUS] [--json]
task delete <id> [--json]
task results <id> [--page N] [--size N] [--json]
```

### search - Web search operations
```
search list [--page N] [--size N] [--json]
search detail <id> [--json]
search results <id> [--page N] [--size N] [--json]
search export <id> --format csv|json --output PATH [--json]
```

### contact - Contact management
```
contact list [--page N] [--size N] [--search QUERY] [--json]
contact search <query> [--json]
contact detail <id> [--json]
contact export --format csv|json --output PATH [--json]
```

### email-extraction - Email extraction
```
email-extraction list-searches [--page N] [--size N] [--json]
email-extraction get-results <taskId> [--page N] [--size N] [--json]
email-extraction get-task <id> [--json]
email-extraction export <taskId> --format csv|json --output PATH [--json]
```

### email-marketing - Email campaigns
```
email-marketing list-campaigns [--page N] [--size N] [--json]
email-marketing get-templates [--page N] [--size N] [--json]
email-marketing send-log <taskId> [--page N] [--size N] [--json]
```

### schedule - Task scheduling
```
schedule list [--page N] [--size N] [--json]
schedule detail <id> [--json]
schedule create --name NAME --cron EXPR --task-type TYPE --task-id ID [--json]
schedule update <id> [--cron EXPR] [--enabled BOOL] [--json]
schedule delete <id> [--json]
schedule enable <id> [--json]
schedule disable <id> [--json]
schedule execution-history <scheduleId> [--page N] [--size N] [--json]
```

### proxy - Proxy management
```
proxy list [--page N] [--size N] [--json]
proxy detail <id> [--json]
proxy add --host HOST --port PORT [--type TYPE] [--json]
proxy delete <id> [--json]
proxy import <filePath> [--json]
proxy check <id> [--json]
```

### social-account - Social media accounts
```
social-account list [--platform PLATFORM] [--json]
social-account detail <id> [--json]
social-account delete <id> [--json]
```

### yellow-pages - Yellow Pages scraping
```
yellow-pages list [--page N] [--size N] [--json]
yellow-pages results <taskId> [--page N] [--size N] [--json]
yellow-pages platforms [--json]
yellow-pages statistics [--json]
```

### maps - Maps search history
```
maps history --engine google|yandex [--page N] [--size N] [--json]
maps history-detail <id> --engine google|yandex [--json]
```

### knowledge - Knowledge base (RAG)
```
knowledge list-documents [--page N] [--size N] [--json]
knowledge search <query> [--json]
knowledge stats [--json]
```

### dashboard - Dashboard statistics
```
dashboard summary [--start-date DATE] [--end-date DATE] [--json]
dashboard trends [--group-by day|week|month] [--json]
```

### system - System information
```
system settings [--group GROUP] [--json]
system db-path [--json]
system db-stats [--json]
system status [--json]
```

## JSON Output

All commands support `--json`. Response envelope:
```json
{"status": true, "data": {...}, "meta": {"timestamp": "...", "command": "task:list"}}
```
Errors: `{"status": false, "data": null, "error": "..."}`

## Agent Usage

1. Always use `--json` for programmatic output
2. Use `--read-only` when inspecting data
3. Check `system status --json` first to verify database
4. Paginate with `--page` and `--size`
5. Database auto-detected or use `--db` / `AIFETCHLY_DB` env var
