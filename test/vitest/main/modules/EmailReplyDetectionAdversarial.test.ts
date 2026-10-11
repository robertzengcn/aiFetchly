import { describe, it, expect, vi } from "vitest";

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
  /** Every connection created during the kit's lifetime, oldest first. */
  readonly allConnections: ImapFlowConnection[];
} {
  const allConnections: ImapFlowConnection[] = [];
  let lastConnection: ImapFlowConnection | null = null;
  const factory = fakeImapFlowFactory(fixture);
  // The factory is called per client method (each method builds its own
  // connection); capture every one so tests can assert cross-folder totals
  // (e.g. "at most 5 folder searches / 200 header fetches", R05).
  const wrappedFactory = () => {
    const conn = factory();
    lastConnection = conn;
    allConnections.push(conn);
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
    get allConnections() {
      return allConnections;
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

  it("deadline abort tears down the in-flight IMAP socket (review D9.2)", async () => {
    // The Sent-folder `mailboxOpen` hangs forever (a hung/slow IMAP server).
    // The 15s probe deadline elapses mid-operation; the racer aborts the
    // AbortController, the ImapEmailReceiveClient's abort listener calls
    // `client.close()` DURING the in-flight mailboxOpen (not just between
    // operations), and the probe resolves `probe_timeout`. Without the
    // listener, the checkpoint-only abortIfSignaled would never fire because
    // mailboxOpen never returns — the socket would linger until the server
    // responded. Fake timers drive the 15s deadline deterministically.
    vi.useFakeTimers();
    try {
      const message = messageFixture();
      const fixture: FakeImapFlowFixture = {
        folders: [
          inboxFolder([inboxMessage(["\\Seen"])]), // not answered → flag side incomplete
          // Sent-folder mailboxOpen hangs forever → deadline fires mid-open.
          sentFolder([]),
        ],
        hangOnMailboxOpen: "Sent",
      };
      const kit = buildMatrixKit({ message, fixture });

      const probeP = kit.service.detect({ messageId: message.id });
      // Drain microtasks so the probe enters flight + the racer arms its
      // setTimeout + the abort listener is attached to the in-flight
      // connection.
      await vi.advanceTimersByTimeAsync(0);
      // Advance past the 15s deadline — the racer aborts the controller, the
      // listener fires `client.close()` on the hung connection, and the racer
      // resolves with probe_timeout.
      await vi.advanceTimersByTimeAsync(16_000);

      const r = await probeP;
      expect(r.state).toBe("unknown");
      expect(r.reasonCode).toBe("probe_timeout");

      // The abort listener MUST have called `close()` on the in-flight
      // connection — that is the whole point of D9.2: tearing down the
      // socket the instant the deadline elapses, not waiting for the hung
      // operation to return. The checkpoint-only abortIfSignaled would NOT
      // have fired here because mailboxOpen never resolved.
      const conn = kit.imapPort.lastConnection as unknown as {
        calls: Array<{ method: string }>;
      } | null;
      expect(conn).not.toBeNull();
      const closes = conn!.calls.filter((c) => c.method === "close");
      expect(closes.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  // =========================================================================
  // R05 — adapter/folder truncation must yield unknown(probe_limit_exceeded),
  // never a cached complete negative. Both todo triggers run through the REAL
  // ImapEmailReceiveClient so the adapter's silent-truncation hole is closed
  // at the adapter layer, not only in detector bookkeeping.
  // =========================================================================

  it("R05 trigger A: six Sent folders, verified reply only in the sixth -> probe_limit_exceeded, no negative cache", async () => {
    const message = messageFixture();
    // Six verified \\Sent folders; the first five are EMPTY, the reply lives
    // only in the sixth. The detector's MAX_SENT_FOLDERS=5 bound drops the
    // sixth folder — the old code searched five empty folders and cached a
    // complete negative; the reply sat unexamined in the dropped sixth.
    const verifiedReply = {
      uid: 501,
      flags: new Set(["\\Seen"]),
      headers: sentReplyHeaders({}),
    };
    const sentFolderAt = (path: string): FakeMailboxFolder => ({
      path,
      specialUse: "\\Sent",
      uidValidity: BigInt(999),
      messages: path === "Sent-6" ? [verifiedReply] : [],
    });
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolderAt("Sent-1"),
        sentFolderAt("Sent-2"),
        sentFolderAt("Sent-3"),
        sentFolderAt("Sent-4"),
        sentFolderAt("Sent-5"),
        sentFolderAt("Sent-6"),
      ],
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // Unexamined folders ⇒ unknown, never a negative.
    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("probe_limit_exceeded");
    // No negative evidence write, no context-hash cache entry.
    expect(kit.updateCalls.filter((c) => c.replyNegativeCheckAt)).toHaveLength(0);
    // Bounds held: at most 5 folder searches (flag refresh uses its own
    // connection; searches live on their own connections).
    const searches = kit.imapPort.allConnections.flatMap(
      (c) => (c as unknown as { calls: Array<{ method: string }> }).calls
        .filter((call) => call.method === "search")
    );
    expect(searches.length).toBeLessThanOrEqual(5);
  });

  it("R05 trigger B: 201 candidates, first 200 false, #201 verified -> probe_limit_exceeded, no negative cache", async () => {
    const message = messageFixture();
    // One Sent folder where the substring search returns 201 candidates: the
    // first 200 are false matches and #201 is the verified direct reply. The
    // old adapter sliced to the first 200 (cap) WITHOUT reporting overflow and
    // the detector cached a complete negative — the verified reply sat in the
    // silently-dropped 201st slot.
    const falseCandidates = Array.from({ length: 200 }, (_, i) => ({
      uid: 1000 + i,
      flags: new Set(["\\Seen"]),
      headers: sentReplyHeaders({
        messageId: `<false-${1000 + i}@example.com>`,
        inReplyTo: "<unrelated@example.com>",
        references: "<unrelated@example.com>",
      }),
    }));
    // The false candidates' headers do NOT contain the search needle, so the
    // fake's default substring search would never surface them — pin the exact
    // candidate list: 200 false matches, then the verified reply at #201.
    const searchResultUids = [...falseCandidates.map((c) => c.uid), 2001];
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          ...falseCandidates,
          {
            uid: 2001, // last in the pinned search-result order
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({}),
          },
        ]),
      ],
      searchOverrides: new Map([["Sent", { result: searchResultUids }]]),
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // Exactly exhausting the last batch with overflow remaining is a limit
    // breach, not a complete negative (R05: "exactly exhausting the last
    // batch falls through to no_match" was the defect).
    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("probe_limit_exceeded");
    expect(kit.updateCalls.filter((c) => c.replyNegativeCheckAt)).toHaveLength(0);
    // Bounds held: at most 200 header fetch attempts in the Sent connection.
    const sentFetches = kit.imapPort.allConnections.flatMap(
      (c) => (c as unknown as { calls: Array<{ method: string; args: ReadonlyArray<unknown> }> }).calls
        .filter((call) => call.method === "fetchOne")
    );
    // flag refresh (1) + 200 candidate fetches; never 201+ candidate fetches.
    expect(sentFetches.length).toBeLessThanOrEqual(201);
  });

  it("R05: a verified direct match within the bounded scope still settles replied despite truncation", async () => {
    const message = messageFixture();
    // 201 candidates again, but this time the VERIFIED direct reply sits in
    // the FIRST batch — a positive settles the outcome within the searched
    // scope even though the folder was truncated (R05 fix clause: "A verified
    // direct positive can settle the outcome within the searched scope").
    const verifiedFirst = {
      uid: 100,
      flags: new Set(["\\Seen"]),
      headers: sentReplyHeaders({}),
    };
    const falseCandidates = Array.from({ length: 210 }, (_, i) => ({
      uid: 1000 + i,
      flags: new Set(["\\Seen"]),
      headers: sentReplyHeaders({
        messageId: `<false-${1000 + i}@example.com>`,
        inReplyTo: "<unrelated@example.com>",
        references: "<unrelated@example.com>",
      }),
    }));
    // Pin the full 211-UID candidate list (the false candidates' headers lack
    // the needle, so the default substring search would not surface them): the
    // verified reply is #1, the folder still overflows the 200 cap.
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([verifiedFirst, ...falseCandidates]),
      ],
      searchOverrides: new Map([
        ["Sent", { result: [verifiedFirst.uid, ...falseCandidates.map((c) => c.uid)] }],
      ]),
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied");
    expect(result.source).toBe("sent_search");
    expect(result.matchedMessageId).toBe("sent-501@example.com");
  });

  // =========================================================================
  // R06 — failed/unreadable candidate fetches are incomplete coverage, and
  // they consume the shared 200-fetch budget (attempted fetches, not parsed
  // candidates).
  // =========================================================================

  it("R06: a UID whose header fetch fails yields unknown (probe_failed), never a cached negative", async () => {
    const message = messageFixture();
    // The Sent folder contains one message, but the fetch returns NO readable
    // headers (empty header block — the malformed/unreadable half of R06; the
    // expunged-mid-probe half is covered by the adapter suite). The candidate
    // MAY be the verified reply; unreadable must stay unknown, not negative.
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            // Empty header block: the old adapter pushed an all-null
            // candidate the detector silently skipped as no_match.
            headers: Buffer.from("", "utf8"),
          },
        ]),
      ],
      // The empty header block contains no needle, so pin the candidate list —
      // the search claims this UID is a reply candidate.
      searchOverrides: new Map([["Sent", { result: [501] }]]),
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("probe_failed");
    expect(kit.updateCalls.filter((c) => c.replyNegativeCheckAt)).toHaveLength(0);
  });

  it("R06: a verified direct positive settles replied even when other fetches failed", async () => {
    const message = messageFixture();
    // Mixed folder: one unreadable candidate + one verified direct reply. The
    // verified positive settles the outcome; the failed fetch is only book-
    // keeping (incomplete coverage that the settled positive supersedes).
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        sentFolder([
          {
            uid: 500,
            flags: new Set(["\\Seen"]),
            headers: Buffer.from("", "utf8"), // unreadable — fetch "succeeds" but no headers
          },
          {
            uid: 501,
            flags: new Set(["\\Seen"]),
            headers: sentReplyHeaders({}),
          },
        ]),
      ],
      // The unreadable candidate's empty headers lack the needle — pin both
      // UIDs so the probe attempts the failed fetch BEFORE the verified one.
      searchOverrides: new Map([["Sent", { result: [500, 501] }]]),
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("sent_search");
    expect(result.matchedMessageId).toBe("sent-501@example.com");
  });

  it("R06: failed fetches across multiple folders consume the shared budget — total attempts never exceed 200", async () => {
    const message = messageFixture();
    // Three Sent folders, each returning 120 substring candidates whose
    // header fetches ALL fail (expunged mid-probe). Old behavior: failed
    // fetches returned no candidate DTOs, so nothing decremented the budget
    // and the probe attempted 360 network fetches (180% of the cap). Now the
    // budget counts ATTEMPTED fetches: folder 2 starts with 80 remaining, and
    // folder 3 starts with the budget exhausted → probe_limit_exceeded.
    const unreadableFolder = (path: string, base: number): FakeMailboxFolder => ({
      path,
      specialUse: "\\Sent",
      uidValidity: BigInt(997),
      messages: Array.from({ length: 120 }, (_, i) => ({
        uid: base + i,
        flags: new Set(["\\Seen"]),
        headers: Buffer.from("", "utf8"), // fetchOne returns false → failed fetch
      })),
    });
    const uidsFor = (base: number): number[] =>
      Array.from({ length: 120 }, (_, i) => base + i);
    const fixture: FakeImapFlowFixture = {
      folders: [
        inboxFolder([inboxMessage(["\\Seen"])]),
        unreadableFolder("Sent-1", 1000),
        unreadableFolder("Sent-2", 2000),
        unreadableFolder("Sent-3", 3000),
      ],
      // The unreadable candidates' empty headers lack the needle — pin each
      // folder's 120-UID candidate list so the probe really attempts them.
      searchOverrides: new Map([
        ["Sent-1", { result: uidsFor(1000) }],
        ["Sent-2", { result: uidsFor(2000) }],
        ["Sent-3", { result: uidsFor(3000) }],
      ]),
    };
    const kit = buildMatrixKit({ message, fixture });

    const result = await kit.service.detect({ messageId: message.id });

    // Budget exhausted by ATTEMPTED fetches → unknown, never a negative.
    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("probe_limit_exceeded");
    // Total header fetch attempts across every folder ≤ 200 (R06 bound).
    const fetches = kit.imapPort.allConnections.flatMap(
      (c) => (c as unknown as { calls: Array<{ method: string }> }).calls
        .filter((call) => call.method === "fetchOne")
    );
    // flag refresh contributes 1 fetch (flags query) — candidate attempts ≤ 200.
    expect(fetches.length).toBeLessThanOrEqual(201);
    expect(fetches.length).toBeGreaterThan(200); // prove attempts actually ran past naive parsed-candidate counting (0)
    // No negative was cached despite zero parsed candidates.
    expect(kit.updateCalls.filter((c) => c.replyNegativeCheckAt)).toHaveLength(0);
  });

  // ===========================================================================
  // R08 — abort listener must be attached BEFORE connect; already-aborted work
  // must not open a socket; the implicit-TLS retry must not open a post-
  // cancellation orphan socket. The old order (connect → attachAbortListener)
  // left a hung connect() unwatched, so the socket lingered until the server
  // responded while the deadline racer had already logically released.
  // ===========================================================================

  it("R08: deadline during a hung connect tears down the socket (close recorded, no orphan)", async () => {
    // connect() hangs forever — a hung/slow TCP/TLS handshake or login. The
    // abort listener (R08: attached BEFORE connect) must call `close()` the
    // instant the 15s deadline racer aborts, so the probe resolves
    // probe_timeout and leaves no lingering socket.
    vi.useFakeTimers();
    try {
      const message = messageFixture();
      const fixture: FakeImapFlowFixture = {
        folders: [
          inboxFolder([inboxMessage(["\\Seen"])]), // not answered → flag side incomplete
          sentFolder([]),
        ],
        hangOnConnect: true,
      };
      const kit = buildMatrixKit({ message, fixture });

      const probeP = kit.service.detect({ messageId: message.id });
      // Drain microtasks so the probe enters flight + the racer arms its
      // setTimeout + the abort listener is attached to the hung connect().
      await vi.advanceTimersByTimeAsync(0);
      // Advance past the 15s deadline — the racer aborts the controller.
      await vi.advanceTimersByTimeAsync(16_000);

      const r = await probeP;
      expect(r.state).toBe("unknown");
      expect(r.reasonCode).toBe("probe_timeout");

      // The abort listener MUST have called `close()` on the hung connection.
      // Without the R08 before-connect attach, the listener would not exist
      // during the hung connect() (it was attached AFTER connect resolved, which
      // never happens) — the socket would linger, unrecorded here.
      const conn = kit.imapPort.lastConnection as unknown as {
        calls: Array<{ method: string }>;
      } | null;
      expect(conn).not.toBeNull();
      const closes = conn!.calls.filter((c) => c.method === "close");
      expect(closes.length).toBeGreaterThanOrEqual(1);
      // Exactly ONE connect was attempted — no orphan retry socket spawned
      // (the connect never resolved, so shouldRetryWithImplicitTls never ran;
      // but the point is no second connection was opened).
      const connects = conn!.calls.filter((c) => c.method === "connect");
      expect(connects.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  it("R08: already-aborted work opens NO socket (no connect, no orphan)", async () => {
    // A probe whose signal is already aborted (e.g. the deadline elapsed
    // during the mailbox queue wait, R07) must not open a TCP/TLS connection.
    // The R08 guard rejects already-aborted work before createClient/connect.
    // Use the ImapEmailReceiveClient directly with a pre-aborted controller so
    // the guard is exercised at the adapter (not just through the detector).
    const controller = new AbortController();
    controller.abort();
    const connectCalls: number[] = [];
    const factory = (): ImapFlowConnection => {
      // A fake that records connect invocations. The R08 guard must prevent
      // this from ever being called for connect.
      const base = fakeImapFlowFactory({
        folders: [
          inboxFolder([inboxMessage(["\\Seen"])]),
          sentFolder([]),
        ],
      })();
      return {
        ...base,
        connect: async (): Promise<void> => {
          connectCalls.push(1);
        },
      };
    };
    const client = new ImapEmailReceiveClient({ imapFlowFactory: factory });

    const r = await client.discoverSentFolders(imapConfig(), controller.signal);
    expect(r).toEqual([]); // aborted → empty scope, not a negative
    expect(connectCalls.length).toBe(0); // R08: no socket opened

    // Same for the other two probe methods.
    const flags = await client.refreshMessageFlags({
      config: imapConfig(),
      folder: "INBOX",
      uidValidity: "424242",
      uid: "77",
      signal: controller.signal,
    });
    expect(flags).toBeNull();
    expect(connectCalls.length).toBe(0);

    const search = await client.searchReplyHeaders({
      config: imapConfig(),
      folder: "Sent",
      originalMessageId: ORIGINAL_ID,
      cap: 10,
      signal: controller.signal,
    });
    expect(search).toBe(false);
    expect(connectCalls.length).toBe(0);
  });

  it("R08: the implicit-TLS retry does NOT open a post-cancellation orphan socket", async () => {
    // The first connect throws a retryable greeting-timeout error. The deadline
    // racer aborts the signal DURING the first connect's failure (before the
    // catch block decides to retry). The R08 retry guard must return WITHOUT
    // opening a second socket — no orphan.
    const controller = new AbortController();
    let connectAttempts = 0;
    const factory = (): ImapFlowConnection => {
      const base = fakeImapFlowFactory({
        folders: [
          inboxFolder([inboxMessage(["\\Seen"])]),
          sentFolder([]),
        ],
      })();
      return {
        ...base,
        connect: async (): Promise<void> => {
          connectAttempts += 1;
          if (connectAttempts === 1) {
            // Simulate the deadline racer firing during the hung/failed connect
            // — the signal aborts BEFORE the rejection propagates to the catch.
            controller.abort();
            const err = Object.assign(new Error("GREETING_TIMEOUT"), {
              code: "GREETING_TIMEOUT",
            });
            throw err;
          }
          // Second connect: if reached, would be the orphan. The R08 retry
          // guard must prevent this because the signal aborted before retry.
          await new Promise<void>(() => {}); // hang to make any bug obvious
        },
      };
    };
    const client = new ImapEmailReceiveClient({ imapFlowFactory: factory });

    const r = await client.refreshMessageFlags({
      config: imapConfig(),
      folder: "INBOX",
      uidValidity: "424242",
      uid: "77",
      signal: controller.signal,
    });

    // R08: the retry guard returns null (already-aborted) — no second socket.
    expect(r).toBeNull();
    // Exactly ONE connect was attempted (the initial greeting-timeout); the
    // implicit-TLS retry connect did NOT happen — no orphan socket.
    expect(connectAttempts).toBe(1);
  });
});

