"use strict";
import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Mocks ----------------------------------------------------------------

vi.mock("electron", () => ({
  app: {
    getName: vi.fn(() => "aiFetchly"),
    getPath: vi.fn(() => "/tmp/test"),
    getVersion: vi.fn(() => "1.2.3"),
  },
}));

vi.mock("@/modules/diagnostics/DiagnosticIdentity", () => ({
  getOrCreateInstallId: vi.fn(() => "11111111-1111-1111-1111-111111111111"),
}));

// --- Service under test ----------------------------------------------------

import { AIContentReportService } from "@/service/AIContentReportService";
import type {
  CreateAIContentReportRequest,
  AIContentReportImagePreview,
} from "@/entityTypes/aiContentReportTypes";

const VALID_BASE: CreateAIContentReportRequest = {
  schemaVersion: 1,
  clientReportId: "85ef5843-697b-40a2-b9ea-4f5802af5475",
  surface: "chat_v2",
  contentType: "text",
  category: "misinformation_or_deception",
  output: {
    text: "Some AI-generated output",
  },
  context: {
    appVersion: "placeholder", // overwritten by main-process service
    platform: "win32", // overwritten by main-process service
    locale: "en-US",
    installId: "placeholder", // must NOT reach the wire (backend rejects unknown fields)
  },
};

function imagePreview(
  overrides: Partial<AIContentReportImagePreview> = {}
): AIContentReportImagePreview {
  return {
    mimeType: "image/png",
    // 1x1 PNG
    dataBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    width: 1,
    height: 1,
    ...overrides,
  };
}

function makeService(
  postJson: ReturnType<typeof vi.fn>
): AIContentReportService {
  return new AIContentReportService({
    httpClient: { postJson, get: vi.fn() },
    appVersion: () => "9.9.9-test",
    installId: () => "22222222-2222-2222-2222-222222222222",
  });
}

describe("AIContentReportService wire contract (backend v1)", () => {
  let postJson: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postJson = vi.fn().mockResolvedValue({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        reportId: "air_test",
        status: "submitted",
        receivedAt: "2026-09-04T00:00:00Z",
        duplicate: false,
      },
    });
  });

  it("sends the install id in the X-AiFetchly-Install-Id header, never in the body", async () => {
    const svc = makeService(postJson);
    await svc.submitReport({ ...VALID_BASE });

    expect(postJson).toHaveBeenCalledTimes(1);
    const [endpoint, body, options] = postJson.mock.calls[0];
    expect(endpoint).toBe("/api/ai/content-reports");
    // Header carries the install id (backend design §7.1: required when
    // anonymous; ignored when a valid bearer token is present).
    expect(options.headers["X-AiFetchly-Install-Id"]).toBe(
      "22222222-2222-2222-2222-222222222222"
    );
    // Body must not contain installId anywhere: ParseRequest uses
    // DisallowUnknownFields and context.installId is not a backend field.
    expect(JSON.stringify(body)).not.toContain("installId");
  });

  it("materializes the backend-required output keys even when omitted", async () => {
    const svc = makeService(postJson);
    await svc.submitReport({ ...VALID_BASE });

    const [, body] = postJson.mock.calls[0];
    // Backend requiredKeys demand PRESENCE of these keys (missing → 400):
    // a Go zero value cannot distinguish absent from explicit false/[].
    expect(body.output).toMatchObject({
      textTruncated: false,
      imagePreviews: [],
      evidenceUnavailable: false,
    });
  });

  it("backfills sha256 over the decoded bytes of each image preview", async () => {
    const svc = makeService(postJson);
    const preview = imagePreview(); // no sha256, like the renderer encoder
    await svc.submitReport({
      ...VALID_BASE,
      output: { imagePreviews: [preview] },
    });

    const [, body] = postJson.mock.calls[0];
    const sent = body.output.imagePreviews[0];
    // Backend recomputes SHA-256 of the decoded base64 and requires a match
    // (services/aicontentreport/image.go). Hex, lowercase.
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update(Buffer.from(sent.dataBase64, "base64"))
      .digest("hex");
    expect(sent.sha256).toBe(expected);
  });

  it("preserves a renderer-supplied sha256 instead of recomputing", async () => {
    const svc = makeService(postJson);
    const preview = imagePreview({ sha256: "renderer-computed" });
    await svc.submitReport({
      ...VALID_BASE,
      output: { imagePreviews: [preview] },
    });

    const [, body] = postJson.mock.calls[0];
    expect(body.output.imagePreviews[0].sha256).toBe("renderer-computed");
  });

  it("overwrites context appVersion/platform from main-process sources", async () => {
    const svc = makeService(postJson);
    await svc.submitReport({ ...VALID_BASE });

    const [, body] = postJson.mock.calls[0];
    expect(body.context.appVersion).toBe("9.9.9-test");
    expect(body.context.platform).toBe(process.platform);
  });
});
