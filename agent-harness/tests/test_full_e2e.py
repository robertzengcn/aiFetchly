"""
E2E tests for the aiFetchly CLI harness.

Tests the full pipeline: create temp database -> seed data -> run commands -> verify output.
Uses real SQLite operations through the CLI's database adapter.
"""

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import pytest


def _resolve_cli(name):
    """Resolve installed CLI command; falls back to ts-node for dev."""
    import shutil
    force = os.environ.get("CLI_ANYTHING_FORCE_INSTALLED", "").strip() == "1"
    path = shutil.which(name)
    if path:
        print(f"[_resolve_cli] Using installed command: {path}")
        return [path]
    if force:
        raise RuntimeError(f"{name} not found in PATH. Install with: pip install -e .")
    cli_path = os.path.join(os.getcwd(), "agent-harness", "bin", "cli.ts")
    print(f"[_resolve_cli] Falling back to: ts-node {cli_path}")
    return ["npx", "ts-node", "-P", "agent-harness/tsconfig.cli.json", cli_path]


CLI_BASE = _resolve_cli("cli-anything-aifetchly")


def _run_cli(args, check=True, timeout=30):
    """Run the CLI command with the given arguments."""
    return subprocess.run(
        CLI_BASE + args,
        capture_output=True,
        text=True,
        check=check,
        timeout=timeout,
    )


@pytest.fixture
def test_db(tmp_path):
    """Create a temporary database with seed data for testing."""
    db_dir = str(tmp_path)
    db_path = os.path.join(db_dir, "scraper.db")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Create essential tables (matching TypeORM entity schemas)
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS task_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            platform TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            keywords TEXT DEFAULT '[]',
            description TEXT DEFAULT '',
            "createdAt" TEXT DEFAULT (datetime('now')),
            "updatedAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS search_task_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            enginer_id INTEGER DEFAULT 1,
            keyword TEXT DEFAULT '',
            status INTEGER DEFAULT 0,
            "createdAt" TEXT DEFAULT (datetime('now')),
            "updatedAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS search_result_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            taskId INTEGER DEFAULT 0,
            link TEXT DEFAULT '',
            title TEXT DEFAULT '',
            snippet TEXT DEFAULT '',
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS contact_info_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            extractionStatus TEXT DEFAULT 'pending',
            extractionDate TEXT,
            resultId INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS proxy_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            host TEXT DEFAULT '',
            port INTEGER DEFAULT 0,
            username TEXT DEFAULT '',
            password TEXT DEFAULT '',
            type TEXT DEFAULT 'http',
            status TEXT DEFAULT 'unchecked',
            "lastChecked" TEXT,
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS schedule_task_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT DEFAULT '',
            cronExpression TEXT DEFAULT '',
            taskType TEXT DEFAULT '',
            taskId INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            status TEXT DEFAULT 'active',
            "lastRunAt" TEXT,
            "nextRunAt" TEXT,
            "createdAt" TEXT DEFAULT (datetime('now')),
            "updatedAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS email_search_task_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT DEFAULT 'pending',
            "createdAt" TEXT DEFAULT (datetime('now')),
            "updatedAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS email_search_result_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            taskId INTEGER DEFAULT 0,
            email TEXT DEFAULT '',
            source TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS social_account_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            social_type_id TEXT DEFAULT '',
            username TEXT DEFAULT '',
            password TEXT DEFAULT '',
            status TEXT DEFAULT 'active',
            "lastUsed" TEXT,
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS yellow_pages_task_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT DEFAULT '',
            location TEXT DEFAULT '',
            keyword TEXT DEFAULT '',
            status TEXT DEFAULT 'pending',
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS yellow_pages_result_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            taskId INTEGER DEFAULT 0,
            name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            website TEXT DEFAULT '',
            email TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS system_setting_group_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT DEFAULT '',
            description TEXT DEFAULT '',
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS system_setting_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT DEFAULT '',
            value TEXT DEFAULT '',
            groupId INTEGER DEFAULT 0,
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS r_a_g_document_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT DEFAULT '',
            type TEXT DEFAULT '',
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS r_a_g_chunk_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            documentId INTEGER DEFAULT 0,
            content TEXT DEFAULT '',
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS google_maps_search_record_entity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT DEFAULT '',
            location TEXT DEFAULT '',
            results TEXT DEFAULT '[]',
            "createdAt" TEXT DEFAULT (datetime('now'))
        );

        -- Seed data
        INSERT INTO task_entity (name, platform, status, description)
        VALUES
            ('Test Task 1', 'google', 'completed', 'First test task'),
            ('Test Task 2', 'linkedin', 'pending', 'Second test task'),
            ('Test Task 3', 'google', 'running', 'Third test task');

        INSERT INTO search_task_entity (enginer_id, keyword, status)
        VALUES (1, 'marketing automation', 2), (2, 'email marketing', 1);

        INSERT INTO search_result_entity (taskId, link, title, snippet)
        VALUES
            (1, 'https://example.com/1', 'Result 1', 'Snippet 1'),
            (1, 'https://example.com/2', 'Result 2', 'Snippet 2'),
            (2, 'https://example.com/3', 'Result 3', 'Snippet 3');

        INSERT INTO contact_info_entity (email, phone, address, extractionStatus)
        VALUES
            ('john@example.com', '+1234567890', '123 Main St', 'completed'),
            ('jane@example.com', '+0987654321', '456 Oak Ave', 'completed'),
            ('bob@example.com', '+1122334455', '789 Pine Rd', 'pending');

        INSERT INTO proxy_entity (host, port, type, status)
        VALUES
            ('proxy1.example.com', 8080, 'http', 'working'),
            ('proxy2.example.com', 3128, 'socks5', 'unchecked');

        INSERT INTO schedule_task_entity (name, cronExpression, taskType, taskId, is_active, status)
        VALUES
            ('Daily Scrape', '0 9 * * *', 'search', 1, 1, 'active'),
            ('Weekly Report', '0 0 * * 1', 'email', 2, 0, 'inactive');

        INSERT INTO social_account_entity (social_type_id, username, status)
        VALUES ('facebook', 'user1', 'active'), ('twitter', 'user2', 'active');

        INSERT INTO yellow_pages_task_entity (platform, location, keyword, status)
        VALUES ('yelp', 'New York', 'restaurants', 'completed');

        INSERT INTO yellow_pages_result_entity (taskId, name, phone, address, website, email)
        VALUES (1, 'Test Restaurant', '+111222333', '100 Broadway', 'https://test.com', 'info@test.com');

        INSERT INTO r_a_g_document_entity (name, type)
        VALUES ('marketing-guide.pdf', 'pdf'), ('sales-playbook.docx', 'docx');

        INSERT INTO r_a_g_chunk_entity (documentId, content)
        VALUES (1, 'Marketing automation best practices...'), (1, 'Email campaign strategies...'), (2, 'Sales playbook chapter 1...');
    """)

    conn.commit()
    conn.close()

    return db_dir


class TestTaskWorkflow:
    """Test task management workflow."""

    def test_task_list_json(self, test_db):
        """task list --json returns valid JSON with seeded tasks."""
        result = _run_cli(["--db", test_db, "task", "list", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True
        assert data["data"]["total"] == 3
        assert len(data["data"]["items"]) == 3

    def test_task_list_human(self, test_db):
        """task list without --json shows human-readable table."""
        result = _run_cli(["--db", test_db, "task", "list"])
        assert result.returncode == 0
        assert "Test Task 1" in result.stdout

    def test_task_detail_json(self, test_db):
        """task detail returns a single task."""
        result = _run_cli(["--db", test_db, "task", "detail", "1", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True
        assert data["data"]["name"] == "Test Task 1"

    def test_task_detail_not_found(self, test_db):
        """task detail for non-existent ID returns error."""
        result = _run_cli(["--db", test_db, "task", "detail", "999", "--json"], check=False)
        assert result.returncode != 0
        data = json.loads(result.stderr)
        assert data["status"] is False


class TestSearchWorkflow:
    """Test search operations workflow."""

    def test_search_list_json(self, test_db):
        """search list --json returns search tasks."""
        result = _run_cli(["--db", test_db, "search", "list", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True

    def test_search_results_json(self, test_db):
        """search results returns results for a task."""
        result = _run_cli(["--db", test_db, "search", "results", "1", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True


class TestContactWorkflow:
    """Test contact management workflow."""

    def test_contact_list_json(self, test_db):
        """contact list --json returns contacts."""
        result = _run_cli(["--db", test_db, "contact", "list", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True
        assert data["data"]["total"] == 3

    def test_contact_search_json(self, test_db):
        """contact search finds matching contacts."""
        result = _run_cli(["--db", test_db, "contact", "search", "john", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True

    def test_contact_export_csv(self, test_db, tmp_path):
        """contact export --format csv creates a CSV file."""
        output = str(tmp_path / "contacts.csv")
        result = _run_cli(["--db", test_db, "contact", "export", "--format", "csv", "--output", output, "--json"])
        assert result.returncode == 0
        assert os.path.exists(output)


class TestScheduleWorkflow:
    """Test schedule management workflow."""

    def test_schedule_list_json(self, test_db):
        """schedule list --json returns schedules."""
        result = _run_cli(["--db", test_db, "schedule", "list", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True

    def test_schedule_detail_json(self, test_db):
        """schedule detail returns a single schedule."""
        result = _run_cli(["--db", test_db, "schedule", "detail", "1", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True


class TestProxyWorkflow:
    """Test proxy management workflow."""

    def test_proxy_list_json(self, test_db):
        """proxy list --json returns proxies."""
        result = _run_cli(["--db", test_db, "proxy", "list", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True

    def test_proxy_detail_json(self, test_db):
        """proxy detail returns a single proxy."""
        result = _run_cli(["--db", test_db, "proxy", "detail", "1", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True


class TestSystemWorkflow:
    """Test system information commands."""

    def test_system_db_path_json(self, test_db):
        """system db-path shows the database path."""
        result = _run_cli(["--db", test_db, "system", "db-path", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True
        assert "scraper.db" in data["data"]["dbFile"]

    def test_system_db_stats_json(self, test_db):
        """system db-stats shows database statistics."""
        result = _run_cli(["--db", test_db, "system", "db-stats", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True
        assert data["data"]["dbSize"] > 0

    def test_system_status_json(self, test_db):
        """system status shows overall system status."""
        result = _run_cli(["--db", test_db, "system", "status", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True


class TestDashboardWorkflow:
    """Test dashboard statistics commands."""

    def test_dashboard_summary_json(self, test_db):
        """dashboard summary returns aggregate statistics."""
        result = _run_cli(["--db", test_db, "dashboard", "summary", "--json"])
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["status"] is True
        assert "totalTasks" in data["data"]


class TestReadOnlyMode:
    """Test that --read-only flag prevents mutations."""

    def test_task_create_blocked(self, test_db):
        """task create is blocked in read-only mode."""
        result = _run_cli(
            ["--db", test_db, "--read-only", "task", "create",
             "--name", "Blocked Task", "--platform", "google", "--json"],
            check=False,
        )
        assert result.returncode != 0

    def test_task_delete_blocked(self, test_db):
        """task delete is blocked in read-only mode."""
        result = _run_cli(
            ["--db", test_db, "--read-only", "task", "delete", "1", "--json"],
            check=False,
        )
        assert result.returncode != 0


class TestCLISubprocessE2E:
    """Full E2E subprocess tests simulating agent usage."""

    def test_full_task_workflow(self, test_db):
        """Agent workflow: list -> detail -> results."""
        # Step 1: List tasks
        list_result = _run_cli(["--db", test_db, "task", "list", "--json"])
        assert list_result.returncode == 0
        list_data = json.loads(list_result.stdout)
        task_id = list_data["data"]["items"][0]["id"]

        # Step 2: Get task detail
        detail_result = _run_cli(["--db", test_db, "task", "detail", str(task_id), "--json"])
        assert detail_result.returncode == 0
        detail_data = json.loads(detail_result.stdout)
        assert detail_data["data"]["id"] == task_id

        print(f"\n  Task workflow: listed {list_data['data']['total']} tasks, detailed task {task_id}")

    def test_full_contact_search_export(self, test_db, tmp_path):
        """Agent workflow: search contacts -> export results."""
        # Step 1: Search contacts
        search_result = _run_cli(["--db", test_db, "contact", "search", "john", "--json"])
        assert search_result.returncode == 0

        # Step 2: Export all contacts
        output = str(tmp_path / "export.json")
        export_result = _run_cli(["--db", test_db, "contact", "export", "--format", "json", "--output", output, "--json"])
        assert export_result.returncode == 0

        print(f"\n  Contact export: {output}")
