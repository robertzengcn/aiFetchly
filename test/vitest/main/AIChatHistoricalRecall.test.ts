/**
 * Deterministic half of historical-recall qualification (PRD §10, AC-01).
 *
 * Seeds all 50 versioned dataset cases (six languages) into one archived
 * conversation and proves every exact marker is recoverable byte-for-byte via
 * search→read — the storage foundation that model-answer scoring builds on.
 *
 * Live-model scoring (≥95% source-backed answers, zero fabricated exact
 * quotes under the release model/provider) is a manual qualification step:
 * run the script noted in the dataset file with `AIFETCHLY_RECALL_LIVE=1`
 * and record model/window, accuracy, and fabricated-quote count in the PRD
 * TODO file. This suite never fabricates: a missing marker fails loudly.
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
import { RECALL_DATASET_V1 } from "./AIChatHistoricalRecall.dataset";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-recall-${crypto.randomUUID()}`
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

const CONV = "conv-recall-50";

describe("AIChatHistoricalRecall storage (50-case six-language dataset)", () => {
  let service: AIChatHistoryRetrievalService;

  beforeAll(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    expect(RECALL_DATASET_V1).toHaveLength(50);
    const repo =
      SqliteDb.getInstance(tmpDir).connection.getRepository(
        AIChatMessageEntity
      );
    const batch: AIChatMessageEntity[] = [];
    RECALL_DATASET_V1.forEach((c, i) => {
      const e = new AIChatMessageEntity();
      e.messageId = `recall-${c.id}`;
      e.conversationId = CONV;
      e.role = i % 2 === 0 ? "user" : "assistant";
      e.content = c.text;
      e.timestamp = new Date(1_000 + i * 1_000);
      e.messageType = MessageType.MESSAGE;
      batch.push(e);
    });
    await repo.insert(batch);
    const stateModel = new AIChatArchiveStateModel(tmpDir);
    await stateModel.ensureState(CONV);
    await stateModel.setIndexState(CONV, "complete");
    const fragModel = new AIChatArchiveSearchFragmentModel(tmpDir);
    const rows = await repo.find({ where: { conversationId: CONV } });
    for (const row of rows) {
      await fragModel.indexSourceContent(
        CONV,
        row.id,
        "content",
        row.content ?? ""
      );
    }
    service = new AIChatHistoryRetrievalService(new AIChatArchiveModule());
  }, 300_000);

  afterEach(() => {
    // Keep the singleton: reseeding 50 messages + fragments is expensive.
  });

  it("correction pairs stay citable with the correction ordered later (AC-02 storage half)", async () => {
    // Model-side preference (later explicit correction wins) needs live
    // scoring; the storage contract underneath is: BOTH passages remain
    // retrievable with source links, and timestamps order correction after
    // decision so preference has a basis.
    for (const [decideId, correctId] of [
      ["en-04", "en-05"],
      ["zh-04", "zh-05"],
    ] as const) {
      const decide = RECALL_DATASET_V1.find((c) => c.id === decideId)!;
      const correct = RECALL_DATASET_V1.find((c) => c.id === correctId)!;
      const find = async (marker: string, tag: string) => {
        let cursor: string | undefined;
        for (let page = 0; page < 25; page++) {
          const hit = await service.search({
            conversationId: CONV,
            query: marker,
            cursor,
            limit: 5,
            turnId: `t-ac02-${tag}-${page}`,
          });
          const rec = hit.records.find((r) => r.text.includes(marker));
          if (rec) return rec;
          cursor = hit.nextCursor ?? undefined;
          if (!cursor) break;
        }
        throw new Error(`AC-02 marker not found: ${marker}`);
      };
      const decision = await find(decide.marker, decideId);
      const correction = await find(correct.marker, correctId);
      // Both citable with valid source links...
      expect(decision.sourceId).toBeTruthy();
      expect(correction.sourceId).toBeTruthy();
      // ...and the correction is strictly later, so "prefer later explicit
      // corrections" (FR-04) has a deterministic basis.
      expect(new Date(correction.timestamp).getTime()).toBeGreaterThan(
        new Date(decision.timestamp).getTime()
      );
    }
  });

  it.each(RECALL_DATASET_V1.map((c) => [c.id, c.marker, c.text] as const))(
    "%s: exact marker recoverable byte-for-byte via search→read",
    async (_id, marker, text) => {
      // Follow the search continuation to scan completion: the bounded scan
      // (500 fragments / 100 ms per backend page) may return an empty first
      // page under load for a marker that exists later in the walk. An empty
      // page with a cursor is NEVER "no match" — only scan completion ends
      // the search (FR-02, AC-01).
      let cursor: string | undefined;
      let rec: { sourceId: string; text: string } | undefined;
      let scanComplete = false;
      for (let page = 0; page < 25 && !rec; page++) {
        const hit = await service.search({
          conversationId: CONV,
          query: marker,
          cursor,
          limit: 5,
          turnId: `t-recall-${marker}`,
        });
        rec = hit.records.find((r) => r.text.includes(marker));
        scanComplete = hit.scanComplete;
        cursor = hit.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(rec, `marker not found: ${marker}`).toBeDefined();
      expect(scanComplete || rec).toBeTruthy();
      const read = await service.read({
        conversationId: CONV,
        args: { source_id: rec!.sourceId },
        turnId: `t-recall-read-${marker}`,
      });
      // Byte-exact recovery of the stored passage (no summarizer involved).
      expect(read.records[0]?.text).toContain(marker);
      expect(text).toContain(read.records[0]?.text ?? "\u0000NOMATCH");
    },
    120_000
  );
});
