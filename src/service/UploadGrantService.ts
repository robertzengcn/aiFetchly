/**
 * UploadGrantService — F2 follow-up (closes the RAG arbitrary-file-read gap).
 *
 * The original F2 fix staged renderer-supplied files into an app-owned
 * directory before indexing, which contained delete/read side-effects but
 * still allowed the pipeline to *read & embed* any local file whose path the
 * renderer supplied. This service closes that hole: the only paths the RAG
 * upload path may read are
 *   (a) app-owned destinations (e.g. SAVE_TEMP_FILE's userData/uploads dir), or
 *   (b) paths explicitly backed by a short-lived, one-shot grant issued by an
 *       app-owned trust anchor (SHOW_OPEN_DIALOG — the native file picker).
 *
 * Grants are:
 *   - canonicalized via realpath (symlink-equivalent paths collapse to one key)
 *   - scoped by operation (so a dialog grant can't be spent on a different op)
 *   - one-shot (consume marks them used)
 *   - short-lived (default 5 min) so a leaked token has a tight expiry window
 *
 * The service is intentionally Electron-free so it is unit-testable without
 * an Electron harness. The IPC layer owns the app-owned-path check (it needs
 * `app.getPath`) and calls `consume()` for the grant-backed branch.
 */
import * as fs from "fs";
import * as path from "path";

export type UploadOperation = "rag-upload";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface GrantEntry {
  readonly canonicalPath: string;
  readonly operation: UploadOperation;
  readonly expiresAt: number;
  readonly consumed: boolean;
}

/**
 * Returns true iff `target` resolves strictly under `root` (symlink-safe).
 * Both paths are resolved with realpath before the prefix check, and a
 * traversal segment (`..`) or absolute escape causes a false result. Returns
 * false when either path cannot be resolved on disk.
 */
export function isPathUnderDir(target: string, root: string): boolean {
  let resolvedTarget: string;
  let resolvedRoot: string;
  try {
    resolvedTarget = fs.realpathSync(target);
    resolvedRoot = fs.realpathSync(root);
  } catch {
    return false;
  }
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return !rel.startsWith("..") && !path.isAbsolute(rel) && rel !== "";
}

export class UploadGrantService {
  /** key = `${operation}:${canonicalPath}` → immutable grant entry */
  private readonly grants = new Map<string, GrantEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Canonicalize a path via realpath so symlink-equivalent paths share a key. */
  private canonicalize(filePath: string): string {
    try {
      return fs.realpathSync(filePath);
    } catch {
      // Path does not exist (yet). Fall back to an absolute resolved path so
      // the key is still stable across issue/consume call sites; the caller is
      // responsible for ensuring the file exists before use.
      return path.resolve(filePath);
    }
  }

  private key(operation: UploadOperation, canonicalPath: string): string {
    return `${operation}:${canonicalPath}`;
  }

  /** Remove expired entries. O(n) but n is bounded by dialog selections. */
  private purgeExpired(now: number): void {
    for (const [k, entry] of this.grants) {
      if (now > entry.expiresAt) {
        this.grants.delete(k);
      }
    }
  }

  /** Issue a short-lived, one-shot grant for a single path. */
  issue(filePath: string, operation: UploadOperation = "rag-upload"): void {
    const canonical = this.canonicalize(filePath);
    const now = Date.now();
    this.purgeExpired(now);
    this.grants.set(this.key(operation, canonical), {
      canonicalPath: canonical,
      operation,
      expiresAt: now + this.ttlMs,
      consumed: false,
    });
  }

  /** Issue grants for a batch of paths (e.g. all files returned by a dialog). */
  issueForPaths(
    filePaths: string[],
    operation: UploadOperation = "rag-upload"
  ): void {
    for (const p of filePaths) {
      this.issue(p, operation);
    }
  }

  /**
   * Returns true iff a valid, unconsumed, unexpired grant exists; consumes it
   * (one-shot). Returns false when no grant matches, it was already consumed,
   * or it has expired.
   */
  consume(filePath: string, operation: UploadOperation = "rag-upload"): boolean {
    const now = Date.now();
    this.purgeExpired(now);
    const canonical = this.canonicalize(filePath);
    const k = this.key(operation, canonical);
    const entry = this.grants.get(k);
    if (!entry) return false;
    if (entry.consumed) return false;
    if (now > entry.expiresAt) {
      this.grants.delete(k);
      return false;
    }
    // Immutable update: replace the entry rather than mutating the original.
    this.grants.set(k, { ...entry, consumed: true });
    return true;
  }

  /** Wipe all outstanding grants (test/cleanup only). */
  clear(): void {
    this.grants.clear();
  }
}

/**
 * Process-wide singleton shared between the grant issuer (SHOW_OPEN_DIALOG)
 * and the consumer (RAG_UPLOAD_DOCUMENT). Both IPC handlers run in the same
 * main process; sharing the instance is what makes the grant enforceable.
 */
let sharedInstance: UploadGrantService | null = null;
export function getUploadGrantService(): UploadGrantService {
  if (!sharedInstance) {
    sharedInstance = new UploadGrantService();
  }
  return sharedInstance;
}
