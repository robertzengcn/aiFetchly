import { describe, expect, it, vi } from "vitest";

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
      httpClient: { postJson },
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
      httpClient: { postJson },
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
      httpClient: { postJson },
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
      httpClient: { postJson: vi.fn() },
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
      httpClient: { postJson },
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
      httpClient: { postJson },
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
      httpClient: { postJson },
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
      httpClient: { postJson },
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
      httpClient: { postJson },
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

  it("reuses the same clientReportId across retries (idempotency)", async () => {
    // First call fails with network, second succeeds — same clientReportId.
    const postJson = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(makeResponse());
    const service = new AIContentReportService({
      httpClient: { postJson },
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
        httpClient: { postJson: vi.fn() },
      });
      expect(service.normalizeText("short")).toEqual({ text: "short" });
    });

    it("truncates preserving head and tail, and sets textTruncated", () => {
      const service = new AIContentReportService({
        httpClient: { postJson: vi.fn() },
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
        httpClient: { postJson: vi.fn() },
      });
      expect(service.normalizeText(undefined)).toEqual({});
    });
  });
});
