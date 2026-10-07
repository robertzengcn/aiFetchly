/**
 * Legacy projection substitution on the read path (T14 / design §10.2).
 *
 * Boundary test for `AIChatContextAssembler.loadTurnBackedRows` →
 * `substituteProjections`. The design's claims under test:
 *
 *  - when a projection exists for an oversized legacy row, the assembler
 *    costs + sends the BOUNDED projection content (not the raw body), so a
 *    turn that would have exceeded the recent-turn budget now fits;
 *  - the original row object is never mutated — rows without a projection
 *    pass through with their raw content (immutability, no side effects);
 *  - a projection lookup failure never breaks context assembly — the
 *    assembler falls back to raw content (graceful degradation);
 *  - the production adapter `ToolResultModule.asLegacyProjectionLookup()`
 *    resolves real projections from tmp SQLite (boundary, not mocked);
 *  - when no projectionLookup is wired, the pre-T14 raw-content behavior is
 *    preserved (strictly additive).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import type {
  LegacyProjection,
  LegacyProjectionLookup,
} from "@/entityTypes/toolResultTypes";

// --- Shared mock infrastructure (mirrors AIChatContextAssembler.test.ts) ---

const mockGetByConversation = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockGetRecentMessages = vi.fn();
const mockFindBoundaryInConversation = vi.fn();
const mockDurableRetrieve = vi.fn();
const mockWorkspaceRetrieve = vi.fn();
const mockListActiveForRuntime = vi.fn();

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(function () {
    return { getByConversation: mockGetByConversation };
  }),
}));
vi.mock("@/service/AIWorkspaceMemoryRetrievalService", () => ({
  AIWorkspaceMemoryRetrievalService: vi.fn().mockImplementation(function () {
    return { retrieve: mockWorkspaceRetrieve };
  }),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(function () {
    return { getActiveSummary: mockGetActiveSummary };
  }),
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
      getConversationMessages: mockGetConversationMessages,
      getRecentMessages: mockGetRecentMessages,
      findBoundaryInConversation: mockFindBoundaryInConversation,
    };
  }),
}));
vi.mock("@/service/AIUserMemoryRetrievalService", () => ({
  AIUserMemoryRetrievalService: vi.fn().mockImplementation(function () {
    return { retrieve: mockDurableRetrieve };
  }),
}));
vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(function () {
    return { getSettingValue: vi.fn() };
  }),
}));
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(function () {
    return { listActiveForRuntime: mockListActiveForRuntime };
  }),
}));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn() };
  }),
}));

function trow(
  id: number,
  messageId: string,
  role: string,
  content: string,
  ts: number
): AIChatMessageEntity {
  return {
    id,
    messageId,
    conversationId: "v2-proj",
    role,
    content,
    timestamp: new Date(ts),
    messageType: MessageType.MESSAGE,
  } as AIChatMessageEntity;
}

function stubArchive(opts: {
  ranges: Array<{
    turnId: string;
    firstTimestampMs: number;
    firstRowId: number;
    lastTimestampMs: number;
    lastRowId: number;
  }>;
  rowsByTurn: Record<string, AIChatMessageEntity[]>;
  live: AIChatMessageEntity[];
}) {
  return {
    getRecentTurnRanges: vi.fn().mockResolvedValue(opts.ranges),
    readTurnRows: vi
      .fn()
      .mockImplementation(
        (
          _conv: string,
          firstTs: number,
          firstRow: number,
          lastTs: number,
          lastRow: number
        ) => {
          const key = `${firstTs}:${firstRow}:${lastTs}:${lastRow}`;
          const rows = opts.rowsByTurn[key] ?? [];
          return Promise.resolve({ rows, complete: true });
        }
      ),
    readRowsAfter: vi.fn().mockResolvedValue({ rows: opts.live, complete: true }),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindBoundaryInConversation.mockResolvedValue(null);
  mockDurableRetrieve.mockResolvedValue({
    memories: [],
    tokenEstimate: 0,
    contextBlock: "",
  });
  mockWorkspaceRetrieve.mockResolvedValue({
    memories: [],
    tokenEstimate: 0,
    contextBlock: "",
  });
  mockGetByConversation.mockResolvedValue(null);
  mockGetActiveSummary.mockResolvedValue(null);
  mockGetRecentMessages.mockResolvedValue([]);
  mockListActiveForRuntime.mockResolvedValue([]);
});

/** A fake lookup that returns a fixed projection for the given keys. */
function fakeLookup(
  projections: Map<string, LegacyProjection>
): LegacyProjectionLookup {
  return {
    async lookup(input: {
      profileId: string;
      sourceRowKeys: readonly string[];
    }) {
      const out = new Map<string, LegacyProjection>();
      for (const key of input.sourceRowKeys) {
        const p = projections.get(key);
        if (p) out.set(key, p);
      }
      return out;
    },
  };
}

describe("T14 read-path projection substitution", () => {
  it("substitutes a bounded projection for an oversized turn so it fits the budget", async () => {
    // A turn body so large it would normally exceed the recent-turn budget
    // (default 6,000 tokens ≈ 24,000 code points). The projection is a tiny
    // bounded receipt that replaces it.
    const hugeBody = "x".repeat(60_000);
    const bigTurn = [trow(1, "big-u", "user", hugeBody, 1)];
    const live = [trow(2, "live-u", "user", "next", 2)];

    const projections = new Map<string, LegacyProjection>([
      [
        "big-u",
        {
          sourceRowKey: "big-u",
          content: "[bounded receipt: oversized turn]",
          metadataJson: "{}",
          outputRefsJson: "[]",
        },
      ],
    ]);

    const asm = new AIChatContextAssembler({
      archiveModule: stubArchive({
        ranges: [
          {
            turnId: "t-big",
            firstTimestampMs: 1,
            firstRowId: 1,
            lastTimestampMs: 1,
            lastRowId: 1,
          },
        ],
        rowsByTurn: { "1:1:1:1": bigTurn },
        live,
      }),
      projectionLookup: fakeLookup(projections),
    });

    const r = await asm.assemble({
      conversationId: "v2-proj",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const contents = r.messages.map((m) => m.content);
    // The bounded receipt appears — NOT the 60,000-char raw body.
    expect(contents).toContain("[bounded receipt: oversized turn]");
    expect(contents.some((c) => (c?.length ?? 0) === 60_000)).toBe(false);
    // The oversized turn that would have been a receipt is now retained
    // inline (its projection is cheap enough to fit the budget).
    expect(contents).toContain("next");
  });

  it("does not mutate the original row — rows without a projection keep raw content", async () => {
    const turn = [
      trow(1, "small-u", "user", "small body", 1),
      trow(2, "proj-u", "user", "huge raw body that has a projection", 2),
    ];
    const live = [trow(3, "live-u", "user", "live", 3)];

    const projections = new Map<string, LegacyProjection>([
      [
        "proj-u",
        {
          sourceRowKey: "proj-u",
          content: "[bounded]",
          metadataJson: "{}",
          outputRefsJson: "[]",
        },
      ],
    ]);

    const asm = new AIChatContextAssembler({
      archiveModule: stubArchive({
        ranges: [
          {
            turnId: "t",
            firstTimestampMs: 1,
            firstRowId: 1,
            lastTimestampMs: 2,
            lastRowId: 2,
          },
        ],
        rowsByTurn: { "1:1:2:2": turn },
        live,
      }),
      projectionLookup: fakeLookup(projections),
    });

    const r = await asm.assemble({
      conversationId: "v2-proj",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const contents = r.messages.map((m) => m.content);
    // The un-projected row keeps its raw content.
    expect(contents).toContain("small body");
    // The projected row shows the bounded content.
    expect(contents).toContain("[bounded]");
    // The original row object is untouched (immutability).
    expect(turn[1].content).toBe("huge raw body that has a projection");
  });

  it("falls back to raw content when the projection lookup throws", async () => {
    const hugeBody = "y".repeat(60_000);
    const bigTurn = [trow(1, "big-u", "user", hugeBody, 1)];
    const live = [trow(2, "live-u", "user", "next", 2)];

    // A lookup that rejects — assembly must not break.
    const throwingLookup: LegacyProjectionLookup = {
      async lookup() {
        throw new Error("lookup DB unavailable");
      },
    };

    const asm = new AIChatContextAssembler({
      archiveModule: stubArchive({
        ranges: [
          {
            turnId: "t-big",
            firstTimestampMs: 1,
            firstRowId: 1,
            lastTimestampMs: 1,
            lastRowId: 1,
          },
        ],
        rowsByTurn: { "1:1:1:1": bigTurn },
        live,
      }),
      projectionLookup: throwingLookup,
    });

    // Should not throw — graceful degradation to raw content. The oversized
    // turn becomes a receipt (the pre-T14 behavior), not a crash: the user's
    // current message is preserved (the turn still fits), and the oversized
    // raw body is NOT inlined — it is summarized as a retrievable receipt.
    const r = await asm.assemble({
      conversationId: "v2-proj",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.messages.length).toBeGreaterThan(0);
    const last = r.messages[r.messages.length - 1];
    expect(last.role).toBe("user");
    // The current user message is preserved (the live tail always is).
    expect(typeof last.content).toBe("string");
    expect((last.content as string).startsWith("next")).toBe(true);
    // The 60,000-char raw body is NOT inlined — it became a receipt, proving
    // the fallback path is the pre-T14 behavior rather than a silent dump.
    const contents = r.messages.map((m) => m.content);
    expect(
      contents.some((c) => typeof c === "string" && c.length === 60_000)
    ).toBe(false);
  });

  it("preserves the pre-T14 raw-content behavior when no projectionLookup is wired", async () => {
    const turn = [trow(1, "u", "user", "plain body", 1)];
    const live = [trow(2, "live-u", "user", "next", 2)];

    const asm = new AIChatContextAssembler({
      archiveModule: stubArchive({
        ranges: [
          {
            turnId: "t",
            firstTimestampMs: 1,
            firstRowId: 1,
            lastTimestampMs: 1,
            lastRowId: 1,
          },
        ],
        rowsByTurn: { "1:1:1:1": turn },
        live,
      }),
      // no projectionLookup
    });

    const r = await asm.assemble({
      conversationId: "v2-proj",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const contents = r.messages.map((m) => m.content);
    expect(contents).toContain("plain body");
    expect(contents).toContain("next");
  });
});

describe("T14 production adapter — ToolResultModule.asLegacyProjectionLookup", () => {
  it("resolves real projections from tmp SQLite", async () => {
    // Late-import so the module mocks above are in place first.
    const { ToolResultModule } = await import("@/modules/ToolResultModule");
    const { ToolResultModel } = await import("@/model/ToolResult.model");
    const { AIToolResultProjectionEntity } = await import(
      "@/entity/AIToolResultProjection.entity"
    );

    const tmp = path.join(
      os.tmpdir(),
      `aifetchly-t14-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
    );
    fs.mkdirSync(tmp, { recursive: true });

    // SqliteDb.getInstance takes a DIRECTORY (the db file is scraper.db
    // inside it), so pass the created tmp dir. ToolResultModel extends BaseDb
    // (abstract) — its async methods self-guard with ensureConnection, so
    // constructing the model + module and awaiting the first operation
    // initializes the schema.
    const model = new ToolResultModel(tmp);
    await model.ensureConnection();
    const module = new ToolResultModule(tmp);

    // Seed two projections under the live policy version.
    const epoch = `epoch-${crypto.randomBytes(4).toString("hex")}`;
    const proj1 = new AIToolResultProjectionEntity();
    proj1.profileId = "default";
    proj1.sourceRowKey = "msg-1";
    proj1.conversationId = "conv-x";
    proj1.outputEpoch = epoch;
    proj1.policyVersion = "tool-result-policy-v1";
    proj1.content = "[bounded for msg-1]";
    proj1.metadataJson = "{}";
    proj1.outputRefsJson = "[]";
    await model.saveProjection(proj1);

    const lookup = module.asLegacyProjectionLookup();
    const result = await lookup.lookup({
      profileId: "default",
      sourceRowKeys: ["msg-1", "msg-2"],
    });
    expect(result.size).toBe(1);
    expect(result.get("msg-1")?.content).toBe("[bounded for msg-1]");
    expect(result.get("msg-2")).toBeUndefined();

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
