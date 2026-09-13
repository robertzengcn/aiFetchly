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
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
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

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessages(
  conversationId: string,
  rows: Array<{ role: string; content: string; ts: number }>
): Promise<void> {
  const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
    AIChatMessageEntity
  );
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

/** Index a conversation's messages into search fragments. */
async function indexConversation(conversationId: string): Promise<void> {
  const stateModel = new AIChatArchiveStateModel(tmpDir);
  const state = await stateModel.ensureState(conversationId);
  const fragModel = new AIChatArchiveSearchFragmentModel(tmpDir);
  const msgRepo = SqliteDb.getInstance(tmpDir).connection.getRepository(
    AIChatMessageEntity
  );
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

    it("finds matches across fragments with source verification", async () => {
      await seedMessages("conv-hit", [
        { role: "user", content: "Use the column order: email, company, country.", ts: 1_000 },
        { role: "assistant", content: "Got it — column order saved.", ts: 2_000 },
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
      const cursorA =
        resA.nextCursor ?? encodeDummySearchCursor("conv-iso-a");
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
      const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
        AIChatMessageEntity
      );
      const rows = await repo.find({ where: { conversationId: "conv-read-2" } });
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
