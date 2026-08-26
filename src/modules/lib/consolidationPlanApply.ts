// src/modules/lib/consolidationPlanApply.ts
//
// Shared transactional consolidation-plan application for the user and
// workspace memory modules. Both modules' applyPlanAndCompleteRun methods
// had near-identical shapes: open a TypeORM transaction, run archive/update/
// create through transaction-bound repos, then mark the run completed with
// counts + resolved model + source-derived reviewedThrough — all atomic, so
// a failure rolls back every mutation. Only the entity type, the run entity,
// and (for workspace) the workspace scoping differ.
//
// This helper takes the transaction-bound memory + run repositories and
// entity-specific callbacks, so each module keeps its entity-specific logic
// (which fields to set, how to scope a where-clause) while sharing the
// control flow, secret-filter re-check, and the run-completion patch.
import type { Repository } from "typeorm";
import { looksSecretlike } from "@/service/MemorySecretFilter";

/** A consolidation plan entry's create fields the helper needs. */
export interface ConsolidationPlanCreateEntry {
  readonly type: string;
  readonly title: string;
  readonly content: string;
  readonly confidence?: number;
  readonly sourceKind?: string;
  readonly sourceId?: string;
  readonly sourceMessageIds?: readonly string[] | null;
}

/** A consolidation plan entry's update fields the helper needs. */
export interface ConsolidationPlanUpdateEntry {
  readonly memoryId: string;
  readonly title?: string;
  readonly content?: string;
  readonly confidence?: number;
}

/** A consolidation plan entry's archive fields the helper needs. */
export interface ConsolidationPlanArchiveEntry {
  readonly memoryId: string;
}

/** A parsed consolidation plan, reduced to the fields this helper touches. */
export interface ConsolidationPlanLike {
  readonly create: readonly ConsolidationPlanCreateEntry[];
  readonly update: readonly ConsolidationPlanUpdateEntry[];
  readonly archive: readonly ConsolidationPlanArchiveEntry[];
}

/** Clamp a confidence value into 0..100; non-finite -> 100. */
export function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Defense-in-depth secret rejection for transactional plan application. The
 * primary secret filter runs at parse time, but re-checking here prevents a
 * future caller from persisting an unvalidated plan. Throws on secret-like
 * content so the transaction rolls back before any mutation.
 */
export function rejectSecretLike(
  title: string | null,
  content: string | null
): void {
  if (looksSecretlike(title) || looksSecretlike(content)) {
    throw new Error(
      "Refusing to persist memory with secret-like content (secret filter)"
    );
  }
}

/**
 * The shape of a run-completion patch shared by both run entities.
 */
export interface RunCompletionPatch {
  readonly status: "completed";
  readonly finishedAt: Date;
  readonly chatConversationsReviewed: number;
  readonly agentTasksReviewed: number;
  readonly memoriesCreated: number;
  readonly memoriesUpdated: number;
  readonly memoriesArchived: number;
  readonly model: string | null;
  readonly errorMessage: null;
  readonly reviewedThrough?: Date | null;
}

/**
 * Apply a consolidation plan AND mark the run completed in ONE transaction.
 * The caller opens the transaction and supplies the transaction-bound memory
 * and run repositories plus an entity-builder for create entries. Returns
 * counts only after the transaction commits (the caller's transaction wrapper
 * throws on failure, rolling back every mutation).
 *
 * The secret filter is re-run on create and update title/content inside the
 * transaction (defense-in-depth; throws -> rollback). The caller must NOT
 * call the model again after this; all mutations occur after response
 * validation (tech-design §14.4, §9.5).
 *
 * @param manager - the TypeORM transaction EntityManager
 * @param memoryEntity - the memory entity class (for getRepository)
 * @param runEntity - the run entity class (for getRepository)
 * @param plan - the parsed consolidation plan
 * @param runId - the run to mark completed
 * @param completion - the run-completion counts/model/cursor
 * @param buildCreateEntity - builds a new memory entity from a create entry
 *   (sets memoryId, type, title, content, status, confidence, source* fields).
 *   Called inside the transaction; the helper saves it.
 * @param archiveWhere - the where-clause for archive updates (scoped to the
 *   workspace for the workspace module; { memoryId } for the user module).
 * @param updateWhere - the where-clause for update patches (scoped similarly).
 */
export async function applyConsolidationPlanInTransaction<
  MemoryEntity extends object,
  RunEntity extends object
>(input: {
  readonly manager: import("typeorm").EntityManager;
  readonly memoryEntity: new () => MemoryEntity;
  readonly runEntity: new () => RunEntity;
  readonly plan: ConsolidationPlanLike;
  readonly runId: string;
  readonly completion: Omit<
    RunCompletionPatch,
    | "status"
    | "finishedAt"
    | "errorMessage"
    | "model"
    | "memoriesCreated"
    | "memoriesUpdated"
    | "memoriesArchived"
  > & {
    /** Resolved model (optional; coerced to null when absent). */
    readonly model?: string;
    readonly reviewedThrough?: Date | null;
  };
  readonly buildCreateEntity: (
    entry: ConsolidationPlanCreateEntry
  ) => MemoryEntity;
  readonly archiveWhere: (memoryId: string) => Record<string, unknown>;
  readonly updateWhere: (memoryId: string) => Record<string, unknown>;
  /** Counts from file-first portable writes applied outside this transaction. */
  readonly extraMemoriesCreated?: number;
  readonly extraMemoriesUpdated?: number;
  readonly extraMemoriesArchived?: number;
}): Promise<void> {
  const memoryRepo: Repository<MemoryEntity> = input.manager.getRepository(
    input.memoryEntity
  );
  const runRepo: Repository<RunEntity> = input.manager.getRepository(
    input.runEntity
  );

  // Apply archives first to clear contradictions.
  for (const a of input.plan.archive) {
    await memoryRepo.update(
      input.archiveWhere(a.memoryId) as never,
      { status: "archived" } as never
    );
  }
  for (const u of input.plan.update) {
    const patch: Record<string, unknown> = {};
    if (u.title !== undefined) patch.title = u.title;
    if (u.content !== undefined) patch.content = u.content;
    if (u.confidence !== undefined)
      patch.confidence = clampConfidence(u.confidence);
    // Defense-in-depth: re-check update title/content for secret-like values.
    if (u.title !== undefined || u.content !== undefined) {
      rejectSecretLike(
        u.title !== undefined ? u.title : null,
        u.content !== undefined ? u.content : null
      );
    }
    if (Object.keys(patch).length > 0) {
      await memoryRepo.update(
        input.updateWhere(u.memoryId) as never,
        patch as never
      );
    }
  }
  for (const c of input.plan.create) {
    // Defense-in-depth: re-run the secret filter inside the transaction.
    rejectSecretLike(c.title, c.content);
    const e = input.buildCreateEntity(c);
    await memoryRepo.save(e);
  }

  // Mark the run completed in the same transaction.
  const patch: Record<string, unknown> = {
    status: "completed",
    finishedAt: new Date(),
    chatConversationsReviewed: input.completion.chatConversationsReviewed,
    agentTasksReviewed: input.completion.agentTasksReviewed,
    memoriesCreated:
      input.plan.create.length + (input.extraMemoriesCreated ?? 0),
    memoriesUpdated:
      input.plan.update.length + (input.extraMemoriesUpdated ?? 0),
    memoriesArchived:
      input.plan.archive.length + (input.extraMemoriesArchived ?? 0),
    model: input.completion.model ?? null,
    errorMessage: null,
    ...(input.completion.reviewedThrough !== undefined
      ? { reviewedThrough: input.completion.reviewedThrough }
      : {}),
  };
  await runRepo.update({ runId: input.runId } as never, patch as never);
}
