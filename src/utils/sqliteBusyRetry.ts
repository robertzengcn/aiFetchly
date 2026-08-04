export interface SqliteBusyRetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  onRetry?: (
    nextAttempt: number,
    maxAttempts: number,
    delayMs: number,
    error: unknown
  ) => void;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1_000;
const DEFAULT_BACKOFF_FACTOR = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const property = value[key];
  return typeof property === "string" ? property : null;
}

function nestedProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isSqliteBusyErrorAtDepth(error: unknown, depth: number): boolean {
  if (depth > 4) {
    return false;
  }

  const code = stringProperty(error, "code");
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return true;
  }

  const message =
    error instanceof Error ? error.message : stringProperty(error, "message");
  if (
    message?.includes("SQLITE_BUSY") ||
    message?.toLowerCase().includes("database is locked")
  ) {
    return true;
  }

  const driverError = nestedProperty(error, "driverError");
  if (
    driverError &&
    driverError !== error &&
    isSqliteBusyErrorAtDepth(driverError, depth + 1)
  ) {
    return true;
  }

  const cause = nestedProperty(error, "cause");
  return Boolean(
    cause && cause !== error && isSqliteBusyErrorAtDepth(cause, depth + 1)
  );
}

export function isSqliteBusyError(error: unknown): boolean {
  return isSqliteBusyErrorAtDepth(error, 0);
}

export async function runWithSqliteBusyRetry<T>(
  operation: () => Promise<T>,
  options: SqliteBusyRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(
    1,
    Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  );
  const maxDelayMs = Math.max(0, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const backoffFactor = Math.max(
    1,
    options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR
  );
  let delayMs = Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isSqliteBusyError(error)) {
        throw error;
      }

      options.onRetry?.(attempt + 1, maxAttempts, delayMs, error);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      delayMs = Math.min(maxDelayMs, Math.ceil(delayMs * backoffFactor));
    }
  }

  throw new Error("SQLite busy retry exhausted unexpectedly");
}
