/**
 * Integration tests for the worker message schema enforcement on the main side.
 *
 * Verifies that contactExtraction-ipc's worker.on('message') handler:
 *  - Drops malformed outbound messages with a log.warn
 *  - Dispatches valid messages to the correct handler
 *
 * The actual worker.on('message') callback is not exported, so we test the
 * shared schema + the dispatch behavior in isolation by simulating what
 * the handler does: safeParse against contactExtractionWorkerOutboundSchema,
 * then narrow via message.type.
 */
import { describe, it, expect, vi } from "vitest";
import {
  contactExtractionWorkerOutboundSchema,
  contactExtractionWorkerInboundSchema,
} from "@/schemas/worker/contactExtraction";

// Stand-in for the main-side dispatch — same logic as in contactExtraction-ipc.ts.
function dispatchOutbound(
  raw: unknown,
  handlers: {
    onReady: () => void;
    onLog: (level: string, args: unknown[]) => void;
    onProgress: (resultId: number) => void;
    onUrlResult: (requestId: string, url: string, success: boolean) => void;
    onDrop: (errMsg: string) => void;
  },
): void {
  const parsed = contactExtractionWorkerOutboundSchema().safeParse(raw);
  if (!parsed.success) {
    handlers.onDrop(parsed.error.message);
    return;
  }
  const m = parsed.data;
  switch (m.type) {
    case "worker-ready":
      handlers.onReady();
      break;
    case "worker-log":
      handlers.onLog(m.level, m.args);
      break;
    case "extraction-progress":
      handlers.onProgress(m.resultId);
      break;
    case "extract-contact-url-result":
      handlers.onUrlResult(m.requestId, m.url, m.success);
      break;
  }
}

describe("contactExtraction worker outbound dispatch", () => {
  it("routes worker-ready to onReady", () => {
    const onReady = vi.fn();
    dispatchOutbound({ type: "worker-ready" }, {
      onReady,
      onLog: vi.fn(),
      onProgress: vi.fn(),
      onUrlResult: vi.fn(),
      onDrop: vi.fn(),
    });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("routes worker-log with default level and args", () => {
    const onLog = vi.fn();
    dispatchOutbound({ type: "worker-log" }, {
      onReady: vi.fn(),
      onLog,
      onProgress: vi.fn(),
      onUrlResult: vi.fn(),
      onDrop: vi.fn(),
    });
    expect(onLog).toHaveBeenCalledWith("info", []); // schema defaults
  });

  it("routes extraction-progress", () => {
    const onProgress = vi.fn();
    dispatchOutbound(
      { type: "extraction-progress", resultId: 42, status: "running", progress: 50 },
      {
        onReady: vi.fn(),
        onLog: vi.fn(),
        onProgress,
        onUrlResult: vi.fn(),
        onDrop: vi.fn(),
      },
    );
    expect(onProgress).toHaveBeenCalledWith(42);
  });

  it("routes extract-contact-url-result (single URL wire format)", () => {
    const onUrlResult = vi.fn();
    dispatchOutbound(
      {
        type: "extract-contact-url-result",
        requestId: "req-42",
        url: "https://x.com",
        success: true,
      },
      {
        onReady: vi.fn(),
        onLog: vi.fn(),
        onProgress: vi.fn(),
        onUrlResult,
        onDrop: vi.fn(),
      },
    );
    expect(onUrlResult).toHaveBeenCalledWith("req-42", "https://x.com", true);
  });

  it("drops malformed messages and fires onDrop", () => {
    const onDrop = vi.fn();
    const onProgress = vi.fn();
    dispatchOutbound(
      // missing required status
      { type: "extraction-progress", resultId: 1 },
      {
        onReady: vi.fn(),
        onLog: vi.fn(),
        onProgress,
        onUrlResult: vi.fn(),
        onDrop,
      },
    );
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("drops unknown discriminator value", () => {
    const onDrop = vi.fn();
    dispatchOutbound({ type: "mystery-event" }, {
      onReady: vi.fn(),
      onLog: vi.fn(),
      onProgress: vi.fn(),
      onUrlResult: vi.fn(),
      onDrop,
    });
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});

describe("contactExtraction worker inbound dispatch", () => {
  // Mirror of ContactExtractionWorker's process.on('message') narrowing.
  function dispatchInbound(
    raw: unknown,
    handlers: {
      onExtract: (batchId: string) => void;
      onExtractUrls: (requestId: string, urls: string[]) => void;
      onDrop: (errMsg: string) => void;
    },
  ): void {
    const parsed = contactExtractionWorkerInboundSchema().safeParse(raw);
    if (!parsed.success) {
      handlers.onDrop(parsed.error.message);
      return;
    }
    const m = parsed.data;
    if (m.type === "extract-contact") {
      handlers.onExtract(m.batchId);
    } else if (m.type === "extract-contact-from-urls") {
      handlers.onExtractUrls(m.requestId, m.urls);
    }
    // shutdown: no-op
  }

  it("accepts a fully-formed extract-contact", () => {
    const onExtract = vi.fn();
    dispatchInbound(
      {
        type: "extract-contact",
        batchId: "batch-1",
        resultIds: [1, 2],
        results: [
          { id: 1, url: "https://a.com", title: "A" },
          { id: 2, url: "https://b.com", title: "B" },
        ],
      },
      { onExtract, onExtractUrls: vi.fn(), onDrop: vi.fn() },
    );
    expect(onExtract).toHaveBeenCalledWith("batch-1");
  });

  it("drops extract-contact missing the results array (now required)", () => {
    const onDrop = vi.fn();
    const onExtract = vi.fn();
    dispatchInbound(
      { type: "extract-contact", batchId: "b", resultIds: [1] },
      { onExtract, onExtractUrls: vi.fn(), onDrop },
    );
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onExtract).not.toHaveBeenCalled();
  });

  it("routes extract-contact-from-urls", () => {
    const onExtractUrls = vi.fn();
    dispatchInbound(
      { type: "extract-contact-from-urls", requestId: "r1", urls: ["https://x.com"] },
      { onExtract: vi.fn(), onExtractUrls, onDrop: vi.fn() },
    );
    expect(onExtractUrls).toHaveBeenCalledWith("r1", ["https://x.com"]);
  });

  it("silently accepts shutdown (no-op at worker)", () => {
    const onDrop = vi.fn();
    const onExtract = vi.fn();
    dispatchInbound(
      { type: "shutdown" },
      { onExtract, onExtractUrls: vi.fn(), onDrop },
    );
    expect(onDrop).not.toHaveBeenCalled();
    expect(onExtract).not.toHaveBeenCalled();
  });
});
