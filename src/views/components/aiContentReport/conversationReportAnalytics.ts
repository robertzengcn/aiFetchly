/**
 * Renderer analytics for conversation reporting (design §19.1, PRD §19.1).
 *
 * Privacy boundary: events carry ONLY allowlisted metadata — surface, an
 * item-count bucket, and the user-context-enabled boolean. They NEVER carry
 * report text, comments, image bytes, message/conversation/report identifiers,
 * model output, category, or any other content. The type system enforces this:
 * `ConversationReportAnalyticsEvent` has no field into which content could be
 * placed, and the public `emitConversationReportAnalytics` accepts nothing else.
 *
 * Sink routing (design §19.1): there is no approved renderer analytics sink
 * yet. Per the design, we OMIT the event rather than writing report-related
 * identifiers or content to the console. This module is the single wiring
 * point: when an approved sink lands, only `dispatch` changes — every call
 * site and the allowlist contract stay unchanged.
 */

import type { AIConversationReportSurface } from "@/entityTypes/aiContentReportTypes";

/**
 * The two open/scope events the renderer may emit (design §19.1). These are
 * metadata-only; the type deliberately exposes no field that could hold
 * identifiers or content.
 */
export type ConversationReportAnalyticsEventName =
  | "ai_conversation_report_opened"
  | "ai_conversation_report_scope_changed";

/**
 * Allowlisted properties for an open/scope event (design §19.1):
 *   - surface: which chat surface the report was opened on;
 *   - eligibleCountBucket: coarse bucket of the eligible item count;
 *   - userContextEnabled: whether the related-user opt-in is on.
 * App version is permitted only when obtained through an approved analytics
 * source — it is intentionally absent here until such a source exists.
 */
export interface ConversationReportAnalyticsEvent {
  readonly surface: AIConversationReportSurface;
  readonly eligibleCountBucket: ConversationReportEligibleCountBucket;
  readonly userContextEnabled: boolean;
}

/**
 * Coarse item-count buckets for analytics (design §19.1, §15). Counts are
 * bucketed so an observer of the event cannot reconstruct how many messages a
 * conversation contains beyond a coarse band.
 *
 *   0       — no eligible outputs (should not happen for "opened", but typed
 *             for completeness);
 *   1        — exactly one;
 *   2-3      — small;
 *   4-6      — medium;
 *   7-10     — large (capped at the desktop maxAIItems of 10 on Chat V2);
 *   10+     — very large (legacy/knowledge surfaces with long histories).
 */
export type ConversationReportEligibleCountBucket =
  | "0"
  | "1"
  | "2-3"
  | "4-6"
  | "7-10"
  | "10+";

/** Bucket a raw eligible-item count into the coarse analytics band. */
export function bucketEligibleCount(
  count: number
): ConversationReportEligibleCountBucket {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 3) return "2-3";
  if (count <= 6) return "4-6";
  if (count <= 10) return "7-10";
  return "10+";
}

/**
 * Dispatch an allowlisted analytics event. Today this is a no-op stub: there
 * is no approved renderer analytics sink, and design §19.1 forbids using
 * `console.info` for report analytics. Wiring a real sink means replacing
 * only this function — the call sites and the allowlist contract are stable.
 *
 * The argument is typed `ConversationReportAnalyticsEvent`, so it is
 * impossible to pass report content, identifiers, or any non-allowlisted
 * property through this function even before a sink exists.
 */
export function emitConversationReportAnalytics(
  event: ConversationReportAnalyticsEventName,
  props: ConversationReportAnalyticsEvent
): void {
  // No-op until an approved renderer analytics sink is available (§19.1).
  // Intentionally does NOT console.info — report analytics must not land in
  // the browser console or searchable logs. The parameters are consumed by a
  // `void` discard so the signature stays ready for a real sink without
  // tripping the unused-arg lint rule.
  void event;
  void props;
}
