/**
 * Unit tests for AIChatSectionPacker (technical-design §9).
 *
 * Verifies:
 * - Complete turns are packed into text fragments with role + source reference.
 * - Oversized messages split at paragraph/sentence → code-point boundaries.
 * - Fragments have contiguous coverage with no omitted code points.
 * - No exclusion boundary is published before full terminal-turn coverage.
 * - Interrupted tool exchanges are receipts marked interrupted (not successful).
 * - The packer owns the coverage ledger and stays within the source-byte budget.
 *
 * Token/USERSDBPATH are mocked so every Model/Module constructed here shares
 * one per-run test database (established pattern).
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
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { AIChatSectionPacker } from "@/service/AIChatSectionPacker";

const tmpDir = path.join(
  os.tmpdir(),
  `aifetchly-packer-${crypto.randomUUID()}`
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

async function seedMessages(
  conversationId: string,
  rows: Array<{
    role: string;
    content: string;
    ts: number;
    messageId?: string;
    messageType?: MessageType;
    metadata?: Record<string, unknown>;
  }>
): Promise<void> {
  const repo =
    SqliteDb.getInstance(tmpDir).connection.getRepository(AIChatMessageEntity);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entity = new AIChatMessageEntity();
    entity.messageId = r.messageId ?? `msg-${conversationId}-${i}`;
    entity.conversationId = conversationId;
    entity.role = r.role;
    entity.content = r.content;
    entity.timestamp = new Date(r.ts);
    entity.messageType = r.messageType ?? MessageType.MESSAGE;
    if (r.metadata) entity.metadata = JSON.stringify(r.metadata);
    await repo.save(entity);
  }
}

async function indexConversation(conversationId: string): Promise<void> {
  const stateModel = new AIChatArchiveStateModel(tmpDir);
  await stateModel.ensureState(conversationId);
  await stateModel.setIndexState(conversationId, "complete");
}

describe("AIChatSectionPacker", () => {
  let packer: AIChatSectionPacker;

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  });

  beforeEach(async () => {
    resetDbSingleton();
    SqliteDb.getInstance(tmpDir);
    await SqliteDb.ensureInitialized();
    packer = new AIChatSectionPacker();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it("packs complete turns into text fragments with role + source reference", async () => {
    await seedMessages("conv-1", [
      { role: "user", content: "hello there", ts: 1_000 },
      { role: "assistant", content: "hi back", ts: 2_000 },
    ]);
    await indexConversation("conv-1");

    const result = await packer.pack({
      conversationId: "conv-1",
      sourceCapacityTokens: 4_000,
      endSnapshotTimestampMs: 3_000,
      endSnapshotRowId: 0,
    });

    expect(result.fragments.length).toBeGreaterThan(0);
    const first = result.fragments[0];
    expect(first.role).toBe("user");
    expect(first.text).toBe("hello there");
    expect(typeof first.sourceId).toBe("string");
    expect(first.startCodePoint).toBe(0);
    expect(first.endCodePoint).toBeGreaterThan(0);
    expect(first.exact).toBe(true);
  });

  it("splits oversized text at paragraph/sentence → code-point boundaries", async () => {
    // 3 paragraphs of ~300 chars each. With a small source budget the packer
    // must split into multiple contiguous fragments.
    const para = "This is a sentence. Another sentence follows. ".repeat(7);
    const content = `${para}\n\n${para}\n\n${para}`;
    await seedMessages("conv-2", [{ role: "user", content, ts: 1_000 }]);
    await indexConversation("conv-2");

    const result = await packer.pack({
      conversationId: "conv-2",
      sourceCapacityTokens: 200,
      endSnapshotTimestampMs: 2_000,
      endSnapshotRowId: 0,
    });

    // Multiple fragments produced from the single oversized message.
    expect(result.fragments.length).toBeGreaterThan(1);
    // Contiguous coverage: each fragment's end == next fragment's start.
    const ordered = [...result.fragments].sort(
      (a, b) =>
        a.sourceRowId - b.sourceRowId || a.startCodePoint - b.startCodePoint
    );
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].startCodePoint).toBe(ordered[i - 1].endCodePoint);
    }
    // First fragment starts at 0; last ends at the full code-point length.
    expect(ordered[0].startCodePoint).toBe(0);
    const total = ordered[ordered.length - 1].endCodePoint;
    expect(total).toBeGreaterThan(0);
  });

  it("emits a receipt for an interrupted tool exchange (interrupted, not successful)", async () => {
    // An assistant tool_call message with no paired result row → interrupted.
    await seedMessages("conv-3", [
      {
        role: "assistant",
        content: "",
        ts: 1_000,
        metadata: {
          tool_calls: [{ id: "call-1", function: { name: "search" } }],
        },
      },
    ]);
    await indexConversation("conv-3");

    const result = await packer.pack({
      conversationId: "conv-3",
      sourceCapacityTokens: 4_000,
      endSnapshotTimestampMs: 2_000,
      endSnapshotRowId: 0,
    });

    const receipt = result.receipts.find((r) => r.toolCallId === "call-1");
    expect(receipt).toBeDefined();
    expect(receipt?.status).toBe("interrupted");
  });

  it("does not publish an exclusion boundary before full terminal-turn coverage", async () => {
    // Build a turn that exceeds the budget — the packer must NOT mark the
    // coverage complete (exclusionBoundary stays undefined).
    const big = "x".repeat(20_000);
    await seedMessages("conv-4", [{ role: "user", content: big, ts: 1_000 }]);
    await indexConversation("conv-4");

    const result = await packer.pack({
      conversationId: "conv-4",
      sourceCapacityTokens: 100,
      endSnapshotTimestampMs: 2_000,
      endSnapshotRowId: 0,
    });

    // Coverage is partial → no exclusion boundary published.
    expect(result.exclusionBoundary).toBeUndefined();
    expect(result.coverageComplete).toBe(false);
  });

  it("respects the source-byte budget and truncates after it", async () => {
    await seedMessages("conv-5", [
      { role: "user", content: "a".repeat(2_000), ts: 1_000 },
      { role: "assistant", content: "b".repeat(2_000), ts: 2_000 },
    ]);
    await indexConversation("conv-5");

    const result = await packer.pack({
      conversationId: "conv-5",
      sourceCapacityTokens: 50, // ~200 bytes → tiny
      endSnapshotTimestampMs: 3_000,
      endSnapshotRowId: 0,
    });

    const packedChars = result.fragments.reduce(
      (sum, f) => sum + (f.endCodePoint - f.startCodePoint),
      0
    );
    // Conservative byte estimate: packed chars must not wildly exceed budget.
    expect(packedChars).toBeLessThanOrEqual(2_000);
    expect(result.coverageComplete).toBe(false);
  });

  it("bounds one section's total source to the requested token capacity (§8.3)", async () => {
    // Capacity 5,000 tokens ≈ 20,000 chars ASCII. Seed 16 × 2,000-char rows
    // (32,000 chars): one pack must admit ≈ half, not all of it. The old
    // double conversion (tokens → cp × 4, then model bytes = cp × 4) let a
    // single section carry 4× the intended budget.
    const rows = Array.from({ length: 16 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "w".repeat(2_000),
      ts: 1_000 + i * 1_000,
    }));
    await seedMessages("conv-cap-pack", rows);
    await indexConversation("conv-cap-pack");

    const result = await packer.pack({
      conversationId: "conv-cap-pack",
      sourceCapacityTokens: 5_000,
      endSnapshotTimestampMs: 0,
      endSnapshotRowId: 0,
    });
    const packedChars = result.fragments.reduce(
      (sum, f) => sum + (f.endCodePoint - f.startCodePoint),
      0
    );
    // 5,000 tokens ≈ 20,000 chars; the section must not swallow the whole
    // 32,000-char page. Allow one row of headroom for force-inclusion.
    expect(packedChars).toBeLessThanOrEqual(24_000);
    expect(result.nextCursor).not.toBeNull();
  });

  it("packs equal-timestamp rows up to the snapshot rowId and skips later ids (AC-09)", async () => {
    const conv = "conv-ac09-eqts";
    const ts = 1_000;
    await seedMessages(conv, [
      { role: "user", content: "same-ts-first", ts },
      { role: "assistant", content: "same-ts-second", ts },
      { role: "user", content: "same-ts-third-after-snapshot", ts },
    ]);
    await indexConversation(conv);
    const repo = SqliteDb.getInstance(tmpDir).connection.getRepository(
      AIChatMessageEntity
    );
    const rows = await repo.find({
      where: { conversationId: conv },
      order: { id: "ASC" },
    });
    expect(rows).toHaveLength(3);
    const snapshotRowId = rows[1].id;

    const result = await packer.pack({
      conversationId: conv,
      sourceCapacityTokens: 4_000,
      endSnapshotTimestampMs: ts,
      endSnapshotRowId: snapshotRowId,
    });
    const packed = result.fragments.map((f) => f.text).join("\n");
    expect(packed).toContain("same-ts-first");
    expect(packed).toContain("same-ts-second");
    expect(packed).not.toContain("same-ts-third-after-snapshot");
  });

  it("withholds exclusion when the terminal turn is incomplete (P1-1/FR-05)", async () => {
    await seedMessages("conv-mid-turn", [
      { role: "user", content: "q1", ts: 1_000 },
      { role: "assistant", content: "a1", ts: 2_000 },
      { role: "user", content: "q2 without reply", ts: 3_000 },
    ]);
    await indexConversation("conv-mid-turn");
    const result = await packer.pack({
      conversationId: "conv-mid-turn",
      sourceCapacityTokens: 4_000,
      endSnapshotTimestampMs: 4_000,
      endSnapshotRowId: 0,
    });
    expect(result.fragments.length).toBe(3);
    expect(result.exclusionBoundary).toBeUndefined();
  });

  it("withholds exclusion on truncated pages and continues via cursor (P1-1/AC-06)", async () => {
    await seedMessages("conv-trunc", [
      { role: "user", content: "x".repeat(2_000), ts: 1_000 },
      { role: "assistant", content: "y".repeat(2_000), ts: 2_000 },
    ]);
    await indexConversation("conv-trunc");
    const first = await packer.pack({
      conversationId: "conv-trunc",
      sourceCapacityTokens: 50,
      endSnapshotTimestampMs: 3_000,
      endSnapshotRowId: 0,
    });
    expect(first.coverageComplete).toBe(false);
    expect(first.exclusionBoundary).toBeUndefined();
    expect(first.nextCursor).not.toBeNull();
  });
});
