import { describe, it, expect, beforeEach, vi } from "vitest";

// Capture ipcMain.handle registrations so we can drive handlers directly.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      fn: (...args: unknown[]) => Promise<unknown>
    ) => {
      handlers.set(channel, fn);
    },
  },
}));

// Mock AIArtifactModule so no real DB is touched.
const getArtifactMock = vi.fn();
const listArtifactsMock = vi.fn();
vi.mock("@/modules/AIArtifactModule", () => ({
  AIArtifactModule: class {
    getArtifact = getArtifactMock;
    listArtifacts = listArtifactsMock;
  },
}));

import { registerAIArtifactIpcHandlers } from "@/main-process/communication/ai-artifact-ipc";
import { AI_ARTIFACT_GET, AI_ARTIFACT_LIST } from "@/config/channellist";

describe("ai-artifact-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    getArtifactMock.mockReset();
    listArtifactsMock.mockReset();
    registerAIArtifactIpcHandlers();
  });

  it("registers both read channels", () => {
    expect(handlers.has(AI_ARTIFACT_GET)).toBe(true);
    expect(handlers.has(AI_ARTIFACT_LIST)).toBe(true);
  });

  it("get returns the full artifact content", async () => {
    getArtifactMock.mockResolvedValue({
      id: "artifact-1",
      conversationId: "v2-c",
      type: "html",
      title: "Report",
      mimeType: "text/html",
      content: "<p>full</p>",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const fn = handlers.get(AI_ARTIFACT_GET)!;
    const res = (await fn({}, JSON.stringify({ artifactId: "artifact-1" }))) as {
      status: boolean;
      data?: { content?: string };
    };
    expect(res.status).toBe(true);
    expect(res.data?.content).toBe("<p>full</p>");
  });

  it("get returns null data when the artifact is missing", async () => {
    getArtifactMock.mockResolvedValue(null);
    const fn = handlers.get(AI_ARTIFACT_GET)!;
    const res = (await fn({}, { artifactId: "artifact-missing" })) as {
      status: boolean;
      data: unknown;
    };
    expect(res.status).toBe(true);
    expect(res.data).toBe(null);
  });

  it("get rejects an invalid payload with status false", async () => {
    const fn = handlers.get(AI_ARTIFACT_GET)!;
    const res = (await fn({}, JSON.stringify({ artifactId: "" }))) as {
      status: boolean;
      msg: string;
    };
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/artifactId/i);
    expect(getArtifactMock).not.toHaveBeenCalled();
  });

  it("list returns summaries", async () => {
    listArtifactsMock.mockResolvedValue([
      { id: "a1", type: "html", title: "One", version: 1 },
    ]);
    const fn = handlers.get(AI_ARTIFACT_LIST)!;
    const res = (await fn({}, { conversationId: "v2-c" })) as {
      status: boolean;
      data?: Array<{ id: string }>;
    };
    expect(res.status).toBe(true);
    expect(res.data?.[0].id).toBe("a1");
  });

  it("list rejects a missing conversationId", async () => {
    const fn = handlers.get(AI_ARTIFACT_LIST)!;
    const res = (await fn({}, JSON.stringify({}))) as {
      status: boolean;
      msg: string;
    };
    expect(res.status).toBe(false);
    expect(res.msg).toMatch(/conversationId/i);
  });
});
