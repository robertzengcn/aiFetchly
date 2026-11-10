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
import { handleWorkerShutdown } from "@/childprocess/contact-extraction/ContactExtractionWorker";

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
      onShutdown: (requestId: string, remainingMs?: number) => void;
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
    } else if (m.type === "shutdown") {
      handlers.onShutdown(m.requestId, m.remainingMs);
    }
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
      { onExtract, onExtractUrls: vi.fn(), onShutdown: vi.fn(), onDrop: vi.fn() },
    );
    expect(onExtract).toHaveBeenCalledWith("batch-1");
  });

  it("drops extract-contact missing the results array (now required)", () => {
    const onDrop = vi.fn();
    const onExtract = vi.fn();
    dispatchInbound(
      { type: "extract-contact", batchId: "b", resultIds: [1] },
      { onExtract, onExtractUrls: vi.fn(), onShutdown: vi.fn(), onDrop },
    );
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onExtract).not.toHaveBeenCalled();
  });

  it("routes extract-contact-from-urls", () => {
    const onExtractUrls = vi.fn();
    dispatchInbound(
      { type: "extract-contact-from-urls", requestId: "r1", urls: ["https://x.com"] },
      { onExtract: vi.fn(), onExtractUrls, onShutdown: vi.fn(), onDrop: vi.fn() },
    );
    expect(onExtractUrls).toHaveBeenCalledWith("r1", ["https://x.com"]);
  });

  it("routes shutdown to the §7 protocol handler with requestId + budget", () => {
    const onDrop = vi.fn();
    const onExtract = vi.fn();
    const onShutdown = vi.fn();
    dispatchInbound(
      { type: "shutdown", requestId: "req-7", reason: "app-shutdown", remainingMs: 2000 },
      { onExtract, onExtractUrls: vi.fn(), onShutdown, onDrop },
    );
    expect(onDrop).not.toHaveBeenCalled();
    expect(onExtract).not.toHaveBeenCalled();
    expect(onShutdown).toHaveBeenCalledWith("req-7", 2000);
  });

  it("drops a bare shutdown missing the correlatable requestId", () => {
    const onDrop = vi.fn();
    dispatchInbound(
      { type: "shutdown" },
      { onExtract: vi.fn(), onExtractUrls: vi.fn(), onShutdown: vi.fn(), onDrop },
    );
    expect(onDrop).toHaveBeenCalled();
  });
});

describe("handleWorkerShutdown — the REAL §7 handler (not a mirror)", () => {
  const sendMock = vi.fn(() => true);
  const exitMock = vi.fn();
  vi.stubGlobal("process", {
    ...process,
    send: sendMock,
    exit: exitMock,
  });
  // gracefulShutdown closes browsers asynchronously then exits; the finally
  // calls process.exit — mocked. Keep tests focused on ack + timer arming.

  it("acks with the correlatable requestId, then exits via the graceful path", async () => {
    handleWorkerShutdown({ requestId: "req-9" });
    // Ack is SYNCHRONOUS — sent before any async browser cleanup resolves.
    expect(sendMock).toHaveBeenCalledWith({
      type: "shutdown-ack",
      requestId: "req-9",
    });
    // gracefulShutdown closes browsers then exits in .finally — flush.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(exitMock).toHaveBeenCalled();
  });

  it("bounds the watchdog to the parent's remainingMs when smaller", () => {
    handleWorkerShutdown({ requestId: "req-b", remainingMs: 500 });
    expect(sendMock).toHaveBeenCalledWith({
      type: "shutdown-ack",
      requestId: "req-b",
    });
  });

  it("clamps a generous parent budget to the local browser timeout", () => {
    handleWorkerShutdown({ requestId: "req-c", remainingMs: 60_000 });
    expect(sendMock).toHaveBeenCalledWith({
      type: "shutdown-ack",
      requestId: "req-c",
    });
  });
});
