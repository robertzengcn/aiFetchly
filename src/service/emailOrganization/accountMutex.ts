import { AsyncMutex } from "@/utils/asyncMutex";

/**
 * T07: per-account coordination boundary shared by mailbox mutations
 * (Trash/restore/bulk) and reply delivery. A MOVE and a reply submission on
 * the same account cannot race each other's admission/persistence, and
 * reconciliation runs under the same lock. Keys are account ids; the map
 * lives for the process lifetime (locks are re-entrant-safe via AsyncMutex
 * queueing — never nested on the same key in one call path).
 */
const accountMutexes = new Map<number, AsyncMutex>();

export function lockAccount(emailServiceId: number): AsyncMutex {
  let mutex = accountMutexes.get(emailServiceId);
  if (mutex === undefined) {
    mutex = new AsyncMutex();
    accountMutexes.set(emailServiceId, mutex);
  }
  return mutex;
}

/** Runs `work` serialized against other holders of the account lock. */
export async function runWithAccountLock<T>(
  emailServiceId: number,
  work: () => Promise<T>
): Promise<T> {
  return await lockAccount(emailServiceId).run(work);
}
