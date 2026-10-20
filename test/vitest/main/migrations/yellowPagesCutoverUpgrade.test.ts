// test/vitest/main/migrations/yellowPagesCutoverUpgrade.test.ts
//
// G04/R03/AC-18 evidence: upgrade a REAL-shaped pre-cutover SQLite database
// (the legacy yellow_pages_task / yellow_pages_result / yellow_pages_platform
// tables plus their rows, exactly the shape shipped by the pre-removal app:
// src/sql/scraperdb/yellow_pages_*.sql at commit 1319d3dda^) through the
// current SqliteDb initialization. Assert:
//   1. preserved legacy data after synchronize/migrations run untouched;
//   2. no legacy yellow pages execution — a legacy scheduled row of type
//      yellow_pages is rejected by the task executor (Unsupported task type)
//      instead of spawning the removed legacy scraper.
import { describe, it, beforeEach, vi, expect } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Database from "better-sqlite3";
import { TaskExecutorService } from "@/modules/TaskExecutorService";
import type { ScheduleTaskEntity } from "@/entity/ScheduleTask.entity";

let tmpDir = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-ypl-upgrade-"));
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? "";
    }
  },
}));

/**
 * The pre-cutover table shapes, copied verbatim from the removed
 * src/sql/scraperdb/yellow_pages_*.sql (commit 1319d3dda^) so the seeded DB
 * matches what real users had, including the camelCase TypeORM audit columns.
 */
const LEGACY_PLATFORM_DDL = `CREATE TABLE IF NOT EXISTS yellow_pages_platform(
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL UNIQUE,
display_name TEXT NOT NULL,
base_url TEXT NOT NULL,
country TEXT NOT NULL,
language TEXT NOT NULL,
is_active BOOLEAN NOT NULL DEFAULT 1,
version TEXT NOT NULL DEFAULT '1.0.0',
rate_limit INTEGER NOT NULL DEFAULT 100,
delay_between_requests INTEGER NOT NULL DEFAULT 2000,
max_concurrent_requests INTEGER NOT NULL DEFAULT 1,
selectors TEXT NULL,
custom_extractors TEXT NULL,
type TEXT NOT NULL DEFAULT 'configuration',
class_name TEXT NULL,
module_path TEXT NULL,
settings TEXT NULL,
metadata TEXT NULL,
description TEXT NULL,
maintainer TEXT NULL,
documentation TEXT NULL,
createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

const LEGACY_TASK_DDL = `CREATE TABLE IF NOT EXISTS yellow_pages_task(
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
platform TEXT NOT NULL,
keywords TEXT NOT NULL,
location TEXT NULL,
max_pages INTEGER NOT NULL DEFAULT 1,
concurrency INTEGER NOT NULL DEFAULT 1,
status INTEGER NOT NULL DEFAULT 0,
scheduled_at DATETIME NULL,
completed_at DATETIME NULL,
error_log TEXT NULL,
run_log TEXT NULL,
account_id INTEGER NULL,
proxy_config TEXT NULL,
delay_between_requests INTEGER NOT NULL DEFAULT 2000,
headless BOOLEAN DEFAULT 1,
createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

const LEGACY_RESULT_DDL = `CREATE TABLE IF NOT EXISTS yellow_pages_result(
id INTEGER PRIMARY KEY AUTOINCREMENT,
task_id INTEGER NOT NULL,
business_name TEXT NOT NULL,
email TEXT NULL,
phone TEXT NULL,
website TEXT NULL,
address_street TEXT NULL,
address_city TEXT NULL,
address_state TEXT NULL,
address_zip TEXT NULL,
address_country TEXT NULL,
social_media TEXT NULL,
categories TEXT NULL,
business_hours TEXT NULL,
description TEXT NULL,
rating DECIMAL(3,2) NULL,
review_count INTEGER NULL,
scraped_at DATETIME NOT NULL,
platform TEXT NOT NULL,
raw_data TEXT NULL,
fax_number TEXT NULL,
contact_person TEXT NULL,
year_established INTEGER NULL,
number_of_employees TEXT NULL,
payment_methods TEXT NULL,
specialties TEXT NULL,
createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
)`;

/** Seed the pre-cutover database: legacy tables + realistic rows. */
function seedLegacyDatabase(dbPath: string): { taskId: number } {
  const legacy = new Database(dbPath);
  try {
    legacy.pragma("journal_mode = WAL");
    legacy.exec(LEGACY_PLATFORM_DDL);
    legacy.exec(LEGACY_TASK_DDL);
    legacy.exec(LEGACY_RESULT_DDL);
    legacy
      .prepare(
        `INSERT INTO yellow_pages_platform
           (name, display_name, base_url, country, language,
            type, class_name, module_path, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "itown",
        "爱同商圈",
        "https://www.dianping.com",
        "CN",
        "zh-CN",
        "configuration",
        "ITownPageAdapter",
        "./adapters/ITownPageAdapter",
        "Legacy directory platform configuration row."
      );
    legacy
      .prepare(
        `INSERT INTO yellow_pages_task
           (name, platform, keywords, location, max_pages, concurrency,
            status, delay_between_requests, headless)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "Chicago plumbers",
        "itown",
        JSON.stringify(["plumber", "emergency plumber"]),
        "Chicago, IL",
        3,
        2,
        2,
        1500,
        1
      );
    const taskIdRow = legacy
      .prepare("SELECT MAX(id) AS id FROM yellow_pages_task")
      .get() as { id: number | null };
    const taskId = Number(taskIdRow.id);
    const insertResult = legacy.prepare(
      `INSERT INTO yellow_pages_result
         (task_id, business_name, email, phone, website,
          address_street, address_city, address_state, address_zip,
          address_country, rating, review_count, scraped_at, platform)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertResult.run(
      taskId,
      "Northside Plumbing Co.",
      "contact@northsideplumbing.example",
      "+1 312 555 0110",
      "https://northsideplumbing.example",
      "2100 W North Ave",
      "Chicago",
      "IL",
      "60647",
      "US",
      4.5,
      128,
      "2026-09-30 10:00:00",
      "itown"
    );
    insertResult.run(
      taskId,
      "Loop HVAC Services",
      null,
      "+1 312 555 0122",
      null,
      "400 S State St",
      "Chicago",
      "IL",
      "60605",
      "US",
      3.9,
      57,
      "2026-09-30 10:02:00",
      "itown"
    );
    return { taskId };
  } finally {
    legacy.close();
  }
}

describe("yellow pages cutover upgrade (G04 / R03 / AC-18)", () => {
  it("preserves legacy yellow pages tables and rows through the upgrade", async () => {
    const { taskId } = seedLegacyDatabase(path.join(tmpDir, "scraper.db"));

    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const connection = SqliteDb.getInstance(tmpDir).connection;

    // Synchronize/migrations created the CURRENT schema...
    const scheduleTable = (await connection.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_task'`
    )) as { name: string }[];
    expect(scheduleTable).toHaveLength(1);

    // ...and left the unknown-to-metadata legacy tables byte-for-byte intact
    // (WAL: read through the DataSource connection).
    const platform = (await connection.query(
      `SELECT name, display_name, base_url, type, class_name
         FROM yellow_pages_platform`
    )) as {
      name: string;
      display_name: string;
      base_url: string;
      type: string;
      class_name: string;
    }[];
    expect(platform).toEqual([
      {
        name: "itown",
        display_name: "爱同商圈",
        base_url: "https://www.dianping.com",
        type: "configuration",
        class_name: "ITownPageAdapter",
      },
    ]);

    const task = (await connection.query(
      `SELECT id, name, platform, keywords, status
         FROM yellow_pages_task WHERE id = ?`,
      [taskId]
    )) as {
      id: number;
      name: string;
      platform: string;
      keywords: string;
      status: number;
    }[];
    expect(task).toEqual([
      {
        id: taskId,
        name: "Chicago plumbers",
        platform: "itown",
        keywords: JSON.stringify(["plumber", "emergency plumber"]),
        status: 2,
      },
    ]);

    const results = (await connection.query(
      `SELECT business_name, email, phone, platform, rating
         FROM yellow_pages_result WHERE task_id = ? ORDER BY id`,
      [taskId]
    )) as {
      business_name: string;
      email: string | null;
      phone: string | null;
      platform: string;
      rating: number;
    }[];
    expect(results.map((r) => r.business_name)).toEqual([
      "Northside Plumbing Co.",
      "Loop HVAC Services",
    ]);
    expect(results[0].email).toBe("contact@northsideplumbing.example");
    expect(results[0].platform).toBe("itown");
  });

  it("never executes a legacy yellow_pages scheduled task after the cutover", async () => {
    seedLegacyDatabase(path.join(tmpDir, "scraper.db"));
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    // Real modules are acceptable: the dispatch rejects yellow_pages before
    // any collaborator module is invoked, and their constructors connect
    // lazily against the temp DB.
    const executor = new TaskExecutorService();

    const schedule = {
      id: 1,
      task_id: 17,
      task_type: "yellow_pages",
    } as unknown as ScheduleTaskEntity;

    await expect(executor.executeScheduledTask(schedule)).rejects.toThrow(
      /Unsupported task type: yellow_pages/
    );
  });
});
