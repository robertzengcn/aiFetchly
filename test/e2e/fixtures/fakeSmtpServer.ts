/**
 * Recording loopback SMTP server for the email-identity E2E scenarios
 * (P0.3, PRD §17.4). Speaks just enough of RFC 5321 for nodemailer to complete
 * a plain-SMTP (ssl: 0) send, recording the AUTH username, MAIL FROM, RCPT TO,
 * and parsed DATA headers (including the Reply-To header) so scenarios can
 * assert that the production resolver wired AUTH/From/Reply-To separately.
 *
 * The server runs on an ephemeral loopback port in the Playwright test process
 * — allowed by the loopback-only E2E network policy and reachable by the
 * production nodemailer sender in both the Test Email path and the reply send
 * path. It never touches the network: all connections come from 127.0.0.1.
 *
 * Supported modes:
 *  - "accept" (default): complete the SMTP dance, record the envelope + headers.
 *  - "reject_mail_from": respond 5xx to the first MAIL FROM so the production
 *    classifier maps the failure to `smtp_from_rejected` (scenario 5).
 *
 * The server is deliberately minimal: no TLS upgrade, no pipelining, no
 * DSN. It is NOT a general-purpose MTA — it exists to make the identity-
 * separation assertions possible end-to-end.
 */

import * as net from "node:net";

/** A single recorded SMTP conversation. */
export interface RecordedSmtpMessage {
  /** AUTH username decoded from the AUTH PLAIN/LOGIN exchange. */
  readonly authUser: string | null;
  /** MAIL FROM envelope sender. */
  readonly mailFrom: string | null;
  /** RCPT TO envelope recipient(s). */
  readonly rcptTo: readonly string[];
  /** Parsed DATA headers (lowercased name → value). Includes Reply-To. */
  readonly headers: Readonly<Record<string, string>>;
  /** The message body text after the blank line. */
  readonly body: string;
}

export interface FakeSmtpServer {
  readonly port: number;
  /** Messages recorded so far (one per completed DATA). */
  readonly recordedMessages: RecordedSmtpMessage[];
  /** Set the rejection mode for the next connection. */
  setRejectMailFrom(enabled: boolean): void;
  /** Reset recordings + mode between scenarios sharing one server. */
  reset(): void;
  close(): Promise<void>;
}

type Mode = "accept" | "reject_mail_from";

interface InFlight {
  authUser: string | null;
  mailFrom: string | null;
  rcptTo: string[];
  headerLines: string[];
  bodyLines: string[];
  inData: boolean;
  /** True once the blank line separating headers from body has been seen. */
  seenBlankLine: boolean;
}

const CRLF = "\r\n";

function decodeAuthPlain(decoded: string): string {
  // AUTH PLAIN payload is base64 of \0user\0pass (or user\0pass).
  const parts = decoded.split("\0");
  return parts.length >= 2 ? parts[1] || parts[0] || "" : decoded;
}

function decodeAuthLoginValue(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf8");
}

function parseHeaders(rawLines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  let lastName = "";
  for (const line of rawLines) {
    if (line === "") break;
    const folded = /^[ \t]/.test(line);
    if (folded && lastName) {
      headers[lastName] += " " + line.trim();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[name] = value;
    lastName = name;
  }
  return headers;
}

/**
 * Start the recording loopback SMTP server. Returns the handle with the
 * resolved ephemeral port and the recorded-messages array (mutated as
 * connections complete).
 */
export function startFakeSmtpServer(): Promise<FakeSmtpServer> {
  const recordedMessages: RecordedSmtpMessage[] = [];
  let mode: Mode = "accept";

  const server = net.createServer((socket) => {
    const state: InFlight = {
      authUser: null,
      mailFrom: null,
      rcptTo: [],
      headerLines: [],
      bodyLines: [],
      inData: false,
      seenBlankLine: false,
    };

    const write = (line: string): void => {
      try {
        socket.write(line + CRLF);
      } catch {
        // socket may have been destroyed by the client
      }
    };

    write("220 e2e-fake-smtp ready");

    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf(CRLF)) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        handleLine(line);
      }
    });

    socket.on("error", () => {
      // Client disconnected abruptly; nothing to record.
    });

    function finalizeData(): void {
      const headers = parseHeaders(state.headerLines);
      const body = state.bodyLines.join("\n");
      recordedMessages.push({
        authUser: state.authUser,
        mailFrom: state.mailFrom,
        rcptTo: [...state.rcptTo],
        headers,
        body,
      });
      state.headerLines = [];
      state.bodyLines = [];
      state.inData = false;
      state.seenBlankLine = false;
      write("250 OK message accepted");
    }

    function handleLine(line: string): void {
      if (state.inData) {
        if (line === ".") {
          finalizeData();
          return;
        }
        // Unescape dot-stuffing per RFC 5321 §4.5.2.
        const unescaped = line.startsWith("..") ? line.slice(1) : line;
        // The first blank line separates the header section from the body.
        // Once seen, everything (including subsequent blank lines) is body.
        if (!state.seenBlankLine) {
          if (unescaped === "") {
            state.seenBlankLine = true;
            return;
          }
          state.headerLines.push(unescaped);
        } else {
          state.bodyLines.push(unescaped);
        }
        return;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        write("250-e2e-fake-smtp");
        write("250-AUTH PLAIN LOGIN");
        write("250 OK");
        return;
      }
      if (upper.startsWith("AUTH PLAIN ")) {
        const payload = line.slice("AUTH PLAIN ".length).trim();
        try {
          const decoded = Buffer.from(payload, "base64").toString("utf8");
          state.authUser = decodeAuthPlain(decoded) || null;
        } catch {
          state.authUser = null;
        }
        write("235 2.7.0 Authentication successful");
        return;
      }
      if (upper.startsWith("AUTH LOGIN")) {
        write("334 " + Buffer.from("Username:").toString("base64"));
        return;
      }
      // AUTH LOGIN username response (base64).
      if (
        state.authUser === null &&
        /^[A-Za-z0-9+/]+=*$/.test(line) &&
        line.length > 2
      ) {
        try {
          const decoded = decodeAuthLoginValue(line);
          if (decoded.includes("@") || decoded.length < 100) {
            state.authUser = decoded;
            write("334 " + Buffer.from("Password:").toString("base64"));
            return;
          }
        } catch {
          // fall through
        }
      }
      // AUTH LOGIN password response — accept and mark auth done.
      if (state.authUser !== null && /^[A-Za-z0-9+/]+=*$/.test(line)) {
        write("235 2.7.0 Authentication successful");
        return;
      }
      if (upper.startsWith("MAIL FROM")) {
        if (mode === "reject_mail_from") {
          write("535 5.7.0 Sender address rejected: not authorized");
          return;
        }
        const match = line.match(/MAIL FROM:\s*<([^>]*)>/i);
        state.mailFrom = match ? match[1] : null;
        write("250 2.1.0 OK");
        return;
      }
      if (upper.startsWith("RCPT TO")) {
        const match = line.match(/RCPT TO:\s*<([^>]*)>/i);
        if (match) state.rcptTo.push(match[1]);
        write("250 2.1.5 OK");
        return;
      }
      if (upper === "DATA") {
        state.inData = true;
        state.headerLines = [];
        state.bodyLines = [];
        state.seenBlankLine = false;
        write("354 End data with <CR><LF>.<CR><LF>");
        return;
      }
      if (upper === "QUIT") {
        write("221 2.0.0 Bye");
        socket.end();
        return;
      }
      if (upper === "RSET") {
        state.mailFrom = null;
        state.rcptTo = [];
        write("250 OK");
        return;
      }
      if (upper === "NOOP") {
        write("250 OK");
        return;
      }
      // Unknown command — respond politely to keep the session alive.
      write("250 OK");
    }
  });

  return new Promise<FakeSmtpServer>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("fake SMTP server did not get a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        get recordedMessages(): RecordedSmtpMessage[] {
          return recordedMessages;
        },
        setRejectMailFrom(enabled: boolean): void {
          mode = enabled ? "reject_mail_from" : "accept";
        },
        reset(): void {
          recordedMessages.length = 0;
          mode = "accept";
        },
        close(): Promise<void> {
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
