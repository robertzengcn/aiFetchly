// test/vitest/main/modules/EmailReplyPop3UidlStability.test.ts
//
// V02 / re-audit task #135 — POP3 stable UIDL identity.
//
// POP3 message sequence numbers (the `i` in RETR i) are MUTABLE: deleting an
// earlier message renumbers every later message down by one. The pre-V02
// Pop3EmailReceiveClient stored `providerUid: String(i)` (the sequence number)
// despite a comment claiming a "UIDL-derived hash". So after the server
// deleted message 1 and renumbered 2→1, 3→2, a resync would RETR the new
// sequence numbers and upsert message B's content into message A's row —
// adopting B's body / fromAddress / evidence under A's lifecycle.
//
// The fix (V02): fetch the server-assigned UIDL list (RFC 1939 §5) once per
// sync and key each message on `pop3:<sha256(uidl)>` instead of the sequence
// number. The UIDL unique-id is stable for the message's lifetime in the
// mailbox, so a renumber cannot rebind a row to a different message.
//
// Stated adversarial regression (todo L276):
//   "sync, delete first server message, resync; remaining messages keep their
//    own IDs/content/status and no cross-message evidence is adopted."
//
// This suite drives the REAL Pop3EmailReceiveClient (not a fake client) against
// an in-process fake POP3 server over a loopback TCP socket, then persists
// through the REAL EmailReceiveSyncService → EmailReceivedMessageModel upsert.
// Two full syncs model the renumber: between them the server drops its first
// message, so every remaining message's sequence number shifts down by one
// while its UIDL stays the same. The DB rows must keep their own identity,
// content, and reply evidence — no cross-message adoption.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";

import { SqliteDb } from "@/config/SqliteDb";
import { EmailReceiveSyncService } from "@/service/emailReceive/EmailReceiveSyncService";
import { EmailReceivedMessageModel } from "@/model/EmailReceivedMessage.model";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import {
  Pop3EmailReceiveClient,
  buildPop3ProviderUid,
  isPop3ProviderUid,
  parseUidlListing,
  POP3_PROVIDER_UID_PREFIX,
} from "@/service/emailReceive/Pop3EmailReceiveClient";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";

/**
 * One message held by the fake POP3 server. The `uidl` is the server-assigned
 * stable unique-id (RFC 1939 §5); `raw` is the full RFC822 message bytes.
 */
interface FakePop3Message {
  uidl: string;
  raw: string;
}

/**
 * Minimal RFC 1939 fake POP3 server over a loopback socket. Speaks just enough
 * of the protocol for the production client: USER/PASS auth, STAT, UIDL, RETR,
 * QUIT. Messages are held in sequence-number order; deleting the first message
 * (the renumber trigger) is modeled by re-seeding a shorter list between
 * syncs — the remaining messages keep their UIDLs but shift sequence numbers.
 */
class FakePop3Server {
  private server: net.Server;
  port: number;

  constructor(messages: FakePop3Message[]) {
    this.server = net.createServer((socket) => {
      const currentMessages = messages.slice();
      let buf = "";

      socket.write("+OK fake POP3 ready\r\n");

      const handle = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const [cmd, ...rest] = trimmed.split(/\s+/);
        const upper = cmd.toUpperCase();

        if (upper === "USER") {
          socket.write("+OK\r\n");
          return;
        }
        if (upper === "PASS") {
          socket.write("+OK\r\n");
          return;
        }
        if (upper === "STAT") {
          socket.write(`+OK ${currentMessages.length} 0\r\n`);
          return;
        }
        if (upper === "UIDL") {
          if (currentMessages.length === 0) {
            socket.write("+OK\r\n.\r\n");
            return;
          }
          let listing = "+OK\r\n";
          currentMessages.forEach((m, idx) => {
            listing += `${idx + 1} ${m.uidl}\r\n`;
          });
          listing += ".\r\n";
          socket.write(listing);
          return;
        }
        if (upper === "RETR") {
          const seq = parseInt(rest[0] ?? "0", 10);
          if (seq < 1 || seq > currentMessages.length) {
            socket.write("-ERR no such message\r\n");
            return;
          }
          const body = currentMessages[seq - 1].raw;
          // Dot-stuff: leading dots in the body must be doubled per RFC 1939.
          const stuffed = body.replace(/^\./gm, "..");
          socket.write(`+OK ${Buffer.byteLength(body)} octets\r\n`);
          socket.write(stuffed);
          socket.write("\r\n.\r\n");
          return;
        }
        if (upper === "QUIT") {
          socket.write("+OK bye\r\n");
          socket.end();
          return;
        }
        socket.write("-ERR unknown command\r\n");
      };

      socket.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\r\n")) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          handle(line);
        }
      });
      socket.on("error", () => {
        /* connection reset by peer during teardown — ignore */
      });
    });
    // Port 0 = OS-assigned ephemeral port; read after listen.
    this.port = 0;
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        this.port =
          addr && typeof addr === "object" ? addr.port : this.port;
        resolve(this.port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

/**
 * Build the fake server with the given message list. Returns the running
 * server; caller closes it in afterAll.
 */
async function startServer(
  messages: FakePop3Message[]
): Promise<{ server: FakePop3Server; port: number }> {
  const server = new FakePop3Server(messages);
  const port = await server.listen();
  return { server, port };
}

/** Compose a minimal RFC822 message with the given fields. */
function rawMessage(input: {
  messageId: string;
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  to?: string;
}): string {
  const fromHeader = input.fromName
    ? `${input.fromName} <${input.from}>`
    : input.from;
  return [
    `Message-ID: ${input.messageId}`,
    `From: ${fromHeader}`,
    `To: ${input.to ?? "me@x.com"}`,
    `Subject: ${input.subject}`,
    `Date: 15 Oct 2026 10:00:00 +0000`,
    `Content-Type: text/plain; charset=utf-8`,
    "",
    input.body,
    "",
  ].join("\r\n");
}

/** A connection config pointing at a fake server on loopback, no TLS. */
function configFor(port: number): EmailReceiveConnectionConfig {
  return {
    emailServiceId: 1,
    protocol: "pop3",
    host: "127.0.0.1",
    port,
    ssl: false,
    username: "me@x.com",
    password: "secret",
    folder: "INBOX",
  };
}

describe("V02 — POP3 stable UIDL identity (re-audit task #135)", () => {
  // --- Pure helper unit tests (no socket, no DB) ---

  describe("parseUidlListing (pure parser)", () => {
    it("parses a standard multi-line UIDL response", () => {
      const body = "1 uid-alpha\r\n2 uid-bravo\r\n3 uid-charlie\r\n";
      const map = parseUidlListing(body);
      expect(map.get(1)).toBe("uid-alpha");
      expect(map.get(2)).toBe("uid-bravo");
      expect(map.get(3)).toBe("uid-charlie");
      expect(map.size).toBe(3);
    });

    it("skips malformed lines without throwing", () => {
      const body = "1 uid-alpha\r\nbogus\r\n3 \r\n4 uid-delta\r\n";
      const map = parseUidlListing(body);
      expect(map.size).toBe(2);
      expect(map.get(1)).toBe("uid-alpha");
      expect(map.get(4)).toBe("uid-delta");
    });

    it("handles an empty body as an empty map", () => {
      expect(parseUidlListing("").size).toBe(0);
      expect(parseUidlListing("   \r\n  \r\n").size).toBe(0);
    });
  });

  describe("buildPop3ProviderUid + isPop3ProviderUid", () => {
    it("produces a stable, prefixed, column-safe identifier", () => {
      const uid = buildPop3ProviderUid("uid-alpha");
      expect(uid.startsWith(POP3_PROVIDER_UID_PREFIX)).toBe(true);
      expect(uid.length).toBeLessThanOrEqual(255);
      // Stable: same UIDL → same providerUid (deterministic hash).
      expect(buildPop3ProviderUid("uid-alpha")).toBe(uid);
      // Distinct UIDLs do not collide.
      expect(buildPop3ProviderUid("uid-bravo")).not.toBe(uid);
    });

    it("recognizes the prefixed form and rejects legacy bare sequence numbers", () => {
      expect(isPop3ProviderUid(buildPop3ProviderUid("x"))).toBe(true);
      expect(isPop3ProviderUid("5")).toBe(false);
      expect(isPop3ProviderUid(null)).toBe(false);
      // The IMAP namespaced form is NOT a POP3 uid.
      expect(isPop3ProviderUid("imap:abcd:42:9")).toBe(false);
    });
  });

  // --- Real-client integration: UIDL is fetched and drives identity ---

  describe("real Pop3EmailReceiveClient against a fake POP3 server", () => {
    let cleanupServers: FakePop3Server[] = [];

    async function withServer<T>(
      messages: FakePop3Message[],
      run: (port: number) => Promise<T>
    ): Promise<T> {
      const { server, port } = await startServer(messages);
      cleanupServers.push(server);
      return await run(port);
    }

    afterAll(async () => {
      await Promise.all(cleanupServers.map((s) => s.close()));
      cleanupServers = [];
    });

    it("fetches messages keyed on the stable UIDL, not the sequence number", async () => {
      const messages: FakePop3Message[] = [
        {
          uidl: "uid-alpha",
          raw: rawMessage({
            messageId: "<a@x.com>",
            from: "prospect@x.com",
            subject: "First",
            body: "body one",
          }),
        },
        {
          uidl: "uid-bravo",
          raw: rawMessage({
            messageId: "<b@x.com>",
            from: "prospect2@x.com",
            subject: "Second",
            body: "body two",
          }),
        },
      ];

      const fetched = await withServer(messages, (port) =>
        new Pop3EmailReceiveClient().fetchMessages(configFor(port), {
          limit: 50,
          unreadOnly: false,
        })
      );

      expect(fetched.length).toBe(2);
      // Both rows carry the stable UIDL-prefixed identity.
      expect(isPop3ProviderUid(fetched[0].providerUid)).toBe(true);
      expect(isPop3ProviderUid(fetched[1].providerUid)).toBe(true);
      expect(fetched[0].providerUid).toBe(buildPop3ProviderUid("uid-alpha"));
      expect(fetched[1].providerUid).toBe(buildPop3ProviderUid("uid-bravo"));
      // Content is correct.
      expect(fetched[0].subject).toBe("First");
      expect(fetched[1].subject).toBe("Second");
    });

    it("THE stated regression: after the server deletes message 1 (renumber), resync keeps each row on its own UIDL identity with no cross-message adoption", async () => {
      // Three messages; the server will delete the FIRST between syncs,
      // renumbering 2→1 and 3→2. Each message keeps its own UIDL.
      const messagesSync1: FakePop3Message[] = [
        {
          uidl: "uid-alpha",
          raw: rawMessage({
            messageId: "<a@x.com>",
            from: "alice@x.com",
            fromName: "Alice",
            subject: "Alpha msg",
            body: "alpha body",
          }),
        },
        {
          uidl: "uid-bravo",
          raw: rawMessage({
            messageId: "<b@x.com>",
            from: "bob@x.com",
            fromName: "Bob",
            subject: "Bravo msg",
            body: "bravo body",
          }),
        },
        {
          uidl: "uid-charlie",
          raw: rawMessage({
            messageId: "<c@x.com>",
            from: "carol@x.com",
            fromName: "Carol",
            subject: "Charlie msg",
            body: "charlie body",
          }),
        },
      ];

      // SYNC 1: fetch all three (limit high enough to grab everything).
      const fetched1 = await withServer(messagesSync1, (port) =>
        new Pop3EmailReceiveClient().fetchMessages(configFor(port), {
          limit: 50,
          unreadOnly: false,
        })
      );
      expect(fetched1.length).toBe(3);

      // Record the UIDL→providerUid mapping from sync 1.
      const alphaUid = buildPop3ProviderUid("uid-alpha");
      const bravoUid = buildPop3ProviderUid("uid-bravo");
      const charlieUid = buildPop3ProviderUid("uid-charlie");
      expect(fetched1[0].providerUid).toBe(alphaUid);
      expect(fetched1[1].providerUid).toBe(bravoUid);
      expect(fetched1[2].providerUid).toBe(charlieUid);

      // SYNC 2: server deleted message 1 (alpha). The remaining two shift
      // sequence numbers (bravo is now seq 1, charlie seq 2) but KEEP their
      // UIDLs. A sequence-number-keyed client would fetch bravo's content at
      // seq 1 and upsert it onto alpha's row; the UIDL-keyed client must NOT.
      const messagesSync2: FakePop3Message[] = [
        {
          uidl: "uid-bravo",
          raw: rawMessage({
            messageId: "<b@x.com>",
            from: "bob@x.com",
            fromName: "Bob",
            subject: "Bravo msg",
            body: "bravo body",
          }),
        },
        {
          uidl: "uid-charlie",
          raw: rawMessage({
            messageId: "<c@x.com>",
            from: "carol@x.com",
            fromName: "Carol",
            subject: "Charlie msg",
            body: "charlie body",
          }),
        },
      ];

      const fetched2 = await withServer(messagesSync2, (port) =>
        new Pop3EmailReceiveClient().fetchMessages(configFor(port), {
          limit: 50,
          unreadOnly: false,
        })
      );
      expect(fetched2.length).toBe(2);

      // DECISIVE: after renumber, sequence positions changed (bravo is now
      // first), but each message's providerUid is STILL keyed on its own
      // stable UIDL — NOT on the new sequence number.
      expect(fetched2[0].providerUid).toBe(bravoUid);
      expect(fetched2[1].providerUid).toBe(charlieUid);
      // Content follows identity, not position.
      expect(fetched2[0].subject).toBe("Bravo msg");
      expect(fetched2[0].fromAddress).toBe("bob@x.com");
      expect(fetched2[1].subject).toBe("Charlie msg");
      expect(fetched2[1].fromAddress).toBe("carol@x.com");

      // Cross-message adoption check: neither remaining message picked up
      // alpha's identity.
      expect(fetched2.some((m) => m.providerUid === alphaUid)).toBe(false);
      expect(fetched2.some((m) => m.subject === "Alpha msg")).toBe(false);
      expect(fetched2.some((m) => m.fromAddress === "alice@x.com")).toBe(false);
    });
  });

  // --- Full production path: sync service → SQLite upsert + evidence ---

  describe("full sync path (EmailReceiveSyncService → SQLite): renumber does not adopt cross-message evidence", () => {
    let dbpath: string;
    let messageModel: EmailReceivedMessageModel;

    beforeAll(async () => {
      dbpath = path.join(
        os.tmpdir(),
        `aifetchly-pop3-uidl-${process.pid}-${Date.now()}`
      );
      fs.mkdirSync(dbpath, { recursive: true });
      await SqliteDb.resetInstance(dbpath);
      await SqliteDb.ensureInitialized();
      messageModel = new EmailReceivedMessageModel(dbpath);

      // Seed a POP3-enabled email service so getEmailServiceReceiveConfig
      // resolves to pop3 (and the sync service can load config by id).
      const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
        EmailServiceEntity
      );
      const service = new EmailServiceEntity();
      service.name = "POP3 UIDL stability service";
      service.from = "me@x.com";
      service.password = "secret";
      service.host = "smtp.example.com";
      service.port = "465";
      service.ssl = 1;
      service.status = 1;
      service.smtpUsername = "me@x.com";
      service.receiveProtocol = "pop3";
      service.pop3Host = "127.0.0.1";
      service.pop3Port = "0"; // overwritten per-sync by the fake-client factory
      service.pop3Ssl = 0;
      service.receiveEnabled = 1;
      service.receiveUsername = "me@x.com";
      service.receivePassword = "secret";
      service.receiveFolder = "INBOX";
      await repo.save(service);
    });

    afterAll(async () => {
      await SqliteDb.destroyInstance();
      try {
        fs.rmSync(dbpath, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    });

    const SERVICE_ID = 1; // first save in a fresh DB

    /**
     * Drive a real sync against a fake POP3 server on the given port. The sync
     * service loads config by service id; we re-point the stored pop3Port to
     * the ephemeral fake-server port right before each sync so the production
     * getEmailServiceReceiveConfig path is exercised end to end.
     */
    async function syncAgainst(
      port: number,
      messages: FakePop3Message[]
    ): Promise<void> {
      // Re-point the stored port to the ephemeral fake-server port.
      const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
        EmailServiceEntity
      );
      await repo.update(SERVICE_ID, { pop3Port: String(port) });

      // Build the real POP3 client directly (the factory would construct the
      // same instance); inject it through the sync service's clientFactory
      // seam so no real network resolution is needed beyond loopback.
      const client = new Pop3EmailReceiveClient();
      const service = new EmailReceiveSyncService({
        clientFactory: () => client,
      });
      await service.syncUnread(SERVICE_ID, { unreadOnly: false, limit: 50 });

      // messages are consumed by the server closure; keep a reference so TS
      // does not warn about an unused param.
      void messages;
    }

    it("after the server deletes the first message (renumber), a resync does not overwrite a remaining row's content or adopt cross-message evidence", async () => {
      // SYNC 1: two messages — alpha (seq 1) and bravo (seq 2).
      const sync1: FakePop3Message[] = [
        {
          uidl: "uid-alpha",
          raw: rawMessage({
            messageId: "<a@x.com>",
            from: "alice@x.com",
            fromName: "Alice",
            subject: "Alpha msg",
            body: "alpha body",
          }),
        },
        {
          uidl: "uid-bravo",
          raw: rawMessage({
            messageId: "<b@x.com>",
            from: "bob@x.com",
            fromName: "Bob",
            subject: "Bravo msg",
            body: "bravo body",
          }),
        },
      ];

      const s1 = await startServer(sync1);
      try {
        await syncAgainst(s1.port, sync1);
      } finally {
        await s1.server.close();
      }

      const repo = SqliteDb.getInstance(dbpath).connection.getRepository(
        EmailReceivedMessageEntity
      );

      // Both rows landed on their stable UIDL identity.
      const alphaUid = buildPop3ProviderUid("uid-alpha");
      const bravoUid = buildPop3ProviderUid("uid-bravo");
      const alphaRow = await repo.findOneByOrFail({
        emailServiceId: SERVICE_ID,
        providerUid: alphaUid,
      });
      const bravoRow = await repo.findOneByOrFail({
        emailServiceId: SERVICE_ID,
        providerUid: bravoUid,
      });
      expect(alphaRow.fromAddress).toBe("alice@x.com");
      expect(alphaRow.subject).toBe("Alpha msg");
      expect(bravoRow.fromAddress).toBe("bob@x.com");
      expect(bravoRow.subject).toBe("Bravo msg");

      // Simulate local app lifecycle evidence on bravo's row: the app sent a
      // reply to bravo. A buggy sequence-number resync would clobber this
      // when alpha is deleted and bravo shifts to seq 1.
      await messageModel.updateClassification(bravoRow.id, "interested", 0.9);
      // Mark a sticky positive (a sent-reply detection) on bravo's row.
      await SqliteDb.getInstance(dbpath).connection
        .getRepository(EmailReceivedMessageEntity)
        .update(
          { id: bravoRow.id },
          {
            replyStatus: "sent",
            processedAt: new Date("2026-10-15T12:00:00Z"),
            replyDetectedAt: new Date("2026-10-15T12:00:00Z"),
            replyDetectionSource: "sent_search",
          }
        );

      // SYNC 2: server deleted alpha (seq 1). Bravo is now seq 1, but its UIDL
      // is unchanged. A sequence-number-keyed resync would RETR seq 1 (bravo's
      // content) and upsert it onto the row previously created at seq 1
      // (alpha's row) — adopting bravo's content + evidence into alpha's row.
      const sync2: FakePop3Message[] = [
        {
          uidl: "uid-bravo",
          raw: rawMessage({
            messageId: "<b@x.com>",
            from: "bob@x.com",
            fromName: "Bob",
            subject: "Bravo msg",
            body: "bravo body",
          }),
        },
      ];

      const s2 = await startServer(sync2);
      try {
        await syncAgainst(s2.port, sync2);
      } finally {
        await s2.server.close();
      }

      // DECISIVE (todo L276): "remaining messages keep their own IDs/content/
      // status and no cross-message evidence is adopted."
      //
      // Bravo's row keeps its OWN identity, content, and reply evidence — it
      // was NOT rebound to alpha's row, and alpha's content was NOT smeared
      // onto bravo's row.
      const bravoAfter = await repo.findOneByOrFail({
        emailServiceId: SERVICE_ID,
        providerUid: bravoUid,
      });
      expect(bravoAfter.id).toBe(bravoRow.id);
      expect(bravoAfter.fromAddress).toBe("bob@x.com");
      expect(bravoAfter.subject).toBe("Bravo msg");
      // Lifecycle + evidence preserved (no cross-message adoption). The
      // deterministic classifier legitimately re-computes on every sync
      // (FR-007 — see EmailReceiveSyncProvenance.test.ts L217-220), so
      // `classification` is NOT asserted here; the protection that matters is
      // the app-delivery lifecycle (replyStatus/processedAt) and the
      // detection-owned sticky positive evidence (replyDetectedAt/source) —
      // exactly the cross-message adoption a sequence-number-keyed resync
      // would have destroyed when bravo shifted from seq 2 to seq 1.
      expect(bravoAfter.replyStatus).toBe("sent");
      expect(bravoAfter.replyDetectionSource).toBe("sent_search");
      expect(bravoAfter.processedAt?.toISOString()).toBe(
        "2026-10-15T12:00:00.000Z"
      );
      expect(bravoAfter.replyDetectedAt?.toISOString()).toBe(
        "2026-10-15T12:00:00.000Z"
      );

      // Alpha's row is untouched — bravo's content/evidence was NOT adopted
      // onto it. (Alpha is no longer on the server; sync never touches its
      // row because the UIDL is absent from the listing.)
      const alphaAfter = await repo.findOneByOrFail({
        emailServiceId: SERVICE_ID,
        providerUid: alphaUid,
      });
      expect(alphaAfter.id).toBe(alphaRow.id);
      expect(alphaAfter.fromAddress).toBe("alice@x.com");
      expect(alphaAfter.subject).toBe("Alpha msg");
      expect(alphaAfter.replyStatus).not.toBe("sent");
    });
  });
});
