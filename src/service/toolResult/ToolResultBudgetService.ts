import "reflect-metadata";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import {
  ENVELOPE_FRAMING_TOKENS,
  countTextTokens,
  utf8ByteLength,
} from "@/service/ToolResultTextUtil";
import type { ToolResultErrorCode } from "@/entityTypes/toolResultTypes";

/**
 * One counting and allocation contract for every tool-result body
 * (technical design §7).
 *
 * The design's warning is the point of this file existing as a single shared
 * service: "the implementation must reconcile existing token estimators and
 * budget-sensitive paths so one layer cannot approve data that another omits".
 * Preparation, retrieval pages, aggregate reduction, and the final request
 * preflight all call {@link countTokens} here.
 *
 * COUNTING IS DELIBERATELY CONSERVATIVE. The fallback charges one token per
 * UTF-8 byte rather than the usual bytes/4, because bytes/4 UNDER-counts
 * languages that pack more meaning per token and would let a request through
 * that the provider then rejects. This is an upper bound, not a claim of exact
 * provider usage.
 */

/** Model limits resolved by the existing catalog, with provenance. */
export interface BudgetModelLimits {
  readonly contextLimit: number;
  readonly outputLimit: number;
}

/** Fraction of context kept as a safety allowance (existing repo policy). */
const SAFETY_MARGIN_FRACTION = 0.1;

/** One tool-result body competing for the shared allocation. */
export interface ResultBody {
  /** Stable identity of the execution this body belongs to. */
  readonly key: string;
  /** The current model-facing text for this result. */
  readonly content: string;
  /** True when the body is already a receipt rather than raw output. */
  readonly isReceipt: boolean;
  /** Optional preview that may be dropped first under pressure. */
  readonly preview?: string;
}

/** Allocation figures for one dispatch attempt (design §7.2). */
export interface ResultAllocation {
  /** U = max(0, C - O - M): usable input capacity. */
  readonly usableInputCapacity: number;
  /** R = max(0, U - I_fixed): room left after everything else. */
  readonly remainingAfterFixed: number;
  /** B_results = min(floor(0.25 * U), R): shared result allowance. */
  readonly resultsBudget: number;
  /** T_inline = min(2000, floor(0.10 * U), allocated). */
  readonly perInlineResultTokens: number;
  /** True when the request cannot fit even without tool-result bodies. */
  readonly fixedContentExhaustsCapacity: boolean;
}

/** Result of reducing tool-result bodies for one dispatch. */
export interface ReductionResult {
  readonly bodies: readonly ResultBody[];
  /** True when at least one inline body became a receipt. */
  readonly reducedAny: boolean;
  readonly totalTokensBefore: number;
  readonly totalTokensAfter: number;
  readonly errorCode?: ToolResultErrorCode;
}

/** Decide the per-request model budgets (design §7.2). */
export class ToolResultBudgetService {
  /**
   * Compute the allocation for one attempt.
   *
   * `fixedInputTokens` is I_fixed: everything except tool-result CONTENT
   * BODIES - their framing, the tool-call arguments, tool schemas, system and
   * user content, and images are all included, so reducing a result body is
   * the only lever this function accounts for.
   */
  allocate(input: {
    readonly limits: BudgetModelLimits;
    readonly outputReserve: number;
    readonly fixedInputTokens: number;
  }): ResultAllocation {
    const config = TOOL_RESULT_CONFIG;
    const C = input.limits.contextLimit;
    const M = Math.ceil(SAFETY_MARGIN_FRACTION * C);
    const O = Math.min(input.outputReserve, input.limits.outputLimit);
    const U = Math.max(0, C - O - M);
    const R = Math.max(0, U - input.fixedInputTokens);
    const resultsBudget = Math.min(Math.floor(config.resultInputFraction * U), R);
    const perInline = Math.min(
      config.inlineMaxTokens,
      Math.floor(config.inlineTokenFraction * U),
      resultsBudget
    );
    return {
      usableInputCapacity: U,
      remainingAfterFixed: R,
      resultsBudget,
      perInlineResultTokens: Math.max(0, perInline),
      // If the fixed content alone exceeds usable capacity, externalizing more
      // output cannot save the request; it needs compaction or a real error.
      fixedContentExhaustsCapacity: input.fixedInputTokens > U,
    };
  }

  /** Count one body, including its envelope framing AND its optional preview. */
  countTokens(body: Pick<ResultBody, "content" | "preview">): number {
    const content = countTextTokens(body.content, ENVELOPE_FRAMING_TOKENS);
    // The preview is part of what the model actually receives, so it MUST be
    // counted here. Excluding it would let the reducer believe it had already
    // freed that space and stop before the request actually fit.
    const preview = body.preview
      ? countTextTokens(body.preview, ENVELOPE_FRAMING_TOKENS)
      : 0;
    return content + preview;
  }

  /** True when a body is small enough to stay inline right now. */
  isEligibleInline(
    body: ResultBody,
    allocation: ResultAllocation
  ): boolean {
    if (body.isReceipt) return true;
    if (utf8ByteLength(body.content) > TOOL_RESULT_CONFIG.inlineMaxBytes) {
      return false;
    }
    return this.countTokens(body) <= allocation.perInlineResultTokens;
  }

  /**
   * Reduce bodies until the shared allowance is met (design §7.3).
   *
   * Order matters and is deliberate:
   *   1. drop optional PREVIEWS first - they are the least load-bearing part
   *      of a receipt and the design allocates preview space last,
   *   2. then externalize whole inline bodies, LARGEST FIRST, because removing
   *      the biggest body buys the most space per conversion.
   *
   * A body that is already a receipt is never removed: mandatory tool-call /
   * result pairing must survive, and the design forbids dropping a result or
   * inventing argument history to make room.
   */
  reduce(input: {
    readonly bodies: readonly ResultBody[];
    readonly allocation: ResultAllocation;
    /** Called for each body that must become a receipt. */
    readonly externalize: (body: ResultBody) => ResultBody;
  }): ReductionResult {
    const before = input.bodies.reduce((sum, b) => sum + this.countTokens(b), 0);
    const working = input.bodies.map((b) => ({ ...b }));
    let total = working.reduce((sum, b) => sum + this.countTokens(b), 0);
    let reducedAny = false;

    if (total <= input.allocation.resultsBudget) {
      return {
        bodies: working,
        reducedAny,
        totalTokensBefore: before,
        totalTokensAfter: total,
      };
    }

    if (input.allocation.fixedContentExhaustsCapacity) {
      // Nothing about tool-result size can fix this request. Report the real
      // cause instead of silently stripping results.
      return {
        bodies: working,
        reducedAny,
        totalTokensBefore: before,
        totalTokensAfter: total,
        errorCode: "CONTEXT_REQUIRED_CONTENT_TOO_LARGE",
      };
    }

    // Step 1: drop optional previews.
    for (let i = 0; i < working.length; i += 1) {
      const body = working[i];
      if (total <= input.allocation.resultsBudget) break;
      if (!body.preview) continue;
      const previewTokens = countTextTokens(body.preview, ENVELOPE_FRAMING_TOKENS);
      working[i] = { ...body, preview: undefined };
      total -= previewTokens;
      reducedAny = true;
    }

    // Step 2: externalize the largest inline bodies first.
    //
    // Progress guard: if a pass externalizes a body but `total` does not
    // decrease (e.g. the caller's `externalize` callback is a no-op because
    // preparation already ran this turn and there is nothing further to move
    // out-of-line), the next pass would pick the same body again and the loop
    // would never terminate. Detect a no-progress pass and break so the
    // post-loop check surfaces the truthful CONTEXT_REQUIRED_CONTENT_TOO_LARGE
    // error instead of spinning forever.
    let previousTotal = total;
    while (total > input.allocation.resultsBudget) {
      let targetIndex = -1;
      let targetTokens = 0;
      for (let i = 0; i < working.length; i += 1) {
        const body = working[i];
        if (body.isReceipt) continue;
        const tokens = this.countTokens(body);
        if (tokens > targetTokens) {
          targetTokens = tokens;
          targetIndex = i;
        }
      }
      if (targetIndex < 0) break;
      const before_ = working[targetIndex];
      const receipt = input.externalize(before_);
      total -= targetTokens - this.countTokens(receipt);
      working[targetIndex] = receipt;
      reducedAny = true;
      if (total >= previousTotal) break;
      previousTotal = total;
    }

    if (total > input.allocation.resultsBudget) {
      // The bodies still do not fit after every available reduction. Say so
      // truthfully instead of removing a result or altering a call id: this
      // covers both "every body is already a receipt" and "the externalize
      // callback could not shrink any body further".
      return {
        bodies: working,
        reducedAny,
        totalTokensBefore: before,
        totalTokensAfter: total,
        errorCode: "CONTEXT_REQUIRED_CONTENT_TOO_LARGE",
      };
    }

    return {
      bodies: working,
      reducedAny,
      totalTokensBefore: before,
      totalTokensAfter: total,
    };
  }

  /**
   * Check the final serialized request against the transport ceiling.
   *
   * A model's CONTEXT size is not a transport-size limit, so the body is
   * measured separately. Images are never silently dropped to fit: the caller
   * receives a specific code and decides.
   */
  checkSerializedBody(input: {
    readonly messages: readonly { content?: string | null }[];
    readonly toolsJson?: string;
    readonly ceilingBytes?: number;
  }): { ok: boolean; bytes: number; errorCode?: "REQUEST_BODY_TOO_LARGE" } {
    const ceiling = input.ceilingBytes ?? TOOL_RESULT_CONFIG.unknownTransportMaxBytes;
    let bytes = 0;
    for (const message of input.messages) {
      if (typeof message.content === "string") {
        bytes += utf8ByteLength(message.content);
      }
      bytes += ENVELOPE_FRAMING_TOKENS;
    }
    if (input.toolsJson) bytes += utf8ByteLength(input.toolsJson);
    if (bytes > ceiling) {
      return { ok: false, bytes, errorCode: "REQUEST_BODY_TOO_LARGE" };
    }
    return { ok: true, bytes };
  }
}
