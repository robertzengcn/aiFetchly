import * as crypto from "node:crypto";
import * as fs from "node:fs";
import type { z } from "zod";
import {
  MANAGED_BROWSER_PROTOCOL_VERSION,
  MANAGED_BROWSER_SCREENSHOT_POLICY,
} from "@/config/managedBrowser";
import type {
  AuthenticationAssessment,
  BrowserObservation,
  ManagedBrowserErrorCode,
  ManagedBrowserSessionState,
} from "@/entityTypes/managedBrowserTypes";
import type {
  BrowserActionProgram,
  ManagedBrowserInboundMessage,
  ManagedBrowserOutboundMessage,
} from "@/schemas/worker/managedBrowser";
import { authenticationAssessmentSchema } from "@/schemas/worker/managedBrowser";
import {
  buildDefaultLaunchPolicy,
  composeLaunchArgs,
  validateFingerprint,
} from "@/childprocess/managed-browser/BrowserFingerprintPolicy";
import type { FingerprintSelfTestEvidence } from "@/entityTypes/managedBrowserTypes";
import {
  convertCookieBatch,
  fromCapturedCookies,
  matchesDomainSuffix,
  type CapturedBrowserCookie,
} from "@/childprocess/managed-browser/cookieTransfer";
import { ManagedBrowserRuntime } from "@/childprocess/managed-browser/ManagedBrowserRuntime";
import {
  buildObservation,
  type ObservationPageLike,
} from "@/childprocess/managed-browser/BrowserObservationService";
import { PageReferenceRegistry } from "@/childprocess/managed-browser/PageReferenceRegistry";
import type {
  ExecutorElementHandle,
  ExecutorPageLike,
} from "@/childprocess/managed-browser/BrowserActionExecutor";
import { BrowserActionExecutor } from "@/childprocess/managed-browser/BrowserActionExecutor";
import { YouTubeBrowserAdapter } from "@/childprocess/managed-browser/adapters/YouTubeBrowserAdapter";
import type { PlatformBrowserAdapter } from "@/childprocess/managed-browser/adapters/PlatformBrowserAdapter";
import {
  redactSecrets,
  toSafeErrorMessage,
  truncateText,
} from "@/childprocess/managed-browser/ResultSanitizer";

/**
 * Managed-browser worker session (technical design §4 worker column).
 *
 * ONE session per disposable utility process. Owns the Puppeteer Browser, its
 * single controlled page, the reference registry, and the runtime state
 * machine. NEVER imports a Model/Module, Electron `app`, or `safeStorage`;
 * never touches the database; never decides approvals.
 *
 * Cookie payloads exist only inside START_SESSION handling and the private
 * REFRESHED_COOKIES send — never in logs or errors.
 */

// Structural Puppeteer types (kept local so tests can fake them).

/** Structural Puppeteer Frame: enough to identify the MAIN frame. */
export interface PuppeteerFrameLike {
  /** Main frame returns null; sub-frames return their parent. */
  parentFrame?(): PuppeteerFrameLike | null;
}

export interface PuppeteerDialogLike {
  dismiss(): Promise<void>;
}

export interface PuppeteerPopupLike {
  close(): Promise<void>;
}

export interface PuppeteerDownloadLike {
  cancel(): Promise<void>;
}

export interface PuppeteerPageLike
  extends ObservationPageLike,
    ExecutorPageLike {
  /** Main-frame + sub-frame navigation events (used to invalidate refs). */
  on(
    event: "framenavigated",
    listener: (frame: PuppeteerFrameLike) => void
  ): unknown;
  /** Browser-created states (GAP-13): deny-by-default policies. */
  on(event: "dialog", listener: (dialog: PuppeteerDialogLike) => void): unknown;
  on(event: "popup", listener: (popup: PuppeteerPopupLike) => void): unknown;
  on(
    event: "download",
    listener: (download: PuppeteerDownloadLike) => void
  ): unknown;
  screenshot(options?: {
    type?: "jpeg" | "png";
    quality?: number;
  }): Promise<Buffer>;
  authenticate?(credentials: {
    username: string;
    password: string;
  }): Promise<void>;
  close(): Promise<void>;
  bringToFront(): Promise<void>;
}

export interface PuppeteerContextLike {
  setCookie(cookie: Record<string, unknown>): Promise<void>;
  cookies(): Promise<CapturedBrowserCookie[]>;
  close(): Promise<void>;
}

export interface PuppeteerBrowserLike {
  /** Chrome process crash/close notification (GAP-06 containment). */
  on(event: "disconnected", listener: () => void): unknown;
  newPage(): Promise<PuppeteerPageLike>;
  pages(): Promise<PuppeteerPageLike[]>;
  close(): Promise<void>;
  defaultBrowserContext(): PuppeteerContextLike;
  process(): { pid: number | undefined } | null;
}

export interface LaunchBrowserOptions {
  readonly executablePath: string;
  readonly headless: false;
  readonly userDataDir: string;
  readonly args: readonly string[];
  readonly defaultViewport: { readonly width: number; readonly height: number };
  readonly env?: Record<string, string>;
}

export type LaunchBrowserFn = (
  options: LaunchBrowserOptions
) => Promise<PuppeteerBrowserLike>;

export interface WorkerSessionDeps {
  readonly sessionId: string;
  readonly sessionNonce: string;
  readonly send: (message: ManagedBrowserOutboundMessage) => void;
  readonly launchBrowser?: LaunchBrowserFn;
  readonly now?: () => number;
}

type StartSessionPayload = Extract<
  ManagedBrowserInboundMessage,
  { type: "START_SESSION" }
>;

export class WorkerSession {
  public readonly sessionId: string;
  private readonly sessionNonce: string;
  private readonly send: (message: ManagedBrowserOutboundMessage) => void;
  private readonly launch: LaunchBrowserFn | undefined;
  private readonly now: () => number;
  private readonly runtime: ManagedBrowserRuntime;
  private readonly registry =
    new PageReferenceRegistry<ExecutorElementHandle>();
  private readonly executor = new BrowserActionExecutor();
  private readonly adapter: PlatformBrowserAdapter =
    new YouTubeBrowserAdapter();

  private browser: PuppeteerBrowserLike | null = null;
  private page: PuppeteerPageLike | null = null;
  private platformDefinition: StartSessionPayload["platform"] | null = null;
  private storagePolicy: StartSessionPayload["storagePolicy"] | null = null;
  private executableVersion = "";
  private cancelled = false;
  private currentRunActionsAbort: AbortController | null = null;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private sequence = 0;
  /** GAP-05: redirect storms emit ONE challenge — dedupe by kind+origin. */
  private lastChallengeKey: string | null = null;
  private lastChallengeAtEpochMs = 0;

  constructor(deps: WorkerSessionDeps) {
    this.sessionId = deps.sessionId;
    this.sessionNonce = deps.sessionNonce;
    this.send = deps.send;
    this.launch = deps.launchBrowser;
    this.now = deps.now ?? Date.now;
    this.runtime = new ManagedBrowserRuntime("starting");
  }

  public get state(): ManagedBrowserSessionState {
    return this.runtime.getState();
  }

  // -----------------------------------------------------------------------
  // START_SESSION
  // -----------------------------------------------------------------------

  public async startSession(payload: StartSessionPayload): Promise<void> {
    if (this.browser) {
      this.emitError(
        payload.requestId,
        "action_not_allowed",
        "session already started"
      );
      return;
    }
    this.platformDefinition = payload.platform;
    this.storagePolicy = payload.storagePolicy;
    this.executableVersion = payload.executable.version;
    try {
      this.runtime.transition("validating_fingerprint");

      const { launchPolicy, proxy, storagePolicy } = payload;
      const proxyServer =
        proxy && proxy.mode !== "direct"
          ? `${proxy.mode}://${proxy.host}:${proxy.port}`
          : null;
      const diskCacheDir = storagePolicy.persistentCache.enabled
        ? storagePolicy.persistentCache.cachePath
        : null;
      const args = composeLaunchArgs(launchPolicy, {
        userDataDir: storagePolicy.temporaryProfilePath,
        diskCacheDir,
        proxyServer,
      });
      const launch = this.launch ?? defaultLaunchBrowser;
      const browser = await launch({
        executablePath: payload.executable.path,
        headless: false,
        userDataDir: storagePolicy.temporaryProfilePath,
        args,
        defaultViewport: {
          width: launchPolicy.viewport.width,
          height: launchPolicy.viewport.height,
        },
        env: launchPolicy.timezoneId
          ? { ...envRecord(), TZ: launchPolicy.timezoneId }
          : envRecord(),
      });
      this.browser = browser;
      browser.on("disconnected", () => {
        void this.handleChromeDisconnected();
      });

      const pages = await browser.pages();
      this.page = pages[0] ?? (await browser.newPage());
      this.watchPageNavigations(this.page);
      if (
        proxy &&
        proxy.mode !== "direct" &&
        proxy.username &&
        this.page.authenticate
      ) {
        // Proxy credentials go through CDP auth — never argv (design §12.1).
        await this.page.authenticate({
          username: proxy.username,
          password: proxy.password ?? "",
        });
      }
      await this.page.bringToFront().catch(() => undefined);

      if (storagePolicy.persistentCache.enabled) {
        this.send({
          ...this.base(`evt-cache-open-${this.sessionNonce}`),
          type: "CACHE_OPENED",
          scopeToken: storagePolicy.persistentCache.scopeToken,
          namespace: storagePolicy.persistentCache.namespace,
        });
      }

      // --- Fingerprint self-test BEFORE any platform navigation (§11.2) ---
      const evidence = await this.collectSelfTestEvidence();
      const validation = validateFingerprint({
        descriptor: payload.executable,
        launchPolicy,
        evidence,
        composedArgs: args,
      });
      if (validation.result !== "pass") {
        await this.dispose("fingerprint_mismatch");
        this.emitError(
          payload.requestId,
          "fingerprint_mismatch",
          validation.reasonCodes.join(",")
        );
        return;
      }

      // --- Apply cookies BEFORE first platform navigation (FR-COOKIE-012) ---
      this.runtime.transition("applying_session");
      const batch = convertCookieBatch(payload.cookies);
      const context = this.browser.defaultBrowserContext();
      let appliedCount = 0;
      let rejectedCount = batch.rejectedCount;
      for (const cookie of batch.accepted) {
        try {
          await context.setCookie(cookie as unknown as Record<string, unknown>);
          appliedCount++;
        } catch {
          rejectedCount++;
        }
      }

      // --- Navigate to the platform verification URL ---
      this.runtime.transition("verifying_login");
      await this.page.goto(this.adapter.verificationUrl, {
        timeoutMs: 45_000,
        waitUntil: "domcontentloaded",
      });
      const assessment = await this.adapter.assessAuthentication(this.page);

      switch (assessment.state) {
        case "authenticated": {
          await this.captureAndSendRefreshedCookies(payload.requestId);
          this.runtime.transition("ready");
          this.registry.reset(this.runtime.pageRevision + 1);
          this.send({
            ...this.base(payload.requestId),
            type: "SESSION_READY",
            fingerprintResult: "pass",
            fingerprintReasonCodes: [],
            appliedCookieCount: appliedCount,
            rejectedCookieCount: rejectedCount,
            assessment: toTransportAssessment(assessment),
            identity: {
              sessionId: this.sessionId,
              sessionNonce: this.sessionNonce,
              workerPid: process.pid,
              browserPid: this.browser.process()?.pid ?? 0,
              executableSha256: this.computeExecutableFingerprint(
                payload.executable.path
              ),
              executableVersion: payload.executable.version,
              launchedAtEpochMs: this.now(),
            },
          });
          return;
        }
        case "unauthenticated":
        case "unknown": {
          // Same-context manual login handoff (FR-HANDOFF-001).
          this.runtime.transition("login_required");
          this.runtime.transition("user_login_in_progress");
          this.send({
            ...this.base(payload.requestId),
            type: "LOGIN_REQUIRED",
            reasonCode:
              assessment.state === "unauthenticated"
                ? "unauthenticated"
                : "verification_unknown",
          });
          return;
        }
        case "challenge": {
          this.runtime.transition("challenge_detected");
          const challengeId = `ch_${crypto.randomUUID().slice(0, 12)}`;
          this.send({
            ...this.base(`evt-challenge-${challengeId}`),
            type: "CHALLENGE_DETECTED",
            challengeId,
            origin: new URL(this.page.url()).origin,
            kind: assessment.challenge,
            flowClassification: "login",
            evidenceCodes: ["login_challenge_assessment"],
            providerInputAvailable: false,
          });
          this.runtime.transition("handoff");
          this.send({
            ...this.base(payload.requestId),
            type: "HANDOFF_REQUIRED",
            reason: "captcha_sensitive_flow",
            challenge: {
              challengeId,
              kind: assessment.challenge,
              evidenceCodes: ["login_challenge_assessment"],
            },
          });
          return;
        }
        default:
          await this.dispose("verification_failed");
          this.emitError(payload.requestId, "internal_error", "bad assessment");
      }
    } catch (error) {
      await this.dispose("start_failed");
      this.emitError(
        payload.requestId,
        "browser_dependency_missing",
        toSafeErrorMessage(error)
      );
    }
  }

  // -----------------------------------------------------------------------
  // Commands
  // -----------------------------------------------------------------------

  public async observe(requestId: string): Promise<void> {
    const page = this.requirePage(requestId);
    if (!page) {
      return;
    }
    try {
      const observation = await this.buildObservation(page);
      this.send({
        ...this.base(requestId),
        type: "OBSERVATION_RESULT",
        observation: {
          ...observation,
          elements: [...observation.elements],
          notices: [...observation.notices],
        },
      });
    } catch (error) {
      this.emitError(requestId, "internal_error", toSafeErrorMessage(error));
    }
  }

  public async runActions(
    requestId: string,
    program: BrowserActionProgram
  ): Promise<void> {
    const page = this.requirePage(requestId);
    if (!page) {
      return;
    }
    if (this.runtime.getState() === "ready") {
      this.runtime.transition("running");
    }
    const abort = new AbortController();
    this.currentRunActionsAbort = abort;
    try {
      const outcome = await this.executor.executeProgram(program, {
        page,
        registry: this.registry,
        navigation: {
          allowedOrigins: [
            ...this.adapter.allowedOrigins,
            ...this.adapter.loginOrigins,
          ],
        },
        shouldCancel: () => this.cancelled || abort.signal.aborted,
        now: this.now,
      });
      this.send({
        ...this.base(requestId),
        type: "ACTION_RESULT",
        effect: outcome.effect,
        pageRevision: outcome.pageRevision,
        results: [...outcome.results],
        observation: null,
      });
      // GAP-05: challenges appearing after an ordinary action must stop
      // further automation — detect AFTER every action program, before the
      // runtime returns to ready.
      if (
        outcome.stopCode !== "handoff_required" &&
        (await this.detectAndReportChallenge())
      ) {
        return;
      }
      if (outcome.stopCode === "handoff_required") {
        this.runtime.transition("handoff");
        this.send({
          ...this.base(requestId),
          type: "HANDOFF_REQUIRED",
          reason: "password_field",
          challenge: null,
        });
      } else if (this.runtime.getState() === "running") {
        this.runtime.transition("ready");
      }
    } catch (error) {
      this.emitError(requestId, "internal_error", toSafeErrorMessage(error));
    } finally {
      this.currentRunActionsAbort = null;
    }
  }

  /**
   * GAP-12 (design §16): privileged page-context script execution.
   * The source runs as PAGE JavaScript ONLY (page.evaluate) — Node,
   * Electron, filesystem, and Puppeteer APIs are structurally
   * unreachable. Bounded window, redacted + budgeted result, and every
   * reference invalidated afterwards (the script may mutate the DOM).
   */
  public async evaluateScript(
    requestId: string,
    source: string,
    timeoutMs: number
  ): Promise<void> {
    const page = this.requirePage(requestId);
    if (!page) {
      return;
    }
    const state = this.runtime.getState();
    if (state !== "ready" && state !== "running") {
      this.emitError(
        requestId,
        "action_not_allowed",
        "script requires a ready session"
      );
      return;
    }
    const startedAt = this.now();
    try {
      const result = await Promise.race([
        page.evaluate<unknown>(source),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs).unref?.()
        ),
      ]);
      if (result === null && this.now() - startedAt >= timeoutMs) {
        this.send({
          ...this.base(requestId),
          type: "EVALUATE_SCRIPT_RESULT",
          ok: false,
          resultSummary: null,
          resultBytes: 0,
          truncated: false,
        });
        return;
      }
      const redacted = redactSecrets(result);
      let serialized: string;
      try {
        serialized = JSON.stringify(redacted) ?? "null";
      } catch {
        serialized = "[unserializable]";
      }
      const budget = truncateText(serialized, 4_096);
      this.registry.reset(this.registry.currentRevision + 1);
      this.send({
        ...this.base(requestId),
        type: "EVALUATE_SCRIPT_RESULT",
        ok: true,
        resultSummary: budget.text,
        resultBytes: serialized.length,
        truncated: budget.truncated,
      });
    } catch (error) {
      this.emitError(requestId, "internal_error", toSafeErrorMessage(error));
    }
  }

  public async captureScreenshot(requestId: string): Promise<void> {
    const page = this.requirePage(requestId);
    if (!page) {
      return;
    }
    try {
      const buffer = await page.screenshot({
        type: MANAGED_BROWSER_SCREENSHOT_POLICY.format,
        quality: MANAGED_BROWSER_SCREENSHOT_POLICY.quality,
      });
      this.send({
        ...this.base(requestId),
        type: "SCREENSHOT_RESULT",
        mimeType: `image/${MANAGED_BROWSER_SCREENSHOT_POLICY.format}`,
        base64: buffer.toString("base64").slice(0, 12_000_000),
      });
    } catch (error) {
      this.emitError(requestId, "internal_error", toSafeErrorMessage(error));
    }
  }

  public beginHandoff(requestId: string, reason: string): void {
    if (!this.runtime.transition("handoff", reason)) {
      this.emitError(requestId, "action_not_allowed", "cannot begin handoff");
      return;
    }
    this.send({
      ...this.base(requestId),
      type: "SESSION_STATE_CHANGED",
      state: "handoff",
      reasonCode: reason,
    });
  }

  public async resumeFromHandoff(requestId: string): Promise<void> {
    if (this.runtime.getState() !== "handoff") {
      this.emitError(requestId, "action_not_allowed", "not in handoff");
      return;
    }
    this.runtime.transition("verifying_login");
    const assessment = await this.assess();
    if (assessment.state === "authenticated") {
      this.runtime.transition("ready");
      this.registry.reset(this.runtime.pageRevision + 1);
      this.send({
        ...this.base(requestId),
        type: "SESSION_STATE_CHANGED",
        state: "ready",
        reasonCode: "handoff_resumed",
      });
    } else {
      this.runtime.transition("handoff");
      this.send({
        ...this.base(requestId),
        type: "HANDOFF_REQUIRED",
        reason: "login_expired",
        challenge: null,
      });
    }
  }

  /**
   * Manual-login verification (§13.2): NEVER a blind resume — the adapter
   * must confirm authentication; success captures + returns refreshed
   * cookies before AI control resumes.
   */
  public async verifyManualLogin(requestId: string): Promise<void> {
    const page = this.requirePage(requestId);
    if (!page) {
      return;
    }
    if (this.runtime.getState() !== "user_login_in_progress") {
      this.emitError(requestId, "action_not_allowed", "not in manual login");
      return;
    }
    this.runtime.transition("verifying_manual_login");
    const assessment = await this.assess();
    if (assessment.state === "authenticated") {
      await this.captureAndSendRefreshedCookies(requestId);
      this.runtime.transition("ready");
      this.registry.reset(this.runtime.pageRevision + 1);
      this.send({
        ...this.base(requestId),
        type: "SESSION_STATE_CHANGED",
        state: "ready",
        reasonCode: "manual_login_verified",
      });
      return;
    }
    // not_verified / challenge / unknown → user keeps control.
    this.runtime.transition("user_login_in_progress");
    this.send({
      ...this.base(requestId),
      type: "SESSION_STATE_CHANGED",
      state: "user_login_in_progress",
      reasonCode:
        assessment.state === "unauthenticated"
          ? "not_verified"
          : assessment.state === "challenge"
          ? "challenge"
          : "verification_unknown",
    });
  }

  public cancelCurrent(): void {
    this.cancelled = true;
    this.currentRunActionsAbort?.abort();
  }

  public async stop(requestId: string, reason: string): Promise<void> {
    // Stop is idempotent in every state.
    this.runtime.transition("stopping", reason);
    // Orderly close: capture refreshed cookies when safe (FR-COOKIE-016).
    try {
      if (this.browser && this.page && !this.cancelled) {
        await this.captureAndSendRefreshedCookies(requestId);
      }
    } catch {
      // Cookie-capture failure must not keep Chrome alive (§8.8).
    }
    const terminal =
      reason === "cancelled"
        ? "cancelled"
        : reason === "error"
        ? "failed"
        : "completed";
    await this.dispose(reason);
    this.runtime.transition("stopped");
    this.send({
      ...this.base(requestId),
      type: "SESSION_STOPPED",
      terminalState: terminal,
      reasonCode: reason,
    });
  }

  /** Idempotent cleanup — every terminal path converges here (§8.5). */
  public async dispose(cause: string): Promise<void> {
    if (this.disposed) {
      return this.disposePromise ?? Promise.resolve();
    }
    this.disposed = true;
    this.disposePromise = this.doDispose(cause);
    return this.disposePromise;
  }

  private async doDispose(cause: string): Promise<void> {
    this.cancelCurrent();
    try {
      await this.page?.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
    } catch {
      /* best-effort close */
    }
    const cachePolicy = this.storagePolicy?.persistentCache;
    if (cachePolicy && cachePolicy.enabled) {
      this.send({
        ...this.base(`evt-cache-release-${cause}`),
        type: "CACHE_RELEASED",
        scopeToken: cachePolicy.scopeToken,
        namespace: cachePolicy.namespace,
      });
    }
    if (this.storagePolicy) {
      await fs.promises
        .rm(this.storagePolicy.temporaryProfilePath, {
          recursive: true,
          force: true,
        })
        .catch(() => undefined);
    }
    this.page = null;
    this.browser = null;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * GAP-05: run the adapter's challenge probe on the current page. A NEW
   * challenge (kind+origin key differs from the last report, or the dedupe
   * window lapsed) emits CHALLENGE_DETECTED + enters same-context handoff
   * and invalidates every reference; a repeat within the window (redirect
   * storm) stays silent so the user sees ONE notice.
   */
  private async detectAndReportChallenge(): Promise<boolean> {
    const page = this.page;
    if (!page) {
      return false;
    }
    const detection = await this.adapter
      .detectChallenge(page)
      .catch(() => null);
    if (!detection) {
      return false;
    }
    const origin = extractPageOrigin(page.url());
    const key = `${detection.kind}|${origin}`;
    if (
      key === this.lastChallengeKey &&
      this.now() - this.lastChallengeAtEpochMs < 30_000
    ) {
      return true; // still challenged — no duplicate event
    }
    this.lastChallengeKey = key;
    this.lastChallengeAtEpochMs = this.now();
    const challengeId = `ch_${crypto.randomUUID().slice(0, 12)}`;
    this.registry.reset(this.registry.currentRevision + 1);
    this.runtime.transition("challenge_detected");
    this.send({
      ...this.base(`evt-challenge-${challengeId}`),
      type: "CHALLENGE_DETECTED",
      challengeId,
      origin,
      kind: detection.kind,
      flowClassification: detection.flow,
      evidenceCodes: [...detection.evidenceCodes],
      providerInputAvailable: false,
    });
    this.runtime.transition("handoff");
    this.send({
      ...this.base(`evt-challenge-handoff-${challengeId}`),
      type: "HANDOFF_REQUIRED",
      reason: "captcha_sensitive_flow",
      challenge: {
        challengeId,
        kind: detection.kind,
        evidenceCodes: [...detection.evidenceCodes],
      },
    });
    return true;
  }

  /**
   * GAP-06: Chrome crashed or was closed outside our control. Report the
   * sanitized terminal state and dispose — the main process converges
   * through the supervisor's terminal path with verified orphan cleanup.
   */
  private async handleChromeDisconnected(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposePromise = this.doDispose("chrome_disconnected");
    await this.disposePromise;
    this.runtime.transition("failed");
    this.send({
      ...this.base(`evt-chrome-disconnected-${this.sessionNonce}`),
      type: "SESSION_STOPPED",
      terminalState: "failed",
      reasonCode: "chrome_disconnected",
    });
  }

  /**
   * GAP-03: renderer-driven navigations (redirects, reloads, link clicks,
   * SPA route changes that replace the document) invalidate every element
   * reference. Programmatic goto already resets the registry in the
   * executor; this watcher covers everything the model did NOT navigate.
   */
  private watchPageNavigations(page: PuppeteerPageLike): void {
    try {
      page.on("framenavigated", (frame) => {
        if (frame.parentFrame?.() != null) {
          return; // sub-frame swap: refs are main-frame scoped
        }
        this.registry.reset(this.registry.currentRevision + 1);
      });
    } catch {
      // Structural fakes without the event — nothing to watch.
    }
    // GAP-13: browser-created states are DENY-by-default — JS dialogs are
    // dismissed without interaction, popups are closed, downloads are
    // cancelled. The AI never silently accepts a prompt it did not open.
    try {
      page.on("dialog", (dialog) => {
        void dialog.dismiss().catch(() => undefined);
      });
    } catch {
      /* structural fake */
    }
    try {
      page.on("popup", (popup) => {
        void popup.close().catch(() => undefined);
      });
    } catch {
      /* structural fake */
    }
    try {
      page.on("download", (download) => {
        void download.cancel().catch(() => undefined);
      });
    } catch {
      /* structural fake */
    }
  }

  private async buildObservation(
    page: PuppeteerPageLike
  ): Promise<BrowserObservation> {
    return buildObservation({
      page,
      sessionId: this.sessionId,
      registry: this.registry,
      state: "ready",
    });
  }

  private requirePage(requestId: string): PuppeteerPageLike | null {
    if (!this.page) {
      this.emitError(requestId, "worker_exited", "no active page");
      return null;
    }
    return this.page;
  }

  private async assess(): Promise<AuthenticationAssessment> {
    if (!this.page) {
      return { state: "unknown", reasonCode: "no_page" };
    }
    return this.adapter.assessAuthentication(this.page);
  }

  private async collectSelfTestEvidence(): Promise<FingerprintSelfTestEvidence> {
    const page = this.page;
    if (!page) {
      throw new Error("no page for self-test");
    }
    await page
      .goto("about:blank", { timeoutMs: 5_000, waitUntil: "load" })
      .catch(() => undefined);
    return page.evaluate<FingerprintSelfTestEvidence>(
      `(() => {
        const ua = navigator.userAgent;
        const chromeMatch = /Chrome\\/(\\d+)/.exec(ua);
        return {
          browserVersion: (navigator.appVersion || '').trim(),
          browserMajor: chromeMatch ? Number(chromeMatch[1]) : 0,
          userAgent: ua,
          userAgentMajor: chromeMatch ? Number(chromeMatch[1]) : null,
          platform: navigator.platform || '',
          language: navigator.language || '',
          languages: Array.from(navigator.languages || []),
          timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          screen: { width: screen.width, height: screen.height },
          webdriver: navigator.webdriver === undefined ? null : navigator.webdriver,
        };
      })()`
    );
  }

  /**
   * Capture context cookies, filter to the immutable platform definition,
   * and send the private REFRESHED_COOKIES message (§13.3).
   */
  private async captureAndSendRefreshedCookies(
    requestId: string
  ): Promise<void> {
    const browser = this.browser;
    const allowedSuffixes = this.platformDefinition?.allowedDomainSuffixes;
    if (!browser || !allowedSuffixes) {
      return;
    }
    const cookies = await browser.defaultBrowserContext().cookies();
    const filtered = fromCapturedCookies(cookies).filter((cookie) =>
      matchesDomainSuffix(cookie.domain, allowedSuffixes)
    );
    if (filtered.length === 0) {
      // Empty refresh never replaces a valid snapshot — send nothing; the
      // main process keeps the last valid snapshot (FR-COOKIE-019).
      return;
    }
    this.send({
      ...this.base(`evt-refresh-${requestId}`),
      type: "REFRESHED_COOKIES",
      cookies: filtered,
    });
  }

  /**
   * Executable fingerprint: sha256 over identity metadata (path, resolved
   * version, size, mtime). A full binary hash of a ~150 MB Chrome is too
   * slow inside session start; this remains verifiable by the main process
   * against the descriptor it supplied (FR-RUNTIME-013 identity check).
   */
  private computeExecutableFingerprint(executablePath: string): string {
    try {
      const stat = fs.statSync(executablePath);
      const material = `${executablePath}|${this.executableVersion}|${stat.size}|${stat.mtimeMs}`;
      return crypto.createHash("sha256").update(material).digest("hex");
    } catch {
      return crypto.createHash("sha256").update(executablePath).digest("hex");
    }
  }

  private emitError(
    requestId: string,
    code: ManagedBrowserErrorCode,
    message: string
  ): void {
    this.send({
      ...this.base(requestId),
      type: "WORKER_ERROR",
      code,
      message: message.slice(0, 300),
    });
  }

  private base(requestId: string): {
    protocolVersion: 1;
    sessionId: string;
    requestId: string;
    sequence: number;
  } {
    this.sequence += 1;
    return {
      protocolVersion: MANAGED_BROWSER_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      requestId,
      sequence: this.sequence,
    };
  }
}

/** Default headed launch via puppeteer-extra + reviewed stealth allowlist. */
async function defaultLaunchBrowser(
  options: LaunchBrowserOptions
): Promise<PuppeteerBrowserLike> {
  const puppeteerExtra = (await import("puppeteer-extra")).default;
  const stealthFactory = (await import("puppeteer-extra-plugin-stealth"))
    .default;
  const policy = buildDefaultLaunchPolicy();
  const stealthPlugin = stealthFactory();
  // Restrict evasions to the reviewed allowlist (design §11.3).
  (
    stealthPlugin as unknown as { enabledEvasions: Set<string> }
  ).enabledEvasions = new Set(policy.enabledStealthEvasions);
  puppeteerExtra.use(stealthPlugin);
  return (await puppeteerExtra.launch({
    executablePath: options.executablePath,
    headless: options.headless,
    userDataDir: options.userDataDir,
    args: [...options.args],
    defaultViewport: options.defaultViewport,
    env: options.env,
  })) as unknown as PuppeteerBrowserLike;
}

function extractPageOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function envRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

/** Copy a readonly domain assessment into the mutable transport shape. */
function toTransportAssessment(
  assessment: AuthenticationAssessment
): z.infer<typeof authenticationAssessmentSchema> {
  if (assessment.state === "authenticated") {
    return {
      state: "authenticated",
      evidenceCodes: [...assessment.evidenceCodes],
    };
  }
  if (assessment.state === "unauthenticated") {
    return {
      state: "unauthenticated",
      evidenceCodes: [...assessment.evidenceCodes],
    };
  }
  return { ...assessment };
}
