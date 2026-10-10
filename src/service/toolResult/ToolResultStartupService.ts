import "reflect-metadata";
import * as crypto from "node:crypto";
import type { DataSource } from "typeorm";
import {
  deriveToolResultCursorKey,
  setToolResultCursorKey,
} from "@/service/toolResult/ToolResultCursorCodec";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { ToolResultRecoveryService } from "@/service/toolResult/ToolResultRecoveryService";
import {
  ToolResultBootstrapService,
  TOOL_OUTPUT_BOOTSTRAP_KEYS,
} from "@/service/toolResult/ToolResultBootstrapService";
import { getToolResultStorageRoot } from "@/service/toolResult/toolResultRoot";
import { toolResultMetrics } from "@/service/toolResult/ToolResultMetrics";
import type { ToolResultModule } from "@/modules/ToolResultModule";

/**
 * Startup integration for preserved tool outputs (technical design §12.2).
 *
 * Two things must happen before the feature is usable, and neither happened:
 *
 *  1. A PERSISTENT CURSOR KEY. The codec defaults to an ephemeral per-process
 *     key, which makes every cursor minted before a restart unverifiable
 *     afterwards. A model mid-scan when the app closed would come back and be
 *     told `INVALID_OUTPUT_CURSOR`, losing its place in a large output. The key
 *     is derived from an app-managed secret; the secret is stored, never the raw
 *     key.
 *
 *  2. A RECONCILIATION PASS. A crash can leave the filesystem and the registry
 *     disagreeing. The sweep reclaims expired write leases, completes
 *     publications for scopes that are still valid, and removes unregistered
 *     artifact directories past the grace period.
 *
 * Both are idempotent and safe to run on every startup, and NEITHER MAY THROW:
 * startup must not fail because an output directory is unreadable.
 */

/** Token key holding the app-managed secret the cursor key is derived from. */
export const TOOL_RESULT_CURSOR_SECRET_KEY = "ai_tool_output_cursor_secret";

/** Install a persistent cursor key, creating and storing a secret on first run. */
export function installPersistentCursorKey(input: {
  readSecret: () => string | undefined | null;
  writeSecret: (secret: string) => void;
}): { installed: boolean; reason?: string } {
  try {
    let secret = input.readSecret();
    if (!secret || secret.length < 16) {
      secret = crypto.randomBytes(32).toString("hex");
      input.writeSecret(secret);
    }
    setToolResultCursorKey(deriveToolResultCursorKey(secret));
    return { installed: true };
  } catch (error: unknown) {
    // Leave the codec on its ephemeral key. That is strictly worse than a
    // persisted key but still CORRECT - a cursor simply does not survive a
    // restart - so it must never abort startup.
    return {
      installed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Outcome of the startup sequence. */
export interface ToolResultStartupReport {
  readonly cursorKeyInstalled: boolean;
  readonly cursorKeyReason?: string;
  readonly expiredLeasesReclaimed?: number;
  readonly pendingReceiptsCompleted?: number;
  readonly orphansRemoved?: number;
  readonly filesSkippedTooRecent?: number;
  readonly errors?: number;
  /** True when the legacy projection backfill ran (may be skipped/resumed). */
  readonly legacyProjectionsBackfilled?: boolean;
}

/**
 * Run the full preserved-output startup sequence.
 *
 * `captureEnabled` gates RECONCILIATION only. The cursor key is always
 * installed: it is pure key derivation with no write side effects, and leaving
 * it ephemeral would invalidate outstanding cursors for no benefit.
 */
export async function runToolResultStartup(input: {
  module: ToolResultModule;
  storage: ToolResultStorageService;
  captureEnabled: boolean;
  readSecret: () => string | undefined | null;
  writeSecret: (secret: string) => void;
  onLog?: (message: string) => void;
  /**
   * DataSource for the legacy projection backfill. The backfill writes bounded
   * projections over legacy oversized rows (T14 / design §10.2); it is read-
   * only with respect to the original source rows, so it runs regardless of
   * `captureEnabled`. Optional: when absent, the backfill is skipped (the
   * read path still substitutes any pre-existing projections).
   */
  dataSource?: DataSource;
  /** Profile under which legacy projections are keyed. Defaults to "default". */
  profileId?: string;
}): Promise<ToolResultStartupReport> {
  const log = input.onLog ?? (() => undefined);
  const key = installPersistentCursorKey({
    readSecret: input.readSecret,
    writeSecret: input.writeSecret,
  });
  log(
    key.installed
      ? "[tool-result] persistent cursor key installed"
      : `[tool-result] cursor key NOT persisted: ${key.reason ?? "unknown"}`
  );

  // The legacy projection backfill writes bounded derived rows, not artifacts,
  // so it is NOT gated on `captureEnabled`. A capture-off rollback must still
  // let pre-existing projections be rebuilt/refreshed. It is resumable and
  // bounded, and a failure never aborts startup (the next boot retries).
  const legacyBackfill = runLegacyProjectionBackfill(input, log);

  if (!input.captureEnabled) {
    // Capture off: skip reconciliation so a rollback never touches artifacts.
    // Existing committed references stay readable regardless of the flag. The
    // legacy backfill still runs (it touches only the projection table).
    const backfill = await legacyBackfill;
    return {
      cursorKeyInstalled: key.installed,
      cursorKeyReason: key.reason,
      legacyProjectionsBackfilled: backfill,
    };
  }

  try {
    const report = await new ToolResultRecoveryService(
      input.module,
      input.storage
    ).run();
    toolResultMetrics.record("recovery.sweep");
    log(
      `[tool-result] recovery sweep: leases=${report.expiredLeasesReclaimed} ` +
        `receipts=${report.pendingReceiptsCompleted} ` +
        `orphans=${report.orphansRemoved} ` +
        `skipped=${report.filesSkippedTooRecent} ` +
        `errors=${report.errors}`
    );
    const backfill = await legacyBackfill;
    return {
      cursorKeyInstalled: key.installed,
      cursorKeyReason: key.reason,
      ...report,
      legacyProjectionsBackfilled: backfill,
    };
  } catch (error: unknown) {
    // Never abort startup for a reconciliation failure.
    log(
      `[tool-result] recovery sweep failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    const backfill = await legacyBackfill;
    return {
      cursorKeyInstalled: key.installed,
      cursorKeyReason: key.reason,
      errors: 1,
      legacyProjectionsBackfilled: backfill,
    };
  }
}

/**
 * Run the resumable legacy projection backfill (T14 / design §10.2) so it
 * overlaps the recovery sweep, then report whether it completed. Fire-and-
 * forget from the caller's perspective: this never throws — a failure is
 * logged and the step is left incomplete so the next startup retries it.
 *
 * Yields between batches via `setImmediate` so a large legacy table never
 * stalls the event loop (NFR-05).
 */
async function runLegacyProjectionBackfill(
  input: {
    dataSource?: DataSource;
    profileId?: string;
    onLog?: (message: string) => void;
  },
  log: (message: string) => void
): Promise<boolean> {
  if (!input.dataSource) return false;
  const profileId = input.profileId ?? "default";
  try {
    const result = await new ToolResultBootstrapService(
      input.dataSource,
      profileId
    ).runStep(TOOL_OUTPUT_BOOTSTRAP_KEYS.legacyProjections, {
      onYield: () =>
        new Promise<void>((resolve) => setImmediate(resolve)),
      onLog: log,
    });
    if (!result.completed) {
      log(
        `[tool-result] legacy projection backfill incomplete: ${result.error ?? "unknown"}`
      );
    } else if (result.ran) {
      log("[tool-result] legacy projection backfill complete");
    }
    return result.completed;
  } catch (error: unknown) {
    // Never abort startup for a backfill failure.
    log(
      `[tool-result] legacy projection backfill failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

/** Build the production storage service for the app-managed root. */
export function createToolResultStorage(): ToolResultStorageService {
  return new ToolResultStorageService({ root: getToolResultStorageRoot() });
}