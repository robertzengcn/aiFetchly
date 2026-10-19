import { AsyncMutex } from "@/utils/asyncMutex";
import type { DataSource } from "typeorm";

/**
 * B14 (FR-08/11; NFR-10; AC-08/15/28): the common transaction coordinator
 * for every durable dispatch gate.
 *
 * better-sqlite3 is a single shared synchronous connection: an auto-commit
 * write issued while another path holds an open transaction silently JOINS
 * that transaction. The gate reports success, work dispatches, and the
 * unrelated rollback then restores attempts 0 / pending — a reservation
 * that was never durably committed. TypeORM's `connection.transaction()`
 * cannot run two bodies concurrently on this connection either (the second
 * `BEGIN` throws "cannot start a transaction within a transaction").
 *
 * Every writer below MUST run its statement inside `dispatchGateMutex.run`
 * with its OWN transaction boundary (`startTransaction` → write →
 * `commitTransaction`), and MUST report success only after that commit:
 * - `AiTaskExecutionModel`: `createExecution`, `finalizeExecution`,
 *   `finalizeScheduledExecution` (pre-existing users), plus
 *   `persistBudgetConsumption` and `applyShadowDecisionCas` (B14).
 * - `AiTaskOperationModel`: `updateState` (claim/dispatched/settle gate)
 *   and `setReceipt` (B14).
 *
 * The mutex guarantees no two boundaries overlap, so a gate writer always
 * owns its commit. If `startTransaction` still throws (a path bypassed the
 * mutex and holds an open transaction), the writer MUST fail closed
 * (false / `{ ok: false }`) — never report success into a transaction it
 * does not own.
 *
 * The mutex is NOT re-entrant: no method that runs inside it may call
 * another method that acquires it. Model internals never nest gate writers
 * (verified: create/finalize bodies issue raw runner statements only), and
 * service-layer callers sequence gate writes as separate awaits.
 */
export const dispatchGateMutex = new AsyncMutex();

/**
 * Execute a single conditional UPDATE inside our OWN committed boundary on
 * the shared better-sqlite3 connection. Callers MUST hold
 * {@link dispatchGateMutex} across this call so concurrent gate writers
 * serialize instead of spuriously failing each other's `BEGIN`.
 *
 * Returns the affected row count (1 = gate won, 0 = predicate missed), or
 * -1 when the boundary was unownable or the commit failed — the caller
 * MUST fail closed (refuse dispatch), never report success.
 *
 * Why the pre-check: `connection.createQueryRunner()` returns ONE shared
 * singleton runner, and the driver's transaction support is `nested`. A
 * second `startTransaction` while a transaction is open does NOT isolate —
 * it opens a SAVEPOINT that `commitTransaction` RELEASEs into the outer
 * transaction. Success would then mean "joined", and an outer rollback
 * silently undoes it. `isTransactionActive` on the singleton is the only
 * reliable contention signal: when set, return -1 WITHOUT issuing any
 * statement (no savepoint, no flag corruption, no interference with the
 * owner's rollback).
 *
 * The `needsRollback` flag (not "always rollback in finally") is load
 * bearing for the same reason: rolling back after our own commit landed
 * would issue a real ROLLBACK against whatever transaction is open then —
 * potentially someone else's. Roll back ONLY when we started and did not
 * commit.
 */
export async function executeOwnedUpdate(
  connection: DataSource,
  query: string,
  parameters: readonly unknown[]
): Promise<number> {
  const runner = connection.createQueryRunner();
  if (runner.isTransactionActive) {
    await runner.release();
    return -1;
  }
  let needsRollback = false;
  try {
    await runner.startTransaction();
    needsRollback = true;
    const result = (await runner.query(
      query,
      [...parameters],
      true // useStructuredResult — exposes .affected on the driver result
    )) as { affected?: number };
    const affected = result.affected ?? 0;
    if (affected !== 1) {
      await runner.rollbackTransaction();
      needsRollback = false;
      return 0;
    }
    await runner.commitTransaction();
    needsRollback = false;
    return 1;
  } catch {
    // Boundary unownable (a bypassed path opened a transaction between the
    // pre-check and our BEGIN), statement failed, or commit failed — the
    // caller fails closed. Over-counted spend on a failed commit is the
    // safe direction: budget burns, never authorizes unfunded work.
    return -1;
  } finally {
    if (needsRollback) {
      try {
        await runner.rollbackTransaction();
      } catch {
        // Connection unusable — nothing left to undo; the value stands.
      }
    }
    await runner.release();
  }
}
