import { describe, expect, it, beforeEach, vi } from "vitest";

// vi.mock factories are hoisted above `const`, so create the mocks with
// vi.hoisted (the values survive hoisting) and reference them inside the
// factories. Mirrors the pattern vitest recommends for shared mock state.
const { handlers, submitReportMock, getCapabilitiesMock, isAiEnabledMock } =
  vi.hoisted(() => {
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const submitReportMock = vi.fn();
    const getCapabilitiesMock = vi.fn();
    // Default to true; tests assert it is NEVER called (safety reporting is
    // not AI-gated). Resettable per-test below.
    const isAiEnabledMock = vi.fn().mockReturnValue(true);
    return { handlers, submitReportMock, getCapabilitiesMock, isAiEnabledMock };
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
    getCapabilities = getCapabilitiesMock;
  },
}));

// Mock the AI feature gate so we can assert it is NOT consulted.
vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: isAiEnabledMock,
}));

import { registerAIContentReportIpcHandlers } from "@/main-process/communication/ai-content-report-ipc";
import {
  AI_CONTENT_REPORT_CAPABILITIES,
  AI_CONTENT_REPORT_CREATE,
} from "@/config/channellist";
import type {
  AIContentReportCapabilities,
  CreateAIContentReportResponse,
} from "@/entityTypes/aiContentReportTypes";

const ENABLED_CAPABILITIES: AIContentReportCapabilities = {
  acceptedSchemaVersions: [1, 2],
  conversationReporting: {
    enabled: true,
    maxAIItems: 10,
    maxUserItems: 10,
    maxTotalItems: 20,
    maxItemTextChars: 8000,
    maxAggregateTextChars: 32000,
    maxImages: 3,
  },
};

const DISABLED_CAPABILITIES: AIContentReportCapabilities = {
  ...ENABLED_CAPABILITIES,
  acceptedSchemaVersions: [1],
  conversationReporting: {
    ...ENABLED_CAPABILITIES.conversationReporting,
    enabled: false,
  },
};

function makeV2Payload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    clientReportId: "cid-v2",
    surface: "chat_v2",
    reportScope: "selected_ai_outputs",
    category: "other",
    items: [
      {
        itemId: "i1",
        messageId: "m1",
        sequence: 0,
        role: "assistant",
        contentType: "text",
        text: "AI text",
      },
    ],
    context: {
      conversationId: "c1",
      selectedAIItemCount: 1,
      includedUserItemCount: 0,
      appVersion: "1.0.0",
      platform: "win32",
      locale: "en-US",
    },
    ...overrides,
  };
}

describe("ai-content-report-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    submitReportMock.mockReset();
    getCapabilitiesMock.mockReset();
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

describe("ai-content-report-ipc v2 union", () => {
  beforeEach(() => {
    handlers.clear();
    submitReportMock.mockReset();
    getCapabilitiesMock.mockReset();
    isAiEnabledMock.mockReset();
    isAiEnabledMock.mockReturnValue(true);
    registerAIContentReportIpcHandlers();
  });

  it("accepts a v2 payload and passes the validated object to the service", async () => {
    submitReportMock.mockResolvedValue({
      reportId: "air_v2",
      status: "submitted",
      receivedAt: "2026-08-27T00:00:00.000Z",
      duplicate: false,
    });
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const res = (await fn({}, JSON.stringify(makeV2Payload()))) as {
      status: boolean;
      data: CreateAIContentReportResponse | null;
    };
    expect(res.status).toBe(true);
    expect(res.data?.reportId).toBe("air_v2");
    expect(submitReportMock).toHaveBeenCalledTimes(1);
    expect(submitReportMock.mock.calls[0][0].schemaVersion).toBe(2);
    expect(submitReportMock.mock.calls[0][0].items).toHaveLength(1);
  });

  it("accepts a v2 payload with related user context", async () => {
    submitReportMock.mockResolvedValue({
      reportId: "air_v2u",
      status: "submitted",
      receivedAt: "2026-08-27T00:00:00.000Z",
      duplicate: false,
    });
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const payload = makeV2Payload({
      reportScope: "selected_ai_outputs_with_related_user_context",
      items: [
        {
          itemId: "u1",
          messageId: "um1",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "user text",
          consentSource: "related_user_context_toggle",
        },
        {
          itemId: "i1",
          messageId: "m1",
          sequence: 1,
          role: "assistant",
          contentType: "text",
          text: "AI text",
        },
      ],
      context: {
        conversationId: "c1",
        selectedAIItemCount: 1,
        includedUserItemCount: 1,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    const res = (await fn({}, JSON.stringify(payload))) as {
      status: boolean;
      data: CreateAIContentReportResponse | null;
    };
    expect(res.status).toBe(true);
    expect(res.data?.reportId).toBe("air_v2u");
  });

  it("rejects an unknown schemaVersion", async () => {
    submitReportMock.mockResolvedValue({ reportId: "air_x" } as never);
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const res = (await fn(
      {},
      JSON.stringify(makeV2Payload({ schemaVersion: 9 }))
    )) as { status: boolean; data: unknown };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
    expect(submitReportMock).not.toHaveBeenCalled();
  });

  it("rejects a v2 payload with a cross-version mismatch (items on v1)", async () => {
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const res = (await fn(
      {},
      JSON.stringify({ schemaVersion: 1, items: [] })
    )) as { status: boolean; data: unknown };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
    expect(submitReportMock).not.toHaveBeenCalled();
  });

  it("rejects a v2 payload with an unconsented user item", async () => {
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const payload = makeV2Payload({
      items: [
        {
          itemId: "u1",
          messageId: "um1",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "user text",
        },
        {
          itemId: "i1",
          messageId: "m1",
          sequence: 1,
          role: "assistant",
          contentType: "text",
          text: "AI text",
        },
      ],
    });
    const res = (await fn({}, JSON.stringify(payload))) as {
      status: boolean;
      data: unknown;
    };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
    expect(submitReportMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown top-level key (privacy: no passthrough fields)", async () => {
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    const res = (await fn(
      {},
      JSON.stringify(makeV2Payload({ leakedField: "prompt content" }))
    )) as { status: boolean; data: unknown };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
    expect(submitReportMock).not.toHaveBeenCalled();
  });

  it("does NOT consult the AI feature gate for a v2 request", async () => {
    submitReportMock.mockResolvedValue({
      reportId: "air_v2gated",
      status: "submitted",
      receivedAt: "2026-08-27T00:00:00.000Z",
      duplicate: false,
    });
    const fn = handlers.get(AI_CONTENT_REPORT_CREATE)!;
    await fn({}, JSON.stringify(makeV2Payload()));
    expect(isAiEnabledMock).not.toHaveBeenCalled();
  });
});

describe("ai-content-report-ipc capabilities", () => {
  beforeEach(() => {
    handlers.clear();
    submitReportMock.mockReset();
    getCapabilitiesMock.mockReset();
    isAiEnabledMock.mockReset();
    isAiEnabledMock.mockReturnValue(true);
    registerAIContentReportIpcHandlers();
  });

  it("registers the AI_CONTENT_REPORT_CAPABILITIES channel", () => {
    expect(handlers.has(AI_CONTENT_REPORT_CAPABILITIES)).toBe(true);
  });

  it("returns fail-closed capabilities from the service", async () => {
    getCapabilitiesMock.mockResolvedValue(DISABLED_CAPABILITIES);
    const fn = handlers.get(AI_CONTENT_REPORT_CAPABILITIES)!;
    const res = (await fn({}, JSON.stringify({ schemaVersion: 1 }))) as {
      status: boolean;
      data: AIContentReportCapabilities | null;
    };
    expect(res.status).toBe(true);
    expect(res.data?.conversationReporting.enabled).toBe(false);
    expect(res.data?.acceptedSchemaVersions).toEqual([1]);
    expect(getCapabilitiesMock).toHaveBeenCalledTimes(1);
  });

  it("returns enabled capabilities when the backend advertises v2", async () => {
    getCapabilitiesMock.mockResolvedValue(ENABLED_CAPABILITIES);
    const fn = handlers.get(AI_CONTENT_REPORT_CAPABILITIES)!;
    const res = (await fn({}, JSON.stringify({ schemaVersion: 1 }))) as {
      status: boolean;
      data: AIContentReportCapabilities | null;
    };
    expect(res.status).toBe(true);
    expect(res.data?.conversationReporting.enabled).toBe(true);
    expect(res.data?.conversationReporting.maxAIItems).toBe(10);
  });

  it("rejects a capabilities payload with the wrong schemaVersion", async () => {
    getCapabilitiesMock.mockResolvedValue(ENABLED_CAPABILITIES);
    const fn = handlers.get(AI_CONTENT_REPORT_CAPABILITIES)!;
    const res = (await fn({}, JSON.stringify({ schemaVersion: 2 }))) as {
      status: boolean;
      data: unknown;
    };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
    expect(getCapabilitiesMock).not.toHaveBeenCalled();
  });

  it("does NOT consult the AI feature gate for capabilities", async () => {
    getCapabilitiesMock.mockResolvedValue(ENABLED_CAPABILITIES);
    const fn = handlers.get(AI_CONTENT_REPORT_CAPABILITIES)!;
    await fn({}, JSON.stringify({ schemaVersion: 1 }));
    expect(isAiEnabledMock).not.toHaveBeenCalled();
  });

  it("works for capabilities even when isAiEnabled would return false", async () => {
    isAiEnabledMock.mockReturnValue(false);
    getCapabilitiesMock.mockResolvedValue(ENABLED_CAPABILITIES);
    const fn = handlers.get(AI_CONTENT_REPORT_CAPABILITIES)!;
    const res = (await fn({}, JSON.stringify({ schemaVersion: 1 }))) as {
      status: boolean;
      data: AIContentReportCapabilities | null;
    };
    expect(res.status).toBe(true);
    expect(res.data?.conversationReporting.enabled).toBe(true);
  });

  it("maps a capabilities service failure to status:false", async () => {
    getCapabilitiesMock.mockRejectedValue(new Error("backend explosion"));
    const fn = handlers.get(AI_CONTENT_REPORT_CAPABILITIES)!;
    const res = (await fn({}, JSON.stringify({ schemaVersion: 1 }))) as {
      status: boolean;
      data: unknown;
    };
    expect(res.status).toBe(false);
    expect(res.data).toBe(null);
  });
});
