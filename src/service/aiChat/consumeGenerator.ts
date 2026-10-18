// src/service/aiChat/consumeGenerator.ts
//
// Stage B §6 (generator-streaming PRD FR-001): the typed sequential
// generator consumer. `for await` discards a generator's final return value
// — this helper preserves it. A forced `.return()` carries no valid domain
// outcome, so its synthetic completion is NEVER routed as success.

/**
 * Drain an async generator, forwarding every yielded event to `onEvent` in
 * order, and return the generator's final value.
 *
 * On consumer/`onEvent` failure: `abortProducer` runs synchronously first
 * (it must be non-throwing — a `.return()` alone cannot interrupt a pending
 * network read), then the iterator is closed; a cleanup failure is reported
 * through `onCleanupError` and never masks the primary error, which is
 * re-thrown. The forced-close value is deliberately ignored: closing a
 * generator has no valid domain outcome to supply (`undefined as never` is
 * confined to this boundary by design).
 */
export async function consumeGenerator<E, R>(
  iterator: AsyncGenerator<E, R, void>,
  onEvent: (event: E) => Promise<void>,
  abortProducer: (reason: unknown) => void,
  onCleanupError: (error: unknown) => void
): Promise<R> {
  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) {
        return step.value;
      }
      await onEvent(step.value);
    }
  } catch (error: unknown) {
    abortProducer(error);
    try {
      await iterator.return(undefined as never);
    } catch (cleanupError: unknown) {
      onCleanupError(cleanupError);
    }
    throw error;
  }
}
