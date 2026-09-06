/**
 * Unit tests for OutboundEmailDeliveryModel.listOutcomesRecent — the
 * batch-agnostic recent delivery-outcome query backing the unified send-log
 * view's authorized-send half. Mirrors the legacy send-log model's where/sort
 * contract (recipient where-filter, id/completedAt/status sort allow-list,
 * default newest-first by id) so the aggregator can merge both halves with a
 * single sort.
 *
 * Outcomes are seeded directly via createOutcome (no worker/authorization
 * wiring needed — this is a pure data-access test).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { OutboundEmailDeliveryModel } from "@/model/OutboundEmailDelivery.model";
import { OutboundEmailDeliveryOutcomeEntity } from "@/entity/OutboundEmailDeliveryOutcome.entity";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-outbound-delivery-model");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  nextDraftId = 1;
});

const HASH = "a".repeat(64);

// Unique (sendAttemptId, draftId) index requires distinct draftIds per row.
// Auto-increment across a test, reset in beforeEach.
let nextDraftId = 1;

async function seedOutcome(
  model: OutboundEmailDeliveryModel,
  recipient: string,
  status:
    | "pending"
    | "submitted"
    | "sent"
    | "suppressed"
    | "failed"
    | "delivery_unknown",
  completedAt: Date | null = null
): Promise<number> {
  const entity = new OutboundEmailDeliveryOutcomeEntity();
  entity.sendAttemptId = 1;
  entity.batchId = 1;
  entity.draftId = nextDraftId++;
  entity.revisionId = 1;
  entity.envelopeHash = HASH;
  entity.recipientAddress = recipient;
  entity.status = status;
  entity.providerMessageId = null;
  entity.errorCode = null;
  entity.submittedAt = null;
  entity.completedAt = completedAt;
  const saved = await model.createOutcome(entity);
  return saved.id;
}

describe("OutboundEmailDeliveryModel.listOutcomesRecent", () => {
  it("returns outcomes across all batches", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);

    await seedOutcome(model, "a@example.com", "sent");
    await seedOutcome(model, "b@example.com", "failed");
    await seedOutcome(model, "c@example.com", "delivery_unknown");

    const { records, total } = await model.listOutcomesRecent(0, 100);
    expect(total).toBe(3);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.recipientAddress).sort()).toEqual(
      ["a@example.com", "b@example.com", "c@example.com"].sort()
    );
  });

  it("defaults to newest-first (order by id DESC)", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);

    const ids: number[] = [];
    ids.push(await seedOutcome(model, "first@x.com", "sent"));
    ids.push(await seedOutcome(model, "second@x.com", "sent"));
    ids.push(await seedOutcome(model, "third@x.com", "sent"));

    const { records } = await model.listOutcomesRecent(0, 100);
    expect(records.map((r) => r.id)).toEqual([...ids].reverse());
  });

  it("filters by recipientAddress via the where clause", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);

    await seedOutcome(model, "alice@example.com", "sent");
    await seedOutcome(model, "bob@example.com", "failed");
    await seedOutcome(model, "carol@example.com", "sent");

    const { records, total } = await model.listOutcomesRecent(0, 100, "alice");
    expect(total).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0].recipientAddress).toBe("alice@example.com");
  });

  it("sorts by status asc", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);

    // Seed out of alphabetical order so the sort is meaningful.
    await seedOutcome(model, "z@x.com", "sent");
    await seedOutcome(model, "a@x.com", "failed");

    const { records } = await model.listOutcomesRecent(0, 100, undefined, {
      key: "status",
      order: "asc",
    });
    // "failed" < "sent" alphabetically.
    expect(records[0].status).toBe("failed");
    expect(records[1].status).toBe("sent");
  });

  it("sorts by completedAt desc", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);

    const t1 = new Date("2026-01-01T00:00:00.000Z");
    const t2 = new Date("2026-06-01T00:00:00.000Z");
    await seedOutcome(model, "early@x.com", "sent", t1);
    await seedOutcome(model, "late@x.com", "sent", t2);

    const { records } = await model.listOutcomesRecent(0, 100, undefined, {
      key: "completedat",
      order: "desc",
    });
    expect(records[0].recipientAddress).toBe("late@x.com");
    expect(records[1].recipientAddress).toBe("early@x.com");
  });

  it("rejects disallowed sort keys", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);
    await seedOutcome(model, "a@x.com", "sent");

    await expect(
      model.listOutcomesRecent(0, 100, undefined, {
        key: "recipientAddress",
        order: "asc",
      })
    ).rejects.toThrow("not allow sort key");
  });

  it("paginates with skip/take", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);

    for (let i = 0; i < 5; i++) {
      await seedOutcome(model, `u${i}@x.com`, "sent");
    }

    const { records, total } = await model.listOutcomesRecent(2, 2);
    expect(total).toBe(5);
    expect(records).toHaveLength(2);
  });

  it("returns empty when no outcomes exist", async () => {
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    const model = new OutboundEmailDeliveryModel(tmpDir);

    const { records, total } = await model.listOutcomesRecent(0, 100);
    expect(total).toBe(0);
    expect(records).toHaveLength(0);
  });
});
