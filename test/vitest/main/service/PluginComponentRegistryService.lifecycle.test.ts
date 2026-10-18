/**
 * H5 — plugin lifecycle quiescence (`stopActiveJobsForPlugin`).
 *
 * Covers: admission seal refusal while teardown is in flight, abort +
 * bounded-await of the plugin's running MCP jobs, and the retryable
 * cleanup-timeout error.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  ToolJobRegistry,
  AdmissionSealedError,
  type ToolJobSpawnHandle,
  setDefaultToolJobRegistry,
} from "@/service/ToolJobRegistry";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";

const GRACE = 500;

/** Continuation that settles on abort — mirrors the MCP spawn wrapper. */
function abortResponsiveContinuation(handle: ToolJobSpawnHandle): Promise<never> {
  return new Promise((_resolve, reject) => {
    const onAbort = () => reject(new Error("job aborted"));
    if (handle.signal.aborted) {
      onAbort();
      return;
    }
    handle.signal.addEventListener("abort", onAbort, { once: true });
    handle.onSettled(() => {
      handle.signal.removeEventListener("abort", onAbort);
    });
  });
}

function spawnHangingJob(
  registry: ToolJobRegistry,
  toolName: string,
  toolCallId: string
): { jobId: string; resolve: (value: unknown) => void } {
  let resolveHandle: (value: unknown) => void = () => undefined;
  const { jobId } = registry.start(
    toolName,
    {},
    { conversationId: "c", toolCallId },
    async (handle) => {
      resolveHandle = handle.resolve;
      return abortResponsiveContinuation(handle);
    }
  );
  return { jobId, resolve: resolveHandle };
}

describe("PluginComponentRegistryService.stopActiveJobsForPlugin", () => {
  afterEach(() => {
    setDefaultToolJobRegistry(new ToolJobRegistry());
  });

  it("aborts and quiesces only the plugin's own jobs before returning", async () => {
    const registry = new ToolJobRegistry();
    setDefaultToolJobRegistry(registry);
    const hangingA = spawnHangingJob(
      registry,
      "mcp__yellow-pages-scraper-plugin__scrape",
      "tc-a"
    );
    const hangingB = spawnHangingJob(
      registry,
      "mcp__yellow-pages-scraper-plugin__export",
      "tc-b"
    );
    const otherPlugin = spawnHangingJob(
      registry,
      "mcp__other-plugin__scrape",
      "tc-c"
    );

    await expect(
      PluginComponentRegistryService.stopActiveJobsForPlugin(
        "yellow-pages-scraper-plugin",
        GRACE
      )
    ).resolves.toBeUndefined();

    // Only THIS plugin's jobs were targeted.
    expect(registry.isJobActive(hangingA.jobId)).toBe(false);
    expect(registry.isJobActive(hangingB.jobId)).toBe(false);
    expect(registry.isJobActive(otherPlugin.jobId)).toBe(true);
    expect(
      registry.listActiveJobIdsByToolPrefix("mcp__other-plugin__")
    ).toEqual([otherPlugin.jobId]);
  });

  it("refuses new admission for the plugin's namespace while sealed", async () => {
    const registry = new ToolJobRegistry();
    setDefaultToolJobRegistry(registry);
    spawnHangingJob(registry, "mcp__my-plugin__scrape", "tc-run");

    // The helper seals admission synchronously before its first await, so
    // a concurrent start (not awaited here) observes the seal on return.
    const quiescence = PluginComponentRegistryService.stopActiveJobsForPlugin(
      "my-plugin",
      GRACE
    );

    expect(() =>
      registry.start(
        "mcp__my-plugin__scrape",
        {},
        { conversationId: "c", toolCallId: "tc-new" },
        () => new Promise(() => undefined)
      )
    ).toThrow(AdmissionSealedError);

    await expect(quiescence).resolves.toBeUndefined();
  });

  it("throws a retryable cleanup error when jobs outlive the grace window", async () => {
    const registry = new ToolJobRegistry();
    setDefaultToolJobRegistry(registry);
    // A continuation that ignores abort signals entirely — the registry
    // settle-grace is the only cleanup path, so a tiny caller grace makes
    // the helper report the failure honestly.
    registry.start(
      "mcp__sticky-plugin__scrape",
      {},
      { conversationId: "c", toolCallId: "tc-run" },
      () => new Promise(() => undefined)
    );
    await expect(
      PluginComponentRegistryService.stopActiveJobsForPlugin("sticky-plugin", 30)
    ).rejects.toThrow(/AI_FETCHLY_PLUGIN_CLEANUP_TIMEOUT/i);
  });
});
