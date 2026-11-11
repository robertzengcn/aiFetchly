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
  // R5-07: ordinary non-English send instructions (zh/es/fr/de/ja).
  "转发给",
  "转发这封",
  "转发一下",
  "现在发送",
  "立即发送",
  "发送它",
  "删掉它",
  "删除这封",
  "删除它",
  "移到废纸篓",
  "移入废纸篓",
  "撤销删除",
  "恢复它",
  "reenvíalo",
  "reenvíalo ahora",
  "reenvíalo ya",
  "envíalo ahora",
  "elimínalo",
  "elimínalo ya",
  "bórralo",
  "muévelo a la papelera",
  "restáuralo",
  "deshaz la eliminación",
  "transfère-le",
  "transfère-le maintenant",
  "envoie-le maintenant",
  "supprime-le",
  "mets-le à la corbeille",
  "restaure-le",
  "annule la suppression",
  "leite es weiter",
  "leite es jetzt weiter",
  "leite es",
  "schick es jetzt",
  "sende es jetzt",
  "lösche es",
  "in den papierkorb verschieben",
  "stelle es wieder her",
  "mache das rückgängig",
  "転送して",
  "今すぐ転送して",
  "今すぐ送って",
  "削除して",
  "ゴミ箱へ移動",
  "元に戻して",
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
  "先看看",
  "发之前给我",
  "muéstramelo antes",
  "déjamelo ver antes",
  "antes de enviar",
  "montre-le-moi avant",
  "montre-moi avant",
  "avant d'envoyer",
  "zeig es mir zuerst",
  "zeig es mir, bevor",
  "bevor du sendest",
  "まず見せて",
  "送る前に見せて",
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
  "只写草稿",
  "先别发送",
  "borrador",
  "solo un borrador",
  "no lo envíes todavía",
  "brouillon",
  "juste un brouillon",
  "entwurf",
  "nur einen entwurf",
  "下書き",
  "まだ送らないで",
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
  "别转发",
  "别删除",
  "别移动",
  "не пересылать",
  "ne pas transférer",
  "no reenvíes",
  "no lo reenvíes",
  "no lo elimines",
  "no lo muevas",
  "ne le supprime pas",
  "ne l'envoie pas",
  "ne le déplace pas",
  "nicht weiterleiten",
  "nicht löschen",
  "nicht senden",
  "nicht verschieben",
  "転送しないで",
  "削除しないで",
  "送らないで",
  "移動しないで",
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
  "可以转发吗",
  "能转发吗",
  "¿se puede reenviar",
  "¿puedo reenviar",
  "peut-on transférer",
  "puis-je transférer",
  "kann weitergeleitet werden",
  "kann ich weiterleiten",
  "転送できますか",
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
  "send it",
  "send this",
  "转发",
  "删除",
  "恢复",
  "撤销",
  "发送",
  "废纸篓",
  "weiterleiten",
  "lösche",
  "papierkorb",
  "supprime",
  "corbeille",
  "leite es",
  "schick es",
  "sende es",
  "stelle es wieder",
  "rückgängig",
  "restaure",
  "annule la suppression",
  "mets-le à la corbeille",
  "eliminar",
  "papelera",
  "restaurar",
  "reenví",
  "envíalo",
  "elimínalo",
  "bórralo",
  "muévelo",
  "restáuralo",
  "deshaz la eliminación",
  "transfèr",
  "転送",
  "削除",
  "ゴミ箱",
  "送って",
  "元に戻し",
];

function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * R5-07 (AC-13 hardening): strips QUOTED/PASTED email content from the
 * trusted current-turn text before intent matching. Reply-quote lines
 * (`> …`) and localized forward/original separator blocks are host-owned
 * shapes — instruction phrases inside them belong to the pasted message,
 * never to the user's own instruction. Residual risk for unquoted pastes
 * is bounded by the payload-unambiguity gate in the chat loop: the direct
 * path only authorizes an exact, single-message payload with explicit
 * recipients, executed once, audited, and (for Trash) undoable.
 */
export function prepareTrustedIntentText(userText: string): string {
  const withoutQuotedLines = userText
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  return withoutQuotedLines
    .replace(
      /-{3,}\s*(original message|forwarded message|original message below|mensaje original|message transféré|weitergeleitete nachricht|転送メッセージ|元のメッセージ|原始邮件|转发的邮件|转发的消息)[\s\S]*$/i,
      "\n"
    );
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

/**
 * R5-07: host-owned payload-unambiguity check for the direct-send path.
 * A trusted current-turn `send_now` may skip the second permission card
 * ONLY when the tool call resolves to ONE exact message with an explicit
 * payload — bulk selections, missing recipients and malformed arguments
 * all refuse (safe default stays review). The model cannot influence this
 * verdict beyond proposing the arguments; the host parses them itself.
 */
export function isUnambiguousDirectSendPayload(
  toolName: string,
  args: unknown
): boolean {
  if (typeof args !== "object" || args === null) return false;
  const record = args as Record<string, unknown>;
  const singleMessageId = (value: unknown): boolean =>
    typeof value === "number" && Number.isInteger(value) && value > 0;
  const explicitAddresses = (value: unknown): boolean =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.trim())
    );

  switch (toolName) {
    case "send_email_forward": {
      // The send call submits ONE frozen draft revision (draft_id +
      // revision_id); the frozen payload binding (recipients, attachments,
      // content hash) lives in that revision and the hash-bound
      // authorization minted inside the tool. Both ids must be exact.
      return (
        singleMessageId(record.draft_id) &&
        singleMessageId(record.revision_id) &&
        record.selection_id === undefined
      );
    }
    case "create_email_forward_draft": {
      // The direct path requires an EXPLICIT payload: exactly one source
      // message and explicit recipient addresses (cc/bcc optional strings).
      if (!singleMessageId(record.message_id)) return false;
      if (!explicitAddresses(record.to)) return false;
      if (
        record.cc !== undefined &&
        !(Array.isArray(record.cc) &&
          record.cc.every((entry) => typeof entry === "string" && entry.trim() !== ""))
      ) {
        return false;
      }
      if (
        record.bcc !== undefined &&
        !(Array.isArray(record.bcc) &&
          record.bcc.every((entry) => typeof entry === "string" && entry.trim() !== ""))
      ) {
        return false;
      }
      return record.selection_id === undefined;
    }
    case "move_email_to_trash":
      // Single-message trash only; bulk selections need the review flow.
      return singleMessageId(record.message_id) && record.selection_id === undefined;
    case "restore_email":
      // Restore binds to ONE recorded operation; a frozen selection needs
      // its own review.
      return (
        typeof record.operation_id === "string" &&
        record.operation_id.length >= 8 &&
        record.selection_id === undefined
      );
    default:
      return false;
  }
}

// ---- R6-01: verb- and payload-bound direct send (AC-01/AC-03/AC-13) ----

/** The action verb a `send_now` sentence actually names. */
export type DirectSendVerb = "forward" | "trash" | "restore";

const FORWARD_VERB_PHRASES: PhraseSet = [
  "forward it", "forward this", "forward that", "forward the email",
  "forward the message", "forward this email", "forward this message",
  "send it now", "send this now", "send it", "send now",
  "转发给", "转发这封", "转发一下", "现在发送", "立即发送", "发送它",
  "reenví", "envíalo",
  "transfè", "envoie-le",
  "leite es", "weiterleit", "schick es", "sende es",
  "転送し", "送って",
];

const TRASH_VERB_PHRASES: PhraseSet = [
  "delete it", "delete this", "delete that", "delete the email",
  "delete the message", "move it to trash", "move this to trash",
  "move that to trash", "move it to the trash", "move this to the trash",
  "trash it", "trash this", "trash that",
  "删掉它", "删除这封", "删除它", "移到废纸篓", "移入废纸篓",
  "elimínalo", "bórralo", "muévelo a la papelera",
  "supprime-le", "mets-le à la corbeille",
  "lösche es", "in den papierkorb",
  "削除し", "ゴミ箱へ移動",
];

const RESTORE_VERB_PHRASES: PhraseSet = [
  "restore it", "restore this", "restore that", "undo that deletion",
  "undo the deletion", "undo that", "undo this",
  "撤销删除", "恢复它",
  "restáuralo", "deshaz la eliminación",
  "restaure-le", "annule la suppression",
  "stelle es wieder her", "mache das rückgängig",
  "元に戻し",
];

/** The tool each direct-send verb is allowed to skip the card for. */
const VERB_TO_TOOL: Readonly<Record<DirectSendVerb, readonly string[]>> = {
  forward: ["send_email_forward"],
  trash: ["move_email_to_trash"],
  restore: ["restore_email"],
};

/**
 * R6-01: resolves WHICH action the send-now sentence names. A sentence that
 * mixes verbs ("forward it" + "delete this") is ambiguous → null (review).
 * The generic send phrases map to `forward` — "send it now" after a review
 * follow-up authorizes a forward, never a Trash or restore.
 */
export function resolveDirectSendVerb(userText: string): DirectSendVerb | null {
  const text = normalizeText(userText);
  const forward = matchesAny(text, FORWARD_VERB_PHRASES) !== null;
  const trash = matchesAny(text, TRASH_VERB_PHRASES) !== null;
  const restore = matchesAny(text, RESTORE_VERB_PHRASES) !== null;
  const matched = [forward, trash, restore].filter(Boolean).length;
  if (matched !== 1) return null;
  if (forward) return "forward";
  if (trash) return "trash";
  return "restore";
}

/** True when the tool the model called is the verb the user named. */
export function isDirectSendVerbBound(toolName: string, verb: DirectSendVerb | null): boolean {
  if (verb === null) return false;
  return (VERB_TO_TOOL[verb] ?? []).includes(toolName);
}

const EMAIL_ADDRESS_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Lowercased, deduplicated email addresses mentioned in the sentence. */
export function extractSentenceAddresses(userText: string): string[] {
  const matches = userText.match(EMAIL_ADDRESS_PATTERN) ?? [];
  return Array.from(new Set(matches.map((entry) => entry.trim().toLowerCase())));
}

/** True when both sets are non-empty, equal, and fully named. */
export function sentenceAddressesBindEnvelope(
  sentenceAddresses: readonly string[],
  envelopeAddresses: readonly string[]
): boolean {
  if (sentenceAddresses.length === 0 || envelopeAddresses.length === 0) return false;
  const sentence = new Set(sentenceAddresses.map((entry) => entry.trim().toLowerCase()));
  const envelope = new Set(envelopeAddresses.map((entry) => entry.trim().toLowerCase()));
  if (sentence.size !== envelope.size) return false;
  for (const entry of sentence) {
    if (!envelope.has(entry)) return false;
  }
  return true;
}

/**
 * R6-01: the full host-owned direct-send binding — shape, verb, and payload.
 * `sentenceAddresses` come from the trusted user turn; `envelopeAddresses`
 * from the frozen revision the tool references; `singleRestoreCandidateId`
 * is the ONLY restorable operation when the verb is restore (null when 0 or
 * several exist — "undo that" with more than one possible operation asks
 * which one).
 */
export function isDirectSendPayloadBound(input: {
  readonly toolName: string;
  readonly args: unknown;
  readonly userText: string;
  /**
   * Trusted payload addresses: the frozen revision's full envelope
   * (to+cc+bcc) for a forward, or the target message's sender for Trash.
   */
  readonly trustedPayloadAddresses?: readonly string[];
  /** The single restorable succeeded Trash operation id, when exactly one. */
  readonly singleRestoreCandidateId?: string | null;
}): boolean {
  if (!isUnambiguousDirectSendPayload(input.toolName, input.args)) return false;
  const verb = resolveDirectSendVerb(input.userText);
  if (!isDirectSendVerbBound(input.toolName, verb)) return false;
  const record = (typeof input.args === "object" && input.args !== null
    ? input.args
    : {}) as Record<string, unknown>;
  const sentenceAddresses = extractSentenceAddresses(input.userText);
  switch (input.toolName) {
    case "send_email_forward": {
      // The sentence must NAME the recipients the frozen revision carries:
      // "forward this to finance@example.com now" authorizes exactly that
      // envelope, never a draft addressed to someone else (AC-01/AC-03).
      return sentenceAddressesBindEnvelope(
        sentenceAddresses,
        input.trustedPayloadAddresses ?? []
      );
    }
    case "move_email_to_trash": {
      // Bind the target identity: the message's sender must be named in the
      // sentence. A bare "delete this email" without any address in the
      // trusted text stays on the review path (the host cannot bind "this").
      if (sentenceAddresses.length === 0) return false;
      return (input.trustedPayloadAddresses ?? []).some((entry) =>
        sentenceAddresses.includes(entry.trim().toLowerCase())
      );
    }
    case "restore_email": {
      // "Undo that" is direct ONLY when exactly one succeeded Trash
      // operation exists AND it is the one the model references.
      const candidate = input.singleRestoreCandidateId ?? null;
      if (candidate === null) return false;
      return record.operation_id === candidate;
    }
    default:
      return false;
  }
}
