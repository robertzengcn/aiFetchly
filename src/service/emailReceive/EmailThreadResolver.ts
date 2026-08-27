import type { EmailConversationContextConfidence } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Pure message-id normalization + conversation-root resolution (technical
 * design §7, FR-001). No database access — the module layer uses these helpers
 * to find-or-create a mailbox-scoped conversation. Subject-only merging is
 * never performed.
 *
 * Normalization rules (§7.1):
 *  - unfold header whitespace
 *  - extract valid message-id tokens (strip the surrounding angle brackets)
 *  - trim; reject control characters and malformed values
 *  - preserve the identifier value (no locale-sensitive casing)
 *  - dedupe references while retaining order
 *  - cap identifier and chain lengths
 */

const MAX_ID_LENGTH = 998;
const MAX_REFERENCES = 50;
const PROVIDER_SINGLETON_PREFIX = "provider:";

/** A normalized message-id token plus the parsed reference chain. */
export interface NormalizedThreadHeaders {
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
}

/**
 * Normalize a single Message-ID / In-Reply-To value to its canonical token, or
 * null when it is missing/malformed. Extracts the first valid `<...>` token if
 * present, otherwise treats the trimmed value as the token.
 */
export function normalizeMessageId(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  // Unfold: collapse CRLF/tab/space runs that fold headers.
  const unfolded = value.replace(/[\r\n\t]+/g, " ").trim();
  if (!unfolded) return null;
  // Reject control characters (other than the spaces already handled).
  if (/[\x00-\x1f\x7f]/.test(unfolded)) return null;

  // Prefer an explicit <id@domain> token; take the first one.
  const tokenMatch = unfolded.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  let token: string;
  if (tokenMatch) {
    token = tokenMatch[1];
  } else {
    // Otherwise accept a bare id@domain only (a valid message-id requires an @).
    // Bare opaque tokens without '@' are not valid message-id tokens and are
    // dropped so non-message-id header content cannot masquerade as one.
    const bare = unfolded.split(/\s+/)[0];
    if (!bare || !/^[^@\s]+@[^@\s]+$/.test(bare)) return null;
    token = bare;
  }
  token = token.trim();
  if (!token || token.length > MAX_ID_LENGTH) return null;
  if (/[\x00-\x1f\x7f]/.test(token)) return null;
  return token;
}

/**
 * Parse a References header into a de-duplicated, order-preserving list of
 * normalized message-id tokens. Malformed tokens are dropped.
 */
export function parseReferenceChain(
  value: string | null | undefined
): readonly string[] {
  if (!value) return [];
  const tokens = value
    .replace(/[\r\n\t]+/g, " ")
    .match(/<[^<>@\s]+@[^<>@\s]+>|[^\s<>]+/g);
  if (!tokens) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tokens) {
    const norm = normalizeMessageId(raw);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

/** Normalize the full thread-header triple from raw header values. */
export function normalizeThreadHeaders(input: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}): NormalizedThreadHeaders {
  const references = parseReferenceChain(input.references);
  // In-Reply-To should hold exactly one id; if it holds several, that is a sign
  // of ambiguity.
  const irtRaw = input.inReplyTo
    ? input.inReplyTo.replace(/[\r\n\t]+/g, " ").trim()
    : "";
  const irtTokens = irtRaw
    ? irtRaw.match(/<[^<>@\s]+@[^<>@\s]+>|[^\s<>]+/g) ?? []
    : [];
  const inReplyTo =
    irtTokens.length === 1 ? normalizeMessageId(irtTokens[0]) : null;
  return {
    messageId: normalizeMessageId(input.messageId),
    inReplyTo,
    references,
  };
}

export interface ConversationResolution {
  /** Root key to find-or-create the conversation under (steps 3-5 of §7.2). */
  readonly rootKey: string;
  /** Normalized ids to look up against existing turns, in priority order. */
  readonly matchCandidates: readonly string[];
  readonly confidence: EmailConversationContextConfidence;
  readonly ambiguityReason: string | null;
}

/**
 * Pure conversation-root resolution (§7.2 steps 3-6 + confidence). The module
 * layer first tries each {@link matchCandidates} against existing local turns;
 * if none match it find-or-creates a conversation keyed by {@link rootKey}.
 *
 *   - In-Reply-To present and unambiguous → it is the primary match candidate;
 *     the root key is the oldest reference (or the parent) so a reply joins the
 *     parent's conversation.
 *   - Multiple/contradictory In-Reply-To tokens → ambiguous.
 *   - No In-Reply-To but references → oldest reference is the root candidate.
 *   - Only a Message-ID → that id is the root (a new thread).
 *   - No usable ids → deterministic singleton from the provider uid (never
 *     merges by subject).
 */
export function resolveConversationRoot(input: {
  headers: NormalizedThreadHeaders;
  providerUid: string;
}): ConversationResolution {
  const { headers, providerUid } = input;
  const irtRawCount = headers.inReplyTo ? 1 : 0;
  const matchCandidates: string[] = [];
  let confidence: EmailConversationContextConfidence = "partial";
  let ambiguityReason: string | null = null;

  if (headers.inReplyTo) {
    matchCandidates.push(headers.inReplyTo);
  }
  for (const ref of headers.references) {
    if (!matchCandidates.includes(ref)) matchCandidates.push(ref);
  }

  // Detect ambiguity: an In-Reply-To that disagrees with every reference and a
  // references chain that points at more than one distinct unknown root is not
  // safely mergeable.
  if (irtRawCount > 1) {
    confidence = "ambiguous";
    ambiguityReason = "In-Reply-To contained multiple message-id tokens";
  }

  // Choose the root key (the key used when creating a new conversation).
  // References are ordered oldest -> newest (RFC 5322), so references[0] is the
  // thread root; the immediate parent (In-Reply-To / references[last]) is the
  // first match candidate, not the root.
  let rootKey: string | null = null;
  if (headers.inReplyTo) {
    rootKey = headers.references.length
      ? headers.references[0]
      : headers.inReplyTo;
  } else if (headers.references.length) {
    rootKey = headers.references[0];
  } else if (headers.messageId) {
    rootKey = headers.messageId;
    confidence = "exact";
  }

  if (!rootKey) {
    // No usable RFC identifiers — deterministic singleton, never subject-merged.
    rootKey = `${PROVIDER_SINGLETON_PREFIX}${providerUid}`;
    confidence = "exact";
    ambiguityReason =
      ambiguityReason ??
      "No usable RFC message identifiers; singleton by provider uid";
  } else if (
    confidence !== "ambiguous" &&
    !headers.inReplyTo &&
    !headers.references.length
  ) {
    // A standalone message with its own id is a clean new thread.
    confidence = "exact";
  }

  return { rootKey, matchCandidates, confidence, ambiguityReason };
}

/** Build the deterministic singleton key for a message with no usable ids. */
export function providerSingletonKey(providerUid: string): string {
  return `${PROVIDER_SINGLETON_PREFIX}${providerUid}`;
}
