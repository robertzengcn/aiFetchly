// src/service/aiChat/runToolWithProgress.ts
//
// Stage B §12 (generator-streaming PRD FR-016): wraps one tool execution so
// the generator loop can yield coalesced progress while the tool runs. Only
// progress passes through the multiplexer — text/reasoning/usage/tool-call/
// tool-result events are yielded directly by the loop and never here.

import { LatestValueSlot } from "./LatestValueSlot";

/** Proposed cap for a single serialized progress payload (design §12). */
export const TOOL_PROGRESS_MAX_SERIALIZED_BYTES = 64 * 1024;

/**
 * TODO-14 (design §12/§18): privacy-safe progress diagnostics — count-only
 * counters, no content. Read by tests to assert baseline restoration.
 */
export const toolProgressDiagnostics = {
  oversizedReplaced: 0,
  coalescedDropped: 0,
  emitted: 0,
} as {
  oversizedReplaced: number;
  coalescedDropped: number;
  emitted: number;
};

interface MinimalProgressShape {
  readonly phase?: unknown;
  readonly progress?: unknown;
  readonly partialCount?: unknown;
  readonly expectedCount?: unknown;
}

export interface ToolProgressEnvelope<T> {
  readonly event: T;
  /** True when an oversized payload was replaced by the minimal event. */
  readonly oversizedReplaced: boolean;
}

/**
 * Build the coalescing wrapper for one tool call. `start` receives an `emit`
 * callback the tool uses for progress; the wrapper yields the LATEST progress
 * as it arrives (bursts coalesce to the newest) and returns the tool's result.
 *
 * Rules enforced here (PRD FR-016):
 * - Progress volume can never fail or abort the tool: an oversized serialized
 *   payload (>64 KiB estimate) is replaced by a minimal phase/counts-only
 *   event, never thrown.
 * - After the tool settles or the signal aborts, late progress is ignored
 *   (`LatestValueSlot.close()`), never delivered.
 * - Only progress flows through the slot; the final tool result travels
 *   through the tool's own result Promise.
 */
export function runToolWithProgress<ToolResult, Progress extends MinimalProgressShape>(
  start: (emit: (event: Progress) => void) => Promise<ToolResult>,
  signal: AbortSignal
): AsyncGenerator<ToolProgressEnvelope<Progress>, ToolResult, void> {
  const slot = new LatestValueSlot<ToolProgressEnvelope<Progress>>();
  const emit = (event: Progress): void => {
    if (signal.aborted) return;
    slot.set(applyProgressBudget(event));
  };
  const toolPromise = (async () => {
    try {
      return { kind: "done" as const, value: await start(emit) };
    } catch (error: unknown) {
      return { kind: "error" as const, error };
    }
  })();
  const settled = toolPromise;
  return (async function* (): AsyncGenerator<
    ToolProgressEnvelope<Progress>,
    ToolResult,
    void
  > {
    try {
      for (;;) {
        const next = await Promise.race([settled, slot.changed()]);
        const latest = slot.take();
        if (latest) {
          yield latest;
        }
        if (next !== undefined) {
          if (next.kind === "error") {
            throw next.error;
          }
          return next.value;
        }
      }
    } finally {
      slot.close();
    }
  })();
}

/**
 * Replace an oversized serialized progress payload with a WHITELISTED
 * minimal event — only the bounded identity/phase/counts fields survive;
 * every other property (message bodies, tool payloads, anything unbounded)
 * is dropped. Byte size is measured as UTF-8, not JS string length.
 * Unserializable payloads (circular refs) take the same minimal path rather
 * than passing an unbounded object through. Never throws — progress must
 * not fail a segment.
 */
function applyProgressBudget<Progress extends MinimalProgressShape>(
  event: Progress
): ToolProgressEnvelope<Progress> {
  let serializedLength = 0;
  try {
    // Review F12: TextEncoder, not Buffer — works in main AND renderer
    // processes (Buffer is a bare Node global the renderer guard can't see).
    serializedLength = new TextEncoder().encode(
      JSON.stringify(event)
    ).length;
  } catch {
    serializedLength = Number.POSITIVE_INFINITY; // unserializable → minimal
  }
  if (serializedLength > TOOL_PROGRESS_MAX_SERIALIZED_BYTES) {
    // Review F5: clamping the retained fields is what makes the budget real —
    // copying whitelisted names verbatim from an already-oversized event let
    // a multi-MB string field through untouched.
    const clamp = (value: unknown, maxLen: number): unknown => {
      if (typeof value === "string") {
        return value.length > maxLen ? value.slice(0, maxLen) : value;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      return undefined; // objects/arrays/symbols are never bounded identity
    };
    const minimal: Record<string, unknown> = {
      type: "tool_progress",
    };
    // Bounded identity/phase/counts fields only, each clamped.
    for (const key of ["conversationId", "messageId", "toolCallId", "toolName"]) {
      const value = clamp((event as unknown as Record<string, unknown>)[key], 256);
      if (value !== undefined) {
        minimal[key] = value;
      }
    }
    const phase = clamp((event as unknown as Record<string, unknown>)["phase"], 32);
    if (phase !== undefined) {
      minimal["phase"] = phase;
    }
    for (const key of ["progress", "partialCount", "expectedCount"]) {
      const value = (event as unknown as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        minimal[key] = value;
      }
    }
    const ts = (event as unknown as Record<string, unknown>)["timestamp"];
    if (typeof ts === "number" && Number.isFinite(ts)) {
      minimal["timestamp"] = ts;
    }
    toolProgressDiagnostics.oversizedReplaced += 1;
    return {
      event: minimal as unknown as Progress,
      oversizedReplaced: true,
    };
  }
  return { event, oversizedReplaced: false };
}
