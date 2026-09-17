/**
 * Unit tests for AIChatHistoryRetrievalService (technical-design §7.4 +
 * §7.1/§7.2): result formatting, retrieval budget (8,000 cumulative tokens /
 * 4 calls per assistant turn), source-interval dedup/merge, scope isolation,
 * cursor binding, and error mapping.
 *
 * Token/USERSDBPATH are mocked so every Model/Module constructed in this file
 * shares one per-run test database (established pattern — see
 * AIChatQueryLoopOutboundEmailGate.test.ts).
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
  `aifetchly-history-retrieval-${crypto.randomUUID()}`
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

import { AIChatHistoryRetrievalService } from "@/service/AIChatHistoryRetrievalService";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { AIChatArchiveSearchFragmentModel } from "@/model/AIChatArchiveSearchFragment.model";
import { encodeSourceId, decodeSourceId } from "@/service/AIChatArchiveCursorCodec";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessages(
  conversationId: string,
  rows: Array<{ role: string; content: string; ts: number }>
): Promise<number[]> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  const rowIds: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entity = new AIChatMessageEntity();
    entity.messageId = `msg-${conversationId}-${i}`;
    entity.conversationId = conversationId;
    entity.role = r.role;
    entity.content = r.content;
    entity.timestamp = new Date(r.ts);
    entity.messageType = MessageType.MESSAGE;
    const saved = await repo.save(entity);
    rowIds.push(saved.id);
  }
  return rowIds;
}

/** Index a conversation's messages into search fragments. */
async function indexConversation(conversationId: string): Promise<void> {
  const stateModel = new AIChatArchiveStateModel(tmpDir);
  const state = await stateModel.ensureState(conversationId);
  const fragModel = new AIChatArchiveSearchFragmentModel(tmpDir);
  const msgRepo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  const rows = await msgRepo.find({ where: { conversationId } });
  for (const row of rows) {
    await fragModel.indexSourceContent(
      conversationId,
      row.id,
      "content",
      row.content ?? ""
    );
  }
  void state; // state ensured; indexState flag not needed for these tests
}

describe("AIChatHistoryRetrievalService", () => {
  let archive: AIChatArchiveModule;
  let service: AIChatHistoryRetrievalService;

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });

  beforeEach(async () => {
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    archive = new AIChatArchiveModule();
    service = new AIChatHistoryRetrievalService(archive);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe("search", () => {
    it("rejects a query over 200 chars with HISTORY_SCOPE_INVALID", async () => {
      const long = "x".repeat(201);
      const res = await service.search({
        conversationId: "conv-search-1",
        query: long,
      });
      expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
      expect(res.records).toHaveLength(0);
    });

    it("rejects an empty query with HISTORY_SCOPE_INVALID", async () => {
      const res = await service.search({
        conversationId: "conv-search-1",
        query: "",
      });
      expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
    });

    it("returns HISTORY_NO_MATCH only when scanComplete is true", async () => {
      await seedMessages("conv-no-match", [
        { role: "user", content: "hello world", ts: 1_000 },
      ]);
      await indexConversation("conv-no-match");
      const res = await service.search({
        conversationId: "conv-no-match",
        query: "absent-term",
      });
      expect(res.scanComplete).toBe(true);
      expect(res.records).toHaveLength(0);
      expect(res.errorCode).toBe("HISTORY_NO_MATCH");
    });

    it("returns a hit on backend page 2 inside one tool call (§7.1.5)", async () => {
      const excerpt = {
        sourceId: encodeSourceId({
          v: 1,
          epoch: "e",
          revision: 0,
          rowId: 42,
          field: "content",
          startCodePoint: 0,
          endCodePoint: 5,
        }),
        messageId: "msg-42",
        role: "user",
        timestamp: "2026-09-17T10:00:00.000Z",
        text: "hello",
        exact: true,
        redacted: false,
        hasMore: false,
      };
      const searchPage = vi
        .fn()
        // First 100 ms fragment page: no hit yet, scan continues.
        .mockResolvedValueOnce({
          records: [],
          nextCursor: "backend-page-2",
          truncated: false,
          sourceRevision: 0,
          scanComplete: false,
          indexComplete: true,
        })
        .mockResolvedValueOnce({
          records: [excerpt],
          nextCursor: null,
          truncated: false,
          sourceRevision: 0,
          scanComplete: true,
          indexComplete: true,
        });
      const stubbed = new AIChatHistoryRetrievalService({
        searchPage,
      } as never);
      const res = await stubbed.search({
        conversationId: "conv-multi",
        query: "hello",
        turnId: "t-multi",
      });
      // Both backend pages consumed in ONE call — no second tool round needed.
      expect(searchPage).toHaveBeenCalledTimes(2);
      expect(res.records).toHaveLength(1);
      expect(res.records[0].text).toBe("hello");
      expect(res.scanComplete).toBe(true);
      expect(res.errorCode).toBeUndefined();
    });

    it("never maps an empty first page + cursor to HISTORY_NO_MATCH (FR-02)", async () => {
      const searchPage = vi.fn().mockResolvedValue({
        records: [],
        nextCursor: "backend-page-2",
        truncated: false,
        sourceRevision: 0,
        scanComplete: false,
        indexComplete: true,
      });
      const stubbed = new AIChatHistoryRetrievalService({
        searchPage,
      } as never);
      const res = await stubbed.search({
        conversationId: "conv-empty-first",
        query: "later-hit",
        turnId: "t-empty",
      });
      expect(res.records).toHaveLength(0);
      expect(res.scanComplete).toBe(false);
      expect(res.nextCursor).toBe("backend-page-2");
      expect(res.errorCode).not.toBe("HISTORY_NO_MATCH");
    });

    it("finds matches across fragments with source verification", async () => {
      await seedMessages("conv-hit", [
        {
          role: "user",
          content: "Use the column order: email, company, country.",
          ts: 1_000,
        },
        {
          role: "assistant",
          content: "Got it — column order saved.",
          ts: 2_000,
        },
      ]);
      await indexConversation("conv-hit");
      const res = await service.search({
        conversationId: "conv-hit",
        query: "column order",
      });
      expect(res.errorCode).toBeUndefined();
      expect(res.records.length).toBeGreaterThan(0);
      expect(res.records[0].text).toContain("column order");
      expect(res.records[0].sourceId.length).toBeGreaterThan(0);
      expect(res.nextCursor).toBeNull();
      expect(res.scanComplete).toBe(true);
    });

    it("isolates scope — a cursor from another conversation is rejected", async () => {
      await seedMessages("conv-iso-a", [
        { role: "user", content: "alpha needle", ts: 1_000 },
      ]);
      await seedMessages("conv-iso-b", [
        { role: "user", content: "beta needle", ts: 1_000 },
      ]);
      await indexConversation("conv-iso-a");
      await indexConversation("conv-iso-b");
      const resA = await service.search({
        conversationId: "conv-iso-a",
        query: "needle",
      });
      expect(resA.records.length).toBeGreaterThan(0);
      // Take A's cursor, use it against B — must be rejected (scope widened).
      const cursorA = resA.nextCursor ?? encodeDummySearchCursor("conv-iso-a");
      const resB = await service.search({
        conversationId: "conv-iso-b",
        query: "needle",
        cursor: cursorA,
      });
      // Cross-conversation cursor: rejected with scope-invalid, no leak.
      expect(resB.errorCode).toBe("HISTORY_SCOPE_INVALID");
      expect(resB.records).toHaveLength(0);
    });
  });

  describe("read", () => {
    it("rejects invalid input with HISTORY_SCOPE_INVALID", async () => {
      const res = await service.read({
        conversationId: "conv-read-x",
        args: { source_id: "a", from_source_id: "b", to_source_id: "c" },
      });
      expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
    });

    it("rejects when no mode is provided", async () => {
      const res = await service.read({
        conversationId: "conv-read-x",
        args: { neighbors: 1 },
      });
      expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
    });

    it("reads a source by id and returns exact text", async () => {
      await seedMessages("conv-read-1", [
        { role: "user", content: "exact text for reading", ts: 1_000 },
      ]);
      await indexConversation("conv-read-1");
      const search = await service.search({
        conversationId: "conv-read-1",
        query: "exact text",
      });
      expect(search.records.length).toBeGreaterThan(0);
      const sid = search.records[0].sourceId;
      const res = await service.read({
        conversationId: "conv-read-1",
        args: { source_id: sid },
      });
      expect(res.errorCode).toBeUndefined();
      expect(res.records.length).toBeGreaterThan(0);
      expect(res.records[0].text).toBe("exact text for reading");
      expect(res.records[0].exact).toBe(true);
    });

    it("returns SOURCE_UNAVAILABLE for a deleted row", async () => {
      await seedMessages("conv-read-2", [
        { role: "user", content: "to be deleted", ts: 1_000 },
      ]);
      await indexConversation("conv-read-2");
      const search = await service.search({
        conversationId: "conv-read-2",
        query: "deleted",
      });
      const sid = search.records[0].sourceId;
      // Delete the source row from the DB, then read by id.
      const repo =
        SqliteDb.getInstance(tmpDir).connection.getRepository(
          AIChatMessageEntity
        );
      const rows = await repo.find({
        where: { conversationId: "conv-read-2" },
      });
      await repo.remove(rows);
      const res = await service.read({
        conversationId: "conv-read-2",
        args: { source_id: sid },
      });
      expect(res.errorCode).toBe("SOURCE_UNAVAILABLE");
    });

    it("returns SOURCE_CHANGED when revision mismatches", async () => {
      await seedMessages("conv-read-3", [
        { role: "user", content: "before edit", ts: 1_000 },
      ]);
      await indexConversation("conv-read-3");
      const search = await service.search({
        conversationId: "conv-read-3",
        query: "before edit",
      });
      const sid = search.records[0].sourceId;
      // Bump the source revision (simulates a source mutation).
      const stateModel = new AIChatArchiveStateModel(tmpDir);
      await stateModel.incrementRevision("conv-read-3");
      const res = await service.read({
        conversationId: "conv-read-3",
        args: { source_id: sid },
      });
      expect(res.errorCode).toBe("SOURCE_CHANGED");
      // A refreshed reference must still resolve (identity holds).
      expect(res.records.length).toBeGreaterThan(0);
    });
  });

  describe("resolveSelections", () => {
    it("resolves a valid source id to its exact text", async () => {
      await seedMessages("conv-res-1", [
        { role: "user", content: "selected passage", ts: 1_000 },
      ]);
      await indexConversation("conv-res-1");
      const search = await service.search({
        conversationId: "conv-res-1",
        query: "selected passage",
      });
      const sid = search.records[0].sourceId;
      const res = await service.resolveSelections("conv-res-1", [sid]);
      expect(res.resolved.length).toBeGreaterThan(0);
      expect(res.resolved[0].text).toBe("selected passage");
      expect(res.rejected).toHaveLength(0);
    });

    it("rejects a garbage source id", async () => {
      const res = await service.resolveSelections("conv-res-1", ["garbage"]);
      expect(res.resolved).toHaveLength(0);
      expect(res.rejected).toEqual(["garbage"]);
      expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
    });

    it("accepts a partial interval and returns just that excerpt", async () => {
      await seedMessages("conv-res-2", [
        { role: "assistant", content: "alpha beta gamma delta", ts: 1_000 },
      ]);
      await indexConversation("conv-res-2");
      const search = await service.search({
        conversationId: "conv-res-2",
        query: "beta",
      });
      expect(search.records.length).toBeGreaterThan(0);
      const sid = search.records[0].sourceId;
      const res = await service.resolveSelections(
        "conv-res-2",
        [sid],
        "turn-1"
      );
      expect(res.resolved).toHaveLength(1);
      expect(res.resolved[0].text).toBe(search.records[0].text);
      expect(res.resolved[0].exact).toBe(true);
    });

    it("preserves submission order and reports partial rejection", async () => {
      await seedMessages("conv-res-3", [
        { role: "user", content: "first passage here", ts: 1_000 },
        { role: "assistant", content: "second passage here", ts: 2_000 },
      ]);
      await indexConversation("conv-res-3");
      const search = await service.search({
        conversationId: "conv-res-3",
        query: "passage here",
      });
      const ids = search.records.map((r) => r.sourceId);
      expect(ids.length).toBeGreaterThanOrEqual(2);
      const res = await service.resolveSelections("conv-res-3", [
        ids[0],
        "not-a-real-id",
        ids[1],
      ]);
      expect(res.resolved).toHaveLength(2);
      // Every rejected id reported once, in the caller's submission order.
      expect(res.rejected).toEqual(["not-a-real-id"]);
      expect(res.errorCode).toBe("SOURCE_CHANGED");
    });

    it("rejects an over-cap excerpt with actionable feedback (no silent narrowing)", async () => {
      const stateModel = new AIChatArchiveStateModel(tmpDir);
      const state = await stateModel.ensureState("conv-res-4");
      const row = await seedMessages("conv-res-4", [
        { role: "assistant", content: "x".repeat(10_000), ts: 1_000 },
      ]);
      const sid = encodeSourceId({
        v: 1,
        epoch: state.epoch,
        revision: state.sourceRevision,
        rowId: row[0],
        field: "content",
        startCodePoint: 0,
        endCodePoint: 10_000,
      });
      const res = await service.resolveSelections(
        "conv-res-4",
        [sid],
        "turn-4"
      );
      // 10,000 chars ≈ 2,500 tokens exceeds the 2,000-token per-excerpt cap:
      // rejected (FR-10 — the user narrows the selection), never silently cut
      // to a prefix. The draft survives for retry.
      expect(res.resolved).toHaveLength(0);
      expect(res.rejected).toEqual([sid]);
      expect(res.errorCode).toBe("CONTEXT_REQUIRED_CONTENT_TOO_LARGE");
    });

    it("stops at the per-turn selection total cap and rejects the rest", async () => {
      const stateModel = new AIChatArchiveStateModel(tmpDir);
      const state = await stateModel.ensureState("conv-res-5");
      const totalCapTokens =
        AI_CHAT_RECOVERABLE_DEFAULTS.selectionMaxTotalTokens;
      // Each excerpt is 6,000 chars ≈ 1,500 tokens (under the 2,000 per-excerpt
      // cap). Six fit the per-excerpt rule but total 9,000 > 8,000, so the
      // first five are accepted and the sixth is rejected with an actionable
      // capacity code — the model receives precisely the accepted passages.
      const n = 6;
      const rowIds = await seedMessages(
        "conv-res-5",
        Array.from({ length: n }, (_, i) => ({
          role: "assistant",
          content: `excerpt ${i} ` + "z".repeat(6_000),
          ts: 1_000 + i,
        }))
      );
      const sids = rowIds.map((rowId) =>
        encodeSourceId({
          v: 1,
          epoch: state.epoch,
          revision: state.sourceRevision,
          rowId,
          field: "content",
          startCodePoint: 0,
          endCodePoint: 6_010,
        })
      );
      const res = await service.resolveSelections("conv-res-5", sids, "turn-5");
      expect(res.resolved).toHaveLength(n - 1);
      expect(res.rejected).toEqual([sids[n - 1]]);
      expect(res.errorCode).toBe("CONTEXT_REQUIRED_CONTENT_TOO_LARGE");
      expect(totalCapTokens).toBe(8_000);
    });

    it("round-trips a nonzero span twice without becoming the prefix", async () => {
      const stateModel = new AIChatArchiveStateModel(tmpDir);
      const state = await stateModel.ensureState("conv-res-7");
      const content = "p".repeat(500) + "MID-TOKEN-xyz" + "q".repeat(500);
      const row = await seedMessages("conv-res-7", [
        { role: "user", content, ts: 1_000 },
      ]);
      const sid = encodeSourceId({
        v: 1,
        epoch: state.epoch,
        revision: state.sourceRevision,
        rowId: row[0],
        field: "content",
        startCodePoint: 500,
        endCodePoint: 513,
      });
      // First resolve: exact slice, and the RETURNED id keeps the nonzero
      // span (not re-encoded as start 0).
      const first = await service.resolveSelections("conv-res-7", [sid], "t-7a");
      expect(first.resolved).toHaveLength(1);
      expect(first.resolved[0].text).toBe("MID-TOKEN-xyz");
      const returned = decodeSourceId(first.resolved[0].sourceId, state.epoch);
      expect(returned).not.toBeNull();
      expect(returned!.startCodePoint).toBe(500);
      expect(returned!.endCodePoint).toBe(513);
      // Second resolve of the RETURNED id: same passage, still not the prefix.
      const second = await service.resolveSelections(
        "conv-res-7",
        [first.resolved[0].sourceId],
        "t-7b"
      );
      expect(second.resolved).toHaveLength(1);
      expect(second.resolved[0].text).toBe("MID-TOKEN-xyz");
    });

    it("rejects stale-revision selections with a refreshed reference (never quotes old offsets)", async () => {
      const stateModel = new AIChatArchiveStateModel(tmpDir);
      const state = await stateModel.ensureState("conv-res-8");
      const row = await seedMessages("conv-res-8", [
        { role: "user", content: "original wording here", ts: 1_000 },
      ]);
      const stale = encodeSourceId({
        v: 1,
        epoch: state.epoch,
        revision: state.sourceRevision + 99,
        rowId: row[0],
        field: "content",
        startCodePoint: 0,
        endCodePoint: 8,
      });
      const res = await service.resolveSelections("conv-res-8", [stale], "t-8");
      // Nothing stale is quotable: resolved is empty, the stale id is
      // rejected (draft survives), and a refreshed reference at the current
      // revision is offered for explicit user confirmation.
      expect(res.resolved).toHaveLength(0);
      expect(res.rejected).toEqual([stale]);
      expect(res.errorCode).toBe("SOURCE_CHANGED");
      expect(res.refreshed).toHaveLength(1);
      expect(res.refreshed![0].submittedId).toBe(stale);
      const fresh = decodeSourceId(
        res.refreshed![0].excerpt.sourceId,
        state.epoch
      );
      expect(fresh).not.toBeNull();
      expect(fresh!.revision).toBe(state.sourceRevision);
      // The confirmation preview re-reads CURRENT text with a RESET span and
      // exact:false — never the stale interval sliced onto changed content.
      expect(res.refreshed![0].excerpt.exact).toBe(false);
      expect(res.refreshed![0].excerpt.text).toBe("original wording here");
      expect(fresh!.startCodePoint).toBe(0);
      expect(fresh!.endCodePoint).toBe("original wording here".length);
    });

    it("caps an oversized changed-source preview with hasMore (still exact:false)", async () => {
      const stateModel = new AIChatArchiveStateModel(tmpDir);
      const state = await stateModel.ensureState("conv-res-8b");
      const big = "changed-big-body ".repeat(500);
      const row = await seedMessages("conv-res-8b", [
        { role: "user", content: big, ts: 1_000 },
      ]);
      const stale = encodeSourceId({
        v: 1,
        epoch: state.epoch,
        revision: state.sourceRevision + 1,
        rowId: row[0],
        field: "content",
        startCodePoint: 10,
        endCodePoint: 20,
      });
      const res = await service.resolveSelections(
        "conv-res-8b",
        [stale],
        "t-8b"
      );
      expect(res.resolved).toHaveLength(0);
      expect(res.errorCode).toBe("SOURCE_CHANGED");
      const preview = res.refreshed![0].excerpt;
      expect(preview.exact).toBe(false);
      expect(preview.hasMore).toBe(true);
      expect(preview.text.length).toBeLessThan(big.length);
      // The stale slice [10, 20) is nowhere in the confirmation path.
      const fresh = decodeSourceId(preview.sourceId, state.epoch);
      expect(fresh!.startCodePoint).toBe(0);
    });

    it("tombstoned scope rejects every reference with HISTORY_SCOPE_INVALID", async () => {
      await seedMessages("conv-res-6", [
        { role: "user", content: "archived then deleted", ts: 1_000 },
      ]);
      await indexConversation("conv-res-6");
      const search = await service.search({
        conversationId: "conv-res-6",
        query: "deleted",
      });
      const sid = search.records[0].sourceId;
      await new AIChatArchiveStateModel(tmpDir).tombstone("conv-res-6");
      const res = await service.resolveSelections(
        "conv-res-6",
        [sid],
        "turn-6"
      );
      expect(res.resolved).toHaveLength(0);
      expect(res.rejected).toEqual([sid]);
      expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
    });
  });

  describe("turn budget (§7.4)", () => {
    it("enforces max 4 retrieval calls per turn", async () => {
      await seedMessages("conv-budget", [
        { role: "user", content: "budget probe one", ts: 1_000 },
      ]);
      await indexConversation("conv-budget");
      let budgetExhausted = false;
      for (let i = 0; i < 5; i++) {
        const res = await service.search({
          conversationId: "conv-budget",
          query: "budget probe",
        });
        if (res.errorCode === "MODEL_BUDGET_UNAVAILABLE") {
          budgetExhausted = true;
          break;
        }
      }
      expect(budgetExhausted).toBe(true);
    });

    it("gives a fresh budget per turn", async () => {
      await seedMessages("conv-budget-2", [
        { role: "user", content: "fresh budget probe", ts: 1_000 },
      ]);
      await indexConversation("conv-budget-2");
      // Exhaust the budget on turn 1.
      for (let i = 0; i < 4; i++) {
        await service.search({
          conversationId: "conv-budget-2",
          query: "fresh budget probe",
        });
      }
      const exhausted = await service.search({
        conversationId: "conv-budget-2",
        query: "fresh budget probe",
      });
      expect(exhausted.errorCode).toBe("MODEL_BUDGET_UNAVAILABLE");
      // Start a new turn (budget keyed by conversationId+turnId).
      const svc2 = new AIChatHistoryRetrievalService(archive);
      const fresh = await svc2.search({
        conversationId: "conv-budget-2",
        query: "fresh budget probe",
      });
      expect(fresh.errorCode).toBeUndefined();
    });
  });
});

/** FNV-1a 32-bit query hash — mirrors the archive's cursor query binding. */
function fnv1a(query: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Build a search cursor for another conversation to test scope rejection. */
function encodeDummySearchCursor(conversationId: string): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      conversationId,
      epoch: "00000000-0000-0000-0000-000000000000",
      revision: 0,
      queryHash: "0",
      lastSourceRowId: 0,
      lastStartCodePoint: 0,
    }),
    "utf8"
  ).toString("base64url");
}

describe("AIChatHistoryRetrievalService bounded reads (FR-03/FR-04)", () => {
  let archive: AIChatArchiveModule;
  let service: AIChatHistoryRetrievalService;

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });

  beforeEach(async () => {
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    archive = new AIChatArchiveModule();
    service = new AIChatHistoryRetrievalService(archive);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("recovers an oversized message across bounded calls with continuation", async () => {
    const big = "0123456789".repeat(3_000); // 30,000 chars ≈ 7,500 tokens
    const rowIds = await seedMessages("conv-big", [
      { role: "user", content: big, ts: 1_000 },
    ]);
    await indexConversation("conv-big");
    const state = await new AIChatArchiveStateModel(tmpDir).ensureState(
      "conv-big"
    );
    const sid = encodeSourceId({
      v: 1,
      epoch: state.epoch,
      revision: state.sourceRevision,
      rowId: rowIds[0],
      field: "content",
      startCodePoint: 0,
      endCodePoint: 30_000,
    });
    // First page is bounded (default 4,000 tokens) with a continuation.
    const first = await service.read({
      conversationId: "conv-big",
      args: { source_id: sid },
      turnId: "t-big",
    });
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    expect(first.records).toHaveLength(1);
    // Walk the continuation to recover every fragment, then reassemble.
    let recovered = first.records[0].text;
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor && pages < 10) {
      const next = await service.read({
        conversationId: "conv-big",
        args: { source_id: sid, cursor },
        turnId: `t-big-${pages}`,
      });
      recovered += next.records[0]?.text ?? "";
      cursor = next.nextCursor;
      pages += 1;
      if (!next.truncated) break;
    }
    expect(cursor).toBeNull();
    expect(recovered).toBe(big);
  });

  it("does not duplicate evidence across repeated reads (interval dedup)", async () => {
    await seedMessages("conv-dedup", [
      { role: "user", content: "dedup sentinel phrase", ts: 1_000 },
    ]);
    await indexConversation("conv-dedup");
    const turn = "t-dedup";
    const first = await service.search({
      conversationId: "conv-dedup",
      query: "dedup sentinel",
      turnId: turn,
    });
    expect(first.records.length).toBeGreaterThan(0);
    const second = await service.search({
      conversationId: "conv-dedup",
      query: "dedup sentinel",
      turnId: turn,
    });
    // Same turn, same interval already merged → no duplicate passage.
    expect(second.records).toHaveLength(0);
  });

  it("rejects a forged cross-conversation source ID without leaking content", async () => {
    await seedMessages("conv-secret", [
      { role: "user", content: "secret cross conversation data", ts: 1_000 },
    ]);
    await indexConversation("conv-secret");
    await seedMessages("conv-victim", [
      { role: "user", content: "victim conversation data", ts: 1_000 },
    ]);
    await indexConversation("conv-victim");
    const secretState = await new AIChatArchiveStateModel(tmpDir).ensureState(
      "conv-secret"
    );
    const secretRows = await seedMessages("conv-secret-2", [
      { role: "user", content: "unused", ts: 1_000 },
    ]);
    void secretRows;
    // Forge: take a valid source ID shape from conv-secret's epoch but resolve
    // it against conv-victim. Directly encode a row from conv-secret.
    const repo =
      SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
    const secretRow = await repo.findOne({
      where: { conversationId: "conv-secret" },
    });
    const forged = encodeSourceId({
      v: 1,
      epoch: secretState.epoch,
      revision: secretState.sourceRevision,
      rowId: secretRow!.id,
      field: "content",
      startCodePoint: 0,
      endCodePoint: 10,
    });
    const res = await service.read({
      conversationId: "conv-victim",
      args: { source_id: forged },
    });
    expect(res.records).toHaveLength(0);
    expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
    expect(JSON.stringify(res)).not.toContain("secret cross conversation");
  });

  it("preserves nonzero offsets end to end (search → read → select round trip)", async () => {
    // A 5,000-code-point message splits into two indexed fragments with a
    // 128-code-point overlap; the unique token sits only in the second
    // fragment (offset 3,968). A prefix-resolving bug would return the message
    // head instead of the displayed passage.
    const token = "UNIQUE-LATER-TOKEN-xyz-789";
    const content = "p".repeat(4_500) + token + "q".repeat(400);
    await seedMessages("conv-offset", [
      { role: "user", content, ts: 1_000 },
    ]);
    await indexConversation("conv-offset");
    const state = await new AIChatArchiveStateModel(tmpDir).ensureState(
      "conv-offset"
    );
    const hit = await service.search({
      conversationId: "conv-offset",
      query: token,
      turnId: "t-off-1",
    });
    expect(hit.records.length).toBeGreaterThan(0);
    const rec = hit.records[0];
    expect(rec.text).toContain(token);
    // Bounded fragment, not the whole 5,000-char message: the excerpt carries
    // the exact [start, end) span of the displayed passage.
    expect(rec.text.length).toBeLessThan(content.length);
    const span = decodeSourceId(rec.sourceId, state.epoch);
    expect(span).not.toBeNull();
    expect(span!.startCodePoint).toBeGreaterThan(0);
    expect(span!.endCodePoint).toBeLessThanOrEqual(5_000);
    // The resolved slice is byte-identical to the stored content range.
    expect(rec.text).toBe(content.slice(span!.startCodePoint, span!.endCodePoint));
    // Read resolves the same exact passage, not the message prefix.
    const read = await service.read({
      conversationId: "conv-offset",
      args: { source_id: rec.sourceId },
      turnId: "t-off-2",
    });
    expect(read.records[0].text).toBe(rec.text);
    // Selection acceptance carries the identical passage once.
    const sel = await service.resolveSelections(
      "conv-offset",
      [rec.sourceId],
      "t-off-3"
    );
    expect(sel.resolved).toHaveLength(1);
    expect(sel.resolved[0].text).toBe(rec.text);
  });

  it("rejects a changed-query cursor without widening scope", async () => {
    await seedMessages("conv-cursor", [
      { role: "user", content: "cursor binding probe alpha", ts: 1_000 },
    ]);
    await indexConversation("conv-cursor");
    const first = await service.search({
      conversationId: "conv-cursor",
      query: "alpha",
      turnId: "t-cur-1",
    });
    expect(first.records.length).toBeGreaterThan(0);
    // Reuse is impossible without a cursor here (single page), so craft the
    // negative case directly: a cursor minted for another query must fail.
    const other = await service.search({
      conversationId: "conv-cursor",
      query: "alpha",
      cursor: encodeDummySearchCursor("conv-cursor"),
      turnId: "t-cur-2",
    });
    expect(other.errorCode).toBe("HISTORY_SCOPE_INVALID");
  });

  it("recovers budget-withheld search records across resumed calls without replay", async () => {
    // Four ~6,000-char passages (≈1,500 tokens each): the 2,000-token
    // per-call cap fits exactly one per call while the backend page holds all
    // four (exhausted, nextCursor null). Before intra-page resume cursors,
    // re-requesting replayed the same page and truncated identically, so the
    // withheld records were unreachable within and across turns.
    const token = "budget-resume-probe";
    await seedMessages(
      "conv-resume",
      [0, 1, 2, 3].map((i) => ({
        role: "user",
        content: `${token} passage ${i} ` + "x".repeat(6_000),
        ts: 1_000 + i,
      }))
    );
    await indexConversation("conv-resume");
    const turn = "t-resume";
    const seen: string[] = [];
    let cursor: string | undefined;
    // Bounded walk: every call must advance the cursor (or end it), so more
    // than 6 calls proves a replay loop.
    for (let calls = 0; calls < 6; calls++) {
      const res = await service.search({
        conversationId: "conv-resume",
        query: token,
        cursor,
        turnId: turn,
        limit: 20,
      });
      for (const r of res.records) seen.push(r.text);
      cursor = res.nextCursor ?? undefined;
      if (!cursor) break;
    }
    // Every withheld passage recovered exactly once: cursors advanced instead
    // of looping, and nothing was dropped or duplicated.
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(seen.join("|")).toContain(`passage ${i}`);
    }
  });

  it("rejects a revision-less (legacy) search cursor instead of grandfathering it", async () => {
    await seedMessages("conv-legacy-cursor", [
      { role: "user", content: "legacy cursor probe alpha", ts: 1_000 },
    ]);
    await indexConversation("conv-legacy-cursor");
    const state = await new AIChatArchiveStateModel(tmpDir).ensureState(
      "conv-legacy-cursor"
    );
    // A cursor without a revision field (pre-binding issuance or hand-crafted)
    // must fail closed once a revision is expected — never bypass the binding.
    const legacy = Buffer.from(
      JSON.stringify({
        v: 1,
        conversationId: "conv-legacy-cursor",
        epoch: state.epoch,
        queryHash: fnv1a("alpha"),
        lastSourceRowId: 0,
        lastStartCodePoint: 0,
      }),
      "utf8"
    ).toString("base64url");
    const res = await service.search({
      conversationId: "conv-legacy-cursor",
      query: "alpha",
      cursor: legacy,
      turnId: "t-legacy",
    });
    expect(res.records).toHaveLength(0);
    expect(res.errorCode).toBe("HISTORY_SCOPE_INVALID");
  });

  it("reaches later ranges via continuation (range pagination starts at from)", async () => {
    const rowIds = await seedMessages(
      "conv-range",
      Array.from({ length: 10 }, (_, i) => ({
        role: "user",
        content: `range message number ${i}`,
        ts: 1_000 + i,
      }))
    );
    await indexConversation("conv-range");
    const state = await new AIChatArchiveStateModel(tmpDir).ensureState(
      "conv-range"
    );
    const sid = (rowId: number): string =>
      encodeSourceId({
        v: 1,
        epoch: state.epoch,
        revision: state.sourceRevision,
        rowId,
        field: "content",
        startCodePoint: 0,
        endCodePoint: 100,
      });
    // Range over the LAST three rows: proves pagination starts at `from`,
    // not at the conversation head.
    const res = await service.read({
      conversationId: "conv-range",
      args: {
        from_source_id: sid(rowIds[7]),
        to_source_id: sid(rowIds[9]),
      },
      turnId: "t-range",
    });
    const texts = res.records.map((r) => r.text).join("|");
    expect(texts).toContain("range message number 7");
    expect(texts).toContain("range message number 9");
    expect(texts).not.toContain("range message number 0");
  });
});
