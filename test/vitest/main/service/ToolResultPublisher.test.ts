import { describe, expect, it, vi } from "vitest";
import { ToolResultPublisher } from "@/service/toolResult/ToolResultPublisher";
import type { ToolResultModule } from "@/modules/ToolResultModule";
import type {
  ToolResultReceipt,
  TrustedToolOutputContext,
} from "@/entityTypes/toolResultTypes";

/**
 * Publication-ordering tests.
 *
 * The behaviours pinned here come straight from the design's failure rules:
 * a queued save is not publication, a publication failure must stop model
 * continuation, a delivery failure must not re-execute anything, and a
 * duplicated terminal result must publish exactly once (AC-25, NFR-09).
 */

function context(overrides: Partial<TrustedToolOutputContext> = {}): TrustedToolOutputContext {
  return {
    profileId: "prof-1",
    conversationId: "conv-1",
    conversationEpoch: "epoch-1",
    turnId: "turn-1",
    executionId: "exec-1",
    toolCallId: "call-1",
    toolName: "scrape_businesses",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function receipt(
  overrides: Partial<ToolResultReceipt> = {}
): ToolResultReceipt {
  return {
    schemaVersion: 1,
    toolCallId: "call-1",
    toolName: "scrape_businesses",
    operationStatus: "success",
    success: true,
    executionTimeMs: 120,
    control: { total: 4000 },
    outputs: [
      {
        outputId: "out_0123456789abcdef0123456789abcdef",
        revision: 1,
        storageBackend: "file",
        format: "json",
        mediaType: "application/json",
        capturedBytes: 133790,
        sha256: "a".repeat(64),
        preservation: "complete",
        sourceCompleteness: "complete",
      },
    ],
    preview: "4000 records. Fields: i, name",
    previewComplete: false,
    ...overrides,
  };
}

/** Module stand-in: the publisher only needs the outbox marker. */
function fakeModule(): ToolResultModule {
  return {
    markReceiptPublished: vi.fn().mockResolvedValue(true),
  } as unknown as ToolResultModule;
}

describe("ToolResultPublisher", () => {
  it("persists before delivering", async () => {
    const order: string[] = [];
    const publisher = new ToolResultPublisher({
      module: fakeModule(),
      store: async () => {
        order.push("store");
      },
      deliver: () => {
        order.push("deliver");
      },
    });
    const outcome = await publisher.publish(context(), receipt());
    expect(outcome.ok).toBe(true);
    // Durable publication strictly precedes display; a turn must not render a
    // result that was never actually saved.
    expect(order).toEqual(["store", "deliver"]);
  });

  it("reports a durable failure so the caller can stop model continuation", async () => {
    const deliver = vi.fn();
    const publisher = new ToolResultPublisher({
      module: fakeModule(),
      store: async () => {
        throw new Error("database is locked");
      },
      deliver,
    });
    const outcome = await publisher.publish(context(), receipt());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("OUTPUT_PUBLICATION_FAILED");
    expect(outcome.durableFailure).toBe(true);
    // Nothing is displayed as if it had been saved.
    expect(deliver).not.toHaveBeenCalled();
  });

  it("treats a delivery failure as a UI problem, not a reason to re-run the tool", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const publisher = new ToolResultPublisher({
      module: fakeModule(),
      store,
      deliver: () => {
        throw new Error("window destroyed");
      },
    });
    const outcome = await publisher.publish(context(), receipt());
    // The receipt IS durable; only the display failed.
    expect(outcome.ok).toBe(true);
    expect(store).toHaveBeenCalledTimes(1);
  });

  it("publishes a duplicated terminal result exactly once (AC-25)", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const deliver = vi.fn();
    const publisher = new ToolResultPublisher({
      module: fakeModule(),
      store,
      deliver,
    });
    const first = await publisher.publish(context(), receipt());
    const second = await publisher.publish(context(), receipt());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
    }
    // Durably persisted once; re-delivered so the UI can converge.
    expect(store).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("treats a different execution as a separate publication", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const publisher = new ToolResultPublisher({
      module: fakeModule(),
      store,
    });
    await publisher.publish(context({ executionId: "exec-1" }), receipt());
    await publisher.publish(context({ executionId: "exec-2" }), receipt());
    expect(store).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid receipt before persisting or emitting anything", async () => {
    const store = vi.fn();
    const deliver = vi.fn();
    const publisher = new ToolResultPublisher({
      module: fakeModule(),
      store,
      deliver,
    });
    const outcome = await publisher.publish(
      context(),
      // A newer schema version must be rejected, not passed through.
      { ...receipt(), schemaVersion: 2 as unknown as 1 }
    );
    expect(outcome.ok).toBe(false);
    expect(store).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("marks the registry outbox field after durable publication", async () => {
    const module = fakeModule();
    const publisher = new ToolResultPublisher({
      module,
      store: async () => undefined,
    });
    await publisher.publish(context(), receipt());
    expect(module.markReceiptPublished).toHaveBeenCalledWith(
      "out_0123456789abcdef0123456789abcdef"
    );
  });

  it("forgets a turn's guard when the turn ends", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const publisher = new ToolResultPublisher({
      module: fakeModule(),
      store,
    });
    const ctx = context();
    await publisher.publish(ctx, receipt());
    await publisher.publish(ctx, receipt());
    expect(store).toHaveBeenCalledTimes(1);
    publisher.resetTurn();
    await publisher.publish(ctx, receipt());
    expect(store).toHaveBeenCalledTimes(2);
  });
});
