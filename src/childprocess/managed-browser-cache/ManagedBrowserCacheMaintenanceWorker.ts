import * as nodeFs from "node:fs/promises";
import * as nodeCrypto from "node:crypto";
import type {
  ManagedBrowserCacheInboundMessage,
  ManagedBrowserCacheOutboundMessage,
} from "@/schemas/worker/managedBrowserCache";
import { bucketForDurationMs } from "@/schemas/worker/managedBrowserCache";
import { CachePathValidator } from "@/childprocess/managed-browser-cache/CachePathValidator";
import { CacheEvictionPlanner } from "@/childprocess/managed-browser-cache/CacheEvictionPlanner";

/**
 * Cache maintenance worker handlers (technical design §13.9).
 *
 * Every handler:
 *   1. re-validates the managed root and target path (grammar + containment
 *      + symlink walk) — the worker never trusts main-process paths;
 *   2. performs only bounded work (scan limits, rm of ONE queue entry);
 *   3. replies with aggregate counts, duration buckets, and safe reason
 *      codes — never filenames or URLs.
 *
 * Eviction is two-phase: PLAN_EVICTION returns an opaque planId + scope
 * list (the worker never deletes for eviction directly); the main process
 * performs the renames and may CANCEL_BEFORE_DELETE(planId).
 */

export interface CacheMessageBase {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly sequence: number;
}

export interface CacheMaintenanceWorkerDeps {
  readonly send: (message: ManagedBrowserCacheOutboundMessage) => void;
  /** Envelope factory owned by the entry (owns the monotonic sequence). */
  readonly makeBase: (requestId: string) => CacheMessageBase;
  readonly validator?: CachePathValidator;
  readonly planner?: CacheEvictionPlanner;
  readonly rm?: (p: string) => Promise<void>;
  readonly lstat?: (p: string) => Promise<{ isFile(): boolean }>;
  readonly randomId?: () => string;
  readonly now?: () => number;
}

interface StoredPlan {
  readonly entries: readonly string[];
  cancelled: boolean;
}

type ResultType =
  | "SCAN_SCOPE_RESULT"
  | "SCAN_ALL_RESULT"
  | "DELETE_QUEUED_SCOPE_RESULT"
  | "PLAN_EVICTION_RESULT"
  | "CANCEL_BEFORE_DELETE_RESULT";

export class ManagedBrowserCacheMaintenanceWorker {
  private readonly send: (message: ManagedBrowserCacheOutboundMessage) => void;
  private readonly makeBase: (requestId: string) => CacheMessageBase;
  private readonly validator: CachePathValidator;
  private readonly planner: CacheEvictionPlanner;
  private readonly rm: (p: string) => Promise<void>;
  private readonly lstat: (p: string) => Promise<{ isFile(): boolean }>;
  private readonly randomId: () => string;
  private readonly now: () => number;

  /** planId → plan (in-memory only; lost plans are simply re-planned). */
  private readonly plans = new Map<string, StoredPlan>();

  public constructor(deps: CacheMaintenanceWorkerDeps) {
    this.send = deps.send;
    this.makeBase = deps.makeBase;
    this.validator = deps.validator ?? new CachePathValidator();
    this.planner = deps.planner ?? new CacheEvictionPlanner();
    this.rm =
      deps.rm ??
      ((p) =>
        nodeFs.rm(p, { recursive: true, force: true }).then(() => undefined));
    this.lstat = deps.lstat ?? ((p) => nodeFs.lstat(p));
    this.randomId = deps.randomId ?? (() => nodeCrypto.randomUUID());
    this.now = deps.now ?? Date.now;
  }

  public async handleScanScope(
    message: Extract<ManagedBrowserCacheInboundMessage, { type: "SCAN_SCOPE" }>
  ): Promise<void> {
    const startedAt = this.now();
    const guard = await this.guardPaths(
      message.managedRoot,
      message.scopePath,
      "scope"
    );
    if (guard) {
      this.replyError(message.requestId, "SCAN_SCOPE_RESULT", guard);
      return;
    }
    const scan = await this.planner.scanScopeDirectory(message.scopePath);
    this.reply(message.requestId, "SCAN_SCOPE_RESULT", {
      status: "ok" as const,
      approximateBytes: scan.approximateBytes,
      fileCount: scan.fileCount,
      durationBucket: this.bucketSince(startedAt),
      truncated: scan.truncated,
    });
  }

  public async handleScanAll(
    message: Extract<ManagedBrowserCacheInboundMessage, { type: "SCAN_ALL" }>
  ): Promise<void> {
    const startedAt = this.now();
    const rootCheck = this.validator.validateManagedRoot(message.managedRoot);
    if (!rootCheck.ok) {
      this.replyError(
        message.requestId,
        "SCAN_ALL_RESULT",
        rootCheck.reasonCode
      );
      return;
    }
    const { scopes, truncated } = await this.planner.scanManagedRoot(
      message.managedRoot
    );
    this.reply(message.requestId, "SCAN_ALL_RESULT", {
      status: "ok" as const,
      scopes: scopes.map((s) => ({
        scopeToken: s.scopeToken,
        approximateBytes: s.approximateBytes,
        fileCount: s.fileCount,
        lastModifiedEpochMs: s.lastModifiedEpochMs,
      })),
      truncated,
      durationBucket: this.bucketSince(startedAt),
    });
  }

  public async handleDeleteQueuedScope(
    message: Extract<
      ManagedBrowserCacheInboundMessage,
      { type: "DELETE_QUEUED_SCOPE" }
    >
  ): Promise<void> {
    const startedAt = this.now();
    const guard = await this.guardPaths(
      message.managedRoot,
      message.queuePath,
      "queue"
    );
    if (guard) {
      this.replyError(message.requestId, "DELETE_QUEUED_SCOPE_RESULT", guard);
      return;
    }
    // Missing entry = already deleted (idempotent recovery retry).
    let exists = true;
    try {
      await this.lstat(message.queuePath);
    } catch {
      exists = false;
    }
    if (!exists) {
      this.reply(message.requestId, "DELETE_QUEUED_SCOPE_RESULT", {
        status: "ok" as const,
        approximateDeletedBytes: 0,
        fileCount: 0,
        durationBucket: this.bucketSince(startedAt),
      });
      return;
    }
    const scan = await this.planner.scanScopeDirectory(message.queuePath);
    try {
      await this.rm(message.queuePath);
    } catch {
      this.replyError(
        message.requestId,
        "DELETE_QUEUED_SCOPE_RESULT",
        "cache_delete_failed"
      );
      return;
    }
    this.reply(message.requestId, "DELETE_QUEUED_SCOPE_RESULT", {
      status: "ok" as const,
      approximateDeletedBytes: scan.approximateBytes,
      fileCount: scan.fileCount,
      durationBucket: this.bucketSince(startedAt),
    });
  }

  public async handlePlanEviction(
    message: Extract<
      ManagedBrowserCacheInboundMessage,
      { type: "PLAN_EVICTION" }
    >
  ): Promise<void> {
    const startedAt = this.now();
    const rootCheck = this.validator.validateManagedRoot(message.managedRoot);
    if (!rootCheck.ok) {
      this.replyError(
        message.requestId,
        "PLAN_EVICTION_RESULT",
        rootCheck.reasonCode
      );
      return;
    }
    const { scopes } = await this.planner.scanManagedRoot(message.managedRoot);
    const plan = this.planner.planEviction(
      scopes,
      {
        maxTotalBytes: message.maxTotalBytes,
        perScopeTargetBytes: message.perScopeTargetBytes,
        inactiveRetentionDays: message.inactiveRetentionDays,
      },
      message.activeScopeTokens,
      this.now()
    );
    const planId = `plan-${this.randomId()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 24)}`;
    if (!/^plan-[a-z0-9-]{6,32}$/.test(planId)) {
      this.replyError(
        message.requestId,
        "PLAN_EVICTION_RESULT",
        "internal_error"
      );
      return;
    }
    this.plans.set(planId, { entries: plan.entries, cancelled: false });
    this.reply(message.requestId, "PLAN_EVICTION_RESULT", {
      status: "ok" as const,
      planId,
      plannedBytes: plan.plannedBytes,
      entries: plan.entries.map((scopeToken) => ({ scopeToken })),
      durationBucket: this.bucketSince(startedAt),
    });
  }

  public handleCancelBeforeDelete(
    message: Extract<
      ManagedBrowserCacheInboundMessage,
      { type: "CANCEL_BEFORE_DELETE" }
    >
  ): void {
    const plan = this.plans.get(message.planId);
    if (!plan || plan.cancelled) {
      // Unknown or already-cancelled plans are NOT an error (§13.9).
      this.reply(message.requestId, "CANCEL_BEFORE_DELETE_RESULT", {
        status: "ok" as const,
        cancelled: false,
      });
      return;
    }
    plan.cancelled = true;
    this.plans.delete(message.planId);
    this.reply(message.requestId, "CANCEL_BEFORE_DELETE_RESULT", {
      status: "ok" as const,
      cancelled: true,
    });
  }

  public handleShutdown(
    message: Extract<ManagedBrowserCacheInboundMessage, { type: "SHUTDOWN" }>
  ): void {
    this.reply(message.requestId, "SHUTDOWN_ACK", null);
  }

  /** Drop all in-memory plans (called on graceful exit). */
  public dispose(): void {
    this.plans.clear();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Shared guard: root re-validation + STRICT per-operation path grammar
   * (a delete only ever accepts a queue path under `deleting/`; a scan
   * only ever accepts a scope path — never either/or) + symlink component
   * walk. Returns the reason code on failure, null when safe.
   */
  private async guardPaths(
    managedRoot: string,
    targetPath: string,
    kind: "scope" | "queue"
  ): Promise<string | null> {
    const rootCheck = this.validator.validateManagedRoot(managedRoot);
    if (!rootCheck.ok) {
      return rootCheck.reasonCode;
    }
    const pathCheck =
      kind === "scope"
        ? this.validator.validateScopePath(targetPath, managedRoot)
        : this.validator.validateQueuePath(targetPath, managedRoot);
    if (!pathCheck.ok) {
      return "cache_path_invalid";
    }
    const symlinkCheck = await this.validator.assertNoSymlinkComponents(
      targetPath,
      managedRoot
    );
    if (!symlinkCheck.ok) {
      return symlinkCheck.reasonCode;
    }
    return null;
  }

  /**
   * Send a result message. `result` nests under the `result` field for
   * result types; SHUTDOWN_ACK carries no payload.
   */
  private reply(
    requestId: string,
    type: ResultType | "SHUTDOWN_ACK",
    result: Record<string, unknown> | null
  ): void {
    const message = (result === null
      ? { ...this.makeBase(requestId), type }
      : {
          ...this.makeBase(requestId),
          type,
          result,
        }) as unknown as ManagedBrowserCacheOutboundMessage;
    this.send(message);
  }

  private replyError(
    requestId: string,
    type: ResultType,
    reasonCode: string
  ): void {
    this.reply(requestId, type, {
      status: "error" as const,
      reasonCode,
    });
  }

  private bucketSince(
    startedAt: number
  ): ReturnType<typeof bucketForDurationMs> {
    return bucketForDurationMs(Math.max(0, this.now() - startedAt));
  }
}
