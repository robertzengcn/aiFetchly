/**
 * Scaled performance fixture for recoverable-history archive reads
 * (PRD §10, AC-04/AC-10/AC-11).
 *
 * The PRD targets a 100,000-message fixture (search p95 < 1s, read p95 <
 * 500ms on the reference machine). This suite runs a 10,000-message scaled
 * fixture in unit-test time and asserts the structural properties that make
 * the full target achievable: cursor-bounded pages (never full loads),
 * byte-allowance truncation on oversized rows, and keyset stability under
 * equal timestamps. Timings are printed for the record; the hard assertions
 * use generous bounds so the suite is not flaky across machines. Recorded
 * numbers go to the PRD TODO file alongside the machine profile.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { AIChatArchiveModule } from "@/modules/AIChatArchiveModule";
import { AIChatHistoryRetrievalService } from "@/service/AIChatHistoryRetrievalService";
import { AIChatArchiveSearchFragmentModel } from "@/model/AIChatArchiveSearchFragment.model";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-archive-perf-${crypto.randomUUID()}`
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

const CONV = "conv-perf-10k";
const N = 10_000;

async function seedBulk(): Promise<void> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  const batch: AIChatMessageEntity[] = [];
  for (let i = 0; i < N; i++) {
    const e = new AIChatMessageEntity();
    e.messageId = `perf-msg-${i}`;
    e.conversationId = CONV;
    e.role = i % 2 === 0 ? "user" : "assistant";
    e.content =
      `perf message number ${i} with searchable marker alpha-beta ` +
      "x".repeat(120);
    // Every 500th message shares one timestamp (AC-09 keyset stability).
    e.timestamp = new Date(1_000 + Math.floor(i / 500) * 1_000);
    e.messageType = MessageType.MESSAGE;
    batch.push(e);
    // Small chunks: one multi-row INSERT per 100 rows stays under SQLite's
    // expression-depth limit while remaining far faster than per-row saves.
    if (batch.length >= 100) {
      await repo.insert(batch.splice(0));
    }
  }
  if (batch.length > 0) await repo.insert(batch);
}

async function indexAll(): Promise<void> {
  const fragModel = new AIChatArchiveSearchFragmentModel(tmpDir);
  const msgRepo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  const rows = await msgRepo.find({ where: { conversationId: CONV } });
  for (const row of rows) {
    await fragModel.indexSourceContent(
      CONV,
      row.id,
      "content",
      row.content ?? ""
    );
  }
}

describe("AIChatArchivePerf (10k scaled fixture)", () => {
  let archive: AIChatArchiveModule;
  let service: AIChatHistoryRetrievalService;

  beforeAll(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    await seedBulk();
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    await stateModel.ensureState(CONV);
    await stateModel.setIndexState(CONV, "complete");
    await indexAll();
    archive = new AIChatArchiveModule();
    service = new AIChatHistoryRetrievalService(archive);
  }, 300_000);

  afterEach(() => {
    // Keep the singleton for the whole fixture (reseeding is expensive).
  });

  it("pages forward without materializing the conversation", async () => {
    let cursor: string | undefined;
    let total = 0;
    let pages = 0;
    const t0 = Date.now();
    // Bounded walk: every page must advance the cursor (or end it), so more
    // than 500 pages proves a pagination stall.
    for (pages = 0; pages < 500; pages++) {
      const page = await archive.readPage({
        conversationId: CONV,
        cursor,
        maxRows: 64,
        maxCodePoints: 8_000,
      });
      total += page.records.length;
      expect(page.records.length).toBeLessThanOrEqual(64);
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    const elapsed = Date.now() - t0;
    console.log(
      `[perf] 10k forward walk: ${total} rows in ${pages} pages, ${elapsed}ms`
    );
    expect(total).toBe(N);
  }, 120_000);

  it("searches a common marker with a bounded first page", async () => {
    const t0 = Date.now();
    const res = await service.search({
      conversationId: CONV,
      query: "alpha-beta",
      limit: 10,
      turnId: "t-perf-1",
    });
    const elapsed = Date.now() - t0;
    console.log(
      `[perf] 10k search first page: ${res.records.length} records, ` +
        `scanComplete=${res.scanComplete}, ${elapsed}ms`
    );
    expect(res.records.length).toBeLessThanOrEqual(10);
    expect(res.records.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(30_000);
  }, 120_000);

  it("reads a single source with a bounded slice + continuation", async () => {
    // The match sits deep in the scan (message 4242 of 10k), so the bounded
    // scan returns continuations first — the caller pages, never rescans.
    let cursor: string | undefined;
    let hit: string | null = null;
    for (let i = 0; i < 40 && !hit; i++) {
      const page = await service.search({
        conversationId: CONV,
        query: "perf message number 4242",
        cursor,
        limit: 5,
        turnId: `t-perf-2-${i}`,
      });
      if (page.records.length > 0) hit = page.records[0].sourceId;
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(hit).not.toBeNull();
    const t0 = Date.now();
    const read = await service.read({
      conversationId: CONV,
      args: { source_id: hit as string },
      turnId: "t-perf-3",
    });
    const elapsed = Date.now() - t0;
    console.log(`[perf] 10k single read: ${elapsed}ms`);
    expect(read.records.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10_000);
  }, 120_000);

  it("truncates oversized rows at the byte allowance with continuation", async () => {
    const repo =
      SqliteDb.getInstance(tmpDir).connection.getRepository(
        AIChatMessageEntity
      );
    const big = new AIChatMessageEntity();
    big.messageId = "perf-big-1";
    big.conversationId = CONV;
    big.role = "user";
    big.content = "BIG:" + "y".repeat(100_000);
    // Oldest timestamp: the oversized row lands on the first page.
    big.timestamp = new Date(0);
    big.messageType = MessageType.MESSAGE;
    await repo.save(big);

    const page = await archive.readPage({
      conversationId: CONV,
      maxRows: 64,
      maxCodePoints: 8_000,
    });
    // The 100KB row is force-included alone so pagination always advances
    // (row-count limits alone never bound oversized payloads); the page
    // reports truncation + continuation instead of stalling.
    expect(page.records).toHaveLength(1);
    expect(page.records[0].messageId).toBe("perf-big-1");
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    // The continuation advances PAST the oversized row (no stall, no repeat).
    const next = await archive.readPage({
      conversationId: CONV,
      cursor: page.nextCursor ?? undefined,
      maxRows: 64,
      maxCodePoints: 8_000,
    });
    expect(
      next.records.some((r) => r.messageId === "perf-big-1")
    ).toBe(false);
    expect(next.records.length).toBeGreaterThan(0);
  }, 120_000);
});
