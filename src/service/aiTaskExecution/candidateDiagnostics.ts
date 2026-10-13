/**
 * Candidate diagnostics (T21, FR-05/06/16; NFR-06/10/11; AC-12/30).
 *
 * The four consult sites (loop `maybeConsultPolicy`, `TaskLoopConsult`,
 * engine `finalizeManualAtCompleteGate` fallback, scheduled sink fallback)
 * used to hardcode `provenance: "provider", streamTerminalSeen: true,
 * safetyRestriction: false` regardless of what the accumulator/transport
 * actually observed. A unit test's manually supplied terminal boolean is
 * not proof of actual stream provenance (audit T21 evidence). This module
 * derives the trust fields from real signals so a `length`/`error`/`null`
 * finishReason or a content-filter refusal surfaces honestly instead of
 * being stamped "provider terminal, no restriction".
 *
 * Pure: no I/O, no side effects, no LLM. The refusal probe is a conservative
 * leading-text check for canonical refusal openers ("I cannot", "I'm unable
 * to", "I can't help") — the OpenAI stream delta has no `refusal` field, so
 * refusal must be detected via finishReason/content diagnostics, not a
 * nonexistent field (verified against `OpenAIStreamDelta` / `OpenAIChat
 * CompletionChoice`).
 */
import type { TaskEndCandidate } from "@/entityTypes/aiTaskExecutionTypes";
import type { AIChatRecoveryReason } from "@/service/AIChatRecoveryTypes";

/**
 * Input to {@link deriveCandidateDiagnostics}. Every field comes from real
 * accumulator/transport state — never a hardcoded trust flag.
 */
export interface CandidateDiagnosticsInput {
  /** The accumulator's `finishReason` (OpenAI `finish_reason`). null = missing. */
  readonly finishReason: string | null;
  /** The accumulator's full text content (refusal probe reads the opener). */
  readonly content: string;
  /**
   * True when the transport threw before a terminal delta arrived (an error
   * truncated the stream). Forces `streamTerminalSeen: false` and
   * `provenance: "unknown"` — the stream never proved a provider terminal.
   */
  readonly hadTransportError?: boolean;
  /**
   * Classified recovery reason from the engine's failed path, when present.
   * Non-retryable reasons (auth/quota/non_recoverable) are surfaced so the
   * controller can map them to distinct permanent-error codes instead of a
   * generic STREAM_INCOMPLETE.
   */
  readonly recoveryReason?: AIChatRecoveryReason | null;
}

/**
 * The three trust fields the consult sites used to hardcode. Derived from
 * {@link CandidateDiagnosticsInput} — never assumed.
 */
export interface CandidateDiagnostics {
  readonly provenance: TaskEndCandidate["provenance"];
  readonly streamTerminalSeen: boolean;
  readonly safetyRestriction: boolean;
}

/**
 * Finish reasons the OpenAI API documents as terminal. A `null`/missing or
 * unrecognized value means the stream did not prove a provider terminal —
 * `streamTerminalSeen` is false and provenance degrades to "unknown".
 */
const RECOGNIZED_PROVIDER_TERMINALS = new Set([
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "function_call",
]);

/**
 * Conservative refusal openers. The OpenAI stream has no `refusal` field, so a
 * content-filter refusal is detected via `finishReason === "content_filter"`
 * OR content that opens with a canonical refusal phrase. This is intentionally
 * narrow (leading-text only) to avoid false positives on legitimate text that
 * merely contains "can't".
 */
const REFUSAL_OPENERS = [
  "i cannot",
  "i can't",
  "i can not",
  "i'm unable to",
  "i am unable to",
  "i'm not able to",
  "i can’t",
  "i won't",
  "i will not",
  "sorry, i can't",
  "sorry, i cannot",
  "sorry, but i can't",
  "unfortunately, i can't",
  "unfortunately, i cannot",
  "i'm sorry, but i can't",
  "i'm sorry, but i cannot",
] as const;

/**
 * True when the content opens with a canonical refusal phrase. Leading
 * whitespace is ignored. Case-insensitive on the ASCII opener; CJK refusal
 * openers (申し訳ありません/对不起) are not probed here because CJK refusal
 * phrasing is too varied to match conservatively — the `content_filter`
 * finishReason is the authoritative signal and is checked separately.
 */
function looksLikeRefusal(content: string): boolean {
  const trimmed = content.trimStart().toLowerCase();
  if (trimmed.length === 0) return false;
  return REFUSAL_OPENERS.some((opener) => trimmed.startsWith(opener));
}

/**
 * Derive the three trust fields from actual accumulator/transport state.
 *
 * Precedence:
 *   1. `hadTransportError` → `streamTerminalSeen: false`, `provenance:
 *      "unknown"` (the stream was truncated; we cannot attribute a provider
 *      terminal). `safetyRestriction` is still probed from content — a
 *      content_filter refusal emitted right before a transport error still
 *      surfaces.
 *   2. `finishReason === "content_filter"` → `safetyRestriction: true`.
 *   3. Content refusal opener → `safetyRestriction: true` (belt-and-suspenders
 *      for providers that emit refusal text without a content_filter
 *      finishReason).
 *   4. `finishReason` is a recognized terminal → `streamTerminalSeen: true`,
 *      `provenance: "provider"`.
 *   5. `finishReason` is null/missing/unrecognized → `streamTerminalSeen:
 *      false`, `provenance: "unknown"` (missing terminal — STREAM_INCOMPLETE
 *      downstream).
 *
 * `recoveryReason` does NOT change `provenance`/`streamTerminalSeen` — it is
 * read by the controller separately to map auth/quota/non-recoverable to
 * distinct permanent-error reason codes. It is surfaced here only so callers
 * can thread it through the candidate's context without a second pass.
 */
export function deriveCandidateDiagnostics(
  input: CandidateDiagnosticsInput
): CandidateDiagnostics {
  const safetyRestriction =
    input.finishReason === "content_filter" || looksLikeRefusal(input.content);

  if (input.hadTransportError) {
    return {
      provenance: "unknown",
      streamTerminalSeen: false,
      safetyRestriction,
    };
  }

  const isRecognizedTerminal =
    input.finishReason !== null &&
    RECOGNIZED_PROVIDER_TERMINALS.has(input.finishReason);

  if (!isRecognizedTerminal) {
    return {
      provenance: "unknown",
      streamTerminalSeen: false,
      safetyRestriction,
    };
  }

  return {
    provenance: "provider",
    streamTerminalSeen: true,
    safetyRestriction,
  };
}
