/**
 * Run an async mapper over every item with a bounded level of concurrency,
 * returning the results in input order (not completion order).
 *
 * Used by the contact-extraction worker to process the `urls[]` batch from the
 * extract_contact_info tool with a capped number of simultaneous Puppeteer
 * extractions, instead of a fully sequential loop. A non-positive `limit` is
 * treated as 1 (sequential). If any mapper call rejects, the whole promise
 * rejects — callers that want per-item fault isolation should catch inside the
 * mapper (as the worker does, emitting a per-URL error result).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const total = items.length;
  let cursor = 0;

  async function worker(): Promise<void> {
    // The `cursor < total` check and the synchronous read-and-increment below
    // are atomic in JS's single-threaded event loop (no await between them),
    // so each index is claimed by exactly one worker.
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(effectiveLimit, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
