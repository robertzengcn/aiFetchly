/**
 * AIChatRequestBudgetService — complete-request token budgeting
 * (technical-design §8).
 *
 * Resolves the effective model limits, conservatively estimates the exact
 * serialized input (message content parts, tool-call arguments, tool results,
 * tool definitions, and framing), and enforces the dispatch invariant
 * `I + O + M <= C` where:
 *
 *   C = selected model context limit
 *   O = requested output reservation (capped by model output limit)
 *   M = safety allowance, default ceil(0.10 * C)
 *   I = conservative UTF-8-byte estimate of the serialized input + framing
 *
 * Usable input capacity is `U = C - O - M`. Compaction triggers at
 * `I >= 0.80 * U` and targets `I <= 0.60 * U` (§8.2).
 *
 * The service is pure and synchronous: it takes an injected model-limit
 * resolver so it can be exercised deterministically in tests and wired to the
 * live `AIChatModelCatalogService` at the call site. Images are never
 * zero-token — `image_url` content parts and the non-standard `images` array
 * are counted conservatively as UTF-8 bytes.
 */

import type { OpenAIChatMessage, OpenAITool } from "@/api/aiChatApi";
import { estimateToolsTokens } from "@/service/ToolPromptBudgetService";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import type { RecoverableHistoryErrorCode } from "@/entityTypes/aiChatArchiveTypes";

/** Where a resolved limit came from (technical-design §8.1). */
export type ModelLimitSource = "provider" | "configured" | "fallback";

/** Effective limits for a resolved model. */
export interface ResolvedModelLimits {
  readonly contextLimit: number;
  readonly outputLimit: number;
  readonly limitSource: ModelLimitSource;
}

/** Injected resolver signature — returns limits for a given model id. */
export type ModelLimitResolver = (model?: string) => ResolvedModelLimits;

/** Fallback limits for unknown text-only models (§8.1). */
export const UNKNOWN_MODEL_FALLBACK_LIMITS: ResolvedModelLimits = {
  contextLimit: 8_192,
  outputLimit: 1_024,
  limitSource: "fallback",
};

/** A default resolver for when the caller injects none (unknown model). */
function fallbackResolver(): ResolvedModelLimits {
  return UNKNOWN_MODEL_FALLBACK_LIMITS;
}

/** Input to a complete-request preflight check. */
export interface RequestBudgetPreflightInput {
  readonly messages: readonly OpenAIChatMessage[];
  readonly tools?: readonly OpenAITool[];
  readonly model?: string;
  /** Requested output reservation (tokens), capped by model output limit. */
  readonly outputReserve: number;
  readonly modelLimitResolver?: ModelLimitResolver;
}

/** Result of a complete-request preflight check. */
export interface RequestBudgetPreflightResult {
  readonly ok: boolean;
  /** The resolved model limits (§8.1). */
  readonly resolvedLimits: ResolvedModelLimits;
  /** Conservative input-token estimate (serialized input + framing). */
  readonly estimatedInputTokens: number;
  /** The effective output reservation after capping to the model output limit. */
  readonly outputReserve: number;
  /** Safety margin M = ceil(0.10 * C). */
  readonly safetyMargin: number;
  /** Usable input capacity U = C - O - M. */
  readonly usableInputCapacity: number;
  /** Compaction trigger threshold I >= 0.80 * U. */
  readonly compactionTriggerThreshold: number;
  /** Compaction target threshold I <= 0.60 * U. */
  readonly compactionTargetThreshold: number;
  /** True when the estimated input crosses the compaction trigger. */
  readonly needsCompaction: boolean;
  /** Set when !ok — a recoverable-history error code. */
  readonly errorCode?: RecoverableHistoryErrorCode;
  /** Human-readable rejection reason (set when !ok). */
  readonly reason?: string;
}

/**
 * Conservative UTF-8-byte token estimate (§8.2): deliberately uses
 * UTF-8 byte length (not characters / 4) so multi-byte content is never
 * under-estimated.
 */
function estimateBytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Estimate tokens from a byte count using the ~4 bytes/token heuristic. */
function bytesToTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/** Per-message framing overhead (§8.2 — names/roles/framing). */
const MESSAGE_FRAMING_TOKENS = 4;

/** Estimate the serialized size of a single content part (bytes). */
function estimateContentPartBytes(part: {
  type: string;
  text?: string;
  image_url?: { url: string };
}): number {
  if (part.type === "text" && typeof part.text === "string") {
    return estimateBytes(part.text);
  }
  if (part.type === "image_url" && part.image_url?.url) {
    // Never zero-token: a data URL can be enormous.
    return estimateBytes(part.image_url.url);
  }
  return 0;
}

/** Estimate the token count of a single message (bytes → tokens + framing). */
function estimateMessageTokens(message: OpenAIChatMessage): number {
  const role = typeof message.role === "string" ? message.role : "";
  let bytes = estimateBytes(role);

  if (typeof message.content === "string") {
    bytes += estimateBytes(message.content);
  } else if (message.content == null) {
    // No content; nothing to count.
    bytes += 0;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      bytes += estimateContentPartBytes(part);
    }
  }

  if (message.tool_call_id) {
    bytes += estimateBytes(message.tool_call_id);
  }
  if (Array.isArray(message.tool_calls)) {
    bytes += estimateBytes(JSON.stringify(message.tool_calls));
  }

  // Non-standard images array carries b64_json / urls — never zero-token.
  if (Array.isArray(message.images)) {
    for (const img of message.images) {
      if (img.b64_json) bytes += estimateBytes(img.b64_json);
      if (img.url) bytes += estimateBytes(img.url);
      if (img.original_url) bytes += estimateBytes(img.original_url);
      if (img.local_path) bytes += estimateBytes(img.local_path);
    }
  }

  return bytesToTokens(bytes) + MESSAGE_FRAMING_TOKENS;
}

/** Input to the §8.3 section-capacity allocator. */
export interface SectionCapacityInput {
  readonly model?: string;
  readonly sectionOutputReserve: number;
  /** Summarization prompt + framing overhead already accounted in the request. */
  readonly promptOverhead: number;
  /** Canonical-state input cost already accounted in the request. */
  readonly stateInputCost: number;
  readonly modelLimitResolver?: ModelLimitResolver;
}

/** Result of the §8.3 section-capacity allocator. */
export interface SectionCapacityResult {
  readonly sourceCapacity: number;
  readonly errorCode?: RecoverableHistoryErrorCode;
}

export class AIChatRequestBudgetService {
  /**
   * Preflight a complete request: resolve limits, estimate input, and enforce
   * `I + O + M <= C`. Returns a structured result; the caller throws on !ok.
   */
  preflight(input: RequestBudgetPreflightInput): RequestBudgetPreflightResult {
    const resolve = input.modelLimitResolver ?? fallbackResolver;
    const limits: ResolvedModelLimits = resolve(input.model);
    const C = limits.contextLimit;
    const M = Math.ceil(AI_CHAT_RECOVERABLE_DEFAULTS.safetyMarginFraction * C);
    // Cap the output reservation to the model's reported output limit.
    const O = Math.min(input.outputReserve, limits.outputLimit);
    const I = this.estimateInputTokens(input);

    const U = C - O - M;
    const trigger = Math.floor(
      AI_CHAT_RECOVERABLE_DEFAULTS.compactionTriggerFraction * U
    );
    const target = Math.floor(
      AI_CHAT_RECOVERABLE_DEFAULTS.compactionTargetFraction * U
    );

    const ok = I + O + M <= C;
    const base: RequestBudgetPreflightResult = {
      ok,
      resolvedLimits: limits,
      estimatedInputTokens: I,
      outputReserve: O,
      safetyMargin: M,
      usableInputCapacity: U,
      compactionTriggerThreshold: trigger,
      compactionTargetThreshold: target,
      needsCompaction: I >= trigger && I + O + M <= C,
    };

    if (!ok) {
      return {
        ...base,
        errorCode: "CONTEXT_REQUIRED_CONTENT_TOO_LARGE",
        reason: `serialized input (${I}) + output (${O}) + safety (${M}) exceeds context (${C})`,
      };
    }
    return base;
  }

  /** Conservative UTF-8-byte estimate of the full serialized input (§8.2). */
  estimateInputTokens(
    input: Pick<RequestBudgetPreflightInput, "messages" | "tools">
  ): number {
    let tokens = 0;
    for (const message of input.messages) {
      tokens += estimateMessageTokens(message);
    }
    if (input.tools) {
      tokens += estimateToolsTokens(input.tools);
    }
    return tokens;
  }

  /**
   * §8.3 — allocate source capacity for one compaction section:
   *
   *   sourceCapacity = min(12000, C - Osection - M - promptOverhead - stateInputCost)
   *
   * A non-positive capacity is an error (COMPACTION_CONTEXT_REJECTED), not
   * permission to send an oversized request.
   */
  allocateSectionCapacity(input: SectionCapacityInput): SectionCapacityResult {
    const resolve = input.modelLimitResolver ?? fallbackResolver;
    const limits: ResolvedModelLimits = resolve(input.model);
    const C = limits.contextLimit;
    const M = Math.ceil(AI_CHAT_RECOVERABLE_DEFAULTS.safetyMarginFraction * C);
    const capacity =
      C -
      input.sectionOutputReserve -
      M -
      input.promptOverhead -
      input.stateInputCost;

    if (capacity <= 0) {
      return {
        sourceCapacity: capacity,
        errorCode: "COMPACTION_CONTEXT_REJECTED",
      };
    }
    return {
      sourceCapacity: Math.min(
        AI_CHAT_RECOVERABLE_DEFAULTS.sectionSourceTargetTokens,
        capacity
      ),
    };
  }
}
