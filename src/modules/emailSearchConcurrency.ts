export const DEFAULT_EMAIL_SEARCH_CONCURRENCY = 3;
export const MAX_EMAIL_SEARCH_CONCURRENCY = 10;

export function normalizeEmailSearchConcurrency(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_EMAIL_SEARCH_CONCURRENCY;
  }

  return Math.min(Math.floor(parsed), MAX_EMAIL_SEARCH_CONCURRENCY);
}
