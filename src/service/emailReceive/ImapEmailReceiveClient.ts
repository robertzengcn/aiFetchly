import { ImapFlow } from "imapflow";
import type {
  FetchMessageObject,
  FetchQueryObject,
  ImapFlowOptions,
  MailboxObject,
  SearchObject,
  SequenceString,
} from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailMessage, ParsedMail } from "mailparser";
import {
  EmailReceiveConnectionConfig,
  EmailReceiveFetchOptions,
} from "@/entityTypes/emailReceiveTypes";
import {
  EmailReceiveClient,
  ParsedInboundEmail,
  RefreshedFlags,
  addressListToStrings,
  firstAddress,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  sanitizeEmailHtml,
  htmlToPlainText,
} from "@/service/emailReceive/EmailHtmlSanitizer";
import {
  buildSnippet,
  extractThreadKey,
} from "@/service/emailReceive/EmailMessageParser";
import {
  buildNamespacedProviderUid,
  providerUidFitsColumn,
} from "@/service/emailReceive/EmailReplyIdentity";

/** Hard cap on messages returned per fetch, regardless of caller limit. */
const MAX_FETCH_CAP = 50;
const IMAP_IMPLICIT_TLS_PORT = 993;
type ImapConnectionMode = "configured" | "implicitTls";

/**
 * Narrow structural view of an ImapFlow connection this client consumes
 * (FR-031). The real `ImapFlow` satisfies it directly; tests inject behavioral
 * fakes through the `imapFlowFactory` constructor seam (pattern:
 * `ReplySenderFactory` in EmailReplyDeliveryService).
 */
export interface ImapFlowConnection {
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  mailboxOpen(path: string | string[]): Promise<MailboxObject>;
  search(
    query: SearchObject,
    options?: { uid?: boolean }
  ): Promise<number[] | false>;
  fetchOne(
    seq: SequenceString,
    query: FetchQueryObject,
    options?: { uid?: boolean }
  ): Promise<FetchMessageObject | false>;
}

/** Factory for IMAP connections; overridable for tests. */
export type ImapFlowFactory = (options: ImapFlowOptions) => ImapFlowConnection;

/**
 * ImapFlow-backed receive client. Connects with TLS based on `ssl`, opens the
 * configured folder, searches a bounded set of messages, parses each via
 * `mailparser`, sanitizes HTML, and returns typed {@link ParsedInboundEmail}.
 *
 * No DB, no entity imports, no Electron APIs — network + parse only.
 */
export class ImapEmailReceiveClient implements EmailReceiveClient {
  private readonly imapFlowFactory: ImapFlowFactory;

  constructor(options?: { imapFlowFactory?: ImapFlowFactory }) {
    // Production default constructs the real ImapFlow; tests pass a fake
    // factory to exercise UIDVALIDITY guards and PEEK semantics offline.
    this.imapFlowFactory =
      options?.imapFlowFactory ?? ((opts) => new ImapFlow(opts));
  }
  async testConnection(config: EmailReceiveConnectionConfig): Promise<void> {
    let client = this.createClient(config);
    try {
      await client.connect();
      try {
        await client.mailboxOpen(config.folder);
      } catch {
        // Folder may not exist; connectivity itself still succeeded.
      }
    } catch (error) {
      if (!shouldRetryWithImplicitTls(error, config)) {
        throw error;
      }
      await closeClient(client);
      client = this.createClient(config, "implicitTls");
      await client.connect();
      try {
        await client.mailboxOpen(config.folder);
      } catch {
        // Folder may not exist; connectivity itself still succeeded.
      }
    } finally {
      await closeClient(client);
    }
  }

  async fetchMessages(
    config: EmailReceiveConnectionConfig,
    options: EmailReceiveFetchOptions
  ): Promise<ParsedInboundEmail[]> {
    const limit = Math.max(1, Math.min(options.limit, MAX_FETCH_CAP));

    let client = this.createClient(config);
    try {
      await client.connect();
      return await this.fetchFromConnectedClient(
        client,
        config.folder,
        options,
        limit
      );
    } catch (error) {
      if (!shouldRetryWithImplicitTls(error, config)) {
        throw error;
      }
      await closeClient(client);
      client = this.createClient(config, "implicitTls");
      await client.connect();
      return await this.fetchFromConnectedClient(
        client,
        config.folder,
        options,
        limit
      );
    } finally {
      await closeClient(client);
    }
  }

  private createClient(
    config: EmailReceiveConnectionConfig,
    mode: ImapConnectionMode = "configured"
  ): ImapFlowConnection {
    return this.imapFlowFactory(buildImapFlowOptions(config, mode));
  }

  /**
   * UID-scoped flag observation for reply detection (FR-031, §7.1 step 5):
   * open the folder, fetch ONE message's flags by UID, close. Header/flags
   * only — imapflow's fetchOne never sets `\Seen` on flag/source fetches, so
   * this is read-only for the mailbox (PEEK semantics).
   *
   * Returns null when the UID no longer exists in the folder (expunged or
   * moved) — that is a legitimate observation, not an error.
   */
  async refreshMessageFlags(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    uidValidity: string;
    uid: string;
  }): Promise<RefreshedFlags | null> {
    let client = this.createClient(input.config);
    try {
      await client.connect();
      return await this.refreshFlagsFromConnectedClient(
        client,
        input.folder,
        input.uid,
        input.uidValidity
      );
    } catch (error) {
      if (!shouldRetryWithImplicitTls(error, input.config)) {
        throw error;
      }
      await closeClient(client);
      client = this.createClient(input.config, "implicitTls");
      await client.connect();
      return await this.refreshFlagsFromConnectedClient(
        client,
        input.folder,
        input.uid,
        input.uidValidity
      );
    } finally {
      await closeClient(client);
    }
  }

  private async refreshFlagsFromConnectedClient(
    client: ImapFlowConnection,
    folder: string,
    uid: string,
    expectedUidValidity: string
  ): Promise<RefreshedFlags | null> {
    const mailbox = await client.mailboxOpen(folder);
    // UIDVALIDITY guard (§5.1): a UID is only valid within its namespace. If
    // the folder's validity changed since sync stored it, the UID names a
    // different (or no) message — report it as gone rather than trusting it.
    if (
      mailbox &&
      mailbox.uidValidity != null &&
      String(mailbox.uidValidity) !== expectedUidValidity
    ) {
      return null;
    }

    const msg = await client.fetchOne(
      Number(uid),
      { flags: true, internalDate: true },
      { uid: true }
    );
    if (!msg) return null;

    const rawFlags = msg.flags ?? new Set<string>();
    const flags = Array.from(rawFlags, (flag) => flag.toLowerCase());
    return {
      uid,
      isAnswered: flags.includes("\\answered"),
      isSeen: flags.includes("\\seen"),
      flags,
      checkedAt: new Date(),
    };
  }

  private async fetchFromConnectedClient(
    client: ImapFlowConnection,
    folder: string,
    options: EmailReceiveFetchOptions,
    limit: number
  ): Promise<ParsedInboundEmail[]> {
    const results: ParsedInboundEmail[] = [];
    const mailbox = await client.mailboxOpen(folder);
    // UIDVALIDITY namespaces every UID in this folder (§5.1): a bare UID
    // reused after a rename or validity bump would attribute the wrong
    // message's flags to an old row. Stored losslessly as a string.
    const uidValidity =
      mailbox && mailbox.uidValidity != null
        ? String(mailbox.uidValidity)
        : null;

    // UIDs of messages matching the criteria (most recent at the end).
    const searchCriteria: SearchObject = {};
    if (options.unreadOnly) searchCriteria.seen = false;
    if (options.since) searchCriteria.since = options.since;

    const uids = await client.search(searchCriteria, { uid: true });
    if (!Array.isArray(uids) || uids.length === 0) return [];

    // Take the most recent `limit` UIDs.
    const bounded = uids.slice(-limit);

    for (const uid of bounded) {
      const msg = await client.fetchOne(
        uid,
        { source: true, flags: true, internalDate: true },
        { uid: true }
      );
      if (!msg || !msg.source) continue;

      const parsed = await simpleParser(msg.source as Buffer);
      const record = this.toParsedInboundEmail(
        uid,
        parsed,
        msg,
        folder,
        uidValidity
      );
      if (record) results.push(record);
    }

    return results;
  }

  private toParsedInboundEmail(
    uid: number,
    parsed: ParsedMail,
    msg: { flags?: Set<string> },
    folder: string,
    uidValidity: string | null
  ): ParsedInboundEmail | null {
    const from = firstAddress(parsed.from?.value?.[0] ?? null);
    if (!from.address) return null;

    // Namespaced providerUid `imap:<folderHash>:<uidValidity>:<uid>` (§5.1).
    // Falls back to the bare legacy form only when UIDVALIDITY is somehow
    // unobservable, so the message still syncs; adoption of that legacy row
    // requires header validation later (sync service).
    const providerUid =
      uidValidity != null
        ? buildNamespacedProviderUid({ folder, uidValidity, uid })
        : String(uid);
    if (!providerUidFitsColumn(providerUid)) return null;

    const rawHtml = typeof parsed.html === "string" ? parsed.html : null;
    const bodyHtmlSanitized = sanitizeEmailHtml(rawHtml);
    const bodyText =
      (parsed.text && parsed.text.length > 0 ? parsed.text : null) ??
      (rawHtml ? htmlToPlainText(rawHtml) : null);

    const subject = (parsed.subject ?? "(no subject)").slice(0, 998);
    const messageId = parsed.messageId ? parsed.messageId.trim() : null;
    const inReplyTo = parsed.inReplyTo ? String(parsed.inReplyTo).trim() : null;
    const referencesHeader = parsed.references
      ? Array.isArray(parsed.references)
        ? (parsed.references as string[]).join(" ")
        : String(parsed.references)
      : null;
    const threadKey = extractThreadKey(messageId, inReplyTo, referencesHeader);

    const flags = msg.flags ?? new Set<string>();
    const normalizedFlags = new Set(
      Array.from(flags, (flag) => flag.toLowerCase())
    );
    const isUnread = !normalizedFlags.has("\\seen");
    const isAnswered = normalizedFlags.has("\\answered");

    const toAddresses = addressListToStrings(
      parsed.to?.value as EmailMessage[] | undefined
    );
    const ccAddresses = addressListToStrings(
      parsed.cc?.value as EmailMessage[] | undefined
    );
    const replyTo = firstAddress(parsed.replyTo?.value?.[0] ?? null);

    const autoSubmittedHeader = parsed.headers?.get("auto-submitted");
    const precedenceHeader = parsed.headers?.get("precedence");
    const listIdHeader = parsed.headers?.get("list-id");
    const listUnsubscribeHeader = parsed.headers?.get("list-unsubscribe");

    // Attachment METADATA only — content is never opened or persisted (FR-021).
    const attachments = (parsed.attachments ?? []).map((a) => ({
      filename: a.filename ?? null,
      contentType: a.contentType ?? null,
      size: typeof a.size === "number" ? a.size : 0,
    }));

    return {
      providerUid,
      providerFolder: folder,
      providerUidValidity: uidValidity,
      messageId,
      threadKey,
      inReplyTo,
      referencesHeader,
      fromAddress: from.address,
      fromName: from.name,
      replyToAddress: replyTo.address || null,
      toAddresses,
      ccAddresses,
      subject,
      bodyText,
      bodyHtmlSanitized,
      snippet: buildSnippet(bodyText),
      receivedAt: parsed.date ?? new Date(),
      isUnread,
      isAnswered,
      autoSubmitted: autoSubmittedHeader ? String(autoSubmittedHeader) : null,
      precedence: precedenceHeader ? String(precedenceHeader) : null,
      listIdHeader: listIdHeader ? String(listIdHeader) : null,
      listUnsubscribeHeader: listUnsubscribeHeader
        ? String(listUnsubscribeHeader)
        : null,
      attachments,
    };
  }
}

async function closeClient(client: ImapFlowConnection): Promise<void> {
  try {
    await client.logout();
  } catch {
    /* ignore */
  }
}

export function buildImapFlowOptions(
  config: EmailReceiveConnectionConfig,
  mode: ImapConnectionMode = "configured"
): ImapFlowOptions {
  const useImplicitTls =
    config.ssl &&
    (config.port === IMAP_IMPLICIT_TLS_PORT || mode === "implicitTls");
  const useStartTls = config.ssl && !useImplicitTls;

  return {
    host: config.host,
    port: config.port,
    secure: useImplicitTls,
    doSTARTTLS: useStartTls,
    auth: { user: config.username, pass: config.password },
    logger: false,
  };
}

export function shouldRetryWithImplicitTls(
  error: unknown,
  config: EmailReceiveConnectionConfig
): boolean {
  if (!config.ssl || config.port === IMAP_IMPLICIT_TLS_PORT) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = (error as Error & { code?: unknown }).code;
  return (
    maybeCode === "GREETING_TIMEOUT" || maybeCode === "ClosedAfterConnectText"
  );
}
