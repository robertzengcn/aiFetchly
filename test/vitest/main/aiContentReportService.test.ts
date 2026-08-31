import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Electron so the real electron binary is never loaded. The service
// imports `app` for app-version resolution, but tests inject a custom
// appVersion provider, so this mock just needs to satisfy module resolution.
vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.0.0-test"),
    getPath: vi.fn(() => "/tmp/test"),
  },
}));

import { AIContentReportService } from "@/service/AIContentReportService";
import {
  AIContentReportError,
  type CreateAIContentReportRequest,
  type CreateAIContentReportResponse,
  type CreateAIConversationReportRequest,
} from "@/entityTypes/aiContentReportTypes";
import type { CommonApiresp } from "@/entityTypes/commonType";
import { log } from "@/modules/Logger";

function makeValidRequest(
  overrides: Partial<CreateAIContentReportRequest> = {}
): CreateAIContentReportRequest {
  return {
    schemaVersion: 1,
    clientReportId: "client-uuid-123",
    surface: "chat_v2",
    contentType: "text",
    category: "other",
    comment: "test comment",
    output: { text: "AI output" },
    context: {
      conversationId: "conv-1",
      messageId: "msg-1",
      appVersion: "test-app-version-from-renderer",
      platform: "win32",
      locale: "en-US",
    },
    ...overrides,
  };
}

function makeResponse(
  overrides: Partial<CreateAIContentReportResponse> = {}
): CommonApiresp<CreateAIContentReportResponse> {
  return {
    status: true,
    code: 0,
    msg: "ok",
    data: {
      reportId: "air_abc123",
      status: "submitted",
      receivedAt: "2026-08-27T00:00:00.000Z",
      duplicate: false,
      ...overrides,
    },
  };
}

describe("AIContentReportService", () => {
  it("submits a valid report and returns the backend reportId", async () => {
    const postJson = vi.fn().mockResolvedValue(makeResponse());
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.2.3",
      installId: () => "install-id-xyz",
    });
    const result = await service.submitReport(makeValidRequest());
    expect(result.reportId).toBe("air_abc123");
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0][0]).toBe("/api/ai/content-reports");
  });

  it("overwrites renderer placeholder appVersion/platform and fills installId in submitReport", async () => {
    const postJson = vi.fn().mockResolvedValue(makeResponse());
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "stable-install-id",
    });
    await service.submitReport(
      makeValidRequest({
        context: {
          conversationId: "c1",
          messageId: "m1",
          appVersion: "unknown",
          platform: "win32",
          locale: "en-US",
        },
      })
    );
    const sent = postJson.mock.calls[0][1] as CreateAIContentReportRequest;
    expect(sent.context.appVersion).toBe("9.9.9");
    expect(sent.context.platform).toBe(
      process.platform as "win32" | "darwin" | "linux"
    );
    expect(sent.context.installId).toBe("stable-install-id");
  });

  it("truncates long text in submitReport so the Zod 32000 cap is not tripped", async () => {
    const postJson = vi.fn().mockResolvedValue(makeResponse());
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    const long = "a".repeat(32001);
    await service.submitReport(makeValidRequest({ output: { text: long } }));
    const sent = postJson.mock.calls[0][1] as CreateAIContentReportRequest;
    expect(sent.output.textTruncated).toBe(true);
    expect(sent.output.text?.length).toBeLessThanOrEqual(32000);
  });

  it("fills appVersion, platform, and installId in assembleContext", () => {
    const service = new AIContentReportService({
      httpClient: { postJson: vi.fn(), get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "stable-install-id",
    });
    const ctx = service.assembleContext({
      conversationId: "c1",
      messageId: "m1",
      appVersion: "placeholder",
      platform: "win32",
      locale: "fr-FR",
    });
    expect(ctx.appVersion).toBe("9.9.9");
    expect(ctx.platform).toBe(process.platform as "win32" | "darwin" | "linux");
    expect(ctx.installId).toBe("stable-install-id");
    expect(ctx.locale).toBe("fr-FR");
  });

  it("treats a duplicate response (same clientReportId) as success with the original reportId", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ duplicate: true, reportId: "air_original" })
      );
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    const result = await service.submitReport(makeValidRequest());
    expect(result.duplicate).toBe(true);
    expect(result.reportId).toBe("air_original");
  });

  it("throws AIContentReportError with a safe code on a 429", async () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const postJson = vi.fn().mockRejectedValue(err);
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    await expect(
      service.submitReport(makeValidRequest())
    ).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("throws AIContentReportError with network code on fetch TypeError", async () => {
    const postJson = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    await expect(
      service.submitReport(makeValidRequest())
    ).rejects.toMatchObject({
      code: "network",
    });
  });

  it("throws when the backend rejects (status:false)", async () => {
    const postJson = vi.fn().mockResolvedValue({
      status: false,
      code: 1,
      msg: "bad",
      data: null,
    } satisfies CommonApiresp<null>);
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    await expect(
      service.submitReport(makeValidRequest())
    ).rejects.toBeInstanceOf(AIContentReportError);
  });

  it("never logs output text, comment, or image bytes", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});
    const postJson = vi.fn().mockResolvedValue(makeResponse());
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    await service.submitReport(
      makeValidRequest({
        comment: "secret comment text",
        output: { text: "secret output text" },
      })
    );
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain("secret comment text");
    expect(logged).not.toContain("secret output text");
    // Must contain metadata-only fields.
    expect(logged).toContain("clientReportId");
    expect(logged).toContain("reportId");
    infoSpy.mockRestore();
  });

  it("emits ai_content_report_submitted with metadata-only properties", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});
    const postJson = vi.fn().mockResolvedValue(makeResponse());
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    await service.submitReport(
      makeValidRequest({
        surface: "chat_v2",
        contentType: "text",
        category: "other",
        comment: "secret comment",
        output: { text: "secret output" },
      })
    );
    const analyticsCalls = infoSpy.mock.calls.filter((c) =>
      String(c[0]).includes("[analytics]")
    );
    expect(analyticsCalls.length).toBeGreaterThan(0);
    const submitted = analyticsCalls.find((c) =>
      String(c[0]).includes("ai_content_report_submitted")
    );
    expect(submitted).toBeDefined();
    const logged = JSON.stringify(analyticsCalls);
    // Allowed properties present.
    expect(logged).toContain("surface");
    expect(logged).toContain("contentType");
    expect(logged).toContain("category");
    // Forbidden report content absent (PRD §15).
    expect(logged).not.toContain("secret comment");
    expect(logged).not.toContain("secret output");
    infoSpy.mockRestore();
  });

  it("emits ai_content_report_failed with a safe error code on failure", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const postJson = vi.fn().mockRejectedValue(err);
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    await expect(
      service.submitReport(makeValidRequest())
    ).rejects.toMatchObject({
      code: "rate_limited",
    });
    const failed = infoSpy.mock.calls.find(
      (c) =>
        String(c[0]).includes("[analytics]") &&
        String(c[0]).includes("ai_content_report_failed")
    );
    expect(failed).toBeDefined();
    const logged = JSON.stringify(failed);
    expect(logged).toContain("rate_limited");
    expect(logged).toContain("surface");
    // No report content.
    expect(logged).not.toContain("AI output");
    infoSpy.mockRestore();
  });

  it("reuses the same clientReportId across retries (idempotency)", async () => {
    // First call fails with network, second succeeds — same clientReportId.
    const postJson = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(makeResponse());
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "id",
    });
    const request = makeValidRequest({ clientReportId: "stable-id" });
    await expect(service.submitReport(request)).rejects.toBeInstanceOf(
      AIContentReportError
    );
    const result = await service.submitReport(request);
    expect(result.reportId).toBe("air_abc123");
    // Both calls passed the same clientReportId in the request body.
    expect(postJson.mock.calls[0][1].clientReportId).toBe("stable-id");
    expect(postJson.mock.calls[1][1].clientReportId).toBe("stable-id");
  });

  describe("normalizeText", () => {
    it("returns text unchanged when under the limit", () => {
      const service = new AIContentReportService({
        httpClient: { postJson: vi.fn(), get: vi.fn() },
      });
      expect(service.normalizeText("short")).toEqual({ text: "short" });
    });

    it("truncates preserving head and tail, and sets textTruncated", () => {
      const service = new AIContentReportService({
        httpClient: { postJson: vi.fn(), get: vi.fn() },
      });
      const long = "a".repeat(32001);
      const result = service.normalizeText(long);
      expect(result.textTruncated).toBe(true);
      expect(result.text?.length).toBeLessThanOrEqual(32000);
      expect(result.text?.startsWith("a")).toBe(true);
      expect(result.text?.endsWith("a")).toBe(true);
    });

    it("returns empty for undefined input", () => {
      const service = new AIContentReportService({
        httpClient: { postJson: vi.fn(), get: vi.fn() },
      });
      expect(service.normalizeText(undefined)).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// Conversation reporting (schema version 2) — design §15.
//
// The capability cache lives at module scope, so these tests re-import the
// service module to get a fresh cache per test.
// ---------------------------------------------------------------------------

function makeStubClient(): {
  postJson: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  return { postJson: vi.fn(), get: vi.fn() };
}

function makeCapabilitiesEnvelope(enabled = true): Record<string, unknown> {
  return {
    status: true,
    code: 0,
    msg: "ok",
    data: {
      acceptedSchemaVersions: [1, 2],
      conversationReporting: {
        enabled,
        maxAIItems: 10,
        maxUserItems: 10,
        maxTotalItems: 20,
        maxItemTextChars: 8000,
        maxAggregateTextChars: 32000,
        maxImages: 3,
      },
    },
  };
}

describe("AIContentReportService.getCapabilities", () => {
  beforeEach(() => {
    // The cache is module-level; re-importing resets it between tests.
    vi.resetModules();
  });

  it("returns enabled v2 capabilities from the backend", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce(makeCapabilitiesEnvelope());
    const service = new AIContentReportService({ httpClient: client });
    const caps = await service.getCapabilities();
    expect(caps.conversationReporting.enabled).toBe(true);
    expect(caps.acceptedSchemaVersions).toEqual([1, 2]);
  });

  it("calls the capabilities endpoint via GET", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce(makeCapabilitiesEnvelope());
    const service = new AIContentReportService({ httpClient: client });
    await service.getCapabilities();
    expect(client.get).toHaveBeenCalledWith(
      "/api/ai/content-reports/capabilities"
    );
  });

  it("fail-closes to enabled:false on network error", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockRejectedValueOnce(new Error("network down"));
    const service = new AIContentReportService({ httpClient: client });
    const caps = await service.getCapabilities();
    expect(caps.conversationReporting.enabled).toBe(false);
    expect(caps.acceptedSchemaVersions).toEqual([1]);
  });

  it("fail-closes to enabled:false on invalid response shape", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce({ garbage: true });
    const service = new AIContentReportService({ httpClient: client });
    const caps = await service.getCapabilities();
    expect(caps.conversationReporting.enabled).toBe(false);
    expect(caps.acceptedSchemaVersions).toEqual([1]);
  });

  it("fail-closes when the backend envelope reports status:false", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce({
      status: false,
      code: 1,
      msg: "nope",
      data: null,
    });
    const service = new AIContentReportService({ httpClient: client });
    const caps = await service.getCapabilities();
    expect(caps.conversationReporting.enabled).toBe(false);
  });

  it("does not cache a failed fetch (retries the next call)", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(makeCapabilitiesEnvelope());
    const service = new AIContentReportService({ httpClient: client });
    await service.getCapabilities();
    const caps = await service.getCapabilities();
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(caps.conversationReporting.enabled).toBe(true);
  });

  it("caches capabilities for the TTL window (no second HTTP call)", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce(makeCapabilitiesEnvelope());
    const service = new AIContentReportService({ httpClient: client });
    await service.getCapabilities();
    await service.getCapabilities();
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it("shares the cache across service instances", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce(makeCapabilitiesEnvelope());
    const a = new AIContentReportService({ httpClient: client });
    const b = new AIContentReportService({ httpClient: client });
    await a.getCapabilities();
    await b.getCapabilities();
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  // Design §15.2, TODO-12: an over-advertised backend must never lift the
  // desktop v2 caps. Each numeric limit is clamped to Math.min(server, desktop).
  it("clamps over-advertised server limits to desktop hard maximums", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: {
          enabled: true,
          maxAIItems: 200,
          maxUserItems: 200,
          maxTotalItems: 500,
          maxItemTextChars: 100_000,
          maxAggregateTextChars: 500_000,
          maxImages: 50,
        },
      },
    });
    const service = new AIContentReportService({ httpClient: client });
    const caps = await service.getCapabilities();
    const cr = caps.conversationReporting;
    expect(cr.maxAIItems).toBe(10);
    expect(cr.maxUserItems).toBe(10);
    expect(cr.maxTotalItems).toBe(20);
    expect(cr.maxItemTextChars).toBe(8000);
    expect(cr.maxAggregateTextChars).toBe(32000);
    expect(cr.maxImages).toBe(3);
  });

  // A backend advertising SMALLER limits (e.g. a trial tier) must be honored —
  // the clamp uses Math.min, so the smaller server value wins.
  it("preserves server limits that are below the desktop maximums", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: {
          enabled: true,
          maxAIItems: 5,
          maxUserItems: 3,
          maxTotalItems: 8,
          maxItemTextChars: 4000,
          maxAggregateTextChars: 16000,
          maxImages: 1,
        },
      },
    });
    const service = new AIContentReportService({ httpClient: client });
    const caps = await service.getCapabilities();
    const cr = caps.conversationReporting;
    expect(cr.maxAIItems).toBe(5);
    expect(cr.maxUserItems).toBe(3);
    expect(cr.maxTotalItems).toBe(8);
    expect(cr.maxItemTextChars).toBe(4000);
    expect(cr.maxAggregateTextChars).toBe(16000);
    expect(cr.maxImages).toBe(1);
  });

  // The clamped value is what gets cached — a second read within the TTL must
  // return the safe limits, not the raw server limits.
  it("caches the clamped (not raw) limits", async () => {
    const { AIContentReportService } = await import(
      "@/service/AIContentReportService"
    );
    const client = makeStubClient();
    client.get.mockResolvedValueOnce({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: {
          enabled: true,
          maxAIItems: 200,
          maxUserItems: 200,
          maxTotalItems: 500,
          maxItemTextChars: 100_000,
          maxAggregateTextChars: 500_000,
          maxImages: 50,
        },
      },
    });
    const service = new AIContentReportService({ httpClient: client });
    await service.getCapabilities();
    const caps = await service.getCapabilities();
    expect(caps.conversationReporting.maxAIItems).toBe(10);
    expect(caps.conversationReporting.maxImages).toBe(3);
    expect(client.get).toHaveBeenCalledTimes(1);
  });
});

describe("AIContentReportService.submitReport v2 dispatch", () => {
  function makeV2Request(
    overrides: Partial<CreateAIConversationReportRequest> = {}
  ): CreateAIConversationReportRequest {
    return {
      schemaVersion: 2,
      clientReportId: "c2",
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
          text: "assistant output",
        },
      ],
      context: {
        conversationId: "conv-2",
        selectedAIItemCount: 1,
        includedUserItemCount: 0,
        appVersion: "unknown",
        platform: "win32",
        locale: "en-US",
      },
      ...overrides,
    };
  }

  it("dispatches a v2 request, assembles v2 context, and re-normalizes items", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValue(makeResponse({ reportId: "r2" }));
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "install-xyz",
    });
    const result = await service.submitReport(
      makeV2Request({
        items: [
          {
            itemId: "i1",
            messageId: "m1",
            sequence: 0,
            role: "assistant",
            contentType: "text",
            text: "x".repeat(9000),
          },
        ],
      })
    );
    expect(result.reportId).toBe("r2");
    const sent = postJson.mock.calls[0][1] as CreateAIConversationReportRequest;
    expect(sent.context.appVersion).toBe("9.9.9");
    expect(sent.context.installId).toBe("install-xyz");
    expect(sent.context.selectedAIItemCount).toBe(1);
    expect(sent.items[0].text?.length).toBeLessThanOrEqual(8000);
    expect(sent.items[0].textTruncated).toBe(true);
  });

  it("does not modify the caller's request object", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValue(makeResponse({ reportId: "r2" }));
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "install-xyz",
    });
    const request = makeV2Request();
    const beforeText = request.items[0].text;
    const beforeAppVersion = request.context.appVersion;
    await service.submitReport(request);
    expect(request.items[0].text).toBe(beforeText);
    expect(request.context.appVersion).toBe(beforeAppVersion);
    expect(request.context.installId).toBeUndefined();
  });

  it("keeps untruncated item text untouched and leaves non-text items alone", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValue(makeResponse({ reportId: "r2" }));
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "install-xyz",
    });
    const request = makeV2Request({
      items: [
        {
          itemId: "i1",
          messageId: "m1",
          sequence: 0,
          role: "assistant",
          contentType: "text",
          text: "short output",
        },
        {
          itemId: "i2",
          messageId: "m2",
          sequence: 1,
          role: "assistant",
          contentType: "image",
          evidenceUnavailable: true,
        },
      ],
      context: {
        conversationId: "conv-2",
        selectedAIItemCount: 2,
        includedUserItemCount: 0,
        appVersion: "unknown",
        platform: "win32",
        locale: "en-US",
      },
    });
    await service.submitReport(request);
    const sent = postJson.mock.calls[0][1] as CreateAIConversationReportRequest;
    expect(sent.items[0].text).toBe("short output");
    expect(sent.items[0].textTruncated).toBeUndefined();
    expect(sent.items[1].textTruncated).toBeUndefined();
    expect(sent.items[1].evidenceUnavailable).toBe(true);
  });

  it("maps v2 failures to a safe error code without logging item text", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const postJson = vi.fn().mockRejectedValue(err);
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "install-xyz",
    });
    await expect(
      service.submitReport(
        makeV2Request({
          items: [
            {
              itemId: "i1",
              messageId: "m1",
              sequence: 0,
              role: "assistant",
              contentType: "text",
              text: "secret v2 output",
            },
          ],
        })
      )
    ).rejects.toMatchObject({ code: "rate_limited" });
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain("secret v2 output");
    expect(logged).toContain("schemaVersion");
    infoSpy.mockRestore();
  });

  it("emits a metadata-only submitted analytics event for v2", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => {});
    const postJson = vi
      .fn()
      .mockResolvedValue(makeResponse({ reportId: "r2" }));
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "install-xyz",
    });
    await service.submitReport(makeV2Request());
    const submitted = infoSpy.mock.calls.find(
      (c) =>
        String(c[0]).includes("[analytics]") &&
        String(c[0]).includes("ai_content_report_submitted")
    );
    expect(submitted).toBeDefined();
    const logged = JSON.stringify(submitted);
    expect(logged).toContain("surface");
    expect(logged).toContain("category");
    expect(logged).not.toContain("assistant output");
    expect(logged).not.toContain("conv-2");
    infoSpy.mockRestore();
  });

  it("treats a duplicate v2 response as success with the original reportId", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ duplicate: true, reportId: "air_original" })
      );
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "9.9.9",
      installId: () => "install-xyz",
    });
    const result = await service.submitReport(makeV2Request());
    expect(result.duplicate).toBe(true);
    expect(result.reportId).toBe("air_original");
  });

  it("still accepts v1 requests unchanged (backward compatible)", async () => {
    const postJson = vi
      .fn()
      .mockResolvedValue(makeResponse({ reportId: "r1" }));
    const service = new AIContentReportService({
      httpClient: { postJson, get: vi.fn() },
      appVersion: () => "1.0.0",
      installId: () => "install-xyz",
    });
    const result = await service.submitReport(makeValidRequest());
    expect(result.reportId).toBe("r1");
    const sent = postJson.mock.calls[0][1] as CreateAIContentReportRequest;
    expect(sent.schemaVersion).toBe(1);
    expect(sent.context.appVersion).toBe("1.0.0");
    expect(sent.context.installId).toBe("install-xyz");
  });
});
