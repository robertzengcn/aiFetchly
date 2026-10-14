/**
 * Evidence evaluation service (technical-design §8.1/§8.2, FR-05/06/16).
 *
 * Slice 2: the controller calls `checkCandidate` inside `decide()` for
 * task_verified / task_best_effort routes. The service evaluates each
 * criterion in the contract via the {@link CriteriaAdapterRegistry},
 * builds {@link TaskEvidence} rows, merges them into
 * `execution_state_json.evidence` via a CAS update (reusing the
 * `applyShadowDecisionCas` pattern from Slice 1), and returns the
 * pass/unmet/evidence-id triple the controller needs to populate its
 * decision.
 *
 * Fail-closed: a criterion whose evaluator throws or whose adapter is
 * missing records state `"unknown"` and counts as unmet — the controller
 * then returns `incomplete`, never `verified_complete` (AC-12/13).
 *
 * Persistence is behind the {@link EvidenceStore} seam so the service is
 * unit-testable without a database; the coordinator (Unit 3) supplies a
 * concrete store backed by `AiTaskExecutionModel.applyShadowDecisionCas`.
 */
import type {
  TaskCompletionContract,
  TaskCriterion,
  TaskEndCandidate,
  TaskEvidence,
} from "@/entityTypes/aiTaskExecutionTypes";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";
import {
  ArtifactAdapter,
  buildDefaultRegistry,
  CriteriaAdapterRegistry,
  CriterionEvalResult,
  CriterionState,
  OperationReceipt,
  ObservationReceipt,
  QualitativeEvaluator,
  newEvidenceId,
} from "@/service/aiTaskExecution/criteriaAdapters";

/** Snapshot of the execution row the service needs to merge evidence into. */
export interface EvidenceStoreSnapshot {
  readonly stateJson: string | null;
  readonly version: number;
  readonly finalized: boolean;
}

/** Narrow persistence seam — the coordinator supplies a concrete adapter. */
export interface EvidenceStore {
  getExecutionState(executionId: string): Promise<EvidenceStoreSnapshot | null>;
  mergeEvidenceCas(input: {
    readonly executionId: string;
    readonly expectedVersion: number;
    readonly mergedStateJson: string;
  }): Promise<boolean>;
}

/** Context handed to the service: adapter inputs + provenance + CAS token. */
export interface EvidenceContext {
  readonly content: string;
  readonly toolCatalogState?: Readonly<Record<string, unknown>>;
  readonly abortSignal?: AbortSignal;
  readonly checkerDispatch?: (prompt: string) => Promise<string>;
  readonly budgetReserveChecker?: () => BudgetReservationResult;
  /**
   * T03 (FR-03/04): authoritative external evidence providers threaded
   * into the adapter context per evaluation. The observation provider
   * resolves a targetId to a trusted fresh observation; the operation
   * receipt provider resolves a targetId to a real operation receipt;
   * `artifactBaseDir` roots validated read-only filesystem artifact checks.
   */
  readonly observationProvider?: (targetId: string) => Promise<ObservationReceipt | null>;
  readonly operationReceiptProvider?: (targetId: string) => Promise<OperationReceipt | null>;
  readonly artifactBaseDir?: string;
  /**
   * B21 (FR-02/03/19): pre-action artifact baselines (relativePath → sha256),
   * captured at enrollment via {@link snapshotArtifactBaselines}. Threaded
   * into the artifact adapter per evaluation; absent entries stay unknown.
   */
  readonly artifactBaselines?: Readonly<Record<string, string>>;
  /** Provenance stamped onto each evidence row (FR-16). */
  readonly source: string;
  readonly sourceRevision: string;
  /** CAS token from the binding's last-known version. Required to persist. */
  readonly expectedStateVersion?: number;
}

/** Result returned to the controller. */
export interface CheckResult {
  readonly passedCriterionIds: readonly string[];
  readonly unmetCriterionIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

/** Narrow interface the controller depends on (mockable in controller tests). */
export interface EvidenceChecker {
  checkCandidate(
    candidate: TaskEndCandidate,
    contract: TaskCompletionContract,
    context: EvidenceContext
  ): Promise<CheckResult>;
}

const EVIDENCE_KEY = "evidence";
const MAX_SUMMARY = 2000;

export class TaskEvidenceService implements EvidenceChecker {
  private readonly qualitativeEvaluator = new QualitativeEvaluator();
  private readonly artifactEvaluator = new ArtifactAdapter();

  constructor(
    private readonly store: EvidenceStore,
    private readonly registry: CriteriaAdapterRegistry = buildDefaultRegistry()
  ) {}

  async checkCandidate(
    candidate: TaskEndCandidate,
    contract: TaskCompletionContract,
    context: EvidenceContext
  ): Promise<CheckResult> {
    const observedAt = new Date().toISOString();
    const evidenceRows: TaskEvidence[] = [];
    const passed: string[] = [];
    const unmet: string[] = [];

    // B05 (FR-04/08, AC-03/08/20): judge the candidate's qualitative
    // criteria in ONE bounded batch call instead of one reserve+dispatch per
    // criterion (which starves the third criterion within the 2-per-candidate
    // cap). The batch shares the adapter context every per-criterion check
    // would have received.
    const batchAdapterContext = {
      content: context.content,
      toolCatalogState: context.toolCatalogState,
      abortSignal: context.abortSignal,
      checkerDispatch: context.checkerDispatch,
      budgetReserveChecker: context.budgetReserveChecker,
      observationProvider: context.observationProvider,
      operationReceiptProvider: context.operationReceiptProvider,
      artifactBaseDir: context.artifactBaseDir,
      artifactBaselines: context.artifactBaselines,
    };
    const qualitativeBatch = contract.criteria.filter((c) => c.kind === "qualitative");
    const batchResults =
      qualitativeBatch.length > 0
        ? await this.qualitativeEvaluator.evaluateBatch(qualitativeBatch, batchAdapterContext)
        : new Map<string, CriterionEvalResult>();

    for (const criterion of contract.criteria) {
      const result =
        criterion.kind === "qualitative"
          ? (batchResults.get(criterion.id) ??
            unknownResult(criterion.id, "batch missing verdict for criterion (fail-closed)"))
          : await this.evaluateCriterion(criterion, context);
      const evidenceId = newEvidenceId();
      evidenceRows.push({
        evidenceId,
        criterionId: criterion.id,
        contractHash: contract.contractHash,
        executionId: candidate.executionId,
        observedAt,
        source: context.source,
        sourceRevision: context.sourceRevision,
        state: result.state,
        referenceIds: [...result.referenceIds],
        summary: truncate(result.summary),
      });
      if (result.state === "pass") {
        passed.push(criterion.id);
      } else {
        unmet.push(criterion.id);
      }
    }

    // Persist (best-effort; a finalized execution or a CAS mismatch drops
    // the write — the controller still gets the in-memory result so it can
    // decide. The persisted evidence is for audit/provenance, not for the
    // decision itself).
    if (context.expectedStateVersion !== undefined) {
      await this.persistEvidence(candidate.executionId, context.expectedStateVersion, evidenceRows);
    }

    return {
      passedCriterionIds: passed,
      unmetCriterionIds: unmet,
      evidenceIds: evidenceRows.map((row) => row.evidenceId),
    };
  }

  private async evaluateCriterion(
    criterion: TaskCriterion,
    context: EvidenceContext
  ): Promise<CriterionEvalResult> {
    const adapterContext = {
      content: context.content,
      toolCatalogState: context.toolCatalogState,
      abortSignal: context.abortSignal,
      checkerDispatch: context.checkerDispatch,
      budgetReserveChecker: context.budgetReserveChecker,
      observationProvider: context.observationProvider,
      operationReceiptProvider: context.operationReceiptProvider,
      artifactBaseDir: context.artifactBaseDir,
      artifactBaselines: context.artifactBaselines,
    };
    try {
      switch (criterion.kind) {
        case "observation":
        case "operation_receipt":
        case "record_count": {
          const evaluator = this.registry.get(criterion.adapterKey);
          if (!evaluator) {
            return unknownResult(criterion.id, `no adapter registered for "${criterion.adapterKey}"`);
          }
          return await evaluator.evaluate(criterion, adapterContext);
        }
        case "qualitative":
          return await this.qualitativeEvaluator.evaluate(criterion, adapterContext);
        case "artifact":
          return await this.artifactEvaluator.evaluate(criterion, adapterContext);
        // No default: the switch is exhaustive over the 5 criterion kinds.
        // TypeScript enforces this at compile time — adding a 6th kind to the
        // discriminated union without a case here is a build error, which is
        // stronger safety than a runtime fallback.
      }
    } catch (error) {
      // Fail-closed: a thrown evaluator never becomes a false "pass".
      return unknownResult(criterion.id, `evaluator threw: ${errorMessage(error)}`);
    }
  }

  private async persistEvidence(
    executionId: string,
    expectedVersion: number,
    newRows: TaskEvidence[]
  ): Promise<void> {
    const snapshot = await this.store.getExecutionState(executionId);
    if (!snapshot) return;
    // B8.1 mirror: a terminal execution is immutable — never write evidence.
    if (snapshot.finalized) return;

    const existing = parseStateObject(snapshot.stateJson);
    const existingEvidence = readEvidenceArray(existing[EVIDENCE_KEY]);
    // Merge: append new rows, dedup by evidenceId (a re-evaluation produces
    // fresh IDs so this is append-only in practice; dedup is defense-in-depth
    // against a caller passing the same row twice).
    const seen = new Set(existingEvidence.map((row) => row.evidenceId));
    const merged: TaskEvidence[] = [...existingEvidence];
    for (const row of newRows) {
      if (!seen.has(row.evidenceId)) {
        merged.push(row);
        seen.add(row.evidenceId);
      }
    }
    const mergedState: Record<string, unknown> = {
      ...existing,
      [EVIDENCE_KEY]: merged,
    };
    await this.store.mergeEvidenceCas({
      executionId,
      expectedVersion,
      mergedStateJson: JSON.stringify(mergedState),
    });
  }
}

// ----- Helpers -----

function unknownResult(criterionId: string, reason: string): CriterionEvalResult {
  return {
    state: "unknown" as CriterionState,
    referenceIds: [criterionId],
    summary: truncate(`unknown: ${reason}`),
  };
}

function truncate(text: string): string {
  return text.length <= MAX_SUMMARY ? text : text.slice(0, MAX_SUMMARY);
}

function parseStateObject(stateJson: string | null): Record<string, unknown> {
  if (!stateJson) return {};
  try {
    const parsed: unknown = JSON.parse(stateJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // Preserve non-object legacy under __legacy (mirror of recordShadowDecision).
    return { __legacy: parsed };
  } catch {
    return { __legacy: stateJson };
  }
}

function readEvidenceArray(raw: unknown): TaskEvidence[] {
  if (!Array.isArray(raw)) return [];
  // Validate each entry defensively — persisted JSON is untrusted at read.
  return raw.filter(isValidEvidenceRow);
}

function isValidEvidenceRow(row: unknown): row is TaskEvidence {
  if (!row || typeof row !== "object") return false;
  const evidence = row as Record<string, unknown>;
  return (
    typeof evidence.evidenceId === "string" &&
    typeof evidence.criterionId === "string" &&
    typeof evidence.contractHash === "string" &&
    typeof evidence.executionId === "string" &&
    typeof evidence.observedAt === "string" &&
    typeof evidence.source === "string" &&
    typeof evidence.sourceRevision === "string" &&
    (evidence.state === "pass" || evidence.state === "fail" || evidence.state === "unknown") &&
    Array.isArray(evidence.referenceIds) &&
    typeof evidence.summary === "string"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build a concrete {@link EvidenceStore} backed by an AiTaskExecutionModule-
 * shaped dependency. The coordinator (Unit 3) uses this to construct the
 * service; the model's `applyShadowDecisionCas` is the atomic merge primitive.
 */
export function makeModuleBackedStore(deps: {
  readonly getExecutionState: (executionId: string) => Promise<EvidenceStoreSnapshot | null>;
  readonly applyShadowDecisionCas: (input: {
    readonly executionId: string;
    readonly expectedVersion: number;
    readonly mergedStateJson: string;
  }) => Promise<boolean>;
}): EvidenceStore {
  return {
    getExecutionState: deps.getExecutionState,
    mergeEvidenceCas: deps.applyShadowDecisionCas,
  };
}
