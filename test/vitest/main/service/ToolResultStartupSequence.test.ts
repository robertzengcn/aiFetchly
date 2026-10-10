/**
 * Startup sequence integration for preserved tool outputs (design §12.2,
 * T14 Part B wiring).
 *
 * Boundary test for `runToolResultStartup` driving the REAL recovery sweep,
 * the REAL bootstrap backfill, and the REAL projection repository over tmp
 * SQLite. The claims under test:
 *
 *  - the cursor key is always installed (even with a bad secret store, it is
 *    derived fresh — startup never aborts);
 *  - the legacy projection backfill runs through the startup path and writes
 *    a bounded projection for an oversized legacy row (boundary, not mocked);
 *  - with `captureEnabled: false` the reconciliation sweep is skipped but the
 *    backfill still runs (a rollback must still rebuild projections);
 *  - without a `dataSource` the backfill is skipped (reported, not thrown);
 *  - a failing secret store never aborts startup.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AIToolResultProjectionEntity } from "@/entity/AIToolResultProjection.entity";
import { SqliteDb } from "@/config/SqliteDb";
import { MessageType } from "@/entityTypes/commonType";
import { runToolResultStartup, TOOL_RESULT_CURSOR_SECRET_KEY } from "@/service/toolResult/ToolResultStartupService";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { TOOL_RESULT_POLICY_VERSION } from "@/config/toolResultConfig";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake when
// parallel vitest workers collide on a fixed aifetchly-test path.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-t14-startup-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

let storageRoot: string;

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
  storageRoot = path.join(os.tmpdir(), `aifetchly-t14-startup-art-${crypto.randomUUID()}`);
  fs.mkdirSync(storageRoot, { recursive: true });
});

afterEach(() => {
  resetDbSingleton();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

function buildStorage(): ToolResultStorageService {
  return new ToolResultStorageService({ root: storageRoot });
}

describe("T14 startup sequence", () => {
  it("runs the backfill through the startup path and writes a projection for an oversized legacy row", async () => {
    await SqliteDb.ensureInitialized();
    const ds = SqliteDb.getInstance(tmpDir).connection;

    // Seed an oversized legacy row well above the inline threshold.
    const repo = ds.getRepository(AIChatMessageEntity);
    const huge = "w".repeat(TOOL_RESULT_CONFIG.inlineMaxBytes * 3);
    const entity = new AIChatMessageEntity();
    entity.messageId = "startup-big-1";
    entity.conversationId = "conv-startup";
    entity.role = "assistant";
    entity.content = huge;
    entity.timestamp = new Date(1_000);
    entity.messageType = MessageType.MESSAGE;
    await repo.save(entity);

    const report = await runToolResultStartup({
      module: new ToolResultModule(tmpDir),
      storage: buildStorage(),
      captureEnabled: true,
      readSecret: () => undefined,
      writeSecret: () => undefined,
      dataSource: ds,
      profileId: "default",
    });

    // Cursor key installed + backfill reported as run.
    expect(report.cursorKeyInstalled).toBe(true);
    expect(report.legacyProjectionsBackfilled).toBe(true);

    // The projection exists under the startup profile.
    const proj = await ds.getRepository(AIToolResultProjectionEntity).findOne({
      where: {
        profileId: "default",
        sourceRowKey: "startup-big-1",
        outputEpoch: "legacy",
        policyVersion: TOOL_RESULT_POLICY_VERSION,
      },
    });
    expect(proj).not.toBeNull();
    expect(proj!.content).toContain("startup-big-1");
    expect(proj!.content.length).toBeLessThan(huge.length);

    // The source row is never mutated by the backfill.
    const after = await repo.findOne({ where: { id: entity.id } });
    expect(after!.content).toBe(huge);
  });

  it("skips the reconciliation sweep with capture off but still runs the backfill", async () => {
    await SqliteDb.ensureInitialized();
    const ds = SqliteDb.getInstance(tmpDir).connection;

    const repo = ds.getRepository(AIChatMessageEntity);
    const huge = "v".repeat(TOOL_RESULT_CONFIG.inlineMaxBytes * 3);
    const entity = new AIChatMessageEntity();
    entity.messageId = "startup-captureoff";
    entity.conversationId = "conv-startup-off";
    entity.role = "user";
    entity.content = huge;
    entity.timestamp = new Date(2_000);
    entity.messageType = MessageType.MESSAGE;
    await repo.save(entity);

    const report = await runToolResultStartup({
      module: new ToolResultModule(tmpDir),
      storage: buildStorage(),
      captureEnabled: false,
      readSecret: () => undefined,
      writeSecret: () => undefined,
      dataSource: ds,
      profileId: "default",
    });

    expect(report.cursorKeyInstalled).toBe(true);
    // Reconciliation skipped (no counters reported), backfill still ran.
    expect(report.expiredLeasesReclaimed).toBeUndefined();
    expect(report.legacyProjectionsBackfilled).toBe(true);

    const proj = await ds.getRepository(AIToolResultProjectionEntity).findOne({
      where: { profileId: "default", sourceRowKey: "startup-captureoff" },
    });
    expect(proj).not.toBeNull();
  });

  it("skips the backfill when no dataSource is provided (reported, not thrown)", async () => {
    const report = await runToolResultStartup({
      module: new ToolResultModule(tmpDir),
      storage: buildStorage(),
      captureEnabled: true,
      readSecret: () => undefined,
      writeSecret: () => undefined,
      // no dataSource
    });

    expect(report.cursorKeyInstalled).toBe(true);
    expect(report.legacyProjectionsBackfilled).toBe(false);
  });

  it("never aborts startup when the secret store throws", async () => {
    await SqliteDb.ensureInitialized();
    const ds = SqliteDb.getInstance(tmpDir).connection;

    const report = await runToolResultStartup({
      module: new ToolResultModule(tmpDir),
      storage: buildStorage(),
      captureEnabled: true,
      readSecret: () => {
        throw new Error("secret store unavailable");
      },
      writeSecret: () => {
        throw new Error("secret store read-only");
      },
      dataSource: ds,
      profileId: "default",
    });

    // The cursor key fell back to ephemeral, but startup completed.
    expect(report.cursorKeyInstalled).toBe(false);
    expect(report.cursorKeyReason).toContain("secret store unavailable");
    expect(report.legacyProjectionsBackfilled).toBe(true);
  });
});

// The exported secret key name is part of the startup contract (background.ts
// stores the cursor secret under it via the Token service).
describe("startup contract", () => {
  it("exposes the cursor secret token key", () => {
    expect(TOOL_RESULT_CURSOR_SECRET_KEY).toBe("ai_tool_output_cursor_secret");
  });
});
