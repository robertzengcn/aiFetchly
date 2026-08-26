// src/service/AIChatPromptBudget.ts
//
// Pure token-budget, atomic-message-grouping, and deterministic chunk helpers
// for lightweight routing. No I/O, no service calls. Uses
// {@link AIChatTokenEstimator} consistently — callers must not mix the
// estimator's built-in safety allowance with an additional undocumented one.
//
// Tool-call grouping is shared here so both compact chunking and the recovery
// service use one correct implementation: an assistant tool-call and all
// matching tool-result messages are one indivisible group; chunking must never
// orphan a tool result.
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";

/** An indivisible chronological run of messages. */
export interface AIChatMessageGroup {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly tokens: number;
  readonly isToolGroup: boolean;
  readonly messages: readonly OpenAIChatMessage[];
}

/** Budget inputs and the derived usable payload space. */
export interface AIChatLightweightBudget {
  readonly contextWindow: number;
  readonly effectiveOutputTokens: number;
  readonly softContextLimit: number;
  readonly fixedPromptTokens: number;
  readonly usablePayloadTokens: number;
}

/**
 * Safety margin fraction reserved at the top of the context window. At least
 * 10% per PRD §8.5; we reserve 10% explicitly.
 */
const SAFETY_MARGIN_RATIO = 0.1;

/**
 * Context window assumed for hosted auto-dream and session-summary work when
 * the server reports no small-model capability metadata. Conservative; full
 * compact does NOT use this (it requires discovered metadata).
 */
export const CONSERVATIVE_SMALL_CONTEXT_FALLBACK = 32_000;

/**
 * Derive the reviewedThrough cursor from the greatest `updatedAt` among the
 * given packets. Source-derived so the watermark advances only through
 * processed material — never `new Date()` (tech-design §14.1, §2.5). Falls
 * back to `new Date()` only when no packet has a usable timestamp (a
 * no-source run returns earlier than reaching this, so the fallback is
 * defensive).
 *
 * Shared by the user/workspace auto-dream services so both compute the
 * cursor identically.
 */
export function maxPacketUpdatedAt<
  T extends { updatedAt?: string | Date | null }
>(packets: readonly T[]): Date {
  let maxMs = NaN;
  for (const p of packets) {
    const v = p.updatedAt;
    let ms: number;
    if (!v) {
      ms = NaN;
    } else if (v instanceof Date) {
      ms = v.getTime();
    } else {
      ms = new Date(v).getTime();
    }
    if (Number.isFinite(ms) && (Number.isNaN(maxMs) || ms > maxMs)) {
      maxMs = ms;
    }
  }
  return Number.isNaN(maxMs) ? new Date() : new Date(maxMs);
}

/**
 * Compute the usable input-payload token budget for a lightweight request.
 *
 * ```text
 * softContextLimit  = floor(contextWindow * 0.90)
 * usablePayload     = max(0, softContextLimit - effectiveOutput - fixedPrompt)
 * ```
 *
 * If fixed prompt plus output reserve does not fit, `usablePayloadTokens` is 0
 * and the caller must fail locally as `invalid_request` rather than send a
 * predictably overflowing request.
 */
export function computeLightweightBudget(input: {
  contextWindow: number;
  maxOutputTokens: number;
  discoveredMaxOutputTokens?: number;
  fixedPromptTokens: number;
}): AIChatLightweightBudget {
  const contextWindow =
    input.contextWindow > 0
      ? input.contextWindow
      : CONSERVATIVE_SMALL_CONTEXT_FALLBACK;
  const effectiveOutputTokens = Math.min(
    input.maxOutputTokens,
    input.discoveredMaxOutputTokens ?? input.maxOutputTokens
  );
  const softContextLimit = Math.floor(
    contextWindow * (1 - SAFETY_MARGIN_RATIO)
  );
  const usablePayloadTokens = Math.max(
    0,
    softContextLimit - effectiveOutputTokens - input.fixedPromptTokens
  );
  return {
    contextWindow,
    effectiveOutputTokens,
    softContextLimit,
    fixedPromptTokens: input.fixedPromptTokens,
    usablePayloadTokens,
  };
}

/**
 * Group consecutive messages into atomic units. A tool group is an assistant
 * message with `tool_calls` followed by `role: "tool"` messages referencing
 * those call ids. Non-tool messages form singleton groups. An assistant
 * tool-call and all matching tool-results are never split across chunks.
 */
export function groupMessagesAtomically(
  messages: readonly OpenAIChatMessage[],
  estimator: AIChatTokenEstimator = new AIChatTokenEstimator()
): AIChatMessageGroup[] {
  const groups: AIChatMessageGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const isAssistantToolCall =
      msg?.role === "assistant" &&
      Array.isArray(msg?.tool_calls) &&
      (msg?.tool_calls?.length ?? 0) > 0;
    if (isAssistantToolCall) {
      const callIds = new Set((msg?.tool_calls ?? []).map((c) => c.id));
      let j = i + 1;
      while (
        j < messages.length &&
        messages[j]?.role === "tool" &&
        callIds.has(messages[j]?.tool_call_id ?? "")
      ) {
        j += 1;
      }
      const slice = messages.slice(i, j);
      groups.push({
        startIndex: i,
        endIndex: j - 1,
        tokens: estimator.estimateMessages(slice),
        isToolGroup: true,
        messages: slice,
      });
      i = j;
    } else {
      const slice = messages.slice(i, i + 1);
      groups.push({
        startIndex: i,
        endIndex: i,
        tokens: estimator.estimateMessages(slice),
        isToolGroup: false,
        messages: slice,
      });
      i += 1;
    }
  }
  return groups;
}

/**
 * Split atomic groups into deterministic, budgeted chunks. Groups are taken
 * greedily in order; a group that would exceed the remaining budget starts a
 * new chunk. A single group larger than the whole budget forms its own chunk
 * (the caller decides how to reduce it). Chunk boundaries are identical for
 * identical input — no repository iteration order dependence.
 *
 * Returns an empty array when there are no groups. Each chunk is a non-empty
 * slice of groups with its token total.
 */
export function chunkGroupsByBudget(
  groups: readonly AIChatMessageGroup[],
  usablePayloadTokens: number
): ReadonlyArray<{
  readonly groups: readonly AIChatMessageGroup[];
  readonly tokens: number;
}> {
  if (groups.length === 0) return [];
  const capacity = usablePayloadTokens > 0 ? usablePayloadTokens : 1;
  const chunks: {
    groups: AIChatMessageGroup[];
    tokens: number;
  }[] = [];
  let current: AIChatMessageGroup[] = [];
  let currentTokens = 0;
  const flush = (): void => {
    if (current.length > 0) {
      chunks.push({ groups: current, tokens: currentTokens });
      current = [];
      currentTokens = 0;
    }
  };
  for (const group of groups) {
    if (current.length > 0 && currentTokens + group.tokens > capacity) {
      flush();
    }
    current.push(group);
    currentTokens += group.tokens;
    // If a single group exceeds capacity, it must still flush on its own so a
    // caller can reduce it deterministically rather than merging neighbors.
    if (group.tokens >= capacity) {
      flush();
    }
  }
  flush();
  return chunks;
}
