import type { ToolResultStorageService } from "@/service/toolResult/ToolResultStorageService";

/**
 * Integrity verification for committed artifacts (technical design §8.4, T10).
 *
 * Two checks cooperate:
 *
 *  - a CHEAP per-page SIZE check lives in `ToolResultRetrievalService` itself
 *    (`identityMismatch`): it compares the on-disk `totalBytes` reported by
 *    `readWindow` against the manifest's `capturedBytes`. It catches a
 *    shrunken or replaced payload with NO extra I/O, but it cannot catch an
 *    in-place byte edit that preserves length.
 *
 *  - a FULL cryptographic checksum (this gate): it streams the whole payload
 *    once through `checksumOf` and compares to the recorded SHA-256. It
 *    catches same-size corruption the size check misses.
 *
 * The full checksum is EXPENSIVE (streams the whole file). A 64 MiB artifact
 * paged at 8 KiB is 8192 pages — re-hashing per page is catastrophic. So the
 * gate verifies ONCE per artifact per process, caching the verdict by
 * `storageKey`. A `storageKey` includes the `outputId` (unique per artifact),
 * so one key always refers to the same bytes; caching a verdict is safe. The
 * per-page size check stays the cheap line of defence for changes that happen
 * AFTER the cached verdict was taken.
 *
 * The recorded SHA-256 is read from the REGISTRY ROW (`AIToolOutputEntity.sha256`),
 * not from the on-disk manifest, so the gate needs no manifest-file I/O. An
 * artifact that predates checksum recording (no `sha256` on the row) is
 * UNVERIFIED, not corrupt — the gate returns `{ ok: true, verified: false }`
 * and the read proceeds, mirroring the export path's contract.
 */

/** The outcome of an integrity check for one artifact. */
export type IntegrityVerdict =
  | { readonly ok: true; readonly verified: boolean }
  | { readonly ok: false; readonly code: "OUTPUT_INTEGRITY_FAILED" };

/** The manifest subset the gate compares against. */
export interface IntegrityManifest {
  readonly sha256?: string;
  readonly capturedBytes?: number;
}

/**
 * Verify one committed artifact against a recorded checksum.
 *
 * `checksumOf` previously had no caller on the read path, so a silently
 * corrupted payload was served as though it were the evidence the registry
 * says it is. This makes the check available at the boundary where trust is
 * actually claimed, and reports a distinct code so the caller can distinguish
 * "this output is broken" from "this output is missing".
 *
 * A missing `sha256` is NOT treated as corruption: an artifact may legitimately
 * predate checksum recording, and the caller decides whether that is
 * acceptable. An unreadable payload is an availability problem the retrieval
 * path already reports; it is not relabelled as corruption.
 */
export async function verifyArtifactIntegrity(input: {
  readonly storage: ToolResultStorageService;
  readonly storageKey: string;
  readonly manifest: IntegrityManifest | null;
}): Promise<IntegrityVerdict> {
  if (!input.manifest?.sha256) {
    // Nothing recorded to verify against; not a failure, but not a pass either.
    return { ok: true, verified: false };
  }
  let actual: string;
  try {
    actual = await input.storage.checksumOf(input.storageKey);
  } catch {
    // The payload could not be read at all. That is an availability problem
    // the retrieval path already reports; do not relabel it as corruption.
    return { ok: true, verified: false };
  }
  if (actual !== input.manifest.sha256) {
    return {
      ok: false,
      code: "OUTPUT_INTEGRITY_FAILED",
    };
  }
  return { ok: true, verified: true };
}

/**
 * Process-wide, cached integrity gate.
 *
 * Verdicts are cached by `storageKey`. Because a storageKey includes the
 * unique `outputId`, one key always refers to the same artifact bytes within
 * a process lifetime, so a cached verdict remains correct. The cache is
 * bounded (LRU eviction); both positive and negative verdicts are cached so
 * paged reads of an artifact that predates checksums do not re-stat every
 * page.
 */
export class ToolResultIntegrityGate {
  private readonly cache = new Map<string, IntegrityVerdict>();
  private readonly capacity: number;

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  /**
   * Verify one artifact, returning a cached verdict when one exists.
   *
   * The caller holds the authorized registry row, so the recorded `sha256`
   * and `capturedBytes` come from the row (not from a manifest-file read).
   */
  async verify(input: {
    readonly storage: ToolResultStorageService;
    readonly storageKey: string;
    readonly manifest: IntegrityManifest | null;
  }): Promise<IntegrityVerdict> {
    const cached = this.cache.get(input.storageKey);
    if (cached) return cached;

    const verdict = await verifyArtifactIntegrity(input);
    this.evictIfFull();
    this.cache.set(input.storageKey, verdict);
    return verdict;
  }

  /** Drop one cached verdict (e.g. after re-capture to the same key). */
  invalidate(storageKey: string): void {
    this.cache.delete(storageKey);
  }

  /** Drop every cached verdict. Used by tests and on conversation clear. */
  clear(): void {
    this.cache.clear();
  }

  private evictIfFull(): void {
    if (this.cache.size >= this.capacity) {
      // Map preserves insertion order; the first key is the oldest.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}

/**
 * Process-wide singleton. The cache is keyed by `storageKey` (unique per
 * artifact), so sharing one gate across the model-tool path and the IPC path
 * is correct and avoids re-checksumming the same artifact when both paths
 * read it.
 */
export const toolResultIntegrityGate = new ToolResultIntegrityGate();
