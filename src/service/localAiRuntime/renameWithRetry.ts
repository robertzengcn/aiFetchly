/**
 * Local AI Runtime — staging -> version rename with bounded retry.
 *
 * The primary fix for the Windows EPERM is structural: the native addon is now
 * loaded in a disposable probe worker (not the main process), so no in-process
 * lock blocks the rename. This helper is defense-in-depth for the *transient*
 * locks that still briefly hold freshly-extracted native files on Windows
 * (antivirus / Search Indexer scan-on-create): even after the probe worker
 * exits, those scanners can hold a file for a few hundred milliseconds. A short
 * bounded retry turns an intermittent EPERM/ENOTEMPTY/EACCES into a success
 * without masking genuine permission failures (which surface after the budget).
 */
import { promises as fs } from "node:fs";

/** Error codes that reflect a transient lock rather than a hard failure. */
const TRANSIENT_RENAME_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EACCES",
  "ENOTEMPTY",
]);

export interface RenameWithRetryOptions {
  /** Injectable for tests. Defaults to fs.rename. */
  rename?: (from: string, to: string) => Promise<void>;
  /** Total retry attempts (first try + retries). Defaults to 5. */
  maxAttempts?: number;
  /** Base backoff in ms; doubles each retry. Defaults to 100. */
  baseDelayMs?: number;
  /** Injectable sleeper for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

function isTransient(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    TRANSIENT_RENAME_CODES.has((error as NodeJS.ErrnoException).code ?? "")
  );
}

/**
 * Rename `from` -> `to`, retrying transient Windows lock errors with bounded
 * exponential backoff. Non-transient errors rethrow immediately. Resolves once
 * the rename succeeds; rejects with the last transient error if the budget is
 * exhausted.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameWithRetryOptions = {}
): Promise<void> {
  const rename = options.rename ?? ((s, d) => fs.rename(s, d));
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const sleep =
    options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;
      if (attempt === maxAttempts - 1) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
