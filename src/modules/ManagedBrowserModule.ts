import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { log } from "@/modules/Logger";
import { Token } from "@/modules/token";
import {
  MANAGED_BROWSER_SESSION_FREE_MEMORY_MIN_BYTES,
  MANAGED_BROWSER_MAX_SESSIONS_PER_SITE_DEFAULT,
  MANAGED_BROWSER_ACTION_LIMITS,
  MANAGED_BROWSER_PILOT_PLATFORM_IDS,
  MANAGED_BROWSER_SESSION_ID_PREFIX,
  MANAGED_BROWSER_TIMEOUTS,
} from "@/config/managedBrowser";
import {
  PLATFORM_SESSION_MANIFEST,
  getPlatformManifest,
  matchesAllowedDomain,
  type PlatformSessionDefinition,
} from "@/modules/PlatformSessionManifest";
import { AccountSessionService } from "@/modules/AccountSessionService";
import { getDefaultBrowserAiAvailabilityService } from "@/service/browserDecision/BrowserAiAvailabilityService";
import {
  parseUrlIdentity,
  registrableDomainOf,
} from "@/service/browserDecision/RegistrableDomain";
import type { WorkerLoginRecipe } from "@/schemas/worker/managedBrowser";
import type { BrowserProxySelection } from "@/service/browserProxy/BrowserProxySelectionService";
import {
  selectProxyForSession,
  type ProxyRow,
} from "@/service/browserProxy/BrowserProxySelectionService";
import { ProxyCredentialCodec } from "@/modules/browserProxy/ProxyCredentialCodec";
import { ManagedBrowserSettingsModule } from "@/modules/ManagedBrowserSettingsModule";
import {
  ManagedBrowserLeaseService,
  getDefaultManagedBrowserLeaseService,
  accountLeaseKey,
  publicSessionLeaseKey,
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
  readonly accountId?: number;
  readonly purpose: string;
  /** T23/M-FR-07: owning agent task id for sub-agent driven sessions. */
  readonly agentTaskId?: string;
  /**
   * PRD P-FR-01: optional proxy choice at session start. Account
   * sessions default to their linked proxy; `direct`/different-proxy
   * requests for account sessions require confirmation (P-FR-03).
   */
  readonly proxy?: BrowserProxySelection;
  readonly requestedStartUrl?: string;
  readonly conversationId?: string;
}

export interface StartManagedBrowserOptions {
  /**
   * AI entry points must pass the provider-aware browser AI gate before any
   * work (FR-P0-012, PRD D-FR-01).
   */
  readonly aiEntryPoint?: boolean;
}

interface ActiveSessionRecord {
  readonly sessionId: string;
  readonly accountId: number;
  readonly platformId: number;
  readonly conversationId: string | null;
  /** F03: retained so the account-lease transfer keeps ownership. */
  readonly ownerAgentTaskId: string | null;
  readonly leaseToken: string;
  /** Lease key (account: or public:) used to release this session. */
  readonly leaseKey: string;
  /** Registrable domain for the per-site session cap (null = unknown). */
  readonly siteDomain: string | null;
  /** PRD P-FR-05: proxy switches used by this session (cap 3). */
  proxySwitchCount: number;
  /** Assigned once, right after construction (record needs the client ref). */
  client: ManagedBrowserWorkerClient;
  readonly accountLabel: string;
  readonly platformLabel: string;
  state: ManagedBrowserSessionState;
  currentOrigin: string | null;
  /** F18: the FULL sanitized URL (path/query) — a proxy switch must
   * reopen the page the user was on, not just its origin (P-FR-02). */
  currentUrl: string | null;
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
  /** Injectable free-memory probe for tests (PRD M-FR-06 admission). */
  readonly freemem?: () => number;
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
  private readonly freemem: () => number;
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

  /** P-FR-05: proxy switches per session lineage (capped at 3). */
  private readonly proxySwitchCounts = new Map<string, number>();
  /** P0-7: per-session switch serialization. */
  private readonly proxySwitchInFlight = new Set<string>();
  private readonly runnerOwnedSessions = new Map<string, string>();
  /**
   * P1/S-FR-04: the AUTHORITATIVE per-session redirect ledger — the
   * registrable domains the session actually visited (bounded). Extra-
   * domain proposals must come from THIS ledger, never from model text.
   */
  private readonly sessionRedirectLedger = new Map<string, Set<string>>();
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
    this.freemem = deps.freemem ?? (() => os.freemem());
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
  /**
   * PRD D-FR-15a: pin/unpin an observation epoch in the worker so its
   * element references stay resolvable across pending approvals and
   * handoffs. Best-effort: an old worker or a stopped session ignores it.
   */
  public async setObservationPin(
    sessionId: string,
    observationId: string | null,
    pinned: boolean
  ): Promise<void> {
    if (!observationId) {
      return;
    }
    const record = this.sessions.get(sessionId);
    if (!record || !record.client) {
      return;
    }
    await record.client
      .request(
        { type: "PIN_OBSERVATION", observationId, pinned },
        MANAGED_BROWSER_TIMEOUTS.singleActionMs,
        (m) => m.type === "SESSION_STATE_CHANGED"
      )
      .catch(() => undefined);
  }

  /** Unpin the session's latest observation (approval decided/resumed). */
  private unpinLastObservation(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    const observationId = record?.lastObservation?.observationId ?? null;
    if (observationId) {
      void this.setObservationPin(sessionId, observationId, false);
    }
  }

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

    // Zero is reserved internally for the ephemeral public browser. It is
    // never accepted as an account id at the tool/IPC boundary or sent to DB.
    const publicBrowsing = input.accountId === undefined;
    const accountId = input.accountId ?? 0;
    const account = publicBrowsing
      ? { platformId: 0, accountLabel: "Chrome" }
      : await this.accountLookup(accountId);
    if (!account) {
      throw new ManagedBrowserError("account_not_found");
    }

    // 4. Platform manifest + pilot allowlist.
    // F19/S-FR-05: the SITE REGISTRY is consulted FIRST — it replaces the
    // pilot allowlist, and a registered site IS a platform definition
    // (high-ID AI-created sites start account sessions without a static
    // manifest entry). The static manifest remains a fallback for seeded
    // rows.
    let siteMatch: import("@/modules/BrowserSiteModule").SiteMatch | null =
      null;
    if (!publicBrowsing) {
      const { getDefaultBrowserSiteModule } = await import(
        "@/modules/BrowserSiteModule"
      );
      siteMatch =
        (await getDefaultBrowserSiteModule().getSite(account.platformId)) ??
        null;
      if (!siteMatch) {
        throw new ManagedBrowserError(
          "managed_browser_disabled",
          "platform_not_in_pilot"
        );
      }
    }
    const manifest: PlatformSessionDefinition | undefined = publicBrowsing
      ? {
          platformId: 0,
          platformName: account.accountLabel,
          loginUrl: "about:blank",
          verificationUrl: "about:blank",
          allowedDomainSuffixes: [],
          requiredDomainSuffixes: [],
          browserProfileImportEnabled: false,
        }
      : (getPlatformManifest(account.platformId) ?? {
          platformId: siteMatch!.siteId,
          platformName: siteMatch!.name,
          loginUrl: siteMatch!.loginUrl ?? `https://${siteMatch!.registrableDomain}`,
          verificationUrl:
            siteMatch!.verificationUrl ??
            siteMatch!.loginUrl ??
            `https://${siteMatch!.registrableDomain}`,
          allowedDomainSuffixes: [...siteMatch!.allowedDomainSuffixes],
          requiredDomainSuffixes: [...siteMatch!.requiredDomainSuffixes],
          browserProfileImportEnabled: false,
        });

    // 4a. PRD P-FR-01: explicit proxy choice at session start. Selection
    // is fail-closed: SOCKS/unknown/unusable proxies are rejected, and an
    // account session moving off its linked proxy requires confirmation.
    let explicitProxy: ResolvedSessionProxy | null = null;
    if (input.proxy) {
      const linkedRows = await this.loadProxyRowsForAccount(accountId);
      const selection = await selectProxyForSession({
        selection: input.proxy,
        linkedProxies: linkedRows,
        loadProxyById: async (proxyId) =>
          (await this.loadProxyRowById(proxyId)) ?? null,
        isAccountSession: accountId > 0,
      });
      if (selection.status === "resolved") {
        explicitProxy = selection.proxy;
      } else if (selection.status === "confirmation_required") {
        throw new ManagedBrowserError(
          "proxy_confirmation_required",
          selection.reasonCode
        );
      } else {
        throw new ManagedBrowserError(
          selection.reasonCode === "proxy_not_found"
            ? "proxy_not_found"
            : "proxy_no_usable_proxy",
          selection.reasonCode
        );
      }
    }

    // 4b. GAP-11: an unresolvable account proxy FAILS the start before any
    // resource work — the session must never silently fall back to direct.
    if (account.proxy?.mode === "unresolvable" && !explicitProxy) {
      throw new ManagedBrowserError(
        "proxy_unavailable",
        account.proxy.reasonCode
      );
    }

    if (input.requestedStartUrl) {
      const decision = evaluateNavigationTarget(input.requestedStartUrl, {
        allowedOrigins: manifest.allowedDomainSuffixes,
        publicBrowsing,
      });
      if (!decision.allowed) throw new ManagedBrowserError("navigation_blocked", decision.reasonCode);
    }

    // 5. Account lease (exclusive per account; setting-backed global
    // limit). Account-free sessions lease under their OWN session id so
    // several public sessions can run in parallel (PRD M-FR-06).
    const sessionId = `${MANAGED_BROWSER_SESSION_ID_PREFIX}${uuidv4()
      .replace(/-/g, "")
      .slice(0, 16)}`;
    const sessionNonce = `nonce_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
    const leaseKey =
      accountId > 0 ? accountLeaseKey(accountId) : publicSessionLeaseKey(sessionId);
    // Free-memory admission check: each session is a worker plus a headed
    // Chrome (roughly 300-800 MB). Fail closed when memory is short.
    const freeMemoryBytes = this.freemem();
    if (freeMemoryBytes < MANAGED_BROWSER_SESSION_FREE_MEMORY_MIN_BYTES) {
      throw new ManagedBrowserError("insufficient_memory");
    }
    // Per-site cap (PRD M-FR-06): at most maxSessionsPerSite sessions per
    // registrable domain to limit rate-limit and CAPTCHA exposure.
    const requestedSiteDomain = this.deriveSessionSiteDomain(
      account.platformId,
      input.requestedStartUrl
    );
    if (requestedSiteDomain) {
      const effectiveSettings = await this.settings.getEffectiveSettings();
      const activeForSite = [...this.sessions.values()].filter(
        (existing) => existing.siteDomain === requestedSiteDomain
      ).length;
      if (activeForSite >= effectiveSettings.maxSessionsPerSite) {
        throw new ManagedBrowserError("site_limit_reached");
      }
    }
    // Setting-backed global limit (PRD M-FR-06). Defensive for injected
    // fakes in tests: apply only when the service and setting exist.
    const settingsForLimit = await this.settings.getEffectiveSettings();
    if (
      typeof this.leaseService.setGlobalLimit === "function" &&
      Number.isFinite(settingsForLimit.maxConcurrentSessions)
    ) {
      this.leaseService.setGlobalLimit(
        settingsForLimit.maxConcurrentSessions
      );
    }
    const lease = this.leaseService.acquire(leaseKey, {
      sessionId,
      ownerConversationId: input.conversationId ?? null,
      ownerAgentTaskId: input.agentTaskId ?? null,
    });
    if (lease.status === "already_active") {
      const existing = this.sessions.get(lease.sessionId);
      if (existing) {
        return this.toSafeStatus(existing);
      }
      this.leaseService.release(leaseKey, lease.sessionId, "");
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
      const persistentCache = publicBrowsing
        ? { enabled: false as const, reasonCode: "ephemeral_public_browser" }
        : this.resolveCachePolicy
        ? await this.resolveCachePolicy(
            accountId,
            resolution.descriptor.majorVersion,
            effective.cacheEnabled
          )
        : await this.defaultCachePolicy(
            accountId,
            resolution.descriptor.majorVersion,
            effective.cacheEnabled
          );

      // 8-9. Worker client + supervisor registration.
      const record: ActiveSessionRecord = {
        sessionId,
        accountId,
        platformId: account.platformId,
        conversationId: input.conversationId ?? null,
        ownerAgentTaskId: input.agentTaskId ?? null,
        leaseToken: lease.leaseToken,
        leaseKey,
        siteDomain: requestedSiteDomain,
        proxySwitchCount: 0,
        client: null as unknown as ManagedBrowserWorkerClient,
        accountLabel: account.accountLabel,
        platformLabel: manifest.platformName,
        state: "starting",
        currentOrigin: null,
        currentUrl: null,
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
        accountId,
        client,
        releaseLease: () => {
          // Lease release ONLY. The supervisor calls this BEFORE onTerminal;
          // deleting the session here would hide the record from
          // handleTerminalEvent (which owns the final status + notice +
          // deletion).
          this.leaseService.release(
            record.leaseKey,
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
      const snapshot = publicBrowsing
        ? { cookies: [] }
        : await this.sessionService.getDecryptedSnapshot(accountId);
      const allowedCookies = snapshot.cookies.filter((cookie) =>
        matchesAllowedDomain(cookie.domain, manifest.allowedDomainSuffixes)
      );
      let startCookies: NormalizedCookie[] = allowedCookies;
      const effectiveProxy = explicitProxy ?? account.proxy ?? null;
      const sessionProxy =
        effectiveProxy &&
        (effectiveProxy.mode === "http" || effectiveProxy.mode === "https")
          ? {
              mode: effectiveProxy.mode as "http" | "https",
              host: effectiveProxy.host,
              port: effectiveProxy.port,
              ...(effectiveProxy.username
                ? { username: effectiveProxy.username }
                : {}),
              ...(effectiveProxy.password
                ? { password: effectiveProxy.password }
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
          publicBrowsing,
        });
        if (navDecision.allowed) {
          const navigation = await this.requestWorker(
            record,
            {
              type: "RUN_ACTIONS",
              program: {
                actions: [{ type: "navigate", url: input.requestedStartUrl }],
              },
            },
            MANAGED_BROWSER_TIMEOUTS.navigationActionMs,
            (m) => m.type === "ACTION_RESULT" || m.type === "HANDOFF_REQUIRED"
          );
          if (navigation.type === "ACTION_RESULT" && navigation.results.some((step) => !step.success)) {
            throw new ManagedBrowserError("navigation_blocked", "start_navigation_failed");
          }
        } else {
          throw new ManagedBrowserError("action_not_allowed", navDecision.reasonCode);
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
        // Pre-record failure path (executable missing): the lease key is
        // still in scope; record.leaseKey does not exist yet.
        this.leaseService.release(leaseKey, sessionId, lease.leaseToken);
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
      /* eslint-disable @typescript-eslint/no-var-requires */
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
      /* eslint-enable @typescript-eslint/no-var-requires */
      // S-FR-05: eligible = the account's platform is a REGISTERED site.
      const { getDefaultBrowserSiteModule } = await import(
        "@/modules/BrowserSiteModule"
      );
      const siteModule = getDefaultBrowserSiteModule();
      const registeredIds = new Set(
        (await siteModule.listSites()).map((site) => site.siteId)
      );
      return accounts
        .filter((account) => registeredIds.has(account.social_type_id))
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
      record.state !== "user_login_in_progress" &&
      record.state !== "login_required"
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
    // PRD D-FR-15a: the pending work ended, so the pinned observation's
    // TTL restarts from now.
    this.unpinLastObservation(input.sessionId);
  }

  /**
   * F06: NON-consuming probe for a recorded approval decision — the
   * in-job approval wait polls this while the dialog is open. Same
   * matching/expiry rules as consume, nothing is deleted.
   */
  public peekApprovalForProgram(input: {
    readonly sessionId: string;
    readonly programDigest: string;
    readonly pageRevision: number;
  }): "approve" | "deny" | null {
    for (const entry of this.approvalDecisions.values()) {
      if (entry.sessionId !== input.sessionId) {
        continue;
      }
      if (this.now() - entry.recordedAtEpochMs > 10 * 60_000) {
        continue;
      }
      if (entry.decision === "deny") {
        return "deny";
      }
      if (
        entry.programDigest === null ||
        entry.programDigest !== input.programDigest ||
        entry.pageRevision === null ||
        entry.pageRevision !== input.pageRevision
      ) {
        continue;
      }
      return "approve";
    }
    return null;
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
      // Review fix: a NULL digest or revision NEVER matches — null-bound
      // approvals were wildcards that authorized any program/script.
      // Approvals must be recorded with their exact digest + revision.
      if (
        entry.programDigest === null ||
        entry.programDigest !== input.programDigest ||
        entry.pageRevision === null ||
        entry.pageRevision !== input.pageRevision
      ) {
        continue; // a stale/unbound approve for a DIFFERENT program never matches
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
    // Track the live origin for the sign-in site gate (A-FR-02) and the
    // approval fingerprint's site component (D-FR-27).
    record.currentOrigin = message.observation.origin || record.currentOrigin;
this.recordVisitedDomain(record, record.currentOrigin);
record.currentUrl = message.observation.url || record.currentUrl;
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
    const message = await this.requestWorker(
      record,
      { type: "RUN_ACTIONS", program },
      MANAGED_BROWSER_ACTION_LIMITS.programWallTimeMs,
      (m) => m.type === "ACTION_RESULT" || m.type === "HANDOFF_REQUIRED"
    );
    // PRD D-FR-11: cache the post-action observation and page revision
    // BEFORE the caller classifies the next action, so ref resolution and
    // risk classification use the live page state. A failed/older
    // snapshot can never replace a newer one.
    if (message.type === "ACTION_RESULT" && message.observation) {
      if (message.observation.pageRevision >= record.pageRevision) {
        record.pageRevision = message.observation.pageRevision;
        record.lastObservation = message.observation;
        record.currentOrigin = message.observation.origin || record.currentOrigin;
this.recordVisitedDomain(record, record.currentOrigin);
record.currentUrl = message.observation.url || record.currentUrl;
      }
    }
    return message;
  }

  /**
   * GAP-14: propagate job/conversation cancellation to the ACTIVE worker
   * request. The worker aborts the in-flight program between actions and
   * returns an outcome whose effect reflects uncertainty: with the
   * dispatch-phase classification in BrowserActionExecutor (PRD D-FR-26),
   * a cancellation/failure after input dispatch reports effect=unknown,
   * while a cancellation before any dispatch reports effect=known.
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

  /**
   * Renderer-facing screenshot capture (TODO-MSB-003/015): returns the
   * image for the EPHEMERAL latest-thumbnail view only. Denied in
   * sensitive handoff/login states (nothing identifiable leaves the page
   * while the user is entering credentials) and while a challenge is
   * unresolved.
   */
  public async captureSessionScreenshot(
    sessionId: string
  ): Promise<{ mimeType: string; base64: string }> {
    const record = this.requireSession(sessionId);
    const sensitive = new Set([
      "handoff",
      "user_login_in_progress",
      "verifying_manual_login",
      "login_required",
      "challenge_detected",
      "challenge_resolving",
    ]);
    if (sensitive.has(record.state)) {
      throw new ManagedBrowserError(
        "action_not_allowed",
        "screenshot_disabled_in_sensitive_state"
      );
    }
    return this.captureScreenshot(sessionId);
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
    // PRD D-FR-15a: keep the latest observation's refs resolvable for
    // the whole handoff window (may last up to 60 minutes).
    void this.setObservationPin(
      sessionId,
      record.lastObservation?.observationId ?? null,
      true
    );
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
    const priorState = record.state;
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
      record.authenticated = record.accountId === 0 ? null : true;
      this.publishNotice(
        record,
        "login_verified",
        "verify-done",
        { sessionSaved: record.accountId !== 0 && record.lastErrorCode !== "cookie_persistence_failed" },
        false
      );
      this.publishNotice(record, "task_resuming", "verify-resume", {}, false);
      // PRD D-FR-15a: pending work ended with the successful verification.
      this.unpinLastObservation(sessionId);
    } else {
      const returned =
        message.type === "SESSION_STATE_CHANGED" ? message.state : priorState;
      record.state =
        returned === "handoff" || returned === "user_login_in_progress" || returned === "login_required"
          ? returned
          : priorState === "handoff" || priorState === "login_required"
            ? priorState === "handoff" ? "handoff" : "login_required"
            : "user_login_in_progress";
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
    // PRD D-FR-15a: handoff ended; the pinned observation's TTL restarts.
    this.unpinLastObservation(sessionId);
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
    if (record.accountId === 0) return;
    try {
      const parsed = normalizedCookieArraySchema.safeParse(cookies);
      if (!parsed.success || parsed.data.length === 0) {
        return; // keep last valid snapshot
      }
      // F19: derive the cookie policy from the site registry when the
      // static manifest has no row (high-ID AI-created sites).
      const manifest =
        getPlatformManifest(record.platformId) ??
        (await this.deriveManifestFromSite(record.platformId));
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
          record.accountId !== 0 && event.assessment.state === "authenticated" ? true : null;
        record.pageRevision += 1;
        this.clearHandoffWindow(record);
        break;
      case "LOGIN_REQUIRED":
        // login_required is a NON-user-control state: the adapter says
        // the user is not authenticated and the automated sign-in flow
        // (browser_sign_in) is about to run. user_login_in_progress is
        // only set when the USER manually initiates login via handoff.
        record.state = "login_required";
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

  /** Raw (encrypted-at-rest) proxy rows linked to an account. */
  private async loadProxyRowsForAccount(accountId: number): Promise<ProxyRow[]> {
    if (accountId <= 0) {
      return [];
    }
    try {
      const { SocialAccountModule: Sam } = await import(
        "@/modules/socialAccountModule"
      );
      const accounts = await new Sam().getAllSocialAccounts();
      const account = accounts.find((a) => a.id === accountId);
      return (account?.proxy ?? []).map((row) => ({
        id: row.id,
        host: row.host,
        port: row.port,
        user: row.user ?? null,
        pass: row.pass ?? null,
        protocol: row.protocol ?? null,
        country_code: row.country_code ?? null,
      }));
    } catch (error) {
      log.warn(
        `[ManagedBrowserModule] proxy row lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  /** Load one proxy row by id (main process; pass stays encrypted). */
  private async loadProxyRowById(proxyId: number): Promise<ProxyRow | null> {
    try {
      const { ProxyModel } = await import("@/model/Proxy.model");
      const { Token } = await import("@/modules/token");
      const { USERSDBPATH } = await import("@/config/usersetting");
      const model = new ProxyModel(new Token().getValue(USERSDBPATH));
      const row = await model.getProxyById(proxyId);
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        host: row.host,
        port: row.port,
        user: row.user ?? null,
        pass: row.pass ?? null,
        protocol: row.protocol ?? null,
        country_code: row.country_code ?? null,
      };
    } catch (error) {
      log.warn(
        `[ManagedBrowserModule] proxy ${proxyId} lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /** P1/S-FR-04: record a visited origin's registrable domain (bounded). */
  private recordVisitedDomain(
    record: ActiveSessionRecord,
    origin: string | null
  ): void {
    if (!origin) {
      return;
    }
    try {
      const domain = registrableDomainOf(new URL(origin).hostname);
      if (!domain) {
        return;
      }
      let ledger = this.sessionRedirectLedger.get(record.sessionId);
      if (!ledger) {
        ledger = new Set<string>();
        this.sessionRedirectLedger.set(record.sessionId, ledger);
      }
      ledger.add(domain);
      if (ledger.size > 16) {
        // Bounded: drop the oldest insertion.
        const oldest = ledger.values().next().value;
        if (oldest !== undefined) {
          ledger.delete(oldest);
        }
      }
    } catch {
      /* unparsable origins are simply not recorded */
    }
  }

  /**
   * P1/S-FR-04: the session's authoritative visited-domain list for
   * extra-domain confirmation proposals.
   */
  public getSessionVisitedDomains(sessionId: string): readonly string[] {
    return [...(this.sessionRedirectLedger.get(sessionId) ?? [])];
  }

  /**
   * P1/S-FR-04: propose extra login domains from the session's
   * AUTHORITATIVE redirect ledger — model-supplied domain lists are
   * ignored; only domains the session actually visited are proposed for
   * confirmation.
   */
  public async proposeExtraDomainsFromSession(
    sessionId: string,
    siteId: number
  ): Promise<
    import("@/modules/BrowserSiteModule").SiteUpsertConfirmation | null
  > {
    const { getDefaultBrowserSiteModule } = await import(
      "@/modules/BrowserSiteModule"
    );
    return await getDefaultBrowserSiteModule().proposeAdditionalDomains({
      siteId,
      visitedDomains: this.getSessionVisitedDomains(sessionId),
    });
  }

  /**
   * F19/S-FR-05: a registered site IS a platform definition — derive
   * the session manifest from the registry row when no static manifest
   * exists for the platform id.
   */
  private async deriveManifestFromSite(
    platformId: number
  ): Promise<PlatformSessionDefinition | undefined> {
    try {
      const { getDefaultBrowserSiteModule } = await import(
        "@/modules/BrowserSiteModule"
      );
      const site = await getDefaultBrowserSiteModule().getSite(platformId);
      if (!site) {
        return undefined;
      }
      return {
        platformId: site.siteId,
        platformName: site.name,
        loginUrl: site.loginUrl ?? `https://${site.registrableDomain}`,
        verificationUrl:
          site.verificationUrl ??
          site.loginUrl ??
          `https://${site.registrableDomain}`,
        allowedDomainSuffixes:
          site.allowedDomainSuffixes.length > 0
            ? [...site.allowedDomainSuffixes]
            : [site.registrableDomain],
        requiredDomainSuffixes: [...site.requiredDomainSuffixes],
        browserProfileImportEnabled: false,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * T21/A-FR-11: after a successful automated sign-in, bind the account
   * to the live session so cookies persist for that account and the
   * session status shows the authenticated identity.
   */
  public async bindAccountToSession(
    sessionId: string,
    accountId: number
  ): Promise<void> {
    const record = this.requireSession(sessionId);
    if (record.accountId === accountId) {
      return; // already account-backed (same-session idempotency)
    }
    // F03: a session already bound to a DIFFERENT account must not be
    // silently re-bound — release and restart is the controlled path.
    if (record.leaseKey.startsWith("account:")) {
      throw new ManagedBrowserError("session_already_account_bound");
    }
    // R08/M-FR-06: swap the lease from public:<sessionId> to
    // account:<accountId> so account-lease exclusivity applies going
    // forward — a different session can no longer acquire the same
    // account while this session holds it.
    const oldKey = record.leaseKey;
    const newKey = accountLeaseKey(accountId);
    // F03: acquire FIRST and check EVERY discriminated outcome BEFORE
    // the old lease or the record is touched — a refused transfer must
    // leave the session exactly as it was (still public-leased).
    const acquireResult = this.leaseService.acquire(newKey, {
      sessionId,
      ownerConversationId: record.conversationId,
      ownerAgentTaskId: record.ownerAgentTaskId,
    });
    let leaseToken: string;
    if (acquireResult.status === "granted") {
      leaseToken = acquireResult.leaseToken;
    } else if (acquireResult.status === "already_active") {
      // The conversation already holds this account lease. Only THIS
      // session holding it is acceptable (recovery of a partial bind);
      // a SIBLING session holding it would mean two apparent
      // controllers — refuse.
      const existing = this.leaseService.findBySessionId(sessionId);
      if (!existing || existing.leaseKey !== newKey) {
        throw new ManagedBrowserError("account_in_use");
      }
      leaseToken = existing.leaseToken;
    } else {
      // account_in_use | global_limit_reached — refuse without
      // releasing the public lease or mutating the record.
      throw new ManagedBrowserError(
        acquireResult.status === "account_in_use"
          ? "account_in_use"
          : "global_session_limit"
      );
    }
    // The account lease is now held by THIS session. Release the old
    // public lease; a failed release (not_held/token_mismatch) leaves an
    // orphaned key — logged, never blocks the bind.
    const released = this.leaseService.release(
      oldKey,
      sessionId,
      record.leaseToken
    );
    if (released !== "released") {
      log.warn(
        `[ManagedBrowserModule] bind ${sessionId}: old lease ${oldKey} release -> ${released}`
      );
    }
    // P1/C-FR-13: every pre-publication step (account lookup, manifest,
    // worker acknowledgement) runs BEFORE the record mutates — a failure
    // rolls the account lease back and throws, never leaving a partially
    // committed bind.
    const rollbackAccountLease = (): void => {
      this.leaseService.release(newKey, sessionId, leaseToken);
    };
    let account: { platformId: number; accountLabel: string } | null = null;
    let bindManifest: PlatformSessionDefinition | undefined;
    try {
      account = await this.accountLookup(accountId);
      if (!account) {
        throw new ManagedBrowserError("account_not_found");
      }
      // F11: the account's platform definition reaches the WORKER too — a
      // still-public worker (platformId=0) never captures refreshed
      // cookies, so a signed_in result would lack the promised persistent
      // account session.
      bindManifest =
        getPlatformManifest(account.platformId) ??
        (await this.deriveManifestFromSite(account.platformId));
      if (!bindManifest) {
        throw new ManagedBrowserError(
          "managed_browser_disabled",
          "bind_manifest_missing"
        );
      }
      // P1: worker acknowledgement with ONE bounded retry — an uncertain
      // response is retried before the bind is declared complete; a final
      // failure throws (no false authenticated publication).
      const requestAck = (): Promise<unknown> =>
        record.client.request(
          {
            type: "BIND_PLATFORM",
            platform: toWorkerPlatform(bindManifest!),
            captureCookies: true,
          },
          MANAGED_BROWSER_TIMEOUTS.singleActionMs,
          (m) => m.type === "SESSION_STATE_CHANGED"
        );
      try {
        await requestAck();
      } catch {
        await requestAck();
      }
    } catch (error) {
      rollbackAccountLease();
      throw error;
    }
    // The worker acknowledged — NOW the record commits.
    (record as { leaseToken: string }).leaseToken = leaseToken;
    (record as { accountId: number; leaseKey: string }).leaseKey = newKey;
    (record as { accountId: number }).accountId = accountId;
    (record as { platformId: number; platformLabel: string }).platformId =
      account!.platformId;
    (record as { platformLabel: string }).platformLabel =
      bindManifest!.platformName;
    (record as { accountLabel: string }).accountLabel = account!.accountLabel;
    record.authenticated = true;
    this.pushStatus(record);
  }

  /**
   * T24/C-FR-05: user Pause — aborts the in-flight program between
   * actions (executed results preserved), moves the session to user
   * control (AI commands rejected), and pins the latest observation so
   * refs stay resolvable while paused.
   */
  public async pauseSession(sessionId: string): Promise<SafeManagedBrowserStatus> {
    const record = this.requireSession(sessionId);
    await record.client
      .request(
        { type: "PAUSE_REQUEST" },
        MANAGED_BROWSER_TIMEOUTS.singleActionMs,
        (m) => m.type === "SESSION_STATE_CHANGED" || m.type === "ACTION_RESULT"
      )
      .catch(() => undefined);
    // Session moves to user control via the handoff state.
    await this.requestHandoff(sessionId, "user_paused").catch(() => undefined);
    return this.toSafeStatus(this.requireSession(sessionId));
  }

  /**
   * PRD A-FR-08: send the privileged FILL_LOGIN_FORM request. The
   * credential payload is passed through verbatim to the worker and
   * NEVER logged here; the result carries outcome + stamps only.
   */
  public async fillLoginForm(
    sessionId: string,
    input: {
      mode: "login" | "register";
      allowedDomainSuffixes: string[];
      recipe: WorkerLoginRecipe | null;
      username: string;
      password: string;
    }
  ): Promise<{
    outcome: "success" | "wrong_credential" | "challenge" | "unknown";
    reasonCode: string | null;
    filledFieldStamps: string[];
    recipe: { formAction: string | null; usernameField: string; passwordField: string } | null;
  }> {
    const record = this.requireSession(sessionId);
    // R19/C-FR-05: guard() rejects commands when the session is in
    // handoff/user_login_in_progress (user control) — the credential
    // must never be typed while the user controls the browser.
    this.guard(record, "FILL_LOGIN_FORM");
    const message = await this.requestWorker(
      record,
      {
        type: "FILL_LOGIN_FORM",
        mode: input.mode,
        allowedDomainSuffixes: input.allowedDomainSuffixes,
        recipe: input.recipe,
        username: input.username,
        password: input.password,
      },
      MANAGED_BROWSER_TIMEOUTS.initialVerificationMs,
      (m) => m.type === "LOGIN_FORM_RESULT" || m.type === "HANDOFF_REQUIRED"
    );
    if (message.type !== "LOGIN_FORM_RESULT") {
      return { outcome: "unknown" as const, reasonCode: "handoff_required", filledFieldStamps: [], recipe: null };
    }
    return {
      outcome: message.outcome,
      reasonCode: message.reasonCode ?? null,
      filledFieldStamps: message.filledFieldStamps,
      recipe: message.recipe ?? null,
    };
  }

  /**
   * T22/P-FR-04: basic-mode health check for one proxy id. Uses the same
   * batch checker the UI/AI paths use; any failure is fail-closed false.
   */
  private async checkProxyHealthy(proxyId: number): Promise<boolean> {
    try {
      const { ProxyController } = await import("@/controller/proxy-controller");
      const controller = new ProxyController();
      const result = await controller.checkProxyBatch({
        proxyIds: [proxyId],
        // R12/P-FR-04: all required fields — undefined concurrency
        // produces NaN in the checker, launching zero workers.
        mode: "basic" as const,
        concurrency: 1,
        timeoutMs: 10_000,
      });      const results = result.results ?? [];
      return results.some((item) => item.basic === "pass");
    } catch (error) {
      log.warn(
        `[ManagedBrowserModule] proxy health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * PRD P-FR-02: controlled proxy switch. The session is stopped and a
   * fresh session starts with the new proxy under the same account (the
   * account cookies persist through the account session path). Capped at
   * three switches per session (P-FR-05); always fail-closed.
   */
  public async switchSessionProxy(
    sessionId: string,
    target: BrowserProxySelection,
    conversationId?: string
  ): Promise<SafeManagedBrowserStatus> {
    const record = this.requireSession(sessionId);
    if (
      conversationId &&
      record.conversationId &&
      record.conversationId !== conversationId
    ) {
      throw new ManagedBrowserError("session_not_owned");
    }
    // P0-7: serialize per session — two concurrent switches could
    // double-stop or start two sessions.
    if (this.proxySwitchInFlight.has(sessionId)) {
      throw new ManagedBrowserError("proxy_switch_in_progress");
    }
    this.proxySwitchInFlight.add(sessionId);
    try {
      return await this.switchSessionProxyInner(
        sessionId,
        record,
        target,
        record.conversationId ?? undefined
      );
    } finally {
      this.proxySwitchInFlight.delete(sessionId);
    }
  }

  /** P0-7: the serialized switch body (validation BEFORE stop). */
  private async switchSessionProxyInner(
    sessionId: string,
    record: ActiveSessionRecord,
    target: BrowserProxySelection,
    conversation: string | undefined
  ): Promise<SafeManagedBrowserStatus> {
    const accountId = record.accountId;
    // T10/F18: the switch reopens the page the user was on (P-FR-02) —
    // the FULL URL with path/query, not just the origin.
    const lastUrl = record.currentUrl ?? record.currentOrigin ?? undefined;
    // P-FR-05: the cap is per SESSION LINEAGE, not per record — each
    // switch stops this record and starts a fresh one, so the count is
    // carried in a module-level map keyed by the lineage.
    const lineageKey = `${conversation ?? "public"}:${accountId}:${record.platformId}`;
    const priorCount = this.proxySwitchCounts.get(lineageKey) ?? 0;
    if (priorCount >= 3) {
      throw new ManagedBrowserError("proxy_switch_limit");
    }
    this.proxySwitchCounts.set(lineageKey, priorCount + 1);
    // P0-7/P-FR-04: prevalidate the TARGET SELECTION before destroying the
    // working session — selection failures (confirmation required, SOCKS,
    // unusable credentials, auto with no candidates) run while the old
    // session is still alive; a refused switch leaves it untouched.
    const linkedRows = await this.loadProxyRowsForAccount(accountId);
    const selection = await selectProxyForSession({
      selection: target,
      linkedProxies: linkedRows,
      loadProxyById: async (proxyId) =>
        (await this.loadProxyRowById(proxyId)) ?? null,
      isAccountSession: accountId > 0,
    });
    if (selection.status === "confirmation_required") {
      throw new ManagedBrowserError(
        "proxy_confirmation_required",
        selection.reasonCode
      );
    }
    if (selection.status === "unresolvable") {
      throw new ManagedBrowserError(
        "proxy_no_usable_proxy",
        selection.reasonCode
      );
    }
    // P0-7: start receives the VALIDATED resolved proxy. The module's
    // explicitProxy input accepts the {mode,host,port,...} shape
    // directly (ResolvedSessionProxy minus direct/unresolvable).
    const validatedTarget =
      selection.status === "resolved"
        ? (selection.proxy.mode === "direct"
            ? target
            : (selection.proxy as unknown as BrowserProxySelection))
        : target;
    if (target.kind === "proxy_id") {
      const healthy = await this.checkProxyHealthy(target.proxyId);
      if (!healthy) {
        throw new ManagedBrowserError("proxy_no_usable_proxy", "proxy_check_failed");
      }
    }
    await this.stop(sessionId, "user_stop");
    try {
      return await this.start({
        ...(accountId > 0 ? { accountId } : {}),
        purpose: "proxy_switch",
        proxy: validatedTarget,
        ...(conversation ? { conversationId: conversation } : {}),
        ...(lastUrl && lastUrl !== "about:blank"
          ? { requestedStartUrl: lastUrl }
          : {}),
      });
    } catch (startError) {
      // P0-7: a start failure after a validated switch must not leave the
      // user session-less — restore a session on the same lineage.
      try {
        await this.start({
          ...(accountId > 0 ? { accountId } : {}),
          purpose: "proxy_switch_restore",
          proxy: validatedTarget,
          ...(conversation ? { conversationId: conversation } : {}),
        });
      } catch {
        // restoration failed — the original error is surfaced
      }
      throw startError;
    }
  }

  /**
   * Registrable domain used for the per-site session cap: the requested
   * start URL when present, otherwise the platform's known login URL.
   */
  private deriveSessionSiteDomain(
    platformId: number,
    requestedStartUrl: string | undefined
  ): string | null {
    if (requestedStartUrl) {
      return parseUrlIdentity(requestedStartUrl)?.registrableDomain ?? null;
    }
    const manifest = PLATFORM_SESSION_MANIFEST.find(
      (entry) => entry.platformId === platformId
    );
    return manifest
      ? parseUrlIdentity(manifest.loginUrl)?.registrableDomain ?? null
      : null;
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
      ownerConversationId: record.conversationId,
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
        current.state !== "user_login_in_progress" &&
        current.state !== "login_required"
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
    // Review fix: mark the challenge attempted only AFTER the ladder reads
    // the attempted set — adding it first made every challenge look
    // already-attempted and killed the provider path entirely.
    const finish = (): void => {
      record.challengeAttempts.add(event.challengeId);
    };
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
      finish();
      if (decision.mode === "blocked") {
        record.lastErrorCode = "challenge_resolution_failed";
        return;
      }
      if (decision.mode === "provider") {
        const outcome = await provider.attemptSolve({
          challengeId: event.challengeId,
          origin: event.origin,
          siteKey: event.siteKey ?? "",
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
      finish();
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
      /* eslint-disable @typescript-eslint/no-var-requires */
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
      /* eslint-enable @typescript-eslint/no-var-requires */
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
  "insufficient_memory",
  "site_limit_reached",
  "session_not_owned",
  "proxy_confirmation_required",
  "proxy_not_found",
  "proxy_no_usable_proxy",
  "proxy_switch_limit",
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
    /* eslint-disable @typescript-eslint/no-var-requires */
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
    /* eslint-enable @typescript-eslint/no-var-requires */
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
        // P-FR-08: the stored pass may be FieldCipher-encrypted; only
        // a main-process decryption ever reaches the browser launch.
        const decrypted = await ProxyCredentialCodec.decryptForUse(
          proxy.pass ?? null
        );
        return {
          mode: protocol as "http" | "https",
          host: proxy.host,
          port,
          ...(proxy.user ? { username: proxy.user } : {}),
          ...(decrypted.password
                    ? { password: decrypted.password }
                    : {}),
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

/**
 * Default AI entitlement check for AI-entry-point sessions (PRD D-FR-01):
 * provider-aware — hosted entitlement OR a valid custom provider. This is the
 * product-authorized browser exception to the blanket hosted-only rule.
 */
function defaultIsAiEnabled(): boolean {
  try {
    return getDefaultBrowserAiAvailabilityService().isAvailable();
  } catch {
    return false;
  }
}
