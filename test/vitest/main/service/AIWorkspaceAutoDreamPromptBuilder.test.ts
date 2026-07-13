import { describe, expect, it } from "vitest";
import {
  buildWorkspaceAutoDreamSystemPrompt,
  buildWorkspaceAutoDreamUserPrompt,
  parseWorkspaceAutoDreamModelOutput,
} from "@/service/AIWorkspaceAutoDreamPromptBuilder";
import type {
  AIWorkspaceMemoryView,
  AIWorkspaceMemoryType,
} from "@/entityTypes/aiWorkspaceMemoryTypes";
import type { WorkspaceAwareAutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";

const WS_KEY = "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WS_ROOT = "/projects/alpha";

const packets: WorkspaceAwareAutoDreamSourcePacket[] = [
  {
    sourceKind: "chat_v2",
    sourceId: "v2-1",
    updatedAt: "2026-01-01T00:00:00Z",
    title: "Chat about tests",
    messages: [
      { id: "m1", role: "user", content: "Run main process tests with yarn testmain" },
    ],
    workspace: {
      workspaceId: 1,
      workspaceKey: WS_KEY,
      workspaceRoot: WS_ROOT,
      displayName: "alpha",
    },
  },
];

function view(opts: {
  memoryId: string;
  type: AIWorkspaceMemoryType;
  title: string;
  content: string;
}): AIWorkspaceMemoryView {
  return {
    id: 1,
    memoryId: opts.memoryId,
    workspaceKey: WS_KEY,
    workspaceRoot: WS_ROOT,
    type: opts.type,
    title: opts.title,
    content: opts.content,
    status: "active",
    confidence: 80,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("AIWorkspaceAutoDreamPromptBuilder", () => {
  it("system prompt mentions the workspace taxonomy, workspaceKey rule, and secret rules", () => {
    const s = buildWorkspaceAutoDreamSystemPrompt();
    expect(s).toContain("decision");
    expect(s).toContain("warning");
    expect(s).toContain("workspaceKey");
    expect(s).toContain("secrets");
  });

  it("user prompt embeds the workspace key and root", () => {
    const u = buildWorkspaceAutoDreamUserPrompt({
      workspaceKey: WS_KEY,
      workspaceRoot: WS_ROOT,
      activeMemories: [],
      packets,
    });
    expect(u).toContain(WS_KEY);
    expect(u).toContain(WS_ROOT);
    expect(u).toContain("yarn testmain");
  });

  it("accepts a valid create with the matching workspaceKey", () => {
    const raw = JSON.stringify({
      create: [
        {
          workspaceKey: WS_KEY,
          type: "workflow",
          title: "Main process tests",
          content: "Run main process tests with yarn testmain.",
          confidence: 90,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
          reason: "explicit user instruction",
        },
      ],
      update: [],
      archive: [],
    });
    const parsed = parseWorkspaceAutoDreamModelOutput(
      raw,
      new Set([WS_KEY]),
      []
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.create.length).toBe(1);
    expect(parsed.create[0].workspaceKey).toBe(WS_KEY);
    expect(parsed.create[0].type).toBe("workflow");
  });

  it("rejects a create whose workspaceKey is not in the valid set", () => {
    const raw = JSON.stringify({
      create: [
        {
          workspaceKey: "ws_FORGED_OTHER_WORKSPACE",
          type: "decision",
          title: "t",
          content: "c",
          confidence: 80,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
        },
      ],
    });
    const parsed = parseWorkspaceAutoDreamModelOutput(
      raw,
      new Set([WS_KEY]),
      []
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.create.length).toBe(0);
  });

  it("rejects an invalid taxonomy type", () => {
    const raw = JSON.stringify({
      create: [
        {
          workspaceKey: WS_KEY,
          type: "garbage",
          title: "t",
          content: "c",
          confidence: 80,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
        },
      ],
    });
    const parsed = parseWorkspaceAutoDreamModelOutput(
      raw,
      new Set([WS_KEY]),
      []
    );
    expect(parsed.create.length).toBe(0);
  });

  it("rejects secret-like content", () => {
    const raw = JSON.stringify({
      create: [
        {
          workspaceKey: WS_KEY,
          type: "convention",
          title: "deploy key",
          content: "api_key=sk-1234567890abcdef1234567890abcdef",
          confidence: 80,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
        },
      ],
    });
    const parsed = parseWorkspaceAutoDreamModelOutput(
      raw,
      new Set([WS_KEY]),
      []
    );
    expect(parsed.create.length).toBe(0);
  });

  it("drops update/archive entries whose memoryId is not in the active set", () => {
    const raw = JSON.stringify({
      update: [{ memoryId: "wmem-unknown", content: "x" }],
      archive: [{ memoryId: "wmem-unknown" }],
    });
    const parsed = parseWorkspaceAutoDreamModelOutput(
      raw,
      new Set([WS_KEY]),
      [view({ memoryId: "wmem-real", type: "decision", title: "t", content: "c" })]
    );
    expect(parsed.update.length).toBe(0);
    expect(parsed.archive.length).toBe(0);
  });

  it("accepts update/archive for an existing active memory", () => {
    const raw = JSON.stringify({
      update: [{ memoryId: "wmem-real", content: "updated content" }],
      archive: [],
    });
    const parsed = parseWorkspaceAutoDreamModelOutput(
      raw,
      new Set([WS_KEY]),
      [view({ memoryId: "wmem-real", type: "decision", title: "t", content: "c" })]
    );
    expect(parsed.update.length).toBe(1);
    expect(parsed.update[0].content).toBe("updated content");
  });

  it("returns ok:false on malformed JSON", () => {
    const parsed = parseWorkspaceAutoDreamModelOutput(
      "not json {",
      new Set([WS_KEY]),
      []
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeTruthy();
  });

  it("returns ok:false on empty input", () => {
    const parsed = parseWorkspaceAutoDreamModelOutput(
      "   ",
      new Set([WS_KEY]),
      []
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("empty");
  });
});
