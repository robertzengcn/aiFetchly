import { describe, it, expect } from "vitest";
import {
  chunkGroupsByBudget,
  chunkSummariesByBudget,
  computeLightweightBudget,
  estimateActiveMemoryTokens,
  estimateAutoDreamPacketTokens,
  groupMessagesAtomically,
  maxPacketUpdatedAt,
  reduceAutoDreamPacket,
  CONSERVATIVE_SMALL_CONTEXT_FALLBACK,
} from "@/service/AIChatPromptBudget";
import type { OpenAIChatMessage } from "@/api/aiChatApi";

function msg(
  role: OpenAIChatMessage["role"],
  content: string,
  extra: Partial<OpenAIChatMessage> = {}
): OpenAIChatMessage {
  return { role, content, ...extra };
}

describe("computeLightweightBudget", () => {
  it("reserves 10% safety margin + output + fixed prompt from the context window", () => {
    const budget = computeLightweightBudget({
      contextWindow: 100_000,
      maxOutputTokens: 4000,
      fixedPromptTokens: 1000,
    });
    // softContextLimit = floor(100000 * 0.9) = 90000
    // usable = 90000 - 4000 - 1000 = 85000
    expect(budget.softContextLimit).toBe(90_000);
    expect(budget.usablePayloadTokens).toBe(85_000);
    expect(budget.effectiveOutputTokens).toBe(4000);
  });

  it("clamps output to the discovered model max when smaller", () => {
    const budget = computeLightweightBudget({
      contextWindow: 100_000,
      maxOutputTokens: 4000,
      discoveredMaxOutputTokens: 2048,
      fixedPromptTokens: 500,
    });
    expect(budget.effectiveOutputTokens).toBe(2048);
  });

  it("falls back to the conservative context when none provided", () => {
    const budget = computeLightweightBudget({
      contextWindow: 0,
      maxOutputTokens: 2000,
      fixedPromptTokens: 500,
    });
    expect(budget.contextWindow).toBe(CONSERVATIVE_SMALL_CONTEXT_FALLBACK);
  });

  it("returns 0 usable payload when fixed prompt + output do not fit", () => {
    const budget = computeLightweightBudget({
      contextWindow: 5000,
      maxOutputTokens: 4000,
      fixedPromptTokens: 1000,
    });
    // soft = floor(5000*0.9)=4500; usable = 4500-4000-1000 = -500 -> 0
    expect(budget.usablePayloadTokens).toBe(0);
  });
});

describe("groupMessagesAtomically", () => {
  it("groups an assistant tool-call with its matching tool results", () => {
    const messages: OpenAIChatMessage[] = [
      msg("user", "hi"),
      msg("assistant", "calling", {
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "f", arguments: "{}" },
          },
        ],
      }),
      msg("tool", "result1", { tool_call_id: "call_1" }),
      msg("assistant", "done"),
    ];
    const groups = groupMessagesAtomically(messages);
    expect(groups).toHaveLength(3);
    expect(groups[1]!.isToolGroup).toBe(true);
    expect(groups[1]!.messages).toHaveLength(2);
    expect(groups[0]!.isToolGroup).toBe(false);
    expect(groups[2]!.isToolGroup).toBe(false);
  });

  it("does not orphan a tool result whose id does not match the call", () => {
    const messages: OpenAIChatMessage[] = [
      msg("assistant", "calling", {
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "f", arguments: "{}" },
          },
        ],
      }),
      msg("tool", "unrelated", { tool_call_id: "call_2" }),
    ];
    const groups = groupMessagesAtomically(messages);
    // The tool result does not match call_1, so it is NOT grouped with the
    // assistant tool-call message (forms its own singleton).
    expect(groups).toHaveLength(2);
    expect(groups[0]!.isToolGroup).toBe(true);
    expect(groups[0]!.messages).toHaveLength(1);
  });

  it("groups multiple matching tool results with one assistant call", () => {
    const messages: OpenAIChatMessage[] = [
      msg("assistant", "calling", {
        tool_calls: [
          {
            id: "a",
            type: "function",
            function: { name: "f", arguments: "{}" },
          },
          {
            id: "b",
            type: "function",
            function: { name: "g", arguments: "{}" },
          },
        ],
      }),
      msg("tool", "ra", { tool_call_id: "a" }),
      msg("tool", "rb", { tool_call_id: "b" }),
    ];
    const groups = groupMessagesAtomically(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.messages).toHaveLength(3);
  });
});

describe("chunkGroupsByBudget", () => {
  it("splits groups greedily across budgeted chunks", () => {
    const msgs: OpenAIChatMessage[] = [
      msg("user", "one two three four"), // ~5 tokens
      msg("user", "five six seven eight"), // ~5 tokens
      msg("user", "nine ten eleven twelve"), // ~5 tokens
    ];
    const groups = groupMessagesAtomically(msgs);
    // Each group ~ 5 tokens (length/4 + overhead). Cap at 8 -> 2 chunks.
    const chunks = chunkGroupsByBudget(groups, 8);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Every group appears exactly once across chunks.
    const totalGroups = chunks.reduce((n, c) => n + c.groups.length, 0);
    expect(totalGroups).toBe(groups.length);
  });

  it("puts an oversized single group in its own chunk", () => {
    const big = msg("user", "x".repeat(2000));
    const small = msg("user", "y");
    const groups = groupMessagesAtomically([big, small]);
    const chunks = chunkGroupsByBudget(groups, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The oversized group is alone in its chunk.
    expect(chunks[0]!.groups).toHaveLength(1);
  });

  it("is deterministic — identical input yields identical boundaries", () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      msg("user", `message number ${i}`)
    );
    const groups = groupMessagesAtomically(msgs);
    const a = chunkGroupsByBudget(groups, 15);
    const b = chunkGroupsByBudget(groups, 15);
    expect(a.map((c) => c.groups.length)).toEqual(
      b.map((c) => c.groups.length)
    );
  });

  it("returns an empty array for no groups", () => {
    expect(chunkGroupsByBudget([], 100)).toEqual([]);
  });
});

describe("chunkSummariesByBudget", () => {
  it("packs summaries greedily into bounded batches", () => {
    const summaries = ["one two three", "four five six", "seven eight nine"];
    // Each summary ~4 tokens (length/4 + overhead). Cap at 9 -> first two
    // together (~8) fit, the third starts a new batch.
    const batches = chunkSummariesByBudget(summaries, 9);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    // Every summary appears exactly once across batches.
    const total = batches.reduce((n, b) => n + b.summaries.length, 0);
    expect(total).toBe(summaries.length);
  });

  it("puts an oversized summary alone in its own batch", () => {
    const big = "x".repeat(2000);
    const small = "y";
    const batches = chunkSummariesByBudget([big, small], 10);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches[0]!.summaries).toEqual([big]);
  });

  it("is deterministic — identical input yields identical boundaries", () => {
    const summaries = Array.from({ length: 10 }, (_, i) => `summary ${i}`);
    const a = chunkSummariesByBudget(summaries, 15);
    const b = chunkSummariesByBudget(summaries, 15);
    expect(a.map((c) => c.summaries.length)).toEqual(
      b.map((c) => c.summaries.length)
    );
  });

  it("returns an empty array for no summaries", () => {
    expect(chunkSummariesByBudget([], 100)).toEqual([]);
  });
});

describe("estimateAutoDreamPacketTokens + reduceAutoDreamPacket (SMBW-007)", () => {
  function packet(opts: { content?: string; msgs?: number; tools?: number }) {
    const messages = Array.from({ length: opts.msgs ?? 2 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: opts.content ?? `message ${i}`,
    }));
    const toolCalls = Array.from({ length: opts.tools ?? 0 }, (_, i) => ({
      toolCallId: `c${i}`,
      toolName: `tool${i}`,
      status: "success",
      resultSummary: `summary ${i}`,
    }));
    return {
      sourceKind: "chat_v2",
      sourceId: "v2-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      title: "t",
      messages,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }

  it("estimateAutoDreamPacketTokens grows with more messages and tools", () => {
    const small = estimateAutoDreamPacketTokens(packet({ msgs: 1 }));
    const large = estimateAutoDreamPacketTokens(packet({ msgs: 5, tools: 2 }));
    expect(large).toBeGreaterThan(small);
  });

  it("reduceAutoDreamPacket drops tool summaries first", () => {
    const p = packet({ msgs: 2, tools: 3 });
    const fullTokens = estimateAutoDreamPacketTokens(p);
    const reduced = reduceAutoDreamPacket(p, Math.floor(fullTokens * 0.8));
    expect(reduced.packet.toolCalls).toBeUndefined();
    expect(reduced.minimumUsefulFits).toBe(true);
  });

  it("reduceAutoDreamPacket drops oldest messages before clamping the newest", () => {
    const p = packet({ msgs: 5, tools: 0, content: "x".repeat(100) });
    // Budget that can fit the identity header + a clamped newest message but
    // not the full 5-message packet.
    const fullTokens = estimateAutoDreamPacketTokens(p);
    const reduced = reduceAutoDreamPacket(p, Math.floor(fullTokens * 0.4));
    expect(reduced.packet.messages.length).toBeLessThanOrEqual(1);
    expect(reduced.minimumUsefulFits).toBe(true);
  });

  it("reduceAutoDreamPacket never mutates the input", () => {
    const p = packet({ msgs: 3, tools: 1 });
    const before = JSON.parse(JSON.stringify(p));
    reduceAutoDreamPacket(p, 5);
    expect(p).toEqual(before);
  });

  it("a packet whose identity + newest message cannot fit reports minimumUsefulFits=false", () => {
    const p = {
      sourceKind: "chat_v2",
      sourceId: "v2-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      title: "x".repeat(10),
      messages: [{ id: "m0", role: "user", content: "y".repeat(10) }],
    };
    const reduced = reduceAutoDreamPacket(p, 1);
    expect(reduced.minimumUsefulFits).toBe(false);
  });

  it("estimateActiveMemoryTokens measures the index line", () => {
    const tokens = estimateActiveMemoryTokens({
      memoryId: "mem-1",
      type: "preference",
      title: "Concise",
      content: "User prefers concise answers.",
    });
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("maxPacketUpdatedAt", () => {
  it("returns new Date() for an empty array (defensive fallback)", () => {
    const before = Date.now();
    const result = maxPacketUpdatedAt([]);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("returns the greatest updatedAt from ISO string packets", () => {
    const result = maxPacketUpdatedAt([
      { updatedAt: "2026-01-03T00:00:00.000Z" },
      { updatedAt: "2026-01-01T00:00:00.000Z" },
      { updatedAt: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(result.toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });

  it("accepts Date objects too (forward-compat)", () => {
    const result = maxPacketUpdatedAt([
      { updatedAt: new Date("2026-01-01T00:00:00.000Z") },
      { updatedAt: new Date("2026-01-05T00:00:00.000Z") },
    ]);
    expect(result.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("ignores packets with null/undefined/invalid timestamps and falls back for all-null", () => {
    const result = maxPacketUpdatedAt([
      { updatedAt: null },
      { updatedAt: undefined },
      { updatedAt: "not-a-date" },
    ]);
    expect(result).toBeInstanceOf(Date);
    // Falls back to now — a real timestamp, not NaN.
    expect(Number.isNaN(result.getTime())).toBe(false);
  });

  it("picks the max among mixed valid and invalid timestamps", () => {
    const result = maxPacketUpdatedAt([
      { updatedAt: "not-a-date" },
      { updatedAt: "2026-06-01T00:00:00.000Z" },
      { updatedAt: undefined },
      { updatedAt: "2026-03-01T00:00:00.000Z" },
    ]);
    expect(result.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
