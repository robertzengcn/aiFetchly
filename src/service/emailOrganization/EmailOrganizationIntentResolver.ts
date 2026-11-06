import type {
  EmailOrganizationIntentDecision,
  EmailOrganizationIntentMode,
} from "@/entityTypes/emailOrganizationTypes";

/**
 * Pure, deterministic intent classification for organization requests
 * (technical design §8.1). Inputs are user-authored text only — never
 * email content, tool results or model arguments (invariant 8).
 *
 * Precedence mirrors the outbound resolver: negation > review/draft > send.
 * Ambiguity degrades to `draft_only` (safe default). The content-generation
 * model cannot upgrade intent: mutating tools remain separately gated.
 */

export const EMAIL_ORGANIZATION_RESOLVER_VERSION = "eorg-intent-v1";

type PhraseSet = readonly string[];

const SEND_PHRASES: PhraseSet = [
  "forward it",
  "forward this",
  "forward that",
  "forward the email",
  "forward the message",
  "forward this email",
  "forward this message",
  "send it now",
  "send this now",
  "send it",
  "send now",
  "delete it",
  "delete this",
  "delete that",
  "delete the email",
  "delete the message",
  "move it to trash",
  "move this to trash",
  "move that to trash",
  "move it to the trash",
  "move this to the trash",
  "trash it",
  "trash this",
  "trash that",
  "restore it",
  "restore this",
  "restore that",
  "undo that deletion",
  "undo the deletion",
  "undo that",
  "undo this",
];

const REVIEW_PHRASES: PhraseSet = [
  "show me before",
  "show me first",
  "let me review",
  "for my review",
  "before forwarding",
  "before sending",
  "review first",
  "prepare a review",
  "先给我看",
  "先让我",
];

const DRAFT_PHRASES: PhraseSet = [
  "draft a forward",
  "draft the forward",
  "draft a forward to",
  "prepare a draft",
  "prepare the draft",
  "just a draft",
  "draft only",
  "don't send",
  "do not send",
  "without sending",
  "草稿",
  "不要发送",
];

const NEGATION_PHRASES: PhraseSet = [
  "don't forward",
  "do not forward",
  "don't delete",
  "do not delete",
  "don't send",
  "do not send",
  "don't trash",
  "do not trash",
  "don't move",
  "do not move",
  "do not move this",
  "不要转发",
  "不要删除",
  "不要移动",
  "не пересылать",
  "ne pas transférer",
  "no reenvíes",
  "nicht weiterleiten",
  "転送しないで",
];

/** T02: capability questions — information requests, never actions. */
const CAPABILITY_QUESTION_PHRASES: PhraseSet = [
  "can you explain",
  "how do i",
  "how to forward",
  "explain how",
  "what happens when",
  "is it possible to",
  "can this email be forwarded",
  "can emails be forwarded",
  "怎么转发",
  "如何转发",
];

const ACTION_TOPIC_MARKERS: PhraseSet = [
  "forward",
  "trash",
  "delete",
  "restore",
  "undo",
  // R4-12: explicit go-aheads after a review must resolve send_now — the
  // review flow's follow-up ("send it now") was failing the topic check.
  "send it now",
  "send now",
  "转发",
  "删除",
  "恢复",
  "撤销",
  "发送",
  "weiterleiten",
  "löschen",
  "papierkorb",
  "supprimer",
  "corbeille",
  "eliminar",
  "papelera",
  "restaurar",
  "転送",
  "削除",
  "ゴミ箱",
];

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesAny(text: string, phrases: PhraseSet): string | null {
  for (const phrase of phrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (text.includes(normalizedPhrase)) {
      return phrase;
    }
  }
  return null;
}

function hasActionTopic(text: string): boolean {
  return matchesAny(text, ACTION_TOPIC_MARKERS) !== null;
}

/**
 * Classifies the organization intent of one user-authored message.
 * Returns `draft_only` unless a clear send-now or review-first instruction
 * is present within an organization-action context.
 */
export function resolveEmailOrganizationIntent(
  userText: string
): EmailOrganizationIntentDecision {
  const text = normalizeText(userText);

  if (text === "" || !hasActionTopic(text)) {
    return {
      mode: "draft_only",
      reasonCode: "no_action_context",
      confidence: 0.9,
      resolverVersion: EMAIL_ORGANIZATION_RESOLVER_VERSION,
    };
  }

  if (matchesAny(text, NEGATION_PHRASES) !== null) {
    return {
      mode: "draft_only",
      reasonCode: "negated",
      confidence: 0.95,
      resolverVersion: EMAIL_ORGANIZATION_RESOLVER_VERSION,
    };
  }

  // T02: capability questions precede any action phrase — "how do I forward
  // this email?" contains the send phrases but is an information request.
  if (matchesAny(text, CAPABILITY_QUESTION_PHRASES) !== null) {
    return {
      mode: "draft_only",
      reasonCode: "capability_question",
      confidence: 0.9,
      resolverVersion: EMAIL_ORGANIZATION_RESOLVER_VERSION,
    };
  }

  if (matchesAny(text, REVIEW_PHRASES) !== null) {
    return {
      mode: "review_first",
      reasonCode: "explicit_review_request",
      confidence: 0.9,
      resolverVersion: EMAIL_ORGANIZATION_RESOLVER_VERSION,
    };
  }

  if (matchesAny(text, DRAFT_PHRASES) !== null) {
    return {
      mode: "draft_only",
      reasonCode: "explicit_draft_request",
      confidence: 0.9,
      resolverVersion: EMAIL_ORGANIZATION_RESOLVER_VERSION,
    };
  }

  const sendPhrase = matchesAny(text, SEND_PHRASES);
  if (sendPhrase !== null) {
    return {
      mode: "send_now",
      reasonCode: `explicit_send:${sendPhrase}`,
      confidence: 0.85,
      resolverVersion: EMAIL_ORGANIZATION_RESOLVER_VERSION,
    };
  }

  // Topic present but instruction shape unclear → safe default.
  return {
    mode: "draft_only",
    reasonCode: "ambiguous_action_context",
    confidence: 0.6,
    resolverVersion: EMAIL_ORGANIZATION_RESOLVER_VERSION,
  };
}

export function isDirectSendIntent(mode: EmailOrganizationIntentMode): boolean {
  return mode === "send_now";
}
