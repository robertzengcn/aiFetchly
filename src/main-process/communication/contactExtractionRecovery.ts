import { v4 as uuidv4 } from "uuid";

/**
 * WS-4 R4.4 — crash recovery for in-flight contact-extraction jobs.
 *
 * The ExtractionQueue lives in the worker process; a crash loses its pending +
 * in-flight jobs (their DB rows stay stuck in 'analyzing' forever). Workers
 * can't touch the DB, so recovery is the main process's job: on worker restart
 * we re-dispatch every non-terminal resultId; if the worker circuit-breaks, we
 * mark them failed.
 *
 * This module is deliberately Electron-free (only depends on `uuid` + injected
 * collaborators) so the recovery logic can be unit-tested in isolation. The
 * Electron-coupled wiring (real ContactInfoModule + worker.send) lives in
 * contactExtraction-ipc.ts.
 */

export interface RecoveryDeps {
  /** ResultIds whose extraction has not reached a terminal status. */
  getInFlightResultIds: () => Promise<number[]>;
  /** Fetch the search-result rows backing those ids (needed to re-dispatch). */
  getSearchResults: (
    ids: number[]
  ) => Promise<{ id: number; url: string; title: string }[]>;
  /** Send a message to the worker (the `extract-contact` batch). */
  send: (message: unknown) => void;
}

export interface FailDeps {
  getInFlightResultIds: () => Promise<number[]>;
  batchUpdateStatus: (
    ids: number[],
    status: string,
    error?: string
  ) => Promise<void>;
}

/**
 * Re-queue every non-terminal contact-extraction job by sending a fresh
 * `extract-contact` batch to the worker. Returns the resultIds re-queued
 * (empty when there was nothing to recover, or when no search-result rows back
 * the in-flight ids).
 */
export async function recoverInFlightExtractions(
  deps: RecoveryDeps
): Promise<number[]> {
  const inFlightIds = await deps.getInFlightResultIds();
  if (inFlightIds.length === 0) return [];

  const results = await deps.getSearchResults(inFlightIds);
  if (results.length === 0) return [];

  const resultIds = results.map((r) => r.id);
  deps.send({
    type: "extract-contact",
    batchId: uuidv4(),
    resultIds,
    results,
    priority: 0,
  });
  return resultIds;
}

/**
 * Mark every in-flight job as failed (with `reason`) — used when the worker
 * circuit-breaks and cannot be restarted, so jobs don't stay 'analyzing' forever.
 * Returns the resultIds marked failed (empty when there was nothing in-flight).
 */
export async function failInFlightExtractions(
  deps: FailDeps,
  reason: string
): Promise<number[]> {
  const inFlightIds = await deps.getInFlightResultIds();
  if (inFlightIds.length === 0) return [];

  await deps.batchUpdateStatus(inFlightIds, "failed", reason);
  return inFlightIds;
}
