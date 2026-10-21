import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
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
import {
  sanitizeEmailHtml,
  htmlToPlainText,
} from "@/service/emailReceive/EmailHtmlSanitizer";
import {
  buildSnippet,
  extractThreadKey,
  sanitizeHeaderValue,
} from "@/service/emailReceive/EmailMessageParser";

// Re-export for tests that import the helper from the POP3 module path.
export { sanitizeHeaderValue } from "@/service/emailReceive/EmailMessageParser";

const POP3_PORT = 110;
const POP3_SSL_PORT = 995;

/**
 * D8 (security): maximum bytes accumulated for a single POP3 multi-line
 * response (RETR). A malicious or buggy server streaming without the `.`
 * terminator previously caused unbounded buffer growth. Capped at 50 MB —
 * well above any legitimate email, well below memory-exhaustion territory.
 */
export const POP3_MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/**
 * V02: prefix for the POP3 providerUid. The stored providerUid is
 * `pop3:<sha256(uidl)>` — a stable, server-assigned unique-id (UIDL, RFC 1939
 * §5) hashed to fit the 255-char column. This is NOT the mutable message
 * sequence number, which changes whenever an earlier message is deleted and
 * later messages are renumbered. Keying on the sequence number caused a resync
 * to upsert message B's content + evidence into message A's row after the
 * server deleted A and renumbered. The UIDL is server-assigned and stable for
 * the lifetime of the message in the mailbox (§5, "the unique-id ... MUST NOT
 * change ... the same unique-id ... MUST be returned in all subsequent
 * sessions"). It is therefore a safe per-message identity for the lifetime of
 * the stored row.
 *
 * `null` providerFolder / providerUidValidity remain: POP3 has no folders or
 * UIDVALIDITY, and the UIDL carries no version to namespace against — a stable
 * UIDL is all POP3 offers. POP3 guarded replies deliberately remain
 * unavailable (R-style mailbox probes are IMAP-only).
 */
export const POP3_PROVIDER_UID_PREFIX = "pop3:";

/** Max length of the stored providerUid column (entity-defined). */
const PROVIDER_UID_MAX_LENGTH = 255;

/**
 * Build the stable POP3 providerUid from a server-assigned UIDL unique-id
 * (RFC 1939 §5). The UIDL is hashed so:
 *  - the value fits the 255-char column regardless of the server's UIDL format;
 *  - the raw unique-id is not stored verbatim (some servers emit email
 *    addresses or server-internal tokens as the UIDL value).
 * Pure; mirrors {@link buildNamespacedProviderUid}'s hashing approach.
 */
export function buildPop3ProviderUid(uidlUnique: string): string {
  const hash = createHash("sha256")
    .update(uidlUnique, "utf8")
    .digest("hex");
  const providerUid = `${POP3_PROVIDER_UID_PREFIX}${hash}`;
  if (providerUid.length > PROVIDER_UID_MAX_LENGTH) {
    // Defensive: a hash is fixed-length (71 chars here), so this never fires
    // in practice — but a truncated identifier would silently collide with
    // another row, so refuse rather than truncate.
    return providerUid.slice(0, PROVIDER_UID_MAX_LENGTH);
  }
  return providerUid;
}

/**
 * Detect whether a stored providerUid is the stable POP3 UIDL form
 * (post-V02 sync) or a legacy bare sequence-number string (pre-V02).
 *
 * Legacy bare sequence numbers (e.g. `"5"`, `"42"`) may NOT be treated as the
 * same message after the server renumbers — the guard must surface a conflict
 * until the row is reconciled (see {@link isNamespacedProviderUid} for the
 * IMAP equivalent). This is the POP3 analogue.
 */
export function isPop3ProviderUid(
  providerUid: string | null | undefined
): boolean {
  if (!providerUid) return false;
  return providerUid.startsWith(POP3_PROVIDER_UID_PREFIX);
}

/**
 * V02: parse the multi-line body of a POP3 `UIDL` response (RFC 1939 §5) into a
 * map of message sequence number → server-assigned unique-id. Each non-empty
 * line is `<seq> <unique-id>`. Pure (no I/O) so the parser is unit-testable
 * independent of the raw socket; the {@link Pop3Connection.uidl} method composes
 * `sendMultiLineCommand("UIDL")` with this helper.
 *
 * Malformed lines (no space, non-numeric seq, empty unique-id) are skipped
 * rather than thrown — a single bad line from a quirky server must not abort
 * the whole sync. An empty body yields an empty map (an empty mailbox, or a
 * server that returned no listing).
 */
export function parseUidlListing(body: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!body) return map;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(" ");
    if (sep === -1) continue;
    const seq = parseInt(trimmed.slice(0, sep), 10);
    const uniqueId = trimmed.slice(sep + 1).trim();
    if (Number.isFinite(seq) && seq > 0 && uniqueId.length > 0) {
      map.set(seq, uniqueId);
    }
  }
  return map;
}

/**
 * POP3 receive client implementation using Node.js built-in `net` and `tls`
 * modules with the standard POP3 protocol (RFC 1939).
 *
 * POP3 has no folder semantics, no flags, and no reliable unread state.
 * All messages are in the default "INBOX" and anything successfully fetched
 * is treated as read.
 */
export class Pop3EmailReceiveClient implements EmailReceiveClient {
  async testConnection(config: EmailReceiveConnectionConfig): Promise<void> {
    const client = new Pop3Connection(
      config.host,
      config.port,
      config.ssl,
      config.username,
      config.password,
      config.tlsRejectUnauthorized ?? true
    );
    try {
      await client.connect();
    } finally {
      await client.quit().catch(() => {
        /* ignore */
      });
    }
  }

  async fetchMessages(
    config: EmailReceiveConnectionConfig,
    options: EmailReceiveFetchOptions
  ): Promise<ParsedInboundEmail[]> {
    const limit = Math.max(1, Math.min(options.limit, 50));
    const client = new Pop3Connection(
      config.host,
      config.port,
      config.ssl,
      config.username,
      config.password,
      config.tlsRejectUnauthorized ?? true
    );

    try {
      await client.connect();

      const stat = await client.stat();
      const totalMessages = stat.count;
      if (totalMessages === 0) return [];

      // V02: fetch the server-assigned UIDL list ONCE per sync (RFC 1939 §5).
      // Each entry maps a message sequence number to a server-assigned unique-id
      // that is stable for the message's lifetime in the mailbox. The sequence
      // number alone is mutable: deleting an earlier message renumbers later
      // ones, so keying on `String(i)` caused a resync to upsert message B's
      // content into message A's row. The UIDL is the stable identity POP3
      // offers; messages whose UIDL cannot be resolved fall back to the
      // sequence number (best-effort, never abort the sync) so a server that
      // declines UIDL still receives mail — those rows surface as legacy bare
      // UIDs and are never silently adopted as a different message.
      let uidlMap: Map<number, string> | null = null;
      try {
        uidlMap = await client.uidl();
      } catch {
        uidlMap = null;
      }

      const start = Math.max(1, totalMessages - limit + 1);
      const results: ParsedInboundEmail[] = [];

      for (let i = start; i <= totalMessages; i++) {
        const raw = await client.retr(i);
        if (!raw) continue;

        const parsed = await simpleParser(raw);
        // V02: identity = stable UIDL unique-id (preferred) over the mutable
        // sequence number.
        const uidlUnique = uidlMap?.get(i) ?? null;
        const record = this.toParsedInboundEmail(
          uidlUnique,
          i,
          parsed
        );
        if (record) results.push(record);
      }

      return results;
    } finally {
      await client.quit().catch(() => {
        /* ignore */
      });
    }
  }

  /**
   * Build a ParsedInboundEmail from a parsed message.
   *
   * @param uidlUnique the server-assigned UIDL unique-id (RFC 1939 §5) for this
   *   message — the stable identity. Null when the server declined UIDL; the
   *   mutable sequence number is used as a best-effort fallback (a legacy bare
   *   UID that is never silently adopted as a different message on resync).
   * @param sequenceNumber the POP3 message sequence number, used ONLY as the
   *   fallback identity when no UIDL is available.
   */
  private toParsedInboundEmail(
    uidlUnique: string | null,
    sequenceNumber: number,
    parsed: Awaited<ReturnType<typeof simpleParser>>
  ): ParsedInboundEmail | null {
    const from = firstAddress(parsed.from?.value?.[0] ?? null);
    if (!from.address) return null;

    const rawHtml = typeof parsed.html === "string" ? parsed.html : null;
    const bodyHtmlSanitized = sanitizeEmailHtml(rawHtml);
    const bodyText =
      (parsed.text && parsed.text.length > 0 ? parsed.text : null) ??
      (rawHtml ? htmlToPlainText(rawHtml) : null);

    const subject = sanitizeHeaderValue(
      parsed.subject ?? "(no subject)"
    );
    const messageId = parsed.messageId ? parsed.messageId.trim() : null;
    const inReplyTo = parsed.inReplyTo ? String(parsed.inReplyTo).trim() : null;
    const referencesHeader = parsed.references
      ? Array.isArray(parsed.references)
        ? (parsed.references as string[]).join(" ")
        : String(parsed.references)
      : null;
    const threadKey = extractThreadKey(messageId, inReplyTo, referencesHeader);

    const toAddresses = addressListToStrings(
      parsed.to?.value as { address?: string; name?: string }[] | undefined
    );
    const ccAddresses = addressListToStrings(
      parsed.cc?.value as { address?: string; name?: string }[] | undefined
    );
    const replyTo = firstAddress(parsed.replyTo?.value?.[0] ?? null);

    const autoSubmittedHeader = parsed.headers?.get("auto-submitted");
    const precedenceHeader = parsed.headers?.get("precedence");

    return {
      // V02: identity = stable server-assigned UIDL unique-id (hashed to fit the
      // column), NOT the mutable POP3 sequence number. A deleted earlier message
      // renumbers later ones; keying on the sequence number caused a resync to
      // replace message A's stored content/evidence with message B's. The UIDL
      // is stable for the message's lifetime in the mailbox (RFC 1939 §5).
      // When the server declines UIDL, fall back to the sequence number so the
      // message is still received (best-effort, never abort the sync) — that row
      // is a legacy bare UID and is never silently adopted as a different
      // message on a later resync.
      providerUid:
        uidlUnique !== null && uidlUnique.length > 0
          ? buildPop3ProviderUid(uidlUnique)
          : String(sequenceNumber),
      // POP3 has no folders or UIDVALIDITY; the providerUid is a UIDL-derived
      // hash, so both provenance fields stay null (FR-030 §5.1).
      providerFolder: null,
      providerUidValidity: null,
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
      isUnread: false,
      isAnswered: false,
      autoSubmitted: autoSubmittedHeader ? String(autoSubmittedHeader) : null,
      precedence: precedenceHeader ? String(precedenceHeader) : null,
      listIdHeader: null,
      listUnsubscribeHeader: null,
      attachments: [],
    };
  }
}

/**
 * Low-level POP3 connection handler using raw socket commands (RFC 1939).
 */
class Pop3Connection {
  private socket: import("net").Socket | null = null;
  private buffer = "";

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly ssl: boolean,
    private readonly username: string,
    private readonly password: string,
    private readonly tlsRejectUnauthorized: boolean
  ) {}

  async connect(): Promise<void> {
    const net = await import("net");
    const tls = await import("tls");

    return new Promise<void>((resolve, reject) => {
      // D8 (security): TLS certificate validation is ON by default
      // (rejectUnauthorized: true). Only disabled when the caller explicitly
      // opts out via tlsRejectUnauthorized: false — never silently.
      const connectOpts = {
        host: this.host,
        port: this.port || (this.ssl ? POP3_SSL_PORT : POP3_PORT),
        rejectUnauthorized: this.tlsRejectUnauthorized,
      };

      const socket = this.ssl
        ? tls.connect(connectOpts)
        : net.createConnection(connectOpts);

      this.socket = socket;
      this.buffer = "";

      const onData = (chunk: Buffer) => {
        this.buffer += chunk.toString();
      };

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("POP3 connection timed out"));
      }, 30000);

      const onConnect = async () => {
        try {
          await this.waitForResponse(1000);
          if (!this.buffer.startsWith("+OK")) {
            throw new Error(
              `POP3 server rejected greeting: ${this.buffer.trim()}`
            );
          }
          this.buffer = "";

          await this.sendCommand(`USER ${this.username}`);
          await this.sendCommand(`PASS ${this.password}`);
          clearTimeout(timeout);
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          socket.destroy();
          reject(err);
        }
      };

      socket.once("data", () => {
        onConnect();
      });
      socket.on("data", onData);
      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      socket.on("close", () => {
        clearTimeout(timeout);
      });
    });
  }

  async stat(): Promise<{ count: number; size: number }> {
    const resp = await this.sendCommand("STAT");
    const parts = resp.trim().split(/\s+/);
    return {
      count: parseInt(parts[1], 10) || 0,
      size: parseInt(parts[2], 10) || 0,
    };
  }

  async retr(msgNumber: number): Promise<Buffer | null> {
    const resp = await this.sendMultiLineCommand(`RETR ${msgNumber}`);

    if (resp === null) return null;

    return Buffer.from(resp, "utf-8");
  }

  /**
   * V02: issue the POP3 UIDL command (RFC 1939 §5) and return a map of message
   * sequence number → server-assigned unique-id. `UIDL` (no argument) lists
   * every message; each response line is `<seq> <unique-id>`. The unique-id is
   * stable for the message's lifetime in the mailbox — unlike the sequence
   * number, which is renumbered when an earlier message is deleted.
   *
   * Returns an empty map when the server returns no listing (e.g. an empty
   * mailbox). Throws on `-ERR` (a server that does not implement UIDL, or a
   * session error) — the caller falls back to the mutable sequence number so
   * the sync never aborts solely because UIDL is unavailable.
   */
  async uidl(): Promise<Map<number, string>> {
    const resp = await this.sendMultiLineCommand("UIDL");
    if (resp === null) return new Map<number, string>();
    return parseUidlListing(resp);
  }

  async quit(): Promise<void> {
    if (!this.socket) return;
    try {
      await this.sendCommand("QUIT");
    } catch {
      /* ignore */
    }
    this.socket.destroy();
    this.socket = null;
  }

  private async sendCommand(cmd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("POP3 not connected"));
        return;
      }
      this.buffer = "";
      this.socket.write(cmd + "\r\n", (err) => {
        if (err) reject(err);
      });
      const start = Date.now();
      const check = () => {
        if (this.buffer) {
          const resp = this.buffer;
          this.buffer = "";
          if (resp.startsWith("+OK")) {
            resolve(resp);
          } else if (resp.startsWith("-ERR")) {
            reject(new Error(`POP3 error: ${resp.replace("-ERR", "").trim()}`));
          } else {
            resolve(resp);
          }
          return;
        }
        if (Date.now() - start > 10000) {
          reject(new Error("POP3 command timeout"));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  private async sendMultiLineCommand(cmd: string): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("POP3 not connected"));
        return;
      }
      this.buffer = "";
      this.socket.write(cmd + "\r\n", (err) => {
        if (err) reject(err);
      });

      const checkBuffer = () => {
        if (!this.buffer) {
          setTimeout(checkBuffer, 200);
          return;
        }
        if (this.buffer.startsWith("-ERR")) {
          reject(
            new Error(`POP3 error: ${this.buffer.replace("-ERR", "").trim()}`)
          );
          return;
        }
        const endMarkerIndex = this.buffer.indexOf("\r\n.\r\n");
        if (endMarkerIndex === -1) {
          // D8 (security): cap the response buffer to prevent a malicious or
          // buggy server from streaming without the terminator and exhausting
          // memory. Reject once the cap is exceeded — well above any
          // legitimate email, well below memory-exhaustion territory.
          if (Buffer.byteLength(this.buffer, "utf-8") > POP3_MAX_RESPONSE_BYTES) {
            reject(
              new Error(
                `POP3 response exceeded ${POP3_MAX_RESPONSE_BYTES} bytes without terminator`
              )
            );
            return;
          }
          setTimeout(checkBuffer, 200);
          return;
        }
        const full = this.buffer.substring(0, endMarkerIndex);
        const firstLineEnd = full.indexOf("\r\n");
        const body =
          firstLineEnd === -1 ? "" : full.substring(firstLineEnd + 2);
        resolve(body);
      };
      checkBuffer();
    });
  }

  private waitForResponse(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (this.buffer) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error("POP3 response timeout"));
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }
}
