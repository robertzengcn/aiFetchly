import { describe, expect, it, beforeEach, vi } from "vitest";

// Auto-dream portable-safety harness (design D-09 / §19.5): the service must
// resolve the internal memory scope for its groups and SKIP archive/update
// for records that have portable state — their files are authoritative.
const completeLightweight = vi.fn();
const startRun = vi.fn();
const completeRun = vi.fn();
const failRun = vi.fn();
const getByRunId = vi.fn();
const getLatest = vi.fn();
const getRunning = vi.fn();
const recoverStale = vi.fn();
const collect = vi.fn();
const createMemory = vi.fn();
const updateMemory = vi.fn();
const archiveMemory = vi.fn();
const listActive = vi.fn();
const getPortableState = vi.fn();
const resolveLegacyScope = vi.fn();

vi.mock("@/modules/AIWorkspaceMemoryModule", () => ({
  AIWorkspaceMemoryModule: vi.fn().mockImplementation(() => ({
    createMemory,
    updateMemory,
    archiveMemory,
    listActiveForRetrieval: listActive,
  })),
}));

vi.mock("@/modules/AIWorkspaceMemoryConsolidationRunModule", () => ({
  AIWorkspaceMemoryConsolidationRunModule: vi.fn().mockImplementation(() => ({
    startRun,
    completeRun,
    failRun,
    getByRunId,
    getLatestSuccessfulRun: getLatest,
    getRunningRun: getRunning,
    recoverStaleRunningRuns: recoverStale,
  })),
}));

vi.mock("@/modules/WorkspaceMemoryScopeModule", () => ({
  WorkspaceMemoryScopeModule: vi.fn().mockImplementation(() => ({
    resolveLegacyScope,
  })),
}));

vi.mock("@/modules/PortableWorkspaceMemoryModule", () => ({
  PortableWorkspaceMemoryModule: vi.fn().mockImplementation(() => ({
    getPortableState,
  })),
}));

vi.mock("@/service/AIAutoDreamSourceCollector", () => ({
  AIAutoDreamSourceCollector: vi.fn().mockImplementation(() => ({ collect })),
  groupByWorkspace: (
    packets: ReadonlyArray<{ workspace?: { workspaceKey: string } }>
  ) => {
    const m = new Map<string, unknown[]>();
    for (const p of packets) {
      const k = p.workspace?.workspaceKey;
      if (!k) continue;
      const arr = (m.get(k) as unknown[]) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

import { AIWorkspaceAutoDreamService } from "@/service/AIWorkspaceAutoDreamService";

const WS = "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SCOPE_ID = `wscope-legacy-${"a".repeat(32)}`;
const now = () => new Date();
const iso = (d: Date) => d.toISOString();

function pkt(id: string) {
  return {
    sourceKind: "chat_v2" as const,
    sourceId: id,
    updatedAt: iso(now()),
    title: "t",
    messages: [
      { id: "m0", role: "user" as const, content: "remember the deploy command" },
      { id: "m1", role: "assistant" as const, content: "yarn deploy" },
    ],
    workspace: {
      workspaceId: 1,
      workspaceKey: WS,
      workspaceRoot: "/p/a",
      displayName: "a",
    },
  };
}

const runView = {
  runId: "wrun-1",
  status: "running",
  startedAt: iso(now()),
  chatConversationsReviewed: 0,
  agentTasksReviewed: 0,
  memoriesCreated: 0,
  memoriesUpdated: 0,
  memoriesArchived: 0,
  createdAt: iso(now()),
  updatedAt: iso(now()),
};

function modelOutput(actions: {
  archive?: { memoryId: string }[];
  update?: { memoryId: string }[];
  create?: unknown[];
}): string {
  return JSON.stringify({
    archive: actions.archive ?? [],
    update: actions.update ?? [],
    create: actions.create ?? [],
  });
}

function activeMemory(memoryId: string) {
  return {
    id: 1,
    memoryId,
    workspaceKey: WS,
    workspaceRoot: "/p/a",
    type: "decision",
    title: "t",
    content: "c",
    status: "active",
    confidence: 90,
    createdAt: iso(now()),
    updatedAt: iso(now()),
  };
}

const svc = () =>
  new AIWorkspaceAutoDreamService({
    completeLightweight,
    isAIEnabled: () => true,
    isAutoDreamEnabled: async () => true,
  });

describe("AIWorkspaceAutoDreamService — portable safety (D-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collect.mockResolvedValue({ packets: [pkt("c1")] });
    getLatest.mockResolvedValue(null);
    getRunning.mockResolvedValue(null);
    recoverStale.mockResolvedValue(undefined);
    startRun.mockResolvedValue(runView);
    completeRun.mockResolvedValue(undefined);
    getByRunId.mockResolvedValue(runView);
    listActive.mockResolvedValue([]);
    resolveLegacyScope.mockResolvedValue({
      scopeId: SCOPE_ID,
      workspaceKey: WS,
      workspaceRoot: "/p/a",
      displayName: "a",
      portableEnabled: true,
      importPolicy: "review-new",
    });
    getPortableState.mockResolvedValue(null);
  });

  it("skips archive and update for records with portable state", async () => {
    completeLightweight.mockResolvedValue({
      model: "test-model",
      choices: [
        {
          message: {
            content: modelOutput({
              archive: [{ memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1" }],
              update: [
                { memoryId: "wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0" },
              ],
            }),
          },
        },
      ],
    });
    listActive.mockResolvedValue([
      activeMemory("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1"),
      activeMemory("wmem-018f2f94-83c7-7a2e-9fc1-849880ba10c0"),
    ]);
    getPortableState.mockResolvedValue({
      relativePath: ".aifetchly/memory/wmem-x.md",
      syncState: "synced",
      lastValidHash: "a".repeat(64),
      visibility: "local",
    });

    await svc().runNow({ force: true, reason: "test" });

    expect(archiveMemory).not.toHaveBeenCalled();
    expect(updateMemory).not.toHaveBeenCalled();
    expect(failRun).not.toHaveBeenCalled();
  });

  it("resolves the internal scope id before applying writes", async () => {
    completeLightweight.mockResolvedValue({
      model: "test-model",
      choices: [
        { message: { content: modelOutput({ create: [] }) } },
      ],
    });
    await svc().runNow({ force: true, reason: "test" });
    expect(resolveLegacyScope).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceKey: WS, workspaceRoot: "/p/a" })
    );
  });

  it("still archives private records when no portable state exists", async () => {
    listActive.mockResolvedValue([
      activeMemory("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1"),
    ]);
    completeLightweight.mockResolvedValue({
      model: "test-model",
      choices: [
        {
          message: {
            content: modelOutput({
              archive: [{ memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1" }],
            }),
          },
        },
      ],
    });
    await svc().runNow({ force: true, reason: "test" });
    expect(archiveMemory).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: SCOPE_ID }),
      "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1"
    );
  });

  it("falls back to the legacy key path when scope resolution fails", async () => {
    resolveLegacyScope.mockRejectedValue(new Error("db down"));
    listActive.mockResolvedValue([
      activeMemory("wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1"),
    ]);
    completeLightweight.mockResolvedValue({
      model: "test-model",
      choices: [
        {
          message: {
            content: modelOutput({
              archive: [{ memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1" }],
            }),
          },
        },
      ],
    });
    await svc().runNow({ force: true, reason: "test" });
    expect(archiveMemory).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceKey: WS }),
      "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1"
    );
  });
});
