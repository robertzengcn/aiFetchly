import { ImapFlow } from "imapflow";
import type { ImapFlowOptions } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailMessage, ParsedMail } from "mailparser";
import {
  EmailReceiveConnectionConfig,
  EmailReceiveFetchOptions,
} from "@/entityTypes/emailReceiveTypes";
import {
  EmailReceiveClient,
  ParsedInboundEmail,
  addressListToStrings,
  firstAddress,
} from "@/service/emailReceive/EmailReceiveClient";
import { sanitizeEmailHtml, htmlToPlainText } from "@/service/emailReceive/EmailHtmlSanitizer";
import {
  buildSnippet,
  extractThreadKey,
} from "@/service/emailReceive/EmailMessageParser";

/** Hard cap on messages returned per fetch, regardless of caller limit. */
const MAX_FETCH_CAP = 50;
const IMAP_IMPLICIT_TLS_PORT = 993;
type ImapConnectionMode = "configured" | "implicitTls";

/**
 * ImapFlow-backed receive client. Connects with TLS based on `ssl`, opens the
 * configured folder, searches a bounded set of messages, parses each via
 * `mailparser`, sanitizes HTML, and returns typed {@link ParsedInboundEmail}.
 *
 * No DB, no entity imports, no Electron APIs — network + parse only.
 */
export class ImapEmailReceiveClient implements EmailReceiveClient {
  async testConnection(config: EmailReceiveConnectionConfig): Promise<void> {
    const traceId = createImapTraceId();
    let client = this.createClient(config);
    try {
      logImapAttempt("test", traceId, config, "configured", "connect:start");
      await client.connect();
      logImapAttempt("test", traceId, config, "configured", "connect:success");
      try {
        await client.mailboxOpen(config.folder);
        logImapAttempt("test", traceId, config, "configured", "mailbox:open");
      } catch {
        // Folder may not exist; connectivity itself still succeeded.
        logImapAttempt("test", traceId, config, "configured", "mailbox:ignored");
      }
    } catch (error) {
      logImapAttempt("test", traceId, config, "configured", "connect:error", error);
      if (!shouldRetryWithImplicitTls(error, config)) {
        logImapAttempt("test", traceId, config, "configured", "retry:skip", error);
        throw error;
      }
      logImapAttempt("test", traceId, config, "implicitTls", "retry:start");
      await closeClient(client);
      client = this.createClient(config, "implicitTls");
      await client.connect();
      logImapAttempt("test", traceId, config, "implicitTls", "connect:success");
      try {
        await client.mailboxOpen(config.folder);
        logImapAttempt("test", traceId, config, "implicitTls", "mailbox:open");
      } catch {
        // Folder may not exist; connectivity itself still succeeded.
        logImapAttempt("test", traceId, config, "implicitTls", "mailbox:ignored");
      }
    } finally {
      await closeClient(client);
      logImapAttempt("test", traceId, config, "configured", "client:closed");
    }
  }

  async fetchMessages(
    config: EmailReceiveConnectionConfig,
    options: EmailReceiveFetchOptions
  ): Promise<ParsedInboundEmail[]> {
    const traceId = createImapTraceId();
    const limit = Math.max(1, Math.min(options.limit, MAX_FETCH_CAP));

    let client = this.createClient(config);
    try {
      logImapAttempt("fetch", traceId, config, "configured", "connect:start", undefined, {
        limit,
        unreadOnly: options.unreadOnly,
        since: options.since?.toISOString(),
      });
      await client.connect();
      logImapAttempt("fetch", traceId, config, "configured", "connect:success");
      return await this.fetchFromConnectedClient(
        client,
        config.folder,
        options,
        limit
      );
    } catch (error) {
      logImapAttempt("fetch", traceId, config, "configured", "connect:error", error);
      if (!shouldRetryWithImplicitTls(error, config)) {
        logImapAttempt("fetch", traceId, config, "configured", "retry:skip", error);
        throw error;
      }
      logImapAttempt("fetch", traceId, config, "implicitTls", "retry:start");
      await closeClient(client);
      client = this.createClient(config, "implicitTls");
      await client.connect();
      logImapAttempt("fetch", traceId, config, "implicitTls", "connect:success");
      return await this.fetchFromConnectedClient(
        client,
        config.folder,
        options,
        limit
      );
    } finally {
      await closeClient(client);
      logImapAttempt("fetch", traceId, config, "configured", "client:closed");
    }
  }

  private createClient(
    config: EmailReceiveConnectionConfig,
    mode: ImapConnectionMode = "configured"
  ): ImapFlow {
    return new ImapFlow(buildImapFlowOptions(config, mode));
  }

  private async fetchFromConnectedClient(
    client: ImapFlow,
    folder: string,
    options: EmailReceiveFetchOptions,
    limit: number
  ): Promise<ParsedInboundEmail[]> {
    const results: ParsedInboundEmail[] = [];
    await client.mailboxOpen(folder);

    // UIDs of messages matching the criteria (most recent at the end).
    const searchCriteria: Record<string, unknown> = {};
    if (options.unreadOnly) searchCriteria.seen = false;
    if (options.since) searchCriteria.since = options.since;

    const uids = (await client.search(searchCriteria, { uid: true })) as number[];
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
      const record = this.toParsedInboundEmail(uid, parsed, msg);
      if (record) results.push(record);
    }

    return results;
  }

  private toParsedInboundEmail(
    uid: number,
    parsed: ParsedMail,
    msg: { flags?: Set<string> }
  ): ParsedInboundEmail | null {
    const from = firstAddress(parsed.from?.value?.[0] ?? null);
    if (!from.address) return null;

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

    const toAddresses = addressListToStrings(parsed.to?.value as EmailMessage[] | undefined);
    const ccAddresses = addressListToStrings(parsed.cc?.value as EmailMessage[] | undefined);
    const replyTo = firstAddress(parsed.replyTo?.value?.[0] ?? null);

    const autoSubmittedHeader = parsed.headers?.get("auto-submitted");
    const precedenceHeader = parsed.headers?.get("precedence");

    return {
      providerUid: String(uid),
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
    };
  }
}

function createImapTraceId(): string {
  return `imap-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function logImapAttempt(
  operation: "test" | "fetch",
  traceId: string,
  config: EmailReceiveConnectionConfig,
  mode: ImapConnectionMode,
  event: string,
  error?: unknown,
  extra?: Record<string, unknown>
): void {
  const options = buildImapFlowOptions(config, mode);
  const payload: Record<string, unknown> = {
    traceId,
    operation,
    event,
    mode,
    host: config.host,
    port: config.port,
    ssl: config.ssl,
    folder: config.folder,
    imapSecure: options.secure,
    imapStartTls: options.doSTARTTLS,
    ...extra,
  };

  if (error != null) {
    payload.error = describeImapError(error);
    console.warn("[email-receive:imap]", payload);
    return;
  }

  console.info("[email-receive:imap]", payload);
}

function describeImapError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }
  const extended = error as Error & {
    code?: unknown;
    reason?: unknown;
    tlsFailed?: unknown;
  };
  return {
    name: error.name,
    message: error.message,
    code: extended.code,
    reason: extended.reason,
    tlsFailed: extended.tlsFailed,
  };
}

async function closeClient(client: ImapFlow): Promise<void> {
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
  return maybeCode === "GREETING_TIMEOUT" || maybeCode === "ClosedAfterConnectText";
}
