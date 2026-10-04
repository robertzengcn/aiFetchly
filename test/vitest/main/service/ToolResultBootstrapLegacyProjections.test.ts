/**
 * T14 legacy projection backfill — resumable write path (design §10.2).
 *
 * Boundary test for `ToolResultBootstrapService.backfillLegacyProjections`
 * driving the REAL `AIChatMessageArchiveModel.scanOversizedRowsAboveCursor`
 * and the REAL projection repository over tmp SQLite (not mocked). The
 * design's claims under test:
 *
 *  - an oversized legacy row gets a bounded projection whose content is a
 *    truthful receipt (states original byte size, points at the source row),
 *    NOT the raw body;
 *  - the original source row is NEVER mutated — its `content` is byte-identical
 *    after the backfill;
 *  - the walk is RESUMABLE: a checkpoint after every batch lets an interrupted
 *    run continue from the last committed row instead of rescanning;
 *  - a small (non-oversized) row gets NO projection (the backfill skips it);
 *  - the backfill is idempotent — running it twice does not duplicate rows
 *    and does not rewrite an already-complete projection.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AIToolResultProjectionEntity } from "@/entity/AIToolResultProjection.entity";
import { AIToolOutputBootstrapEntity } from "@/entity/AIToolOutputBootstrap.entity";
import { SqliteDb } from "@/config/SqliteDb";
import { MessageType } from "@/entityTypes/commonType";
import {
  ToolResultBootstrapService,
  TOOL_OUTPUT_BOOTSTRAP_KEYS,
  LEGACY_PROJECTION_PREVIEW_BYTES,
} from "@/service/toolResult/ToolResultBootstrapService";
import { TOOL_RESULT_POLICY_VERSION } from "@/config/toolResultConfig";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import type { DataSource } from "typeorm";

// Per-run unique temp dir to avoid the known SQLITE_BUSY shared-db flake when
// parallel vitest workers collide on a fixed aifetchly-test path.
const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-t14-backfill-${crypto.randomUUID()}`
);

function resetDbSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

async function seedMessage(input: {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  ts: number;
}): Promise<AIChatMessageEntity> {
  const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
    AIChatMessageEntity
  );
  const entity = new AIChatMessageEntity();
  entity.messageId = input.messageId;
  entity.conversationId = input.conversationId;
  entity.role = input.role;
  entity.content = input.content;
  entity.timestamp = new Date(input.ts);
  entity.messageType = MessageType.MESSAGE;
  return await repo.save(entity);
}

function readProjection(
  ds: DataSource,
  sourceRowKey: string
): Promise<AIToolResultProjectionEntity | null> {
  return ds.getRepository(AIToolResultProjectionEntity).findOne({
    where: {
      profileId: "default",
      sourceRowKey,
      outputEpoch: "legacy",
      policyVersion: TOOL_RESULT_POLICY_VERSION,
    },
  });
}

function readMarker(
  ds: DataSource,
  key: string
): Promise<AIToolOutputBootstrapEntity | null> {
  return ds.getRepository(AIToolOutputBootstrapEntity).findOne({
    where: { profileId: "default", bootstrapKey: key },
  });
}

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  resetDbSingleton();
  SqliteDb.getInstance(tmpDir);
});

afterEach(() => {
  resetDbSingleton();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("T14 legacy projection backfill", () => {
  it("builds a bounded projection for an oversized legacy row, never mutating the source", async () => {
    await SqliteDb.ensureInitialized();
    const ds = SqliteDb.getInstance(tmpDir).connection;

    // An oversized body well above the inline threshold.
    const hugeBody = "x".repeat(TOOL_RESULT_CONFIG.inlineMaxBytes * 4);
    const seeded = await seedMessage({
      messageId: "big-1",
      conversationId: "conv-backfill",
      role: "user",
      content: hugeBody,
      ts: 1_000,
    });
    // A small row that must NOT get a projection.
    const small = await seedMessage({
      messageId: "small-1",
      conversationId: "conv-backfill",
      role: "user",
      content: "tiny body",
      ts: 2_000,
    });

    const service = new ToolResultBootstrapService(ds, "default");
    await service.backfillLegacyProjections({ onYield: () => undefined });

    const proj = await readProjection(ds, "big-1");
    expect(proj).not.toBeNull();
    // The bounded receipt states the original byte size and points at the
    // source row for retrieval — it is NOT the raw body.
    expect(proj!.content).toContain(
      String(Buffer.byteLength(hugeBody, "utf8"))
    );
    expect(proj!.content).toContain("big-1");
    expect(proj!.content.length).toBeLessThan(hugeBody.length);
    // The projection carries a legacy marker + the original role in metadata.
    const meta = JSON.parse(proj!.metadataJson) as {
      legacyProjection: boolean;
      originalBytes: number;
      role: string;
    };
    expect(meta.legacyProjection).toBe(true);
    expect(meta.originalBytes).toBe(Buffer.byteLength(hugeBody, "utf8"));
    expect(meta.role).toBe("user");
    // The output ref points at the legacy source row.
    const refs = JSON.parse(proj!.outputRefsJson) as Array<{
      backend: string;
      sourceRowKey: string;
      conversationId: string;
    }>;
    expect(refs[0].backend).toBe("legacy_message");
    expect(refs[0].sourceRowKey).toBe("big-1");
    expect(refs[0].conversationId).toBe("conv-backfill");

    // The small row gets NO projection.
    const smallProj = await readProjection(ds, "small-1");
    expect(smallProj).toBeNull();

    // The original source rows are NEVER mutated.
    const msgRepo = ds.getRepository(AIChatMessageEntity);
    const bigAfter = await msgRepo.findOne({ where: { id: seeded.id } });
    const smallAfter = await msgRepo.findOne({ where: { id: small.id } });
    expect(bigAfter!.content).toBe(hugeBody);
    expect(smallAfter!.content).toBe("tiny body");
  });

  it("is resumable: a checkpoint after every batch lets an interrupted run continue", async () => {
    await SqliteDb.ensureInitialized();
    const ds = SqliteDb.getInstance(tmpDir).connection;

    // Seed several oversized rows across distinct timestamps so the keyset
    // walk produces multiple batches under a tiny batch size.
    const bodies: AIChatMessageEntity[] = [];
    for (let i = 0; i < 3; i++) {
      bodies.push(
        await seedMessage({
          messageId: `big-r-${i}`,
          conversationId: "conv-resume",
          role: "user",
          content: "y".repeat(TOOL_RESULT_CONFIG.inlineMaxBytes * 2),
          ts: 10_000 + i,
        })
      );
    }

    const service = new ToolResultBootstrapService(ds, "default");

    // First call: process only ONE row per batch (batchRows=1), then
    // "interrupt" by aborting from onYield after the first batch is
    // checkpointed. The walk checkpoints after every batch, so a marker
    // position must exist strictly past the first projected row.
    let firstBatchSeen = false;
    let interrupted = false;
    await service
      .backfillLegacyProjections({
        batchRows: 1,
        onYield: () => {
          // Emulate an interrupt at the first batch boundary: throw so the
          // walk stops AFTER the checkpoint but BEFORE the next batch. The
          // marker is already written with completed=false (resume position).
          if (!firstBatchSeen) {
            firstBatchSeen = true;
            return;
          }
          interrupted = true;
          throw new Error("interrupted mid-walk");
        },
      })
      .catch(() => undefined);
    expect(interrupted).toBe(true);

    // At least the first row has a projection now.
    const p0 = await readProjection(ds, "big-r-0");
    expect(p0).not.toBeNull();

    // The marker holds a resume position (not yet complete).
    const marker = await readMarker(ds, TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections);
    expect(marker).not.toBeNull();
    expect(marker!.lastPositionJson).not.toBeNull();
    expect(marker!.completed).toBe(false);
    const pos = JSON.parse(
      JSON.parse(marker!.lastPositionJson as string) as string
    ) as { ts: number; rid: number };
    expect(pos.ts).toBeGreaterThanOrEqual(bodies[0].timestamp.getTime());

    // Second call: resume from the checkpoint and finish the walk via runStep,
    // which marks the step complete on a clean finish. Rows already projected
    // are NOT rewritten (idempotent); the remaining rows get projections.
    const result = await service.runStep(
      TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections,
      { batchRows: 1, onYield: () => undefined }
    );
    expect(result.completed).toBe(true);

    for (let i = 0; i < 3; i++) {
      const p = await readProjection(ds, `big-r-${i}`);
      expect(p, `big-r-${i} should have a projection after resume`).not.toBeNull();
    }

    // The marker is now complete.
    const done = await readMarker(ds, TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections);
    expect(done!.completed).toBe(true);
  });

  it("is idempotent: running twice does not duplicate or rewrite an already-complete projection", async () => {
    await SqliteDb.ensureInitialized();
    const ds = SqliteDb.getInstance(tmpDir).connection;

    const seeded = await seedMessage({
      messageId: "big-id",
      conversationId: "conv-idem",
      role: "user",
      content: "z".repeat(TOOL_RESULT_CONFIG.inlineMaxBytes * 3),
      ts: 5_000,
    });

    const service = new ToolResultBootstrapService(ds, "default");
    // runStep marks the step complete on finish, so a second run is a no-op.
    const first = await service.runStep(
      TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections,
      { onYield: () => undefined }
    );
    expect(first.completed).toBe(true);
    const proj1 = await readProjection(ds, "big-id");
    expect(proj1).not.toBeNull();
    const firstContent = proj1!.content;

    // Second run: the marker is complete, so runStep short-circuits — the
    // walk does not execute and the projection is byte-identical.
    const second = await service.runStep(
      TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections,
      { onYield: () => undefined }
    );
    expect(second.ran).toBe(false);
    expect(second.completed).toBe(true);
    const proj2 = await readProjection(ds, "big-id");
    expect(proj2).not.toBeNull();
    expect(proj2!.content).toBe(firstContent);

    // Exactly one projection row for this source key.
    const all = await ds
      .getRepository(AIToolResultProjectionEntity)
      .find({ where: { sourceRowKey: "big-id" } });
    expect(all.length).toBe(1);

    // Source row untouched.
    const after = await ds
      .getRepository(AIChatMessageEntity)
      .findOne({ where: { id: seeded.id } });
    expect(after!.content.startsWith("z")).toBe(true);
  });

  it("truncates the preview to the bounded byte budget", async () => {
    await SqliteDb.ensureInitialized();
    const ds = SqliteDb.getInstance(tmpDir).connection;

    // A body large enough that BOTH the oversized filter passes AND the
    // preview is truncated: well above inlineMaxBytes and the preview budget.
    const huge = "q".repeat(TOOL_RESULT_CONFIG.inlineMaxBytes + LEGACY_PROJECTION_PREVIEW_BYTES * 4);
    await seedMessage({
      messageId: "big-trunc",
      conversationId: "conv-trunc",
      role: "assistant",
      content: huge,
      ts: 7_000,
    });

    const service = new ToolResultBootstrapService(ds, "default");
    await service.backfillLegacyProjections({ onYield: () => undefined });

    const proj = await readProjection(ds, "big-trunc");
    expect(proj).not.toBeNull();
    // The receipt honestly states the preview is truncated.
    expect(proj!.content).toContain("truncated");
    expect(proj!.content).toContain("[truncated]");
    // The bounded receipt is far smaller than the original body.
    expect(proj!.content.length).toBeLessThan(huge.length);
  });
});
