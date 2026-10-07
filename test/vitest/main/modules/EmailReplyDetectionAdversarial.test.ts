import { describe, it, expect } from "vitest";

import { EmailReplyDetectionService } from "@/service/emailReceive/EmailReplyDetectionService";
import type {
  ReplyDetectionMessagePort,
  ReplyDetectionDraftPort,
  ReplyDetectionAttemptPort,
  ReplyDetectionEmailServicePort,
  ReplyDetectionImapPort,
} from "@/service/emailReceive/EmailReplyDetectionService";
import {
  ImapEmailReceiveClient,
} from "@/service/emailReceive/ImapEmailReceiveClient";
import type { ImapFlowConnection } from "@/service/emailReceive/ImapEmailReceiveClient";
import type { EmailReceiveConnectionConfig } from "@/entityTypes/emailReceiveTypes";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import {
  fakeImapFlowFactory,
  headerBlock,
  type FakeImapFlowFixture,
  type FakeMailboxFolder,
} from "../helpers/FakeImapFlow";

/**
 * T04 step 9 (FR-031 §12) — the adversarial detection matrix, exercised end-
 * to-end through the REAL {@link ImapEmailReceiveClient} backed by a
 * behavioral {@link FakeImapFlow}. Unlike the Step 6 unit tests (which inject
 * a fake {@link ReplyDetectionImapPort} and bypass the client), this suite
 * wires the detector to an `ImapPort` that delegates to a real
 * `ImapEmailReceiveClient({ imapFlowFactory })`, so the §7.2 header-map
 * search, PEEK semantics, UIDVALIDITY guard, and candidate caps are proven
 * against a realistic protocol surface — exactly the code path production
 * runs.
 *
 * Matrix (§12): answered flag → replied(mailbox_flag); Sent match →
 * replied(sent_search); multiple Sent folders all searched; alias sender →
 * ambiguous_match; missing/none Sent → sent_folder_unavailable; auth/list
 * failure → unknown; `false` search → unknown; >200 candidates →
 * probe_limit_exceeded; expunged source + verified Sent match → replied;
 * References-only → ambiguous_match; read-source flag refresh ignores the
 * unread-only sync bound (UID-scoped, not search-scoped).
 */

const ORIGINAL_ID = "<orig-77@example.com>";
const SENDER = "me@example.com";

function imapConfig(): EmailReceiveConnectionConfig {
  return {
    emailServiceId: 5,
    protocol: "imap",
    host: "imap.example.com",
    port: 993,
    ssl: true,
    username: "me@example.com",
    password: "recv-secret",
    folder: "INBOX",
  };
}

/** A namespaced INBOX source message row (the row the detector probes). */
function messageFixture(overrides: Partial<EmailReceivedMessageEntity> = {}): EmailReceivedMessageEntity {
  const e = new EmailReceivedMessageEntity();
  e.id = 100;
  e.emailServiceId = 5;
  e.providerUid = "imap:aaaaaaaaaaaaaaaa:424242:77";
  e.messageId = ORIGINAL_ID;
  e.normalizedMessageId = ORIGINAL_ID;
  e.threadKey = ORIGINAL_ID;
  e.replyStatus = "not_started";
  e.isAnswered = 0;
  e.answeredFlagCheckedAt = null;
  e.replyDetectedAt = null;
  e.replyDetectionSource = null;
  e.replyMatchedMessageId = null;
  e.replyNegativeCheckAt = null;
  e.replyNegativeContextHash = null;
  e.providerFolder = "INBOX";
  e.providerUidValidity = "424242";
  Object.assign(e, overrides);
  return e;
}

/** A Sent-folder reply header block (verified direct match by default). */
function sentReplyHeaders(overrides: {
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  from?: string;
}): Buffer {
  return headerBlock([
    `Message-ID: ${overrides.messageId ?? "<sent-501@example.com>"}`,
    `In-Reply-To: ${overrides.inReplyTo ?? ORIGINAL_ID}`,
    `References: ${overrides.references ?? ORIGINAL_ID}`,
    `From: ${overrides.from ?? `Me <${SENDER}>`}`,
    "To: prospect@example.com",
    "Date: Mon, 5 Oct 2026 11:00:00 +0000",
    "",
  ]);
}

function sentFolder(messages: FakeMailboxFolder["messages"]): FakeMailboxFolder {
  return {
    path: "Sent",
    specialUse: "\\Sent",
    uidValidity: BigInt(999),
    messages,
  };
}

function inboxFolder(
  messages: FakeMailboxFolder["messages"],
  opts: { uidValidity?: bigint; specialUse?: string } = {}
): FakeMailboxFolder {
  return {
    path: "INBOX",
    specialUse: opts.specialUse ?? "\\Inbox",
    uidValidity: opts.uidValidity ?? BigInt(424242),
    messages,
  };
}

/** Build the source INBOX message with given flags. */
function inboxMessage(flags: string[]): FakeMailboxFolder["messages"][number] {
  return {
    uid: 77,
    flags: new Set(flags),
    headers: headerBlock([
      `Message-ID: ${ORIGINAL_ID}`,
      `From: Prospect <prospect@example.com>`,
      "To: me@example.com",
      "Date: Mon, 5 Oct 2026 10:00:00 +0000",
      "",
    ]),
  };
}

/**
 * An `ImapPort` that delegates to a REAL `ImapEmailReceiveClient` backed by a
 * `FakeImapFlow` fixture. This is the seam that proves the full chain — the
 * detector calls the same client code production calls.
 */
function realClientImapPort(fixture: FakeImapFlowFixture): ReplyDetectionImapPort & {
  /** The most recently created fake connection (for call assertions). */
  readonly lastConnection: ImapFlowConnection | null;
} {
  let lastConnection: ImapFlowConnection | null = null;
  const factory = fakeImapFlowFactory(fixture);
  // The factory is called per client method (each method builds its own
  // connection); capture the latest so tests can inspect calls.
  const wrappedFactory = () => {
    const conn = factory();
    lastConnection = conn;
    return conn;
  };
  const client = new ImapEmailReceiveClient({ imapFlowFactory: wrappedFactory });
  return {
    refreshMessageFlags(input) {
      return client.refreshMessageFlags(input);
    },
    discoverSentFolders(config) {
      return client.discoverSentFolders(config);
    },
    searchReplyHeaders(input) {
      return client.searchReplyHeaders(input);
    },
    get lastConnection() {
      return lastConnection;
    },
  };
}

interface MatrixKit {
  service: EmailReplyDetectionService;
  imapPort: ReturnType<typeof realClientImapPort>;
  updateCalls: Array<Record<string, unknown>>;
}

function buildMatrixKit(input: {
  message: EmailReceivedMessageEntity;
  fixture: FakeImapFlowFixture;
  identity?: {
    smtpUsername: string;
    fromAddress: string;
    replyToAddress: string | null;
    receiveUsername: string;
  } | null;
}): MatrixKit {
  const updateCalls: Array<Record<string, unknown>> = [];
  const messagePort: ReplyDetectionMessagePort = {
    async read(id) {
      return id === input.message.id ? input.message : null;
    },
    async findCanonicalEquivalents() {
      return [input.message];
    },
    async updateReplyEvidence(patch) {
      updateCalls.push(patch);
      return true;
    },
  };
  const draftPort: ReplyDetectionDraftPort = {
    async listByMessage() {
      return [];
    },
  };
  const attemptPort: ReplyDetectionAttemptPort = {
    async listByMessage() {
      return [];
    },
  };
  const emailServicePort: ReplyDetectionEmailServicePort = {
    async getEmailServiceReceiveConfig() {
      return imapConfig();
    },
    async readIdentity() {
      return (
        input.identity ?? {
          smtpUsername: "me@example.com",
          fromAddress: SENDER,
          replyToAddress: null,
          receiveUsername: "me@example.com",
        }
      );
    },
  };
  const imapPort = realClientImapPort(input.fixture);
  const service = new EmailReplyDetectionService({
    messagePort,
    draftPort,
    attemptPort,
    emailServicePort,
    imapPort,
  });
  return { service, imapPort, updateCalls };
}

// ===========================================================================
// §12 adversarial matrix — full chain through the real ImapEmailReceiveClient.
// ===========================================================================

describe("EmailReplyDetection adversarial matrix (T04 step 9, §12) — full chain", () => {
  it("answered flag true -> replied(mailbox_flag), no Sent search needed", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Answered", "\\Seen"])]),
        sentFolder([]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("replied");
    expect(result.replied).toBe(true);
    expect(result.source).toBe("mailbox_flag");
    expect(result.reasonCode).toBe("already_replied");
    // Sticky positive persisted.
    const positiveWrite = kit.updateCalls.find((c) => c.replyDetectedAt);
    expect(positiveWrite).toBeDefined();
  });

  it("flag false + verified Sent direct match -> replied(sent_search)", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]), // not answered
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({}),
          },
        ]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("sent_search");
    expect(result.reasonCode).toBe("already_replied");
    expect(result.matchedMessageId).toBe("sent-501@example.com");
  });

  it("multiple Sent folders (special-use + fallback) are all searched", async () => {
    const message = messageFixture();
    // Two verified Sent folders; the reply is in the second. The detector must
    // search both (the §7.2 "≤5 folders" bound).
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        {
          path: "Sent",
          specialUse: "\\Sent",
          uidValidity: BigInt(999),
          messages: [],
        },
        {
          path: "INBOX/Sent",
          specialUse: "\\Sent",
          uidValidity: BigInt(998),
          messages: [
            {
              uid: 4242,
              flags: new Set(["\\Seen"]),
              headers: sentReplyHeaders({ messageId: "<sent-4242@example.com>" }),
            },
          ],
        },
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("sent_search");
    expect(result.matchedMessageId).toBe("sent-4242@example.com");
  });

  it("alias sender not matching configured identity -> ambiguous_match", async () => {
    const message = messageFixture();
    // In-Reply-To matches, but the From is an alias the user did NOT configure.
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({ from: "Me <me+alias@example.com>" }),
          },
        ]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("unknown");
    expect(result.reasonCode).toBe("ambiguous_match");
  });

  it("missing Sent folder / none accessible -> sent_folder_unavailable (not negative)", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        // No Sent-shaped folder at all.
        { path: "Drafts", uidValidity: BigInt(1), messages: [] },
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("unknown");
    expect(result.reasonCode).toBe("sent_folder_unavailable");
  });

  it("auth/permission error during list -> unknown (probe_failed), not folder absence", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [inboxFolder([inboxMessage(["\\Seen"])])],
      listThrows: new Error("AUTHENTICATIONFAILED"),
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // The detector maps a LIST throw to probe_failed (§7.1 step 6 — never
    // collapse to folder absence / a silent negative).
    expect(result.state).toBe("unknown");
    expect(result.reasonCode).toBe("probe_failed");
  });

  it("malformed/overlong headers in a candidate -> no direct match (ambiguous or no_match)", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            // In-Reply-To present but sender header malformed beyond the
            // address extractor → sender unrecognized → ambiguous.
            headers: headerBlock([
              `In-Reply-To: ${ORIGINAL_ID}`,
              "From: [invalid header",
              "To: prospect@example.com",
              "",
            ]),
          },
        ]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("unknown");
    expect(result.reasonCode).toBe("ambiguous_match");
  });

  it("exact In-Reply-To match (direct) vs ancestor-only References (ambiguous)", async () => {
    const message = messageFixture();
    // Two candidates: the first is a direct reply (In-Reply-To match + sender
    // verified) → the detector must settle replied on it and NOT be downgraded
    // by the ancestor-only References candidate that follows.
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({ messageId: "<direct@example.com>" }),
          },
          {
            uid: 502,
            flags: new Set(["\\Seen"]),
            // References-only (no In-Reply-To) + alias sender → ambiguous.
            headers: sentReplyHeaders({
              messageId: "<ancestor@example.com>",
              inReplyTo: "<unrelated@example.com>",
              references: ORIGINAL_ID,
              from: "Me <me+alias@example.com>",
            }),
          },
        ]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // Verified direct match takes precedence over ambiguity (§7.2).
    expect(result.state).toBe("replied");
    expect(result.source).toBe("sent_search");
    expect(result.matchedMessageId).toBe("direct@example.com");
  });

  it("`false` search return -> unknown (probe_failed), not no-matches", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({}),
          },
        ]),
      ],
      searchOverrides: new Map([["Sent", { result: false }]]),
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // A failed/incomplete search does not collapse to no-matches (§7.2). The
    // flag side completed (source observed, not answered) but the Sent side
    // is incomplete → unknown(probe_failed), never a negative.
    expect(result.state).toBe("unknown");
    expect(result.reasonCode).toBe("probe_failed");
  });

  it(">200 candidates without a settled match -> probe_limit_exceeded", async () => {
    const message = messageFixture();
    // >200 ambiguous candidates spread across 3 Sent folders (100 + 100 + 1).
    // The detector's MAX_CANDIDATE_FETCHES=200 bound must exhaust mid-probe —
    // the third folder starts with fetchesRemaining=0 → limit_exceeded,
    // rather than scanning an unbounded candidate set.
    const aliasCandidates = (count: number, base: number) =>
      Array.from({ length: count }, (_, i) => ({
        uid: base + i,
        flags: new Set(["\\Seen"]),
        headers: sentReplyHeaders({
          messageId: `<alias-${base + i}@example.com>`,
          from: "Me <me+alias@example.com>",
        }),
      }));
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        {
          path: "Sent",
          specialUse: "\\Sent",
          uidValidity: BigInt(999),
          messages: aliasCandidates(100, 1000),
        },
        {
          path: "INBOX/Sent",
          specialUse: "\\Sent",
          uidValidity: BigInt(998),
          messages: aliasCandidates(100, 2000),
        },
        {
          path: "Sent-Other",
          specialUse: "\\Sent",
          uidValidity: BigInt(997),
          messages: aliasCandidates(1, 3000),
        },
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("unknown");
    expect(result.reasonCode).toBe("probe_limit_exceeded");
  });

  it("expunged source (UID gone) + verified Sent match -> replied(sent_search)", async () => {
    const message = messageFixture();
    // The source INBOX message was expunged (refreshMessageFlags returns null
    // because the UID is gone). A verified Sent match still settles replied —
    // the flag side is incomplete but Sent search can complete the positive.
    const fixture: FakeImapFlowFixture = {
      folders: [
        // INBOX folder exists but the source UID is absent.
        inboxFolder([]),
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({}),
          },
        ]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("sent_search");
  });

  it("UIDVALIDITY change on the source folder -> flag refresh returns null (source gone)", async () => {
    const message = messageFixture(); // stored uidValidity = "424242"
    const fixture: FakeImapFlowFixture = {
      folders: [
        // Same path, different UIDVALIDITY → the §5.1 guard reports the UID
        // as gone rather than trusting it under a new namespace.
        inboxFolder([inboxMessage(["\\Answered"])], { uidValidity: BigInt(999999) }),
        sentFolder([]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // Flag side incomplete (UIDVALIDITY mismatch → null) + no Sent match +
    // Sent folder present and complete → since flagSideComplete is false the
    // outcome is unknown(probe_failed), NOT a negative. A UIDVALIDITY change
    // must never re-attribute a different message's \Answered flag.
    expect(result.state).toBe("unknown");
    expect(result.reasonCode).toBe("probe_failed");
  });

  it("clean negative: flag side observed not-answered + Sent search complete with no match -> not_replied", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]), // present, not answered
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            // Unrelated candidate — IMAP substring search surfaces it, but
            // local exact-token equality rejects it (§7.2).
            headers: sentReplyHeaders({
              inReplyTo: "<unrelated@example.com>",
              references: "<unrelated@example.com>",
            }),
          },
        ]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("not_replied");
    expect(result.replied).toBe(false);
    expect(result.reasonCode).toBe("no_reply_observed");
    // Negative persisted with a context hash for the 60s cache (T05 step 10).
    const negativeWrite = kit.updateCalls.find((c) => c.replyNegativeCheckAt);
    expect(negativeWrite).toBeDefined();
    expect(negativeWrite?.replyNegativeContextHash).toBeTruthy();
  });

  it("PEEK: every candidate fetch is header-only — no body/source/envelope, addressed by UID", async () => {
    const message = messageFixture();
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({}),
          },
        ]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    await kit.service.detect({ messageId: message.id });

    // The FakeImapFlow recorded every fetchOne call. The Sent search must use
    // header-only queries ({ headers: [...] }) and address by UID. The flag
    // refresh uses { flags: true, internalDate: true } (also PEEK — no body).
    const conn = kit.imapPort.lastConnection as unknown as {
      calls: Array<{ method: string; args: ReadonlyArray<unknown> }>;
    } | null;
    expect(conn).not.toBeNull();
    const fetches = conn!.calls.filter((c) => c.method === "fetchOne");
    expect(fetches.length).toBeGreaterThan(0);
    for (const f of fetches) {
      const query = f.args[1] as { headers?: unknown; flags?: unknown; source?: unknown; envelope?: unknown; bodyParts?: unknown };
      const isHeaderOnly = query.headers !== undefined && query.source === undefined && query.envelope === undefined && query.bodyParts === undefined;
      const isFlagsOnly = query.flags !== undefined && query.source === undefined && query.envelope === undefined && query.bodyParts === undefined;
      expect(isHeaderOnly || isFlagsOnly).toBe(true);
      const opts = f.args[2] as { uid?: boolean };
      expect(opts?.uid).toBe(true);
    }
  });

  it("read-source flag refresh ignores the unread-only sync bound (UID-scoped)", async () => {
    const message = messageFixture();
    // The source message is \Seen (already read). Default sync skips unread-
    // only, but the detector's UID-scoped refreshMessageFlags fetches the
    // flags directly by UID — it must NOT be filtered by read state.
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen", "\\Answered"])]),
        sentFolder([]),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // The \Answered flag is observed despite the message being \Seen →
    // replied(mailbox_flag). Proves refreshMessageFlags is UID-scoped, not
    // subject to the sync-time seen=false search bound.
    expect(result.state).toBe("replied");
    expect(result.source).toBe("mailbox_flag");
  });
});

