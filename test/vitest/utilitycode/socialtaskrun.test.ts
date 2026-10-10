"use strict";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { SocialTaskRun } from "@/modules/socialtaskrun";

/**
 * SocialTaskRun.getrunlist smoke test against a real (throwaway) scraper.db.
 *
 * The test previously constructed `new SocialTaskRun()` with no dbpath — the
 * data layer then failed to open the database. getrunlist itself never
 * touches Electron paths (getApplogpath is only used by createsocialtaskrun),
 * so a temp directory + task_run table is the only fixture needed. Rows are
 * seeded with raw inserts: the legacy Taskrundb raw-SQL class was migrated to
 * TaskRunModel on dev (ec3267e6), so seeding goes straight through
 * better-sqlite3 against the same DDL the app ships.
 */
describe("socialtaskrun", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "socialtaskrun-"));
    const raw = new Database(path.join(tmp, "scraper.db"));
    raw.exec(
      `CREATE TABLE IF NOT EXISTS task_run(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        taskrun_num TEXT NULL,
        log_path TEXT NULL,
        record_time TEXT NULL
      )`
    );
    raw.close();

    // Seed two runs for task 69 so the list has known content.
    const insert = raw.prepare(
      "INSERT INTO task_run (task_id, taskrun_num, log_path) VALUES (?, ?, ?)"
    );
    insert.run(69, "r-1", "logfilepath");
    insert.run(69, "r-2", "logfilepath");
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("get-task-run-list", async () => {
    const stkrunModel = new SocialTaskRun(tmp);
    let callbackRows: number | null = null;
    const res = await stkrunModel.getrunlist(69, 0, 10, (rows) => {
      callbackRows = rows.length;
      return rows;
    });

    expect(res.Total).toBe(2);
    expect(res.Records.length).toBe(2);
    expect(res.Records[0].task_id).toBe(69);
    // Ordered by id desc — newest run first.
    expect(res.Records[0].taskrun_num).toBe("r-2");
    // Callback received the same rows.
    expect(callbackRows).toBe(2);
  });

  it("get-task-run-list for a task with no runs", async () => {
    const stkrunModel = new SocialTaskRun(tmp);
    const res = await stkrunModel.getrunlist(999, 0, 10);

    expect(res.Total).toBe(0);
    expect(res.Records).toEqual([]);
  });
});
