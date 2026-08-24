/**
 * PortableWorkspaceMemorySyncCoordinator — serialized, per-scope
 * reconciliation of portable-memory snapshots and app operations
 * (design §14, D-05).
 *
 * Invariants:
 *   - One asynchronous queue per `scopeId`: app writes, snapshot imports,
 *     rescans, and conflict resolution for the same scope never interleave;
 *     different scopes run concurrently.
 *   - Snapshot coalescing: only the NEWEST pending complete snapshot per
 *     scope survives; user-initiated mutations are NEVER coalesced away.
 *   - Reconciliation applies the §14.2 algorithm: trusted re-resolution,
 *     identity validation/binding, per-record validation, duplicate
 *     detection, review policy, hash idempotency, complete-scan-only
 *     deletion reconciliation, deterministic index rewrite, one renderer
 *     summary event.
 *   - Failures are logged (content-free) and never reject the queue.
 */

import type {
  PortableMemoryDiagnosticView,
  PortableMemoryDocumentV1,
  PortableMemoryScanSnapshot,
  PortableMemorySyncSummary,
  WorkspaceMemoryScopeContext,
} from "@/entityTypes/portableWorkspaceMemoryTypes";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import { PortableWorkspaceMemoryModule } from "@/modules/PortableWorkspaceMemoryModule";
import { WorkspaceMemoryScopeResolver } from "@/service/WorkspaceMemoryScopeResolver";
import { PortableWorkspaceMemoryFormat } from "@/service/PortableWorkspaceMemoryFormat";
import { PortableWorkspaceMemoryFileStore } from "@/service/PortableWorkspaceMemoryFileStore";
import { PortableWorkspaceMemoryIndexService } from "@/service/PortableWorkspaceMemoryIndexService";
import { PortableWorkspaceIdentityService } from "@/service/PortableWorkspaceIdentityService";
import {
  parseYamlFrontmatter,
  stripFrontmatterBlock,
} from "@/service/portableMemoryFrontmatter";
import { AIWorkspaceMemoryModel } from "@/model/AIWorkspaceMemory.model";
import { AIWorkspaceMemoryPortableStateModel } from "@/model/AIWorkspaceMemoryPortableState.model";

export interface TrustedPortableSnapshotInput {
  /** Watch-manager workspace id (its own id space, NOT the memory scope). */
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly approved: boolean;
  readonly snapshot: PortableMemoryScanSnapshot;
}

export type SyncSummaryEmitter = (summary: PortableMemorySyncSummary) => void;

/** Logger sink — defaults to console; must stay content-free (§16.3). */
export type PortableSyncLogger = (
  level: "warn" | "error" | "info",
  msg: string,
  meta?: unknown
) => void;

function defaultLogger(
  level: "warn" | "error" | "info",
  msg: string,
  meta?: unknown
): void {
  // eslint-disable-next-line no-console
  const sink = level === "error" ? console.error : console.info;
  if (meta !== undefined) sink(`[portable-memory] ${msg}`, meta);
  else sink(`[portable-memory] ${msg}`);
}

interface QueueState {
  tail: Promise<void>;
  /** Newest pending snapshot awaiting application (coalesced). */
  pendingSnapshot: TrustedPortableSnapshotInput | null;
  snapshotScheduled: boolean;
}

export class PortableWorkspaceMemorySyncCoordinator {
  private readonly queues = new Map<string, QueueState>();
  /** In-flight drain promise per key — what enqueueSnapshot resolves on. */
  private readonly drainRuns = new Map<string, Promise<void>>();
  private readonly scopeModule: WorkspaceMemoryScopeModule;
  private readonly portableModule: PortableWorkspaceMemoryModule;
  private readonly scopeResolver: WorkspaceMemoryScopeResolver;
  private readonly format: PortableWorkspaceMemoryFormat;
  private readonly indexService: PortableWorkspaceMemoryIndexService;
  private readonly identityService: PortableWorkspaceIdentityService;
  private readonly memoryModel: AIWorkspaceMemoryModel;
  private readonly stateModel: AIWorkspaceMemoryPortableStateModel;
  private emitter: SyncSummaryEmitter | null;
  private readonly logger: PortableSyncLogger;

  constructor(
    options: {
      readonly scopeModule?: WorkspaceMemoryScopeModule;
      readonly portableModule?: PortableWorkspaceMemoryModule;
      readonly scopeResolver?: WorkspaceMemoryScopeResolver;
      readonly memoryModel?: AIWorkspaceMemoryModel;
      readonly stateModel?: AIWorkspaceMemoryPortableStateModel;
      readonly emitter?: SyncSummaryEmitter | null;
      readonly logger?: PortableSyncLogger;
    } = {}
  ) {
    this.scopeModule = options.scopeModule ?? new WorkspaceMemoryScopeModule();
    this.portableModule =
      options.portableModule ?? new PortableWorkspaceMemoryModule();
    this.scopeResolver =
      options.scopeResolver ?? new WorkspaceMemoryScopeResolver();
    this.memoryModel = options.memoryModel ?? new AIWorkspaceMemoryModel("");
    this.stateModel =
      options.stateModel ?? new AIWorkspaceMemoryPortableStateModel("");
    this.format = new PortableWorkspaceMemoryFormat();
    this.indexService = new PortableWorkspaceMemoryIndexService();
    this.identityService = new PortableWorkspaceIdentityService();
    this.emitter = options.emitter ?? null;
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Attach (or replace) the renderer summary emitter AFTER construction.
   * The shared coordinator is constructed before
   * initWorkspaceWatchManager captures the BrowserWindow; the sink is wired
   * later via this method so summaries are never permanently dropped (AC-002).
   */
  setEmitter(emitter: SyncSummaryEmitter | null): void {
    this.emitter = emitter;
  }

  /** Test-only: drive a summary through the emitter to assert wiring. */
  async emitSummaryForTest(summary: PortableMemorySyncSummary): Promise<void> {
    this.emitSummary(summary);
  }

  private emitSummary(summary: PortableMemorySyncSummary): void {
    if (this.emitter) {
      try {
        this.emitter(summary);
      } catch (err) {
        this.logger(
          "error",
          "summary emitter threw",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  // --- Queue plumbing (§14.1) -----------------------------------------------

  /**
   * Enqueue a trusted snapshot. Coalesces to the newest per scope; resolves
   * once the snapshot has been applied OR superseded by a newer one.
   */
  enqueueSnapshot(input: TrustedPortableSnapshotInput): Promise<void> {
    const key = input.workspaceId;
    const state = this.stateFor(key);
    state.pendingSnapshot = input;
    if (!state.snapshotScheduled) {
      state.snapshotScheduled = true;
      const tracked = this.drainSnapshots(key).catch(() => undefined);
      this.drainRuns.set(key, tracked);
    }
    // Resolves once the drain covering THIS snapshot completes (a snapshot
    // enqueued mid-drain joins that drain — coalescing to the newest).
    return this.drainRuns.get(key) ?? Promise.resolve();
  }

  /**
   * Drain pending snapshots for a key until none remain. Runs on the scope
   * queue (serialized behind user operations). The finally block re-arms when
   * a snapshot arrived after the last loop check — closing the orphan race
   * between `pendingSnapshot = null` and the flag clear.
   */
  private async drainSnapshots(key: string): Promise<void> {
    let pendingArrived = false;
    try {
      for (;;) {
        const queued = this.queues.get(key);
        const pending = queued?.pendingSnapshot;
        if (queued) queued.pendingSnapshot = null;
        if (!pending) break;
        await this.enqueueOperation(key, async () => {
          try {
            await this.applySnapshot(pending);
          } catch (err) {
            this.logger(
              "error",
              "snapshot reconciliation failed",
              err instanceof Error ? err.message : String(err)
            );
          }
        });
      }
    } finally {
      const q = this.queues.get(key);
      if (q?.pendingSnapshot) {
        // Arrived between the loop's last check and now — keep draining.
        pendingArrived = true;
      } else if (q) {
        q.snapshotScheduled = false;
      }
    }
    if (pendingArrived) {
      void this.drainSnapshots(key);
    }
  }

  /**
   * Serialize an operation (app write, rescan, conflict resolution) behind
   * the scope's queue. User mutations are never dropped or coalesced.
   */
  enqueueOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const state = this.stateFor(key);
    const next = state.tail.then(
      () => operation(),
      () => operation()
    );
    // Keep the queue alive even if the operation rejects.
    state.tail = next.then(
      () => undefined,
      () => undefined
    );
    // Drop the map entry when idle to avoid unbounded growth (§14.1).
    void state.tail.then(() => {
      const q = this.queues.get(key);
      if (q && q.tail === state.tail) this.queues.delete(key);
    });
    return next;
  }

  private stateFor(key: string): QueueState {
    let state = this.queues.get(key);
    if (!state) {
      state = {
        tail: Promise.resolve(),
        pendingSnapshot: null,
        snapshotScheduled: false,
      };
      this.queues.set(key, state);
    }
    return state;
  }

  // --- Reconciliation (§14.2) -------------------------------------------------

  private async applySnapshot(
    input: TrustedPortableSnapshotInput
  ): Promise<void> {
    if (!input.approved) {
      // Trust filter (§13.2): unapproved → no import, no identity binding.
      this.logger(
        "warn",
        `ignoring snapshot for unapproved workspace=${input.workspaceId}`
      );
      return;
    }

    // Step 1–3: resolve the trusted canonical root + legacy scope in the
    // MAIN process (never trust the worker's root beyond lookup).
    const scope = await this.scopeResolver.resolveForWorkspace({
      workspaceKey: this.legacyKeyForRoot(input.workspaceRoot),
      canonicalRootPath: input.workspaceRoot,
      displayName: "",
    });
    if (!scope.portableEnabled) {
      // Portable memory disabled: no import. Diagnostics-only pass (§14.2.6)
      // is deferred to the enable flow's initial scan.
      return;
    }

    const store = new PortableWorkspaceMemoryFileStore(scope.workspaceRoot);

    // Step 4–5: validate + bind portable identity.
    const inspection = this.identityService.inspectDraft(
      input.snapshot.identity
    );
    if (inspection.state === "valid" && inspection.identity) {
      const bound = await this.scopeModule.bindPortableIdentity({
        scopeId: scope.scopeId,
        portableWorkspaceId: inspection.identity.workspaceId,
      });
      const composedScope: WorkspaceMemoryScopeContext = {
        ...scope,
        ...bound,
      };
      await this.applySnapshotToScope(
        composedScope,
        scope.workspaceRoot,
        input.snapshot,
        input.workspaceId
      );
      return;
    }
    await this.applySnapshotToScope(
      scope,
      scope.workspaceRoot,
      input.snapshot,
      input.workspaceId
    );

    void store; // store used by index step inside applySnapshotToScope
  }

  private async applySnapshotToScope(
    scope: WorkspaceMemoryScopeContext,
    workspaceRoot: string,
    snapshot: PortableMemoryScanSnapshot,
    queueKey: string
  ): Promise<void> {
    const store = new PortableWorkspaceMemoryFileStore(workspaceRoot);
    const imported: string[] = [];
    const unchanged: string[] = [];
    const rejected: PortableMemoryDiagnosticView[] = [];
    const conflicted: PortableMemoryDiagnosticView[] = [];
    const pendingReview: string[] = [];

    // Surface records already in the conflicted state (a prior applyAppWrite
    // detected a concurrent edit) so the summary reflects reality (FR-029).
    const preConflicts = await this.portableModule.listConflicts(scope);
    for (const c of preConflicts) {
      conflicted.push({
        code: "memory-conflict",
        relativePath: c.relativePath,
        message: c.message,
        recoverable: true,
      });
    }

    // Duplicate detection before persistence (§14.2.8 / P0): a duplicate ID
    // is AMBIGUOUS — neither copy is imported. The last-valid projection is
    // retained (excluded from retrieval) until the user resolves it.
    const draftsById = new Map<string, (typeof snapshot.records)[number]>();
    const duplicateIds = new Set<string>();
    const seenPaths = new Set<string>();
    for (const draft of snapshot.records) {
      if (seenPaths.has(draft.relativePath)) continue;
      seenPaths.add(draft.relativePath);
      const rawId = (draft.rawFrontmatter as { id?: unknown } | null)?.id;
      if (typeof rawId === "string") {
        if (draftsById.has(rawId)) {
          // Mark the ID as ambiguous; remove the first occurrence too so
          // neither is imported (FR-009/FR-014/FR-028).
          duplicateIds.add(rawId);
          draftsById.delete(rawId);
          rejected.push({
            code: "memory-id-duplicate",
            relativePath: draft.relativePath,
            message: "duplicate memory id in scanned files; neither imported",
            recoverable: true,
          });
          continue;
        }
        if (!duplicateIds.has(rawId)) {
          draftsById.set(rawId, draft);
        }
      }
    }

    // Iterate over the deduplicated drafts (FR-009/FR-014/FR-028): a duplicate
    // ID must NOT be imported — neither the first nor the ambiguous copy. The
    // last-valid projection stays excluded until the user resolves the
    // ambiguity.
    for (const draft of draftsById.values()) {
      const parsed = this.format.parseDraft(draft);
      if (!parsed.ok) {
        rejected.push({
          ...parsed.diagnostic,
          relativePath: draft.relativePath,
        });
        await this.portableModule.markRejectedFile(scope, {
          relativePath: draft.relativePath,
          memoryId:
            typeof (draft.rawFrontmatter as { id?: unknown } | null)?.id ===
            "string"
              ? ((draft.rawFrontmatter as { id?: unknown }).id as string)
              : undefined,
          observedHash: draft.contentHash,
          diagnostic: {
            ...parsed.diagnostic,
            relativePath: draft.relativePath,
          },
          scanId: snapshot.complete ? "scan" : undefined,
        });
        continue;
      }
      const doc = parsed.document;

      // Idempotency (§14.3): skip identical content already synced.
      const state = await this.stateModel.getByScopeAndMemoryId(
        scope.scopeId,
        doc.frontmatter.id
      );
      if (
        state &&
        state.lastValidHash === doc.contentHash &&
        state.syncState === "synced"
      ) {
        unchanged.push(doc.frontmatter.id);
        continue;
      }

      // Review policy: new external records queue for review under
      // review-new/review-all; edits to known records import automatically
      // under review-new (PRD §16.4).
      const known =
        (await this.memoryModel.getByScopeAndMemoryId(
          scope.scopeId,
          doc.frontmatter.id
        )) !== null;
      const policy = scope.importPolicy;
      const pendingReviewForRecord =
        policy === "review-all" || (policy === "review-new" && !known);

      await this.portableModule.upsertValidatedDocument(scope, doc, {
        actor: "external",
        pendingReview: pendingReviewForRecord,
        scanId: snapshot.complete ? "scan" : undefined,
      });
      // Persist unknown-field warnings as diagnostics (FR-011/FR-030): the
      // fields are still ignored (not copied into metadata), but the warning
      // is visible to the user via the diagnostics view.
      if (parsed.warnings && parsed.warnings.length > 0) {
        for (const w of parsed.warnings) {
          rejected.push({
            code: "memory-field-invalid",
            relativePath: doc.relativePath,
            message: w.message,
            recoverable: true,
          });
        }
      }
      if (pendingReviewForRecord) pendingReview.push(doc.frontmatter.id);
      else imported.push(doc.frontmatter.id);
    }

    // Missing-file reconciliation ONLY after a complete scan (§14.2.11).
    let deleted = 0;
    if (snapshot.complete && snapshot.directoryPresent) {
      const result = await this.portableModule.reconcileMissingPaths(
        scope,
        new Set(snapshot.seenRelativePaths),
        "scan",
        scope.importPolicy
      );
      deleted = result.deletedMemoryIds.length;
    }

    // Deterministic index rewrite only when bytes differ (§14.2.12–13).
    try {
      await this.rebuildIndexIfStale(scope, store, snapshot);
    } catch (err) {
      this.logger(
        "warn",
        "index rebuild failed",
        err instanceof Error ? err.message : String(err)
      );
    }

    if (snapshot.complete) {
      await this.scopeModule.markCompleteScan(scope.scopeId);
    }

    const summary: PortableMemorySyncSummary = {
      scopeId: scope.scopeId,
      complete: snapshot.complete,
      imported: imported.length,
      unchanged: unchanged.length,
      rejected: rejected.length,
      conflicted: conflicted.length,
      pendingReview: pendingReview.length,
      deleted,
      diagnostics: [...rejected, ...conflicted],
    };
    this.emitter?.(summary);
    this.logger(
      "info",
      `scan applied scope=<local> records=${snapshot.records.length} imported=${summary.imported} unchanged=${summary.unchanged} rejected=${summary.rejected} complete=${snapshot.complete}`
    );
    void queueKey;
  }

  /**
   * Expected index = active synced records. The current implementation loads
   * validated docs through the projection; because projections are upserted
   * first, this reads the just-imported state.
   */
  private async rebuildIndexIfStale(
    scope: WorkspaceMemoryScopeContext,
    store: PortableWorkspaceMemoryFileStore,
    snapshot: PortableMemoryScanSnapshot
  ): Promise<void> {
    const states = await this.stateModel.listByScope(scope.scopeId, "synced");
    const activeDocs: PortableMemoryDocumentV1[] = [];
    for (const state of states) {
      const row = await this.memoryModel.getByScopeAndMemoryId(
        scope.scopeId,
        state.memoryId
      );
      if (!row || row.status !== "active") continue;
      activeDocs.push({
        frontmatter: {
          schema: "aifetchly.memory/v1",
          id: state.memoryId,
          type: row.type as PortableMemoryDocumentV1["frontmatter"]["type"],
          status:
            row.status as PortableMemoryDocumentV1["frontmatter"]["status"],
          confidence: row.confidence,
          visibility: state.visibility === "team" ? "team" : "local",
          createdAt: state.portableCreatedAt.toISOString(),
          updatedAt: state.portableUpdatedAt.toISOString(),
          createdBy:
            state.createdBy as PortableMemoryDocumentV1["frontmatter"]["createdBy"],
        },
        title: row.title,
        content: row.content,
        relativePath: state.relativePath,
        contentHash: state.lastValidHash ?? "",
        sizeBytes: 0,
        mtimeMs: 0,
      });
    }
    const expected = this.indexService.buildIndex(activeDocs);
    const expectedHash = await hashString(expected);
    if (snapshot.indexHash === expectedHash) return;
    await store.writeIndex(expected);
  }

  /**
   * App-originated portable update (file-first, D-06): serialize → atomic
   * write → re-parse written bytes → projection upsert. Returns the parse of
   * the written file so callers can confirm authority.
   */
  async applyAppWrite(
    scope: WorkspaceMemoryScopeContext,
    document: PortableMemoryDocumentV1,
    options: { readonly expectedHash?: string | null } = {}
  ): Promise<{ readonly conflicted: boolean }> {
    const store = new PortableWorkspaceMemoryFileStore(scope.workspaceRoot);
    const relativePath =
      PortableWorkspaceMemoryFileStore.relativePathForMemoryId(
        document.frontmatter.id
      );

    // CONFLICT DETECTION (design §14.6 / FR-029 / AC-007): compare the caller's
    // expected on-disk hash (the last-known lastValidHash) to the CURRENT on-disk
    // hash. A divergence means an external editor wrote between our read and
    // write — STOP, mark conflicted, preserve the external bytes untouched.
    if (options.expectedHash !== undefined && options.expectedHash !== null) {
      const currentHash = await store.hashRecord(document.frontmatter.id);
      if (currentHash !== null && currentHash !== options.expectedHash) {
        await this.portableModule.markConflict(scope, {
          memoryId: document.frontmatter.id,
          relativePath,
          message:
            "external edit detected between read and write; use the conflict resolver to choose a version",
        });
        this.emitSummary({
          scopeId: scope.scopeId,
          complete: true,
          imported: 0,
          unchanged: 0,
          rejected: 0,
          conflicted: 1,
          pendingReview: 0,
          deleted: 0,
          diagnostics: [
            {
              code: "memory-conflict",
              relativePath,
              message: "concurrent edit detected",
              recoverable: true,
            },
          ],
        });
        return { conflicted: true };
      }
    }

    const serialized = this.format.serialize(document);
    const written = await store.writeRecord(
      document.frontmatter.id,
      serialized
    );
    // Re-import through the shared parser (§11.1): parse the written bytes.
    const readBack = await store.readRecord(document.frontmatter.id);
    if (!readBack)
      throw new Error("portable record write could not be verified");
    const parsed = this.format.parseDraft({
      relativePath,
      fileName: `${document.frontmatter.id}.md`,
      contentHash: written.contentHash,
      sizeBytes: written.sizeBytes,
      mtimeMs: readBack.mtimeMs,
      rawFrontmatter: parseYamlFrontmatter(readBack.content),
      markdownBody: stripFrontmatterBlock(readBack.content),
      isSymbolicLink: false,
    });
    if (!parsed.ok) {
      throw new Error(
        `portable record failed validation after write: ${parsed.diagnostic.message}`
      );
    }
    await this.portableModule.upsertValidatedDocument(scope, parsed.document, {
      actor: "aifetchly",
      pendingReview: false,
    });
    return { conflicted: false };
  }

  /** Legacy path-derived key for a root — mirrors WorkspaceKeyService. */
  private legacyKeyForRoot(workspaceRoot: string): string {
    // The watch manager's root is already canonical (resolved at acquire).
    // Reuse the shared hashing via a throwaway import-free computation.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require("crypto") as typeof import("crypto");
    const digest = crypto
      .createHash("sha256")
      .update(workspaceRoot)
      .digest("hex")
      .slice(0, 32);
    return `ws_${digest}`;
  }
}

async function hashString(s: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
