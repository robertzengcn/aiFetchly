import { ImapFlow } from "imapflow";
import type {
  FetchMessageObject,
  FetchQueryObject,
  ImapFlowOptions,
  ListResponse,
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
  ReplyHeaderCandidate,
  ReplyHeaderSearchResult,
  SentFolder,
  addressListToStrings,
  firstAddress,
  parseHeaderBlock,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  sanitizeEmailHtml,
  htmlToPlainText,
} from "@/service/emailReceive/EmailHtmlSanitizer";
import {
  buildSnippet,
  extractThreadKey,
  sanitizeHeaderValue,
} from "@/service/emailReceive/EmailMessageParser";
import {
  buildNamespacedProviderUid,
  providerUidFitsColumn,
} from "@/service/emailReceive/EmailReplyIdentity";

/** Hard cap on messages returned per fetch, regardless of caller limit. */
const MAX_FETCH_CAP = 50;
const IMAP_IMPLICIT_TLS_PORT = 993;
type ImapConnectionMode = "configured" | "implicitTls";

/** `probe` sessions are short and must not enter IDLE or die on a slow greeting. */
export type ImapFlowSessionPurpose = "sync" | "probe";

/** Greeting wait for a reply-detection probe. Longer than imapflow's 16s default so a slow mailbox can still authenticate inside the probe budget. */
export const IMAP_PROBE_GREETING_TIMEOUT_MS = 30_000;

/**
 * Conventional Sent-folder names tried when the server advertises no `\Sent`
 * special-use folder (FR-031 §7.2). Exactly ONE unambiguous match is accepted.
 */
const SENT_FOLDER_FALLBACK_NAMES = [
  "Sent",
  "Sent Items",
  "Sent Messages",
  "[Gmail]/Sent Mail",
  "INBOX/Sent",
  "INBOX.Sent",
] as const;

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
  list(): Promise<ListResponse[]>;
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
 * Mailbox observations for one reply-detection probe, already connected.
 * Flag refresh, Sent-folder discovery, and header search share this session
 * so a slow server pays for one TLS handshake instead of three.
 */
export interface ImapProbeSession {
  refreshMessageFlags(input: {
    folder: string;
    uidValidity: string;
    uid: string;
    signal?: AbortSignal;
  }): Promise<RefreshedFlags | null>;
  discoverSentFolders(signal?: AbortSignal): Promise<SentFolder[]>;
  searchReplyHeaders(input: {
    folder: string;
    originalMessageId: string;
    cap: number;
    signal?: AbortSignal;
    /** Ignore Sent mail dated before this instant. */
    notBefore?: Date;
  }): Promise<ReplyHeaderSearchResult | false>;
}

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
    mode: ImapConnectionMode = "configured",
    purpose: ImapFlowSessionPurpose = "sync"
  ): ImapFlowConnection {
    return this.imapFlowFactory(buildImapFlowOptions(config, mode, purpose));
  }

  /**
   * One IMAP session for a reply-detection probe. The caller runs flag
   * refresh, Sent discovery, and header search on the session; this method
   * owns connect, implicit-TLS retry, abort, and logout.
   *
   * A probe that opens a new connection per step spends the deadline on
   * handshakes and returns `probe_timeout` before it can decide whether a
   * reply already exists.
   */
  async withProbeConnection<T>(
    config: EmailReceiveConnectionConfig,
    signal: AbortSignal | undefined,
    work: (session: ImapProbeSession) => Promise<T>
  ): Promise<T> {
    if (signal?.aborted) {
      throw new Error("IMAP probe aborted before connect");
    }
    let client = this.createClient(config, "configured", "probe");
    let detachAbort = attachAbortListener(client, signal);
    try {
      try {
        await client.connect();
      } catch (error) {
        if (signal?.aborted || !shouldRetryWithImplicitTls(error, config)) {
          throw error;
        }
        await closeClient(client);
        detachAbort?.();
        if (signal?.aborted) {
          throw error;
        }
        client = this.createClient(config, "implicitTls", "probe");
        detachAbort = attachAbortListener(client, signal);
        await client.connect();
      }
      if (abortIfSignaled(client, signal)) {
        throw new Error("IMAP probe aborted during connect");
      }
      return await work(this.probeSession(client, signal));
    } finally {
      detachAbort?.();
      await closeClient(client);
    }
  }

  private probeSession(
    client: ImapFlowConnection,
    signal?: AbortSignal
  ): ImapProbeSession {
    return {
      refreshMessageFlags: (input) =>
        this.refreshFlagsFromConnectedClient(
          client,
          input.folder,
          input.uid,
          input.uidValidity,
          input.signal ?? signal
        ),
      discoverSentFolders: (sessionSignal) =>
        this.discoverSentFoldersFromConnectedClient(
          client,
          sessionSignal ?? signal
        ),
      searchReplyHeaders: (input) =>
        this.searchReplyHeadersFromConnectedClient(
          client,
          input.folder,
          input.originalMessageId,
          input.cap,
          input.signal ?? signal,
          input.notBefore
        ),
    };
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
    signal?: AbortSignal;
  }): Promise<RefreshedFlags | null> {
    // R08: reject already-aborted work BEFORE opening a socket. The deadline
    // may have elapsed during the mailbox queue wait (R07) — a stale probe
    // must never open a TCP/TLS connection.
    if (input.signal?.aborted) return null;
    let client = this.createClient(input.config);
    // R08: attach the abort listener BEFORE connect so a signal that aborts
    // DURING the (possibly hung) connect() tears down the in-flight socket
    // immediately — not after connect resolves. The old order (connect then
    // attach) left a hung connect() unwatched, so the socket lingered until
    // the server responded.
    let detachAbort = attachAbortListener(client, input.signal);
    try {
      await client.connect();
      if (abortIfSignaled(client, input.signal)) return null;
      return await this.refreshFlagsFromConnectedClient(
        client,
        input.folder,
        input.uid,
        input.uidValidity,
        input.signal
      );
    } catch (error) {
      // R08: if the signal aborted during connect, do NOT open a retry socket
      // — that would spawn a post-cancellation orphan connection. Surface the
      // abort as null (the caller maps to probe_timeout) without re-connecting.
      if (input.signal?.aborted) {
        if (abortIfSignaled(client, input.signal)) return null;
        throw error;
      }
      if (!shouldRetryWithImplicitTls(error, input.config)) {
        throw error;
      }
      await closeClient(client);
      // R08: the implicit-TLS retry must also check the abort signal before
      // opening a second socket, and attach its own abort listener before
      // connect (not after).
      if (input.signal?.aborted) return null;
      client = this.createClient(input.config, "implicitTls");
      detachAbort?.();
      detachAbort = attachAbortListener(client, input.signal);
      await client.connect();
      if (abortIfSignaled(client, input.signal)) return null;
      return await this.refreshFlagsFromConnectedClient(
        client,
        input.folder,
        input.uid,
        input.uidValidity,
        input.signal
      );
    } finally {
      detachAbort?.();
      await closeClient(client);
    }
  }

  /**
   * Discover Sent folders for reply-header search (FR-031, §7.2).
   *
   * Prefers folders the server advertises with the `\Sent` special-use flag
   * (verified). If the server advertises none, falls back to conventional
   * names (`Sent`, `Sent Items`, `[Gmail]/Sent Mail`, `INBOX/Sent`); exactly
   * ONE unambiguous fallback is accepted, otherwise the result is [] and the
   * caller maps that to `sent_folder_unavailable` — never silently treated as
   * "no reply exists".
   *
   * Auth/permission/connection failures PROPAGATE (the detector maps them to
   * `unknown`, not to folder absence).
   */
  async discoverSentFolders(
    config: EmailReceiveConnectionConfig,
    signal?: AbortSignal
  ): Promise<SentFolder[]> {
    // R08: reject already-aborted work before opening a socket.
    if (signal?.aborted) return [];
    const client = this.createClient(config);
    // R08: attach the abort listener BEFORE connect so a hung connect() is
    // torn down the instant the signal aborts, not after connect resolves.
    const detachAbort = attachAbortListener(client, signal);
    try {
      await client.connect();
      if (abortIfSignaled(client, signal)) return [];
      return await this.discoverSentFoldersFromConnectedClient(client, signal);
    } finally {
      detachAbort?.();
      await closeClient(client);
    }
  }

  private async discoverSentFoldersFromConnectedClient(
    client: ImapFlowConnection,
    signal?: AbortSignal
  ): Promise<SentFolder[]> {
    const listing = await client.list();
    // Review D9.2: if the deadline elapsed during `list()`, the abort
    // listener already tore down the socket; the listing (if it resolved at
    // all) is stale and must not be trusted as the folder scope. Bail out
    // here so the caller maps to `sent_folder_unavailable` → unknown, never a
    // negative built on a partial folder list.
    if (abortIfSignaled(client, signal)) return [];

    const advertised = listing.filter(
      (f) => (f.specialUse ?? "").toLowerCase() === "\\sent"
    );
    if (advertised.length > 0) {
      // Server-declared \Sent folders — authoritative.
      return advertised.map((f) => ({ folder: f.path, verified: true }));
    }

    // Fallback: conventional names. Accept exactly ONE unambiguous match;
    // multiple or zero candidates stay unverified and the caller decides
    // (§7.2: multiple unverified folders must not be silently trusted).
    const matches = SENT_FOLDER_FALLBACK_NAMES.flatMap((name) =>
      listing.filter((f) => f.path.toLowerCase() === name.toLowerCase())
    );
    if (matches.length !== 1) return [];
    return [{ folder: matches[0].path, verified: false }];
  }

  /**
   * Search ONE Sent folder for messages whose In-Reply-To or References
   * headers contain the original message id, then fetch the bounded header
   * block of each candidate (FR-031, §7.2).
   *
   * IMAP HEADER search is substring-based, so the caller must validate
   * exact-token equality locally — the returned candidates carry the raw
   * header values for that verification.
   *
   * Returns false when the search itself fails/incompletes (imapflow's
   * `false`), which callers must map to `unknown` — NOT to no-matches.
   * Candidates are capped at `cap` (bounding the header fetches, FR-039).
   * The result carries `truncated` (uids.length > cap — at least one candidate
   * was silently dropped, so the search is INCOMPLETE and must never yield a
   * negative) and `failedFetchCount` (UIDs whose header fetch returned nothing
   * — attempted fetches that count toward the shared budget, R05/R06).
   */
  async searchReplyHeaders(input: {
    config: EmailReceiveConnectionConfig;
    folder: string;
    originalMessageId: string;
    cap: number;
    signal?: AbortSignal;
    notBefore?: Date;
  }): Promise<ReplyHeaderSearchResult | false> {
    // R08: reject already-aborted work before opening a socket.
    if (input.signal?.aborted) return false;
    const client = this.createClient(input.config);
    // R08: attach the abort listener BEFORE connect so a hung connect() is
    // torn down the instant the signal aborts, not after connect resolves.
    const detachAbort = attachAbortListener(client, input.signal);
    try {
      await client.connect();
      if (abortIfSignaled(client, input.signal)) return false;
      return await this.searchReplyHeadersFromConnectedClient(
        client,
        input.folder,
        input.originalMessageId,
        input.cap,
        input.signal,
        input.notBefore
      );
    } finally {
      detachAbort?.();
      await closeClient(client);
    }
  }

  private async searchReplyHeadersFromConnectedClient(
    client: ImapFlowConnection,
    folder: string,
    originalMessageId: string,
    cap: number,
    signal?: AbortSignal,
    notBefore?: Date
  ): Promise<ReplyHeaderSearchResult | false> {
    // Open the Sent folder before searching — imapflow requires a selected
    // mailbox before `search`/`fetchOne` (omitting `mailboxOpen` runs the
    // search against whatever folder was last selected, or none, yielding
    // empty results). UIDVALIDITY is not re-checked here: the Sent side
    // settles a positive only via exact-token + sender verification, never
    // via UID longevity — so a UIDVALIDITY change on the Sent folder cannot
    // produce a false positive (§7.2).
    await client.mailboxOpen(folder);
    // Review D9.2: abort before the search if the deadline elapsed during
    // mailboxOpen. Returning false (search incomplete) keeps the outcome
    // unknown — never collapses to no-matches (§7.3).
    if (abortIfSignaled(client, signal)) return false;
    // substring search on both threading headers — exact equality is
    // validated locally from the fetched header block (§7.2).
    const query: SearchObject = {
      or: [
        { header: { "in-reply-to": originalMessageId } },
        { header: { references: originalMessageId } },
      ],
    };
    if (notBefore instanceof Date && Number.isFinite(notBefore.getTime())) {
      query.since = notBefore;
    }
    const uids = await client.search(query, { uid: true });
    if (uids === false) return false;

    // R05: report truncation. When the server returned more UIDs than the
    // budget (`cap`) allows, the dropped candidates may include the verified
    // direct reply. The detector must treat a truncated search as INCOMPLETE —
    // never a complete negative. `truncated` is true iff uids.length > cap.
    const effectiveCap = Math.max(0, cap);
    const bounded = uids.slice(0, effectiveCap);
    const truncated = uids.length > effectiveCap;
    const candidates: ReplyHeaderCandidate[] = [];
    // R06: count attempted fetches that returned nothing (expunged/malformed
    // mid-probe). These consumed a network round-trip but yielded no candidate
    // DTO — the detector accounts for them toward the shared budget so the
    // total attempted fetches never silently exceeds the cap.
    let failedFetchCount = 0;
    for (const uid of bounded) {
      // Review D9.2: check the deadline between candidate fetches — a 200-
      // candidate probe can take long enough that the deadline elapses mid-
      // loop. Aborting here tears down the socket instead of fetching the
      // remaining headers pointlessly.
      if (abortIfSignaled(client, signal)) return false;
      // Header-only fetch, PEEK semantics — no body, no flag writes.
      const msg = await client.fetchOne(
        uid,
        {
          headers: ["Message-ID", "In-Reply-To", "References", "From", "To", "Date"],
        },
        { uid: true }
      );
      if (!msg) {
        failedFetchCount += 1;
        continue;
      }
      const headers = parseHeaderBlock(msg.headers);
      if (headers.size === 0) {
        // R06: the fetch succeeded at the protocol level but none of the
        // requested headers were returned/readable — the candidate cannot be
        // verified. Counted as a failed fetch (incomplete coverage), never
        // pushed as an all-null candidate that the detector would silently
        // skip as a non-match.
        failedFetchCount += 1;
        continue;
      }
      candidates.push({
        folder,
        uid,
        messageId: headers.get("message-id") ?? null,
        inReplyTo: headers.get("in-reply-to") ?? null,
        references: headers.get("references") ?? null,
        from: headers.get("from") ?? null,
        to: headers.get("to") ?? null,
        date: headers.get("date") ?? null,
      });
    }
    return { candidates, truncated, failedFetchCount };
  }

  private async refreshFlagsFromConnectedClient(
    client: ImapFlowConnection,
    folder: string,
    uid: string,
    expectedUidValidity: string,
    signal?: AbortSignal
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
    // Review D9.2: abort before the fetch if the probe deadline elapsed during
    // mailboxOpen. The client is already closed by abortIfSignaled.
    if (abortIfSignaled(client, signal)) return null;

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

    // D8.3 (security): strip control chars (CR/LF/NUL/C0) from the subject —
    // the same log-injection / control-char vector D8.3 closed for POP3. IMAP
    // is the default receive path, so this is the higher-traffic site.
    const subject = sanitizeHeaderValue(parsed.subject ?? "(no subject)");
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
    const attachments = (parsed.attachments ?? []).map((a: { filename?: string | null; contentType?: string | null; size?: number }) => ({
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

/**
 * If the probe's deadline has elapsed, immediately tear down the IMAP socket
 * (review D9.2). `close()` is the abort path — it destroys the streamer and
 * clears tracked throttle/await timers, so an in-flight `mailboxOpen`/
 * `search`/`fetchOne` rejects promptly instead of lingering until the server
 * responds. `logout()` (used by {@link closeClient}) is the GRACEFUL close
 * path; on deadline abort we want the immediate one. Closing an already-closed
 * client is a safe no-op. Returns true when the caller should bail out and
 * surface an incomplete result (the detector maps it to `probe_timeout`).
 */
function abortIfSignaled(
  client: ImapFlowConnection,
  signal?: AbortSignal
): boolean {
  if (!signal?.aborted) return false;
  try {
    client.close();
  } catch {
    /* already closing — the finally's closeClient is a no-op on a closed socket */
  }
  return true;
}

/**
 * Attach an abort listener that tears down the IMAP socket the INSTANT the
 * deadline racer aborts (review D9.2). {@link abortIfSignaled} checkpoints fire
 * BETWEEN operations (after `connect`, after `mailboxOpen`, between fetches);
 * this listener fires DURING an in-flight `mailboxOpen`/`search`/`fetchOne`,
 * so a slow or hung server cannot keep the probe's socket alive past the
 * deadline. `client.close()` destroys the streamer and clears tracked timers,
 * causing the in-flight operation's promise to reject promptly.
 *
 * Returns a detach function (call in `finally` to release the closure holding
 * `client`); `undefined` when there is no signal to watch. If the signal is
 * already aborted, closes immediately and returns `undefined` — the caller's
 * checkpoint will surface the incomplete result.
 */
function attachAbortListener(
  client: ImapFlowConnection,
  signal?: AbortSignal
): (() => void) | undefined {
  if (!signal) return undefined;
  if (signal.aborted) {
    try {
      client.close();
    } catch {
      /* already closing */
    }
    return undefined;
  }
  const onClose = (): void => {
    try {
      client.close();
    } catch {
      /* already closing — the finally's closeClient is a no-op on a closed socket */
    }
  };
  signal.addEventListener("abort", onClose, { once: true });
  return (): void => {
    signal.removeEventListener("abort", onClose);
  };
}

export function buildImapFlowOptions(
  config: EmailReceiveConnectionConfig,
  mode: ImapConnectionMode = "configured",
  purpose: ImapFlowSessionPurpose = "sync"
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
    ...(purpose === "probe"
      ? {
          disableAutoIdle: true,
          greetingTimeout: IMAP_PROBE_GREETING_TIMEOUT_MS,
        }
      : {}),
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
