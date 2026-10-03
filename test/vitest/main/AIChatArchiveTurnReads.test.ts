/**
 * Module-level turn/tail read tests (FR-05, AC-03/AC-09/AC-10).
 *
 * A tool-heavy turn with more than 64 rows must be fully materialized by
 * following page continuations — never silently truncated at the metadata
 * page cap, and never costed as complete when it is not. The live tail
 * keysets strictly after its anchor (no wasted page slot).
 */
import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-turn-reads-${crypto.randomUUID()}`
);

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
}));

vi.mock("@/config/usersetting", () => ({
  Token: class {
    getValue(name: string) {
      return name === "user_dbpath" ? tmpDir : "";
    }
  },
  USER_AI_ENABLED: "true",
  TOKENNAME: "user-social-market-token",
  USERSDBPATH: "user_dbpath",
}));

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedRows(
  conversationId: string,
  n: number,
  startTs: number,
  toolEvery = 0
): Promise<AIChatMessageEntity[]> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  const out: AIChatMessageEntity[] = [];
  let batch: AIChatMessageEntity[] = [];
  for (let i = 0; i < n; i++) {
    const e = new AIChatMessageEntity();
    e.messageId = `turn-msg-${conversationId}-${i}`;
    e.conversationId = conversationId;
    const isTool = toolEvery > 0 && i % toolEvery === 0 && i > 0;
    e.role = isTool ? "tool" : i % 2 === 0 ? "user" : "assistant";
    e.content = isTool ? `tool result ${i}` : `turn row ${i} pad`;
    e.timestamp = new Date(startTs + i);
    e.messageType = isTool ? MessageType.TOOL_RESULT : MessageType.MESSAGE;
    if (isTool) {
      e.metadata = JSON.stringify({
        toolCallId: `call-${i}`,
        toolName: "search_tool",
        toolResult: { ok: true },
      });
    }
    batch.push(e);
    if (batch.length >= 100) {
      const saved = await repo.save(batch);
      out.push(...saved);
      batch = [];
    }
  }
  if (batch.length > 0) {
    const saved = await repo.save(batch);
    out.push(...saved);
  }
  return out.sort((a, b) => a.id - b.id);
}

describe("AIChatArchiveModule turn/tail reads", () => {
  beforeAll(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
  });

  afterEach(() => {
    // Keep the singleton: reseeding hundreds of rows per test is expensive.
  });

  it("materializes a 70-row tool-heavy turn fully (past the 64-row page)", async () => {
    const conv = "conv-turn-70";
    const rows = await seedRows(conv, 70, 1_000, 7);
    await new AIChatArchiveStateModel(tmpDir).ensureState(conv);
    const archive = new AIChatArchiveModule();
    const first = rows[0];
    const last = rows[rows.length - 1];
    const { rows: got, complete } = await archive.readTurnRows(
      conv,
      first.timestamp.getTime(),
      first.id,
      last.timestamp.getTime(),
      last.id,
      64 * 1024
    );
    expect(complete).toBe(true);
    // All 70 rows, including every 7th tool-result row — no silent tail drop.
    expect(got).toHaveLength(70);
    expect(got.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(got.filter((r) => r.messageType !== MessageType.MESSAGE)).toHaveLength(9);
  });

  it("returns a 64-row live tail fully in bounded reads (no anchor waste)", async () => {
    const conv = "conv-tail-64";
    const rows = await seedRows(conv, 65, 5_000);
    await new AIChatArchiveStateModel(tmpDir).ensureState(conv);
    const archive = new AIChatArchiveModule();
    // Anchor = first row (as if it were the last completed row); the live
    // tail is the remaining 64 rows, all of which must come back.
    const anchor = rows[0];
    const { rows: tail, complete } = await archive.readRowsAfter(
      conv,
      anchor.timestamp.getTime(),
      anchor.id,
      64 * 1024
    );
    expect(complete).toBe(true);
    expect(tail).toHaveLength(64);
    expect(tail[0].id).toBe(rows[1].id);
    expect(tail[tail.length - 1].id).toBe(rows[64].id);
  });

  it("reports incomplete instead of truncating a turn past the page cap", async () => {
    const conv = "conv-turn-huge";
    // 1,100 rows > 16 pages × 64 rows: must stop and say so.
    const rows = await seedRows(conv, 1_100, 9_000);
    await new AIChatArchiveStateModel(tmpDir).ensureState(conv);
    const archive = new AIChatArchiveModule();
    const first = rows[0];
    const last = rows[rows.length - 1];
    const { rows: got, complete } = await archive.readTurnRows(
      conv,
      first.timestamp.getTime(),
      first.id,
      last.timestamp.getTime(),
      last.id,
      256 * 1024
    );
    expect(complete).toBe(false);
    expect(got.length).toBeGreaterThan(64);
    expect(got.length).toBeLessThanOrEqual(16 * 64);
  }, 120_000);
});
