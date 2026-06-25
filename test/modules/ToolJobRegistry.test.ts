import { expect } from "chai";
import { ToolJobRegistry } from "@/service/ToolJobRegistry";

// Intentional no-op stub for spawn callbacks in tests.
const noopSpawn = async (): Promise<void> => Promise.resolve();

describe("ToolJobRegistry", () => {
  it("starts a job and returns a snapshot with status running", () => {
    const reg = new ToolJobRegistry({
      maxConcurrent: 2,
      staleAfterMs: 60_000,
      pollMinIntervalMs: 1,
    });
    let release: () => void = () => {
      // placeholder, reassigned below
    };
    const pending = new Promise<void>((r) => {
      release = r;
    });
    const { jobId } = reg.start(
      "search_maps_businesses",
      { q: "dentist" },
      { conversationId: "c1", toolCallId: "tc1" },
      async () => {
        await pending;
      }
    );
    const snap = reg.getStatus(jobId);
    expect(snap.status).to.equal("running");
    expect(snap.toolName).to.equal("search_maps_businesses");
    expect(snap.conversationId).to.equal("c1");
    release();
  });

  it("rejects polls tighter than pollMinIntervalMs with rate_limited", () => {
    const reg = new ToolJobRegistry({
      maxConcurrent: 2,
      staleAfterMs: 60_000,
      pollMinIntervalMs: 1000,
    });
    const { jobId } = reg.start(
      "t",
      {},
      { conversationId: "c", toolCallId: "tc" },
      noopSpawn
    );
    const first = reg.getStatus(jobId);
    const second = reg.getStatus(jobId);
    expect(first.status).to.equal("running");
    expect(second.status).to.equal("rate_limited");
  });

  it("enforces maxConcurrent and queues overflow", async () => {
    const reg = new ToolJobRegistry({
      maxConcurrent: 1,
      staleAfterMs: 60_000,
      pollMinIntervalMs: 1,
    });
    let release1: () => void = () => {
      // placeholder, reassigned below
    };
    reg.start("t", {}, { conversationId: "c", toolCallId: "tc1" }, async () => {
      await new Promise<void>((r) => {
        release1 = r;
      });
    });
    const { jobId: j2 } = reg.start(
      "t",
      {},
      { conversationId: "c", toolCallId: "tc2" },
      noopSpawn
    );
    expect(reg.getStatus(j2).status).to.equal("queued");
    release1();
  });

  it("cancels a running job", async () => {
    const reg = new ToolJobRegistry({
      maxConcurrent: 2,
      staleAfterMs: 60_000,
      pollMinIntervalMs: 1,
    });
    let release: () => void = () => {
      // placeholder, reassigned below
    };
    const { jobId } = reg.start(
      "t",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async () => {
        await new Promise<void>((r) => {
          release = r;
        });
      }
    );
    const result = reg.cancel(jobId);
    expect(result.cancelled).to.equal(true);
    expect(reg.getStatus(jobId).status).to.equal("cancelled");
    release();
  });

  it("returns not_found for cross-conversation access", () => {
    const reg = new ToolJobRegistry({
      maxConcurrent: 2,
      staleAfterMs: 60_000,
      pollMinIntervalMs: 1,
    });
    const { jobId } = reg.start(
      "t",
      {},
      { conversationId: "c1", toolCallId: "tc" },
      noopSpawn
    );
    const snap = reg.getStatusForConversation(jobId, "other-conv");
    expect(snap.status).to.equal("not_found");
  });
});
