import { describe, it, expect, vi } from "vitest";

// Mock electron + Logger BEFORE the import so the lazy default-port getters
// never reach the real ipcMain / BaseModule (TDZ under vi.mock). Pattern
// matches EmailReplyDetectionService.test.ts.
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
import type {
  RefreshedFlags,
  ReplyHeaderCandidate,
  SentFolder,
} from "@/service/emailReceive/EmailReceiveClient";
import {
  EmailReplyDetectionService,
  type ReplyDetectionMessagePort,
  type ReplyDetectionDraftPort,
  type ReplyDetectionAttemptPort,
  type ReplyDetectionEmailServicePort,
  type ReplyDetectionImapPort,
} from "@/service/emailReceive/EmailReplyDetectionService";

/**
 * T05 step 10 (FR-031/FR-037 §7.3) — the in-memory detection cache,
 * single-flight, the 15s probe deadline, and context-hash invalidation.
 *
 * The persisted negative cache (Step 3's `replyNegativeCheckAt`/
 * `replyNegativeContextHash` columns) covers cross-process/cross-restart
 * reuse; this layer coalesces concurrent calls within one process. Proves:
 * negative reused within 60s; negative expired → fresh probe; positive sticky
 * across calls; `forceRefresh` skips the negative cache but honors sticky
 * positive; single-flight joins a live probe for the same context; a second
 * mailbox probe does NOT block a different mailbox; deadline exceeded →
 * probe_timeout + late result discarded; config change invalidates the
 * negative; identity change with a cached positive → identity_conflict.
 */

const ORIGINAL_ID = "<orig-77@example.com>";
const SENDER = "me@example.com";

function messageFixture(
  overrides: Partial<EmailReceivedMessageEntity> = {}
): EmailReceivedMessageEntity {
  const e = new EmailReceivedMessageEntity();
  e.id = 100;
  e.emailServiceId = 5;
  e.providerUid = "imap:aaaaaaaaaaaaaaaa:424242:77";
  e.messageId = ORIGINAL_ID;
  e.normalizedMessageId = ORIGINAL_ID;
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

function imapConfig(
  overrides: Partial<EmailReceiveConnectionConfig> = {}
): EmailReceiveConnectionConfig {
  return {
    emailServiceId: 5,
    protocol: "imap",
    host: "imap.example.com",
    port: 993,
    ssl: true,
    username: SENDER,
    password: "secret-pw",
    folder: "INBOX",
    ...overrides,
  };
}

function defaultIdentity() {
  return {
    smtpUsername: SENDER,
    fromAddress: SENDER,
    replyToAddress: null,
    receiveUsername: SENDER,
  };
}

interface FakeImapOptions {
  flags?: RefreshedFlags | null;
  sentFolders?: SentFolder[];
  candidatesByFolder?: Map<string, ReplyHeaderCandidate[] | false>;
}

interface FakeKit {
  service: EmailReplyDetectionService;
  messagePort: ReplyDetectionMessagePort & {
    updateCalls: Array<Record<string, unknown>>;
  };
  emailServicePort: ReplyDetectionEmailServicePort & {
    callCount: number;
    setConfig: (c: EmailReceiveConnectionConfig | null) => void;
    setIdentity: (i: ReturnType<typeof defaultIdentity> | null) => void;
  };
  imapPort: ReplyDetectionImapPort & {
    refreshCalls: Array<{ folder: string; uid: string }>;
    searchCalls: Array<{ folder: string; originalMessageId: string }>;
    discoverCalls: number;
  };
}

/**
 * Build a kit with a controllable clock. The clock advances manually so the
 * cache TTL (60s) and deadline (15s) are deterministic — no real timers.
 */
function buildKit(opts: {
  message: EmailReceivedMessageEntity;
  config?: EmailReceiveConnectionConfig;
  identity?: ReturnType<typeof defaultIdentity> | null;
  imap?: FakeImapOptions;
  now?: () => number;
}): FakeKit {
  const updateCalls: Array<Record<string, unknown>> = [];
  const messagePort: ReplyDetectionMessagePort & {
    updateCalls: Array<Record<string, unknown>>;
  } = {
    async read(id) {
      return id === opts.message.id ? opts.message : null;
    },
    async findCanonicalEquivalents() {
      return [opts.message];
    },
    async updateReplyEvidence(input) {
      updateCalls.push(input);
      return true;
    },
    updateCalls,
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
  let currentConfig: EmailReceiveConnectionConfig | null =
    opts.config ?? imapConfig();
  let currentIdentity: ReturnType<typeof defaultIdentity> | null =
    opts.identity ?? defaultIdentity();
  const emailServicePort: ReplyDetectionEmailServicePort & {
    callCount: number;
    setConfig: (c: EmailReceiveConnectionConfig | null) => void;
    setIdentity: (i: ReturnType<typeof defaultIdentity> | null) => void;
  } = {
    callCount: 0,
    async getEmailServiceReceiveConfig() {
      this.callCount += 1;
      return currentConfig;
    },
    async readIdentity() {
      return currentIdentity;
    },
    setConfig(c) {
      currentConfig = c;
    },
    setIdentity(i) {
      currentIdentity = i;
    },
  } as ReplyDetectionEmailServicePort & {
    callCount: number;
    setConfig: (c: EmailReceiveConnectionConfig | null) => void;
    setIdentity: (i: ReturnType<typeof defaultIdentity> | null) => void;
  };
  const refreshCalls: Array<{ folder: string; uid: string }> = [];
  const searchCalls: Array<{
    folder: string;
    originalMessageId: string;
  }> = [];
  let discoverCalls = 0;
  const imap: FakeImapOptions = opts.imap ?? {};
  const imapPort: ReplyDetectionImapPort & {
    refreshCalls: Array<{ folder: string; uid: string }>;
    searchCalls: Array<{ folder: string; originalMessageId: string }>;
    discoverCalls: number;
  } = {
    refreshCalls,
    searchCalls,
    get discoverCalls() {
      return discoverCalls;
    },
    async refreshMessageFlags(input) {
      refreshCalls.push({ folder: input.folder, uid: input.uid });
      return imap.flags ?? null;
    },
    async discoverSentFolders() {
      discoverCalls += 1;
      return imap.sentFolders ?? [];
    },
    async searchReplyHeaders(input) {
      searchCalls.push({
        folder: input.folder,
        originalMessageId: input.originalMessageId,
      });
      const v = imap.candidatesByFolder?.get(input.folder);
      if (v === false) return false;
      return v ?? [];
    },
  };
  const service = new EmailReplyDetectionService({
    messagePort,
    draftPort,
    attemptPort,
    emailServicePort,
    imapPort,
    now: opts.now,
  });
  return { service, messagePort, emailServicePort, imapPort };
}

/** A clock you can advance by hand — deterministic TTL/deadline tests. */
function manualClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** A clean negative: source present + not answered + Sent search complete. */
function cleanNegativeImap(): FakeImapOptions {
  return {
    flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\Seen"], checkedAt: new Date() },
    sentFolders: [{ folder: "Sent", verified: true }],
    candidatesByFolder: new Map([["Sent", []]]),
  };
}

/** A verified Sent direct match → replied(sent_search). */
function sentMatchImap(): FakeImapOptions {
  return {
    flags: { uid: "77", isAnswered: false, isSeen: true, flags: ["\\Seen"], checkedAt: new Date() },
    sentFolders: [{ folder: "Sent", verified: true }],
    candidatesByFolder: new Map([
      [
        "Sent",
        [
          {
            folder: "Sent",
            uid: 501,
            messageId: "<sent-501@example.com>",
            inReplyTo: ORIGINAL_ID,
            references: ORIGINAL_ID,
            from: SENDER,
            to: "prospect@example.com",
            date: "2026-10-05T11:00:00Z",
          },
        ],
      ],
    ]),
  };
}

// ===========================================================================
// In-memory negative cache.
// ===========================================================================

describe("EmailReplyDetection cache (T05 step 10, §7.3)", () => {
  it("negative reused within 60s — second call does NOT re-probe", async () => {
    const clock = manualClock();
    const message = messageFixture();
    const kit = buildKit({
      message,
      imap: cleanNegativeImap(),
      now: clock.now,
    });

    const r1 = await kit.service.detect({ messageId: message.id });
    expect(r1.state).toBe("not_replied");
    expect(r1.fromCache).toBe(false);
    const probes1 = kit.imapPort.discoverCalls;

    // Same context, 30s later — within the 60s TTL.
    clock.advance(30_000);
    const r2 = await kit.service.detect({ messageId: message.id });
    expect(r2.state).toBe("not_replied");
    expect(r2.fromCache).toBe(true);
    // No new mailbox probe — cache hit.
    expect(kit.imapPort.discoverCalls).toBe(probes1);
  });

  it("negative expired after 60s → fresh probe", async () => {
    const clock = manualClock();
    const message = messageFixture();
    const kit = buildKit({
      message,
      imap: cleanNegativeImap(),
      now: clock.now,
    });

    await kit.service.detect({ messageId: message.id });
    const probes1 = kit.imapPort.discoverCalls;

    // 61s later — past the 60s TTL.
    clock.advance(61_000);
    const r2 = await kit.service.detect({ messageId: message.id });
    expect(r2.state).toBe("not_replied");
    expect(r2.fromCache).toBe(false);
    expect(kit.imapPort.discoverCalls).toBe(probes1 + 1);
  });

  it("positive sticky across calls — no expiry, no re-probe", async () => {
    const clock = manualClock();
    const message = messageFixture();
    const kit = buildKit({
      message,
      imap: sentMatchImap(),
      now: clock.now,
    });

    const r1 = await kit.service.detect({ messageId: message.id });
    expect(r1.state).toBe("replied");
    const probes1 = kit.imapPort.discoverCalls;

    // Far future — positive is sticky (no expiry).
    clock.advance(86_400_000);
    const r2 = await kit.service.detect({ messageId: message.id });
    expect(r2.state).toBe("replied");
    expect(r2.fromCache).toBe(true);
    expect(kit.imapPort.discoverCalls).toBe(probes1);
  });

  it("forceRefresh skips the negative cache — re-probes even within 60s", async () => {
    const clock = manualClock();
    const message = messageFixture();
    const kit = buildKit({
      message,
      imap: cleanNegativeImap(),
      now: clock.now,
    });

    await kit.service.detect({ messageId: message.id });
    const probes1 = kit.imapPort.discoverCalls;

    clock.advance(5_000); // well within 60s
    const r2 = await kit.service.detect({
      messageId: message.id,
      forceRefresh: true,
    });
    expect(r2.state).toBe("not_replied");
    expect(r2.fromCache).toBe(false);
    // forceRefresh skipped the negative cache → fresh probe.
    expect(kit.imapPort.discoverCalls).toBe(probes1 + 1);
  });

  it("forceRefresh still honors a sticky positive — known positive short-circuits", async () => {
    const clock = manualClock();
    const message = messageFixture();
    const kit = buildKit({
      message,
      imap: sentMatchImap(),
      now: clock.now,
    });

    await kit.service.detect({ messageId: message.id });
    const probes1 = kit.imapPort.discoverCalls;

    clock.advance(5_000);
    const r2 = await kit.service.detect({
      messageId: message.id,
      forceRefresh: true,
    });
    expect(r2.state).toBe("replied");
    expect(r2.fromCache).toBe(true);
    expect(kit.imapPort.discoverCalls).toBe(probes1); // sticky positive, no re-probe
  });

  // -----------------------------------------------------------------------
  // Single-flight.
  // -----------------------------------------------------------------------

  it("single-flight: concurrent calls for the same message join ONE probe", async () => {
    const clock = manualClock();
    const message = messageFixture();
    // A slow Sent-folder discovery so both calls overlap in-flight.
    let resolveDiscover: () => void;
    const discoverPromise = new Promise<void>(
      (resolve) => (resolveDiscover = resolve)
    );
    const kit = buildKit({
      message,
      imap: cleanNegativeImap(),
      now: clock.now,
    });
    const originalDiscover = kit.imapPort.discoverSentFolders;
    kit.imapPort.discoverSentFolders = async (config) => {
      await discoverPromise;
      return originalDiscover.call(kit.imapPort, config);
    };

    const p1 = kit.service.detect({ messageId: message.id });
    const p2 = kit.service.detect({ messageId: message.id });
    // Let the microtask queue settle so the first probe has entered flight.
    await Promise.resolve();
    resolveDiscover!();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.state).toBe("not_replied");
    expect(r2.state).toBe("not_replied");
    // One probe served both calls (single-flight join).
    expect(kit.imapPort.discoverCalls).toBe(1);
  });

  it("second mailbox probe does NOT block a different mailbox", async () => {
    const clock = manualClock();
    const messageA = messageFixture({ id: 100, emailServiceId: 5 });
    const messageB = messageFixture({
      id: 200,
      emailServiceId: 6,
      providerUid: "imap:bbbbbbbbbbbbbbbb:424242:88",
    });
    let resolveA: () => void;
    const blockA = new Promise<void>((resolve) => (resolveA = resolve));
    const kitA = buildKit({
      message: messageA,
      imap: cleanNegativeImap(),
      now: clock.now,
    });
    const origDiscoverA = kitA.imapPort.discoverSentFolders;
    kitA.imapPort.discoverSentFolders = async (config) => {
      await blockA;
      return origDiscoverA.call(kitA.imapPort, config);
    };

    const kitB = buildKit({
      message: messageB,
      config: imapConfig({
        emailServiceId: 6,
        username: "other@example.com",
      }),
      imap: cleanNegativeImap(),
      now: clock.now,
    });

    const pA = kitA.service.detect({ messageId: messageA.id });
    // Let A enter flight.
    await Promise.resolve();
    // B is a different mailbox — must NOT wait behind A.
    const rB = await kitB.service.detect({ messageId: messageB.id });
    expect(rB.state).toBe("not_replied");
    resolveA!();
    const rA = await pA;
    expect(rA.state).toBe("not_replied");
  });

  // -----------------------------------------------------------------------
  // 15s deadline.
  // -----------------------------------------------------------------------
  //
  // The deadline racer arms a REAL setTimeout(fn, Math.max(1, remainingMs()))
  // where remainingMs is computed from `this.now`. We use vitest fake timers
  // (scoped to this test only) so advancing timers past 15s fires the racer
  // deterministically — no 15s wall-clock wait. The service's `now` defaults to
  // Date.now under fake timers, so the deadline budget tracks the fake clock.

  it("deadline exceeded (slow probe) → probe_timeout, late result discarded", async () => {
    // Fake timers control both Date.now (the service's default clock) and
    // setTimeout (the deadline racer). Advancing past 15s fires the racer
    // deterministically — no 15s wall-clock wait. The probe blocks on a
    // promise we control so it never resolves until we release it.
    vi.useFakeTimers();
    try {
      const message = messageFixture();
      let resolveDiscover: () => void;
      const block = new Promise<void>(
        (resolve) => (resolveDiscover = resolve)
      );
      const kit = buildKit({
        message,
        imap: cleanNegativeImap(),
      });
      const origDiscover = kit.imapPort.discoverSentFolders;
      kit.imapPort.discoverSentFolders = async (config) => {
        await block;
        return origDiscover.call(kit.imapPort, config);
      };

      // Start the probe; it blocks on the unresolved discover promise. The
      // 15s deadline setTimeout is armed inside raceProbeAgainstDeadline.
      const probeP = kit.service.detect({ messageId: message.id });
      // Let the probe enter flight + the racer arm its setTimeout. Under fake
      // timers we must drain microtasks asynchronously (advanceTimersByTimeAsync
      // both advances the clock and flushes the microtask queue).
      await vi.advanceTimersByTimeAsync(0);
      // Advance past the 15s deadline — the racer fires and resolves with
      // probe_timeout (winning the race against the blocked probe).
      await vi.advanceTimersByTimeAsync(16_000);

      const r = await probeP;
      expect(r.state).toBe("unknown");
      expect(r.reasonCode).toBe("probe_timeout");

      // Release the slow probe. Its eventual resolution is discarded by
      // Promise.race — it must NOT be cached (probe_timeout is unknown-state,
      // and the late value is discarded anyway). Drain the late probe's
      // microtasks so its discarded resolution settles quietly.
      resolveDiscover!();
      await vi.advanceTimersByTimeAsync(0);
      // The late probe incremented discoverCalls when it resolved; capture
      // the post-late count so the follow-up assertion is against THAT.
      const probesBefore = kit.imapPort.discoverCalls;
      // probe_timeout was NOT cached (unknown-state), so a follow-up call
      // re-probes immediately — no 60s wait needed. Advance the clock a tick
      // to be safe and re-detect.
      await vi.advanceTimersByTimeAsync(1_000);
      const r2 = await kit.service.detect({ messageId: message.id });
      expect(r2.state).toBe("not_replied");
      // A fresh probe ran — the late result was not cached as a negative.
      expect(kit.imapPort.discoverCalls).toBeGreaterThan(probesBefore);
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  // -----------------------------------------------------------------------
  // Context-hash invalidation.
  // -----------------------------------------------------------------------

  it("config change (account endpoint) invalidates the in-memory negative", async () => {
    const clock = manualClock();
    const message = messageFixture();
    const kit = buildKit({
      message,
      imap: cleanNegativeImap(),
      now: clock.now,
    });

    await kit.service.detect({ messageId: message.id });
    const probes1 = kit.imapPort.discoverCalls;

    // 5s later (within 60s TTL) but the account host changed → context hash
    // mismatch → the cached negative does not apply → fresh probe under the
    // NEW context.
    clock.advance(5_000);
    kit.emailServicePort.setConfig(
      imapConfig({ host: "imap.different.example.com" })
    );
    const r2 = await kit.service.detect({ messageId: message.id });
    expect(r2.state).toBe("not_replied");
    expect(r2.fromCache).toBe(false);
    expect(kit.imapPort.discoverCalls).toBe(probes1 + 1);
  });

  it("identity change (configured sender) invalidates the in-memory negative", async () => {
    const clock = manualClock();
    const message = messageFixture();
    const kit = buildKit({
      message,
      imap: cleanNegativeImap(),
      now: clock.now,
    });

    await kit.service.detect({ messageId: message.id });
    const probes1 = kit.imapPort.discoverCalls;

    // 5s later (within 60s TTL), same account endpoint, but the configured
    // sender changed (alias added). The context hash incorporates
    // `configuredSender`, so the cache key differs → no negative reuse → a
    // fresh probe runs under the new identity.
    clock.advance(5_000);
    kit.emailServicePort.setIdentity({
      smtpUsername: SENDER,
      fromAddress: "alias@example.com",
      replyToAddress: null,
      receiveUsername: SENDER,
    });
    const r2 = await kit.service.detect({ messageId: message.id });
    expect(r2.state).toBe("not_replied");
    expect(r2.fromCache).toBe(false);
    expect(kit.imapPort.discoverCalls).toBe(probes1 + 1);
  });
});
