import { describe, expect, it, vi } from "vitest";

import {
  ManagedBrowserModule,
  type ManagedBrowserModuleDeps,
} from "@/modules/ManagedBrowserModule";
import type { ManagedBrowserCacheCoordinator } from "@/modules/ManagedBrowserCacheModule";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";
import {
  ManagedBrowserLeaseService,
  type AcquireLeaseResult,
} from "@/service/ManagedBrowserLeaseService";
import { ManagedBrowserSupervisor } from "@/service/ManagedBrowserSupervisor";
import {
  ManagedBrowserWorkerClient,
  type OutboundEvent,
  type WorkerClientDeps,
  type WorkerRequestEnvelope,
} from "@/service/ManagedBrowserWorkerClient";
import type { ManagedBrowserOutboundMessage } from "@/schemas/worker/managedBrowser";
import type { NormalizedCookie } from "@/schemas/accountCookies";
import type {
  BrowserChatNoticeType,
  EffectiveManagedBrowserSettings,
  SafeBrowserChatNotice,
  SafeManagedBrowserStatus,
  WorkerBrowserStoragePolicy,
} from "@/entityTypes/managedBrowserTypes";
import type { ExecutableResolutionResult } from "@/childprocess/managed-browser/BrowserExecutableResolver";

/**
 * ManagedBrowserModule orchestration tests. All collaborators are DI fakes —
 * no DB, no utility process. The assertions focus on the security-critical
 * ordering (gates before secret access), the cookie bridge, lease lifecycle,
 * and notice publication.
 */

const ACCOUNT_ID = 101;
const DESCRIPTOR = {
  path: "/fake/chrome",
  source: "managed" as const,
  product: "chrome" as const,
  version: "120.0.6099.109",
  majorVersion: 120,
  architecture: "x64",
};

const SNAPSHOT_COOKIES: NormalizedCookie[] = [
  {
    domain: "youtube.com",
    path: "/",
    name: "SID",
    value: "yt-secret",
    secure: true,
    httpOnly: true,
  },
  {
    domain: "accounts.google.com",
    path: "/",
    name: "SAPISID",
    value: "google-secret",
    secure: true,
    httpOnly: true,
  },
  {
    domain: "evil.example",
    path: "/",
    name: "SID",
    value: "attacker-cookie",
    secure: false,
    httpOnly: false,
  },
];

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeLease {
  public readonly acquireCalls: Array<
    [number, { sessionId: string; ownerConversationId: string | null }]
  > = [];
  public readonly releaseCalls: Array<[number, string, string]> = [];
  public next: AcquireLeaseResult = {
    status: "granted",
    leaseToken: "lease-1",
  };

  public acquire(
    accountId: number,
    opts: { sessionId: string; ownerConversationId: string | null }
  ): AcquireLeaseResult {
    this.acquireCalls.push([accountId, opts]);
    return this.next;
  }

  public release(
    accountId: number,
    sessionId: string,
    token: string
  ): "released" {
    this.releaseCalls.push([accountId, sessionId, token]);
    return "released";
  }
}

interface RegisteredInit {
  sessionId: string;
  accountId: number;
  releaseLease: () => void;
  onTerminal: (sessionId: string, cause: string) => void;
}

class FakeSupervisor {
  public readonly registered: RegisteredInit[] = [];
  public readonly terminalCalls: Array<[string, string]> = [];
  private readonly terminated = new Set<string>();

  public register(init: RegisteredInit): void {
    this.registered.push(init);
  }

  /** Mirrors the real supervisor: releaseLease() then onTerminal(), once. */
  public handleTerminal(sessionId: string, cause: string): void {
    this.terminalCalls.push([sessionId, cause]);
    if (this.terminated.has(sessionId)) {
      return;
    }
    this.terminated.add(sessionId);
    const init = this.registered.find((r) => r.sessionId === sessionId);
    if (!init) {
      return;
    }
    init.releaseLease();
    init.onTerminal(sessionId, cause);
  }
}

type ReplyFn = (env: WorkerRequestEnvelope) => ManagedBrowserOutboundMessage;

let replySequence = 0;

function replyBase(sessionId: string): Record<string, unknown> {
  replySequence += 1;
  return {
    protocolVersion: 1,
    sessionId,
    requestId: `req-fake-${replySequence}`,
    sequence: replySequence,
  };
}

function sessionReadyReply(sessionId: string): ManagedBrowserOutboundMessage {
  return {
    ...replyBase(sessionId),
    type: "SESSION_READY",
    fingerprintResult: "pass",
    fingerprintReasonCodes: [],
    appliedCookieCount: 2,
    rejectedCookieCount: 0,
    assessment: { state: "authenticated", evidenceCodes: ["api_ready"] },
    identity: {
      sessionId,
      sessionNonce: "nonce-fake-12345678",
      workerPid: 111,
      browserPid: 222,
      executableSha256: "a".repeat(64),
      executableVersion: DESCRIPTOR.version,
      launchedAtEpochMs: 1_700_000_000_000,
    },
  } as unknown as ManagedBrowserOutboundMessage;
}

function loginRequiredReply(sessionId: string): ManagedBrowserOutboundMessage {
  return {
    ...replyBase(sessionId),
    type: "LOGIN_REQUIRED",
    reasonCode: "session_cookies_missing",
  } as unknown as ManagedBrowserOutboundMessage;
}

function stateChangedReply(
  sessionId: string,
  state: string,
  reasonCode: string | null
): ManagedBrowserOutboundMessage {
  return {
    ...replyBase(sessionId),
    type: "SESSION_STATE_CHANGED",
    state,
    reasonCode,
  } as unknown as ManagedBrowserOutboundMessage;
}

class FakeWorkerClient {
  public readonly sent: WorkerRequestEnvelope[] = [];
  public readonly deps: WorkerClientDeps;
  private readonly script: Map<string, ReplyFn>;

  public constructor(
    deps: WorkerClientDeps,
    script: Record<string, ReplyFn> = {}
  ) {
    this.deps = deps;
    this.script = new Map(
      Object.entries({
        START_SESSION: () => sessionReadyReply(deps.sessionId),
        VERIFY_MANUAL_LOGIN: () =>
          stateChangedReply(deps.sessionId, "ready", "manual_login_verified"),
        OBSERVE: () =>
          ({
            ...replyBase(deps.sessionId),
            type: "OBSERVATION_RESULT",
            observation: {
              sessionId: deps.sessionId,
              pageRevision: 1,
              url: "https://www.youtube.com/",
              origin: "https://www.youtube.com",
              title: "YouTube",
              state: "ready",
              elements: [],
              visibleText: "",
              notices: [{ code: "untrusted_content" }],
              truncated: false,
            },
          } as unknown as ManagedBrowserOutboundMessage),
        BEGIN_HANDOFF: () =>
          stateChangedReply(deps.sessionId, "handoff", "user_requested"),
        RESUME_HANDOFF: () =>
          stateChangedReply(deps.sessionId, "ready", "resumed"),
        ...script,
      })
    );
  }

  public async start(): Promise<void> {
    /* fake worker boots instantly */
  }

  public async request(
    message: WorkerRequestEnvelope
  ): Promise<ManagedBrowserOutboundMessage> {
    this.sent.push(message);
    const reply = this.script.get(message.type);
    if (!reply) {
      throw new Error("worker_request_timeout");
    }
    return reply(message);
  }

  public async stop(): Promise<string> {
    return "user_stop";
  }

  public async cleanup(): Promise<string> {
    return "cleanup";
  }
}

interface PersistCall {
  accountId: number;
  cookies: unknown[];
  source: "worker_refresh";
  partitionPath: string;
}

/** Records every coordinator call; policy results are settable per test. */
class FakeCacheCoordinator implements ManagedBrowserCacheCoordinator {
  public readonly opened: Array<{
    sessionId: string;
    accountId: number;
    scopeToken: string;
    namespace: string;
  }> = [];
  public readonly released: string[] = [];
  public readonly terminals: string[] = [];
  public readonly policyCalls: Array<[number, number, boolean]> = [];
  public nextPolicy: WorkerBrowserStoragePolicy["persistentCache"] = {
    enabled: false,
    reasonCode: "fake_disabled",
  };
  public failPolicy = false;

  public async buildPersistentCachePolicy(
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ): Promise<WorkerBrowserStoragePolicy["persistentCache"]> {
    this.policyCalls.push([accountId, chromeMajor, cacheEnabled]);
    if (this.failPolicy) {
      throw new Error("scope ladder exploded");
    }
    return this.nextPolicy;
  }

  public onCacheOpened(input: {
    sessionId: string;
    accountId: number;
    scopeToken: string;
    namespace: string;
  }): void {
    this.opened.push(input);
  }

  public onCacheReleased(sessionId: string): void {
    this.released.push(sessionId);
  }

  public onSessionTerminal(sessionId: string): void {
    this.terminals.push(sessionId);
  }
}

interface Harness {
  module: ManagedBrowserModule;
  lease: FakeLease;
  supervisor: FakeSupervisor;
  clients: FakeWorkerClient[];
  cache: FakeCacheCoordinator;
  notices: SafeBrowserChatNotice[];
  statuses: SafeManagedBrowserStatus[];
  persistCalls: PersistCall[];
  lookupCalls: number[];
  accountLookup: () => Promise<{
    platformId: number;
    accountLabel: string;
  } | null>;
}

function makeHarness(
  overrides: {
    settings?: Partial<EffectiveManagedBrowserSettings>;
    startScript?: Record<string, ReplyFn>;
    persistSnapshot?: (input: PersistCall) => Promise<void>;
    nextLease?: AcquireLeaseResult;
    executableResolution?: ExecutableResolutionResult;
    accountLookup?: (
      accountId: number
    ) => Promise<{ platformId: number; accountLabel: string } | null>;
    isAiEnabled?: () => boolean;
    cache?: FakeCacheCoordinator;
    resolveCachePolicy?: ManagedBrowserModuleDeps["resolveCachePolicy"];
    useDefaultCachePolicy?: boolean;
  } = {}
): Harness {
  const lease = new FakeLease();
  lease.next = overrides.nextLease ?? {
    status: "granted",
    leaseToken: "lease-1",
  };
  const supervisor = new FakeSupervisor();
  const cache = overrides.cache ?? new FakeCacheCoordinator();
  const notices: SafeBrowserChatNotice[] = [];
  const statuses: SafeManagedBrowserStatus[] = [];
  const clients: FakeWorkerClient[] = [];
  const persistCalls: PersistCall[] = [];
  const lookupCalls: number[] = [];
  const defaultAccountLookup = async (
    accountId: number
  ): Promise<{ platformId: number; accountLabel: string } | null> => {
    lookupCalls.push(accountId);
    return { platformId: 2, accountLabel: "My Channel" };
  };
  const settings: EffectiveManagedBrowserSettings = {
    browserEnabled: true,
    cacheEnabled: true,
    cacheMaxBytes: 500 * 1024 * 1024,
    clearCacheOnExit: true,
    disabledReasonCode: null,
    ...overrides.settings,
  };
  const module = new ManagedBrowserModule({
    settings: {
      getEffectiveSettings: async () => settings,
    } as unknown as ManagedBrowserSettingsModule,
    leaseService: lease as unknown as ManagedBrowserLeaseService,
    supervisor: supervisor as unknown as ManagedBrowserSupervisor,
    noticeSink: (notice) => notices.push(notice),
    emitStatus: (status) => statuses.push(status),
    accountLookup: overrides.accountLookup ?? defaultAccountLookup,
    sessionService: {
      getDecryptedSnapshot: async () => ({
        cookies: [...SNAPSHOT_COOKIES],
        status: "valid",
      }),
      getOrCreatePartition: async () => "/partitions/acc-101",
      persistSnapshot: overrides.persistSnapshot
        ? async (input: PersistCall) => {
            await overrides.persistSnapshot?.(input);
          }
        : async (input: PersistCall) => {
            persistCalls.push(input);
          },
    },
    workerClientFactory: (deps) => {
      const client = new FakeWorkerClient(deps, overrides.startScript);
      clients.push(client);
      return client as unknown as ManagedBrowserWorkerClient;
    },
    executableResolver: {
      resolve: () =>
        overrides.executableResolution ?? { descriptor: DESCRIPTOR },
    },
    isAiEnabled: overrides.isAiEnabled ?? (() => true),
    mkdtemp: async () => "/tmp/mb-fake-root",
    cacheModule: cache,
    resolveCachePolicy: overrides.useDefaultCachePolicy
      ? undefined
      : overrides.resolveCachePolicy ??
        (() => ({ enabled: false, reasonCode: "test_disabled" })),
  });
  const harnessAccountLookup =
    overrides.accountLookup ?? defaultAccountLookup.bind(null);
  return {
    module,
    lease,
    supervisor,
    clients,
    cache,
    notices,
    statuses,
    persistCalls,
    lookupCalls,
    accountLookup: async () => harnessAccountLookup(ACCOUNT_ID),
  };
}

const noticeTypes = (
  notices: SafeBrowserChatNotice[]
): BrowserChatNoticeType[] => notices.map((n) => n.type);

// ---------------------------------------------------------------------------
// Gate ordering
// ---------------------------------------------------------------------------

describe("ManagedBrowserModule.start gates", () => {
  it("rejects managed_browser_disabled BEFORE account lookup (FR-SETTING-003)", async () => {
    const h = makeHarness({
      settings: { browserEnabled: false, disabledReasonCode: "user_disabled" },
    });
    await expect(
      h.module.start({ accountId: ACCOUNT_ID, purpose: "test" })
    ).rejects.toMatchObject({
      code: "managed_browser_disabled",
      reasonCode: "user_disabled",
    });
    expect(h.lookupCalls).toHaveLength(0);
    expect(h.clients).toHaveLength(0);
  });

  it("rejects ai_disabled on AI entry before account lookup (FR-P0-012)", async () => {
    const h = makeHarness({ isAiEnabled: () => false });
    await expect(
      h.module.start(
        { accountId: ACCOUNT_ID, purpose: "test" },
        { aiEntryPoint: true }
      )
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(h.lookupCalls).toHaveLength(0);
    expect(h.clients).toHaveLength(0);
  });

  it("allows the AI path when AI is enabled", async () => {
    const h = makeHarness();
    const status = await h.module.start(
      { accountId: ACCOUNT_ID, purpose: "test" },
      { aiEntryPoint: true }
    );
    expect(status.state).toBe("ready");
  });

  it("rejects account_not_found", async () => {
    const h = makeHarness({
      accountLookup: async () => null,
    });
    await expect(
      h.module.start({ accountId: 404, purpose: "test" })
    ).rejects.toMatchObject({ code: "account_not_found" });
  });

  it("rejects platforms outside the pilot allowlist", async () => {
    const h = makeHarness({
      accountLookup: async () => ({ platformId: 5, accountLabel: "Bing" }),
    });
    await expect(
      h.module.start({ accountId: ACCOUNT_ID, purpose: "test" })
    ).rejects.toMatchObject({
      code: "managed_browser_disabled",
      reasonCode: "platform_not_in_pilot",
    });
    expect(h.clients).toHaveLength(0);
  });

  it("rejects account_in_use without touching the worker", async () => {
    const h = makeHarness({
      nextLease: { status: "account_in_use" },
    });
    await expect(
      h.module.start({ accountId: ACCOUNT_ID, purpose: "test" })
    ).rejects.toMatchObject({ code: "account_in_use" });
    expect(h.clients).toHaveLength(0);
    expect(h.lease.releaseCalls).toHaveLength(0);
  });

  it("rejects global_session_limit", async () => {
    const h = makeHarness({
      nextLease: { status: "global_limit_reached" },
    });
    await expect(
      h.module.start({ accountId: ACCOUNT_ID, purpose: "test" })
    ).rejects.toMatchObject({ code: "global_session_limit" });
  });

  it("returns the existing session when the same owner re-starts", async () => {
    const h = makeHarness();
    const first = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
      conversationId: "conv-1",
    });
    h.lease.next = { status: "already_active", sessionId: first.sessionId };
    const second = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
      conversationId: "conv-1",
    });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.state).toBe("ready");
    expect(h.clients).toHaveLength(1);
  });

  it("treats already_active without a live record as an internal error and releases", async () => {
    const h = makeHarness({
      nextLease: { status: "already_active", sessionId: "mb_ghost0000000001" },
    });
    await expect(
      h.module.start({ accountId: ACCOUNT_ID, purpose: "test" })
    ).rejects.toMatchObject({
      code: "internal_error",
      reasonCode: "lease_without_record",
    });
    expect(h.lease.releaseCalls).toEqual([
      [ACCOUNT_ID, "mb_ghost0000000001", ""],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("ManagedBrowserModule.start happy path", () => {
  it("sends START_SESSION with domain-filtered cookies and reaches ready", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "contact_scan",
      conversationId: "conv-1",
    });

    expect(status.state).toBe("ready");
    expect(status.authenticated).toBe(true);
    expect(status.sessionId).toMatch(/^mb_/);

    // Lease acquired with owner conversation.
    expect(h.lease.acquireCalls).toHaveLength(1);
    expect(h.lease.acquireCalls[0][1].ownerConversationId).toBe("conv-1");

    // Supervisor registered before the worker started.
    expect(h.supervisor.registered).toHaveLength(1);
    expect(h.supervisor.registered[0].accountId).toBe(ACCOUNT_ID);

    const startMessage = h.clients[0].sent[0];
    expect(startMessage.type).toBe("START_SESSION");
    if (startMessage.type !== "START_SESSION") {
      throw new Error("unreachable");
    }
    expect(startMessage.executable).toEqual(DESCRIPTOR);
    const sentDomains = startMessage.cookies.map((c) => c.domain).sort();
    expect(sentDomains).toEqual(["accounts.google.com", "youtube.com"]);
    expect(
      startMessage.cookies.every((c) => c.value !== "attacker-cookie")
    ).toBe(true);
    // Temporary profile under a fresh temp root; cache policy honored.
    expect(startMessage.storagePolicy.temporaryProfilePath).toContain(
      "/tmp/mb-fake-root"
    );
    expect(startMessage.storagePolicy.persistentCache).toEqual({
      enabled: false,
      reasonCode: "test_disabled",
    });
  });

  it("translates a LOGIN_REQUIRED start reply into user_login_in_progress", async () => {
    const h = makeHarness({
      startScript: {
        START_SESSION: (env) => {
          void env;
          return loginRequiredReply("mb_fakesession0001");
        },
      },
    });
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    expect(status.state).toBe("user_login_in_progress");
    expect(status.authenticated).toBe(false);
    expect(noticeTypes(h.notices)).toContain("login_required");
  });

  it("releases the lease and fails cleanly when the executable is missing", async () => {
    const h = makeHarness({
      executableResolution: {
        errorCode: "browser_dependency_missing",
        searchedPaths: ["/fake/chrome"],
      },
    });
    await expect(
      h.module.start({ accountId: ACCOUNT_ID, purpose: "test" })
    ).rejects.toMatchObject({
      code: "browser_dependency_missing",
    });
    expect(h.lease.releaseCalls).toHaveLength(1);
    expect(h.module.listActiveSessions()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cookie bridge
// ---------------------------------------------------------------------------

describe("ManagedBrowserModule cookie bridge", () => {
  it("persists schema-valid, domain-filtered refreshes as worker_refresh", async () => {
    const h = makeHarness();
    await h.module.start({ accountId: ACCOUNT_ID, purpose: "test" });
    h.clients[0].deps.onRefreshedCookies([
      {
        domain: "youtube.com",
        path: "/",
        name: "SID",
        value: "refreshed-secret",
        secure: true,
        httpOnly: true,
      },
      {
        domain: "evil.example",
        path: "/",
        name: "SID",
        value: "evil-refresh",
        secure: false,
        httpOnly: false,
      },
    ]);
    // The refresh handler is invoked synchronously but persists async —
    // flush microtasks.
    await vi.waitFor(() => expect(h.persistCalls).toHaveLength(1));
    expect(h.persistCalls[0].source).toBe("worker_refresh");
    expect(h.persistCalls[0].accountId).toBe(ACCOUNT_ID);
    expect(h.persistCalls[0].partitionPath).toBe("/partitions/acc-101");
    expect(h.persistCalls[0].cookies).toHaveLength(1);
    expect((h.persistCalls[0].cookies[0] as { name: string }).name).toBe("SID");
  });

  it("keeps the last valid snapshot on an EMPTY refresh (FR-COOKIE-019)", async () => {
    const h = makeHarness();
    await h.module.start({ accountId: ACCOUNT_ID, purpose: "test" });
    h.clients[0].deps.onRefreshedCookies([]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.persistCalls).toHaveLength(0);
  });

  it("keeps the last valid snapshot when refresh cookies fail the schema", async () => {
    const h = makeHarness();
    await h.module.start({ accountId: ACCOUNT_ID, purpose: "test" });
    h.clients[0].deps.onRefreshedCookies([
      { domain: 42 } as unknown as NormalizedCookie,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.persistCalls).toHaveLength(0);
  });

  it("keeps the last valid snapshot when every refresh cookie is off-domain", async () => {
    const h = makeHarness();
    await h.module.start({ accountId: ACCOUNT_ID, purpose: "test" });
    h.clients[0].deps.onRefreshedCookies([
      {
        domain: "evil.example",
        path: "/",
        name: "SID",
        value: "evil-refresh",
        secure: false,
        httpOnly: false,
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.persistCalls).toHaveLength(0);
  });

  it("publishes session_persistence_failed when persistence throws", async () => {
    const h = makeHarness({
      persistSnapshot: async () => {
        throw new Error("disk full");
      },
    });
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    h.clients[0].deps.onRefreshedCookies([
      {
        domain: "youtube.com",
        path: "/",
        name: "SID",
        value: "refreshed-secret",
        secure: true,
        httpOnly: true,
      },
    ]);
    await vi.waitFor(() =>
      expect(noticeTypes(h.notices)).toContain("session_persistence_failed")
    );
    // Session stays usable; error surfaced on the safe status.
    expect(h.module.getStatus(status.sessionId)?.lastErrorCode).toBe(
      "cookie_persistence_failed"
    );
    expect(h.module.getStatus(status.sessionId)?.state).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Terminal handling
// ---------------------------------------------------------------------------

describe("ManagedBrowserModule terminal handling", () => {
  it("on crash: releases the lease, publishes browser_crashed, removes the session", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    h.clients[0].deps.onExited("exit:1");

    expect(h.lease.releaseCalls).toHaveLength(1);
    expect(h.lease.releaseCalls[0]).toEqual([
      ACCOUNT_ID,
      status.sessionId,
      "lease-1",
    ]);
    expect(noticeTypes(h.notices)).toContain("browser_crashed");
    expect(h.module.getStatus(status.sessionId)).toBeNull();
    // The LAST emitted status for this session is the failed one.
    const final = h.statuses[h.statuses.length - 1];
    expect(final.state).toBe("failed");
    expect(final.lastErrorCode).toBe("worker_exited");
  });

  it("stop() is graceful: no crash notice, lease released, session removed", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    const stopped = await h.module.stop(status.sessionId, "user_stop");
    expect(stopped.state).toBe("stopped");
    expect(h.lease.releaseCalls).toHaveLength(1);
    expect(noticeTypes(h.notices)).not.toContain("browser_crashed");
    expect(h.module.getStatus(status.sessionId)).toBeNull();
  });

  it("commands on a dead session fail with worker_exited", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    h.clients[0].deps.onExited("exit:1");
    await expect(h.module.observe(status.sessionId)).rejects.toMatchObject({
      code: "worker_exited",
    });
  });
});

// ---------------------------------------------------------------------------
// Manual login lifecycle (§13.2)
// ---------------------------------------------------------------------------

describe("ManagedBrowserModule.verifyManualLogin", () => {
  async function startInLogin(h: Harness): Promise<string> {
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    expect(status.state).toBe("user_login_in_progress");
    return status.sessionId;
  }

  it("resumes the task after a verified manual login", async () => {
    const h = makeHarness({
      startScript: {
        START_SESSION: () => loginRequiredReply("mb_fakesession0001"),
      },
    });
    const sessionId = await startInLogin(h);
    const status = await h.module.verifyManualLogin(sessionId);
    expect(status.state).toBe("ready");
    expect(status.authenticated).toBe(true);
    expect(noticeTypes(h.notices)).toEqual([
      "login_required",
      "login_verifying",
      "login_verified",
      "task_resuming",
    ]);
  });

  it("stays in user_login_in_progress and warns on a failed verification", async () => {
    const h = makeHarness({
      startScript: {
        START_SESSION: () => loginRequiredReply("mb_fakesession0001"),
        VERIFY_MANUAL_LOGIN: () =>
          stateChangedReply(
            "mb_fakesession0001",
            "user_login_in_progress",
            "not_verified"
          ),
      },
    });
    const sessionId = await startInLogin(h);
    const status = await h.module.verifyManualLogin(sessionId);
    expect(status.state).toBe("user_login_in_progress");
    expect(status.authenticated).toBe(false);
    expect(noticeTypes(h.notices)).toContain("login_verification_failed");
    expect(noticeTypes(h.notices)).not.toContain("task_resuming");
  });

  it("is rejected outside user_login_in_progress", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    expect(status.state).toBe("ready");
    await expect(
      h.module.verifyManualLogin(status.sessionId)
    ).rejects.toMatchObject({ code: "action_not_allowed" });
  });
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

describe("ManagedBrowserModule misc", () => {
  it("observe() returns the observation and tracks pageRevision", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    const observation = await h.module.observe(status.sessionId);
    expect(observation.origin).toBe("https://www.youtube.com");
    expect(h.module.getStatus(status.sessionId)?.pageRevision).toBe(1);
  });

  it("getStatusByAccount finds the live session", async () => {
    const h = makeHarness();
    await h.module.start({ accountId: ACCOUNT_ID, purpose: "test" });
    expect(h.module.getStatusByAccount(ACCOUNT_ID)?.accountId).toBe(ACCOUNT_ID);
    expect(h.module.getStatusByAccount(999)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cache coordinator wiring (§13.6)
// ---------------------------------------------------------------------------

describe("ManagedBrowserModule cache coordinator wiring", () => {
  it("forwards CACHE_OPENED to the cache module registry", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    h.clients[0].deps.onEvent({
      ...replyBase(status.sessionId),
      type: "CACHE_OPENED",
      scopeToken: "a".repeat(24),
      namespace: "chrome-120-linux-x64-schema-1",
    } as unknown as OutboundEvent);
    expect(h.cache.opened).toEqual([
      {
        sessionId: status.sessionId,
        accountId: ACCOUNT_ID,
        scopeToken: "a".repeat(24),
        namespace: "chrome-120-linux-x64-schema-1",
      },
    ]);
  });

  it("forwards CACHE_RELEASED to the cache module", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    h.clients[0].deps.onEvent({
      ...replyBase(status.sessionId),
      type: "CACHE_RELEASED",
    } as unknown as OutboundEvent);
    expect(h.cache.released).toEqual([status.sessionId]);
  });

  it("releases the scope on session terminal (safety net)", async () => {
    const h = makeHarness();
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    h.clients[0].deps.onExited("exit:1");
    expect(h.cache.terminals).toContain(status.sessionId);
  });

  it("awaits an async resolveCachePolicy and sends the policy to the worker", async () => {
    const h = makeHarness({
      resolveCachePolicy: async () => ({
        enabled: false,
        reasonCode: "async_disabled",
      }),
    });
    await h.module.start({ accountId: ACCOUNT_ID, purpose: "test" });
    const startMessage = h.clients[0].sent[0];
    if (startMessage.type !== "START_SESSION") {
      throw new Error("unreachable");
    }
    expect(startMessage.storagePolicy.persistentCache).toEqual({
      enabled: false,
      reasonCode: "async_disabled",
    });
  });

  it("falls back to the cache module policy when no resolver is injected", async () => {
    const h = makeHarness({ useDefaultCachePolicy: true });
    await h.module.start({ accountId: ACCOUNT_ID, purpose: "test" });
    expect(h.cache.policyCalls).toEqual([[ACCOUNT_ID, 120, true]]);
    const startMessage = h.clients[0].sent[0];
    if (startMessage.type !== "START_SESSION") {
      throw new Error("unreachable");
    }
    expect(startMessage.storagePolicy.persistentCache).toEqual({
      enabled: false,
      reasonCode: "fake_disabled",
    });
  });

  it("starts with the cache disabled when the coordinator throws", async () => {
    const h = makeHarness({ useDefaultCachePolicy: true });
    h.cache.failPolicy = true;
    const status = await h.module.start({
      accountId: ACCOUNT_ID,
      purpose: "test",
    });
    expect(status.state).toBe("ready");
    const startMessage = h.clients[0].sent[0];
    if (startMessage.type !== "START_SESSION") {
      throw new Error("unreachable");
    }
    expect(startMessage.storagePolicy.persistentCache).toEqual({
      enabled: false,
      reasonCode: "cache_unavailable",
    });
  });
});
