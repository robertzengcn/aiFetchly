import { describe, it, expect } from "vitest";
import {
  contactExtractionWorkerOutboundSchema,
  contactExtractionWorkerInboundSchema,
} from "@/schemas/worker/contactExtraction";

describe("contactExtractionWorkerOutboundSchema", () => {
  it("accepts worker-ready", () => {
    const r = contactExtractionWorkerOutboundSchema().safeParse({
      type: "worker-ready",
    });
    expect(r.success).toBe(true);
  });

  it("accepts worker-log with defaults", () => {
    const r = contactExtractionWorkerOutboundSchema().safeParse({
      type: "worker-log",
      args: ["hello"],
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === "worker-log") {
      expect(r.data.level).toBe("info"); // default
    }
  });

  it("accepts extraction-progress with proper field types", () => {
    const r = contactExtractionWorkerOutboundSchema().safeParse({
      type: "extraction-progress",
      resultId: 42,
      status: "completed",
      progress: 100,
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === "extraction-progress") {
      expect(r.data.resultId).toBe(42);
      expect(r.data.status).toBe("completed");
    }
  });

  it("rejects extraction-progress with negative resultId", () => {
    const r = contactExtractionWorkerOutboundSchema().safeParse({
      type: "extraction-progress",
      resultId: -1,
      status: "completed",
    });
    expect(r.success).toBe(false);
  });

  it("rejects extraction-progress with invalid status", () => {
    const r = contactExtractionWorkerOutboundSchema().safeParse({
      type: "extraction-progress",
      resultId: 1,
      status: "done", // not in enum
    });
    expect(r.success).toBe(false);
  });

  it("accepts extract-contact-url-result (single URL per message)", () => {
    // Wire format matches ContactExtractionWorker.ts: one message per URL,
    // all sharing the requestId. Multiple URLs => multiple messages.
    const ok = contactExtractionWorkerOutboundSchema().safeParse({
      type: "extract-contact-url-result",
      requestId: "req-1",
      url: "https://example.com",
      success: true,
      data: { emails: ["a@b.com"], phones: [] },
    });
    expect(ok.success).toBe(true);

    const failed = contactExtractionWorkerOutboundSchema().safeParse({
      type: "extract-contact-url-result",
      requestId: "req-1",
      url: "https://fail.com",
      success: false,
      error: "timeout",
    });
    expect(failed.success).toBe(true);
  });

  it("rejects extract-contact-url-result with array 'results' (wrong wire shape)", () => {
    // Documents the deliberate wire-format choice: arrays are NOT accepted,
    // because the worker emits one message per URL. If a future batch-mode
    // variant is added, it should use a distinct discriminator value.
    const r = contactExtractionWorkerOutboundSchema().safeParse({
      type: "extract-contact-url-result",
      requestId: "req-1",
      results: [{ url: "https://example.com", success: true }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown message type", () => {
    const r = contactExtractionWorkerOutboundSchema().safeParse({
      type: "mystery-event",
      payload: 123,
    });
    expect(r.success).toBe(false);
  });

  it("rejects object missing the discriminator", () => {
    const r = contactExtractionWorkerOutboundSchema().safeParse({ foo: "bar" });
    expect(r.success).toBe(false);
  });
});

describe("contactExtractionWorkerInboundSchema", () => {
  it("accepts extract-contact with batchId and resultIds", () => {
    const r = contactExtractionWorkerInboundSchema().safeParse({
      type: "extract-contact",
      batchId: "b1",
      resultIds: [1, 2, 3],
      results: [
        { id: 1, url: "https://a.com", title: "A" },
        { id: 2, url: "https://b.com", title: "B" },
        { id: 3, url: "https://c.com", title: "C" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts extract-contact-from-urls", () => {
    const r = contactExtractionWorkerInboundSchema().safeParse({
      type: "extract-contact-from-urls",
      requestId: "r1",
      urls: ["https://a.com", "https://b.com"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts shutdown", () => {
    const r = contactExtractionWorkerInboundSchema().safeParse({
      type: "shutdown",
    });
    expect(r.success).toBe(true);
  });

  it("rejects extract-contact with non-array resultIds", () => {
    const r = contactExtractionWorkerInboundSchema().safeParse({
      type: "extract-contact",
      batchId: "b1",
      resultIds: "oops",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown inbound type", () => {
    const r = contactExtractionWorkerInboundSchema().safeParse({
      type: "extract-mystery",
    });
    expect(r.success).toBe(false);
  });
});
