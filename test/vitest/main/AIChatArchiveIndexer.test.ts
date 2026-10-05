/**
 * Unit tests for AIChatArchiveIndexer (technical-design §15.5): bounded
 * resumable backfill of entry/turn/search-fragment projections.
 *
 * Covers:
 *   - First-pass indexing: absent → indexing → complete, with entries +
 *     fragments projected for every source row.
 *   - Resumability: a crash mid-backfill (simulated by a tiny batch) resumes
 *     from the persisted cursor on the next batch — no row is skipped or
 *     double-processed (idempotent upserts).
 *   - Turn inference: legacy rows without a native turnId are grouped by
 *     ordered user-message boundaries; the high-water advances to the end of
 *     the last COMPLETE turn, never into the live turn.
 *   - Native turnId: rows carrying metadata.turnId produce turns with
 *     confidence "native" and the correct boundary.
 *   - Tool pairing: tool_call/tool_result rows get pairedSourceRowId recorded
 *     for the indexed getToolPair lookup.
 *   - Stale-on-revision: markStale sets indexState without losing the cursor.
 *
 * Token/USERSDBPATH are mocked so every Model/Module constructed in this file
 * shares one per-run test database (established pattern).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { SqliteDb } from "@/config/SqliteDb";

// Per-run unique temp dir to avoid the SQLITE_BUSY shared-db flake when
// parallel vitest workers collide on a fixed aifetchly-test path.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-archive-indexer-${crypto.randomUUID()}`
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

import { AIChatArchiveIndexer } from "@/service/AIChatArchiveIndexer";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveEntryModel } from "@/model/AIChatArchiveEntry.model";
import { AIChatArchiveTurnModel } from "@/model/AIChatArchiveTurn.model";
import { AIChatArchiveSearchFragmentModel } from "@/model/AIChatArchiveSearchFragment.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageMetadata } from "@/entityTypes/aiChatV2Types";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

interface SeedRow {
  role: string;
  content: string;
  ts: number;
  messageType?: MessageType;
  metadata?: ChatV2MessageMetadata;
}

async function seedMessages(
  conversationId: string,
  rows: SeedRow[]
): Promise<AIChatMessageEntity[]> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  const saved: AIChatMessageEntity[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entity = new AIChatMessageEntity();
    entity.messageId = `msg-${conversationId}-${i}`;
    entity.conversationId = conversationId;
    entity.role = r.role;
    entity.content = r.content;
    entity.timestamp = new Date(r.ts);
    entity.messageType = r.messageType ?? MessageType.MESSAGE;
    if (r.metadata) {
      entity.metadata = JSON.stringify(r.metadata);
    }
    const persisted = await repo.save(entity);
    saved.push(persisted);
  }
  return saved;
}

beforeAll(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
});

beforeEach(() => {
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
});

afterEach(() => {
  resetDbSingleton();
});

describe("AIChatArchiveIndexer — first-pass indexing", () => {
  it("keeps a user-only tail open across restart until an assistant reply arrives", async () => {
    await SqliteDb.ensureInitialized();
    const conv = "live-tail";
    const state = await new AIChatArchiveStateModel(tmpDir).ensureState(conv);
    await seedMessages(conv, [{ role: "user", content: "pending", ts: 1000 }]);
    await new AIChatArchiveIndexer().runToCompletion(conv);
    const turns = new AIChatArchiveTurnModel(tmpDir);
    expect((await turns.getLastTurn(conv, state.epoch))?.status).toBe("open");
    await seedMessages(conv, [{ role: "assistant", content: "finished", ts: 2000 }]);
    await new AIChatArchiveIndexer().runToCompletion(conv);
    const turn = await turns.getLastTurn(conv, state.epoch);
    expect(turn?.status).toBe("completed");
    expect(Number(turn?.firstTimestampMs)).toBe(1000);
    expect(Number(turn?.lastTimestampMs)).toBe(2000);
  });
  it("projects entries + fragments for every source row and reaches complete", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-full";
    await stateModel.ensureState(conv);
    await seedMessages(conv, [
      { role: "user", content: "hello there", ts: 1_000 },
      { role: "assistant", content: "hi back", ts: 2_000 },
      { role: "user", content: "second turn", ts: 3_000 },
      { role: "assistant", content: "reply two", ts: 4_000 },
    ]);

    const result = await indexer.runToCompletion(conv);

    expect(result.complete).toBe(true);
    expect(result.rowsProjected).toBe(4);

    const state = await stateModel.getState(conv);
    expect(state?.indexState).toBe("complete");

    // Every source row should have an entry projection.
    const entryModel = new AIChatArchiveEntryModel(tmpDir);
    const entryCount = await entryModel.countByConversation(conv);
    expect(entryCount).toBe(4);

    // Each short message produces exactly one search fragment.
    const fragModel = new AIChatArchiveSearchFragmentModel(tmpDir);
    const fragCount = await fragModel.countByConversation(conv);
    expect(fragCount).toBe(4);
  });

  it("does not resurrect a tombstoned conversation", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-tomb";
    await stateModel.ensureState(conv);
    await seedMessages(conv, [{ role: "user", content: "x", ts: 1_000 }]);
    await stateModel.tombstone(conv);

    const result = await indexer.runToCompletion(conv);
    expect(result.rowsProjected).toBe(0);
    expect(result.complete).toBe(true);

    const state = await stateModel.getState(conv);
    // Tombstoned state remains deleted; indexState unchanged from absent.
    expect(state?.deletedAt).toBeDefined();
  });
});

describe("AIChatArchiveIndexer — resumability", () => {
  it("resumes from the persisted cursor after a batch boundary with no skips or duplicates", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-resume";
    await stateModel.ensureState(conv);
    // 5 messages; batch of 2 → first batch projects 2, second 2, third 1.
    await seedMessages(conv, [
      { role: "user", content: "m1", ts: 1_000 },
      { role: "assistant", content: "m2", ts: 2_000 },
      { role: "user", content: "m3", ts: 3_000 },
      { role: "assistant", content: "m4", ts: 4_000 },
      { role: "user", content: "m5", ts: 5_000 },
    ]);

    // Batch 1: 2 rows.
    const b1 = await indexer.runBatch(conv, { batchRows: 2 });
    expect(b1.rowsProjected).toBe(2);
    expect(b1.hasMore).toBe(true);
    expect(b1.indexState).toBe("indexing");

    // Batch 2: 2 rows.
    const b2 = await indexer.runBatch(conv, { batchRows: 2 });
    expect(b2.rowsProjected).toBe(2);
    expect(b2.hasMore).toBe(true);

    // Batch 3: 1 row, then complete.
    const b3 = await indexer.runBatch(conv, { batchRows: 2 });
    expect(b3.rowsProjected).toBe(1);
    expect(b3.hasMore).toBe(false);
    expect(b3.indexState).toBe("complete");

    const state = await stateModel.getState(conv);
    expect(state?.indexState).toBe("complete");

    // Idempotency: re-running a batch on a complete index is a no-op.
    const b4 = await indexer.runBatch(conv, { batchRows: 2 });
    expect(b4.rowsProjected).toBe(0);
    expect(b4.indexState).toBe("complete");

    // Verify no fragments were duplicated: count should equal the sum of
    // unique source rows (each short message → 1 fragment).
    const fragModel = new AIChatArchiveSearchFragmentModel(tmpDir);
    const fragCount = await fragModel.countByConversation(conv);
    expect(fragCount).toBe(5);
  });
});

describe("AIChatArchiveIndexer — turn inference", () => {
  it("groups legacy rows by user-message boundaries and marks confidence inferred", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const turnModel = new AIChatArchiveTurnModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-turn-legacy";
    await stateModel.ensureState(conv);
    await seedMessages(conv, [
      { role: "user", content: "turn one question", ts: 1_000 },
      { role: "assistant", content: "turn one answer", ts: 2_000 },
      { role: "user", content: "turn two question", ts: 3_000 },
      { role: "assistant", content: "turn two answer", ts: 4_000 },
    ]);

    await indexer.runToCompletion(conv);
    const state = await stateModel.getState(conv);

    // Two completed turns (the final turn is complete because the walk ended).
    const turns = await turnModel.readRecentCompleteTurns(
      conv,
      state!.epoch,
      2,
      10
    );
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.confidence === "inferred")).toBe(true);

    // The high-water marks the end of the last complete turn = the last row.
    expect(state?.highWaterTimestampMs).toBe(4_000);
  });

  it("uses native turnId boundaries and marks confidence native", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const turnModel = new AIChatArchiveTurnModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-turn-native";
    await stateModel.ensureState(conv);
    await seedMessages(conv, [
      {
        role: "user",
        content: "q1",
        ts: 1_000,
        metadata: { source: "chat-v2", turnId: "turn-A" },
      },
      {
        role: "assistant",
        content: "a1",
        ts: 2_000,
        metadata: { source: "chat-v2", turnId: "turn-A" },
      },
      {
        role: "user",
        content: "q2",
        ts: 3_000,
        metadata: { source: "chat-v2", turnId: "turn-B" },
      },
      {
        role: "assistant",
        content: "a2",
        ts: 4_000,
        metadata: { source: "chat-v2", turnId: "turn-B" },
      },
    ]);

    await indexer.runToCompletion(conv);
    const state = await stateModel.getState(conv);
    const turns = await turnModel.readRecentCompleteTurns(
      conv,
      state!.epoch,
      2,
      10
    );
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.confidence === "native")).toBe(true);
  });

  it("keeps the live turn open and does not advance high-water past it", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-live-turn";
    await stateModel.ensureState(conv);
    // Two complete turns + one in-progress (no closing user message).
    await seedMessages(conv, [
      { role: "user", content: "t1q", ts: 1_000 },
      { role: "assistant", content: "t1a", ts: 2_000 },
      { role: "user", content: "t2q", ts: 3_000 },
      { role: "assistant", content: "t2a", ts: 4_000 },
      { role: "user", content: "t3q (live, no answer yet)", ts: 5_000 },
    ]);

    // Force a batch boundary in the middle so the live turn stays open.
    // Batch of 3 processes ts 1000/2000/3000: turn 1 closes at 2000, turn 2
    // opens at 3000 and stays open (live) — its closing row (4000) is in the
    // NEXT batch. High-water = end of turn 1 = 2000, never the live turn 2.
    const b1 = await indexer.runBatch(conv, { batchRows: 3 });
    expect(b1.hasMore).toBe(true);
    expect(b1.indexState).toBe("indexing");

    const stateMid = await stateModel.getState(conv);
    // High-water = end of turn 1 (the last COMPLETE turn), NOT the live turn 2
    // (which opened at 3000 but has not closed — its end 4000 is unbatched).
    expect(stateMid?.highWaterTimestampMs).toBe(2_000);

    // Finish.
    const b2 = await indexer.runBatch(conv, { batchRows: 10 });
    expect(b2.hasMore).toBe(false);
    const stateEnd = await stateModel.getState(conv);
    expect(stateEnd?.indexState).toBe("complete");
    // The user-only tail stays open, so high-water remains at the last
    // complete turn end (4000), never into the live turn.
    expect(stateEnd?.highWaterTimestampMs).toBe(4_000);
  });
});

describe("AIChatArchiveIndexer — tool pairing", () => {
  it("records pairedSourceRowId for tool_call/tool_result entries", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const entryModel = new AIChatArchiveEntryModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-tools";
    await stateModel.ensureState(conv);
    const [callRow, resultRow] = await seedMessages(conv, [
      {
        role: "assistant",
        content: "calling tool",
        ts: 1_000,
        messageType: MessageType.TOOL_CALL,
        metadata: {
          source: "chat-v2",
          turnId: "turn-T",
          toolCallId: "tc-1",
          toolName: "search",
          toolArguments: { q: "x" },
        },
      },
      {
        role: "assistant",
        content: "tool result",
        ts: 2_000,
        messageType: MessageType.TOOL_RESULT,
        metadata: {
          source: "chat-v2",
          turnId: "turn-T",
          toolCallId: "tc-1",
          toolName: "search",
          toolResult: { hits: 1 },
          toolResultStatus: "success",
          success: true,
        },
      },
    ]);

    await indexer.runToCompletion(conv);
    const state = await stateModel.getState(conv);

    const { callEntry, resultEntry } = await entryModel.findByToolCallId(
      conv,
      state!.epoch,
      "tc-1"
    );
    expect(callEntry).not.toBeNull();
    expect(resultEntry).not.toBeNull();
    // The call entry's paired row = the result row id, and vice versa.
    expect(callEntry!.pairedSourceRowId).toBe(resultRow.id);
    expect(resultEntry!.pairedSourceRowId).toBe(callRow.id);
  });
});

describe("AIChatArchiveIndexer — staleness", () => {
  it("markStale sets indexState without losing the resume cursor", async () => {
    await SqliteDb.ensureInitialized();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    const indexer = new AIChatArchiveIndexer();

    const conv = "v2-index-stale";
    await stateModel.ensureState(conv);
    await seedMessages(conv, [
      { role: "user", content: "a", ts: 1_000 },
      { role: "assistant", content: "b", ts: 2_000 },
      { role: "user", content: "c", ts: 3_000 },
    ]);

    // Partial index: one batch of 2, leaving 1 row.
    await indexer.runBatch(conv, { batchRows: 2 });
    const stateMid = await stateModel.getState(conv);
    expect(stateMid?.indexCursorJson).toBeTruthy();

    await indexer.markStale(conv);
    const stateStale = await stateModel.getState(conv);
    expect(stateStale?.indexState).toBe("stale");
    // The cursor is preserved so the next runBatch resumes from it.
    expect(stateStale?.indexCursorJson).toBe(stateMid?.indexCursorJson);

    // Resuming re-walks the tail and reaches complete.
    const result = await indexer.runBatch(conv, { batchRows: 10 });
    expect(result.indexState).toBe("complete");
  });
});
