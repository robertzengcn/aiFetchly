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
import { sanitizeEmailHtml, htmlToPlainText } from "@/service/emailReceive/EmailHtmlSanitizer";
import {
  buildSnippet,
  extractThreadKey,
} from "@/service/emailReceive/EmailMessageParser";

const POP3_PORT = 110;
const POP3_SSL_PORT = 995;

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
    const client = new Pop3Connection(config.host, config.port, config.ssl, config.username, config.password);
    try {
      await client.connect();
    } finally {
      await client.quit().catch(() => { /* ignore */ });
    }
  }

  async fetchMessages(
    config: EmailReceiveConnectionConfig,
    options: EmailReceiveFetchOptions
  ): Promise<ParsedInboundEmail[]> {
    const limit = Math.max(1, Math.min(options.limit, 50));
    const client = new Pop3Connection(config.host, config.port, config.ssl, config.username, config.password);

    try {
      await client.connect();

      const stat = await client.stat();
      const totalMessages = stat.count;
      if (totalMessages === 0) return [];

      const start = Math.max(1, totalMessages - limit + 1);
      const results: ParsedInboundEmail[] = [];

      for (let i = start; i <= totalMessages; i++) {
        const raw = await client.retr(i);
        if (!raw) continue;

        const parsed = await simpleParser(raw);
        const record = this.toParsedInboundEmail(i, parsed);
        if (record) results.push(record);
      }

      return results;
    } finally {
      await client.quit().catch(() => { /* ignore */ });
    }
  }

  private toParsedInboundEmail(
    uid: number,
    parsed: Awaited<ReturnType<typeof simpleParser>>
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

    const toAddresses = addressListToStrings(
      (parsed.to?.value as { address?: string; name?: string }[] | undefined)
    );
    const ccAddresses = addressListToStrings(
      (parsed.cc?.value as { address?: string; name?: string }[] | undefined)
    );
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
      isUnread: false,
      autoSubmitted: autoSubmittedHeader ? String(autoSubmittedHeader) : null,
      precedence: precedenceHeader ? String(precedenceHeader) : null,
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
    private readonly password: string
  ) {}

  async connect(): Promise<void> {
    const net = await import("net");
    const tls = await import("tls");

    return new Promise<void>((resolve, reject) => {
      const connectOpts = {
        host: this.host,
        port: this.port || (this.ssl ? POP3_SSL_PORT : POP3_PORT),
        rejectUnauthorized: false,
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
      }, 15000);

      const onConnect = async () => {
        try {
          await this.waitForResponse(1000);
          if (!this.buffer.startsWith("+OK")) {
            throw new Error(`POP3 server rejected greeting: ${this.buffer.trim()}`);
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
        socket.removeListener("data", onData);
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
      setTimeout(() => {
        const resp = this.buffer;
        this.buffer = "";
        if (resp.startsWith("+OK")) {
          resolve(resp);
        } else if (resp.startsWith("-ERR")) {
          reject(new Error(`POP3 error: ${resp.replace("-ERR", "").trim()}`));
        } else {
          resolve(resp);
        }
      }, 10000);
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
          reject(new Error(`POP3 error: ${this.buffer.replace("-ERR", "").trim()}`));
          return;
        }
        const endMarkerIndex = this.buffer.indexOf("\r\n.\r\n");
        if (endMarkerIndex === -1) {
          setTimeout(checkBuffer, 200);
          return;
        }
        const full = this.buffer.substring(0, endMarkerIndex);
        const firstLineEnd = full.indexOf("\r\n");
        const body = firstLineEnd === -1 ? "" : full.substring(firstLineEnd + 2);
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
