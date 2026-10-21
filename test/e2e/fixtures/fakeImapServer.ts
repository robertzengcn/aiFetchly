/**
 * Minimal loopback IMAP4rev1 server for the reply-guard E2E scenarios
 * (G04 — eligible-reuse success, happy-path SMTP send, unknown-delivery
 * reconciliation, and the G02 flagged-draft loop).
 *
 * Speaks just enough IMAP for ImapFlow (the production receive client) to
 * complete the §7.1 probe: greeting, CAPABILITY, LOGIN, LIST, SELECT,
 * UID SEARCH (always empty — no reply candidates), UID FETCH (FLAGS /
 * INTERNALDATE for configured messages), LOGOUT. It never touches the
 * network: it binds 127.0.0.1 on an ephemeral port in the Playwright test
 * process, allowed by the loopback-only E2E network policy.
 *
 * Deliberately NOT advertised: AUTH= mechanisms (so ImapFlow uses plaintext
 * LOGIN, avoiding AUTHENTICATE literal negotiation), CONDSTORE, LIST-EXTENDED
 * (plain `LIST "" "*"` only — the scenarios need exactly the conventional
 * `Sent` fallback name, which the detector accepts as one unambiguous
 * unverified folder).
 *
 * The server is stateful per folder: UIDVALIDITY + per-UID flags. A folder
 * with zero messages yields `* SEARCH` empties and no FETCH data, which the
 * production detector maps to a COMPLETE negative when the flag side also
 * completed (seeded message carries the namespaced providerUid +
 * providerFolder + providerUidValidity matching this server).
 *
 * It is NOT a general mailbox: no STORE, no APPEND, no IDLE, no literals on
 * input (all scenario data is ASCII-quoted).
 */

import * as net from "node:net";

/** One message in a fake folder: UID + IMAP flags (e.g. ["\\Seen"]). */
export interface FakeImapMessage {
  readonly uid: number;
  readonly flags: readonly string[];
}

export interface FakeImapFolder {
  readonly uidValidity: number;
  readonly messages: readonly FakeImapMessage[];
}

export interface FakeImapServerOptions {
  readonly user: string;
  readonly pass: string;
  /** Folder path → contents. `INBOX` + `Sent` cover the probe. */
  readonly folders: Readonly<Record<string, FakeImapFolder>>;
}

export interface FakeImapServer {
  readonly port: number;
  /** Accepted TCP connections so far (one per production probe leg). */
  readonly connections: number;
  /** LOGIN attempts recorded (username, password, accepted). */
  readonly authAttempts: Readonly<
    { user: string; pass: string; accepted: boolean }[]
  >;
  close(): Promise<void>;
}

const CRLF = "\r\n";

/** ` \Sent` suffix for the Sent folder so LIST-based special-use parses. */
function listSpecialUse(folderPath: string): string {
  return folderPath.toLowerCase() === "sent" ? " \\Sent" : "";
}

/** Match an IMAP LIST remainder against `*`/`%` patterns (case-insensitive). */
function matchListPattern(remainder: string, pattern: string): boolean {
  if (pattern === "" || pattern === "*") return true;
  const escaped = pattern
    .toLowerCase()
    .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/%/g, "[^/]*")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(remainder.toLowerCase());
}

/**
 * Split a command line into whitespace-separated tokens, honoring double
 * quotes. Empty quoted strings (`""`, as in `LIST "" ""`) are preserved as
 * empty tokens — dropping them misaligns reference/pattern positions.
 */
function splitArgs(line: string): string[] {
  const tokens = line.match(/"[^"]*"|\S+/g) ?? [];
  return tokens.map((t) =>
    t.length >= 2 && t.startsWith('"') && t.endsWith('"')
      ? t.slice(1, -1)
      : t
  );
}

export function startFakeImapServer(
  options: FakeImapServerOptions
): Promise<FakeImapServer> {
  const authAttempts: { user: string; pass: string; accepted: boolean }[] = [];
  let connectionCount = 0;

  const server = net.createServer((socket) => {
    connectionCount += 1;
    let selected: string | null = null;

    const debug = process.env.FAKE_IMAP_DEBUG === "1";
    const write = (line: string): void => {
      if (debug) process.stdout.write(`[fake-imap S] ${line}\n`);
      try {
        socket.write(line + CRLF);
      } catch {
        // client went away mid-response
      }
    };

    write(
      "* OK [CAPABILITY IMAP4rev1 LITERAL+ SASL-IR LOGIN-REFERRALS] e2e-fake-imap ready"
    );
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf(CRLF)) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        if (debug && line.length > 0) {
          process.stdout.write(`[fake-imap C] ${line}\n`);
        }
        if (line.length > 0) handleLine(line);
      }
    });

    socket.on("error", () => {
      // Client disconnected abruptly; nothing to record.
    });

    function handleLine(line: string): void {
      const parts = splitArgs(line);
      if (parts.length < 2) return;
      const tag = parts[0];
      const verb = parts[1].toUpperCase();
      const rest = line.slice(tag.length + 1 + parts[1].length).trim();

      switch (verb) {
        case "CAPABILITY": {
          write("* CAPABILITY IMAP4rev1 LITERAL+ SASL-IR LOGIN-REFERRALS");
          write(`${tag} OK capability completed`);
          return;
        }
        case "LOGIN": {
          // LOGIN <user> <pass> (quote-aware split above).
          const user = parts[2] ?? "";
          const pass = parts[3] ?? "";
          const accepted = user === options.user && pass === options.pass;
          authAttempts.push({ user, pass, accepted });
          if (!accepted) {
            write(`${tag} NO [AUTHENTICATIONFAILED] bad credentials`);
            return;
          }
          write(`${tag} OK authenticated`);
          return;
        }
        case "LIST":
        case "LSUB": {
          // Reference-aware listing. ImapFlow's list() issues several LIST
          // variants (root plus per-prefix child enumeration such as
          // `LIST "Sent/" "*"`); answering a prefixed query with absolute
          // names makes ImapFlow join them into phantoms ("Sent/Sent").
          // Only folders under the reference match, returned as absolute
          // names; an empty reference lists everything.
          const reference = parts[2] ?? "";
          const pattern = parts[3] ?? "*";
          const keyword = verb === "LIST" ? "LIST" : "LSUB";
          if (pattern === "") {
            // `LIST "" ""` is hierarchy-delimiter discovery (RFC 3501
            // §6.3.8), also used by ImapFlow for namespace inference. Answer
            // with the delimiter only — returning real folders here poisons
            // prefix inference (ImapFlow would prepend a phantom prefix to
            // later SELECT paths, e.g. "Sent/Sent").
            write(`* ${keyword} (\\Noselect) "/" ""`);
            write(`${tag} OK ${keyword.toLowerCase()} completed`);
            return;
          }
          for (const [folderPath] of Object.entries(options.folders)) {
            if (
              reference !== "" &&
              !folderPath.startsWith(reference)
            ) {
              continue;
            }
            const remainder =
              reference !== "" ? folderPath.slice(reference.length) : folderPath;
            if (!matchListPattern(remainder, pattern)) continue;
            write(
              `* ${keyword} (\\HasNoChildren${listSpecialUse(folderPath)}) "/" "${folderPath}"`
            );
          }
          write(`${tag} OK ${keyword.toLowerCase()} completed`);
          return;
        }
        case "SELECT":
        case "EXAMINE": {
          // SELECT <mailbox> (quote-aware; rest holds the raw name).
          const folderPath = parts[2] ?? "";
          const folder = options.folders[folderPath];
          if (!folder) {
            write(`${tag} NO no such mailbox`);
            return;
          }
          selected = folderPath;
          write("* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)");
          write(`* ${folder.messages.length} EXISTS`);
          write("* 0 RECENT");
          write(`* OK [UIDVALIDITY ${folder.uidValidity}] UIDs valid`);
          write(
            `* OK [UIDNEXT ${folder.messages.length + 1}] predicted next UID`
          );
          write(`${tag} OK [READ-WRITE] select completed`);
          return;
        }
        case "UID": {
          handleUid(tag, rest);
          return;
        }
        case "LOGOUT": {
          write("* BYE e2e-fake-imap bye");
          write(`${tag} OK logout completed`);
          socket.end();
          return;
        }
        case "NOOP":
        case "CHECK":
        case "CLOSE":
        case "UNSELECT": {
          write(`${tag} OK completed`);
          return;
        }
        default: {
          write(`${tag} BAD unknown command in e2e-fake-imap`);
          return;
        }
      }
    }

    function handleUid(tag: string, rest: string): void {
      const sub = rest.split(/\s+/, 2);
      const subVerb = (sub[0] ?? "").toUpperCase();
      if (subVerb === "SEARCH") {
        // Every search is empty: the E2E Sent folder holds no replies, so
        // the production detector settles a complete negative (never a
        // candidate fetch). Substring criteria are accepted unparsed.
        write("* SEARCH");
        write(`${tag} OK search completed`);
        return;
      }
      if (subVerb === "FETCH") {
        // UID FETCH <uid> (<attrs>) — serve FLAGS/INTERNALDATE for a
        // configured message; unknown UIDs yield no data (expunged).
        const match = rest.match(/^FETCH\s+(\d+)\s+\((.*)\)\s*$/i);
        const uid = match ? Number(match[1]) : NaN;
        const attrs = (match?.[2] ?? "").toUpperCase();
        const folder =
          selected !== null ? options.folders[selected] : undefined;
        const message = folder?.messages.find((m) => m.uid === uid);
        if (message && folder) {
          const seq = folder.messages.indexOf(message) + 1;
          const outAttrs: string[] = [`UID ${message.uid}`];
          if (attrs.includes("FLAGS")) {
            outAttrs.push(`FLAGS (${message.flags.join(" ")})`);
          }
          if (attrs.includes("INTERNALDATE")) {
            outAttrs.push(`INTERNALDATE "15-Oct-2026 00:00:00 +0000"`);
          }
          write(`* ${seq} FETCH (${outAttrs.join(" ")})`);
        }
        write(`${tag} OK fetch completed`);
        return;
      }
      write(`${tag} BAD unsupported UID subcommand in e2e-fake-imap`);
    }
  });

  return new Promise<FakeImapServer>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("fake IMAP server did not get a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        get connections(): number {
          return connectionCount;
        },
        get authAttempts(): Readonly<
          { user: string; pass: string; accepted: boolean }[]
        > {
          return authAttempts;
        },
        close(): Promise<void> {
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
