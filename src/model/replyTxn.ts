import { EntityManager } from "typeorm";
import { AsyncMutex } from "@/utils/asyncMutex";

/**
 * Process-wide serializer for reply-reliability write transactions
 * (technical design §3, FR-035/FR-036).
 *
 * TypeORM's `connection.transaction()` over the better-sqlite3 driver cannot
 * run two transaction bodies concurrently on the same shared connection — the
 * second `BEGIN` throws "cannot start a transaction within a transaction". The
 * mutex serializes transaction *bodies*; the actual dedup/exclusion guarantees
 * come from SQL (conditional UPDATEs + unique indexes + owner/lease fences).
 *
 * The mutex is in-memory only: it dies with the process and provides NO
 * cross-process or crash/restart fencing (§2 decision 3). Cross-crash
 * exclusion is provided by the persisted `email_reply_guard` row + owner token
 * + lease (FR-035/T07). Models that participate in reply-reliability writes
 * (`EmailReplyDraftModel`, `EmailReplyGuardModel`) share this single mutex
 * instance so their transactions never overlap.
 */
const replyWriteMutex = new AsyncMutex();

/**
 * C01: the shared reliability write mutex, also held by evidence writers.
 * The final-admission snapshot reads under this mutex (via {@link
 * runReplyTxn}); every received-message evidence mutation must hold it
 * too, so no committed write can land between the snapshot's statements
 * on the shared connection (WAL mode lets plain UPDATEs interleave).
 * RESTRICTION: never call a mutex-guarded method from inside a mutex-held
 * body (the mutex is non-reentrant — transaction bodies must use their
 * manager-bound repositories directly).
 */
export { replyWriteMutex };

/** Run a transaction body under the shared reliability write mutex. */
export function runReplyTxn<T>(
  sqliteDb: {
    connection: {
      transaction: <R>(fn: (m: EntityManager) => Promise<R>) => Promise<R>;
    };
  },
  fn: (manager: EntityManager) => Promise<T>
): Promise<T> {
  return replyWriteMutex.run(() => sqliteDb.connection.transaction(fn));
}
