/**
 * Minimal async mutex (promise-chaining). Used to serialize write transactions
 * that share a single better-sqlite3 connection.
 *
 * Why this exists: TypeORM's `connection.transaction()` over the
 * better-sqlite3 driver cannot run two transaction bodies concurrently on the
 * same connection — the second `BEGIN` throws "cannot start a transaction
 * within a transaction". better-sqlite3 is synchronous, but TypeORM's async
 * transaction wrapper yields at each `await`, so two concurrent callers
 * interleave and trip the driver. Serializing the transaction bodies with this
 * mutex removes the overlap; the SQL-level guarantees (conditional UPDATE +
 * unique idempotency index) still provide the actual deduplication.
 */
export class AsyncMutex {
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * Run {@link fn} once any previously scheduled critical section has settled.
   * The returned promise resolves/rejects with {@link fn}'s result; a rejected
   * {@link fn} never breaks the chain for the next caller.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => fn());
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return await result;
  }
}
