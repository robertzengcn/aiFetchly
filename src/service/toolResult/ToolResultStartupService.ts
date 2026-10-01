import "reflect-metadata";
import * as crypto from "node:crypto";
import {
  deriveToolResultCursorKey,
  setToolResultCursorKey,
} from "@/service/toolResult/ToolResultCursorCodec";
import { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";
import { ToolResultRecoveryService } from "@/service/toolResult/ToolResultRecoveryService";
import { getToolResultStorageRoot } from "@/service/toolResult/toolResultRoot";
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

  if (!input.captureEnabled) {
    // Capture off: skip reconciliation so a rollback never touches artifacts.
    // Existing committed references stay readable regardless of the flag.
    return {
      cursorKeyInstalled: key.installed,
      cursorKeyReason: key.reason,
    };
  }

  try {
    const report = await new ToolResultRecoveryService(
      input.module,
      input.storage
    ).run();
    log(
      `[tool-result] recovery sweep: leases=${report.expiredLeasesReclaimed} ` +
        `receipts=${report.pendingReceiptsCompleted} ` +
        `orphans=${report.orphansRemoved} ` +
        `skipped=${report.filesSkippedTooRecent} ` +
        `errors=${report.errors}`
    );
    return {
      cursorKeyInstalled: key.installed,
      cursorKeyReason: key.reason,
      ...report,
    };
  } catch (error: unknown) {
    // Never abort startup for a reconciliation failure.
    log(
      `[tool-result] recovery sweep failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {
      cursorKeyInstalled: key.installed,
      cursorKeyReason: key.reason,
      errors: 1,
    };
  }
}

/** Build the production storage service for the app-managed root. */
export function createToolResultStorage(): ToolResultStorageService {
  return new ToolResultStorageService({ root: getToolResultStorageRoot() });
}