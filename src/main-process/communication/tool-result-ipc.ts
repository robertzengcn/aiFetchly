import * as fs from "node:fs";
import {
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
import { getNativeDialogService } from "@/service/dialogs/NativeDialogServiceProvider";
import {
  AI_TOOL_RESULT_EXPORT,
  AI_TOOL_RESULT_GET,
  AI_TOOL_RESULT_READ,
  AI_TOOL_RESULT_SEARCH,
} from "@/config/channellist";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import { isToolOutputUiEnabled } from "@/config/featureFlags";
import { toolResultMetrics } from "@/service/toolResult/ToolResultMetrics";
import {
  toolResultExportIpcSchema,
  toolResultGetIpcSchema,
  toolResultReadIpcSchema,
} from "@/schemas/ipc/toolResult";
import { lazySchema } from "@/utils/lazySchema";
import { ToolResultModule } from "@/modules/ToolResultModule";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { ToolResultRetrievalService } from "@/service/toolResult/ToolResultRetrievalService";
import {
  toolResultIntegrityGate,
  verifyArtifactIntegrity,
} from "@/service/toolResult/ToolResultIntegrityGate";
import { getToolResultStorageRoot } from "@/service/toolResult/toolResultRoot";
import type { ToolOutputPublicDescriptor } from "@/entityTypes/toolResultTypes";

/**
 * IPC surface for preserved tool outputs (technical design §11.1).
 *
 * Every handler here is registered through `registerAiValidatedHandler`, which
 * enforces the project rule that an AI-feature handler checks the AI gate
 * BEFORE parsing the request. Saved data remains durable when AI is disabled;
 * this surface is simply closed.
 *
 * Two properties the design insists on and that shape this file:
 *   - a valid output id is a REFERENCE, not authorization. Each handler
 *     re-authorizes against the live epoch/owner/grant before touching bytes,
 *     and missing vs unauthorized return the SAME code so existence is never
 *     leaked.
 *   - NO RAW STORAGE PATH and NO RAW PAYLOAD crosses this boundary. Responses
 *     are plain serializable DTOs with bounded error strings, and export
 *     streams from the main process instead of returning bytes to the renderer.
 *
 * Envelope contract: handlers return RAW DTO data (or `null` for the optional
 * get descriptor). `registerAiValidatedHandler` → `dispatchValidated` wraps
 * the return value as `data` in the `{status:true,msg:"ok",data}` envelope the
 * renderer's `windowInvoke` unwraps. A denial is signaled by THROWING —
 * `dispatchValidated` catches, sets `msg` to the error's message (the machine
 * code), and returns `{status:false,msg,data:null}`, which `windowInvoke`
 * surfaces as a thrown `Error(code)`. Returning a `{status:false,...}` object
 * would be double-wrapped as `{status:true,msg:"ok",data:{status:false,...}}`
 * (an error misread as success); returning a `{status:true,...}` object would
 * nest the real page one level too deep (`data.data` instead of `data`).
 */
function deny(code: string): never {
  // Throwing (not returning) is what makes the wrapper produce a `status:false`
  // envelope. `never` lets call sites write `return deny(code)` in any position.
  throw new Error(code);
}

export function registerToolResultIpcHandlers(): void {
  registerAiValidatedHandler(
    AI_TOOL_RESULT_GET,
    lazySchema(() => toolResultGetIpcSchema),
    async (input): Promise<ToolOutputPublicDescriptor> => {
      const module = new ToolResultModule();
      const decision = await module.authorizeAccess({
        outputId: input.outputId,
        profileId: "default",
        conversationId: input.conversationId,
      });
      if (!decision.ok) deny(decision.code);
      const row = decision.output;
      return {
        // Resolved HERE, in main, so the renderer never has to read the rollout
        // flag itself. `ui` off withholds only the paged viewer; bounded
        // content and export are unaffected.
        viewerEnabled: isToolOutputUiEnabled(),
        outputId: row.outputId,
        toolName: row.toolName,
        format: (row.outputFormat as ToolOutputPublicDescriptor["format"]) ?? "text",
        mediaType: row.mediaType,
        capturedBytes: row.capturedBytes,
        originalBytes: row.originalBytes ?? undefined,
        preservation: row.preservation === "partial" ? "partial" : "complete",
        sourceCompleteness:
          (row.sourceCompleteness as ToolOutputPublicDescriptor["sourceCompleteness"]) ??
          "unknown",
        incompleteReason: row.failureCode ?? undefined,
        state: (row.outputState as ToolOutputPublicDescriptor["state"]) ?? "committed",
        recordCount: row.recordCount ?? undefined,
      };
    }
  );

  registerAiValidatedHandler(
    AI_TOOL_RESULT_READ,
    lazySchema(() => toolResultReadIpcSchema),
    async (input): Promise<Record<string, unknown>> => {
      // A `query` on this channel means the renderer asked for search; keeping
      // one validated schema avoids a second near-identical payload shape.
      if (input.query !== undefined) {
        return await runSearch(input);
      }
      return await runRead(input);
    }
  );

  registerAiValidatedHandler(
    AI_TOOL_RESULT_SEARCH,
    lazySchema(() => toolResultReadIpcSchema),
    async (input): Promise<Record<string, unknown>> => {
      if (input.query === undefined) {
        deny("INVALID_OUTPUT_ARGUMENTS");
      }
      return await runSearch(input);
    }
  );

  registerAiValidatedHandler(
    AI_TOOL_RESULT_EXPORT,
    lazySchema(() => toolResultExportIpcSchema),
    async (input): Promise<Record<string, unknown>> => {
      const module = new ToolResultModule();
      const decision = await module.authorizeAccess({
        outputId: input.outputId,
        profileId: "default",
        conversationId: input.conversationId,
      });
      if (!decision.ok) deny(decision.code);
      const row = decision.output;
      if (!row.storageKey) deny("OUTPUT_NOT_AVAILABLE");

      const storage = new ToolResultStorageService({
        root: getToolResultStorageRoot(),
      });
      // The user must explicitly choose a destination. Cancelling is a normal
      // outcome, not an error. The dialog comes through the application
      // service (design §11) so the E2E bootstrap can substitute it.
      const dialogService = await getNativeDialogService();
      const dialogResult = await dialogService.showSaveDialog({
        title: "Export tool result",
        defaultPath: `${row.outputId}.${row.outputFormat === "json" ? "json" : "txt"}`,
      });
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { status: "cancelled" };
      }
      const result = { canceled: false, filePath: dialogResult.filePaths[0] };

      // RE-AUTHORIZE AFTER THE DIALOG. The authorization above proves the
      // caller may read the output; it does not survive the seconds the modal
      // spent open. The user can clear the conversation, which rotates the
      // output epoch, while the dialog is up. Without this second check the
      // export would happily copy bytes the user just asked to delete.
      const confirmed = await module.authorizeAccess({
        outputId: input.outputId,
        profileId: "default",
        conversationId: input.conversationId,
      });
      if (!confirmed.ok) deny(confirmed.code);
      // The epoch must be the SAME one, not merely still valid: a rotate +
      // re-create cycle must not let a new artifact inherit an in-flight
      // export that was authorized against the previous epoch.
      if (confirmed.output.outputEpoch !== row.outputEpoch) {
        deny("OUTPUT_CHANGED");
      }

      // VERIFY INTEGRITY BEFORE HANDING OVER BYTES. This is the boundary
      // where the output is presented to the user as the evidence the
      // registry claims it is, so it is where the stored checksum must
      // actually be checked. `checksumOf` previously had no caller at all,
      // so a corrupted payload was exported as though it were intact.
      //
      // The I/O (manifest read + artifact stream for the hash) is wrapped so
      // an unexpected throw becomes a generic integrity denial; the verdict
      // branch is OUTSIDE the try so a `deny(code)` throw is not recaught and
      // rewritten (today both codes coincide, but the structure must not
      // depend on that coincidence).
      let integrity;
      try {
        integrity = await verifyArtifactIntegrity({
          storage,
          storageKey: row.storageKey,
          manifest: await storage.readManifest(
            row.profileId,
            row.outputEpoch,
            row.outputId
          ),
        });
      } catch {
        deny("OUTPUT_INTEGRITY_FAILED");
      }
      if (!integrity.ok) {
        toolResultMetrics.record("capture.integrity_failed");
        deny(integrity.code);
      }

      try {
        await streamToFile(
          storage,
          row.storageKey,
          result.filePath,
          // Stop promptly if the scope is invalidated mid-copy.
          async () => {
            const stillAuthorized = await module.authorizeAccess({
              outputId: input.outputId,
              profileId: "default",
              conversationId: input.conversationId,
            });
            if (
              !stillAuthorized.ok ||
              stillAuthorized.output.outputEpoch !== row.outputEpoch
            ) {
              throw new Error("output scope was invalidated during export");
            }
          }
        );
      } catch (err) {
        // `streamToFile` throws `Error("output scope was invalidated during
        // export")` when the scope is revoked mid-copy — surface that as the
        // scope's own denial code rather than a generic write failure; any
        // other write error is reported without leaking an internal path.
        if (err instanceof Error && err.message.includes("invalidated")) {
          deny("OUTPUT_CHANGED");
        }
        deny("OUTPUT_WRITE_FAILED");
      }
      return { status: "exported" };
    }
  );
}

/** Read one bounded page for the renderer. */
async function runRead(
  input: { conversationId: string; outputId: string; cursor?: string; page?: number }
): Promise<Record<string, unknown>> {
  const module = new ToolResultModule();
  const decision = await module.authorizeAccess({
    outputId: input.outputId,
    profileId: "default",
    conversationId: input.conversationId,
  });
  if (!decision.ok) deny(decision.code);
  const row = decision.output;
  if (!row.storageKey) deny("OUTPUT_NOT_AVAILABLE");

  const storage = new ToolResultStorageService({ root: getToolResultStorageRoot() });
  const retrieval = new ToolResultRetrievalService(storage);
  // Forward the manifest subset so the read path can run the cheap identity+
  // size check on open (technical design §8.4). A missing manifest is passed
  // as absent: pre-manifest artifacts are unverified, not corrupt.
  const manifest = await storage.readManifest(row.profileId, row.outputEpoch, row.outputId);
  // Full checksum gate (T10): the size check above catches truncation/growth
  // cheaply, but it cannot catch an in-place byte edit. The gate streams the
  // whole artifact ONCE per process (cached by storageKey) and compares to
  // the recorded SHA-256. Prefer the row's `sha256` over the manifest-file
  // value so the common case needs no manifest I/O.
  const verdict = await toolResultIntegrityGate.verify({
    storage,
    storageKey: row.storageKey,
    manifest: row.sha256
      ? { sha256: row.sha256, capturedBytes: row.capturedBytes }
      : manifest
        ? { sha256: manifest.sha256, capturedBytes: manifest.capturedBytes }
        : null,
  });
  if (!verdict.ok) {
    toolResultMetrics.record("capture.integrity_failed");
    deny(verdict.code);
  }
  // First-page p95 is an NFR-04 target (≤200 ms). Measure the read itself
  // (authorization + integrity gate already happened above). `detail: "ui"`
  // distinguishes the renderer path from the model-tool path (T17).
  const readStartedAt = performance.now();
  const outcome = await retrieval.read({
    target: {
      outputId: row.outputId,
      revision: row.revision,
      storageKey: row.storageKey,
      format: (row.outputFormat as "text" | "json" | "jsonl" | "binary") ?? "text",
      capturedBytes: row.capturedBytes,
      sourceCompleteness:
        (row.sourceCompleteness as "complete" | "partial" | "unknown") ?? "unknown",
      ...(manifest
        ? { manifest: { sha256: manifest.sha256, capturedBytes: manifest.capturedBytes } }
        : {}),
    },
    cursor: input.cursor,
    // The renderer uses the UI byte budget, which never exceeds the UI cap.
    maxBytes: Math.min(input.page ?? TOOL_RESULT_CONFIG.uiReadMaxBytes, TOOL_RESULT_CONFIG.uiReadMaxBytes),
  });
  toolResultMetrics.recordLatency(
    "retrieval.latency_ms",
    performance.now() - readStartedAt,
    "ui"
  );
  if (!outcome.ok) deny(outcome.code);
  return { ...outcome.page };
}

/** Run a literal search for the renderer. */
async function runSearch(
  input: { conversationId: string; outputId: string; cursor?: string; query?: string }
): Promise<Record<string, unknown>> {
  const module = new ToolResultModule();
  const decision = await module.authorizeAccess({
    outputId: input.outputId,
    profileId: "default",
    conversationId: input.conversationId,
  });
  if (!decision.ok) deny(decision.code);
  const row = decision.output;
  if (!row.storageKey) deny("OUTPUT_NOT_AVAILABLE");

  const storage = new ToolResultStorageService({ root: getToolResultStorageRoot() });
  const retrieval = new ToolResultRetrievalService(storage);
  // Same manifest forwarding as `runRead` so search is gated identically.
  const manifest = await storage.readManifest(row.profileId, row.outputEpoch, row.outputId);
  // Same full-checksum gate as `runRead` (T10).
  const verdict = await toolResultIntegrityGate.verify({
    storage,
    storageKey: row.storageKey,
    manifest: row.sha256
      ? { sha256: row.sha256, capturedBytes: row.capturedBytes }
      : manifest
        ? { sha256: manifest.sha256, capturedBytes: manifest.capturedBytes }
        : null,
  });
  if (!verdict.ok) {
    toolResultMetrics.record("capture.integrity_failed");
    deny(verdict.code);
  }
  // Same latency measurement as `runRead`; `detail: "ui"` marks the renderer
  // path (T17).
  const searchStartedAt = performance.now();
  const outcome = await retrieval.search({
    target: {
      outputId: row.outputId,
      revision: row.revision,
      storageKey: row.storageKey,
      format: (row.outputFormat as "text" | "json" | "jsonl" | "binary") ?? "text",
      capturedBytes: row.capturedBytes,
      sourceCompleteness:
        (row.sourceCompleteness as "complete" | "partial" | "unknown") ?? "unknown",
      ...(manifest
        ? { manifest: { sha256: manifest.sha256, capturedBytes: manifest.capturedBytes } }
        : {}),
    },
    query: input.query ?? "",
    cursor: input.cursor,
  });
  toolResultMetrics.recordLatency(
    "retrieval.latency_ms",
    performance.now() - searchStartedAt,
    "ui"
  );
  if (!outcome.ok) deny(outcome.code);
  return { ...outcome.page };
}

/**
 * Verify one committed artifact against its stored manifest checksum.
 *
 * Re-exported from `ToolResultIntegrityGate` so the export handler and tests
 * that imported it from the IPC module keep working. The implementation now
 * lives in the gate module alongside the cached read-path gate (T10): the
 * same compare logic serves export AND read/search, so a corrupted artifact
 * is denied at every boundary that claims trust, not just export.
 *
 * `manifest` is the value previously read by `readManifest` (or the row's
 * `sha256`/`capturedBytes`). A missing manifest is NOT treated as corruption:
 * an artifact may legitimately predate manifests, and the caller decides
 * whether that is acceptable.
 */
export { verifyArtifactIntegrity } from "@/service/toolResult/ToolResultIntegrityGate";


/**
 * Stream an artifact to a user-chosen destination with bounded buffers.
 *
 * The whole payload never passes through the renderer. `onChunk` is invoked
 * between chunks so a long copy can stop promptly when the conversation is
 * cleared mid-export; the copy is abandoned rather than completed.
 */
async function streamToFile(
  storage: ToolResultStorageService,
  storageKey: string,
  destination: string,
  onChunk?: () => Promise<void>
): Promise<void> {
  const { assertReadableRegularFile } = await import(
    "@/service/toolResult/ToolResultPaths"
  );
  const real = await assertReadableRegularFile(storage.getRoot(), storageKey);
  const stream = fs.createReadStream(real, { highWaterMark: 64 * 1024 });
  const out = fs.createWriteStream(destination);
  try {
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      out.on("error", reject);
      out.on("finish", resolve);
      stream.on("data", () => {
        // Re-check between chunks so an invalidated scope aborts promptly.
        if (!onChunk) return;
        void onChunk().catch(reject);
      });
      stream.pipe(out);
    });
  } catch (error: unknown) {
    // Do not leave a truncated file behind as if it were a complete export.
    out.destroy();
    await fs.promises.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}
