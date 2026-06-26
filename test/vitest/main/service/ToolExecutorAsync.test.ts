import { describe, it, expect } from "vitest";
import { getDefaultToolJobRegistry } from "@/service/ToolJobRegistry";
import {
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("async dispatch contract", () => {
  it("resolveTimeoutMs returns null for async (signal for async dispatch)", () => {
    expect(resolveTimeoutMs("async")).to.equal(null);
    expect(resolveTimeoutMs("browser")).to.equal(240_000);
  });

  it("the default registry starts and returns a job_id", async () => {
    const reg = getDefaultToolJobRegistry();
    const { jobId } = reg.start(
      "x",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async (handle) => handle.resolve({ ok: true })
    );
    expect(jobId).to.be.a("string");
    await new Promise((r) => setTimeout(r, 10));
    const snap = reg.getStatus(jobId);
    expect(snap.status === "completed" || snap.status === "running").to.equal(
      true
    );
  });

  it("inferTimeoutClassByName still maps search_maps_businesses to browser by default", () => {
    // The name-based fallback remains 'browser'; the skill-level resolver
    // is what can promote it to 'async' based on args.
    expect(inferTimeoutClassByName("search_maps_businesses")).to.equal(
      "browser"
    );
  });

  it("a resolveTimeoutClass resolver can promote to async based on args", () => {
    // Mirrors the resolver installed on search_maps_businesses.
    const resolver = (args: Record<string, unknown>) =>
      (args.max_results as number) > 20 || args.include_website === true
        ? "async"
        : "browser";

    expect(resolver({ max_results: 50 })).to.equal("async");
    expect(resolver({ max_results: 10, include_website: true })).to.equal(
      "async"
    );
    expect(resolver({ max_results: 10, include_website: false })).to.equal(
      "browser"
    );

    // When the resolver returns 'async', resolveTimeoutMs yields null,
    // which is the signal executeToolWithTimeout uses to dispatch async.
    expect(resolveTimeoutMs(resolver({ max_results: 50 }) as never)).to.equal(
      null
    );
  });
});
