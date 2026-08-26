import { describe, it, expect, beforeEach, vi } from "vitest";
import { AIAutoDreamSourceCollector } from "@/service/AIAutoDreamSourceCollector";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

// Mock the three module dependencies the collector uses.
const mockGetConversations = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockListFinishedAfter = vi.fn();
const mockListMessages = vi.fn();
const mockListToolCalls = vi.fn();
const mockResolveWithKey = vi.fn();

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversations: mockGetConversations,
    getConversationMessages: mockGetConversationMessages,
  })),
}));

vi.mock("@/modules/AgentTaskModule", () => ({
  AgentTaskModule: vi.fn().mockImplementation(() => ({
    listFinishedAfter: mockListFinishedAfter,
    listMessages: mockListMessages,
    listToolCalls: mockListToolCalls,
  })),
}));

vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: vi.fn().mockImplementation(() => ({
    resolveWithKey: mockResolveWithKey,
  })),
}));

function conv(
  id: string,
  lastMessageTimestamp: string,
  title = id
): { conversationId: string; lastMessageTimestamp: string; title: string } {
  return { conversationId: id, lastMessageTimestamp, title };
}

function msgRow(
  messageId: string,
  role: string,
  content: string,
  ts: string,
  type: MessageType = MessageType.MESSAGE
): AIChatMessageEntity {
  return {
    id: 1,
    messageId,
    conversationId: "c",
    role,
    content,
    timestamp: new Date(ts),
    messageType: type,
  } as AIChatMessageEntity;
}

describe("AIAutoDreamSourceCollector — batch-safe cursors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveWithKey.mockResolvedValue(null);
    // No agent tasks by default; collector iterates the result.
    mockListFinishedAfter.mockResolvedValue([]);
  });

  it("selects conversations oldest-first after filtering by reviewedSince", async () => {
    // Three conversations with descending timestamps; the collector must sort
    // oldest-first so the bounded batch covers the oldest eligible sources.
    mockGetConversations.mockResolvedValue([
      conv("c3", "2026-01-03T00:00:00.000Z", "newest"),
      conv("c1", "2026-01-01T00:00:00.000Z", "oldest"),
      conv("c2", "2026-01-02T00:00:00.000Z", "middle"),
    ]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "hello", "2026-01-01T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({ reviewedSince: null });

    // Oldest-first ordering.
    expect(result.packets.map((p) => p.sourceId)).toEqual(["c1", "c2", "c3"]);
  });

  it("respects the MAX_CHAT_CONVERSATIONS bound after oldest-first sort", async () => {
    const convs = Array.from({ length: 7 }, (_, i) =>
      conv(`c${i + 1}`, `2026-01-0${i + 1}T00:00:00.000Z`)
    );
    // Reverse them so the sort actually has to reorder.
    mockGetConversations.mockResolvedValue([...convs].reverse());
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({ reviewedSince: null });

    // Bound is 5; the 5 OLDEST are taken (c1..c5), not the 5 newest.
    expect(result.chatConversationCount).toBe(5);
    expect(result.packets.map((p) => p.sourceId)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
  });

  it("derives reviewedThrough from the greatest included updatedAt, not the wall clock", async () => {
    const before = Date.now();
    mockGetConversations.mockResolvedValue([
      conv("c1", "2026-01-01T00:00:00.000Z"),
      conv("c2", "2026-01-02T00:00:00.000Z"),
    ]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({ reviewedSince: null });

    // The cursor is the max included updatedAt (c2's), NOT ~now.
    expect(result.reviewedThrough.toISOString()).toBe(
      "2026-01-02T00:00:00.000Z"
    );
    expect(result.reviewedThrough.getTime()).toBeLessThanOrEqual(
      new Date("2026-01-02T00:00:00.000Z").getTime()
    );
    // Sanity: the cursor is far before the wall-clock collection time.
    expect(result.reviewedThrough.getTime()).toBeLessThan(before + 1000);
  });

  it("filters out conversations older than reviewedSince before bounding", async () => {
    mockGetConversations.mockResolvedValue([
      conv("c1", "2026-01-01T00:00:00.000Z"),
      conv("c2", "2026-01-03T00:00:00.000Z"),
      conv("c3", "2026-01-05T00:00:00.000Z"),
    ]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-03T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    // reviewedSince = 2026-01-02 -> c1 is filtered out, c2 and c3 remain.
    const result = await collector.collect({
      reviewedSince: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(result.packets.map((p) => p.sourceId)).toEqual(["c2", "c3"]);
    expect(result.reviewedThrough.toISOString()).toBe(
      "2026-01-05T00:00:00.000Z"
    );
  });

  it("does not skip an eligible source when there are more candidates than one batch can hold", async () => {
    // 7 conversations, bound 5. After this batch the cursor is c5's timestamp.
    // A subsequent run with reviewedSince = that cursor must start at c6 (the
    // next oldest), proving no source was skipped.
    const convs = Array.from({ length: 7 }, (_, i) =>
      conv(`c${i + 1}`, `2026-01-0${i + 1}T00:00:00.000Z`)
    );
    mockGetConversations.mockResolvedValue([...convs]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    const first = await collector.collect({ reviewedSince: null });
    expect(first.chatConversationCount).toBe(5);
    expect(first.reviewedThrough.toISOString()).toBe(
      "2026-01-05T00:00:00.000Z"
    );

    // Second batch: reviewedSince = first batch's cursor. c1..c5 are filtered
    // out (>= 2026-01-05 keeps c5; but c6 and c7 are the next oldest). Because
    // the cursor is the max INCLUDED updatedAt, c5 may reappear (>=, harmless
    // reprocessing) but c6 and c7 are never skipped.
    mockGetConversations.mockResolvedValue([...convs]);
    const second = await collector.collect({
      reviewedSince: first.reviewedThrough,
    });
    const secondIds = second.packets.map((p) => p.sourceId);
    // c6 and c7 must be present — no skipped gap.
    expect(secondIds).toContain("c6");
    expect(secondIds).toContain("c7");
  });

  it("always includes the focused conversation even when it is the newest of many", async () => {
    const convs = Array.from({ length: 7 }, (_, i) =>
      conv(`c${i + 1}`, `2026-01-0${i + 1}T00:00:00.000Z`)
    );
    mockGetConversations.mockResolvedValue([...convs]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);
    mockResolveWithKey.mockImplementation(async (id: string) => ({
      workspaceId: 1,
      conversationId: id,
      rootPath: "/p",
      canonicalRootPath: "/p",
      workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      displayName: "p",
    }));

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({
      reviewedSince: null,
      focusConversationId: "c7",
    });

    expect(result.packets.map((p) => p.sourceId)).toContain("c7");
    expect(result.packets.length).toBeLessThanOrEqual(5);
  });

  it("restricts a focused collect to the focused conversation's workspace", async () => {
    mockGetConversations.mockResolvedValue([
      conv("c1", "2026-01-01T00:00:00.000Z"),
      conv("c2", "2026-01-02T00:00:00.000Z"),
      conv("c3", "2026-01-03T00:00:00.000Z"),
    ]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);
    mockResolveWithKey.mockImplementation(async (id: string) => {
      const key =
        id === "c3"
          ? "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          : "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      return {
        workspaceId: id === "c3" ? 2 : 1,
        conversationId: id,
        rootPath: "/p",
        canonicalRootPath: "/p",
        workspaceKey: key,
        displayName: "p",
      };
    });

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({
      reviewedSince: null,
      focusConversationId: "c3",
    });

    expect(result.packets.map((p) => p.sourceId)).toEqual(["c3"]);
    expect(result.packets[0]?.workspace?.workspaceKey).toBe(
      "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
  });
});
