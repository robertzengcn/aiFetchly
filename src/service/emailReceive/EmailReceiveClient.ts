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
  readonly autoSubmitted: string | null;
  readonly precedence: string | null;
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
