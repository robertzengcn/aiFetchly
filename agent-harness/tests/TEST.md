# Test Documentation - cli-anything-aifetchly

## Test Plan

### Test Files
| File | Type | Est. Tests |
|------|------|-----------|
| test_core.py | Unit | 20 |
| test_full_e2e.py | E2E | 15 |

### Unit Test Plan (test_core.py)

**TestCliConfig** (6 tests)
- resolve_db_path with explicit --db flag
- resolve_db_path raises on missing directory
- resolve_db_path raises on missing scraper.db
- is_database_in_use detects WAL file
- get_database_stats returns stats
- get_database_stats returns None for missing db

**TestFormatter** (2 tests)
- JSON envelope creation
- Error envelope creation

**TestSessionManager** (2 tests)
- Session create/load round-trip
- Command history max cap

**TestErrorClasses** (3 tests)
- ReadOnlyError message
- DatabaseNotFoundError message
- ValidationError message

**TestCLISubprocess** (2 tests)
- --help returns 0
- --version returns version

**TestDatabaseAdapter** (2 tests)
- Entity list completeness
- synchronize is false

### E2E Test Plan (test_full_e2e.py)

Uses a temporary SQLite database seeded with test data.

**TestTaskWorkflow** (4 tests)
- task list JSON output
- task list human-readable output
- task detail JSON output
- task detail not found error

**TestSearchWorkflow** (2 tests)
- search list JSON
- search results JSON

**TestContactWorkflow** (3 tests)
- contact list JSON
- contact search JSON
- contact export CSV

**TestScheduleWorkflow** (2 tests)
- schedule list JSON
- schedule detail JSON

**TestProxyWorkflow** (2 tests)
- proxy list JSON
- proxy detail JSON

**TestSystemWorkflow** (3 tests)
- system db-path JSON
- system db-stats JSON
- system status JSON

**TestDashboardWorkflow** (1 test)
- dashboard summary JSON

**TestReadOnlyMode** (2 tests)
- task create blocked in read-only
- task delete blocked in read-only

**TestCLISubprocessE2E** (2 tests)
- Full task workflow (list -> detail)
- Full contact search -> export workflow

## Test Results

*Tests will be executed and results appended after running:*
```bash
cd /home/robertzeng/project/aiFetchly
python3 -m pytest agent-harness/tests/ -v --tb=no
```
