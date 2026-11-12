import type {
  EmailReceiveConnectionConfig,
} from "@/entityTypes/emailReceiveTypes";
import {
  buildImapFlowOptions,
  shouldRetryWithImplicitTls,
} from "@/service/emailReceive/ImapEmailReceiveClient";
import {
  sanitizeMailboxError,
  type EmailMailboxAdapter,
  type SentCopyAppendResult,
  type FolderListResult,
  type FullSourceResult,
  type MailboxCapabilityProbe,
  type MailboxFolderInfo,
  type MailboxLocation,
  type MoveResult,
  type PresenceResult,
  type SearchCandidate,
  type ServerSearchInput,
  type ServerSearchResult,
} from "@/service/emailOrganization/EmailMailboxAdapter";

/**
 * Structural surface of an ImapFlow connection used by the mailbox adapter.
 * Extends the receive client's read surface with the mutation + capability
 * operations; the real client satisfies this structurally, tests inject fakes.
 */
export interface MailboxActionConnection {
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  list(): Promise<
    Array<{ path: string; name?: string; specialUse?: string; flags?: Iterable<string> }>
  >;
  mailboxOpen(path: string): Promise<{ uidValidity: bigint | number | string }>;
  search(
    query: Record<string, unknown>,
    options?: { uid?: boolean }
  ): Promise<number[] | false>;
  append(
    folder: string,
    message: Buffer | string,
    options?: { flags?: string[] }
  ): Promise<{ uid?: number } | boolean>;
  fetchOne(
    seq: string | number,
    query: Record<string, unknown>,
    options?: { uid?: boolean }
  ): Promise<{ flags?: Set<string> } | false>;
  messageMove(
    range: string | number,
    destination: string,
    options?: { uid?: boolean }
  ): Promise<
    | { path: string; destination: string; uidValidity?: bigint | number | string; uidMap?: Map<number, number> }
    | boolean
    | undefined
  >;
  capabilities: Set<string>;
}

export type MailboxActionConnectionFactory = (
  options: ReturnType<typeof buildImapFlowOptions>
) => MailboxActionConnection;

const CONNECTION_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function uidValidityToString(value: bigint | number | string): string {
  // Decimal string on purpose: bigint through JSON loses precision handling.
  return typeof value === "bigint" ? value.toString(10) : String(value);
}

/**
 * ImapFlow-backed mailbox-action adapter (technical design §5.1, §10.1).
 *
 * Compatibility contract enforced here (design §5.1): a move is issued ONLY
 * when the connected server advertises the MOVE capability. The underlying
 * library silently emulates MOVE with COPY + \Deleted + EXPUNGE otherwise —
 * this adapter refuses that path instead of risking a broad expunge.
 */
export class ImapEmailMailboxAdapter implements EmailMailboxAdapter {
  private readonly connectionFactory: MailboxActionConnectionFactory;

  constructor(options?: { connectionFactory?: MailboxActionConnectionFactory }) {
    this.connectionFactory =
      options?.connectionFactory ??
      ((imapOptions) => {
        // Lazy import keeps the real client out of pure-unit test paths.
        const ImapFlow = require("imapflow") as { ImapFlow: new (opts: unknown) => MailboxActionConnection };
        return new ImapFlow.ImapFlow({ ...imapOptions, emitLogs: false });
      });
  }

  async listFolders(config: EmailReceiveConnectionConfig): Promise<FolderListResult> {
    const session = await this.connect(config);
    if (!session.ok) return { status: "failed", reasonCode: "ACCOUNT_NOT_AVAILABLE", sanitizedError: session.error };
    try {
      const list = await withTimeout(session.connection.list(), COMMAND_TIMEOUT_MS, "folder listing");
      return { status: "listed", folders: foldersFromListResponse(list) };
    } catch (error) {
      return { status: "failed", reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: sanitizeMailboxError(error) };
    } finally {
      await closeSession(session.connection);
    }
  }

  async probeCapabilities(
    config: EmailReceiveConnectionConfig
  ): Promise<MailboxCapabilityProbe> {
    const session = await this.connect(config);
    if (!session.ok) {
      return {
        moveCapability: false,
        folders: [],
        reasonCode: "ACCOUNT_NOT_AVAILABLE",
        sanitizedError: session.error,
      };
    }
    try {
      const list = await withTimeout(session.connection.list(), COMMAND_TIMEOUT_MS, "folder listing");
      return {
        moveCapability: session.connection.capabilities.has("MOVE"),
        folders: foldersFromListResponse(list),
        reasonCode: null,
        sanitizedError: null,
      };
    } catch (error) {
      return {
        moveCapability: false,
        folders: [],
        reasonCode: "NETWORK_BEFORE_DISPATCH",
        sanitizedError: sanitizeMailboxError(error),
      };
    } finally {
      await closeSession(session.connection);
    }
  }

  async fetchFullSource(
    config: EmailReceiveConnectionConfig,
    location: MailboxLocation
  ): Promise<FullSourceResult> {
    const session = await this.connect(config);
    if (!session.ok) {
      return { status: "failed", reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: session.error };
    }
    try {
      const mailbox = await withTimeout(
        session.connection.mailboxOpen(location.folderPath),
        COMMAND_TIMEOUT_MS,
        "mailbox open"
      );
      const observed = uidValidityToString(mailbox.uidValidity);
      if (observed !== location.uidValidity) {
        return { status: "uid_validity_changed" };
      }
      // BODY.PEEK[] — does not set \Seen (design §10.4 invariant).
      const message = await withTimeout(
        session.connection.fetchOne(
          location.uid,
          { uid: true, source: true },
          { uid: true }
        ),
        COMMAND_TIMEOUT_MS,
        "source fetch"
      );
      if (!message) return { status: "source_missing" };
      const source = (message as { source?: Buffer }).source;
      if (!source || source.length === 0) return { status: "source_missing" };
      return { status: "fetched", source, uidValidity: observed };
    } catch (error) {
      return { status: "failed", reasonCode: "SOURCE_FETCH_FAILED", sanitizedError: sanitizeMailboxError(error) };
    } finally {
      await closeSession(session.connection);
    }
  }

  async moveMessage(
    config: EmailReceiveConnectionConfig,
    location: MailboxLocation,
    destinationFolderPath: string
  ): Promise<MoveResult> {
    if (location.folderPath === destinationFolderPath) {
      return { status: "failed", reasonCode: "DESTINATION_INVALID", sanitizedError: "destination equals source folder" };
    }
    const session = await this.connect(config);
    if (!session.ok) {
      return { status: "failed", reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: session.error };
    }
    // ---- Pre-dispatch phase: failures here prove nothing was sent. ----
    let preDispatchFailure: MoveResult | null = null;
    try {
      const mailbox = await withTimeout(
        session.connection.mailboxOpen(location.folderPath),
        COMMAND_TIMEOUT_MS,
        "mailbox open"
      );
      const observed = uidValidityToString(mailbox.uidValidity);
      if (observed !== location.uidValidity) {
        preDispatchFailure = { status: "uid_validity_changed" };
      } else if (!session.connection.capabilities.has("MOVE")) {
        // Compatibility gate (design §5.1): never allow the library's
        // COPY+EXPUNGE emulation to run.
        preDispatchFailure = { status: "no_move_capability" };
      } else {
        const existing = await withTimeout(
          session.connection.fetchOne(location.uid, { uid: true }, { uid: true }),
          COMMAND_TIMEOUT_MS,
          "message existence check"
        );
        if (!existing) preDispatchFailure = { status: "source_missing" };
      }
    } catch (error) {
      preDispatchFailure = {
        status: "failed",
        reasonCode: "NETWORK_BEFORE_DISPATCH",
        sanitizedError: sanitizeMailboxError(error),
      };
    }
    if (preDispatchFailure !== null) {
      await closeSession(session.connection);
      return preDispatchFailure;
    }

    try {
      // ---- Dispatch phase: a transport failure here is conservatively
      // unknown — the command may still have completed server-side. ----
      const result = await withTimeout(
        session.connection.messageMove(location.uid, destinationFolderPath, { uid: true }),
        COMMAND_TIMEOUT_MS,
        "message move"
      );
      if (!result || typeof result !== "object") {
        // R5-04 (design §10.3): the command was ISSUED — lack of a parseable
        // proof is unknown, not a definitive rejection (a retry could move
        // the message twice). Reconciliation decides from mailbox evidence.
        return { status: "failed", reasonCode: "OUTCOME_UNKNOWN", sanitizedError: "move command did not confirm" };
      }
      const uidMap = result.uidMap;
      const destinationUid = uidMap instanceof Map ? uidMap.get(Number(location.uid)) : undefined;
      return {
        status: "moved",
        destinationUidValidity:
          result.uidValidity !== undefined ? uidValidityToString(result.uidValidity) : null,
        destinationUid: destinationUid !== undefined ? String(destinationUid) : null,
      };
    } catch (error) {
      return { status: "failed", reasonCode: "OUTCOME_UNKNOWN", sanitizedError: sanitizeMailboxError(error) };
    } finally {
      await closeSession(session.connection);
    }
  }

  async appendSent(
    config: EmailReceiveConnectionConfig,
    rawMessage: Buffer
  ): Promise<SentCopyAppendResult> {
    const session = await this.connect(config);
    if (!session.ok) {
      return {
        status: "failed",
        reasonCode: "ACCOUNT_NOT_AVAILABLE",
        sanitizedError: session.error,
      };
    }
    try {
      // Prefer the special-use Sent folder; probe for it per attempt.
      const list = await withTimeout(session.connection.list(), COMMAND_TIMEOUT_MS, "folder listing");
      const sentFolder = list.find((entry) => entry.specialUse === "\\Sent")?.path;
      if (sentFolder === undefined) {
        return { status: "skipped", reason: "no_sent_folder" };
      }
      await withTimeout(
        session.connection.append(sentFolder, rawMessage, { flags: ["\\Seen"] }),
        COMMAND_TIMEOUT_MS,
        "sent append"
      );
      return { status: "saved" };
    } catch (error) {
      return {
        status: "failed",
        reasonCode: "PROVIDER_REJECTED",
        sanitizedError: sanitizeMailboxError(error),
      };
    } finally {
      await closeSession(session.connection);
    }
  }

  async searchUids(
    config: EmailReceiveConnectionConfig,
    folderPath: string,
    input: ServerSearchInput
  ): Promise<ServerSearchResult> {
    const session = await this.connect(config);
    if (!session.ok) {
      return { status: "failed", reasonCode: "ACCOUNT_NOT_AVAILABLE", sanitizedError: session.error };
    }
    try {
      await withTimeout(session.connection.mailboxOpen(folderPath), COMMAND_TIMEOUT_MS, "mailbox open");
      const query: Record<string, unknown> = {};
      if (input.since) query["since"] = input.since;
      if (input.before) query["before"] = input.before;
      if (input.unreadOnly) query["seen"] = false;
      if (input.subject && input.subject.trim() !== "") query["subject"] = input.subject.trim();
      if (input.fromAddress && input.fromAddress.trim() !== "") query["from"] = input.fromAddress.trim();
      // R5-02: exact Message-ID header match (forward reconcile vs Sent).
      if (input.messageIdHeader && input.messageIdHeader.trim() !== "") {
        query["header"] = { "message-id": input.messageIdHeader.trim() };
      }
      const uids = await withTimeout(
        session.connection.search(query, { uid: true }),
        COMMAND_TIMEOUT_MS,
        "server search"
      );
      if (uids === false) {
        return { status: "failed", reasonCode: "PROVIDER_REJECTED", sanitizedError: "search unsupported" };
      }
      // R8-02: resume strictly AFTER resumeUid — a UID high-water mark is
      // stable when the mailbox changes between pages (new mail gets higher
      // UIDs; an index into a fresh SEARCH would shift and repeat rows).
      // R6-02: `capped` means the returned WINDOW was cut before the end of
      // this SEARCH's match list — NOT that the window size was reached.
      const resumeUid = input.resumeUid ?? 0;
      const matched = resumeUid > 0 ? uids.filter((uid) => uid > resumeUid) : uids;
      const window = matched.slice(0, input.cap);
      const capped = matched.length > window.length;
      // Envelope fetches are the expensive part: only the caller-requested
      // page worth are materialized; the rest stay counted but unnamed.
      const page = window.slice(0, Math.min(window.length, input.metadataLimit ?? input.cap));
      const candidates: SearchCandidate[] = [];
      for (const uid of page) {
        const message = await withTimeout(
          session.connection.fetchOne(uid, { uid: true, envelope: true, flags: true }, { uid: true }),
          COMMAND_TIMEOUT_MS,
          "search metadata fetch"
        );
        if (!message) {
          // R6-02: a dropped envelope fetch must NOT shorten the candidate
          // list — the caller's offset advances by the slice length, so an
          // omitted UID would shift the next page and repeat a row. Keep
          // the UID with unknown metadata.
          candidates.push({
            uid: String(uid),
            fromAddress: null,
            subject: null,
            date: null,
            seen: null,
          });
          continue;
        }
        const envelope = (message as { envelope?: { from?: Array<{ address?: string }>; subject?: string; date?: Date | null } }).envelope;
        const flags = (message as { flags?: Set<string> }).flags;
        // R15: system flags are case-insensitive per RFC 3501 (\\Seen vs \seen).
        const seen = flags
          ? Array.from(flags).some((flag) => flag.toLowerCase() === "\\seen")
          : null;
        candidates.push({
          uid: String(uid),
          fromAddress: envelope?.from?.[0]?.address ?? null,
          subject: envelope?.subject ?? null,
          date: envelope?.date ? new Date(envelope.date).toISOString() : null,
          seen,
        });
      }
      return { status: "listed", candidates, capped };
    } catch (error) {
      return { status: "failed", reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: sanitizeMailboxError(error) };
    } finally {
      await closeSession(session.connection);
    }
  }

  async checkMessagePresent(
    config: EmailReceiveConnectionConfig,
    location: MailboxLocation
  ): Promise<PresenceResult> {
    const session = await this.connect(config);
    if (!session.ok) {
      return { status: "failed", reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: session.error };
    }
    try {
      const mailbox = await withTimeout(
        session.connection.mailboxOpen(location.folderPath),
        COMMAND_TIMEOUT_MS,
        "mailbox open"
      );
      const observed = uidValidityToString(mailbox.uidValidity);
      if (observed !== location.uidValidity) {
        return { status: "uid_validity_changed" };
      }
      const existing = await withTimeout(
        session.connection.fetchOne(location.uid, { uid: true }, { uid: true }),
        COMMAND_TIMEOUT_MS,
        "message existence check"
      );
      return existing ? { status: "present" } : { status: "absent" };
    } catch (error) {
      return { status: "failed", reasonCode: "NETWORK_BEFORE_DISPATCH", sanitizedError: sanitizeMailboxError(error) };
    } finally {
      await closeSession(session.connection);
    }
  }

  private async connect(
    config: EmailReceiveConnectionConfig
  ): Promise<{ ok: true; connection: MailboxActionConnection } | { ok: false; error: string }> {
    const closeQuietly = (client: MailboxActionConnection | undefined): void => {
      try {
        client?.close();
      } catch {
        // best-effort
      }
    };
    let connection: MailboxActionConnection | undefined;
    try {
      connection = this.connectionFactory(buildImapFlowOptions(config, "configured", "probe"));
      await withTimeout(connection.connect(), CONNECTION_TIMEOUT_MS, "IMAP connect");
    } catch (error) {
      // A timed-out promise does not stop the socket: close the client we
      // created so a hanging handshake cannot leak a connection.
      closeQuietly(connection);
      // One implicit-TLS retry for handshake mismatch, mirroring the receive client.
      if (shouldRetryWithImplicitTls(error, config)) {
        try {
          connection = this.connectionFactory(buildImapFlowOptions(config, "implicitTls", "probe"));
          await withTimeout(connection.connect(), CONNECTION_TIMEOUT_MS, "IMAP connect (implicit TLS)");
        } catch (retryError) {
          closeQuietly(connection);
          return { ok: false, error: sanitizeMailboxError(retryError) };
        }
        return { ok: true, connection: connection as MailboxActionConnection };
      }
      return { ok: false, error: sanitizeMailboxError(error) };
    }
    return { ok: true, connection: connection as MailboxActionConnection };
  }
}

async function closeSession(connection: MailboxActionConnection): Promise<void> {
  try {
    await connection.logout();
  } catch {
    connection.close();
  }
}

function foldersFromListResponse(
  list: Array<{ path: string; name?: string; specialUse?: string; flags?: Iterable<string> }>
): MailboxFolderInfo[] {
  const folders: MailboxFolderInfo[] = [];
  for (const entry of list) {
    if (!entry || !entry.path) continue;
    const flags = entry.flags ? new Set(Array.from(entry.flags, (flag) => String(flag).toLowerCase())) : null;
    folders.push({
      path: entry.path,
      name: entry.name ?? entry.path.split("/").pop() ?? entry.path,
      specialUse: typeof entry.specialUse === "string" ? entry.specialUse : null,
      writable: flags === null ? true : !flags.has("\\noselect"),
    });
  }
  return folders;
}
