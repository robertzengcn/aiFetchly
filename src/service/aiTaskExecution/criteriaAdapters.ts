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
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, statSync, realpathSync } from "node:fs";
import * as path from "node:path";
import type { Stats } from "node:fs";
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
 *
 * T03 (FR-03): authoritative external evidence providers. `observationProvider`
 * and `operationReceiptProvider` resolve a criterion's targetId to a trusted
 * fresh observation / operation receipt (task-specific Models/Modules); the
 * artifact adapter resolves `relativePath` against `artifactBaseDir` (a
 * validated read-only filesystem root). When a provider is absent the
 * adapter falls back to the legacy behavior (or unknown, fail-closed).
 */
export interface ObservationReceipt {
  readonly observedAt: string;
  readonly referenceId: string;
}

export interface OperationReceipt {
  readonly state: string;
}

export interface AdapterContext {
  readonly content: string;
  readonly toolCatalogState?: Readonly<Record<string, unknown>>;
  readonly abortSignal?: AbortSignal;
  readonly checkerDispatch?: (prompt: string) => Promise<string>;
  readonly budgetReserveChecker?: () => BudgetReservationResult;
  readonly observationProvider?: (targetId: string) => Promise<ObservationReceipt | null>;
  readonly operationReceiptProvider?: (targetId: string) => Promise<OperationReceipt | null>;
  readonly artifactBaseDir?: string;
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

// ----- Built-in adapter: observation (trusted fresh observation) -----

/**
 * Observation criteria require a trusted FRESH observation of the target —
 * not a mention in the assistant's own prose. T03 (FR-03, AC-04): when an
 * `observationProvider` is wired, the targetId is resolved through it and
 * passes only when the provider returns a real observation record (e.g. a
 * task-specific Model row retrieved within the execution window). A promise
 * ("I will check production later") or any other self-report never passes:
 * the maker text is not retrieval.
 *
 * When NO provider is wired (unit-test shapes, shadow mode), the legacy
 * content substring/regex fallback applies: pass when found, unknown when
 * absent (absence is inconclusive until verified — the stream may have
 * ended cleanly without the phrase, but the criterion is treated as unmet).
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
    if (context.observationProvider) {
      try {
        const receipt = await context.observationProvider(target);
        if (receipt) {
          return {
            state: "pass",
            referenceIds: [criterion.id, receipt.referenceId],
            summary: truncate(
              `pass: observation "${target}" retrieved at ${receipt.observedAt}`
            ),
          };
        }
        // Provider consulted, no fresh observation found — the criterion is
        // unmet (unknown: absence of evidence, not evidence of absence).
        return unknown(
          criterion.id,
          `observation "${target}" not retrieved by provider (no fresh record)`
        );
      } catch (error) {
        return unknown(criterion.id, `observation provider threw: ${errorMessage(error)}`);
      }
    }
    // Legacy fallback (no provider wired): content substring/regex.
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

// ----- Built-in adapter: operation_receipt (real operation receipts) -----

/**
 * Operation-receipt criteria check whether a tool operation reached a
 * required state (`accepted` or `completed`). T03 (FR-04): when an
 * `operationReceiptProvider` is wired, the targetId is resolved through it
 * against the authoritative operation store (AiTaskOperationModule by
 * derived key) — not the consult chain's dropped `toolCatalogState` snapshot.
 * Pass when the operation's state meets the threshold; fail when present
 * but below threshold; unknown when the operation is absent (fail-closed —
 * cannot conclude it didn't happen elsewhere).
 *
 * When NO provider is wired, the legacy `toolCatalogState` snapshot read
 * applies (unit-test shapes).
 */
export class OperationReceiptAdapter implements CriterionEvaluator {
  async evaluate(
    criterion: TaskCriterion,
    context: AdapterContext
  ): Promise<CriterionEvalResult> {
    if (criterion.kind !== "operation_receipt") {
      return unknown(criterion.id, "operation_receipt adapter called on non-operation criterion");
    }
    const threshold = criterion.requiredState;
    if (context.operationReceiptProvider) {
      try {
        const receipt = await context.operationReceiptProvider(criterion.targetId);
        if (!receipt) {
          return unknown(criterion.id, `operation ${criterion.targetId} not found in operation store`);
        }
        const passed = meetsOperationThreshold(receipt.state, threshold);
        return {
          state: passed ? "pass" : "fail",
          referenceIds: [criterion.id],
          summary: truncate(`${passed ? "pass" : "fail"}: operation ${criterion.targetId} state="${receipt.state}" required="${threshold}"`),
        };
      } catch (error) {
        return unknown(criterion.id, `operation receipt provider threw: ${errorMessage(error)}`);
      }
    }
    // Legacy fallback (no provider wired): tool catalog snapshot.
    const state = context.toolCatalogState?.[criterion.targetId];
    if (state === undefined) {
      return unknown(criterion.id, `operation ${criterion.targetId} not in catalog snapshot`);
    }
    const opState = typeof state === "string" ? state : (state as { state?: string })?.state ?? "unknown";
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

// ----- Artifact evaluator (validated read-only filesystem) -----

/**
 * Artifact criteria check a file artifact against its expectation. T03
 * (FR-03): a REAL read-only filesystem adapter — the fail-closed stub does
 * not satisfy the Slice 2 release gate. `relativePath` is resolved against
 * `artifactBaseDir` (validated read-only root); the adapter NEVER
 * creates/modifies/deletes anything.
 *
 * - `exists`: pass when the file exists and is readable; unknown when
 *   absent (it may appear later — absence is not failure).
 * - `changed`: pass when the sha256 of the content differs from the
 *   baseline hash embedded in the summary the contract was frozen with;
 *   unknown when there is no baseline to compare against.
 * - `requiredContentChecks`: substring/regex assertions against the file
 *   content (bounded read, ≤ ARTIFACT_MAX_BYTES — NFR-08).
 *
 * Path traversal (the macOS symlink containment bug class): the resolved
 * path is canonicalized and must stay inside the canonicalized base dir —
 * a lexical prefix check on a symlinked path is not containment. Missing
 * base dir or any filesystem error → unknown (fail-closed).
 */
export class ArtifactAdapter implements CriterionEvaluator {
  async evaluate(
    criterion: TaskCriterion,
    context: AdapterContext
  ): Promise<CriterionEvalResult> {
    if (criterion.kind !== "artifact") {
      return unknown(criterion.id, "artifact adapter called on non-artifact criterion");
    }
    const baseDir = context.artifactBaseDir;
    if (!baseDir) {
      return unknown(criterion.id, "no artifact base dir wired (fail-closed)");
    }
    const relativePath = criterion.relativePath;
    if (relativePath.includes("\0")) {
      return unknown(criterion.id, "artifact relativePath contains NUL");
    }
    try {
      const resolvedBase = realpathSync(baseDir);
      const resolved = realpathSync(path.resolve(baseDir, relativePath));
      // Containment: canonical prefix, not lexical (symlinks resolved).
      if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
        return unknown(criterion.id, `artifact path escapes base dir: ${relativePath}`);
      }
      let stat: Stats;
      try {
        stat = statSync(resolved);
      } catch {
        return unknown(criterion.id, `artifact ${relativePath} not readable`);
      }
      if (!stat.isFile()) {
        return unknown(criterion.id, `artifact ${relativePath} is not a regular file`);
      }
      const content = readFileSync(resolved, "utf8");
      const hash = createHash("sha256").update(content).digest("hex");

      const checks: string[] = [];
      let state: CriterionState = "pass";
      if (criterion.expectation === "changed") {
        // Baseline: the contract carries no stored baseline hash in Slice 2,
        // so "changed" is inconclusive until a baseline lifecycle (T17/T26)
        // stores one. Unknown keeps the criterion unmet without a false pass.
        checks.push("changed: no baseline hash stored (inconclusive)");
        state = "unknown";
      }
      // requiredContentChecks: each string is a substring pattern, or a
      // `regex:`-prefixed pattern (same convention as observation targets).
      for (const pattern of criterion.requiredContentChecks ?? []) {
        const met = pattern.startsWith("regex:")
          ? safeRegexTest(pattern.slice(6), content)
          : content.toLowerCase().includes(pattern.toLowerCase());
        checks.push(`${met ? "content-check pass" : "content-check fail"}: "${pattern.slice(0, 80)}"`);
        if (!met && state === "pass") state = "fail";
      }
      return {
        state,
        referenceIds: [criterion.id],
        summary: truncate(
          `${state}: artifact ${relativePath} sha256=${hash.slice(0, 16)} ${checks.join("; ")}`
        ),
      };
    } catch (error) {
      return unknown(criterion.id, `artifact check threw: ${errorMessage(error)}`);
    }
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
 * T03: `recordCountProvider` wires an authoritative store query into the
 * record_count adapter at construction; the observation/operation_receipt
 * providers are threaded per-evaluation via {@link AdapterContext} (they are
 * captured by the consult closure, not frozen into the registry).
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
