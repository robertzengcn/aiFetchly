# cli-anything-aifetchly

CLI for aiFetchly - AI-powered marketing automation platform.

## Installation

```bash
cd agent-harness
npm install
npm run build
```

## Usage

### One-shot commands
```bash
# List tasks
node dist/bin/cli.js --db /path/to/data task list --json

# Get task detail
node dist/bin/cli.js task detail 1 --json

# Export contacts
node dist/bin/cli.js contact export --format csv --output contacts.csv --json

# System status
node dist/bin/cli.js system status --json
```

### Interactive REPL
```bash
node dist/bin/cli.js --db /path/to/data
# Enter aifetchly> prompt
```

### REPL Commands
- `.help` - List all commands
- `.exit` - Exit REPL
- `.session` - Show session info
- `.json` / `.table` - Toggle output mode
- `.history` - Show command history

## Global Options
| Flag | Description |
|------|-------------|
| `--db <path>` | Database directory path |
| `--json` | JSON output mode |
| `--read-only` | Prevent writes |
| `--verbose` | Verbose logging |
| `--session <id>` | Resume session |

## Command Groups
- `task` - Manage automation tasks (list, detail, create, update, delete, results)
- `search` - Web search operations (list, detail, results, export)
- `contact` - Contact management (list, search, detail, export)
- `email-extraction` - Email extraction (list-searches, get-results, export)
- `email-marketing` - Email campaigns (list-campaigns, get-templates, send-log)
- `schedule` - Task scheduling (list, detail, create, update, delete, enable, disable)
- `proxy` - Proxy management (list, add, check, delete, import)
- `social-account` - Social media accounts (list, detail, delete)
- `yellow-pages` - Yellow Pages scraping (list, results, platforms, statistics)
- `maps` - Maps search history (history, history-detail)
- `knowledge` - Knowledge base (list-documents, search, stats)
- `dashboard` - Dashboard statistics (summary, trends)
- `system` - System info (settings, db-path, db-stats, status)

## Running Tests
```bash
python3 -m pytest agent-harness/tests/ -v
python3 -m pytest agent-harness/tests/test_core.py -v     # Unit tests
python3 -m pytest agent-harness/tests/test_full_e2e.py -v  # E2E tests
```

## Database Path
Auto-detects at platform defaults:
- Windows: `%APPDATA%/aiFetchly/`
- macOS: `~/Library/Application Support/aiFetchly/`
- Linux: `~/.config/aiFetchly/`

Override with `--db` flag or `AIFETCHLY_DB` env var.
