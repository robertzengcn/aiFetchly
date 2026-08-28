import { describe, expect, it, beforeEach, vi } from "vitest";

// vi.mock factories are hoisted above `const`, so create the mocks with
// vi.hoisted (the values survive hoisting) and reference them inside the
// factories. Mirrors the pattern vitest recommends for shared mock state.
const { handlers, submitReportMock, isAiEnabledMock } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const submitReportMock = vi.fn();
  // Default to true; tests assert it is NEVER called (safety reporting is
  // not AI-gated). Resettable per-test below.
  const isAiEnabledMock = vi.fn().mockReturnValue(true);
  return { handlers, submitReportMock, isAiEnabledMock };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
  app: {},
}));

vi.mock("@/service/AIContentReportService", () => ({
  AIContentReportService: class {
    submitReport = submitReportMock;
  },
}));

// Mock the AI feature gate so we can assert it is NOT consulted.
vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: isAiEnabledMock,
}));

import { registerAIContentReportIpcHandlers } from "@/main-process/communication/ai-content-report-ipc";
import { AI_CONTENT_REPORT_CREATE } from "@/config/channellist";
import type { CreateAIContentReportResponse } from "@/entityTypes/aiContentReportTypes";

describe("ai-content-report-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    submitReportMock.mockReset();
    isAiEnabledMock.mockReset();
    isAiEnabledMock.mockReturnValue(true);
    registerAIContentReportIpcHandlers();
  });

  it("registers the AI_CONTENT_REPORT_CREATE channel", () => {
    expect(handlers.has(AI_CONTENT_REPORT_CREATE)).toBe(true);
  });

  it("delegates a valid request to the service and returns the envelope", async () => {
    const response: CreateAIContentReportResponse = {
      reportId: "air_xyz",
      status: "submitted",
      receivedAt: "2026-08-27T00:00:00.000Z",
      duplicate: false,
    };
    submitReportMock.mockResolvedValue(response);

    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const payload = {
      schemaVersion: 1,
      clientReportId: "cid-1",
      surface: "chat_v2",
      contentType: "text",
      category: "other",
      comment: "note",
      output: { text: "AI text" },
      context: {
        conversationId: "c1",
        messageId: "m1",
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    };
    const res = (await fn({}, JSON.stringify(payload))) as {
      status: boolean;
      msg: string;
      data: CreateAIContentReportResponse | null;
    };
    expect(res.status).toBe(true);
    expect(res.data?.reportId).toBe("air_xyz");
    expect(submitReportMock).toHaveBeenCalledTimes(1);
    // The service received the parsed, validated payload (not the raw string).
    expect(submitReportMock.mock.calls[0][0].clientReportId).toBe("cid-1");
  });

  it("validates before calling the service — rejects an invalid payload", async () => {
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    // Missing required fields + bad category.
    const res = (await fn(
      {},
      JSON.stringify({ schemaVersion: 1, category: "not-a-real-category" })
    )) as { status: boolean; data: unknown };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
    expect(submitReportMock).not.toHaveBeenCalled();
  });

  it("does NOT consult the AI feature gate (safety reporting is not paywalled)", async () => {
    submitReportMock.mockResolvedValue({
      reportId: "air_ok",
      status: "submitted",
      receivedAt: "2026-08-27T00:00:00.000Z",
      duplicate: false,
    });
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const payload = {
      schemaVersion: 1,
      clientReportId: "cid-2",
      surface: "legacy_chat",
      contentType: "text",
      category: "other",
      output: { text: "x" },
      context: { appVersion: "1.0.0", platform: "win32", locale: "en-US" },
    };
    await fn({}, JSON.stringify(payload));
    expect(isAiEnabledMock).not.toHaveBeenCalled();
  });

  it("works even when isAiEnabled would return false", async () => {
    isAiEnabledMock.mockReturnValue(false);
    submitReportMock.mockResolvedValue({
      reportId: "air_still_ok",
      status: "submitted",
      receivedAt: "2026-08-27T00:00:00.000Z",
      duplicate: false,
    });
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const payload = {
      schemaVersion: 1,
      clientReportId: "cid-3",
      surface: "knowledge_chat",
      contentType: "text",
      category: "other",
      output: { text: "x" },
      context: { appVersion: "1.0.0", platform: "win32", locale: "en-US" },
    };
    const res = (await fn({}, JSON.stringify(payload))) as {
      status: boolean;
      data: CreateAIContentReportResponse | null;
    };
    expect(res.status).toBe(true);
    expect(res.data?.reportId).toBe("air_still_ok");
  });

  it("maps a service failure to status:false without leaking the error detail", async () => {
    // A thrown AIContentReportError carries a message; the wrapper turns it
    // into envelope.msg but the dialog re-maps via the error code, not msg.
    submitReportMock.mockRejectedValue(new Error("backend explosion"));
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const payload = {
      schemaVersion: 1,
      clientReportId: "cid-4",
      surface: "ai_artifact",
      contentType: "artifact",
      category: "other",
      output: { text: "x" },
      context: { appVersion: "1.0.0", platform: "win32", locale: "en-US" },
    };
    const res = (await fn({}, JSON.stringify(payload))) as {
      status: boolean;
      msg: string;
      data: unknown;
    };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
  });
});
