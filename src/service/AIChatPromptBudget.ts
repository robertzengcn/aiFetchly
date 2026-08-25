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

/**
 * Split a list of summary strings (intermediate compact summaries, or any
 * pre-summarized text blocks) into bounded merge batches using the same
 * greedy budgeting as {@link chunkGroupsByBudget}. Each summary is one
 * indivisible unit for the merge phase — an oversized summary goes alone so
 * the caller can reject or deterministically reduce it rather than silently
 * merging it with neighbors. Used by the recursive hierarchical merge so a
 * reduce request never knowingly exceeds the usable payload budget
 * (tech-design §13.1, §16.2; SMBW-003).
 */
export function chunkSummariesByBudget(
  summaries: readonly string[],
  usablePayloadTokens: number,
  estimator: AIChatTokenEstimator = new AIChatTokenEstimator()
): ReadonlyArray<{
  readonly summaries: readonly string[];
  readonly tokens: number;
}> {
  if (summaries.length === 0) return [];
  const capacity = usablePayloadTokens > 0 ? usablePayloadTokens : 1;
  const chunks: {
    summaries: string[];
    tokens: number;
  }[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  const flush = (): void => {
    if (current.length > 0) {
      chunks.push({ summaries: current, tokens: currentTokens });
      current = [];
      currentTokens = 0;
    }
  };
  for (const s of summaries) {
    const tokens = estimator.estimateText(s);
    if (current.length > 0 && currentTokens + tokens > capacity) {
      flush();
    }
    current.push(s);
    currentTokens += tokens;
    if (tokens >= capacity) {
      flush();
    }
  }
  flush();
  return chunks;
}

/**
 * Estimate the token cost of an auto-dream source packet as the user-prompt
 * payload the model sees: the source header plus each message line plus each
 * tool-summary line. Kept in the budget module so the service and tests share
 * one canonical measure (tech-design §14.2; SMBW-007).
 */
export function estimateAutoDreamPacketTokens(
  packet: {
    readonly title?: string;
    readonly updatedAt?: string;
    readonly messages?: ReadonlyArray<{
      readonly role?: string;
      readonly content?: string;
    }>;
    readonly toolCalls?: ReadonlyArray<{
      readonly toolName?: string;
      readonly status?: string;
      readonly resultSummary?: string;
      readonly errorMessage?: string;
    }>;
  },
  estimator: AIChatTokenEstimator = new AIChatTokenEstimator()
): number {
  const header = `Source id=${packet.title ?? ""} updatedAt=${
    packet.updatedAt ?? ""
  }`;
  const msgs = (packet.messages ?? [])
    .map((m) => `    [${m.role ?? ""}] ${m.content ?? ""}`)
    .join("\n");
  const tools = (packet.toolCalls ?? [])
    .map(
      (t) =>
        `    tool ${t.toolName ?? ""} status=${t.status ?? ""}${
          t.resultSummary ? ` summary=${t.resultSummary}` : ""
        }${t.errorMessage ? ` error=${t.errorMessage}` : ""}`
    )
    .join("\n");
  return estimator.estimateText([header, msgs, tools].join("\n"));
}

/**
 * Estimate the token cost of an active-memory index entry as the user-prompt
 * payload the model sees (id, type, title, content). Auto-dream includes
 * active memories as a compact index so the model can validate update/archive
 * IDs and detect duplicates/contradictions (SMBW-007).
 */
export function estimateActiveMemoryTokens(
  memory: {
    readonly memoryId?: string;
    readonly type?: string;
    readonly title?: string;
    readonly content?: string;
  },
  estimator: AIChatTokenEstimator = new AIChatTokenEstimator()
): number {
  return estimator.estimateText(
    `- id=${memory.memoryId ?? ""} type=${memory.type ?? ""} title="${
      memory.title ?? ""
    }" content="${memory.content ?? ""}"`
  );
}

/**
 * Deterministically reduce an oversized auto-dream packet so it fits the
 * remaining budget. Reduction order (tech-design §14.2): preserve title,
 * source identity, update time, and the newest user/assistant exchange;
 * remove oldest tool summaries first, then oldest message groups, then clamp
 * the remaining longest message as the final step. Returns the reduced
 * packet (a new object — never mutates the input). A packet that still
 * cannot fit its identity + newest exchange alone is reported via the
 * `minimumUsefulFits` flag so the caller fails locally without advancing the
 * cursor (SMBW-007).
 */
export function reduceAutoDreamPacket(
  packet: {
    readonly sourceKind: string;
    readonly sourceId: string;
    readonly updatedAt: string;
    readonly title: string;
    readonly messages: ReadonlyArray<{
      readonly id: string;
      readonly role: string;
      readonly content: string;
    }>;
    readonly toolCalls?: ReadonlyArray<{
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status: string;
      readonly resultSummary?: string;
      readonly errorMessage?: string;
    }>;
  },
  usableTokens: number,
  estimator: AIChatTokenEstimator = new AIChatTokenEstimator()
): {
  readonly packet: {
    readonly sourceKind: string;
    readonly sourceId: string;
    readonly updatedAt: string;
    readonly title: string;
    readonly messages: ReadonlyArray<{
      readonly id: string;
      readonly role: string;
      readonly content: string;
    }>;
    readonly toolCalls?: ReadonlyArray<{
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status: string;
      readonly resultSummary?: string;
      readonly errorMessage?: string;
    }>;
  };
  readonly minimumUsefulFits: boolean;
} {
  const identity = {
    sourceKind: packet.sourceKind,
    sourceId: packet.sourceId,
    updatedAt: packet.updatedAt,
    title: packet.title,
  };
  // Step 1: drop ALL tool summaries (oldest first — order preserved).
  let messages = [...packet.messages];
  let toolCalls: typeof packet.toolCalls = undefined;
  if (
    estimatePacketWith(identity, messages, undefined, estimator) <= usableTokens
  ) {
    return {
      packet: { ...identity, messages, ...(toolCalls ? { toolCalls } : {}) },
      minimumUsefulFits: true,
    };
  }
  // Step 2: drop oldest message groups one at a time, keeping the newest
  // exchange (last two messages) to the end.
  while (messages.length > 1) {
    messages = messages.slice(1);
    if (
      estimatePacketWith(identity, messages, undefined, estimator) <=
      usableTokens
    ) {
      return {
        packet: { ...identity, messages },
        minimumUsefulFits: true,
      };
    }
  }
  // Step 3: clamp the remaining (newest) message's content to fit.
  const only = messages[0]!;
  const headerTokens = estimator.estimateText(
    `Source id=${identity.title} updatedAt=${identity.updatedAt}\n    [${only.role}] `
  );
  const budgetForContent = Math.max(0, usableTokens - headerTokens);
  // 4 chars ≈ 1 token (inverse of the estimator's length/4 heuristic).
  const charBudget = budgetForContent * 4;
  const clampedContent =
    only.content.length <= charBudget
      ? only.content
      : `${only.content.slice(0, Math.max(0, charBudget))}…`;
  const clampedMessages = [{ ...only, content: clampedContent }];
  const fits =
    estimatePacketWith(identity, clampedMessages, undefined, estimator) <=
    usableTokens;
  return {
    packet: { ...identity, messages: clampedMessages },
    minimumUsefulFits: fits,
  };
}

function estimatePacketWith(
  identity: { readonly title: string; readonly updatedAt: string },
  messages: ReadonlyArray<{ readonly role: string; readonly content: string }>,
  toolCalls:
    | ReadonlyArray<{
        readonly toolName?: string;
        readonly status?: string;
        readonly resultSummary?: string;
        readonly errorMessage?: string;
      }>
    | undefined,
  estimator: AIChatTokenEstimator
): number {
  return estimateAutoDreamPacketTokens(
    {
      title: identity.title,
      updatedAt: identity.updatedAt,
      messages,
      toolCalls,
    },
    estimator
  );
}
