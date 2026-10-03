import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageArchiveModel } from "@/model/AIChatMessageArchive.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { SqliteDb } from "@/config/SqliteDb";
import { MessageType } from "@/entityTypes/commonType";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake when
// parallel vitest workers collide on a fixed aifetchly-test path.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-archive-model-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessages(
  conversationId: string,
  rows: Array<{ role: string; content: string; ts: number }>
): Promise<void> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entity = new AIChatMessageEntity();
    entity.messageId = `msg-${conversationId}-${i}`;
    entity.conversationId = conversationId;
    entity.role = r.role;
    entity.content = r.content;
    entity.timestamp = new Date(r.ts);
    entity.messageType = MessageType.MESSAGE;
    await repo.save(entity);
  }
}

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  resetDbSingleton();
  // Create the singleton before any ensureInitialized() call so the
  // repository is bound to the per-run tmpDir.
  SqliteDb.getInstance(tmpDir);
});

afterEach(() => {
  resetDbSingleton();
});

describe("AIChatArchiveStateModel", () => {
  it("creates state with a random epoch and revision 0", async () => {
    const model = new AIChatArchiveStateModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const state = await model.ensureState("conv-epoch-1");
    expect(state.epoch.length).toBeGreaterThan(0);
    expect(state.sourceRevision).toBe(0);
    expect(state.conversationId).toBe("conv-epoch-1");
  });

  it("is idempotent — ensureState returns the same epoch", async () => {
    const model = new AIChatArchiveStateModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const first = await model.ensureState("conv-epoch-2");
    const second = await model.ensureState("conv-epoch-2");
    expect(second.epoch).toBe(first.epoch);
  });

  it("does not resurrect a tombstoned conversation", async () => {
    const model = new AIChatArchiveStateModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const before = await model.ensureState("conv-epoch-3");
    await model.tombstone("conv-epoch-3");
    const after = await model.ensureState("conv-epoch-3");
    // A new epoch must be minted; the tombstoned row must not be reused.
    expect(after.epoch).not.toBe(before.epoch);
  });

  it("marks deletedAt on tombstone", async () => {
    const model = new AIChatArchiveStateModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.ensureState("conv-epoch-4");
    await model.tombstone("conv-epoch-4");
    const state = await model.getState("conv-epoch-4");
    expect(state?.deletedAt).toBeDefined();
  });
});

describe("AIChatMessageArchiveModel keyset reads", () => {
  it("reads forward in (timestamp, id) order with cursor continuation", async () => {
    await SqliteDb.ensureInitialized();
    await seedMessages("conv-read-1", [
      { role: "user", content: "first", ts: 1_000 },
      { role: "assistant", content: "second", ts: 2_000 },
      // Same timestamp as the previous row — id is the tiebreaker.
      { role: "user", content: "third", ts: 2_000 },
    ]);
    const model = new AIChatMessageArchiveModel(tmpDir);
    const page1 = await model.readPageForward({
      conversationId: "conv-read-1",
      maxRows: 2,
      maxCodePoints: 100_000,
    });
    expect(page1.records).toHaveLength(2);
    expect(page1.records[0].content).toBe("first");
    expect(page1.records[1].content).toBe("second");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await model.readPageForward({
      conversationId: "conv-read-1",
      cursor: page1.nextCursor ?? undefined,
      maxRows: 2,
      maxCodePoints: 100_000,
    });
    expect(page2.records).toHaveLength(1);
    expect(page2.records[0].content).toBe("third");
    expect(page2.nextCursor).toBeNull();
  });

  it("respects a snapshot upper bound (keyset ≤ snapshot)", async () => {
    await SqliteDb.ensureInitialized();
    await seedMessages("conv-read-2", [
      { role: "user", content: "a", ts: 1_000 },
      { role: "assistant", content: "b", ts: 2_000 },
      { role: "user", content: "c", ts: 3_000 },
    ]);
    const model = new AIChatMessageArchiveModel(tmpDir);
    const page = await model.readPageForward({
      conversationId: "conv-read-2",
      maxRows: 64,
      maxCodePoints: 100_000,
      snapshotTimestampMs: 2_000,
    });
    expect(page.records.map((r) => r.content)).toEqual(["a", "b"]);
  });

  it("rejects a stale-revision cursor (P2-5)", async () => {
    await SqliteDb.ensureInitialized();
    await new AIChatArchiveStateModel(tmpDir).ensureState("conv-rev");
    await seedMessages("conv-rev", [
      { role: "user", content: "a", ts: 1_000 },
      { role: "assistant", content: "b", ts: 2_000 },
    ]);
    const model = new AIChatMessageArchiveModel(tmpDir);
    const page1 = await model.readPageForward({
      conversationId: "conv-rev",
      maxRows: 1,
      maxCodePoints: 100_000,
    });
    expect(page1.nextCursor).not.toBeNull();
    await new AIChatArchiveStateModel(tmpDir).incrementRevision("conv-rev");
    await expect(
      model.readPageForward({
        conversationId: "conv-rev",
        cursor: page1.nextCursor ?? undefined,
        maxRows: 1,
        maxCodePoints: 100_000,
      })
    ).rejects.toMatchObject({ code: "HISTORY_SCOPE_INVALID" });
  });

  it("honors the decoded-text byte allowance by truncating a page", async () => {
    await SqliteDb.ensureInitialized();
    // Each message ~1000 chars; allow only ~2000 bytes → 2 rows kept.
    const big = "x".repeat(1000);
    await seedMessages("conv-read-3", [
      { role: "user", content: big, ts: 1_000 },
      { role: "assistant", content: big, ts: 2_000 },
      { role: "user", content: big, ts: 3_000 },
    ]);
    const model = new AIChatMessageArchiveModel(tmpDir);
    const page = await model.readPageForward({
      conversationId: "conv-read-3",
      maxRows: 64,
      maxCodePoints: 600, // 600 * 4 = 2400 byte allowance → 2 rows max
    });
    expect(page.records.length).toBeLessThanOrEqual(2);
    expect(page.truncated).toBe(true);
  });
});
