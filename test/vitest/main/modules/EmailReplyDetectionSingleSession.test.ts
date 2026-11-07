import { describe, it, expect, vi } from "vitest";
import type { ListResponse, MailboxObject, SearchObject } from "imapflow";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));
vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import {
  ImapEmailReceiveClient,
  type ImapFlowConnection,
} from "@/service/emailReceive/ImapEmailReceiveClient";
import {
  EmailReplyDetectionService,
  createReplyDetectionImapPort,
  type ReplyDetectionAttemptPort,
  type ReplyDetectionDraftPort,
  type ReplyDetectionEmailServicePort,
  type ReplyDetectionMessagePort,
} from "@/service/emailReceive/EmailReplyDetectionService";

/**
 * Reply detection used to open a fresh IMAP session for the answered-flag
 * read, Sent-folder discovery, and header search. On a slow mailbox those
 * three TLS handshakes exhaust the 15s probe deadline, so
 * create_email_reply_draft returns probe_timeout and never writes a draft.
 * The production port must do all three observations on one connection.
 */

const ORIGINAL_ID = "<orig-77@example.com>";
const SENDER = "me@example.com";

function messageFixture(): EmailReceivedMessageEntity {
  const message = new EmailReceivedMessageEntity();
  message.id = 119;
  message.emailServiceId = 6;
  message.providerUid = "imap:aaaaaaaaaaaaaaaa:424242:77";
  message.messageId = ORIGINAL_ID;
  message.normalizedMessageId = ORIGINAL_ID;
  message.replyStatus = "not_started";
  message.isAnswered = 0;
  message.answeredFlagCheckedAt = null;
  message.replyDetectedAt = null;
  message.replyDetectionSource = null;
  message.replyMatchedMessageId = null;
  message.replyNegativeCheckAt = null;
  message.replyNegativeContextHash = null;
  message.providerFolder = "INBOX";
  message.providerUidValidity = "424242";
  return message;
}

function imapConfig(): EmailReceiveConnectionConfig {
  return {
    emailServiceId: 6,
    protocol: "imap",
    host: "mail.example.com",
    port: 993,
    ssl: true,
    username: SENDER,
    password: "secret-pw",
    folder: "INBOX",
  };
}

function listFolder(path: string, specialUse?: string): ListResponse {
  return {
    path,
    pathAsListed: path,
    name: path.split("/").pop() ?? path,
    delimiter: "/",
    parent: [],
    parentPath: "",
    flags: new Set<string>(),
    listed: true,
    subscribed: true,
    ...(specialUse ? { specialUse } : {}),
  };
}

function countingConnection(
  state: { connects: number; logouts: number },
  searches: SearchObject[] = [],
  searchDelayMs = 0
): ImapFlowConnection {
  return {
    async connect(): Promise<void> {
      state.connects += 1;
    },
    async logout(): Promise<void> {
      state.logouts += 1;
    },
    close(): void {},
    async list(): Promise<ListResponse[]> {
      return [listFolder("INBOX", "\\Inbox"), listFolder("Sent", "\\Sent")];
    },
    async mailboxOpen(path: string | string[]): Promise<MailboxObject> {
      const folder = Array.isArray(path) ? path.join("/") : path;
      return {
        path: folder,
        delimiter: "/",
        flags: new Set<string>(),
        uidValidity: BigInt(424242),
        uidNext: 1,
        exists: 1,
      };
    },
    async search(query: SearchObject): Promise<number[] | false> {
      if (searchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, searchDelayMs));
      }
      searches.push(query);
      return [];
    },
    async fetchOne(seq) {
      return {
        seq: Number(seq),
        uid: Number(seq),
        flags: new Set<string>(["\\Seen"]),
      };
    },
  };
}

const RECEIVED_AT = new Date("2026-10-19T06:00:00.000Z");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe("reply detection mailbox probe (single IMAP session)", () => {
  it("observes flags, Sent folders, and reply headers on one connection", async () => {
    const message = messageFixture();
    message.receivedAt = RECEIVED_AT;
    const sockets = { connects: 0, logouts: 0, clients: 0 };
    const searches: SearchObject[] = [];
    const client = new ImapEmailReceiveClient({
      imapFlowFactory: () => {
        sockets.clients += 1;
        return countingConnection(sockets, searches);
      },
    });
    const messagePort: ReplyDetectionMessagePort = {
      async read(id) {
        return id === message.id ? message : null;
      },
      async findCanonicalEquivalents() {
        return [message];
      },
      async updateReplyEvidence() {
        return true;
      },
      async confirmStagedNegativeEvidence() {
        return true;
      },
    };
    const draftPort: ReplyDetectionDraftPort = {
      async listByMessages() {
        return [];
      },
    };
    const attemptPort: ReplyDetectionAttemptPort = {
      async listByMessages() {
        return [];
      },
    };
    const emailServicePort: ReplyDetectionEmailServicePort = {
      async getEmailServiceReceiveConfig() {
        return imapConfig();
      },
      async readIdentity() {
        return {
          smtpUsername: SENDER,
          fromAddress: SENDER,
          replyToAddress: null,
          receiveUsername: SENDER,
        };
      },
    };
    const service = new EmailReplyDetectionService({
      messagePort,
      draftPort,
      attemptPort,
      emailServicePort,
      imapPort: createReplyDetectionImapPort(client),
    });

    const result = await service.detect({ messageId: message.id });

    expect(result.state).toBe("not_replied");
    expect(result.reasonCode).toBe("no_reply_observed");
    expect(sockets.clients).toBe(1);
    expect(sockets.connects).toBe(1);
    expect(sockets.logouts).toBe(1);
    // A reply cannot predate the inbound message. Bound the Sent HEADER
    // scan to one day before receipt so a large Sent mailbox can finish
    // inside the probe budget instead of scanning all history. The search
    // token is the normalized id (angle brackets removed).
    expect(searches).toHaveLength(1);
    expect(searches[0]?.since).toEqual(new Date(RECEIVED_AT.getTime() - ONE_DAY_MS));
    expect(searches[0]?.or).toEqual([
      { header: { "in-reply-to": "orig-77@example.com" } },
      { header: { references: "orig-77@example.com" } },
    ]);
  });

  it("settles not_replied when Sent search takes longer than 15s but finishes inside the probe budget", async () => {
    vi.useFakeTimers();
    try {
      const message = messageFixture();
      const sockets = { connects: 0, logouts: 0, clients: 0 };
      const client = new ImapEmailReceiveClient({
        imapFlowFactory: () => {
          sockets.clients += 1;
          return countingConnection(sockets, [], 20_000);
        },
      });
      const messagePort: ReplyDetectionMessagePort = {
        async read(id) {
          return id === message.id ? message : null;
        },
        async findCanonicalEquivalents() {
          return [message];
        },
        async updateReplyEvidence() {
          return true;
        },
        async confirmStagedNegativeEvidence() {
          return true;
        },
      };
      const draftPort: ReplyDetectionDraftPort = {
        async listByMessages() {
          return [];
        },
      };
      const attemptPort: ReplyDetectionAttemptPort = {
        async listByMessages() {
          return [];
        },
      };
      const emailServicePort: ReplyDetectionEmailServicePort = {
        async getEmailServiceReceiveConfig() {
          return imapConfig();
        },
        async readIdentity() {
          return {
            smtpUsername: SENDER,
            fromAddress: SENDER,
            replyToAddress: null,
            receiveUsername: SENDER,
          };
        },
      };
      const service = new EmailReplyDetectionService({
        messagePort,
        draftPort,
        attemptPort,
        emailServicePort,
        imapPort: createReplyDetectionImapPort(client),
      });

      const pending = service.detect({ messageId: message.id });
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await pending;

      expect(result.state).toBe("not_replied");
      expect(result.reasonCode).toBe("no_reply_observed");
      expect(sockets.connects).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
