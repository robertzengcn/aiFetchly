import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { log } from "@/modules/Logger";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import {
  MANAGED_BROWSER_ACTION_LIMITS,
  MANAGED_BROWSER_PILOT_PLATFORM_IDS,
  MANAGED_BROWSER_SESSION_ID_PREFIX,
  MANAGED_BROWSER_TIMEOUTS,
} from "@/config/managedBrowser";
import {
  getPlatformManifest,
  matchesAllowedDomain,
  type PlatformSessionDefinition,
} from "@/modules/PlatformSessionManifest";
import { AccountSessionService } from "@/modules/AccountSessionService";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";
import {
  ManagedBrowserLeaseService,
  getDefaultManagedBrowserLeaseService,
  type AcquireLeaseResult,
} from "@/service/ManagedBrowserLeaseService";
import {
  ManagedBrowserSupervisor,
  getDefaultManagedBrowserSupervisor,
} from "@/service/ManagedBrowserSupervisor";
import {
  BrowserChatNoticePublisher,
  type BrowserChatNoticeSink,
} from "@/service/BrowserChatNoticePublisher";
import {
  ManagedBrowserWorkerClient,
  type WorkerClientDeps,
  type WorkerRequestEnvelope,
} from "@/service/ManagedBrowserWorkerClient";
import type { OutboundEvent } from "@/service/ManagedBrowserWorkerClient";
import {
  BrowserExecutableResolver,
  type ExecutableResolutionResult,
} from "@/childprocess/managed-browser/BrowserExecutableResolver";
import { buildDefaultLaunchPolicy } from "@/childprocess/managed-browser/BrowserFingerprintPolicy";
import { evaluateNavigationTarget } from "@/childprocess/managed-browser/NavigationPolicy";
import {
  assertCommandAllowed,
  type ManagedBrowserCommandType,
} from "@/childprocess/managed-browser/ManagedBrowserRuntime";
import {
  getDefaultManagedBrowserCacheModule,
  type ManagedBrowserCacheCoordinator,
} from "@/modules/ManagedBrowserCacheModule";
import { normalizedCookieArraySchema } from "@/schemas/accountCookies";
import { decideCaptchaResolution } from "@/service/CaptchaResolutionPolicy";
import { getDefaultCaptchaProviderService } from "@/service/CaptchaProviderService";
import type { NormalizedCookie } from "@/schemas/accountCookies";
import type {
  BrowserActionProgram,
  ManagedBrowserOutboundMessage,
} from "@/schemas/worker/managedBrowser";
import type {
  BrowserLaunchPolicy,
  BrowserObservation,
  EffectiveManagedBrowserSettings,
  ManagedBrowserHandoffReason,
  ManagedBrowserSessionState,
  ManagedBrowserErrorCode,
  SafeBrowserChatNotice,
  SafeManagedBrowserStatus,
  WorkerBrowserStoragePolicy,
} from "@/entityTypes/managedBrowserTypes";

/**
 * ManagedBrowserModule (technical design §7.1) — the ONLY application-level
 * entry point. IPC handlers and AI tools call this module; neither touches a
 * Model or TypeORM repository directly.
 *
 * START ORDER IS FIXED (design §7.1): release flag + settings BEFORE account
 * lookup, cookie decryption, and worker creation — a disabled browser must
 * reject before any secret is touched (FR-SETTING-003).
 *
 * Cookie values exist only: main decrypt → domain re-filter → START_SESSION
 * send → local reference dropped; worker REFRESHED_COOKIES → private handler
 * → AccountSessionService.persistSnapshot(worker_refresh). Empty or failed
 * refreshes never replace a valid snapshot (FR-COOKIE-019).
 */

export class ManagedBrowserError extends Error {
  constructor(
    public readonly code: ManagedBrowserErrorCode,
    public readonly reasonCode: string | null = null,
    message?: string
  ) {
    super(message ?? code);
    this.name = "ManagedBrowserError";
  }
}

export interface StartManagedBrowserInput {
  readonly accountId: number;
  readonly purpose: string;
  readonly requestedStartUrl?: string;
  readonly conversationId?: string;
}

export interface StartManagedBrowserOptions {
  /** AI entry points must pass USER_AI_ENABLED before any work (FR-P0-012). */
  readonly aiEntryPoint?: boolean;
}

interface ActiveSessionRecord {
  readonly sessionId: string;
  readonly accountId: number;
  readonly platformId: number;
  readonly conversationId: string | null;
  readonly leaseToken: string;
  /** Assigned once, right after construction (record needs the client ref). */
  client: ManagedBrowserWorkerClient;
  readonly accountLabel: string;
  readonly platformLabel: string;
  state: ManagedBrowserSessionState;
  currentOrigin: string | null;
  pageTitle: string | null;
  pageRevision: number;
  authenticated: boolean | null;
  handoffReason: ManagedBrowserHandoffReason | null;
  handoffBaseAtEpochMs: number | null;
  handoffExpiresAtEpochMs: number | null;
  /** Whether the session runs through a proxy (badge only, no details). */
  proxyActive: boolean;
  lastErrorCode: ManagedBrowserErrorCode | null;
  /** Latest sanitized observation (ref → role/name resolution, GAP-01). */
  lastObservation: BrowserObservation | null;
  /** Challenge ids that consumed their single resolution attempt (§18.3). */
  readonly challengeAttempts: Set<string>;
}

/**
 * Resolved proxy for a session (GAP-11): direct, an authenticated
 * http(s) proxy, or "unresolvable" when the account HAS proxies but none
 * usable — which must FAIL the start, never silently fall back to direct.
 */
export type ResolvedSessionProxy =
  | { readonly mode: "direct" }
  | {
      readonly mode: "http" | "https";
      readonly host: string;
      readonly port: number;
      readonly username?: string;
      readonly password?: string;
    }
  | { readonly mode: "unresolvable"; readonly reasonCode: string };

interface AccountLookupResult {
  readonly platformId: number;
  readonly accountLabel: string;
  /** Account proxy resolution (GAP-11); absent = direct. */
  readonly proxy?: ResolvedSessionProxy;
}

interface SessionServiceLike {
  getDecryptedSnapshot(accountId: number): Promise<{
    cookies: NormalizedCookie[];
    status: string;
  }>;
  getOrCreatePartition(accountId: number): Promise<string>;
  persistSnapshot(input: {
    accountId: number;
    cookies: unknown[];
    source: "worker_refresh";
    partitionPath: string;
  }): Promise<unknown>;
}

export interface ManagedBrowserModuleDeps {
  readonly settings?: ManagedBrowserSettingsModule;
  readonly leaseService?: ManagedBrowserLeaseService;
  readonly supervisor?: ManagedBrowserSupervisor;
  readonly noticeSink?: BrowserChatNoticeSink;
  readonly emitStatus?: (status: SafeManagedBrowserStatus) => void;
  readonly accountLookup?: (
    accountId: number
  ) => Promise<AccountLookupResult | null>;
  readonly sessionService?: SessionServiceLike;
  readonly workerClientFactory?: (
    deps: WorkerClientDeps
  ) => ManagedBrowserWorkerClient;
  readonly executableResolver?: { resolve(): ExecutableResolutionResult };
  readonly isAiEnabled?: () => boolean;
  readonly mkdtemp?: (prefix: string) => Promise<string>;
  /** Cache coordinator (registry + policy). Defaults to the process singleton. */
  readonly cacheModule?: ManagedBrowserCacheCoordinator;
  readonly resolveCachePolicy?: (
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ) =>
    | WorkerBrowserStoragePolicy["persistentCache"]
    | Promise<WorkerBrowserStoragePolicy["persistentCache"]>;
}

const START_SESSION_TIMEOUT_MS =
  MANAGED_BROWSER_TIMEOUTS.chromeLaunchAndSelfTestMs +
  MANAGED_BROWSER_TIMEOUTS.cookieApplyMs +
  MANAGED_BROWSER_TIMEOUTS.initialVerificationMs;

export class ManagedBrowserModule {
  private readonly settings: ManagedBrowserSettingsModule;
  private readonly leaseService: ManagedBrowserLeaseService;
  private readonly supervisor: ManagedBrowserSupervisor;
  private readonly noticePublisher: BrowserChatNoticePublisher;
  private readonly emitStatus: (status: SafeManagedBrowserStatus) => void;
  private readonly accountLookup: (
    accountId: number
  ) => Promise<AccountLookupResult | null>;
  private readonly sessionService: SessionServiceLike;
  private readonly workerClientFactory: (
    deps: WorkerClientDeps
  ) => ManagedBrowserWorkerClient;
  private readonly executableResolver: {
    resolve(): ExecutableResolutionResult;
  };
  private readonly isAiEnabled: () => boolean;
  private readonly mkdtemp: (prefix: string) => Promise<string>;
  private readonly cacheModule: ManagedBrowserCacheCoordinator;
  private readonly resolveCachePolicy:
    | ((
        accountId: number,
        chromeMajor: number,
        cacheEnabled: boolean
      ) =>
        | WorkerBrowserStoragePolicy["persistentCache"]
        | Promise<WorkerBrowserStoragePolicy["persistentCache"]>)
    | undefined;

  private readonly sessions = new Map<string, ActiveSessionRecord>();

  /** Approval decisions keyed by requestId (consumed by the AI tool layer). */
  private readonly approvalDecisions = new Map<
    string,
    {
      readonly sessionId: string;
      readonly decision: "approve" | "deny";
      readonly recordedAtEpochMs: number;
      /** SHA-256 of the exact program/script this approval authorizes. */
      readonly programDigest: string | null;
      /** Page revision the approval was granted against. */
      readonly pageRevision: number | null;
    }
  >();
  /** Wired by the IPC layer: pushes every safe status to the renderer. */
  private externalStatusSink:
    | ((status: SafeManagedBrowserStatus) => void)
    | null = null;
  /** Wired by the IPC layer: forwards sanitized chat notices to the renderer. */
  private externalNoticeSink: ((notice: SafeBrowserChatNotice) => void) | null =
    null;
  /** Wired by the IPC layer: coarse action progress to the renderer. */
  private externalProgressSink:
    | ((
        progress: {
          readonly sessionId: string;
          readonly phase: string;
          readonly completedSteps: number;
          readonly totalSteps: number | null;
          readonly messageCode: string;
        }
      ) => void)
    | null = null;
  /** Wired by the IPC layer: approval requests surfaced to the renderer. */
  private externalApprovalSink:
    | ((
        request: {
          readonly sessionId: string;
          readonly requestId: string;
          readonly programDigest: string | null;
          readonly pageRevision: number | null;
          readonly riskClass: string;
          readonly messageKey: string;
          readonly contentSummary: string | null;
        }
      ) => void)
    | null = null;
  /** Handoff-window expiry timers per session (FR-P0-013 enforcement). */
  private readonly handoffTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private now: () => number = Date.now;

  constructor(deps: ManagedBrowserModuleDeps = {}) {
    this.settings = deps.settings ?? new ManagedBrowserSettingsModule();
    this.leaseService =
      deps.leaseService ?? getDefaultManagedBrowserLeaseService();
    this.supervisor = deps.supervisor ?? getDefaultManagedBrowserSupervisor();
    this.noticePublisher = new BrowserChatNoticePublisher(
      deps.noticeSink ?? (() => undefined)
    );
    this.emitStatus = deps.emitStatus ?? (() => undefined);
    this.accountLookup =
      deps.accountLookup ??
      ((accountId) => this.defaultAccountLookup(accountId));
    this.sessionService = deps.sessionService ?? new AccountSessionService();
    this.workerClientFactory =
      deps.workerClientFactory ??
      ((clientDeps) => new ManagedBrowserWorkerClient(clientDeps));
    this.executableResolver =
      deps.executableResolver ?? new BrowserExecutableResolver();
    this.isAiEnabled = deps.isAiEnabled ?? defaultIsAiEnabled;
    this.mkdtemp = deps.mkdtemp ?? ((prefix) => fs.promises.mkdtemp(prefix));
    this.cacheModule =
      deps.cacheModule ?? getDefaultManagedBrowserCacheModule();
    this.resolveCachePolicy = deps.resolveCachePolicy;
  }

  /** Wired by the IPC layer: pushes every safe status to the renderer. */
  public setStatusSink(sink: (status: SafeManagedBrowserStatus) => void): void {
    this.externalStatusSink = sink;
  }

  /** Wired by the IPC layer: forwards sanitized chat notices to the renderer. */
  public setNoticeSink(sink: (notice: SafeBrowserChatNotice) => void): void {
    this.externalNoticeSink = sink;
  }

  /** Wired by the IPC layer: coarse action progress to the renderer. */
  public setProgressSink(
    sink: (progress: {
      readonly sessionId: string;
      readonly phase: string;
      readonly completedSteps: number;
      readonly totalSteps: number | null;
      readonly messageCode: string;
    }) => void
  ): void {
    this.externalProgressSink = sink;
  }

  /** Wired by the IPC layer: approval requests to the renderer. */
  public setApprovalSink(
    sink: (request: {
      readonly sessionId: string;
      readonly requestId: string;
      readonly programDigest: string | null;
      readonly pageRevision: number | null;
      readonly riskClass: string;
      readonly messageKey: string;
      readonly contentSummary: string | null;
    }) => void
  ): void {
    this.externalApprovalSink = sink;
  }

  /** Surface an approval request (called by the AI tool layer, §17). */
  public notifyApprovalRequired(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly riskClass: string;
    readonly contentSummary?: string | null;
    readonly programDigest?: string;
    readonly pageRevision?: number;
  }): void {
    if (this.externalApprovalSink) {
      this.externalApprovalSink({
        sessionId: input.sessionId,
        requestId: input.requestId,
        programDigest: input.programDigest ?? null,
        pageRevision: input.pageRevision ?? null,
        riskClass: input.riskClass,
        messageKey: "managedBrowser.approval.required",
        contentSummary: input.contentSummary ?? null,
      });
    }
  }

  /** Injectable clock for tests only. */
  public setClockForTests(now: () => number): void {
    this.now = now;
  }

  // -----------------------------------------------------------------------
  // Start
  // -----------------------------------------------------------------------

  public async start(
    input: StartManagedBrowserInput,
    options: StartManagedBrowserOptions = {}
  ): Promise<SafeManagedBrowserStatus> {
    // 1. Release flag + effective user preferences FIRST (FR-SETTING-003).
    const effective = await this.settings.getEffectiveSettings();
    if (!effective.browserEnabled) {
      throw new ManagedBrowserError(
        "managed_browser_disabled",
        effective.disabledReasonCode
      );
    }

    // 2. AI entry point: entitlement check before account lookup (FR-P0-012).
    if (options.aiEntryPoint && !this.isAiEnabled()) {
      throw new ManagedBrowserError("ai_disabled");
    }

    // 3. Account lookup through the Module layer.
    const account = await this.accountLookup(input.accountId);
    if (!account) {
      throw new ManagedBrowserError("account_not_found");
    }

    // 4. Platform manifest + pilot allowlist.
    const manifest = getPlatformManifest(account.platformId);
    if (
      !manifest ||
      !MANAGED_BROWSER_PILOT_PLATFORM_IDS.includes(account.platformId)
    ) {
      throw new ManagedBrowserError(
        "managed_browser_disabled",
        "platform_not_in_pilot"
      );
    }

    // 4b. GAP-11: an unresolvable account proxy FAILS the start before any
    // resource work — the session must never silently fall back to direct.
    if (account.proxy?.mode === "unresolvable") {
      throw new ManagedBrowserError(
        "proxy_unavailable",
        account.proxy.reasonCode
      );
    }

    // 5. Account lease (exclusive; global limit).
    const sessionId = `${MANAGED_BROWSER_SESSION_ID_PREFIX}${uuidv4()
      .replace(/-/g, "")
      .slice(0, 16)}`;
    const sessionNonce = `nonce_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
    const lease = this.leaseService.acquire(input.accountId, {
      sessionId,
      ownerConversationId: input.conversationId ?? null,
    });
    if (lease.status === "already_active") {
      const existing = this.sessions.get(lease.sessionId);
      if (existing) {
        return this.toSafeStatus(existing);
      }
      this.leaseService.release(input.accountId, lease.sessionId, "");
      throw new ManagedBrowserError("internal_error", "lease_without_record");
    }
    if (lease.status === "account_in_use") {
      throw new ManagedBrowserError("account_in_use");
    }
    if (lease.status === "global_limit_reached") {
      throw new ManagedBrowserError("global_session_limit");
    }

    let registered = false;
    try {
      // 6. Executable resolution.
      const resolution = this.executableResolver.resolve();
      if ("errorCode" in resolution) {
        throw new ManagedBrowserError(
          "browser_dependency_missing",
          resolution.errorCode
        );
      }

      // 7. Storage: unique temp profile + (optional) trusted cache dir.
      const profileRoot = await this.mkdtemp(
        path.join(os.tmpdir(), "aifetchly-managed-browser-")
      );
      const temporaryProfilePath = path.join(profileRoot, "profile");
      await fs.promises.mkdir(temporaryProfilePath, { recursive: true });
      const persistentCache = this.resolveCachePolicy
        ? await this.resolveCachePolicy(
            input.accountId,
            resolution.descriptor.majorVersion,
            effective.cacheEnabled
          )
        : await this.defaultCachePolicy(
            input.accountId,
            resolution.descriptor.majorVersion,
            effective.cacheEnabled
          );

      // 8-9. Worker client + supervisor registration.
      const record: ActiveSessionRecord = {
        sessionId,
        accountId: input.accountId,
        platformId: account.platformId,
        conversationId: input.conversationId ?? null,
        leaseToken: lease.leaseToken,
        client: null as unknown as ManagedBrowserWorkerClient,
        accountLabel: account.accountLabel,
        platformLabel: manifest.platformName,
        state: "starting",
        currentOrigin: null,
        pageTitle: null,
        pageRevision: 0,
        authenticated: null,
        handoffReason: null,
        handoffBaseAtEpochMs: null,
        handoffExpiresAtEpochMs: null,
        proxyActive: false,
        lastErrorCode: null,
        lastObservation: null,
        challengeAttempts: new Set<string>(),
      };
      const client = this.workerClientFactory({
        sessionId,
        sessionNonce,
        onEvent: (event) => this.handleWorkerEvent(record, event),
        onRefreshedCookies: (cookies) => {
          void this.handleRefreshedCookies(record, cookies);
        },
        onExited: (detail) => {
          this.supervisor.handleTerminal(sessionId, detail);
        },
      });
      record.client = client;
      this.sessions.set(sessionId, record);
      this.supervisor.register({
        sessionId,
        accountId: input.accountId,
        client,
        releaseLease: () => {
          // Lease release ONLY. The supervisor calls this BEFORE onTerminal;
          // deleting the session here would hide the record from
          // handleTerminalEvent (which owns the final status + notice +
          // deletion).
          this.leaseService.release(
            input.accountId,
            sessionId,
            record.leaseToken
          );
        },
        onTerminal: (id, cause) => this.handleTerminalEvent(id, cause),
      });
      registered = true;

      await client.start().catch((error: Error) => {
        throw new ManagedBrowserError(
          "worker_start_timeout",
          null,
          error.message
        );
      });

      // 10-11. Decrypt + domain re-filter, then START_SESSION.
      const snapshot = await this.sessionService.getDecryptedSnapshot(
        input.accountId
      );
      const allowedCookies = snapshot.cookies.filter((cookie) =>
        matchesAllowedDomain(cookie.domain, manifest.allowedDomainSuffixes)
      );
      let startCookies: NormalizedCookie[] = allowedCookies;
      const sessionProxy =
        account.proxy && account.proxy.mode !== "direct"
          ? {
              mode: account.proxy.mode,
              host: account.proxy.host,
              port: account.proxy.port,
              ...(account.proxy.username
                ? { username: account.proxy.username }
                : {}),
              ...(account.proxy.password
                ? { password: account.proxy.password }
                : {}),
            }
          : ({ mode: "direct" } as const);
      record.proxyActive = sessionProxy.mode !== "direct";
      const reply = await client.request(
        {
          type: "START_SESSION",
          executable: resolution.descriptor,
          launchPolicy: toWorkerLaunchPolicy(buildDefaultLaunchPolicy()),
          storagePolicy: { temporaryProfilePath, persistentCache },
          platform: toWorkerPlatform(manifest),
          proxy: sessionProxy,
          cookies: startCookies,
        },
        START_SESSION_TIMEOUT_MS,
        (message) =>
          message.type === "SESSION_READY" ||
          message.type === "LOGIN_REQUIRED" ||
          message.type === "HANDOFF_REQUIRED"
      );
      // 12. Drop the local cookie reference (best-effort in JS).
      startCookies = [];

      // The correlated reply IS the first state transition (the worker does
      // not re-emit it unsolicited) — feed it through the shared handler,
      // which also pushes status. The accept predicate above already
      // restricts the reply to non-heartbeat event types.
      this.handleWorkerEvent(record, reply as OutboundEvent);
      // GAP-11: navigate to the requested start URL AFTER authentication
      // verification, validated against the platform allowlist first.
      if (reply.type === "SESSION_READY" && input.requestedStartUrl) {
        const navDecision = evaluateNavigationTarget(input.requestedStartUrl, {
          allowedOrigins: [...manifest.allowedDomainSuffixes],
        });
        if (navDecision.allowed) {
          await this.requestWorker(
            record,
            {
              type: "RUN_ACTIONS",
              program: {
                actions: [{ type: "navigate", url: input.requestedStartUrl }],
              },
            },
            MANAGED_BROWSER_TIMEOUTS.navigationActionMs,
            (m) => m.type === "ACTION_RESULT" || m.type === "HANDOFF_REQUIRED"
          ).catch(() => undefined);
        } else {
          log.warn(
            "[ManagedBrowserModule] requested start URL rejected by navigation policy"
          );
        }
      }
      return this.toSafeStatus(record);
    } catch (error) {
      // Any failure after lease acquisition enters the same cleanup path.
      const cause =
        error instanceof ManagedBrowserError ? error.code : "start_failed";
      const client = this.sessions.get(sessionId)?.client;
      if (client) {
        await client.cleanup(cause).catch(() => undefined);
      }
      if (!registered) {
        // Failures BEFORE supervisor registration (executable resolution,
        // profile creation) can never be released by the supervisor —
        // release the lease directly or it leaks until app restart.
        this.leaseService.release(input.accountId, sessionId, lease.leaseToken);
      }
      this.supervisor.handleTerminal(sessionId, cause);
      if (error instanceof ManagedBrowserError) {
        throw error;
      }
      throw new ManagedBrowserError(
        "internal_error",
        null,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  public getStatus(sessionId: string): SafeManagedBrowserStatus | null {
    const record = this.sessions.get(sessionId);
    return record ? this.toSafeStatus(record) : null;
  }

  /** Effective settings for the renderer settings page (safe shape). */
  public async getEffectiveSettingsForRenderer(): Promise<EffectiveManagedBrowserSettings> {
    return this.settings.getEffectiveSettings();
  }

  public getStatusByAccount(
    accountId: number
  ): SafeManagedBrowserStatus | null {
    for (const record of this.sessions.values()) {
      if (record.accountId === accountId) {
        return this.toSafeStatus(record);
      }
    }
    return null;
  }

  public listActiveSessions(): readonly SafeManagedBrowserStatus[] {
    return [...this.sessions.values()].map((record) =>
      this.toSafeStatus(record)
    );
  }

  // -----------------------------------------------------------------------
  // Eligible accounts, handoff window, approvals (§13.2, §15)
  // -----------------------------------------------------------------------

  /** Accounts usable with the managed browser (pilot platforms only). */
  public async listEligibleAccounts(): Promise<
    ReadonlyArray<{
      readonly accountId: number;
      readonly platformId: number;
      readonly accountLabel: string;
    }>
  > {
    try {
      // Lazy require avoids a module-load cycle with SocialAccountModule.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SocialAccountModule: Sam } =
        require("@/modules/socialAccountModule") as {
          SocialAccountModule: new () => {
            getAllSocialAccounts(): Promise<
              Array<{
                id: number;
                social_type_id: number;
                name: string;
                user: string;
              }>
            >;
          };
        };
      const accounts = await new Sam().getAllSocialAccounts();
      return accounts
        .filter((account) =>
          MANAGED_BROWSER_PILOT_PLATFORM_IDS.includes(account.social_type_id)
        )
        .map((account) => ({
          accountId: account.id,
          platformId: account.social_type_id,
          // Display name preferred; email avoided when a name exists (§8.4).
          accountLabel: account.name || account.user || `#${account.id}`,
        }));
    } catch (error) {
      log.warn(
        `[ManagedBrowserModule] eligible account listing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  /**
   * Extend the handoff/manual-login window (FR-P0-013). The total window is
   * capped by manualLoginHandoffMaxMs from when handoff started.
   */
  public async extendHandoff(
    sessionId: string,
    extendMinutes: number
  ): Promise<SafeManagedBrowserStatus> {
    const record = this.requireSession(sessionId);
    if (
      record.state !== "handoff" &&
      record.state !== "user_login_in_progress"
    ) {
      throw new ManagedBrowserError("action_not_allowed");
    }
    if (record.handoffBaseAtEpochMs === null) {
      record.handoffBaseAtEpochMs = this.now();
    }
    const cap =
      record.handoffBaseAtEpochMs +
      MANAGED_BROWSER_TIMEOUTS.manualLoginHandoffMaxMs;
    const current = record.handoffExpiresAtEpochMs ?? this.now();
    record.handoffExpiresAtEpochMs = Math.min(
      current + extendMinutes * 60_000,
      cap
    );
    // Re-arm the enforcement timer for the NEW deadline — the old timer
    // would otherwise see the extended expiry, return, and leave the
    // session permanently unenforced (review finding).
    this.scheduleHandoffExpiry(record);
    this.pushStatus(record);
    return this.toSafeStatus(record);
  }

  /** Record a user approval decision for a pending approval request. */
  public recordApproval(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly decision: "approve" | "deny";
    /** Digest of the exact program/script being approved (TODO-MSB-002). */
    readonly programDigest?: string;
    readonly pageRevision?: number;
  }): void {
    this.requireSession(input.sessionId);
    if (this.approvalDecisions.size >= 100) {
      // Bounded registry: drop the oldest recorded decision.
      const oldest = this.approvalDecisions.keys().next().value;
      if (oldest !== undefined) {
        this.approvalDecisions.delete(oldest);
      }
    }
    this.approvalDecisions.set(input.requestId, {
      sessionId: input.sessionId,
      decision: input.decision,
      recordedAtEpochMs: this.now(),
      programDigest: input.programDigest ?? null,
      pageRevision: input.pageRevision ?? null,
    });
  }

  /**
   * Consume the single outstanding APPROVE decision for a session (the
   * one-click approval dialog authorizes the model's retry). Returns
   * "deny" when the user denied (still consumed), null when no decision
   * was recorded. Single-use by construction.
   */
  public consumeApprovalForProgram(input: {
    readonly sessionId: string;
    readonly programDigest: string;
    readonly pageRevision: number;
  }): "approve" | "deny" | null {
    for (const [requestId, entry] of this.approvalDecisions) {
      if (entry.sessionId !== input.sessionId) {
        continue;
      }
      // A deny is session-scoped: consume it regardless of digest.
      if (entry.decision === "deny") {
        this.approvalDecisions.delete(requestId);
        if (this.now() - entry.recordedAtEpochMs > 10 * 60_000) {
          return null;
        }
        return "deny";
      }
      const digestMatches =
        entry.programDigest === null ||
        entry.programDigest === input.programDigest;
      const revisionMatches =
        entry.pageRevision === null ||
        entry.pageRevision === input.pageRevision;
      if (!digestMatches || !revisionMatches) {
        continue; // a stale approve for a DIFFERENT program never matches
      }
      this.approvalDecisions.delete(requestId);
      if (this.now() - entry.recordedAtEpochMs > 10 * 60_000) {
        return null;
      }
      return "approve";
    }
    return null;
  }

  /** Consume a recorded decision (single-use); null when none was recorded. */
  public consumeApproval(requestId: string): "approve" | "deny" | null {
    const entry = this.approvalDecisions.get(requestId);
    if (!entry) {
      return null;
    }
    this.approvalDecisions.delete(requestId);
    return entry.decision;
  }

  // -----------------------------------------------------------------------
  // Session commands (state-guarded)
  // -----------------------------------------------------------------------

  public async observe(sessionId: string): Promise<BrowserObservation> {
    const record = this.requireSession(sessionId);
    this.guard(record, "OBSERVE");
    const message = await this.requestWorker(
      record,
      { type: "OBSERVE" },
      MANAGED_BROWSER_TIMEOUTS.observeMs,
      (m) => m.type === "OBSERVATION_RESULT"
    );
    if (message.type !== "OBSERVATION_RESULT") {
      throw new ManagedBrowserError("internal_error");
    }
    record.pageRevision = message.observation.pageRevision;
    // Cache the sanitized observation so risk classification can resolve
    // element refs to their role/name descriptors (GAP-01).
    record.lastObservation = message.observation;
    return message.observation;
  }

  /**
   * Latest sanitized observation for a live session (null when none was
   * taken). Used by the AI tool layer to resolve ref → target descriptor.
   */
  public getLastObservation(
    sessionId: string
  ): BrowserObservation | null {
    return this.sessions.get(sessionId)?.lastObservation ?? null;
  }

  public async runActions(
    sessionId: string,
    program: BrowserActionProgram
  ): Promise<ManagedBrowserOutboundMessage> {
    const record = this.requireSession(sessionId);
    this.guard(record, "RUN_ACTIONS");
    return this.requestWorker(
      record,
      { type: "RUN_ACTIONS", program },
      MANAGED_BROWSER_ACTION_LIMITS.programWallTimeMs,
      (m) => m.type === "ACTION_RESULT" || m.type === "HANDOFF_REQUIRED"
    );
  }

  /**
   * GAP-14: propagate job/conversation cancellation to the ACTIVE worker
   * request. The worker aborts the in-flight program between actions and
   * returns an outcome whose effect reflects uncertainty (cancelled
   * consequential steps keep effect=unknown).
   */
  public async cancelActiveRequest(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record || !record.client) {
      return;
    }
    await record.client
      .request(
        { type: "CANCEL_REQUEST", targetRequestId: null },
        MANAGED_BROWSER_TIMEOUTS.singleActionMs,
        (m) => m.type === "SESSION_STATE_CHANGED"
      )
      .catch(() => undefined);
  }

  /**
   * GAP-12: privileged page-context script execution. ALWAYS requires an
   * explicit user approval at the tool layer (privileged_script class) —
   * this method only transports the approved request to the worker.
   */
  public async evaluateScript(
    sessionId: string,
    input: {
      readonly source: string;
      readonly timeoutMs: number;
      /** Required current page revision (TODO-MSB-009 fail-closed). */
      readonly pageRevision: number;
    }
  ): Promise<{
    readonly ok: boolean;
    readonly resultSummary: string | null;
    readonly resultBytes: number;
    readonly truncated: boolean;
  }> {
    const record = this.requireSession(sessionId);
    this.guard(record, "RUN_ACTIONS");
    // TODO-MSB-009: scripts are revision-bound — a stale page reference
    // means the script was written for a different DOM. Fail closed.
    if (record.lastObservation && record.lastObservation.pageRevision !== input.pageRevision) {
      throw new ManagedBrowserError("stale_page_reference");
    }
    const message = await this.requestWorker(
      record,
      {
        type: "EVALUATE_SCRIPT",
        source: input.source,
        timeoutMs: input.timeoutMs,
      },
      input.timeoutMs + MANAGED_BROWSER_TIMEOUTS.singleActionMs,
      (m) => m.type === "EVALUATE_SCRIPT_RESULT"
    );
    if (message.type !== "EVALUATE_SCRIPT_RESULT") {
      throw new ManagedBrowserError("internal_error");
    }
    return {
      ok: message.ok,
      resultSummary: message.resultSummary,
      resultBytes: message.resultBytes,
      truncated: message.truncated,
    };
  }

  public async captureScreenshot(
    sessionId: string
  ): Promise<{ mimeType: string; base64: string }> {
    const record = this.requireSession(sessionId);
    this.guard(record, "CAPTURE_SCREENSHOT");
    const message = await this.requestWorker(
      record,
      { type: "CAPTURE_SCREENSHOT" },
      MANAGED_BROWSER_TIMEOUTS.observeMs + 5_000,
      (m) => m.type === "SCREENSHOT_RESULT"
    );
    if (message.type !== "SCREENSHOT_RESULT") {
      throw new ManagedBrowserError("internal_error");
    }
    return { mimeType: message.mimeType, base64: message.base64 };
  }

  public async requestHandoff(
    sessionId: string,
    reason: ManagedBrowserHandoffReason = "user_requested"
  ): Promise<SafeManagedBrowserStatus> {
    const record = this.requireSession(sessionId);
    this.guard(record, "BEGIN_HANDOFF");
    await this.requestWorker(
      record,
      { type: "BEGIN_HANDOFF", reason },
      MANAGED_BROWSER_TIMEOUTS.singleActionMs,
      (m) => m.type === "SESSION_STATE_CHANGED"
    );
    record.state = "handoff";
    record.handoffReason = reason;
    this.pushStatus(record);
    return this.toSafeStatus(record);
  }

  /**
   * Manual-login verification (§13.2): publish the notice lifecycle and
   * resume ONLY after the adapter confirms authentication.
   */
  public async verifyManualLogin(
    sessionId: string
  ): Promise<SafeManagedBrowserStatus> {
    const record = this.requireSession(sessionId);
    this.guard(record, "VERIFY_MANUAL_LOGIN");
    this.publishNotice(record, "login_verifying", "verify-start", {
      accountLabel: record.accountLabel,
    });
    const message = await this.requestWorker(
      record,
      { type: "VERIFY_MANUAL_LOGIN" },
      MANAGED_BROWSER_TIMEOUTS.initialVerificationMs,
      (m) => m.type === "SESSION_STATE_CHANGED"
    );
    const verified =
      message.type === "SESSION_STATE_CHANGED" &&
      message.reasonCode === "manual_login_verified";
    if (verified) {
      record.state = "ready";
      record.authenticated = true;
      this.publishNotice(
        record,
        "login_verified",
        "verify-done",
        { sessionSaved: record.lastErrorCode !== "cookie_persistence_failed" },
        false
      );
      this.publishNotice(record, "task_resuming", "verify-resume", {}, false);
    } else {
      record.state = "user_login_in_progress";
      this.publishNotice(record, "login_verification_failed", "verify-done", {
        reasonCode:
          message.type === "SESSION_STATE_CHANGED"
            ? message.reasonCode ?? "not_verified"
            : "not_verified",
      });
    }
    this.pushStatus(record);
    return this.toSafeStatus(record);
  }

  public async resumeAfterHandoff(
    sessionId: string
  ): Promise<SafeManagedBrowserStatus> {
    const record = this.requireSession(sessionId);
    this.guard(record, "RESUME_HANDOFF");
    const message = await this.requestWorker(
      record,
      { type: "RESUME_HANDOFF" },
      MANAGED_BROWSER_TIMEOUTS.initialVerificationMs,
      (m) => m.type === "SESSION_STATE_CHANGED" || m.type === "HANDOFF_REQUIRED"
    );
    // Apply the reply like every other command path — otherwise the record
    // stays "handoff" and guard() rejects all subsequent commands against
    // a worker that is actually ready (review finding).
    if (message.type === "SESSION_STATE_CHANGED") {
      record.state = message.state;
    }
    this.pushStatus(record);
    return this.toSafeStatus(record);
  }

  public async stop(
    sessionId: string,
    reason: "user_stop" | "cancelled" = "user_stop"
  ): Promise<SafeManagedBrowserStatus> {
    const record = this.requireSession(sessionId);
    try {
      await record.client.stop(reason);
    } finally {
      this.supervisor.handleTerminal(sessionId, reason);
    }
    record.state = "stopped";
    this.pushStatus(record);
    return this.toSafeStatus(record);
  }

  // -----------------------------------------------------------------------
  // Cookie bridge
  // -----------------------------------------------------------------------

  /**
   * Private REFRESHED_COOKIES handler: schema-validate, re-filter domains,
   * persist through AccountSessionService with source `worker_refresh`.
   * Empty/invalid/failed refreshes NEVER replace a valid snapshot.
   */
  private async handleRefreshedCookies(
    record: ActiveSessionRecord,
    cookies: readonly NormalizedCookie[]
  ): Promise<void> {
    try {
      const parsed = normalizedCookieArraySchema.safeParse(cookies);
      if (!parsed.success || parsed.data.length === 0) {
        return; // keep last valid snapshot
      }
      const manifest = getPlatformManifest(record.platformId);
      if (!manifest) {
        return;
      }
      const filtered = parsed.data.filter((cookie) =>
        matchesAllowedDomain(cookie.domain, manifest.allowedDomainSuffixes)
      );
      if (filtered.length === 0) {
        return;
      }
      const partitionPath = await this.sessionService.getOrCreatePartition(
        record.accountId
      );
      await this.sessionService.persistSnapshot({
        accountId: record.accountId,
        cookies: filtered,
        source: "worker_refresh",
        partitionPath,
      });
      record.lastErrorCode = null;
    } catch (error) {
      // Persistence failure keeps the browser usable but warns the user.
      record.lastErrorCode = "cookie_persistence_failed";
      log.warn(
        `[ManagedBrowserModule] refresh persistence failed for session ${
          record.sessionId
        }: ${error instanceof Error ? error.message : String(error)}`
      );
      this.publishNotice(
        record,
        "session_persistence_failed",
        "refresh-failed",
        {},
        false
      );
    }
  }

  // -----------------------------------------------------------------------
  // Worker event plumbing
  // -----------------------------------------------------------------------

  private handleWorkerEvent(
    record: ActiveSessionRecord,
    event: OutboundEvent
  ): void {
    switch (event.type) {
      case "SESSION_STATE_CHANGED":
        record.state = event.state;
        record.handoffReason =
          event.state === "handoff" ? "user_requested" : null;
        if (event.state === "handoff") {
          this.enterHandoffWindow(record);
        } else {
          this.clearHandoffWindow(record);
        }
        if (event.reasonCode?.startsWith("browser_")) {
          // TODO-MSB-011: a browser-created state was handled (dialog
          // dismissed / popup closed / download cancelled) — tell the user
          // instead of silently absorbing it.
          this.publishNotice(
            record,
            "browser_state_blocked",
            event.reasonCode
          );
        }
        break;
      case "SESSION_READY":
        record.state = "ready";
        record.authenticated =
          event.assessment.state === "authenticated" ? true : null;
        record.pageRevision += 1;
        this.clearHandoffWindow(record);
        break;
      case "LOGIN_REQUIRED":
        record.state = "user_login_in_progress";
        record.authenticated = false;
        this.enterHandoffWindow(record);
        this.publishNotice(record, "login_required", "login-start", {
          accountLabel: record.accountLabel,
          platformLabel: record.platformLabel,
        });
        break;
      case "HANDOFF_REQUIRED":
        record.state = "handoff";
        record.handoffReason = event.reason;
        this.enterHandoffWindow(record);
        break;
      case "CHALLENGE_DETECTED":
        this.publishNotice(record, "challenge_detected", event.challengeId, {
          platformLabel: record.platformLabel,
        });
        record.state = "challenge_detected";
        // GAP-05: the RESOLUTION POLICY runs here, in the trusted main
        // process (§18.3) — never in the worker, never from page data.
        // P0 ships with providers disabled, so the ladder resolves to
        // manual_handoff for every challenge; blocked decisions stop the
        // session outright.
        record.challengeAttempts.add(event.challengeId);
        // GAP-15: the real gate configuration drives the policy ladder;
        // every refusal/failure keeps the manual handoff. Fire-and-forget:
        // the policy never blocks the event loop on a provider call.
        void this.runChallengePolicy(record, event);
        break;
      case "ACTION_PROGRESS":
        // Coarse progress only — counts + phase + message code (§14).
        if (this.externalProgressSink) {
          this.externalProgressSink({
            sessionId: record.sessionId,
            phase: event.phase,
            completedSteps: event.completedSteps,
            totalSteps: event.totalSteps,
            messageCode: event.messageCode,
          });
        }
        break;
      case "SESSION_STOPPED":
        // GAP-06: an unsolicited terminal report (e.g. Chrome crashed and
        // the worker sent SESSION_STOPPED failed) converges through the
        // supervisor's single terminal path.
        this.supervisor.handleTerminal(
          record.sessionId,
          event.reasonCode ?? "chrome_disconnected"
        );
        return;
      case "CACHE_OPENED":
        // Active-scope registry (§13.6): exactly one Chrome per cache scope.
        this.cacheModule.onCacheOpened({
          sessionId: record.sessionId,
          accountId: record.accountId,
          scopeToken: event.scopeToken,
          namespace: event.namespace,
        });
        break;
      case "CACHE_RELEASED":
        this.cacheModule.onCacheReleased(record.sessionId);
        break;
      default:
        break;
    }
    this.pushStatus(record);
  }

  private handleTerminalEvent(sessionId: string, cause: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }
    const graceful =
      cause === "user_stop" || cause === "cancelled" || cause === "shutdown";
    record.state = graceful ? "stopped" : "failed";
    record.lastErrorCode = graceful
      ? null
      : isErrorCode(cause)
      ? cause
      : "worker_exited";
    if (!graceful) {
      this.publishNotice(record, "browser_crashed", "terminal", {
        accountLabel: record.accountLabel,
      });
    }
    try {
      this.pushStatus(record);
    } catch {
      // A throwing renderer sink must never prevent the record cleanup
      // below (review finding: zombie session records).
    }
    // Safety net: release any cache-scope claim even if CACHE_RELEASED was
    // never delivered (worker crash mid-session, §13.6).
    this.cacheModule.onSessionTerminal(sessionId);
    this.clearHandoffTimer(sessionId);
    this.sessions.delete(sessionId);
  }

  private requireSession(sessionId: string): ActiveSessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) {
      throw new ManagedBrowserError("worker_exited", "no_active_session");
    }
    return record;
  }

  private guard(
    record: ActiveSessionRecord,
    command: ManagedBrowserCommandType
  ): void {
    const result = assertCommandAllowed(record.state, command);
    if (!result.ok) {
      throw new ManagedBrowserError(result.errorCode);
    }
  }

  private async requestWorker(
    record: ActiveSessionRecord,
    message: WorkerRequestEnvelope,
    timeoutMs: number,
    accept: (message: ManagedBrowserOutboundMessage) => boolean
  ): Promise<ManagedBrowserOutboundMessage> {
    try {
      return await record.client.request(message, timeoutMs, accept);
    } catch (error) {
      const code = error instanceof Error ? error.message : "internal_error";
      if (isErrorCode(code)) {
        throw new ManagedBrowserError(code);
      }
      throw new ManagedBrowserError(
        "internal_error",
        null,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private publishNotice(
    record: ActiveSessionRecord,
    type: Parameters<BrowserChatNoticePublisher["publish"]>[0]["type"],
    transitionNonce: string,
    messageArgs: Readonly<Record<string, string | number | boolean>> = {},
    requiresUserAction = true
  ): void {
    const notice = this.noticePublisher.publish({
      sessionId: record.sessionId,
      conversationId: record.conversationId ?? "workspace",
      type,
      transitionNonce,
      messageArgs,
      requiresUserAction,
    });
    if (notice && this.externalNoticeSink) {
      this.externalNoticeSink(notice);
    }
  }

  private pushStatus(record: ActiveSessionRecord): void {
    const status = this.toSafeStatus(record);
    this.emitStatus(status);
    if (this.externalStatusSink) {
      this.externalStatusSink(status);
    }
  }

  private toSafeStatus(record: ActiveSessionRecord): SafeManagedBrowserStatus {
    return {
      sessionId: record.sessionId,
      accountId: record.accountId,
      platformId: record.platformId,
      accountLabel: record.accountLabel,
      platformLabel: record.platformLabel,
      state: record.state,
      currentOrigin: record.currentOrigin,
      pageTitle: record.pageTitle,
      pageRevision: record.pageRevision,
      authenticated: record.authenticated,
      handoffReason: record.handoffReason,
      handoffExpiresAtEpochMs: record.handoffExpiresAtEpochMs,
      proxyActive: record.proxyActive,
      lastErrorCode: record.lastErrorCode,
    };
  }

  /** Start (or restart) the handoff/manual-login window on a record. */
  private enterHandoffWindow(record: ActiveSessionRecord): void {
    if (record.handoffBaseAtEpochMs === null) {
      record.handoffBaseAtEpochMs = this.now();
    }
    const cap =
      record.handoffBaseAtEpochMs +
      MANAGED_BROWSER_TIMEOUTS.manualLoginHandoffMaxMs;
    const target = this.now() + MANAGED_BROWSER_TIMEOUTS.manualLoginHandoffMs;
    record.handoffExpiresAtEpochMs = Math.min(target, cap);
    this.scheduleHandoffExpiry(record);
  }

  /**
   * FR-P0-013 enforcement: when the handoff/login window lapses while the
   * session is still waiting on the user, stop the session (cancelled) and
   * publish the localized notice.
   */
  private scheduleHandoffExpiry(record: ActiveSessionRecord): void {
    this.clearHandoffTimer(record.sessionId);
    const expiresAt = record.handoffExpiresAtEpochMs;
    if (expiresAt === null) {
      return;
    }
    const delay = Math.max(0, expiresAt - this.now());
    const timer = setTimeout(() => {
      this.handoffTimers.delete(record.sessionId);
      const current = this.sessions.get(record.sessionId);
      if (!current || current !== record) {
        return;
      }
      if (
        current.state !== "handoff" &&
        current.state !== "user_login_in_progress"
      ) {
        return;
      }
      if (
        current.handoffExpiresAtEpochMs !== null &&
        this.now() < current.handoffExpiresAtEpochMs
      ) {
        return; // extended meanwhile — a fresh timer was scheduled
      }
      void this.stop(record.sessionId, "cancelled").catch(() => undefined);
    }, delay);
    this.handoffTimers.set(record.sessionId, timer);
  }

  private clearHandoffTimer(sessionId: string): void {
    const timer = this.handoffTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.handoffTimers.delete(sessionId);
    }
  }

  private clearHandoffWindow(record: ActiveSessionRecord): void {
    record.handoffBaseAtEpochMs = null;
    record.handoffExpiresAtEpochMs = null;
    this.clearHandoffTimer(record.sessionId);
  }

  /**
   * Default persistent-cache policy resolution: delegate to the cache module
   * (scope ladder + opaque tokens, §13.5). Any failure disables the cache for
   * this session — a session never fails to start because the cache is broken.
   */
  private async defaultCachePolicy(
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ): Promise<WorkerBrowserStoragePolicy["persistentCache"]> {
    try {
      return await this.cacheModule.buildPersistentCachePolicy(
        accountId,
        chromeMajor,
        cacheEnabled
      );
    } catch (error) {
      log.warn(
        `[ManagedBrowserModule] cache policy unavailable: ${
          error instanceof Error ? error.name : "unknown"
        }`
      );
      return { enabled: false as const, reasonCode: "cache_unavailable" };
    }
  }

  /**
   * GAP-15: policy ladder + gated provider attempt for one challenge. The
   * provider is only consulted when the ladder authorizes it; ANY refusal
   * or failure keeps the browser in the manual handoff it is already in.
   * The solved token is NOT auto-applied (page-side application is the
   * remaining Phase-C.5 worker piece) — the attempt result is surfaced on
   * the safe status and the session stays in handoff for confirmation.
   */
  private async runChallengePolicy(
    record: ActiveSessionRecord,
    event: Extract<
      ManagedBrowserOutboundMessage,
      { type: "CHALLENGE_DETECTED" }
    >
  ): Promise<void> {
    try {
      const provider = getDefaultCaptchaProviderService();
      const config = await provider.getConfig();
      const decision = decideCaptchaResolution({
        sessionId: record.sessionId,
        challengeId: event.challengeId,
        origin: event.origin,
        platformId: record.platformId,
        challengeType: event.kind,
        flow: event.flowClassification,
        currentActionRisk: "read",
        providerInputAvailable: event.providerInputAvailable,
        providerConfig: {
          enabled: config.enabled,
          tokenPresent: config.tokenPresent,
          disclosureVersionAccepted: config.disclosureVersionAccepted,
          authorizedDomains: config.authorizedDomains,
          nonLoginChallengesAllowed: config.nonLoginChallengesAllowed,
        },
        attemptedChallengeIds: record.challengeAttempts,
      });
      if (decision.mode === "blocked") {
        record.lastErrorCode = "challenge_resolution_failed";
        return;
      }
      if (decision.mode === "provider") {
        const outcome = await provider.attemptSolve({
          challengeId: event.challengeId,
          origin: event.origin,
          siteKey: "",
          pageUrl: record.currentOrigin ?? event.origin,
          flow: event.flowClassification,
          currentActionRisk: "read",
        });
        log.info(
          `[ManagedBrowserModule] provider attempt: ${
            outcome.status
          } (${"reasonCode" in outcome ? outcome.reasonCode : "solved"})`
        );
      }
      // manual_handoff: nothing to do — the session is already in handoff.
    } catch (error) {
      log.warn(
        `[ManagedBrowserModule] challenge policy failed: ${
          error instanceof Error ? error.name : "unknown"
        }`
      );
    }
  }

  private async defaultAccountLookup(
    accountId: number
  ): Promise<AccountLookupResult | null> {
    try {
      // Lazy require avoids a module-load cycle with SocialAccountModule.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SocialAccountModule: Sam } =
        require("@/modules/socialAccountModule") as {
          SocialAccountModule: new () => {
            getAccountDetail(id: number): Promise<{
              status: string;
              data: {
                social_type_id: number;
                name: string;
                user: string;
              } | null;
            }>;
          };
        };
      const resp = await new Sam().getAccountDetail(accountId);
      if (resp.status !== "success" || !resp.data) {
        return null;
      }
      // Display name preferred; email avoided when a name exists (§8.4).
      return {
        platformId: resp.data.social_type_id,
        accountLabel: resp.data.name || resp.data.user,
        proxy: await resolveAccountProxy(accountId),
      };
    } catch (error) {
      log.warn(
        `[ManagedBrowserModule] account lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}

let defaultManagedBrowserModule: ManagedBrowserModule | null = null;

/**
 * Process singleton (design §7.1). Wiring the session stopper here means both
 * singletons share ONE cache module instance, so the `stop_and_clear` cache
 * decision can stop the live session for an account.
 */
export function getDefaultManagedBrowserModule(): ManagedBrowserModule {
  if (!defaultManagedBrowserModule) {
    const managedModule = new ManagedBrowserModule();
    getDefaultManagedBrowserCacheModule().setSessionStopper(
      async (accountId: number): Promise<boolean> => {
        const status = managedModule.getStatusByAccount(accountId);
        if (!status) {
          return true; // no live session — nothing to stop
        }
        try {
          await managedModule.stop(status.sessionId, "user_stop");
          return true;
        } catch {
          return false;
        }
      }
    );
    defaultManagedBrowserModule = managedModule;
  }
  return defaultManagedBrowserModule;
}

const ERROR_CODES: ReadonlySet<string> = new Set<string>([
  "ai_disabled",
  "managed_browser_disabled",
  "account_not_found",
  "account_in_use",
  "global_session_limit",
  "session_cookie_missing",
  "browser_dependency_missing",
  "browser_incompatible",
  "fingerprint_mismatch",
  "proxy_unavailable",
  "navigation_blocked",
  "authentication_required",
  "challenge_requires_handoff",
  "challenge_provider_not_authorized",
  "challenge_provider_unavailable",
  "challenge_provider_timeout",
  "challenge_resolution_failed",
  "stale_page_reference",
  "action_not_allowed",
  "user_has_control",
  "challenge_in_progress",
  "approval_required",
  "approval_expired",
  "result_too_large",
  "worker_protocol_violation",
  "worker_start_timeout",
  "worker_unresponsive",
  "chrome_disconnected",
  "worker_exited",
  "cancelled",
  "stop_timeout",
  "cookie_refresh_failed",
  "cookie_persistence_failed",
  "cache_disabled",
  "cache_incompatible",
  "cache_scope_active",
  "cache_clear_deferred",
  "cache_path_invalid",
  "cache_maintenance_failed",
  "cache_limit_invalid",
  "internal_error",
]);

function isErrorCode(value: string): value is ManagedBrowserErrorCode {
  return ERROR_CODES.has(value);
}

/** Worker wire form of a platform manifest (mutable arrays per the Zod type). */
interface WorkerPlatformDescriptor {
  platformId: number;
  platformName: string;
  loginUrl: string;
  verificationUrl: string;
  allowedDomainSuffixes: string[];
}

function toWorkerPlatform(
  manifest: PlatformSessionDefinition
): WorkerPlatformDescriptor {
  return {
    platformId: manifest.platformId,
    platformName: manifest.platformName,
    loginUrl: manifest.loginUrl,
    verificationUrl: manifest.verificationUrl,
    allowedDomainSuffixes: [...manifest.allowedDomainSuffixes],
  };
}

/** Copy a launch policy into the mutable wire form (readonly → mutable). */
function toWorkerLaunchPolicy(policy: BrowserLaunchPolicy): {
  headless: false;
  locale: string | null;
  timezoneId: string | null;
  viewport: { width: number; height: number };
  windowSize: { width: number; height: number };
  userAgentOverride: string | null;
  enabledStealthEvasions: string[];
  extraArgs: string[];
} {
  return {
    headless: policy.headless,
    locale: policy.locale,
    timezoneId: policy.timezoneId,
    viewport: { ...policy.viewport },
    windowSize: { ...policy.windowSize },
    userAgentOverride: policy.userAgentOverride,
    enabledStealthEvasions: [...policy.enabledStealthEvasions],
    extraArgs: [...policy.extraArgs],
  };
}

/**
 * Resolve the account's proxy (GAP-11): the FIRST usable http(s) proxy
 * wins; an account whose proxies exist but are none-usable marks the
 * session unresolvable (fail-closed, never silent direct).
 */
async function resolveAccountProxy(
  accountId: number
): Promise<ResolvedSessionProxy> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SocialAccountModule: Sam } =
      require("@/modules/socialAccountModule") as {
        SocialAccountModule: new () => {
          getAllSocialAccounts(): Promise<
            Array<{
              id: number;
              proxy?: Array<{
                host: string;
                port: string;
                user?: string | null;
                pass?: string | null;
                protocol?: string | null;
              }>;
            }>
          >;
        };
      };
    const accounts = await new Sam().getAllSocialAccounts();
    const account = accounts.find((a) => a.id === accountId);
    const proxies = account?.proxy ?? [];
    if (proxies.length === 0) {
      return { mode: "direct" };
    }
    for (const proxy of proxies) {
      const protocol = (proxy.protocol ?? "http").toLowerCase();
      const port = Number(proxy.port);
      if (
        (protocol === "http" || protocol === "https") &&
        proxy.host &&
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65535
      ) {
        return {
          mode: protocol,
          host: proxy.host,
          port,
          ...(proxy.user ? { username: proxy.user } : {}),
          ...(proxy.pass ? { password: proxy.pass } : {}),
        };
      }
    }
    return {
      mode: "unresolvable",
      reasonCode: "proxy_protocol_unsupported",
    };
  } catch (error) {
    log.warn(
      `[ManagedBrowserModule] proxy resolution failed: ${
        error instanceof Error ? error.name : "unknown"
      }`
    );
    // GAP-11 fail-closed: an account whose proxy state is UNREADABLE must
    // never silently fall back to a direct (real-IP) connection.
    return {
      mode: "unresolvable",
      reasonCode: "proxy_resolution_failed",
    };
  }
}

/** Default AI entitlement check (Token + USER_AI_ENABLED). */
function defaultIsAiEnabled(): boolean {
  try {
    return new Token().getValue(USER_AI_ENABLED) === "true";
  } catch {
    return false;
  }
}
