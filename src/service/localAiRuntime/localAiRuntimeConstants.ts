/**
 * Local AI Runtime — shared limits and constants (design §12.3).
 *
 * Catalog values may be lower but cannot raise these local limits.
 */
export const LOCAL_AI_RUNTIME_LIMITS = {
  /** Maximum compressed archive size accepted for download. */
  maxArchiveBytes: 768 * 1024 * 1024,
  /** Maximum total expanded size on disk. */
  maxExtractedBytes: 2 * 1024 * 1024 * 1024,
  /** Maximum number of entries in one archive. */
  maxEntries: 25_000,
  /** Maximum size of a single extracted entry. */
  maxSingleEntryBytes: 1024 * 1024 * 1024,
  /** Download/stream timeout. */
  timeoutMs: 10 * 60 * 1000,
  /** Maximum HTTP redirects. */
  maxRedirects: 5,
} as const;

export const RUNTIME_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
export const RUNTIME_CATALOG_TIMEOUT_MS = 15_000;
export const RUNTIME_CATALOG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Consent grant lifetime in milliseconds (design §14.2: five minutes). */
export const RUNTIME_CONSENT_TTL_MS = 5 * 60 * 1000;

/** Maximum progress events per second published to the renderer (design §12.2). */
export const RUNTIME_PROGRESS_MAX_EVENTS_PER_SECOND = 10;

/**
 * Model file-set ceilings (computer-use design §7.5). Local limits the
 * catalog may lower but never raise; multi-GB weights ship as file sets,
 * not ZIPs.
 */
export const LOCAL_AI_MODEL_PACKAGE_LIMITS = {
  /** Maximum size of a single model file (external-data shard). */
  maxFileBytes: 1024 * 1024 * 1024,
  /** Maximum number of files in one model package. */
  maxFiles: 128,
  /** Maximum total download size of one model package. */
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  /** Idle timeout: seconds without any bytes before `runtime_download_stalled`. */
  idleTimeoutMs: 60_000,
  /** Maximum HTTP redirects per hop chain. */
  maxRedirects: 5,
  /** Free-space margin required beyond the remaining download bytes. */
  diskMarginBytes: 512 * 1024 * 1024,
  /** Retries per file on a checksum mismatch before failing (§7.5: one). */
  checksumRetries: 1,
} as const;
