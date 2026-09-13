/**
 * Unit tests for EmailMarketingSendLogModel.listAllRecentEmailMarketingSendLog
 * and countAllRecent — the task-agnostic recent send-log queries backing the
 * unified send-log view (aggregates legacy bulk-task sends with authorized
 * outbound sends).
 *
 * These mirror listEmailMarketingSendLog/countEmailMarketingSendLog minus the
 * task_id predicate, so the assertions confirm rows from DIFFERENT tasks all
 * surface together and that where/sort behave identically to the task-filtered
 * variants.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import {
  EmailMarketingSendLogModel,
  SendStatus,
} from "@/model/emailMarketingSendLog.model";
import type { SortBy } from "@/entityTypes/commonType";

const tmpDir = path.join(os.tmpdir(), "aifetchly-sendlog-model");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...original,
    Token: class {
      getValue(name: string) {
        return name === "user_dbpath" ? tmpDir : "";
      }
    },
  };
});

async function seedRow(
  taskId: number,
  status: SendStatus,
  receiver: string,
  title: string
): Promise<number> {
  const model = new EmailMarketingSendLogModel(tmpDir);
  const entity = new EmailMarketingSendLogEntity();
  entity.task_id = taskId;
  entity.status = status;
  entity.receiver = receiver;
  entity.title = title;
  entity.content = "";
  entity.log = "";
  entity.record_time = new Date().toISOString();
  return await model.create(entity);
}

describe("EmailMarketingSendLogModel.listAllRecentEmailMarketingSendLog", () => {
  it("returns rows across ALL tasks (no task_id filter)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedRow(1001, SendStatus.Success, "a@example.com", "Task A");
    await seedRow(1002, SendStatus.Success, "b@example.com", "Task B");
    await seedRow(1003, SendStatus.Failure, "c@example.com", "Task C");

    const model = new EmailMarketingSendLogModel(tmpDir);
    const rows = await model.listAllRecentEmailMarketingSendLog(0, 100);

    expect(rows).toHaveLength(3);
    const receivers = rows.map((r) => r.receiver).sort();
    expect(receivers).toEqual(
      ["a@example.com", "b@example.com", "c@example.com"].sort()
    );
  });

  it("defaults to newest-first (order by id DESC)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const ids: number[] = [];
    ids.push(await seedRow(1, SendStatus.Success, "first@x.com", "T1"));
    ids.push(await seedRow(1, SendStatus.Success, "second@x.com", "T2"));
    ids.push(await seedRow(1, SendStatus.Success, "third@x.com", "T3"));

    const model = new EmailMarketingSendLogModel(tmpDir);
    const rows = await model.listAllRecentEmailMarketingSendLog(0, 100);

    // newest first => ids descending
    expect(rows.map((r) => r.id)).toEqual([...ids].reverse());
  });

  it("applies the where filter across receiver/title/content", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedRow(1, SendStatus.Success, "alice@example.com", "Welcome Alice");
    await seedRow(1, SendStatus.Success, "bob@example.com", "Welcome Bob");
    await seedRow(1, SendStatus.Failure, "carol@example.com", "Other");

    const model = new EmailMarketingSendLogModel(tmpDir);
    const rows = await model.listAllRecentEmailMarketingSendLog(0, 100, "welcome");

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.receiver).sort()).toEqual(
      ["alice@example.com", "bob@example.com"].sort()
    );
  });

  it("respects explicit sort by status asc", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    // Failure(0) seeded first, Success(1) second — asc sort must put 0 before 1.
    await seedRow(1, SendStatus.Failure, "fail@x.com", "T");
    await seedRow(1, SendStatus.Success, "ok@x.com", "T");

    const sort: SortBy = { key: "status", order: "asc" };
    const model = new EmailMarketingSendLogModel(tmpDir);
    const rows = await model.listAllRecentEmailMarketingSendLog(0, 100, undefined, sort);

    expect(rows[0].status).toBe(SendStatus.Failure);
    expect(rows[1].status).toBe(SendStatus.Success);
  });

  it("rejects disallowed sort keys", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedRow(1, SendStatus.Success, "a@x.com", "T");

    const model = new EmailMarketingSendLogModel(tmpDir);
    const bad: SortBy = { key: "receiver", order: "asc" };
    await expect(
      model.listAllRecentEmailMarketingSendLog(0, 100, undefined, bad)
    ).rejects.toThrow("not allow sort key");
  });

  it("paginates with skip/take", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    for (let i = 0; i < 5; i++) {
      await seedRow(1, SendStatus.Success, `u${i}@x.com`, `T${i}`);
    }

    const model = new EmailMarketingSendLogModel(tmpDir);
    const page = await model.listAllRecentEmailMarketingSendLog(2, 2);
    expect(page).toHaveLength(2);
  });
});

describe("EmailMarketingSendLogModel.countAllRecent", () => {
  it("counts rows across all tasks", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedRow(1, SendStatus.Success, "a@x.com", "T");
    await seedRow(2, SendStatus.Success, "b@x.com", "T");
    await seedRow(3, SendStatus.Failure, "c@x.com", "T");

    const model = new EmailMarketingSendLogModel(tmpDir);
    expect(await model.countAllRecent()).toBe(3);
  });

  it("applies the where filter to the count", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    await seedRow(1, SendStatus.Success, "alice@example.com", "Welcome Alice");
    await seedRow(1, SendStatus.Success, "bob@example.com", "Welcome Bob");
    await seedRow(1, SendStatus.Failure, "carol@example.com", "Other");

    const model = new EmailMarketingSendLogModel(tmpDir);
    expect(await model.countAllRecent("welcome")).toBe(2);
  });

  it("returns 0 when no rows exist", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const model = new EmailMarketingSendLogModel(tmpDir);
    expect(await model.countAllRecent()).toBe(0);
  });
});
