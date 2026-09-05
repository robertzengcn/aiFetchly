import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSqliteTestFallbackDir, SqliteDb } from "@/config/SqliteDb";
import { ScheduleTaskModel } from "@/model/ScheduleTask.model";
import { OutboundEmailDeliveryService } from "@/service/outboundEmail/OutboundEmailDeliveryService";

describe("SqliteDb live connection guard", () => {
  let userDir: string;

  beforeEach(async () => {
    await SqliteDb.destroyInstance();
    userDir = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-live-db-"));
  });

  afterEach(async () => {
    await SqliteDb.destroyInstance();
    fs.rmSync(userDir, { recursive: true, force: true });
  });

  test("getInstance does not destroy a live user db for the test fallback dir", async () => {
    const db = SqliteDb.getInstance(userDir);
    await SqliteDb.ensureInitialized();
    const connection = db.connection;

    const bounced = SqliteDb.getInstance(getSqliteTestFallbackDir());

    expect(bounced).toBe(db);
    expect(connection.isInitialized).toBe(true);
    await expect(connection.query("SELECT 1 as ok")).resolves.toEqual([
      { ok: 1 },
    ]);
  });

  test("getInstance treats trailing-slash paths as the same database", () => {
    const db = SqliteDb.getInstance(userDir);
    const again = SqliteDb.getInstance(userDir + path.sep);
    expect(again).toBe(db);
  });

  test("ScheduleTaskModel still queries after DeliveryService construction", async () => {
    SqliteDb.getInstance(userDir);
    await SqliteDb.ensureInitialized();
    const model = new ScheduleTaskModel(userDir);
    await expect(model.getScheduleTotal()).resolves.toBe(0);

    new OutboundEmailDeliveryService({
      dbpath: userDir,
      workerStarter: async () => ({ started: true }),
    });

    await expect(model.getScheduleTotal()).resolves.toBe(0);
  });

  test("ScheduleTaskModel rebinds after a real path-change destroy", async () => {
    SqliteDb.getInstance(userDir);
    await SqliteDb.ensureInitialized();
    const model = new ScheduleTaskModel(userDir);
    await expect(model.getScheduleTotal()).resolves.toBe(0);

    const otherDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-other-db-")
    );
    try {
      SqliteDb.getInstance(otherDir);
      await SqliteDb.ensureInitialized();
      await expect(model.getScheduleTotal()).resolves.toBe(0);
    } finally {
      await SqliteDb.destroyInstance();
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
