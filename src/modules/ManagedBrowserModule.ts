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
import {
  assertCommandAllowed,
  type ManagedBrowserCommandType,
} from "@/childprocess/managed-browser/ManagedBrowserRuntime";
import { normalizedCookieArraySchema } from "@/schemas/accountCookies";
import type { NormalizedCookie } from "@/schemas/accountCookies";
import type {
  BrowserActionProgram,
  ManagedBrowserOutboundMessage,
} from "@/schemas/worker/managedBrowser";
import type {
  BrowserLaunchPolicy,
  BrowserObservation,
  ManagedBrowserHandoffReason,
  ManagedBrowserSessionState,
  ManagedBrowserErrorCode,
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
  lastErrorCode: ManagedBrowserErrorCode | null;
}

interface AccountLookupResult {
  readonly platformId: number;
  readonly accountLabel: string;
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
  readonly resolveCachePolicy?: (
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ) => WorkerBrowserStoragePolicy["persistentCache"];
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
  private readonly resolveCachePolicy:
    | ((
        accountId: number,
        chromeMajor: number,
        cacheEnabled: boolean
      ) => WorkerBrowserStoragePolicy["persistentCache"])
    | undefined;

  private readonly sessions = new Map<string, ActiveSessionRecord>();

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
    this.resolveCachePolicy = deps.resolveCachePolicy;
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
        ? this.resolveCachePolicy(
            input.accountId,
            resolution.descriptor.majorVersion,
            effective.cacheEnabled
          )
        : { enabled: false as const, reasonCode: "cache_settings_deferred" };

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
        lastErrorCode: null,
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
      const reply = await client.request(
        {
          type: "START_SESSION",
          executable: resolution.descriptor,
          launchPolicy: toWorkerLaunchPolicy(buildDefaultLaunchPolicy()),
          storagePolicy: { temporaryProfilePath, persistentCache },
          platform: toWorkerPlatform(manifest),
          proxy: { mode: "direct" },
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
    return message.observation;
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
    await this.requestWorker(
      record,
      { type: "RESUME_HANDOFF" },
      MANAGED_BROWSER_TIMEOUTS.initialVerificationMs,
      (m) => m.type === "SESSION_STATE_CHANGED" || m.type === "HANDOFF_REQUIRED"
    );
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
        break;
      case "SESSION_READY":
        record.state = "ready";
        record.authenticated =
          event.assessment.state === "authenticated" ? true : null;
        record.pageRevision += 1;
        break;
      case "LOGIN_REQUIRED":
        record.state = "user_login_in_progress";
        record.authenticated = false;
        this.publishNotice(record, "login_required", "login-start", {
          accountLabel: record.accountLabel,
          platformLabel: record.platformLabel,
        });
        break;
      case "HANDOFF_REQUIRED":
        record.state = "handoff";
        record.handoffReason = event.reason;
        break;
      case "CHALLENGE_DETECTED":
        this.publishNotice(record, "challenge_detected", event.challengeId, {
          platformLabel: record.platformLabel,
        });
        record.state = "challenge_detected";
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
    this.pushStatus(record);
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
    this.noticePublisher.publish({
      sessionId: record.sessionId,
      conversationId: record.conversationId ?? "workspace",
      type,
      transitionNonce,
      messageArgs,
      requiresUserAction,
    });
  }

  private pushStatus(record: ActiveSessionRecord): void {
    this.emitStatus(this.toSafeStatus(record));
  }

  private toSafeStatus(record: ActiveSessionRecord): SafeManagedBrowserStatus {
    return {
      sessionId: record.sessionId,
      accountId: record.accountId,
      platformId: record.platformId,
      state: record.state,
      currentOrigin: record.currentOrigin,
      pageTitle: record.pageTitle,
      pageRevision: record.pageRevision,
      authenticated: record.authenticated,
      handoffReason: record.handoffReason,
      lastErrorCode: record.lastErrorCode,
    };
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

/** Default AI entitlement check (Token + USER_AI_ENABLED). */
function defaultIsAiEnabled(): boolean {
  try {
    return new Token().getValue(USER_AI_ENABLED) === "true";
  } catch {
    return false;
  }
}
