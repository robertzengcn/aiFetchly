import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

// The detection service imports the real default ports (Modules + Client) at
// construction time. The Modules extend BaseModule which touches Token / Db
// at construction; mock electron + Logger BEFORE the import so the lazy
// getters never reach the real ipcMain. Tests inject fake ports through the
// constructor seam so the defaults are never used.
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
import type { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import type { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import type {
  RefreshedFlags,
  ReplyHeaderCandidate,
  ReplyHeaderSearchResult,
  SentFolder,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  EmailReplyDetectionService,
  REPLY_DETECTOR_VERSION,
  type ReplyDetectionMessagePort,
  type ReplyDetectionDraftPort,
  type ReplyDetectionAttemptPort,
  type ReplyDetectionEmailServicePort,
  type ReplyDetectionImapPort,
} from "@/service/emailReceive/EmailReplyDetectionService";
import { PENDING_NEGATIVE_CONTEXT } from "@/service/emailReceive/EmailReplyIdentity";

// ---------------------------------------------------------------------------
// Builders — real entities (no `as Entity` casts), real values.
// ---------------------------------------------------------------------------

function messageFixture(overrides: Partial<EmailReceivedMessageEntity> = {}): EmailReceivedMessageEntity {
  const e = new EmailReceivedMessageEntity();
  e.id = 100;
  e.emailServiceId = 5;
  e.providerUid = "imap:aaaaaaaaaaaaaaaa:424242:77";
  e.messageId = "<orig-77@example.com>";
  e.normalizedMessageId = "<orig-77@example.com>";
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

function draftEntity(id: number, messageId: number, status: string): EmailReplyDraftEntity {
  return {
    id,
    messageId,
    status,
  } as EmailReplyDraftEntity;
}

function attemptEntity(id: number, messageId: number, status: string): EmailReplySendAttemptEntity {
  return {
    id,
    messageId,
    status,
  } as EmailReplySendAttemptEntity;
}

function imapConfig(
  overrides: Partial<EmailReceiveConnectionConfig> = {}
): EmailReceiveConnectionConfig {
  return {
    emailServiceId: 5,
    protocol: "imap",
    host: "imap.example.com",
    port: 993,
    ssl: true,
    username: "me@example.com",
    password: "secret-pw",
    folder: "INBOX",
    ...overrides,
  };
}

/**
 * Reproduce the production pre-probe context hash (empty Sent scope) for a
 * config + configured-sender pair, so D5 tests can seed the exact hash a
 * real probe under that context would persist. Material order mirrors
 * hashContext: endpoint|protocol|username|scope|sender|detector-version.
 */
function preProbeContextHash(
  config: EmailReceiveConnectionConfig,
  configuredSender: string
): string {
  const material = [
    `${config.host}:${config.port}`,
    config.protocol,
    config.username,
    "",
    configuredSender.toLowerCase(),
    REPLY_DETECTOR_VERSION,
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

function candidateFixture(overrides: Partial<ReplyHeaderCandidate> = {}): ReplyHeaderCandidate {
  return {
    folder: "Sent",
    uid: 501,
    messageId: "<sent-501@example.com>",
    inReplyTo: "<orig-77@example.com>",
    references: "<orig-77@example.com>",
    from: "me@example.com",
    to: "prospect@example.com",
    date: "2026-10-05T11:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake ports — behavioral fakes with controllable, observable state.
// ---------------------------------------------------------------------------

interface FakeMessagePortOptions {
  message: EmailReceivedMessageEntity;
  cluster?: EmailReceivedMessageEntity[];
  updateCalls: Array<Record<string, unknown>>;
  /** When set, updateReplyEvidence throws this Error (simulates persistence failure). */
  updateThrows?: Error;
  /**
   * R09: when set, its return value becomes the write result instead of
   * `true` — simulates the conditional evidence UPDATE affecting 0 rows
   * (rejected write). The callback may mutate the fixture row to simulate a
   * concurrent writer landing positive evidence first.
   */
  updateResult?: (input: Record<string, unknown>) => boolean;
  /** R09: when it returns true, `read` returns null (row deleted). */
  readReturnsNull?: () => boolean;
}

function fakeMessagePort(
  opts: FakeMessagePortOptions
): ReplyDetectionMessagePort & {
  updateCalls: Array<Record<string, unknown>>;
  confirmCalls: Array<Record<string, unknown>>;
} {
  const updateCalls = opts.updateCalls;
  const confirmCalls: Array<Record<string, unknown>> = [];
  return {
    async read(id: number) {
      if (opts.readReturnsNull?.()) return null;
      return id === opts.message.id ? opts.message : null;
    },
    async findCanonicalEquivalents() {
      return opts.cluster ?? [opts.message];
    },
    async updateReplyEvidence(input) {
      updateCalls.push(input);
      if (opts.updateThrows) throw opts.updateThrows;
      return opts.updateResult ? opts.updateResult(input) : true;
    },
    // N02: the confirm path records separately so tests can distinguish
    // staging writes from confirmation writes. Same failure semantics as
    // the stage path (throw / custom result) unless overridden.
    async confirmStagedNegativeEvidence(input) {
      confirmCalls.push(input as unknown as Record<string, unknown>);
      if (opts.updateThrows) throw opts.updateThrows;
      return opts.updateResult
        ? opts.updateResult(input as unknown as Record<string, unknown>)
        : true;
    },
    updateCalls,
    confirmCalls,
  };
}

function fakeDraftPort(draftsByMessage: Map<number, EmailReplyDraftEntity[]>): ReplyDetectionDraftPort {
  return {
    async listByMessages(messageIds: number[]) {
      return messageIds.flatMap((id) => draftsByMessage.get(id) ?? []);
    },
  };
}

function fakeAttemptPort(attemptsByMessage: Map<number, EmailReplySendAttemptEntity[]>): ReplyDetectionAttemptPort {
  return {
    async listByMessages(messageIds: number[]) {
      return messageIds.flatMap((id) => attemptsByMessage.get(id) ?? []);
    },
  };
}

interface FakeEmailServicePortOptions {
  config: EmailReceiveConnectionConfig | null;
  identity: { smtpUsername: string; fromAddress: string; replyToAddress: string | null; receiveUsername: string } | null;
  /** Return a different config on the SECOND getEmailServiceReceiveConfig call (mid-probe reconfig). */
  reconfiguredConfig?: EmailReceiveConnectionConfig | null;
  /** R10: return a different identity on the SECOND readIdentity call
   * (mid-probe reconfig of the configured sender). The fence rereads the
   * identity alongside the config, so a fresh probe sees two identity
   * reads; the reconfig lands on the fence's read. */
  reconfiguredIdentity?: { smtpUsername: string; fromAddress: string; replyToAddress: string | null; receiveUsername: string } | null;
}

function fakeEmailServicePort(opts: FakeEmailServicePortOptions): ReplyDetectionEmailServicePort & {
  callCount: number;
  identityCallCount: number;
} {
  let callCount = 0;
  let identityCallCount = 0;
  return {
    async getEmailServiceReceiveConfig() {
      callCount += 1;
      if (callCount === 2 && opts.reconfiguredConfig !== undefined) {
        return opts.reconfiguredConfig;
      }
      return opts.config;
    },
    async readIdentity() {
      identityCallCount += 1;
      if (identityCallCount === 2 && opts.reconfiguredIdentity !== undefined) {
        return opts.reconfiguredIdentity;
      }
      return opts.identity;
    },
    get callCount() {
      return callCount;
    },
    get identityCallCount() {
      return identityCallCount;
    },
  };
}

interface FakeImapPortOptions {
  flags?: RefreshedFlags | null;
  flagsThrows?: boolean;
  sentFolders?: SentFolder[];
  sentFoldersThrow?: boolean;
  /** Per-folder search result; `false` = failed/incomplete search. A bare
   * candidate array is wrapped as a complete, untruncated, no-failed-fetch
   * result (the common in-test shape). */
  candidatesByFolder?: Map<string, ReplyHeaderSearchResult | ReplyHeaderCandidate[] | false>;
  candidatesThrow?: boolean;
}

function fakeImapPort(opts: FakeImapPortOptions = {}): ReplyDetectionImapPort & {
  refreshCalls: Array<{ folder: string; uidValidity: string; uid: string }>;
  searchCalls: Array<{ folder: string; originalMessageId: string; cap: number }>;
} {
  const refreshCalls: Array<{ folder: string; uidValidity: string; uid: string }> = [];
  const searchCalls: Array<{ folder: string; originalMessageId: string; cap: number }> = [];
  return {
    async refreshMessageFlags(input) {
      refreshCalls.push({ folder: input.folder, uidValidity: input.uidValidity, uid: input.uid });
      if (opts.flagsThrows) throw new Error("imap flag refresh failed");
      return opts.flags ?? null;
    },
    async discoverSentFolders() {
      if (opts.sentFoldersThrow) throw new Error("imap list failed");
      return opts.sentFolders ?? [];
    },
    async searchReplyHeaders(input) {
      searchCalls.push({ folder: input.folder, originalMessageId: input.originalMessageId, cap: input.cap });
      if (opts.candidatesThrow) throw new Error("imap search failed");
      const stored = opts.candidatesByFolder?.get(input.folder);
      if (stored === undefined) {
        return { candidates: [], truncated: false, failedFetchCount: 0 };
      }
      if (Array.isArray(stored)) {
        // Bare candidate array = complete search, no truncation, no failed fetches.
        return { candidates: stored, truncated: false, failedFetchCount: 0 };
      }
      return stored;
    },
    refreshCalls,
    searchCalls,
  };
}

// ---------------------------------------------------------------------------
// Service builder — wires all fake ports together.
// ---------------------------------------------------------------------------

interface ServiceKit {
  service: EmailReplyDetectionService;
  messagePort: ReturnType<typeof fakeMessagePort>;
  draftPort: ReplyDetectionDraftPort;
  attemptPort: ReplyDetectionAttemptPort;
  emailServicePort: ReturnType<typeof fakeEmailServicePort>;
  imapPort: ReturnType<typeof fakeImapPort>;
  nowMs: { value: number };
}

function buildServiceKit(input: {
  message: EmailReceivedMessageEntity;
  cluster?: EmailReceivedMessageEntity[];
  draftsByMessage?: Map<number, EmailReplyDraftEntity[]>;
  attemptsByMessage?: Map<number, EmailReplySendAttemptEntity[]>;
  emailServiceOptions: FakeEmailServicePortOptions;
  imapOptions?: FakeImapPortOptions;
  updateThrows?: Error;
  /** R09: override the write result (conditional UPDATE rejected). */
  updateResult?: (input: Record<string, unknown>) => boolean;
  /** R09: when it returns true, subsequent reads return null (row deleted). */
  readReturnsNull?: () => boolean;
}): ServiceKit {
  const updateCalls: Array<Record<string, unknown>> = [];
  const nowMs = { value: 1_000_000 };
  const messagePort = fakeMessagePort({
    message: input.message,
    cluster: input.cluster,
    updateCalls,
    updateThrows: input.updateThrows,
    updateResult: input.updateResult,
    readReturnsNull: input.readReturnsNull,
  });
  const draftPort = fakeDraftPort(input.draftsByMessage ?? new Map());
  const attemptPort = fakeAttemptPort(input.attemptsByMessage ?? new Map());
  const emailServicePort = fakeEmailServicePort(input.emailServiceOptions);
  const imapPort = fakeImapPort(input.imapOptions);
  const service = new EmailReplyDetectionService({
    messagePort,
    draftPort,
    attemptPort,
    emailServicePort,
    imapPort,
    now: () => nowMs.value,
  });
  return { service, messagePort, draftPort, attemptPort, emailServicePort, imapPort, nowMs };
}

// ===========================================================================
// §7.1 step 1 — local-first short-circuits (no IMAP round trip).
// ===========================================================================

describe("EmailReplyDetectionService — local-first short-circuits (§7.1 step 1)", () => {
  it("returns replied(local_state) when replyStatus is already 'sent'", async () => {
    const message = messageFixture({ replyStatus: "sent" });
    const kit = buildServiceKit({ message, emailServiceOptions: { config: imapConfig(), identity: null } });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("local_state");
    expect(result.reasonCode).toBe("already_replied");
    expect(result.coverage).toBe("local_only");
    expect(result.fromCache).toBe(true);
    // No mailbox I/O whatsoever.
    expect(kit.imapPort.refreshCalls.length).toBe(0);
    expect(kit.imapPort.searchCalls.length).toBe(0);
  });

  it("returns replied(local_state) when a sent draft exists in the cluster", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    const drafts = new Map([[100, [draftEntity(1, 100, "sent")]]]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      emailServiceOptions: { config: imapConfig(), identity: null },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("local_state");
    expect(result.reasonCode).toBe("already_replied");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("returns replied(local_state) when a sent send-attempt exists in the cluster", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    const attempts = new Map([[100, [attemptEntity(1, 100, "sent")]]]);
    const kit = buildServiceKit({
      message,
      attemptsByMessage: attempts,
      emailServiceOptions: { config: imapConfig(), identity: null },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("local_state");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("returns unknown(local_state, reply_in_progress) when a sending draft is in-flight", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    const drafts = new Map([[100, [draftEntity(1, 100, "sending")]]]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      emailServiceOptions: { config: imapConfig(), identity: null },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("reply_in_progress");
    expect(result.source).toBe("local_state");
    expect(result.coverage).toBe("local_only");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("returns unknown(local_state, reply_in_progress) when an attempt is claimed/in-flight", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    const attempts = new Map([[100, [attemptEntity(1, 100, "claimed")]]]);
    const kit = buildServiceKit({
      message,
      attemptsByMessage: attempts,
      emailServiceOptions: { config: imapConfig(), identity: null },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("reply_in_progress");
  });

  it("returns unknown(local_state, delivery_unknown) when a prior attempt is unresolved", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    const drafts = new Map([[100, [draftEntity(1, 100, "delivery_unknown")]]]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      emailServiceOptions: { config: imapConfig(), identity: null },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("delivery_unknown");
    expect(result.source).toBe("local_state");
  });
});

// ===========================================================================
// R12 (§9.4 item 4) — exact-attempt ownership exclusion for the delayed
// pre-SMTP refresh. After claim+markSubmitted the seed's OWN draft is
// `sending` and the OWN attempt is `submitted` (in-flight). A naive
// post-claim detect() refresh would short-circuit at inspectLocalState
// step 3 (reply_in_progress) WITHOUT ever reaching the mailbox probe —
// defeating the §9.4 delayed refresh. The detector's detect() input gains
// an exclusion handle so the refresh recognizes ONLY this operation's exact
// attempt as the current owner and proceeds to the mailbox; every OTHER
// pending/sent/unknown record on the cluster still blocks.
//
// The test stubs (draftEntity/attemptEntity) carry ONLY id/messageId/status
// (no draftId), so the exclusion must key on draft.id + attempt.id —
// mirroring how clusterEvidenceBlocksSend excludes the claiming draft's own
// records by id.
// ===========================================================================
describe("EmailReplyDetectionService — R12 exact-attempt exclusion (§9.4 item 4)", () => {
  // A probe fixture that reaches the mailbox (refresh + sent-folder search),
  // returning not_replied. Used to prove the excluded refresh did NOT
  // short-circuit at local-state.
  const probeImapOptions = (): Parameters<typeof fakeImapPort>[0] => ({
    flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date() },
    sentFolders: [{ folder: "Sent", verified: true }],
    candidatesByFolder: new Map([["Sent", []]]),
  });

  it("excluded refresh proceeds past own sending draft + own submitted attempt to the mailbox probe", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    // OWN draft is `sending`, OWN attempt is `submitted` (in-flight) — exactly
    // the post-claim+markSubmitted state.
    const drafts = new Map([[100, [draftEntity(7, 100, "sending")]]]);
    const attempts = new Map([[100, [attemptEntity(9, 100, "submitted")]]]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      attemptsByMessage: attempts,
      emailServiceOptions: {
        config: imapConfig(),
        identity: {
          smtpUsername: "me@example.com",
          fromAddress: "me@example.com",
          replyToAddress: null,
          receiveUsername: "me@example.com",
        },
      },
      imapOptions: probeImapOptions(),
    });

    const result = await kit.service.detect({
      messageId: 100,
      forceRefresh: true,
      excludeDraftId: 7,
      excludeAttemptId: 9,
    });

    // The refresh reached the mailbox probe (did NOT short-circuit at
    // reply_in_progress).
    expect(kit.imapPort.refreshCalls.length).toBeGreaterThan(0);
    expect(result.state).toBe("not_replied");
  });

  it("WITHOUT the exclusion handle, the own sending draft + own submitted attempt still block as reply_in_progress", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    const drafts = new Map([[100, [draftEntity(7, 100, "sending")]]]);
    const attempts = new Map([[100, [attemptEntity(9, 100, "submitted")]]]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      attemptsByMessage: attempts,
      emailServiceOptions: { config: imapConfig(), identity: null },
      imapOptions: probeImapOptions(),
    });

    const result = await kit.service.detect({
      messageId: 100,
      forceRefresh: true,
    });

    // No exclusion → the current ladder short-circuits (protection unchanged).
    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("reply_in_progress");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("exclusion does NOT silence a SIBLING sending draft — every other pending record still blocks", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    // OWN draft 7 (sending) + OWN attempt 9 (submitted) are excluded, BUT a
    // SIBLING draft 8 (sending) on the same message is NOT the current
    // operation's owner → must still block.
    const drafts = new Map([
      [100, [draftEntity(7, 100, "sending"), draftEntity(8, 100, "sending")]],
    ]);
    const attempts = new Map([[100, [attemptEntity(9, 100, "submitted")]]]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      attemptsByMessage: attempts,
      emailServiceOptions: { config: imapConfig(), identity: null },
      imapOptions: probeImapOptions(),
    });

    const result = await kit.service.detect({
      messageId: 100,
      forceRefresh: true,
      excludeDraftId: 7,
      excludeAttemptId: 9,
    });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("reply_in_progress");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("exclusion does NOT silence a SIBLING sent draft or sent attempt — replied still wins", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    // OWN draft 7 (sending) + OWN attempt 9 (submitted) excluded, but a
    // SIBLING attempt 10 is already `sent` → replied (local_state), no probe.
    const drafts = new Map([[100, [draftEntity(7, 100, "sending")]]]);
    const attempts = new Map([
      [100, [attemptEntity(9, 100, "submitted"), attemptEntity(10, 100, "sent")]],
    ]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      attemptsByMessage: attempts,
      emailServiceOptions: { config: imapConfig(), identity: null },
      imapOptions: probeImapOptions(),
    });

    const result = await kit.service.detect({
      messageId: 100,
      forceRefresh: true,
      excludeDraftId: 7,
      excludeAttemptId: 9,
    });

    expect(result.state).toBe("replied");
    expect(result.source).toBe("local_state");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("exclusion does NOT silence a SIBLING delivery_unknown draft — still blocks", async () => {
    const message = messageFixture({ replyStatus: "draft_created" });
    const drafts = new Map([
      [100, [draftEntity(7, 100, "sending"), draftEntity(11, 100, "delivery_unknown")]],
    ]);
    const attempts = new Map([[100, [attemptEntity(9, 100, "submitted")]]]);
    const kit = buildServiceKit({
      message,
      draftsByMessage: drafts,
      attemptsByMessage: attempts,
      emailServiceOptions: { config: imapConfig(), identity: null },
      imapOptions: probeImapOptions(),
    });

    const result = await kit.service.detect({
      messageId: 100,
      forceRefresh: true,
      excludeDraftId: 7,
      excludeAttemptId: 9,
    });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("delivery_unknown");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });
});

// ===========================================================================
// §7.1 step 2 — sticky positive evidence reuse.
// ===========================================================================

describe("EmailReplyDetectionService — sticky positive reuse (§7.1 step 2)", () => {
  it("returns replied from cache when replyDetectedAt is set (mailbox_flag)", async () => {
    const message = messageFixture({
      replyStatus: "not_started",
      replyDetectedAt: new Date("2026-10-05T11:00:00Z"),
      replyDetectionSource: "mailbox_flag",
      replyMatchedMessageId: null,
    });
    const kit = buildServiceKit({ message, emailServiceOptions: { config: imapConfig(), identity: null } });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied");
    expect(result.source).toBe("mailbox_flag");
    expect(result.fromCache).toBe(true);
    expect(result.coverage).toBe("configured_imap");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
    expect(kit.imapPort.searchCalls.length).toBe(0);
  });

  it("returns replied from cache when replyDetectedAt is set (sent_search) carrying matchedMessageId", async () => {
    const message = messageFixture({
      replyStatus: "not_started",
      replyDetectedAt: new Date("2026-10-05T11:00:00Z"),
      replyDetectionSource: "sent_search",
      replyMatchedMessageId: "<sent-501@example.com>",
    });
    const kit = buildServiceKit({ message, emailServiceOptions: { config: imapConfig(), identity: null } });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied");
    expect(result.source).toBe("sent_search");
    expect(result.matchedMessageId).toBe("<sent-501@example.com>");
    expect(result.fromCache).toBe(true);
  });
});

// ===========================================================================
// §7.1 step 3 — negative reuse (draft checks only; age 0–60s + matching hash).
// ===========================================================================

describe("EmailReplyDetectionService — negative reuse (§7.1 step 3)", () => {
  it("returns not_replied from cache when observation is 30s old and hash present", async () => {
    // nowMs starts at 1_000_000; observation 30s ago. The stored hash is the
    // real pre-probe hash for THIS config + sender so the D5 read-side
    // recompute compares equal.
    const message = messageFixture({
      replyStatus: "not_started",
      replyNegativeCheckAt: new Date(1_000_000 - 30_000),
      replyNegativeContextHash: preProbeContextHash(imapConfig(), "me@example.com"),
    });
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("not_replied");
    if (result.state !== "not_replied") throw new Error("expected not_replied");
    expect(result.source).toBe("sent_search");
    expect(result.fromCache).toBe(true);
    expect(result.coverage).toBe("configured_imap");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
    expect(kit.imapPort.searchCalls.length).toBe(0);
  });

  it("does NOT reuse a cached negative older than 60s (proceeds to mailbox)", async () => {
    const message = messageFixture({
      replyStatus: "not_started",
      replyNegativeCheckAt: new Date(1_000_000 - 90_000), // 90s ago → expired
      replyNegativeContextHash: "some-hash",
    });
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date() },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    // Proceeded to mailbox and observed a complete negative.
    expect(result.state).toBe("not_replied");
    expect(kit.imapPort.refreshCalls.length).toBe(1);
    expect(kit.imapPort.searchCalls.length).toBe(1);
  });

  it("forceRefresh skips the cached negative (delivery path)", async () => {
    const message = messageFixture({
      replyStatus: "not_started",
      replyNegativeCheckAt: new Date(1_000_000 - 5_000), // 5s ago — fresh
      replyNegativeContextHash: "some-hash",
    });
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date() },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100, forceRefresh: true });

    // Cache skipped; mailbox probed.
    expect(kit.imapPort.refreshCalls.length).toBe(1);
    expect(kit.imapPort.searchCalls.length).toBe(1);
    expect(result.state).toBe("not_replied");
  });

  it("does not reuse a cached negative with a future timestamp (clock skew)", async () => {
    const message = messageFixture({
      replyStatus: "not_started",
      replyNegativeCheckAt: new Date(1_000_000 + 60_000), // 60s in the future
      replyNegativeContextHash: "some-hash",
    });
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date() },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(kit.imapPort.refreshCalls.length).toBe(1);
    expect(result.state).toBe("not_replied");
  });

  // D5 (review finding): the stored context hash was never compared against
  // the CURRENT account context — the read was presence-only, so within 60s
  // of reconfiguring the mailbox (new host/username/sender/detector version)
  // a stale negative was served and a duplicate reply could be sent.
  it("D5: does NOT reuse a cached negative after the account config changed", async () => {
    // A negative persisted 30s ago under the ORIGINAL config's context hash.
    // Compute the hash the production pre-probe path produces for that
    // original context (empty Sent scope — scope is unknown at read time).
    // Material order mirrors hashContext: endpoint|protocol|username|scope|sender|version.
    const originalConfig = imapConfig();
    const staleHash = preProbeContextHash(originalConfig, "me@example.com");

    const message = messageFixture({
      replyStatus: "not_started",
      replyNegativeCheckAt: new Date(1_000_000 - 30_000),
      replyNegativeContextHash: staleHash,
    });
    // The account was RECONFIGURED between the probe and this read: new host.
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig({ host: "imap.reconfigured.example.com" }),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date() },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    // The stale negative must NOT be served — detection re-probes under the
    // new context instead of trusting the old account's observation.
    expect(result.fromCache).toBe(false);
    expect(kit.imapPort.refreshCalls.length).toBe(1);
    expect(kit.imapPort.searchCalls.length).toBe(1);
  });

  it("D5: recomputes and honors the cached negative when the account config is UNCHANGED", async () => {
    // Same setup as the mismatch test, but the config matches the hash's
    // context → the negative IS reused (no mailbox round trip).
    const originalConfig = imapConfig();
    const staleHash = preProbeContextHash(originalConfig, "me@example.com");

    const message = messageFixture({
      replyStatus: "not_started",
      replyNegativeCheckAt: new Date(1_000_000 - 30_000),
      replyNegativeContextHash: staleHash,
    });
    const kit = buildServiceKit({
      message,
      emailServiceOptions: { config: originalConfig, identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" } },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date() },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("not_replied");
    expect(result.fromCache).toBe(true);
    expect(kit.imapPort.refreshCalls.length).toBe(0);
    expect(kit.imapPort.searchCalls.length).toBe(0);
  });
});

// ===========================================================================
// §7.1 step 4 — POP3 / config-unavailable / missing RFC ID → typed unknown.
// ===========================================================================

describe("EmailReplyDetectionService — typed unknown (§7.1 step 4)", () => {
  it("returns unknown(missing_message_id) when no normalized RFC id exists", async () => {
    const message = messageFixture({
      normalizedMessageId: null,
      messageId: null,
    });
    const kit = buildServiceKit({ message, emailServiceOptions: { config: imapConfig(), identity: null } });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("missing_message_id");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("returns unknown(receive_unavailable) when the receive config is missing", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: { config: null, identity: null },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("receive_unavailable");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
  });

  it("returns unknown(unsupported_protocol) for a POP3 account — never constructs an IMAP client", async () => {
    const message = messageFixture();
    const pop3Config: EmailReceiveConnectionConfig = {
      emailServiceId: 5,
      protocol: "pop3",
      host: "pop.example.com",
      port: 995,
      ssl: true,
      username: "me@example.com",
      password: "pop-pw",
      folder: "INBOX",
    };
    const kit = buildServiceKit({
      message,
      emailServiceOptions: { config: pop3Config, identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" } },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("unsupported_protocol");
    expect(kit.imapPort.refreshCalls.length).toBe(0);
    expect(kit.imapPort.searchCalls.length).toBe(0);
  });
});

// ===========================================================================
// §7.1 step 5 — positive `\Answered` flag → replied (mailbox_flag).
// ===========================================================================

describe("EmailReplyDetectionService — \\Answered flag (§7.1 step 5)", () => {
  it("returns replied(mailbox_flag) and persists a sticky positive when \\Answered is set", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: true, isSeen: true, flags: ["\\seen", "\\answered"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied");
    expect(result.source).toBe("mailbox_flag");
    expect(result.fromCache).toBe(false);
    expect(result.coverage).toBe("configured_imap");
    // Persisted the sticky positive.
    expect(kit.messagePort.updateCalls.length).toBe(1);
    const write = kit.messagePort.updateCalls[0];
    expect(write.replyDetectedAt).toBeDefined();
    expect(write.replyDetectionSource).toBe("mailbox_flag");
    // No Sent search needed — the flag settled it.
    expect(kit.imapPort.searchCalls.length).toBe(0);
  });

  it("returns unknown(probe_failed) — not negative — when the flag side is expunged (null flags) and Sent search incomplete", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: null, // expunged/moved/UIDVALIDITY changed
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", false]]), // search failed
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("probe_failed");
    // No negative persisted.
    expect(kit.messagePort.updateCalls.length).toBe(0);
  });
});

// ===========================================================================
// §7.1 step 6 — Sent-folder search + §7.2 matching rules.
// ===========================================================================

describe("EmailReplyDetectionService — Sent-search matching (§7.1 step 6, §7.2)", () => {
  it("returns replied(sent_search) when a verified direct parent is found and persists the positive", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([
          ["Sent", [candidateFixture()]],
        ]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied");
    expect(result.source).toBe("sent_search");
    // matchedMessageId is the normalized candidate Message-ID (brackets
    // stripped) — the same canonical form used for token equality.
    expect(result.matchedMessageId).toBe("sent-501@example.com");
    expect(kit.messagePort.updateCalls.length).toBe(1);
    expect(kit.messagePort.updateCalls[0].replyDetectionSource).toBe("sent_search");
    expect(kit.messagePort.updateCalls[0].replyMatchedMessageId).toBe("sent-501@example.com");
  });

  it("returns replied(sent_search) even when the flag side was expunged (verified direct match still settles)", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: null, // expunged — flag side incomplete
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", [candidateFixture()]]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied");
    expect(result.source).toBe("sent_search");
  });

  it("returns unknown(ambiguous_match) for a References-only candidate (no In-Reply-To direct parent)", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([
          // Token only in References, not In-Reply-To; sender matches.
          ["Sent", [candidateFixture({ inReplyTo: "<other@example.com>", references: "<orig-77@example.com>" })]],
        ]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("ambiguous_match");
    expect(kit.messagePort.updateCalls.length).toBe(0);
  });

  it("returns unknown(ambiguous_match) when the sender does not match the configured sending identity", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([
          // Direct parent token but wrong sender (alias).
          ["Sent", [candidateFixture({ from: "other@example.com" })]],
        ]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("ambiguous_match");
  });

  it("verified direct match takes precedence over an ambiguous candidate in another folder", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [
          { folder: "Sent", verified: true },
          { folder: "Other", verified: false },
        ],
        candidatesByFolder: new Map([
          // First folder ambiguous (wrong sender), second folder verified.
          ["Sent", [candidateFixture({ from: "other@example.com" })]],
          ["Other", [candidateFixture()]],
        ]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied");
    expect(result.source).toBe("sent_search");
  });

  it("returns unknown(sent_folder_unavailable) when no Sent folder is discovered (not a negative)", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [], // none
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("sent_folder_unavailable");
    expect(kit.messagePort.updateCalls.length).toBe(0);
  });

  it("returns unknown(probe_failed) — not negative — when discoverSentFolders throws", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFoldersThrow: true,
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("probe_failed");
    expect(kit.messagePort.updateCalls.length).toBe(0);
  });

  it("returns not_replied (no_reply_observed) when flag side complete and Sent search empty + persists negative", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("not_replied");
    if (result.state !== "not_replied") throw new Error("expected not_replied");
    expect(result.reasonCode).toBe("no_reply_observed");
    expect(result.coverage).toBe("configured_imap");
    // R02 two-phase negative persistence: stage the UNCONFIRMED marker
    // (one updateReplyEvidence write), then N02-conditional confirm (one
    // confirmStagedNegativeEvidence write). The stage must carry the
    // pending marker (never matchable); the confirm carries the real hash
    // for the same observation instant plus the commit-time clock.
    expect(kit.messagePort.updateCalls.length).toBe(1);
    const [staged] = kit.messagePort.updateCalls;
    expect(staged.replyNegativeCheckAt).toBeDefined();
    expect(staged.replyNegativeContextHash).toBe(PENDING_NEGATIVE_CONTEXT);
    expect(kit.messagePort.confirmCalls.length).toBe(1);
    const [confirmed] = kit.messagePort.confirmCalls;
    expect(confirmed.replyNegativeCheckAt).toEqual(
      staged.replyNegativeCheckAt
    );
    expect(confirmed.replyNegativeContextHash).toBeDefined();
    expect(confirmed.replyNegativeContextHash).not.toBe(
      PENDING_NEGATIVE_CONTEXT
    );
  });

  it("returns unknown(probe_limit_exceeded) when cap is exhausted without a settled match", async () => {
    const message = messageFixture();
    // Build 250 candidates to overflow the 200 cap.
    const many: ReplyHeaderCandidate[] = Array.from({ length: 250 }, (_, i) =>
      candidateFixture({ uid: 1000 + i, inReplyTo: "<other@example.com>", references: "" })
    );
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", many]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("probe_limit_exceeded");
    expect(kit.messagePort.updateCalls.length).toBe(0);
  });

  // D1b (adversarial finding #2): a decisive not_replied MUST NOT be returned
  // when the evidence persistence write threw — otherwise the claim-side
  // freshness fence sees a null replyNegativeCheckAt, skips, and a duplicate
  // send proceeds with zero persisted evidence. The probe must surface
  // unknown(probe_failed) instead of not_replied when persistNegative fails.
  it("returns unknown(probe_failed) — not not_replied — when persistNegative throws (D1b)", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
      updateThrows: new Error("disk full — evidence write failed"),
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown, got " + result.state);
    expect(result.reasonCode).toBe("probe_failed");
    // The write was attempted (the call reached persistNegative) but failed.
    expect(kit.messagePort.updateCalls.length).toBe(1);
  });

  // D1b mirror: persistPositive failure must NOT return a replied that lacks
  // persisted evidence (the claim-side fence reads replyDetectedAt). A verified
  // positive observation whose persistence threw stays positive in the result
  // (the observation is real) BUT the fence will catch the missing persisted
  // timestamp and refuse the send — so the probe result itself must carry
  // unknown so the upstream pre-send gate refuses. Verified-positive with a
  // failed persist therefore surfaces as unknown(probe_failed), not replied.
  it("returns unknown(probe_failed) — not replied — when persistPositive throws (D1b)", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        // A verified direct Sent match settles replied(sent_search).
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([
          ["Sent", [candidateFixture({ inReplyTo: "<orig-77@example.com>", from: "me@example.com" })]],
        ]),
      },
      updateThrows: new Error("disk full — evidence write failed"),
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown, got " + result.state);
    expect(result.reasonCode).toBe("probe_failed");
    expect(kit.messagePort.updateCalls.length).toBe(1);
  });

  // =========================================================================
  // R09 — the conditional evidence write's boolean result must be honored.
  // `updateReplyEvidence` returns false when the guarded UPDATE affected zero
  // rows: a negative write loses to a concurrent positive (another request
  // persisted `replyDetectedAt` first — the `replyDetectedAt IS NULL` guard
  // rejects the negative), and a positive write on a deleted row affects zero
  // rows. The detector must reread the row and return the CURRENT evidence
  // (or unknown), never report/caches the rejected outcome.
  // =========================================================================

  it("R09: a negative write rejected by a concurrent positive rereads and returns the CURRENT positive evidence", async () => {
    const message = messageFixture();
    // The concurrent writer: the moment the detector attempts its negative
    // write, another request persists positive evidence on the row first, so
    // the `replyDetectedAt IS NULL` guard rejects this write (0 rows → false).
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
      updateResult: (input) => {
        if (input.replyNegativeCheckAt != null) {
          // Concurrent positive lands immediately before the negative write.
          message.replyDetectedAt = new Date(1_000_000);
          message.replyDetectionSource = "sent_search";
          message.replyMatchedMessageId = "<sent-501@example.com>";
          return false; // 0 rows affected — guard rejected
        }
        return true;
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    // The rejected negative must NOT be reported as a successful not_replied.
    expect(result.state).toBe("replied");
    if (result.state !== "replied") throw new Error("expected replied, got " + result.state);
    expect(result.source).toBe("sent_search");
    expect(result.matchedMessageId).toBe("<sent-501@example.com>");
    expect(result.fromCache).toBe(false);
    // And the in-memory cache must NOT hold the rejected negative under this
    // message's cache key: a second detect call must still see the positive
    // (served from the persisted sticky-positive path), never a negative.
    const second = await kit.service.detect({ messageId: 100 });
    expect(second.state).toBe("replied");
  });

  it("R09: a negative write rejected with no positive evidence (row deleted mid-probe) surfaces unknown, never a negative", async () => {
    const message = messageFixture();
    let rowDeleted = false;
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
      updateResult: (input) => {
        if (input.replyNegativeCheckAt != null) {
          rowDeleted = true; // the message store lost the row mid-probe
          return false;
        }
        return true;
      },
      readReturnsNull: () => rowDeleted,
    });

    const result = await kit.service.detect({ messageId: 100 });

    // The reread finds no row — the detector cannot claim a decisive negative
    // on a write it did not land. Truthful outcome: unknown.
    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown, got " + result.state);
    expect(result.reasonCode).toBe("probe_failed");
  });

  it("R09: a positive write rejected because the row was deleted surfaces unknown(probe_failed), never replied", async () => {
    const message = messageFixture();
    let rowDeleted = false;
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
      },
      imapOptions: {
        // A verified direct Sent match settles replied(sent_search).
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([
          ["Sent", [candidateFixture({ inReplyTo: "<orig-77@example.com>", from: "me@example.com" })]],
        ]),
      },
      updateResult: (input) => {
        if (input.replyDetectedAt != null) {
          rowDeleted = true;
          return false; // positive write affected 0 rows — row gone
        }
        return true;
      },
      readReturnsNull: () => rowDeleted,
    });

    const result = await kit.service.detect({ messageId: 100 });

    // A replied result with zero persisted evidence would defeat the
    // no-duplicate-reply guarantee (the claim fence fail-closes on a null
    // replyDetectedAt, but the upstream pre-send gate trusts the probe's
    // state). The truthful outcome is unknown(probe_failed).
    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown, got " + result.state);
    expect(result.reasonCode).toBe("probe_failed");
  });
});

// ===========================================================================
// §7.1 step 7 — context-change during I/O → negative not stored.
// ===========================================================================

describe("EmailReplyDetectionService — context-change guard (§7.1 step 7)", () => {
  it("returns unknown(identity_conflict) and does NOT persist a negative when the account is reconfigured mid-probe", async () => {
    const message = messageFixture();
    const reconfigured: EmailReceiveConnectionConfig = {
      emailServiceId: 5,
      protocol: "imap",
      host: "imap.different.example.com", // host changed
      port: 993,
      ssl: true,
      username: "me@example.com",
      password: "secret-pw-2",
      folder: "INBOX",
    };
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
        reconfiguredConfig: reconfigured,
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("identity_conflict");
    // The negative MUST NOT have been persisted.
    expect(kit.messagePort.updateCalls.length).toBe(0);
    // The post-probe re-read happened.
    expect(kit.emailServicePort.callCount).toBeGreaterThanOrEqual(2);
  });

  it("returns unknown(identity_conflict) when the config vanishes mid-probe", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
        reconfiguredConfig: null, // account disabled/deleted during I/O
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("identity_conflict");
    expect(kit.messagePort.updateCalls.length).toBe(0);
  });

  // R10 — the closing fence rereads the CONFIG but hashed with the ORIGINAL
  // configuredSender; a mid-probe readIdentity().fromAddress change (same
  // receive host/login) was invisible, so the negative was checked against
  // the old sender and persisted. The fence must reread the identity too.
  it("returns unknown(identity_conflict) and does NOT persist a negative when only the configured sender changes mid-probe (R10)", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(), // receive host/login/port UNCHANGED
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
        reconfiguredIdentity: {
          smtpUsername: "me@example.com",
          fromAddress: "newme@example.com", // only the configured From changed
          replyToAddress: null,
          receiveUsername: "me@example.com",
        },
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("identity_conflict");
    // The negative MUST NOT have been persisted or reported.
    expect(kit.messagePort.updateCalls.length).toBe(0);
    // The fence reread the identity (fresh probe: initial read + fence read).
    expect(kit.emailServicePort.identityCallCount).toBeGreaterThanOrEqual(2);

    // The unknown is never cached — a second detect re-probes (mailbox I/O
    // happens again) instead of serving the rejected negative from memory.
    await kit.service.detect({ messageId: 100 });
    expect(kit.imapPort.refreshCalls.length).toBe(2);
  });

  it("returns unknown(identity_conflict) when the sender identity vanishes mid-probe (R10)", async () => {
    const message = messageFixture();
    const kit = buildServiceKit({
      message,
      emailServiceOptions: {
        config: imapConfig(),
        identity: { smtpUsername: "me@example.com", fromAddress: "me@example.com", replyToAddress: null, receiveUsername: "me@example.com" },
        reconfiguredIdentity: null, // identity row deleted during I/O
      },
      imapOptions: {
        flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\seen"], checkedAt: new Date(1_000_000) },
        sentFolders: [{ folder: "Sent", verified: true }],
        candidatesByFolder: new Map([["Sent", []]]),
      },
    });

    const result = await kit.service.detect({ messageId: 100 });

    expect(result.state).toBe("unknown");
    if (result.state !== "unknown") throw new Error("expected unknown");
    expect(result.reasonCode).toBe("identity_conflict");
    expect(kit.messagePort.updateCalls.length).toBe(0);
  });
});

// ===========================================================================
// §4.2 DTO wrapper (FR-032) — checkReply maps to snake_case DTO.
// ===========================================================================

describe("EmailReplyDetectionService.checkReply — DTO wrapper (§4.2)", () => {
  it("maps a replied result to the snake_case DTO", async () => {
    const message = messageFixture({ replyStatus: "sent" });
    const kit = buildServiceKit({
      message,
      emailServiceOptions: { config: imapConfig(), identity: null },
    });

    const dto = await kit.service.checkReply({ messageId: 100 });

    expect(dto.success).toBe(true);
    expect(dto.result).toBeDefined();
    if (!dto.result) throw new Error("expected result");
    expect(dto.result.message_id).toBe(100);
    expect(dto.result.state).toBe("replied");
    expect(dto.result.replied).toBe(true);
    expect(dto.result.source).toBe("local_state");
    expect(dto.result.reason_code).toBe("already_replied");
    expect(dto.result.from_cache).toBe(true);
    expect(dto.result.coverage).toBe("local_only");
    // No secrets ever leak into the DTO.
    expect(JSON.stringify(dto.result)).not.toContain("secret");
    expect(JSON.stringify(dto.result)).not.toContain("password");
  });

  it("maps an unknown result with replied: null", async () => {
    const message = messageFixture({ normalizedMessageId: null, messageId: null });
    const kit = buildServiceKit({
      message,
      emailServiceOptions: { config: imapConfig(), identity: null },
    });

    const dto = await kit.service.checkReply({ messageId: 100 });

    expect(dto.success).toBe(true);
    if (!dto.result) throw new Error("expected result");
    expect(dto.result.state).toBe("unknown");
    expect(dto.result.replied).toBe(null);
    expect(dto.result.reason_code).toBe("missing_message_id");
  });

  it("returns success:false with a sanitized error when detect throws", async () => {
    // Force a throw by making findCanonicalEquivalents reject. We build a
    // one-off message port that throws on read; the message fixture is
    // irrelevant because read() rejects before it is consulted.
    const throwingPort: ReplyDetectionMessagePort = {
      async read() {
        throw new Error("db connection lost");
      },
      async findCanonicalEquivalents() {
        return [];
      },
      async updateReplyEvidence() {
        return true;
      },
      async confirmStagedNegativeEvidence() {
        return true;
      },
    };
    const service = new EmailReplyDetectionService({
      messagePort: throwingPort,
      draftPort: fakeDraftPort(new Map()),
      attemptPort: fakeAttemptPort(new Map()),
      emailServicePort: fakeEmailServicePort({ config: imapConfig(), identity: null }),
      imapPort: fakeImapPort(),
      now: () => 1_000_000,
    });

    const dto = await service.checkReply({ messageId: 100 });

    expect(dto.success).toBe(false);
    expect(dto.error).toContain("db connection lost");
    expect(dto.result).toBeUndefined();
    // No stack trace leaked.
    expect(dto.error).not.toContain("at ");
  });
});

// ===========================================================================
// Detector version constant.
// ===========================================================================

describe("REPLY_DETECTOR_VERSION", () => {
  it("is a stable, low-cardinality string stamped into the context hash", () => {
    // v2 (G01/N04): negative-persistence semantics changed (expiry-fenced
    // writes + observation-time stamping), so pre-v2 persisted negatives are
    // invalidated by hash mismatch and re-probed fail-closed.
    expect(REPLY_DETECTOR_VERSION).toBe("reply-detection-v2");
    expect(REPLY_DETECTOR_VERSION.length).toBeLessThan(40);
  });
});
