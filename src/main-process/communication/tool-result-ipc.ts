import { dialog } from "electron";
import * as fs from "node:fs";
import {
  registerAiValidatedHandler,
} from "@/main-process/communication/_shared/registerValidatedHandler";
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
import type { CommonMessage } from "@/entityTypes/commonType";
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
 */

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

/**
 * A denied response carries the machine code in `msg` and NO data. The
 * renderer surfaces it as a translated message; the raw code never reaches the
 * UI as prose, and an unauthorized read is indistinguishable from a missing
 * one so existence is not leaked.
 */
function denied<T>(code: string): CommonMessage<T> {
  return { status: false, msg: code };
}

export function registerToolResultIpcHandlers(): void {
  registerAiValidatedHandler(
    AI_TOOL_RESULT_GET,
    lazySchema(() => toolResultGetIpcSchema),
    async (input): Promise<CommonMessage<ToolOutputPublicDescriptor | null>> => {
      const module = new ToolResultModule();
      const decision = await module.authorizeAccess({
        outputId: input.outputId,
        profileId: "default",
        conversationId: input.conversationId,
      });
      if (!decision.ok) return denied(decision.code);
      const row = decision.output;
      return ok({
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
      });
    }
  );

  registerAiValidatedHandler(
    AI_TOOL_RESULT_READ,
    lazySchema(() => toolResultReadIpcSchema),
    async (input): Promise<CommonMessage<Record<string, unknown> | null>> => {
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
    async (input): Promise<CommonMessage<Record<string, unknown> | null>> => {
      if (input.query === undefined) {
        return denied("INVALID_OUTPUT_ARGUMENTS");
      }
      return await runSearch(input);
    }
  );

  registerAiValidatedHandler(
    AI_TOOL_RESULT_EXPORT,
    lazySchema(() => toolResultExportIpcSchema),
    async (input): Promise<CommonMessage<Record<string, unknown>>> => {
      const module = new ToolResultModule();
      const decision = await module.authorizeAccess({
        outputId: input.outputId,
        profileId: "default",
        conversationId: input.conversationId,
      });
      if (!decision.ok) return denied(decision.code);
      const row = decision.output;
      if (!row.storageKey) return denied("OUTPUT_NOT_AVAILABLE");

      const storage = new ToolResultStorageService({
        root: getToolResultStorageRoot(),
      });
      // The user must explicitly choose a destination. Cancelling is a normal
      // outcome, not an error.
      const result = await dialog.showSaveDialog({
        title: "Export tool result",
        defaultPath: `${row.outputId}.${row.outputFormat === "json" ? "json" : "txt"}`,
      });
      if (result.canceled || !result.filePath) {
        return ok({ status: "cancelled" });
      }

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
      if (!confirmed.ok) return denied(confirmed.code);
      // The epoch must be the SAME one, not merely still valid: a rotate +
      // re-create cycle must not let a new artifact inherit an in-flight
      // export that was authorized against the previous epoch.
      if (confirmed.output.outputEpoch !== row.outputEpoch) {
        return denied("OUTPUT_CHANGED");
      }

      try {
        // VERIFY INTEGRITY BEFORE HANDING OVER BYTES. This is the boundary
        // where the output is presented to the user as the evidence the
        // registry claims it is, so it is where the stored checksum must
        // actually be checked. `checksumOf` previously had no caller at all,
        // so a corrupted payload was exported as though it were intact.
        const integrity = await verifyArtifactIntegrity({
          storage,
          storageKey: row.storageKey,
          manifest: await storage.readManifest(
            row.profileId,
            row.outputEpoch,
            row.outputId
          ),
        });
        if (!integrity.ok) {
          toolResultMetrics.record("capture.integrity_failed");
          return denied(integrity.code);
        }
      } catch {
        // A verification failure must not silently allow the export.
        return denied("OUTPUT_INTEGRITY_FAILED");
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
      } catch {
        // Report the failure without leaking an internal path.
        return denied("OUTPUT_WRITE_FAILED");
      }
      return ok({ status: "exported" });
    }
  );
}

/** Read one bounded page for the renderer. */
async function runRead(
  input: { conversationId: string; outputId: string; cursor?: string; page?: number }
): Promise<CommonMessage<Record<string, unknown> | null>> {
  const module = new ToolResultModule();
  const decision = await module.authorizeAccess({
    outputId: input.outputId,
    profileId: "default",
    conversationId: input.conversationId,
  });
  if (!decision.ok) return denied(decision.code);
  const row = decision.output;
  if (!row.storageKey) return denied("OUTPUT_NOT_AVAILABLE");

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
    return denied(verdict.code);
  }
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
  if (!outcome.ok) return denied(outcome.code);
  return ok({ ...outcome.page });
}

/** Run a literal search for the renderer. */
async function runSearch(
  input: { conversationId: string; outputId: string; cursor?: string; query?: string }
): Promise<CommonMessage<Record<string, unknown> | null>> {
  const module = new ToolResultModule();
  const decision = await module.authorizeAccess({
    outputId: input.outputId,
    profileId: "default",
    conversationId: input.conversationId,
  });
  if (!decision.ok) return denied(decision.code);
  const row = decision.output;
  if (!row.storageKey) return denied("OUTPUT_NOT_AVAILABLE");

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
    return denied(verdict.code);
  }
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
  if (!outcome.ok) return denied(outcome.code);
  return ok({ ...outcome.page });
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
