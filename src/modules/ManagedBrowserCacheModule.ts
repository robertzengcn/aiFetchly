import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { log } from "@/modules/Logger";
import { MANAGED_BROWSER_CACHE_DEFAULTS } from "@/config/managedBrowser";
import { getDefaultManagedBrowserCacheWorkerClient } from "@/service/ManagedBrowserCacheWorkerClient";
import {
  getDefaultManagedBrowserCacheScopeService,
  isValidCacheScopeToken,
  type CacheAccountScope,
} from "@/service/ManagedBrowserCacheScopeService";
import type {
  BrowserChatNoticeType,
  SafeBrowserChatNotice,
  SafeManagedBrowserCacheClearResult,
  SafeManagedBrowserCacheStatus,
  WorkerBrowserStoragePolicy,
} from "@/entityTypes/managedBrowserTypes";

/**
 * Managed browser cache orchestration (technical design §13.6, §13.8, §13.9).
 *
 * Responsibilities:
 *   - Active-scope registry: exactly one Chrome per account cache scope. The
 *     worker reports CACHE_OPENED / CACHE_RELEASED; the registry answers
 *     "is this scope busy?" without touching the filesystem.
 *   - Clear orchestration: single-use confirmations, an active-scope decision
 *     (stop / defer / cancel / skip), an atomic rename of the scope directory
 *     into `managedRoot/deleting/<queueEntry>` (the cancellation point), and a
 *     bounded delete delegated to the maintenance worker. `savedLoginSessionPreserved`
 *     is always true — saved login cookies live in the encrypted session store,
 *     never in the cache.
 *   - Crash recovery: leftover `deleting/` entries are recognizable and are
 *     retried by `resumePendingDeletions()` on the next maintenance pass.
 *
 * The main process never performs a large recursive scan or delete itself —
 * it only renames (atomic, O(1)) and delegates the bulk work (§13.9).
 */

/** Queue entry names under `managedRoot/deleting/` (crash-recognizable). */
const CACHE_QUEUE_ENTRY_PATTERN = /^[a-z0-9-]{8,64}$/;

/** Confirmation ids expire after this window (ms). */
const CLEAR_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

/** Deletion queue directory name inside the managed root. */
const DELETING_DIR_NAME = "deleting";

export type CacheScanOutcome =
  | { readonly status: "ok"; readonly approximateBytes: number }
  | { readonly status: "error"; readonly reasonCode: string };

export type CacheDeleteOutcome =
  | { readonly status: "ok"; readonly approximateDeletedBytes: number }
  | { readonly status: "error"; readonly reasonCode: string };

/**
 * Maintenance worker contract (§13.9). Implemented in the worker process;
 * the main-process client is injected here.
 */
export interface CacheMaintenanceClient {
  scanScope(input: { readonly scopePath: string }): Promise<CacheScanOutcome>;
  deleteQueuedScope(input: {
    readonly queuePath: string;
  }): Promise<CacheDeleteOutcome>;
  shutdown(): Promise<void>;
  /** Two-phase eviction planning (§13.9); optional for fakes. */
  planEviction?(input: {
    readonly managedRoot: string;
    readonly maxTotalBytes: number;
    readonly perScopeTargetBytes: number;
    readonly inactiveRetentionDays: number;
    readonly activeScopeTokens: readonly string[];
  }): Promise<
    | {
        status: "ok";
        planId: string;
        plannedBytes: number;
        entries: ReadonlyArray<{ scopeToken: string }>;
      }
    | { status: "error"; reasonCode: string }
  >;
}

/** Scope service surface consumed by this module. */
export interface CacheScopeServiceLike {
  deriveAccountScope(accountId: number): Promise<CacheAccountScope>;
  buildPersistentCachePolicy(
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ): Promise<WorkerBrowserStoragePolicy["persistentCache"]>;
}

export type CacheClearActiveSessionDecision =
  | "stop_and_clear"
  | "defer"
  | "skip_active"
  | "cancel";

export interface CacheClearConfirmationRequest {
  readonly scope: "account" | "all";
  readonly accountId?: number;
}

export interface CacheClearInput {
  readonly scope: "account" | "all";
  readonly accountId?: number;
  readonly activeSessionDecision: CacheClearActiveSessionDecision;
  readonly confirmationId: string;
}

/** Cache-clear errors carry approval/terminal codes, never paths. */
export class ManagedBrowserCacheError extends Error {
  public constructor(
    public readonly code: string,
    public readonly reasonCode: string | null = null
  ) {
    super(code);
    this.name = "ManagedBrowserCacheError";
  }
}

export interface ManagedBrowserCacheModuleDeps {
  readonly scopeService?: CacheScopeServiceLike;
  readonly maintenance?: CacheMaintenanceClient;
  readonly noticeSink?: (notice: SafeBrowserChatNotice) => void;
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly mkdir?: (p: string) => Promise<void>;
  readonly readdir?: (p: string) => Promise<string[]>;
  readonly pathExists?: (p: string) => Promise<boolean>;
  readonly randomId?: () => string;
  readonly now?: () => number;
  readonly stopSessionForAccount?: (accountId: number) => Promise<boolean>;
}

interface ActiveScopeEntry {
  readonly sessionId: string;
  readonly accountId: number;
  readonly namespace: string;
}

interface ConfirmationEntry {
  readonly scope: "account" | "all";
  readonly accountId?: number;
  readonly issuedAt: number;
}

/** Coordinator surface consumed by ManagedBrowserModule (avoids an import cycle). */
export interface ManagedBrowserCacheCoordinator {
  buildPersistentCachePolicy(
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ): Promise<WorkerBrowserStoragePolicy["persistentCache"]>;
  onCacheOpened(input: {
    readonly sessionId: string;
    readonly accountId: number;
    readonly scopeToken: string;
    readonly namespace: string;
  }): void;
  onCacheReleased(sessionId: string): void;
  onSessionTerminal(sessionId: string): void;
}

export class ManagedBrowserCacheModule
  implements ManagedBrowserCacheCoordinator
{
  private readonly scopeService: CacheScopeServiceLike;
  private readonly maintenance: CacheMaintenanceClient;
  private noticeSink: (notice: SafeBrowserChatNotice) => void;
  /** Wired by the IPC layer: coarse cache-clear progress for the renderer. */
  private progressSink:
    | ((progress: {
        readonly scope: "account" | "all";
        readonly phase: "scanning" | "deleting" | "done" | "failed";
        readonly approximateBytes: number;
        readonly reasonCode: string | null;
      }) => void)
    | null = null;
  private readonly rename: (from: string, to: string) => Promise<void>;
  private readonly mkdir: (p: string) => Promise<void>;
  private readonly readdir: (p: string) => Promise<string[]>;
  private readonly pathExists: (p: string) => Promise<boolean>;
  private readonly randomId: () => string;
  private now: () => number;
  private stopSessionForAccount: (accountId: number) => Promise<boolean> =
    async () => false;

  /** scopeToken → live Chrome using that cache scope. */
  private readonly activeScopes = new Map<string, ActiveScopeEntry>();
  /** sessionId → scopeToken index for release lookups. */
  private readonly sessionScopes = new Map<string, string>();
  /** scopeToken → deferred clear waiting for the scope to be released. */
  private readonly pendingClears = new Map<
    string,
    CacheClearConfirmationRequest
  >();
  /** Single-use clear confirmations. */
  private readonly confirmations = new Map<string, ConfirmationEntry>();
  /** scopeToken → ISO timestamp of the last successful clear. */
  private readonly lastClearedAt = new Map<string, string>();
  private noticeSequence = 0;

  public constructor(deps: ManagedBrowserCacheModuleDeps = {}) {
    this.scopeService =
      deps.scopeService ?? getDefaultManagedBrowserCacheScopeService();
    this.maintenance = deps.maintenance ?? createUnavailableMaintenanceClient();
    this.noticeSink = deps.noticeSink ?? (() => undefined);
    this.rename = deps.rename ?? ((from, to) => fs.promises.rename(from, to));
    this.mkdir =
      deps.mkdir ??
      ((p) => fs.promises.mkdir(p, { recursive: true }).then(() => undefined));
    this.readdir = deps.readdir ?? ((p) => fs.promises.readdir(p));
    this.pathExists =
      deps.pathExists ??
      ((p) =>
        fs.promises.stat(p).then(
          () => true,
          () => false
        ));
    this.randomId = deps.randomId ?? (() => crypto.randomUUID());
    this.now = deps.now ?? (() => Date.now());
    if (deps.stopSessionForAccount) {
      this.stopSessionForAccount = deps.stopSessionForAccount;
    }
  }

  /** Wired by ManagedBrowserModule so stop_and_clear can stop the session. */
  public setSessionStopper(
    stopper: (accountId: number) => Promise<boolean>
  ): void {
    this.stopSessionForAccount = stopper;
  }

  /** Injectable clock for tests only. */
  public setClockForTests(now: () => number): void {
    this.now = now;
  }

  /** Wired by the IPC layer: sanitized cache notices to the renderer. */
  public setNoticeSink(sink: (notice: SafeBrowserChatNotice) => void): void {
    this.noticeSink = sink;
  }

  /** Wired by the IPC layer: coarse cache-clear progress to the renderer. */
  public setProgressSink(
    sink: (progress: {
      readonly scope: "account" | "all";
      readonly phase: "scanning" | "deleting" | "done" | "failed";
      readonly approximateBytes: number;
      readonly reasonCode: string | null;
    }) => void
  ): void {
    this.progressSink = sink;
  }

  // -----------------------------------------------------------------------
  // Coordinator surface (called by ManagedBrowserModule)
  // -----------------------------------------------------------------------

  public async buildPersistentCachePolicy(
    accountId: number,
    chromeMajor: number,
    cacheEnabled: boolean
  ): Promise<WorkerBrowserStoragePolicy["persistentCache"]> {
    return this.scopeService.buildPersistentCachePolicy(
      accountId,
      chromeMajor,
      cacheEnabled
    );
  }

  public onCacheOpened(input: {
    readonly sessionId: string;
    readonly accountId: number;
    readonly scopeToken: string;
    readonly namespace: string;
  }): void {
    if (!isValidCacheScopeToken(input.scopeToken)) {
      log.warn(
        "[ManagedBrowserCache] refusing to register an invalid scope token"
      );
      return;
    }
    const existing = this.activeScopes.get(input.scopeToken);
    if (existing && existing.sessionId !== input.sessionId) {
      log.warn(
        "[ManagedBrowserCache] scope token opened by a second session before release"
      );
    }
    this.activeScopes.set(input.scopeToken, {
      sessionId: input.sessionId,
      accountId: input.accountId,
      namespace: input.namespace,
    });
    this.sessionScopes.set(input.sessionId, input.scopeToken);
  }

  public onCacheReleased(sessionId: string): void {
    const token = this.sessionScopes.get(sessionId);
    this.sessionScopes.delete(sessionId);
    if (!token) {
      return;
    }
    const entry = this.activeScopes.get(token);
    if (entry?.sessionId === sessionId) {
      this.activeScopes.delete(token);
    }
    this.flushPendingClear(token);
  }

  /** Safety net: any terminal session releases its scope claim. */
  public onSessionTerminal(sessionId: string): void {
    this.onCacheReleased(sessionId);
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  public async getStatus(
    accountId: number
  ): Promise<SafeManagedBrowserCacheStatus | null> {
    const derived = await this.scopeService.deriveAccountScope(accountId);
    if (derived.status !== "ok") {
      return null;
    }
    const scan = await this.maintenance.scanScope({
      scopePath: derived.scopePath,
    });
    return {
      scope: "account",
      accountId,
      approximateBytes: scan.status === "ok" ? scan.approximateBytes : 0,
      lastClearedAt: this.lastClearedAt.get(derived.scopeToken) ?? null,
      active: this.activeScopes.has(derived.scopeToken),
      pendingClear: this.pendingClears.has(derived.scopeToken),
    };
  }

  /** Aggregate status across every scope (bounded to the first 100 scopes). */
  public async getStatusForAllScopes(): Promise<SafeManagedBrowserCacheStatus> {
    let approximateBytes = 0;
    let activeCount = 0;
    for (const { scopeToken, scopePath } of (await this.listScopePaths()).slice(
      0,
      100
    )) {
      if (this.activeScopes.has(scopeToken)) {
        activeCount += 1;
      }
      const scan = await this.maintenance.scanScope({ scopePath });
      if (scan.status === "ok") {
        approximateBytes += scan.approximateBytes;
      }
    }
    return {
      scope: "all",
      approximateBytes,
      lastClearedAt: null,
      active: activeCount > 0,
      pendingClear: this.pendingClears.size > 0,
    };
  }

  // -----------------------------------------------------------------------
  // Clear orchestration (§13.8)
  // -----------------------------------------------------------------------

  public issueClearConfirmation(
    request: CacheClearConfirmationRequest
  ): string {
    const confirmationId = this.randomId();
    this.confirmations.set(confirmationId, {
      scope: request.scope,
      accountId: request.accountId,
      issuedAt: this.now(),
    });
    return confirmationId;
  }

  public async clearCache(
    input: CacheClearInput
  ): Promise<SafeManagedBrowserCacheClearResult> {
    this.validateClearInput(input);
    this.consumeConfirmation(input);

    if (input.activeSessionDecision === "cancel") {
      return {
        state: "cancelled",
        scope: input.scope,
        approximateDeletedBytes: 0,
        savedLoginSessionPreserved: true,
        reasonCode: "cancelled_by_user",
      };
    }
    this.emitProgress(input.scope, "scanning", 0);

    if (input.scope === "account") {
      return this.clearAccountScope(input.accountId as number, input);
    }
    return this.clearAllScopes(input);
  }

  private validateClearInput(input: CacheClearInput): void {
    if (
      !input.confirmationId ||
      input.confirmationId.length > 128 ||
      (input.scope === "account" &&
        (!Number.isInteger(input.accountId) ||
          (input.accountId as number) <= 0))
    ) {
      throw new ManagedBrowserCacheError(
        "internal_error",
        "invalid_clear_input"
      );
    }
    const decision = input.activeSessionDecision;
    const valid =
      decision === "stop_and_clear" ||
      decision === "defer" ||
      decision === "skip_active" ||
      decision === "cancel";
    if (!valid) {
      throw new ManagedBrowserCacheError(
        "internal_error",
        "invalid_clear_input"
      );
    }
  }

  /** Single-use + expiring confirmation consumption (throws on any mismatch). */
  private consumeConfirmation(input: CacheClearInput): void {
    const entry = this.confirmations.get(input.confirmationId);
    // Always delete first: a failed check must still burn the id.
    this.confirmations.delete(input.confirmationId);
    if (!entry) {
      throw new ManagedBrowserCacheError(
        "approval_required",
        "confirmation_unknown"
      );
    }
    if (this.now() - entry.issuedAt > CLEAR_CONFIRMATION_TTL_MS) {
      throw new ManagedBrowserCacheError(
        "approval_expired",
        "confirmation_expired"
      );
    }
    if (entry.scope !== input.scope || entry.accountId !== input.accountId) {
      throw new ManagedBrowserCacheError(
        "approval_required",
        "confirmation_scope_mismatch"
      );
    }
  }

  private async clearAccountScope(
    accountId: number,
    input: CacheClearInput
  ): Promise<SafeManagedBrowserCacheClearResult> {
    const derived = await this.scopeService.deriveAccountScope(accountId);
    if (derived.status !== "ok") {
      // The scope ladder is disabled — nothing identifiable to clear.
      return {
        state: "empty",
        scope: "account",
        approximateDeletedBytes: 0,
        savedLoginSessionPreserved: true,
        reasonCode: derived.reasonCode,
      };
    }

    const active = this.activeScopes.get(derived.scopeToken);
    if (active) {
      if (input.activeSessionDecision === "defer") {
        return this.deferClear(derived.scopeToken, "account");
      }
      // stop_and_clear: stop the session, then clear regardless — a true
      // return means the session is gone even if its release event raced us.
      const stopped = await this.stopSessionForAccount(active.accountId);
      if (!stopped) {
        return this.deferClear(derived.scopeToken, "account");
      }
      this.releaseScopeLocally(derived.scopeToken);
    }

    return this.clearScopeAtPath(
      derived.scopePath,
      derived.scopeToken,
      "account"
    );
  }

  private async clearAllScopes(
    input: CacheClearInput
  ): Promise<SafeManagedBrowserCacheClearResult> {
    const scopePaths = await this.listScopePaths();
    if (scopePaths.length === 0) {
      return {
        state: "empty",
        scope: "all",
        approximateDeletedBytes: 0,
        savedLoginSessionPreserved: true,
        reasonCode: null,
      };
    }

    let approximateDeletedBytes = 0;
    let skippedActive = false;
    let anyFailed = false;
    for (const { scopeToken, scopePath } of scopePaths) {
      const active = this.activeScopes.get(scopeToken);
      if (active) {
        if (input.activeSessionDecision === "stop_and_clear") {
          const stopped = await this.stopSessionForAccount(active.accountId);
          if (!stopped) {
            skippedActive = true;
            continue;
          }
          this.releaseScopeLocally(scopeToken);
        } else {
          // skip_active
          skippedActive = true;
          continue;
        }
      }
      const result = await this.clearScopeAtPath(
        scopePath,
        scopeToken,
        "account"
      );
      approximateDeletedBytes += result.approximateDeletedBytes;
      if (result.reasonCode === "cache_maintenance_pending") {
        anyFailed = true;
      }
    }

    return {
      state: approximateDeletedBytes > 0 || anyFailed ? "cleared" : "empty",
      scope: "all",
      approximateDeletedBytes,
      savedLoginSessionPreserved: true,
      reasonCode: anyFailed
        ? "cache_maintenance_pending"
        : skippedActive
        ? "cache_scope_active"
        : null,
    };
  }

  private deferClear(
    scopeToken: string,
    scope: "account" | "all"
  ): SafeManagedBrowserCacheClearResult {
    this.pendingClears.set(scopeToken, { scope });
    this.publishNotice("cache_clear_deferred", "warning");
    return {
      state: "deferred",
      scope,
      approximateDeletedBytes: 0,
      savedLoginSessionPreserved: true,
      reasonCode: "cache_scope_active",
    };
  }

  /** Fires a deferred clear once the scope is released. */
  private flushPendingClear(scopeToken: string): void {
    if (!this.pendingClears.has(scopeToken)) {
      return;
    }
    this.pendingClears.delete(scopeToken);
    void (async () => {
      try {
        // The token maps back to at least one known account via the registry
        // history is NOT guaranteed, so re-derive from the token itself is
        // impossible — but the deferred path was captured at defer time.
        const derived = await this.deferredScopePath(scopeToken);
        if (derived) {
          await this.clearScopeAtPath(derived.scopePath, scopeToken, "account");
        }
      } catch (error) {
        logCacheError("deferred clear failed", error);
        this.publishNotice("cache_clear_failed", "error");
      }
    })();
  }

  /**
   * Resolves the scope path for a deferred clear. The pending record only
   * stores the token, so scan the managed root for the matching directory.
   */
  private async deferredScopePath(
    scopeToken: string
  ): Promise<{ scopePath: string } | null> {
    for (const {
      scopeToken: token,
      scopePath,
    } of await this.listScopePaths()) {
      if (token === scopeToken) {
        return { scopePath };
      }
    }
    return null;
  }

  private releaseScopeLocally(scopeToken: string): void {
    const entry = this.activeScopes.get(scopeToken);
    if (!entry) {
      return;
    }
    this.activeScopes.delete(scopeToken);
    this.sessionScopes.delete(entry.sessionId);
  }

  /**
   * Renames the scope directory into the deletion queue (atomic — the point
   * of no return for cancellation) and delegates the bounded delete.
   */
  private async clearScopeAtPath(
    scopePath: string,
    scopeToken: string,
    scope: "account" | "all"
  ): Promise<SafeManagedBrowserCacheClearResult> {
    if (!(await this.pathExists(scopePath))) {
      return {
        state: "empty",
        scope,
        approximateDeletedBytes: 0,
        savedLoginSessionPreserved: true,
        reasonCode: null,
      };
    }

    const managedRoot = path.dirname(scopePath);
    const deletingDir = path.join(managedRoot, DELETING_DIR_NAME);
    const queueEntry = `del-${this.randomId()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")}`;
    const queuePath = path.join(deletingDir, queueEntry);
    if (!CACHE_QUEUE_ENTRY_PATTERN.test(queueEntry)) {
      throw new ManagedBrowserCacheError(
        "internal_error",
        "queue_entry_invalid"
      );
    }

    try {
      await this.mkdir(deletingDir);
      await this.rename(scopePath, queuePath);
    } catch (error) {
      logCacheError("queue rename failed", error);
      this.publishNotice("cache_clear_failed", "error");
      return {
        state: "failed",
        scope,
        approximateDeletedBytes: 0,
        savedLoginSessionPreserved: true,
        reasonCode: "cache_queue_rename_failed",
      };
    }

    this.emitProgress(scope, "deleting", 0);
    const outcome = await this.maintenance.deleteQueuedScope({ queuePath });
    if (outcome.status === "error") {
      // The queue entry stays on disk: resumePendingDeletions() retries it.
      logCacheError("maintenance delete failed", undefined, outcome.reasonCode);
      this.emitProgress(scope, "failed", 0, outcome.reasonCode);
      return {
        state: "cleared",
        scope,
        approximateDeletedBytes: 0,
        savedLoginSessionPreserved: true,
        reasonCode: "cache_maintenance_pending",
      };
    }

    this.emitProgress(scope, "done", outcome.approximateDeletedBytes);
    this.lastClearedAt.set(scopeToken, new Date(this.now()).toISOString());
    this.publishNotice("cache_clear_completed", "success");
    return {
      state: "cleared",
      scope,
      approximateDeletedBytes: outcome.approximateDeletedBytes,
      savedLoginSessionPreserved: true,
      reasonCode: null,
    };
  }

  // -----------------------------------------------------------------------
  // Queue helpers (§13.8 crash recovery, §13.9)
  // -----------------------------------------------------------------------

  /** Post account-delete cleanup: queue the scope without a confirmation. */
  public async queueAccountRemoval(accountId: number): Promise<void> {
    const derived = await this.scopeService.deriveAccountScope(accountId);
    if (derived.status !== "ok") {
      return;
    }
    if (this.activeScopes.has(derived.scopeToken)) {
      // Account deletion stops sessions first; if one is still live, leave
      // the scope for the next maintenance pass rather than racing Chrome.
      log.warn(
        "[ManagedBrowserCache] account removal queued while scope active"
      );
      return;
    }
    await this.clearScopeAtPath(
      derived.scopePath,
      derived.scopeToken,
      "account"
    );
  }

  /** Clear-on-exit: queue every inactive scope; active ones are skipped. */
  public async queueAllForShutdown(): Promise<void> {
    for (const { scopeToken, scopePath } of await this.listScopePaths()) {
      if (this.activeScopes.has(scopeToken)) {
        continue;
      }
      await this.clearScopeAtPath(scopePath, scopeToken, "account");
    }
  }

  /** Retries leftover `deleting/` entries (crash mid-deletion recovery). */
  public async resumePendingDeletions(): Promise<void> {
    for (const { managedRoot } of await this.listManagedRoots()) {
      const deletingDir = path.join(managedRoot, DELETING_DIR_NAME);
      if (!(await this.pathExists(deletingDir))) {
        continue;
      }
      let entries: string[];
      try {
        entries = await this.readdir(deletingDir);
      } catch (error) {
        logCacheError("readdir deleting queue failed", error);
        continue;
      }
      for (const entry of entries) {
        if (!CACHE_QUEUE_ENTRY_PATTERN.test(entry)) {
          log.warn(
            "[ManagedBrowserCache] ignoring malformed deletion queue entry"
          );
          continue;
        }
        const outcome = await this.maintenance.deleteQueuedScope({
          queuePath: path.join(deletingDir, entry),
        });
        if (outcome.status === "error") {
          logCacheError(
            "resume deletion failed",
            undefined,
            outcome.reasonCode
          );
        }
      }
    }
  }

  /**
   * GAP-10: enforce the configured cache limits — plan an LRU-inactive
   * eviction with the maintenance worker and execute the renames for every
   * inactive scope in the plan (active scopes are excluded by the worker).
   * Returns aggregate planning info (byte counts only, never paths).
   */
  public async enforceEvictionLimits(settings: {
    readonly cacheMaxBytes: number;
  }): Promise<{ plannedScopes: number; plannedBytes: number; skipped: boolean }> {
    const plan = this.maintenance.planEviction;
    if (!plan) {
      return { plannedScopes: 0, plannedBytes: 0, skipped: true };
    }
    const roots = await this.listManagedRoots();
    if (roots.length === 0) {
      return { plannedScopes: 0, plannedBytes: 0, skipped: false };
    }
    const { managedRoot } = roots[0];
    const activeScopeTokens = [...this.activeScopes.keys()];
    const decision = await plan({
      managedRoot,
      maxTotalBytes: settings.cacheMaxBytes,
      perScopeTargetBytes:
        MANAGED_BROWSER_CACHE_DEFAULTS.perAccountTargetBytes,
      inactiveRetentionDays:
        MANAGED_BROWSER_CACHE_DEFAULTS.inactiveRetentionDays,
      activeScopeTokens,
    });
    if (decision.status !== "ok") {
      logCacheError(
        "eviction planning failed",
        undefined,
        decision.reasonCode
      );
      return { plannedScopes: 0, plannedBytes: 0, skipped: false };
    }
    const scopePaths = await this.listScopePaths();
    let executed = 0;
    for (const entry of decision.entries) {
      const match = scopePaths.find((s) => s.scopeToken === entry.scopeToken);
      if (!match) {
        continue; // vanished between plan and execute — fine
      }
      await this.clearScopeAtPath(match.scopePath, entry.scopeToken, "account");
      executed++;
    }
    return {
      plannedScopes: executed,
      plannedBytes: decision.plannedBytes,
      skipped: false,
    };
  }

  public async shutdownMaintenance(): Promise<void> {
    await this.maintenance.shutdown();
  }

  // -----------------------------------------------------------------------
  // Directory enumeration (single level — bounded, never recursive)
  // -----------------------------------------------------------------------

  private async listManagedRoots(): Promise<
    ReadonlyArray<{ managedRoot: string }>
  > {
    // The managed root is account-independent; derive it via a throwaway
    // account lookup only to reuse the root-ladder validation. Account 0 is
    // never a real account, so its scope directory simply will not exist.
    const derived = await this.scopeService.deriveAccountScope(0);
    if (derived.status !== "ok") {
      return [];
    }
    return [{ managedRoot: derived.managedRoot }];
  }

  private async listScopePaths(): Promise<
    ReadonlyArray<{ scopeToken: string; scopePath: string }>
  > {
    const roots = await this.listManagedRoots();
    const results: Array<{ scopeToken: string; scopePath: string }> = [];
    for (const { managedRoot } of roots) {
      if (!(await this.pathExists(managedRoot))) {
        continue;
      }
      let entries: string[];
      try {
        entries = await this.readdir(managedRoot);
      } catch (error) {
        logCacheError("readdir managed root failed", error);
        continue;
      }
      for (const entry of entries.slice(0, 10_000)) {
        if (entry === DELETING_DIR_NAME || !isValidCacheScopeToken(entry)) {
          continue;
        }
        results.push({
          scopeToken: entry,
          scopePath: path.join(managedRoot, entry),
        });
      }
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Notices + progress
  // -----------------------------------------------------------------------

  private emitProgress(
    scope: "account" | "all",
    phase: "scanning" | "deleting" | "done" | "failed",
    approximateBytes: number,
    reasonCode: string | null = null
  ): void {
    if (this.progressSink) {
      this.progressSink({ scope, phase, approximateBytes, reasonCode });
    }
  }

  private publishNotice(
    type: BrowserChatNoticeType,
    severity: SafeBrowserChatNotice["severity"]
  ): void {
    this.noticeSequence += 1;
    this.noticeSink({
      eventId: `mb-cache-${this.now()}-${this.noticeSequence}`,
      sessionId: "mb_cache_service",
      type,
      messageKey: `managedBrowser.notices.${type}`,
      severity,
      requiresUserAction: false,
      createdAt: new Date(this.now()).toISOString(),
    });
  }
}

function logCacheError(
  context: string,
  error: unknown,
  reasonCode?: string
): void {
  // No identifiers, paths, or URLs — reason codes only (design §13.4).
  const name =
    error instanceof Error
      ? (error as NodeJS.ErrnoException).code ?? error.name
      : "unknown";
  log.warn(
    `[ManagedBrowserCache] ${context}: ${name}${
      reasonCode ? ` (${reasonCode})` : ""
    }`
  );
}

/**
 * Fallback maintenance client for contexts without a utility process (unit
 * tests). It reports every operation as unavailable, so clears surface
 * `cache_maintenance_pending` (the deletion queue still holds the data) and
 * scans report 0 bytes — never a false success.
 */
function createUnavailableMaintenanceClient(): CacheMaintenanceClient {
  return {
    scanScope: async () => ({
      status: "error" as const,
      reasonCode: "cache_maintenance_unavailable",
    }),
    deleteQueuedScope: async () => ({
      status: "error" as const,
      reasonCode: "cache_maintenance_unavailable",
    }),
    shutdown: async () => undefined,
  };
}

let defaultCacheModule: ManagedBrowserCacheModule | null = null;

/**
 * Process singleton wired to the shared maintenance worker client
 * (design §13.9): fork-on-demand, retryable crash, deletion queue preserved.
 */
export function getDefaultManagedBrowserCacheModule(): ManagedBrowserCacheModule {
  if (!defaultCacheModule) {
    defaultCacheModule = new ManagedBrowserCacheModule({
      maintenance: getDefaultManagedBrowserCacheWorkerClient(),
    });
  }
  return defaultCacheModule;
}
