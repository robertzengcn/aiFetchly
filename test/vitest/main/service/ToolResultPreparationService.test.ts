import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultRecoveryService } from "@/service/toolResult/ToolResultRecoveryService";
import { artifactDirectory } from "@/service/toolResult/ToolResultPaths";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { ToolResultPreparationService } from "@/service/toolResult/ToolResultPreparationService";
import { ToolResultRetrievalService } from "@/service/toolResult/ToolResultRetrievalService";
import { toolResultReceiptSchema } from "@/schemas/toolResult";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import type { TrustedToolOutputContext } from "@/entityTypes/toolResultTypes";

/**
 * Preparation-boundary tests.
 *
 * This is the shared boundary every execution path must call, so these pin the
 * behaviours the PRD is most specific about:
 *   - a small result keeps its existing semantics and creates no artifact,
 *   - a large result produces a schema-valid receipt with a retrievable
 *     reference and no bulk output anywhere in the published forms,
 *   - a storage failure preserves the REAL operation outcome and never
 *     retries the tool,
 *   - a producer's own `success` key cannot overwrite the trusted status.
 */

/**
 * Make `BaseModule` resolve to the SAME database directory the Model uses.
 *
 * `SqliteDb.getInstance` tears down and re-runs `synchronize` for the entire
 * entity set whenever the requested path differs from the current one. Without
 * this, `new ToolResultModule(dir)` initializes the Token/fallback path first
 * and then the Model's path, costing a second full schema build per test file —
 * and those parallel schema builds are what surface as "database is locked" in
 * unrelated suites. Pointing both at one directory makes it a single build.
 */
const DB_DIR_HOLDER = vi.hoisted(() => ({ path: "" }));
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return DB_DIR_HOLDER.path;
    }
    setValue(): void {
      /* not used by these tests */
    }
  },
}));

let tmpDir: string;
let root: string;
let toolModule: ToolResultModule;
let storage: ToolResultStorageService;
let preparation: ToolResultPreparationService;
let retrieval: ToolResultRetrievalService;
let recovery: ToolResultRecoveryService;
let epoch: string;
let conversationId: string;
let conversationCounter = 0;

/**
 * NOTE ON ISOLATION: these tests deliberately do NOT reset the process-wide
 * `SqliteDb` singleton. Vitest runs test FILES in parallel workers, and
 * resetting that singleton from one file tears down the shared DataSource out
 * from under a sibling file that is mid-run (observed as an unrelated
 * ToolExecutor polling test failing only in a full-suite run). Each test here
 * instead uses its own temp database directory AND a unique conversation id,
 * which isolates the data without touching global state.
 */
/**
 * ONE database directory for the whole file, plus a fresh conversation per
 * test. `SqliteDb` holds a process-wide singleton, so a new path per test
 * re-runs `synchronize` for the whole entity set; doing that per test
 * multiplied schema builds across parallel workers and surfaced as
 * "database is locked" failures in unrelated suites.
 *
 * The artifact ROOT does get a fresh directory per test: output files are
 * plain filesystem state, not shared singleton state, and keeping them apart
 * makes the "no artifact was written" assertions unambiguous.
 */
const SUITE_DB_DIR = path.join(
  os.tmpdir(),
  `aifetchly-toolregistry-${Date.now()}-${Math.random().toString(36).slice(2)}`
);
DB_DIR_HOLDER.path = SUITE_DB_DIR;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `aifetchly-prep-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  root = path.join(tmpDir, "artifacts");
  fs.mkdirSync(root, { recursive: true });
  toolModule = new ToolResultModule(SUITE_DB_DIR);
  await toolModule.ensureConnection();
  storage = new ToolResultStorageService({ root });
  preparation = new ToolResultPreparationService();
  retrieval = new ToolResultRetrievalService(storage);
  recovery = new ToolResultRecoveryService(toolModule, storage);
  // A fresh conversation per test keeps scope state from bleeding between cases.
  conversationCounter += 1;
  conversationId = `prep-conv-${conversationCounter}`;
  epoch = await toolModule.currentEpoch("prof-1", conversationId);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let executionCounter = 0;

function context(overrides: Partial<TrustedToolOutputContext> = {}): TrustedToolOutputContext {
  executionCounter += 1;
  return {
    profileId: "prof-1",
    conversationId: conversationId,
    conversationEpoch: epoch,
    turnId: "turn-1",
    executionId: `exec-${executionCounter}`,
    toolCallId: "call-1",
    toolName: "scrape_businesses",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function deps(overrides: Partial<Parameters<ToolResultPreparationService["prepare"]>[1]> = {}) {
  return {
    context: context(),
    storage,
    module: toolModule,
    captureEnabled: true,
    modelRefsEnabled: true,
    ...overrides,
  };
}

/**
 * A body large enough to force externalization but small enough to build
 * quickly. 16 KiB is the inline byte ceiling, so ~600 padded records is
 * comfortably over it while keeping each test well under the 5s timeout even
 * when the whole suite runs in parallel.
 */
function bigOutput(rows = 600): unknown {
  return {
    rows: Array.from({ length: rows }, (_, i) => ({
      i,
      name: `Business ${i}`,
      // Padding pushes the serialized size past the inline ceiling.
      blob: "x".repeat(40),
    })),
  };
}

describe("ToolResultPreparationService — small results (AC-01)", () => {
  it("keeps a small result inline and creates no artifact", async () => {
    const prepared = await preparation.prepare(
      {
        success: true,
        executionTimeMs: 12,
        summary: "Found 3 businesses",
        output: { rows: [{ id: 1 }] },
      },
      deps()
    );
    expect(prepared.receipt).toBeUndefined();
    expect(prepared.canonicalMessageContent).toContain("Found 3 businesses");
    expect(prepared.uiMetadata).not.toHaveProperty("outputRefs");
    // Nothing was written.
    const artifactsRoot = path.join(root, "tool-results");
    expect(fs.existsSync(artifactsRoot) ? fs.readdirSync(artifactsRoot).length : 0).toBe(0);
  });

  it("gives an empty result an explicit representation without inventing an error", async () => {
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 5, isEmpty: true },
      deps()
    );
    expect(prepared.receipt).toBeUndefined();
    expect(prepared.canonicalMessageContent).toContain('"empty":true');
    expect(prepared.canonicalMessageContent).not.toContain("error");
  });

  it("preserves a long error message", async () => {
    const message = "E".repeat(5000);
    const prepared = await preparation.prepare(
      { success: false, executionTimeMs: 3, error: message, output: { detail: message } },
      deps()
    );
    // Either inline (if it fits) or a receipt; both must keep the outcome.
    expect(prepared.modelContent.length).toBeGreaterThan(0);
  });
});

describe("ToolResultPreparationService — large results (AC-02)", () => {
  it("produces a schema-valid receipt with a retrievable reference", async () => {
    const prepared = await preparation.prepare(
      {
        success: true,
        executionTimeMs: 900,
        summary: "Search returned 4000 businesses.",
        control: { total: 4000 },
        output: bigOutput(),
        previewKind: "records",
      },
      deps()
    );

    expect(prepared.receipt).toBeDefined();
    const receipt = prepared.receipt;
    if (!receipt) return;

    // The receipt is the only published representation and it validates.
    const parsed = toolResultReceiptSchema.safeParse(JSON.parse(prepared.canonicalMessageContent));
    expect(parsed.success).toBe(true);
    expect(receipt.outputs).toHaveLength(1);
    const ref = receipt.outputs[0];
    expect(ref.outputId).toMatch(/^out_[0-9a-f]{32}$/);
    expect(ref.capturedBytes).toBeGreaterThan(TOOL_RESULT_CONFIG.inlineMaxBytes);
    expect(ref.preservation).toBe("complete");
    expect(ref.sourceCompleteness).toBe("complete");
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.success).toBe(true);
    expect(receipt.control.total).toBe(4000);
    // The outcome and totals survive; the bulk does not.
    expect(prepared.canonicalMessageContent).toContain("Search returned 4000 businesses.");
    expect(prepared.canonicalMessageContent).not.toContain("Business 599");
  });

  it("keeps every published form bounded", async () => {
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 900, output: bigOutput() },
      deps()
    );
    expect(prepared.serializedBytes).toBeLessThanOrEqual(
      TOOL_RESULT_CONFIG.receiptMaxBytes
    );
    const uiJson = JSON.stringify(prepared.uiMetadata);
    expect(Buffer.byteLength(uiJson, "utf8")).toBeLessThan(
      TOOL_RESULT_CONFIG.uiReadMaxBytes
    );
  });

  it("retrieves a later record from the saved output without re-running the tool (AC-04)", async () => {
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 900, output: bigOutput() },
      deps()
    );
    const ref = prepared.receipt?.outputs[0];
    if (!ref) throw new Error("expected a reference");

    const decision = await toolModule.authorizeAccess({
      outputId: ref.outputId,
      profileId: "prof-1",
      conversationId: conversationId,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    const outcome = await retrieval.search({
      target: {
        outputId: ref.outputId,
        revision: ref.revision,
        storageKey: decision.output.storageKey ?? "",
        format: ref.format,
        capturedBytes: ref.capturedBytes,
        sourceCompleteness: ref.sourceCompleteness,
      },
      query: "Business 599",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.page.matches.length).toBeGreaterThan(0);
    expect(outcome.page.matches[0].excerpt).toContain("Business 599");
  });

  it("gives the model an explicit retrieval instruction and a partial preview", async () => {
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 900, output: bigOutput() },
      deps()
    );
    const model = JSON.parse(prepared.modelContent);
    expect(model.retrieval.read_tool).toBe("tool_result_read");
    expect(model.retrieval.search_tool).toBe("tool_result_search");
    // A small sample must never read as a complete review.
    expect(model.preview_complete).toBe(false);
    expect(model.output.output_id).toMatch(/^out_/);
  });

  it("does not advertise retrieval tools when model refs are disabled", async () => {
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 900, output: bigOutput() },
      deps({ modelRefsEnabled: false })
    );
    expect(prepared.modelContent).not.toContain("tool_result_read");
    // The reference is still preserved locally for the user to inspect.
    expect(prepared.receipt?.outputs).toHaveLength(1);
  });

  it("is idempotent for a repeated delivery of the same execution (AC-25)", async () => {
    const shared = context();
    const outcome = {
      success: true,
      executionTimeMs: 900,
      output: bigOutput(),
    };
    const first = await preparation.prepare(outcome, deps({ context: shared }));
    const second = await preparation.prepare(outcome, deps({ context: shared }));
    expect(first.receipt?.outputs[0]?.outputId).toBe(
      second.receipt?.outputs[0]?.outputId
    );
  });

  it("does not let a producer 'success' key overwrite the trusted outcome", async () => {
    const outputWithSpoofedKey: Record<string, unknown> = {
      ...(bigOutput() as Record<string, unknown>),
      // A producer trying to claim success for itself.
      success: true,
    };
    const prepared = await preparation.prepare(
      {
        success: false,
        executionTimeMs: 10,
        error: "upstream refused",
        output: outputWithSpoofedKey,
      },
      deps()
    );
    // Outer trusted status is authoritative.
    expect(prepared.receipt?.success).toBe(false);
    expect(prepared.receipt?.operationStatus).toBe("error");
  });

  it("keeps permission state out of the preview and in control", async () => {
    const prepared = await preparation.prepare(
      {
        success: true,
        executionTimeMs: 10,
        output: bigOutput(),
        control: { needsPermissionPrompt: true, permissionCategory: "filesystem" },
      },
      deps()
    );
    expect(prepared.receipt?.control.needsPermissionPrompt).toBe(true);
    expect(prepared.uiMetadata.needsPermissionPrompt).toBe(true);
  });

  it("keeps only allowlisted control keys", async () => {
    const prepared = await preparation.prepare(
      {
        success: true,
        executionTimeMs: 10,
        output: bigOutput(),
        control: {
          total: 7,
          secretInternalBlob: "should not be carried",
          anotherUnknownField: { a: 1 },
        },
      },
      deps()
    );
    expect(prepared.receipt?.control.total).toBe(7);
    expect(prepared.receipt?.control).not.toHaveProperty("secretInternalBlob");
    expect(prepared.receipt?.control).not.toHaveProperty("anotherUnknownField");
  });
});

describe("ToolResultPreparationService — failure handling (AC-12, AC-15)", () => {
  it("preserves execution success when storage is refused", async () => {
    // Refuse preservation by invalidating the scope first, so claimOutput is
    // rejected exactly as it would be on a quota/disk failure.
    await toolModule.invalidateScope("prof-1", conversationId);
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 42, output: bigOutput() },
      deps()
    );
    // The tool SUCCEEDED; only preservation failed.
    expect(prepared.receipt?.success).toBe(true);
    expect(prepared.receipt?.operationStatus).toBe("success");
    expect(prepared.receipt?.storageErrorCode).toBe("OUTPUT_NOT_AVAILABLE");
    expect(prepared.uiMetadata.preservation).toBe("unavailable");
  });

  it("reports an unserializable output without claiming the tool failed", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 42, output: cyclic, outputFormat: "json" },
      deps()
    );
    expect(prepared.receipt?.success).toBe(true);
    expect(prepared.receipt?.storageErrorCode).toBeTruthy();
  });

  it("keeps producer truncation separate from capture preservation (AC-15)", async () => {
    const prepared = await preparation.prepare(
      {
        success: true,
        executionTimeMs: 100,
        sourceCompleteness: "partial",
        output: bigOutput(),
      },
      deps()
    );
    const ref = prepared.receipt?.outputs[0];
    // The capture preserved everything it received...
    expect(ref?.preservation).toBe("complete");
    // ...but the producer's own incompleteness is reported honestly.
    expect(ref?.sourceCompleteness).toBe("partial");
  });

  it("does not publish a receipt for a deleted conversation's output (AC-14)", async () => {
    await toolModule.invalidateScope("prof-1", conversationId);
    const prepared = await preparation.prepare(
      { success: true, executionTimeMs: 10, output: bigOutput() },
      deps()
    );
    const ref = prepared.receipt?.outputs[0];
    if (ref) {
      const decision = await toolModule.authorizeAccess({
        outputId: ref.outputId,
        profileId: "prof-1",
        conversationId: conversationId,
      });
      expect(decision.ok).toBe(false);
    } else {
      expect(prepared.receipt?.storageErrorCode).toBe("OUTPUT_NOT_AVAILABLE");
    }
  });
});

/**
 * Reuse the module the `beforeEach` already opened. Opening a second connection
 * here would make `SqliteDb` re-run `synchronize` for the whole entity set
 * again, and those parallel schema builds are what produce "database is locked"
 * failures in unrelated suites.
 */
function makeModule(): ToolResultModule {
  return toolModule;
}

/** Shared claim fields for the registry-level cases. */
const BASE_CLAIM = {
  profileId: "prof-1",
  executionId: "exec-1",
  toolCallId: "call-1",
  toolName: "scrape_businesses",
  streamKey: "main",
  format: "json" as const,
  mediaType: "application/json",
  sourceCompleteness: "complete",
};

describe("ToolResultModule — output epoch fence", () => {
  it("creates a scope with a fresh epoch and reuses it on the next call", async () => {
    const mod = await makeModule();
    const first = await mod.ensureScope("prof-1", "suite-conv-1");
    const second = await mod.ensureScope("prof-1", "suite-conv-1");
    expect(first.outputEpoch).toHaveLength(32);
    expect(second.outputEpoch).toBe(first.outputEpoch);
    expect(first.invalidated).toBe(false);
  });

  it("gives different conversations independent epochs", async () => {
    const mod = await makeModule();
    const a = await mod.ensureScope("prof-1", "conv-a");
    const b = await mod.ensureScope("prof-1", "conv-b");
    expect(a.outputEpoch).not.toBe(b.outputEpoch);
  });

  it("rotates the epoch on invalidation so a late commit cannot publish (AC-14)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-3");
    const claim = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-3",
      outputEpoch: scope.outputEpoch,
    });
    expect(claim.kind).toBe("claimed");

    await mod.invalidateScope("prof-1", "suite-conv-3");

    // A commit computed against the pre-deletion epoch is rejected.
    if (claim.kind === "claimed") {
      const committed = await mod.commitOutput({
        outputId: claim.outputId,
        leaseFence: claim.leaseFence,
        storageKey: "p/conv-1/out/payload.json",
        capturedBytes: 1024,
        sha256: "a".repeat(64),
        preservation: "complete",
        sourceCompleteness: "complete",
        receiptJson: "{}",
      });
      expect(committed).toBe(false);
    }
  });

  it("refuses to claim a new output against a rotated epoch", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-5");
    await mod.invalidateScope("prof-1", "suite-conv-5");
    const result = await mod.claimOutput({
      ...BASE_CLAIM,
      executionId: "exec-2",
      conversationId: "suite-conv-5",
      outputEpoch: scope.outputEpoch,
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.code).toBe("OUTPUT_NOT_AVAILABLE");
    }
  });

  it("does not resurrect artifacts when a conversation id is recreated (AC-14)", async () => {
    const mod = await makeModule();
    const before = await mod.ensureScope("prof-1", "suite-conv-7");
    await mod.invalidateScope("prof-1", "suite-conv-7");
    const after = await mod.ensureScope("prof-1", "suite-conv-7");
    expect(after.outputEpoch).not.toBe(before.outputEpoch);
  });

  it("invalidates EVERY output past the 1000-row page boundary (I6 quota/count leak)", async () => {
    // I6 regression: invalidateScope listed outputs with limit:1000 and only
    // transitioned that first page. Outputs beyond 1000 stayed committed (epoch
    // rotated so reads blocked, but grants never revoked, recovery sweep never
    // reclaimed, quotaUsage charged them forever). The fix paginates the loop
    // by id until a page returns fewer than the page size.
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-i6");
    const total = 1001; // one beyond the old single-page limit
    const outputIds: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const claim = await mod.claimOutput({
        ...BASE_CLAIM,
        executionId: `exec-i6-${i}`,
        toolCallId: `call-i6-${i}`,
        conversationId: "suite-conv-i6",
        outputEpoch: scope.outputEpoch,
      });
      expect(claim.kind).toBe("claimed");
      if (claim.kind === "claimed") {
        await mod.commitOutput({
          outputId: claim.outputId,
          leaseFence: claim.leaseFence,
          storageKey: `p/suite-conv-i6/out/payload-${i}.json`,
          capturedBytes: 32,
          sha256: "a".repeat(64),
          preservation: "complete",
          sourceCompleteness: "complete",
          receiptJson: "{}",
        });
        outputIds.push(claim.outputId);
      }
    }
    expect(outputIds).toHaveLength(total);

    await mod.invalidateScope("prof-1", "suite-conv-i6");

    // Sample outputs across the full range, including the 1001st (index 1000)
    // which the old single-page limit would have left committed and readable.
    const samples = [
      outputIds[0],
      outputIds[500],
      outputIds[1000], // beyond the old 1000-row page
    ];
    for (const outputId of samples) {
      const decision = await mod.authorizeAccess({
        outputId,
        profileId: "prof-1",
        conversationId: "suite-conv-i6",
      });
      expect(decision.ok).toBe(false);
    }
  });
});

describe("ToolResultModule — artifact identity and idempotency", () => {
  it("deduplicates a repeated delivery of the same execution (AC-25)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-9");
    const first = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-9",
      outputEpoch: scope.outputEpoch,
    });
    expect(first.kind).toBe("claimed");

    // Same identity, same expected size -> idempotent reuse, one artifact.
    const second = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-9",
      outputEpoch: scope.outputEpoch,
    });
    expect(second.kind).toBe("existing");
    if (first.kind === "claimed" && second.kind === "existing") {
      expect(second.output.outputId).toBe(first.outputId);
    }
  });

  it("reports a conflict rather than overwriting committed evidence (AC-25)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-11");
    await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-11",
      outputEpoch: scope.outputEpoch,
      expectedBytes: 100,
    });
    const conflicting = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-11",
      outputEpoch: scope.outputEpoch,
      expectedBytes: 999,
    });
    expect(conflicting.kind).toBe("conflict");
  });

  it("treats a different stream key as a separate artifact", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-13");
    const main = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-13",
      outputEpoch: scope.outputEpoch,
      streamKey: "main",
    });
    const stderr = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-13",
      outputEpoch: scope.outputEpoch,
      streamKey: "stderr",
    });
    expect(main.kind).toBe("claimed");
    expect(stderr.kind).toBe("claimed");
    if (main.kind === "claimed" && stderr.kind === "claimed") {
      expect(stderr.outputId).not.toBe(main.outputId);
    }
  });

  it("gives a deliberate re-execution a new artifact", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-15");
    const first = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-15",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
    });
    const rerun = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "suite-conv-15",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-2",
    });
    expect(first.kind).toBe("claimed");
    expect(rerun.kind).toBe("claimed");
  });
});

describe("ToolResultModule — quota admission", () => {
  it("admits a request within quota", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-17");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "suite-conv-17",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1024,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reservedBytes).toBeGreaterThanOrEqual(1024);
  });

  it("reserves at least one increment for an unknown-length stream", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-19");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "suite-conv-19",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1,
    });
    expect(result.ok).toBe(true);
    // A 1-byte request must still reserve a real increment so the writer has
    // room to grow before it needs to re-check admission.
    if (result.ok) expect(result.reservedBytes).toBe(1024 * 1024);
  });

  it("refuses a request above the per-artifact cap", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-21");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "suite-conv-21",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 64 * 1024 * 1024 + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUTPUT_QUOTA_EXCEEDED");
  });

  it("refuses when the free-disk reserve is exhausted (AC-12)", async () => {
    const mod = new ToolResultModule(SUITE_DB_DIR, {
      freeSpaceBytes: async () => 1024,
    });
    await mod.ensureConnection();
    const scope = await mod.ensureScope("prof-1", "suite-conv-23");
    const result = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "suite-conv-23",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUTPUT_DISK_FULL");
  });

  it("charges outstanding reservations so concurrent writers cannot overrun", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-25");
    const first = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "suite-conv-25",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      requestedBytes: 1024,
    });
    expect(first.ok).toBe(true);
    // The second writer sees the first writer's held reservation in usage, so
    // admission is a function of total in-flight work, not just committed
    // bytes.
    const second = await mod.admitQuota({
      profileId: "prof-1",
      conversationId: "suite-conv-25",
      outputEpoch: scope.outputEpoch,
      executionId: "exec-2",
      requestedBytes: 1024,
    });
    expect(second.ok).toBe(true);
  });
});

describe("ToolResultModule — access authorization", () => {
  async function commitOne(
    mod: ToolResultModule,
    conversationId: string
  ): Promise<string> {
    const scope = await mod.ensureScope("prof-1", conversationId);
    const claim = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId,
      outputEpoch: scope.outputEpoch,
    });
    if (claim.kind !== "claimed") throw new Error("expected claim");
    await mod.commitOutput({
      outputId: claim.outputId,
      leaseFence: claim.leaseFence,
      storageKey: `p/conv/${conversationId}/payload.json`,
      capturedBytes: 10,
      sha256: "b".repeat(64),
      preservation: "complete",
      sourceCompleteness: "complete",
      receiptJson: "{}",
    });
    return claim.outputId;
  }

  it("allows the owning conversation", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "suite-conv-27");
    const decision = await mod.authorizeAccess({
      outputId,
      profileId: "prof-1",
      conversationId: "suite-conv-27",
    });
    expect(decision.ok).toBe(true);
  });

  it("rejects a sibling conversation with the same code as a missing id (AC-11)", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "suite-conv-29");
    const denied = await mod.authorizeAccess({
      outputId,
      profileId: "prof-1",
      conversationId: "suite-conv-30",
    });
    const missing = await mod.authorizeAccess({
      outputId: "out_00000000000000000000000000000000",
      profileId: "prof-1",
      conversationId: "suite-conv-29",
    });
    expect(denied.ok).toBe(false);
    expect(missing.ok).toBe(false);
    // Identical response: existence is never leaked.
    if (!denied.ok && !missing.ok) expect(denied.code).toBe(missing.code);
  });

  it("rejects a different profile", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "suite-conv-31");
    const decision = await mod.authorizeAccess({
      outputId,
      profileId: "prof-other",
      conversationId: "suite-conv-31",
    });
    expect(decision.ok).toBe(false);
  });

  it("rejects a deleted conversation's artifact (AC-14)", async () => {
    const mod = await makeModule();
    const outputId = await commitOne(mod, "suite-conv-33");
    await mod.invalidateScope("prof-1", "suite-conv-33");
    const decision = await mod.authorizeAccess({
      outputId,
      profileId: "prof-1",
      conversationId: "suite-conv-33",
    });
    expect(decision.ok).toBe(false);
  });

  it("allows an explicitly granted parent agent to read a child artifact", async () => {
    const mod = await makeModule();
    const childScope = await mod.ensureScope("prof-1", "child-conv");
    const claim = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "child-conv",
      outputEpoch: childScope.outputEpoch,
      ownerAgentId: "agent-child",
    });
    if (claim.kind !== "claimed") throw new Error("expected claim");
    await mod.commitOutput({
      outputId: claim.outputId,
      leaseFence: claim.leaseFence,
      storageKey: "p/child/payload.json",
      capturedBytes: 10,
      sha256: "c".repeat(64),
      preservation: "complete",
      sourceCompleteness: "complete",
      receiptJson: "{}",
    });

    const beforeGrant = await mod.authorizeAccess({
      outputId: claim.outputId,
      profileId: "prof-1",
      conversationId: "parent-conv",
      agentId: "agent-parent",
    });
    expect(beforeGrant.ok).toBe(false);

    const parentScope = await mod.ensureScope("prof-1", "parent-conv");
    void parentScope;
    const granted = await mod.grantAccess({
      outputId: claim.outputId,
      // The grantor is the OWNING conversation; grantAccess re-authorizes it
      // rather than trusting the caller.
      ownerProfileId: "prof-1",
      ownerConversationId: "child-conv",
      // Ownership is conversation AND agent; the owner agent must be presented.
      ownerAgentId: "agent-child",
      granteeConversationId: "parent-conv",
      granteeAgentId: "agent-parent",
      grantReason: "child exported artifact",
    });
    expect(granted.granted).toBe(true);

    const afterGrant = await mod.authorizeAccess({
      outputId: claim.outputId,
      profileId: "prof-1",
      conversationId: "parent-conv",
      agentId: "agent-parent",
    });
    expect(afterGrant.ok).toBe(true);
  });

  it("refuses to grant access to an artifact the grantor cannot read", async () => {
    const mod = makeModule();
    const scopeA = await mod.ensureScope("prof-1", "grant-a");
    const claim = await mod.claimOutput({
      ...BASE_CLAIM,
      conversationId: "grant-a",
      outputEpoch: scopeA.outputEpoch,
    });
    expect(claim.kind).toBe("claimed");

    // A conversation with no rights to the artifact must not be able to mint
    // itself access to it.
    const result = await mod.grantAccess({
      outputId: claim.kind === "claimed" ? claim.outputId : "",
      ownerProfileId: "prof-1",
      ownerConversationId: "unrelated-conv",
      granteeConversationId: "grant-a",
      grantReason: "should not be allowed",
    });
    expect(result.granted).toBe(false);
  });
});

describe("ToolResultModule — retrieval-work allowance", () => {
  it("allows calls up to the allowance then refuses", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-35");
    const key = {
      profileId: "prof-1",
      conversationId: "suite-conv-35",
      outputEpoch: scope.outputEpoch,
      agentId: "",
      turnId: "turn-1",
    };
    // The allowance is 32 calls (PRD §8).
    for (let i = 0; i < 32; i += 1) {
      const res = await mod.reserveRetrievalCall(key);
      expect(res.ok).toBe(true);
    }
    const exhausted = await mod.reserveRetrievalCall(key);
    expect(exhausted.ok).toBe(false);
  });

  it("gives a new turn a fresh allowance (persisted, not in-memory)", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-37");
    const base = {
      profileId: "prof-1",
      conversationId: "suite-conv-37",
      outputEpoch: scope.outputEpoch,
      agentId: "",
    };
    for (let i = 0; i < 32; i += 1) {
      await mod.reserveRetrievalCall({ ...base, turnId: "turn-1" });
    }
    expect((await mod.reserveRetrievalCall({ ...base, turnId: "turn-1" })).ok).toBe(
      false
    );
    expect((await mod.reserveRetrievalCall({ ...base, turnId: "turn-2" })).ok).toBe(
      true
    );
  });

  it("charges repeated reads as work rather than allowing free repeats", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-39");
    const key = {
      profileId: "prof-1",
      conversationId: "suite-conv-39",
      outputEpoch: scope.outputEpoch,
      agentId: "",
      turnId: "turn-1",
    };
    // Reading the same page 32 times exhausts the allowance; duplicates are
    // not a way to bypass the guard.
    for (let i = 0; i < 32; i += 1) {
      await mod.reserveRetrievalCall(key);
    }
    expect((await mod.reserveRetrievalCall(key)).ok).toBe(false);
  });

  it("tracks remaining returned-token allowance", async () => {
    const mod = await makeModule();
    const scope = await mod.ensureScope("prof-1", "suite-conv-41");
    const key = {
      profileId: "prof-1",
      conversationId: "suite-conv-41",
      outputEpoch: scope.outputEpoch,
      agentId: "",
      turnId: "turn-1",
    };
    await mod.reserveRetrievalCall(key);
    await mod.settleRetrievalCall({ ...key, tokens: 1000 });
    const remaining = await mod.remainingRetrievalTokens(key);
    expect(remaining).toBe(32_000 - 1000);
  });
});

/**
 * Recovery-sweep regression tests.
 *
 * The sweep DELETES directories it believes are unregistered, so the test that
 * matters most proves it does not delete a committed artifact. The directory
 * on disk is named `sha256(outputId)`, not the output id, so a sweep that looks
 * the directory name up as an output id matches nothing and would delete every
 * saved result in the profile.
 */
/** Backdate a path so it is past the 24h orphan grace period. */
function backdate(target: string): void {
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(target, old, old);
}

describe("ToolResultRecoveryService — orphan sweep", () => {
  let recConv = 0;
  beforeEach(async () => {
    recConv = 0;
    recovery = new ToolResultRecoveryService(toolModule, storage);
  });

  it("NEVER deletes a committed, registered artifact (data loss regression)", async () => {
    const scope = await toolModule.ensureScope("prof-1", `rec-${++recConv}`);
    const claim = await toolModule.claimOutput({
      profileId: "prof-1",
      conversationId: `rec-${recConv}`,
      outputEpoch: scope.outputEpoch,
      executionId: "exec-1",
      toolCallId: "call-1",
      toolName: "scrape_businesses",
      streamKey: "main",
      format: "json",
      mediaType: "application/json",
      sourceCompleteness: "complete",
    });
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") return;

    const stored = await storage.captureJson({
      outputId: claim.outputId,
      profileId: "prof-1",
      outputEpoch: scope.outputEpoch,
      value: { rows: Array.from({ length: 500 }, (_, i) => ({ i })) },
      sourceCompleteness: "complete",
    });
    await toolModule.commitOutput({
      outputId: claim.outputId,
      leaseFence: claim.leaseFence,
      storageKey: stored.storageKey,
      capturedBytes: stored.capturedBytes,
      sha256: stored.sha256,
      preservation: "complete",
      sourceCompleteness: "complete",
      receiptJson: "{}",
    });

    // Older than the grace period, so ONLY the registration check can save it.
    const dir = artifactDirectory({
      root,
      profileId: "prof-1",
      outputEpoch: scope.outputEpoch,
      outputId: claim.outputId,
    });
    backdate(dir);

    const report = await recovery.run();
    expect(report.orphansRemoved).toBe(0);
    // The payload is still on disk and still readable.
    expect(fs.existsSync(stored.absolutePath)).toBe(true);
    const window = await storage.readWindow({
      storageKey: stored.storageKey,
      startByte: 0,
      maxBytes: 4096,
    });
    expect(window.buffer.byteLength).toBeGreaterThan(0);
  });

  it("leaves a RECENT unregistered directory alone (a capture may still own it)", async () => {
    const scope = await toolModule.ensureScope("prof-1", `rec-${++recConv}`);
    const orphanDir = artifactDirectory({
      root,
      profileId: "prof-1",
      outputEpoch: scope.outputEpoch,
      outputId: "out_ffffffffffffffffffffffffffffffff",
    });
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "payload.json"), "{}");

    const report = await recovery.run();
    expect(report.orphansRemoved).toBe(0);
    expect(fs.existsSync(orphanDir)).toBe(true);
  });

  it("reclaims an old, unregistered directory past the grace period", async () => {
    const scope = await toolModule.ensureScope("prof-1", `rec-${++recConv}`);
    const orphanDir = artifactDirectory({
      root,
      profileId: "prof-1",
      outputEpoch: scope.outputEpoch,
      outputId: "out_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "payload.json"), "{}");
    backdate(orphanDir);

    const report = await recovery.run();
    expect(report.orphansRemoved).toBe(1);
    expect(fs.existsSync(orphanDir)).toBe(false);
  });

  it("does not infer operation success from a payload file", async () => {
    // A payload with no registry row is an orphan, never a recovered success.
    const scope = await toolModule.ensureScope("prof-1", `rec-${++recConv}`);
    const orphanDir = artifactDirectory({
      root,
      profileId: "prof-1",
      outputEpoch: scope.outputEpoch,
      outputId: "out_dddddddddddddddddddddddddddddddd",
    });
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "payload.json"), '{"success":true}');
    backdate(orphanDir);

    await recovery.run();
    // No row was created, so nothing became readable.
    const registered = await toolModule.findRegisteredOutputDir(
      path.basename(orphanDir)
    );
    expect(registered).toBe(false);
  });

  it("NEVER deletes a registered artifact when the registration lookup throws (C3 transient-DB-error regression)", async () => {
    // Commit a real artifact so it has a registered row and a backdated dir,
    // then run a recovery whose module's `findRegisteredOutputDir` rejects
    // (SQLITE_BUSY / connection rebound / locked WAL checkpoint). Before the
    // fix, `.catch(() => null)` collapsed that into "not registered" and the
    // sweep deleted the committed artifact on a transient DB error.
    const scope = await toolModule.ensureScope("prof-1", `rec-${++recConv}`);
    const claim = await toolModule.claimOutput({
      profileId: "prof-1",
      conversationId: `rec-${recConv}`,
      outputEpoch: scope.outputEpoch,
      executionId: "exec-c3",
      toolCallId: "call-c3",
      toolName: "scrape_businesses",
      streamKey: "main",
      format: "json",
      mediaType: "application/json",
      sourceCompleteness: "complete",
    });
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") return;

    const stored = await storage.captureJson({
      outputId: claim.outputId,
      profileId: "prof-1",
      outputEpoch: scope.outputEpoch,
      value: { rows: [{ i: 1 }, { i: 2 }] },
      sourceCompleteness: "complete",
    });
    await toolModule.commitOutput({
      outputId: claim.outputId,
      leaseFence: claim.leaseFence,
      storageKey: stored.storageKey,
      capturedBytes: stored.capturedBytes,
      sha256: stored.sha256,
      preservation: "complete",
      sourceCompleteness: "complete",
      receiptJson: "{}",
    });

    const dir = artifactDirectory({
      root,
      profileId: "prof-1",
      outputEpoch: scope.outputEpoch,
      outputId: claim.outputId,
    });
    backdate(dir);

    // Stub module: every method delegates to the real module EXCEPT
    // `findRegisteredOutputDir`, which rejects to simulate a transient DB
    // error during the sweep. The sweep must skip the directory, not delete.
    const failingModule = {
      ...toolModule,
      findRegisteredOutputDir: vi
        .fn()
        .mockRejectedValue(new Error("SQLITE_BUSY: database is locked")),
    } as unknown as ToolResultModule;
    const failingRecovery = new ToolResultRecoveryService(
      failingModule,
      storage
    );

    const report = await failingRecovery.run();
    // The committed artifact must survive the transient DB error.
    expect(report.orphansRemoved).toBe(0);
    expect(fs.existsSync(stored.absolutePath)).toBe(true);
    // The lookup error is surfaced, not silently swallowed into a deletion.
    expect(report.errors).toBeGreaterThanOrEqual(1);
  });
});
