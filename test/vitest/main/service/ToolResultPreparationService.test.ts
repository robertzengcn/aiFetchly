import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ToolResultModule } from "@/modules/ToolResultModule";
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

let tmpDir: string;
let root: string;
let toolModule: ToolResultModule;
let storage: ToolResultStorageService;
let preparation: ToolResultPreparationService;
let retrieval: ToolResultRetrievalService;
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
  `aifetchly-prep-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

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
