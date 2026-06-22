import { describe, expect, it } from "vitest";
import {
  buildAutoDreamSystemPrompt,
  buildAutoDreamUserPrompt,
  parseAutoDreamModelOutput,
} from "@/service/AIAutoDreamPromptBuilder";
import type {
  AIUserMemoryView,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";
import type { AutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";

const packets: AutoDreamSourcePacket[] = [
  {
    sourceKind: "chat_v2",
    sourceId: "v2-1",
    updatedAt: "2026-01-01T00:00:00Z",
    title: "Chat about email marketing",
    messages: [{ id: "m1", role: "user", content: "I run weekly campaigns" }],
  },
];

function view(opts: {
  memoryId: string;
  type: AIUserMemoryType;
  title: string;
  content: string;
}): AIUserMemoryView {
  return {
    id: 1,
    memoryId: opts.memoryId,
    type: opts.type,
    title: opts.title,
    content: opts.content,
    status: "active",
    confidence: 80,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("AIAutoDreamPromptBuilder", () => {
  it("builds a system prompt mentioning the taxonomy and secret rules", () => {
    const s = buildAutoDreamSystemPrompt();
    expect(s).toContain("preference");
    expect(s).toContain("decision");
    expect(s).toContain("JSON");
    expect(s).toContain("secrets");
  });

  it("builds a user prompt that lists existing memories and source packets", () => {
    const u = buildAutoDreamUserPrompt({
      activeMemories: [
        view({
          memoryId: "mem-x",
          type: "preference",
          title: "X",
          content: "cx",
        }),
      ],
      packets,
    });
    expect(u).toContain("mem-x");
    expect(u).toContain("v2-1");
    expect(u).toContain("weekly campaigns");
  });

  it("parses valid JSON output into structured operations", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "preference",
          title: "Weekly cadence",
          content: "User runs weekly campaigns.",
          confidence: 90,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
          sourceMessageIds: ["m1"],
          reason: "explicit",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, [
      view({
        memoryId: "mem-x",
        type: "preference",
        title: "X",
        content: "cx",
      }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(1);
    expect(r.create[0].sourceId).toBe("v2-1");
  });

  it("rejects invalid JSON", () => {
    const r = parseAutoDreamModelOutput("not json", packets, []);
    expect(r.ok).toBe(false);
  });

  it("drops entries with invalid memory type", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "garbage",
          title: "t",
          content: "c",
          confidence: 50,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(0);
  });

  it("drops secret-like content", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "fact",
          title: "api key",
          content: "sk-abc1234567890",
          confidence: 50,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(0);
  });

  it("drops create entries whose sourceId is not in packets", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "fact",
          title: "t",
          content: "c",
          confidence: 50,
          sourceKind: "chat_v2",
          sourceId: "unknown",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(0);
  });

  it("drops update/archive entries whose memoryId is not in existing memories", () => {
    const json = JSON.stringify({
      create: [],
      update: [{ memoryId: "ghost", content: "x", reason: "r" }],
      archive: [{ memoryId: "ghost2", reason: "r" }],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.update.length).toBe(0);
    expect(r.archive.length).toBe(0);
  });
});
