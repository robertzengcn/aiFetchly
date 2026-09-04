import { createHash } from "node:crypto";
import type {
  OutboundEmailIntentDecision,
  OutboundEmailIntentEvidence,
  OutboundEmailDeliveryMode,
  OutboundEmailIntentReasonCode,
  ResolveOutboundEmailIntentInput,
} from "@/entityTypes/outboundEmailDeliveryTypes";
import { outboundEmailIntentEvidenceSchema } from "@/entityTypes/outboundEmailDeliveryTypes";
import {
  OUTBOUND_RESOLVER_VERSION,
  OUTBOUND_SEND_NOW_MIN_CONFIDENCE,
} from "@/service/outboundEmail/outboundReliabilityVersions";
import {
  SEND_PHRASES,
  REVIEW_PHRASES,
  NEGATION_PHRASES,
  AFFIRMATION_PHRASES,
  CONFIRMATION_QUESTION_MARKERS,
  type OutboundIntentPhraseLang,
} from "@/service/outboundEmail/outboundIntentPhrases";

/**
 * Deterministic outbound-email intent resolver (technical design §9).
 *
 * SECURITY PROPERTIES (do not weaken):
 *  - Input is ONLY user-authored text and, for the contextual-affirmation
 *    path, the immediately preceding assistant confirmation question. Tool
 *    results, retrieved documents, attachments, system prompts, and general
 *    assistant statements are NEVER inputs (§22.2).
 *  - Review and negation wording ALWAYS overrides send wording (AD-002).
 *  - Ambiguity resolves to `draft_only` — the safe default (AD-001).
 *  - The resolver is pure: no DB, no model calls, no side effects. Versioned
 *    via OUTBOUND_RESOLVER_VERSION so every decision is auditable.
 */
export class OutboundEmailIntentResolver {
  /**
   * Resolve the delivery intent for one user message. Pure function;
   * deterministic for identical input.
   */
  static resolve(
    input: ResolveOutboundEmailIntentInput
  ): OutboundEmailIntentDecision {
    const normalized = normalizeForMatching(input.userAuthoredText);

    // Stage 3-5: detect phrase categories. Earlier (longer-context) evidence
    // wins per category; we collect ALL matches so conflicts are visible.
    const negation = findEvidence(normalized, NEGATION_PHRASES, "negation");
    const review = findEvidence(normalized, REVIEW_PHRASES, "review");
    const send = findEvidence(normalized, SEND_PHRASES, "send");
    const affirmation = findEvidence(
      normalized,
      AFFIRMATION_PHRASES,
      "affirmation"
    );

    // Stage 6: contextual affirmation only when the previous assistant
    // message asked an explicit send-confirmation question.
    const confirmationQuestionActive =
      input.previousAssistantText !== null &&
      input.previousAssistantMessageId !== null &&
      looksLikeSendConfirmationQuestion(
        normalizeForMatching(input.previousAssistantText)
      );

    // Send/review matches that fall INSIDE a negated clause ("don't send the
    // emails") are part of that negation, not a second instruction. Absorb
    // overlapping matches so one negated sentence is not misread as a
    // conflict between two separate instructions.
    const effectiveSend = send.filter((s) => !overlapsAny(s, negation));
    const effectiveReview = review.filter((r) => !overlapsAny(r, negation));

    // Stage 7: precedence — negation > review > send > affirmation > ambiguous.
    let mode: OutboundEmailDeliveryMode;
    let reasonCode: OutboundEmailIntentReasonCode;
    let evidence: OutboundEmailIntentEvidence[];
    let confidence: number;

    if (
      negation.length > 0 &&
      (effectiveSend.length > 0 || effectiveReview.length > 0)
    ) {
      // Explicit conflict: the user both asked to send and said not to.
      // Never authorize delivery on conflicting wording.
      mode = "draft_only";
      reasonCode = "conflicting_instruction";
      evidence = [
        ...negation,
        ...effectiveSend.slice(0, 1),
        ...effectiveReview.slice(0, 1),
      ];
      confidence = 0.99;
    } else if (negation.length > 0) {
      mode = "draft_only";
      reasonCode = "explicit_do_not_send";
      evidence = negation;
      confidence = 0.99;
    } else if (effectiveReview.length > 0) {
      if (effectiveSend.length > 0) {
        // "Send X but let me review first" → review wins (AD-002).
        mode = "review_first";
        reasonCode = "conflicting_instruction";
        evidence = [...effectiveReview, ...effectiveSend.slice(0, 1)];
        confidence = 0.95;
      } else {
        mode = "review_first";
        reasonCode = "explicit_review_instruction";
        evidence = effectiveReview;
        confidence = 0.95;
      }
    } else if (effectiveSend.length > 0) {
      mode = "send_now";
      reasonCode = "explicit_send_instruction";
      evidence = effectiveSend;
      confidence = Math.max(
        OUTBOUND_SEND_NOW_MIN_CONFIDENCE,
        Math.min(1, 0.9 + Math.min(0.1, effectiveSend.length * 0.02))
      );
      if (confidence > 1) confidence = 1;
    } else if (affirmation.length > 0 && confirmationQuestionActive) {
      // "yes" answering "Send batch 42 now?" authorizes THIS send.
      mode = "send_now";
      reasonCode = "contextual_affirmation";
      evidence = affirmation;
      confidence = 0.9;
    } else {
      // Ambiguous or no delivery-related wording at all → drafts only.
      mode = "draft_only";
      reasonCode = "ambiguous_instruction";
      evidence = [];
      confidence = 0.5;
    }

    // Evidence sanity: offsets must always refer back into the source text.
    const sourceLength = input.userAuthoredText.length;
    for (const e of evidence) {
      if (e.start < 0 || e.end > sourceLength || e.end < e.start) {
        // Defensive: a normalization bug must never produce bogus evidence.
        evidence = [];
        mode = "draft_only";
        reasonCode = "resolver_failure";
        confidence = 0.5;
        break;
      }
    }

    return {
      id: 0,
      conversationId: input.conversationId,
      sourceUserMessageId: input.sourceUserMessageId,
      mode,
      reasonCode,
      confidence,
      evidence,
      resolverVersion: OUTBOUND_RESOLVER_VERSION,
      sourceTextHash: hashUserAuthoredText(input.userAuthoredText),
      createdAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

interface NormalizedText {
  /** NFKC-normalized, case-folded, whitespace-collapsed text for matching. */
  matching: string;
  /**
   * offsetMap[i] = index into the ORIGINAL userAuthoredText corresponding to
   * the start of matching[i]. Used to map match offsets back to original
   * positions for evidence spans. offsetMap has matching.length + 1 entries.
   */
  offsetMap: number[];
}

function normalizeForMatching(text: string): NormalizedText {
  // Stage 1: NFKC normalization (fullwidth → ascii, compatibility forms).
  const nfkc = text.normalize("NFKC");
  // Stage 2: lowercase + collapse runs of whitespace to single spaces. We keep
  // an offset map so evidence spans still point into the original text.
  const lowered = nfkc.toLowerCase();
  const offsetMap: number[] = [];
  let out = "";
  let prevWasSpace = false;
  for (let i = 0; i < lowered.length; i++) {
    const ch = lowered[i];
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (!prevWasSpace) {
        offsetMap.push(i);
        out += " ";
      }
      prevWasSpace = true;
    } else {
      offsetMap.push(i);
      out += ch;
      prevWasSpace = false;
    }
  }
  offsetMap.push(lowered.length);
  return { matching: out, offsetMap };
}

// ---------------------------------------------------------------------------
// Phrase matching with offset mapping
// ---------------------------------------------------------------------------

type PhraseCategory = OutboundEmailIntentEvidence["category"];
type PhraseDictionary = Record<OutboundIntentPhraseLang, string[]>;

function findEvidence(
  normalized: NormalizedText,
  dictionary: PhraseDictionary,
  category: PhraseCategory
): OutboundEmailIntentEvidence[] {
  const found: OutboundEmailIntentEvidence[] = [];
  const seenSpans = new Set<string>();

  for (const lang of Object.keys(dictionary) as OutboundIntentPhraseLang[]) {
    for (const phrase of dictionary[lang]) {
      const needle = normalizeForMatching(phrase).matching;
      if (!needle) continue;
      let from = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const idx = normalized.matching.indexOf(needle, from);
        if (idx < 0) break;
        const start = normalized.offsetMap[idx];
        const end = normalized.offsetMap[idx + needle.length - 1] + 1;
        const key = `${start}:${end}`;
        if (!seenSpans.has(key)) {
          seenSpans.add(key);
          const candidate = {
            start,
            end,
            normalizedPhrase: needle,
            category,
          };
          // Validate at the boundary — evidence shape is persisted.
          const parsed = outboundEmailIntentEvidenceSchema.safeParse(candidate);
          if (parsed.success) {
            found.push(parsed.data);
          }
        }
        from = idx + needle.length;
      }
    }
  }

  // Longest match first for stable, deterministic ordering.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  return found;
}

/**
 * A previous assistant message counts as a send-confirmation question only
 * when it names the send action explicitly (§9.2 stage 6, §9.4). A generic
 * statement like "The batch is ready" must never turn a bare "yes" into a
 * send authorization.
 */
function looksLikeSendConfirmationQuestion(
  normalizedAssistant: NormalizedText
): boolean {
  for (const lang of Object.keys(
    CONFIRMATION_QUESTION_MARKERS
  ) as OutboundIntentPhraseLang[]) {
    for (const marker of CONFIRMATION_QUESTION_MARKERS[lang]) {
      const needle = normalizeForMatching(marker).matching;
      if (needle && normalizedAssistant.matching.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when the evidence span overlaps ANY span in the target list. Used to
 * detect when a send/review phrase sits inside a negated clause ("don't send
 * the emails") so it is absorbed as part of the negation rather than read as a
 * separate, conflicting instruction.
 */
function overlapsAny(
  evidence: OutboundEmailIntentEvidence,
  targets: OutboundEmailIntentEvidence[]
): boolean {
  return targets.some((t) => evidence.start < t.end && evidence.end > t.start);
}

// ---------------------------------------------------------------------------
// Source-text hashing
// ---------------------------------------------------------------------------

/**
 * SHA-256 of the canonical user-authored text (NFKC, trailing whitespace
 * trimmed, line endings normalized to \n). Hashing the NORMALIZED form makes
 * the decision auditable without storing raw conversation text, while trivial
 * whitespace edits still produce a stable, comparable hash.
 */
export function hashUserAuthoredText(text: string): string {
  const canonical = text
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
