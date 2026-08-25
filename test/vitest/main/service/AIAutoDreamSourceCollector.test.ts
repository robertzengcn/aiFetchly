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

  it("respects the shared merged bound after oldest-first sort (SMBW-008)", async () => {
    // 12 chat conversations, no agent tasks. The shared merged bound is 10
    // (MAX_CHAT + MAX_AGENT); the 10 OLDEST are taken, oldest-first.
    const convs = Array.from({ length: 12 }, (_, i) =>
      conv(
        `c${i + 1}`,
        `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`
      )
    );
    mockGetConversations.mockResolvedValue([...convs].reverse());
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({ reviewedSince: null });

    expect(result.chatConversationCount).toBe(10);
    expect(result.packets.map((p) => p.sourceId)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
      "c10",
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
    // 12 conversations, shared bound 10. After this batch the cursor is c10's
    // timestamp. A subsequent run with reviewedSince = that cursor must
    // surface c11 and c12, proving no source was skipped.
    const convs = Array.from({ length: 12 }, (_, i) =>
      conv(
        `c${i + 1}`,
        `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`
      )
    );
    mockGetConversations.mockResolvedValue([...convs]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    const first = await collector.collect({ reviewedSince: null });
    expect(first.chatConversationCount).toBe(10);
    expect(first.reviewedThrough.toISOString()).toBe(
      "2026-01-10T00:00:00.000Z"
    );

    // Second batch: reviewedSince = first batch's cursor. c1..c9 are filtered
    // out (>= 2026-01-10 keeps c10; c11 and c12 are the next oldest). Because
    // the cursor is the max INCLUDED updatedAt, c10 may reappear (>=, harmless
    // reprocessing) but c11 and c12 are never skipped.
    mockGetConversations.mockResolvedValue([...convs]);
    const second = await collector.collect({
      reviewedSince: first.reviewedThrough,
    });
    const secondIds = second.packets.map((p) => p.sourceId);
    // c11 and c12 must be present — no skipped gap.
    expect(secondIds).toContain("c11");
    expect(secondIds).toContain("c12");
  });

  it("merges chat + agent-task descriptors into one chronological queue (SMBW-008)", async () => {
    // Interleaved timestamps: agent task at 02, chat at 01/03, agent at 04.
    mockGetConversations.mockResolvedValue([
      conv("chat-03", "2026-01-03T00:00:00.000Z"),
      conv("chat-01", "2026-01-01T00:00:00.000Z"),
    ]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);
    const agentAt = (id: string, ts: string) =>
      ({
        agentTaskId: id,
        prompt: id,
        finishedAt: new Date(ts),
        updatedAt: new Date(ts),
      } as unknown as import("@/entity/AgentTask.entity").AgentTaskEntity);
    // collect() calls listFinishedAfter once with the merged bound; return
    // both agent tasks in that one call.
    mockListFinishedAfter.mockResolvedValue([
      agentAt("agent-02", "2026-01-02T00:00:00.000Z"),
      agentAt("agent-04", "2026-01-04T00:00:00.000Z"),
    ]);
    mockListMessages.mockResolvedValue([]);
    mockListToolCalls.mockResolvedValue([]);

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({ reviewedSince: null });

    // Merged chronological order across chat + agent sources.
    expect(result.packets.map((p) => p.sourceId)).toEqual([
      "chat-01",
      "agent-02",
      "chat-03",
      "agent-04",
    ]);
    // Per-kind counts still reported.
    expect(result.chatConversationCount).toBe(2);
    expect(result.agentTaskCount).toBe(2);
  });

  it("treats all sources at the boundary timestamp as eligible (>=) so ties are not skipped (SMBW-008)", async () => {
    // Two conversations AT the same boundary timestamp.
    mockGetConversations.mockResolvedValue([
      conv("c-tie-a", "2026-01-01T00:00:00.000Z"),
      conv("c-tie-b", "2026-01-01T00:00:00.000Z"),
    ]);
    mockGetConversationMessages.mockResolvedValue([
      msgRow("m", "user", "x", "2026-01-01T00:00:00.000Z"),
    ]);

    const collector = new AIAutoDreamSourceCollector();
    const result = await collector.collect({
      reviewedSince: new Date("2026-01-01T00:00:00.000Z"),
    });
    // Both eligible (>=) — neither dropped.
    expect(result.packets.map((p) => p.sourceId)).toContain("c-tie-a");
    expect(result.packets.map((p) => p.sourceId)).toContain("c-tie-b");
  });
});
