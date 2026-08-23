import {
  normalizeMessageId,
  parseReferenceChain,
} from "@/service/emailReceive/EmailThreadResolver";

/**
 * Pure reply-header construction (technical design §17, FR-022). Builds the
 * thread-correct In-Reply-To / References pair for an outbound reply and
 * normalizes the subject prefix. Malformed values are omitted — raw headers
 * are never forwarded. Subject matching alone never contributes to threading.
 */

export interface ReplyThreadHeaders {
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
}

/** Build headers for a reply to the given inbound message. */
export function buildReplyThreadHeaders(input: {
  /** Raw Message-ID header of the message being replied to. */
  parentMessageId: string | null | undefined;
  /** Raw References header of the message being replied to. */
  parentReferences: string | null | undefined;
}): ReplyThreadHeaders {
  const parent = normalizeMessageId(input.parentMessageId);
  // In-Reply-To is the immediate parent's id when valid; omitted otherwise.
  const inReplyTo = parent;

  // References = the parent's valid prior chain (dedup, order-preserving)
  // followed by the parent's own id, with duplicates removed.
  const chain = parseReferenceChain(input.parentReferences);
  const refs: string[] = [];
  for (const id of [...chain, ...(parent ? [parent] : [])]) {
    if (!refs.includes(id)) refs.push(id);
  }
  return { inReplyTo, references: refs };
}

/**
 * Normalize a reply subject: strip any stacked Re:/Fwd: prefixes, then apply
 * exactly one "Re: " (or "回复：" when the original is CJK-prefixed) unless the
 * base already carries none and we are starting from a non-reply context.
 */
export function normalizeReplySubject(subject: string): string {
  // Strip every leading Re:/AW:/Fwd: variant (possibly stacked/repeated).
  const stripped = subject
    .replace(/^(\s*(?:re|aw|fw|fwd)\s*:\s*)+/i, "")
    .replace(/^(\s*回复\s*[：:]\s*)+/, "")
    .trim();
  const base = stripped || subject.trim();
  if (!base) return "Re:";
  return `Re: ${base}`;
}

/** Validate a header value for SMTP: reject control chars / overlong values. */
export function isValidHeaderValue(value: string): boolean {
  if (!value) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  return value.length <= 998;
}

/**
 * Build the complete, validated outbound header set. Throws on unsendable
 * input (missing recipient), and omits malformed thread values rather than
 * forwarding raw headers (FR-022: header-parse failures block sending).
 */
export function buildOutboundHeaders(input: {
  subject: string;
  recipientAddress: string;
  parentMessageId: string | null | undefined;
  parentReferences: string | null | undefined;
}): {
  subject: string;
  recipientAddress: string;
  thread: ReplyThreadHeaders;
} {
  const recipient = input.recipientAddress.trim();
  if (!recipient || /[\x00-\x1f\x7f]/.test(recipient)) {
    throw new Error("Reply cannot be sent: recipient address is missing or invalid");
  }

  const rawThread = buildReplyThreadHeaders({
    parentMessageId: input.parentMessageId,
    parentReferences: input.parentReferences,
  });
  // Omit malformed values; never forward raw unvalidated headers.
  const thread: ReplyThreadHeaders = {
    inReplyTo:
      rawThread.inReplyTo && isValidHeaderValue(`<${rawThread.inReplyTo}>`)
        ? rawThread.inReplyTo
        : null,
    references: rawThread.references.filter((id) =>
      isValidHeaderValue(`<${id}>`)
    ),
  };

  return {
    subject: normalizeReplySubject(input.subject),
    recipientAddress: recipient,
    thread,
  };
}
