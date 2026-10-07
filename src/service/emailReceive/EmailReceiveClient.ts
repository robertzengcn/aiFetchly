import {
  EmailReceiveConnectionConfig,
  EmailReceiveFetchOptions,
} from "@/entityTypes/emailReceiveTypes";

/**
 * A single parsed inbound email, ready to be persisted by the main process.
 * HTML is already sanitized; bodies are bounded. This is the only object a
 * receive worker is allowed to emit (no entity/model imports here).
 */
export interface ParsedInboundEmail {
  readonly providerUid: string;
  /**
   * Folder the message was observed in (IMAP). Null for POP3, which has no
   * folder concept — the providerUid there is a UIDL hash, not a folder UID.
   */
  readonly providerFolder: string | null;
  /**
   * IMAP UIDVALIDITY for the observing session, stored losslessly as a
   * string (bigint source; leading zeros and the full 32-bit value must
   * survive). Null for POP3. Together with providerFolder this namespaces
   * the providerUid so UIDs can never be attributed across folder renames
   * or UIDVALIDITY bumps (FR-030, technical design §5.1).
   */
  readonly providerUidValidity: string | null;
  readonly messageId: string | null;
  readonly threadKey: string | null;
  readonly inReplyTo: string | null;
  readonly referencesHeader: string | null;
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly replyToAddress: string | null;
  readonly toAddresses: readonly string[];
  readonly ccAddresses: readonly string[];
  readonly subject: string;
  readonly bodyText: string | null;
  readonly bodyHtmlSanitized: string | null;
  readonly snippet: string | null;
  readonly receivedAt: Date;
  readonly isUnread: boolean;
  readonly isAnswered: boolean;
  readonly autoSubmitted: string | null;
  readonly precedence: string | null;
  /** List headers parsed at receive time (FR-020, P2). */
  readonly listIdHeader: string | null;
  readonly listUnsubscribeHeader: string | null;
  /** Attachment metadata only (name/type/size) — content is never opened (FR-021). */
  readonly attachments: ReadonlyArray<{
    filename: string | null;
    contentType: string | null;
    size: number;
  }>;
}

/**
 * Pluggable receive client. The MVP ships an ImapFlow-backed implementation;
 * a POP3 implementation can be added later behind this same interface.
 *
 * Implementations must NOT import TypeORM entities, models, or modules, and
 * must NOT write to disk — they only perform network I/O and parsing.
 */
export interface EmailReceiveClient {
  /** Verify credentials/connectivity. Throws on failure. */
  testConnection(config: EmailReceiveConnectionConfig): Promise<void>;

  /** Fetch and parse a bounded set of messages. */
  fetchMessages(
    config: EmailReceiveConnectionConfig,
    options: EmailReceiveFetchOptions
  ): Promise<ParsedInboundEmail[]>;
}

/**
 * UID-scoped flag observation for reply detection (FR-031, technical design
 * §7.1 step 5). One message, header/flags only — never a body fetch, never a
 * flag write (PEEK semantics; the detector must not mark mail read/answered).
 */
export interface RefreshedFlags {
  /** IMAP UID the observation was made under. */
  readonly uid: string;
  /** Raw `\Answered` flag state, lowercased-normalized. */
  readonly isAnswered: boolean;
  /** Raw `\Seen` flag state, lowercased-normalized. */
  readonly isSeen: boolean;
  /** Full flag set as stored by the server (lowercased). */
  readonly flags: readonly string[];
  /** When this observation was made (server response time). */
  readonly checkedAt: Date;
}

/**
 * A resolved Sent folder for reply-header search (FR-031, §7.2). Either the
 * server advertised it via the `\Sent` special-use flag (verified=true) or it
 * matched a conventional fallback name and still needs local verification.
 */
export interface SentFolder {
  readonly folder: string;
  /** True when discovered via `\Sent` special-use, false for name fallbacks. */
  readonly verified: boolean;
}

/**
 * One candidate message found by the Sent-folder header search, with the raw
 * header tokens needed for local exact-match verification (FR-031, §7.2:
 * IMAP HEADER search is substring-based, so equality is validated locally,
 * never trusted from the server).
 */
export interface ReplyHeaderCandidate {
  readonly folder: string;
  readonly uid: number;
  /** Raw Message-ID header value (unnormalized). */
  readonly messageId: string | null;
  /** Raw In-Reply-To header value (unnormalized). */
  readonly inReplyTo: string | null;
  /** Raw References header value (unnormalized). */
  readonly references: string | null;
  /** Raw From header value as the server returned it. */
  readonly from: string | null;
  /** Raw To header value as the server returned it. */
  readonly to: string | null;
  /** Raw Date header value as the server returned it. */
  readonly date: string | null;
}

/**
 * Parse a raw RFC-5322 header block (as returned by imapflow's `headers`
 * fetch) into a lowercased-key → trimmed-value map, unfolding continuation
 * lines per RFC 5322 §2.2.3. Pure; used by the Sent-search reply-header
 * parser (FR-031 §7.2).
 */
export function parseHeaderBlock(raw: Buffer | string | null | undefined): Map<
  string,
  string
> {
  const out = new Map<string, string>();
  if (!raw) return out;
  const text =
    typeof raw === "string" ? raw : raw.toString("utf8");
  const lines = text.split(/\r?\n/);
  let lastKey: string | null = null;
  for (const line of lines) {
    if (line.length === 0) continue;
    // Continuation line (folded header value) — append to the previous key.
    if (/^[ \t]/.test(line) && lastKey) {
      const existing = out.get(lastKey) ?? "";
      out.set(lastKey, `${existing} ${line.trim()}`.trim());
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue; // malformed line — skip, never throw
    const key = line.slice(0, colon).trim().toLowerCase();
    if (!key) {
      lastKey = null;
      continue;
    }
    const value = line.slice(colon + 1).trim();
    out.set(key, value);
    lastKey = key;
  }
  return out;
}

/** Normalize a parsed address header value into "address" or "Name <address>". */
export function firstAddress(
  value: { address?: string; name?: string } | null | undefined
): {
  address: string;
  name: string | null;
} {
  if (!value || !value.address) return { address: "", name: null };
  return { address: value.address, name: value.name ?? null };
}

/** Convert ImapFlow's address objects to a plain string array. */
export function addressListToStrings(
  values: ReadonlyArray<{ address?: string; name?: string }> | null | undefined
): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    if (!v || !v.address) continue;
    out.push(v.name ? `${v.name} <${v.address}>` : v.address);
  }
  return out;
}
