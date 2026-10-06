/**
 * Criteria adapter registry for evidence evaluation (technical-design §8.1/§8.2,
 * FR-05/06/16).
 *
 * Each criterion kind has an evaluator that inspects the run state (assistant
 * content, tool catalog, store counts, checker LLM) and returns a
 * {@link CriterionState}. The registry maps `adapterKey` → evaluator for the
 * keyed kinds (`observation`, `operation_receipt`, `record_count`); the
 * `qualitative` kind has its own checker-LLM evaluator; `artifact` is stubbed
 * to `"unknown"` in Slice 2 (no filesystem adapter — fail-closed → not-passed
 * → incomplete, safe).
 *
 * Fail-closed default: an unknown adapterKey or a thrown evaluator returns
 * `"unknown"`, never a false `"pass"`. A criterion that cannot be evaluated
 * is treated as unmet, so the controller returns `incomplete` rather than
 * `verified_complete` (AC-12).
 */
import { randomUUID } from "node:crypto";
import type {
  TaskCriterion,
} from "@/entityTypes/aiTaskExecutionTypes";
import { BudgetReservationResult } from "@/service/aiTaskExecution/TaskRunBudget";

export type CriterionState = "pass" | "fail" | "unknown";

export interface CriterionEvalResult {
  readonly state: CriterionState;
  readonly referenceIds: readonly string[];
  readonly summary: string;
}

/**
 * Context handed to every adapter evaluator. The `content` field is the
 * accumulated assistant response text; `toolCatalogState` is the loop's
 * snapshot of tool-operation states (keyed by targetId); `checkerDispatch`
 * is the checker-LLM call (qualitative only); `budgetReserveChecker` gates
 * the checker LLM (§9: 6/run, 2/candidate, 1 retry).
 */
export interface AdapterContext {
  readonly content: string;
  readonly toolCatalogState?: Readonly<Record<string, unknown>>;
  readonly abortSignal?: AbortSignal;
  readonly checkerDispatch?: (prompt: string) => Promise<string>;
  readonly budgetReserveChecker?: () => BudgetReservationResult;
}

export interface CriterionEvaluator {
  evaluate(criterion: TaskCriterion, context: AdapterContext): Promise<CriterionEvalResult>;
}

/** Generate a stable evidence identity for a criterion evaluation. */
export function newEvidenceId(): string {
  return `evidence-${randomUUID()}`;
}

/**
 * Registry of `adapterKey` → evaluator. Callers register custom adapters by
 * key; the built-in adapters (`observation`, `operation_receipt`,
 * `record_count`) are registered by default. Qualitative + artifact are
 * handled by the service directly (not keyed).
 */
export class CriteriaAdapterRegistry {
  private readonly adapters = new Map<string, CriterionEvaluator>();

  register(adapterKey: string, evaluator: CriterionEvaluator): void {
    this.adapters.set(adapterKey, evaluator);
  }

  get(adapterKey: string): CriterionEvaluator | undefined {
    return this.adapters.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.adapters.has(adapterKey);
  }
}

// ----- Built-in adapter: observation (content substring/regex) -----

/**
 * Observation criteria check whether a target phrase or pattern appears in
 * the assistant's accumulated content. The `targetId` is the phrase to find
 * (case-insensitive substring); if it starts with `regex:` the remainder is
 * compiled as a RegExp. Pass when found, fail when the stream ended cleanly
 * without it, unknown when the stream never ended (cannot conclude absence).
 */
export class ObservationAdapter implements CriterionEvaluator {
  async evaluate(
    criterion: TaskCriterion,
    context: AdapterContext
  ): Promise<CriterionEvalResult> {
    if (criterion.kind !== "observation") {
      return unknown(criterion.id, "observation adapter called on non-observation criterion");
    }
    const target = criterion.targetId;
    const content = context.content ?? "";
    const found = target.startsWith("regex:")
      ? safeRegexTest(target.slice(6), content)
      : content.toLowerCase().includes(target.toLowerCase());
    // When the stream never ended, absence is inconclusive → unknown.
    const state: CriterionState = found ? "pass" : "unknown";
    return {
      state,
      referenceIds: [criterion.id],
      summary: truncate(`${state}: observation "${target}" ${found ? "found" : "not found"} in content`),
    };
  }
}

// ----- Built-in adapter: operation_receipt (tool catalog state) -----

/**
 * Operation-receipt criteria check whether a tool operation reached a
 * required state (`accepted` or `completed`) in the tool catalog snapshot.
 * The `targetId` selects the operation; `requiredState` is the threshold.
 * Pass when the operation's state matches or exceeds the threshold; fail
 * when the operation is present but below threshold; unknown when the
 * operation is absent from the snapshot (cannot conclude it didn't happen
 * elsewhere).
 */
export class OperationReceiptAdapter implements CriterionEvaluator {
  async evaluate(
    criterion: TaskCriterion,
    context: AdapterContext
  ): Promise<CriterionEvalResult> {
    if (criterion.kind !== "operation_receipt") {
      return unknown(criterion.id, "operation_receipt adapter called on non-operation criterion");
    }
    const state = context.toolCatalogState?.[criterion.targetId];
    if (state === undefined) {
      return unknown(criterion.id, `operation ${criterion.targetId} not in catalog snapshot`);
    }
    const opState = typeof state === "string" ? state : (state as { state?: string })?.state ?? "unknown";
    const threshold = criterion.requiredState;
    const passed = meetsOperationThreshold(opState, threshold);
    return {
      state: passed ? "pass" : "fail",
      referenceIds: [criterion.id],
      summary: truncate(`${passed ? "pass" : "fail"}: operation ${criterion.targetId} state="${opState}" required="${threshold}"`),
    };
  }
}

// ----- Built-in adapter: record_count (store query) -----

/**
 * Record-count criteria check whether a store query returned at least
 * `minimum` records. Slice 2 has no store adapter wired, so this returns
 * `"unknown"` when no `recordCountProvider` is supplied in the context.
 * When a provider is supplied, pass when count >= minimum, fail otherwise.
 */
export class RecordCountAdapter implements CriterionEvaluator {
  constructor(
    private readonly recordCountProvider?: (targetId: string, scope: string) => Promise<number | null>
  ) {}

  async evaluate(
    criterion: TaskCriterion,
    context: AdapterContext
  ): Promise<CriterionEvalResult> {
    if (criterion.kind !== "record_count") {
      return unknown(criterion.id, "record_count adapter called on non-record_count criterion");
    }
    if (!this.recordCountProvider) {
      return unknown(criterion.id, "no record_count provider wired (Slice 2 stub)");
    }
    const count = await this.recordCountProvider(criterion.targetId, criterion.scope);
    if (count === null) {
      return unknown(criterion.id, `record_count provider returned null for ${criterion.targetId}`);
    }
    const passed = count >= criterion.minimum;
    return {
      state: passed ? "pass" : "fail",
      referenceIds: [criterion.id],
      summary: truncate(`${passed ? "pass" : "fail"}: record_count ${criterion.targetId} count=${count} minimum=${criterion.minimum}`),
    };
  }
}

// ----- Qualitative evaluator (checker LLM, budget-guarded) -----

/**
 * Qualitative criteria use a checker LLM to judge whether the content
 * satisfies the criterion description. The checker dispatch is budget-guarded
 * via `budgetReserveChecker` (§9: 6/run, 2/candidate, 1 retry). When the
 * budget is exhausted, the state is `"unknown"` (fail-closed → incomplete).
 * AbortError (user cancel during checking) → `"unknown"` (Unit 7 AC-24).
 */
export class QualitativeEvaluator implements CriterionEvaluator {
  async evaluate(
    criterion: TaskCriterion,
    context: AdapterContext
  ): Promise<CriterionEvalResult> {
    if (criterion.kind !== "qualitative") {
      return unknown(criterion.id, "qualitative evaluator called on non-qualitative criterion");
    }
    if (!context.checkerDispatch) {
      return unknown(criterion.id, "no checker dispatch wired");
    }
    // Budget gate: reserve a checker attempt before dispatching.
    if (context.budgetReserveChecker) {
      const reservation = context.budgetReserveChecker();
      if (reservation === BudgetReservationResult.Exhausted) {
        return unknown(criterion.id, "checker budget exhausted (qualitative skipped, fail-closed)");
      }
      // AlreadyReserved is fine — the caller dedups by request ID; we still
      // dispatch this candidate's check (the budget counts the attempt once).
    }
    const prompt = buildCheckerPrompt(criterion.description, context.content);
    try {
      const response = await context.checkerDispatch(prompt);
      const state = parseCheckerResponse(response);
      return {
        state,
        referenceIds: [criterion.id],
        summary: truncate(`${state}: qualitative "${criterion.description.slice(0, 80)}" checker response: ${response.slice(0, 200)}`),
      };
    } catch (error) {
      if (isAbortError(error)) {
        // AC-24: user cancelled during checking → unknown (never verified).
        return unknown(criterion.id, "checker LLM aborted (user cancel)");
      }
      return unknown(criterion.id, `checker LLM error: ${errorMessage(error)}`);
    }
  }
}

// ----- Artifact evaluator (Slice 2 stub → unknown) -----

/**
 * Artifact criteria are stubbed in Slice 2 (no filesystem adapter). Returns
 * `"unknown"` so the criterion is treated as unmet → incomplete (fail-closed).
 * A real filesystem adapter is a later enhancement, not in the 13 GAP-S2 items.
 */
export class ArtifactAdapter implements CriterionEvaluator {
  async evaluate(
    criterion: TaskCriterion,
    _context: AdapterContext
  ): Promise<CriterionEvalResult> {
    if (criterion.kind !== "artifact") {
      return unknown(criterion.id, "artifact adapter called on non-artifact criterion");
    }
    return unknown(criterion.id, "artifact adapter not implemented in Slice 2 (fail-closed → unknown)");
  }
}

// ----- Helpers -----

function unknown(criterionId: string, reason: string): CriterionEvalResult {
  return {
    state: "unknown",
    referenceIds: [criterionId],
    summary: truncate(`unknown: ${reason}`),
  };
}

function truncate(text: string, max = 2000): string {
  return text.length <= max ? text : text.slice(0, max);
}

function safeRegexTest(pattern: string, content: string): boolean {
  try {
    return new RegExp(pattern, "i").test(content);
  } catch {
    // Invalid regex pattern — treat as not found (fail-closed).
    return false;
  }
}

function meetsOperationThreshold(actual: string, required: string): boolean {
  // State progression: pending < claimed < dispatched < accepted < completed.
  // `required` is "accepted" or "completed". Pass when actual meets or exceeds.
  const order = ["pending", "claimed", "dispatched", "accepted", "completed"];
  const actualIdx = order.indexOf(actual);
  const requiredIdx = order.indexOf(required);
  if (actualIdx === -1 || requiredIdx === -1) {
    return actual === required;
  }
  return actualIdx >= requiredIdx;
}

function buildCheckerPrompt(description: string, content: string): string {
  // §8.2: the checker judges whether the content satisfies the criterion.
  // The prompt asks for a yes/no/unknown verdict.
  return `You are a task completion verifier. Determine whether the following criterion is satisfied by the assistant's response.

Criterion: ${description}

Assistant response:
${content.slice(0, 8000)}

Reply with exactly one word: PASS, FAIL, or UNKNOWN. PASS only if the response clearly satisfies the criterion. UNKNOWN if you cannot determine it.`;
}

function parseCheckerResponse(response: string): CriterionState {
  const trimmed = response.trim().toUpperCase();
  if (trimmed.startsWith("PASS")) return "pass";
  if (trimmed.startsWith("FAIL")) return "fail";
  return "unknown";
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build the default adapter registry with the built-in adapters registered
 * by their conventional keys. Callers can override or add custom adapters.
 */
export function buildDefaultRegistry(opts?: {
  readonly recordCountProvider?: (targetId: string, scope: string) => Promise<number | null>;
}): CriteriaAdapterRegistry {
  const registry = new CriteriaAdapterRegistry();
  registry.register("observation", new ObservationAdapter());
  registry.register("operation_receipt", new OperationReceiptAdapter());
  registry.register("record_count", new RecordCountAdapter(opts?.recordCountProvider));
  return registry;
}
