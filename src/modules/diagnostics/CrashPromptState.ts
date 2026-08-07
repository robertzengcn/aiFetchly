import * as fs from "fs";
import * as path from "path";
import {
  ensureDiagnosticsDirs,
  getDiagnosticsDir,
} from "@/modules/diagnostics/DiagnosticPaths";

/**
 * Persist which unclean-shutdown crashId was already shown to the user so a
 * historical record in crash.jsonl cannot re-open the "unexpectedly closed"
 * dialog on every subsequent normal launch.
 */
export function getLastPromptedCrashIdPath(): string {
  return path.join(getDiagnosticsDir(), "last-prompted-crash-id.txt");
}

export function getLastPromptedCrashId(): string | null {
  try {
    const p = getLastPromptedCrashIdPath();
    if (!fs.existsSync(p)) return null;
    const value = fs.readFileSync(p, "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setLastPromptedCrashId(crashId: string): void {
  try {
    ensureDiagnosticsDirs();
    fs.writeFileSync(getLastPromptedCrashIdPath(), crashId, "utf8");
  } catch {
    // Best-effort — never block startup or quit on prompt-state I/O.
  }
}

export interface UncleanShutdownPromptDecisionInput {
  /** True only when THIS launch found a leftover startup marker. */
  detectedThisLaunch: boolean;
  crashId: string | null;
  lastPromptedCrashId: string | null;
}

/**
 * Show the unclean-shutdown dialog only for a crash detected on this launch
 * that has not already been prompted. Historical crash.jsonl rows alone must
 * never re-trigger the dialog after a normal exit.
 */
export function shouldShowUncleanShutdownPrompt(
  input: UncleanShutdownPromptDecisionInput
): boolean {
  if (!input.detectedThisLaunch) return false;
  if (!input.crashId) return false;
  if (input.crashId === input.lastPromptedCrashId) return false;
  return true;
}
