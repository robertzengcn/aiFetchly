/**
 * Unit tests for BuckemailController read methods.
 *
 * Regression guard for the async-forEach bug: `getBuckEmailSendLog` and
 * `getBuckEmailTaskList` previously used `records.forEach(async ...)` which
 * does NOT await async callbacks. The `data.push(item)` ran *after* the
 * function returned the still-empty array, so every row — especially
 * Success rows that awaited getStatusName — was dropped. These tests seed
 * rows with both Success and Failure status and assert they all survive.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { EmailMarketingSendLogEntity } from "@/entity/EmailMarketingSendLog.entity";
import { EmailMarketingSendLogModel, SendStatus } from "@/model/emailMarketingSendLog.model";

const tmpDir = path.join(os.tmpdir(), "aifetchly-buckemail-controller");

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

// The Token-resolved USERSDBPATH must point at the test DB so the
// controller's BaseModule-backed modules read our seeded rows.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));
vi.mock("@/config/usersetting", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/config/usersetting")>();
  return {
    ...original,
    Token: class {
      getValue(name: string) {
        return name === "user_dbpath" ? tmpDir : "";
      }
    },
  };
});

import { BuckemailController } from "@/controller/buckemailController";

async function seedSendLogRow(
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

describe("BuckemailController.getBuckEmailSendLog", () => {
  it("returns all rows including Success (regression: async-forEach dropped them)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const taskId = 9001;
    await seedSendLogRow(
      taskId,
      SendStatus.Success,
      "alice@example.com",
      "Welcome Alice"
    );
    await seedSendLogRow(
      taskId,
      SendStatus.Success,
      "bob@example.com",
      "Welcome Bob"
    );
    await seedSendLogRow(
      taskId,
      SendStatus.Failure,
      "carol@example.com",
      "Welcome Carol"
    );

    const controller = new BuckemailController();
    const res = await controller.getBuckEmailSendLog(taskId, 0, 100);

    // The bug returned 0 rows; we expect all 3.
    expect(res.total).toBe(3);
    expect(res.records).toHaveLength(3);

    const receivers = res.records.map((r) => r.receiver).sort();
    expect(receivers).toEqual(
      ["alice@example.com", "bob@example.com", "carol@example.com"].sort()
    );

    // Status names resolved correctly per row.
    const successRows = res.records.filter((r) => r.status === "Success");
    expect(successRows).toHaveLength(2);
    const failureRows = res.records.filter((r) => r.status === "Failure");
    expect(failureRows).toHaveLength(1);
  });

  it("returns an empty result set when no rows exist for the task", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();

    const controller = new BuckemailController();
    const res = await controller.getBuckEmailSendLog(8888, 0, 100);

    expect(res.total).toBe(0);
    expect(res.records).toHaveLength(0);
  });
});
