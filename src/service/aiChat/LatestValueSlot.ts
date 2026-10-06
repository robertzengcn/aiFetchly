// src/service/aiChat/LatestValueSlot.ts
//
// Stage B §12 (generator-streaming PRD FR-016): the tool-progress
// multiplexer slot. Progress is current state, not a log — only the LATEST
// value per tool call is retained, so memory stays bounded by the number of
// tool calls in flight and progress volume can never fail or abort a tool
// that may be performing an external action.

/**
 * Latest-value coalescing slot for one producer/consumer pair.
 *
 * - `set(value)` retains only the most recent value (bursts coalesce).
 * - `changed()` resolves `undefined` as soon as a new value is available
 *   (or immediately when one is already pending) — designed to be raced
 *   against the tool's settled promise.
 * - `take()` returns and clears the retained value.
 * - `close()` wakes waiters and makes every later `set` a no-op — late
 *   progress from a settled tool is dropped, never delivered.
 */
export class LatestValueSlot<T> {
  private latest: { readonly value: T } | null = null;
  private waiters: Array<() => void> = [];
  private closed = false;

  set(value: T): void {
    if (this.closed) return;
    if (this.latest !== null) {
      // TODO-14: a coalesced (overwritten) progress update.
      latestValueSlotDiagnostics.coalescedDropped += 1;
    }
    this.latest = { value };
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  async changed(): Promise<undefined> {
    if (this.latest !== null || this.closed) {
      return undefined;
    }
    return new Promise<undefined>((resolve) => {
      this.waiters.push(() => resolve(undefined));
    });
  }

  take(): T | undefined {
    const entry = this.latest;
    this.latest = null;
    return entry ? entry.value : undefined;
  }

  close(): void {
    this.closed = true;
    this.latest = null; // TODO-07: release the retained reference.
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/**
 * TODO-14: count-only slot diagnostics (no content). Tests assert these
 * return to baseline after terminal/pause/abort paths.
 */
export const latestValueSlotDiagnostics = {
  coalescedDropped: 0,
} as { coalescedDropped: number };
