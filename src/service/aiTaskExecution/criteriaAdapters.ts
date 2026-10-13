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
import { z } from "zod/v4";
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
  /**
   * The checker-LLM dispatch. T04 (NFR-02/04, AC-24): the second arg is the
   * per-dispatch abort signal — the QualitativeEvaluator creates a
   * per-dispatch AbortController linked to `abortSignal` (the turn/run
   * signal) plus a `CHECKER_DEADLINE_MS` timer, and passes that controller's
   * signal here so a Stop or a hanging provider stall cannot hold the
   * verification gate. Catching an eventual AbortError does not itself abort
   * the in-flight fetch — the signal must propagate to the transport.
   */
  readonly checkerDispatch?: (
    prompt: string,
    signal?: AbortSignal
  ) => Promise<string>;
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

// ----- Qualitative evaluator (checker LLM, schema-validated, abortable) -----

/**
 * Qualitative criteria use a checker LLM to judge whether the content
 * satisfies the criterion description.
 *
 * T04 (FR-04/06/08/22; NFR-02/04/08; AC-11/21/24; §8.2):
 * - **Schema-validated output.** The dispatch returns the §8.2 JSON for the
 *   single criterion. `parseCheckerVerdict` validates parseable JSON, the Zod
 *   schema, `criterionId === criterion.id`, `evidenceIds ⊆ admissible`, and
 *   non-empty `evidenceIds` on `pass`. Malformed `PASS ...` prefix, prompt
 *   injection, invented/absent references → `"unknown"` (never pass).
 * - **Abort + deadline race.** Each dispatch gets a per-dispatch
 *   `AbortController` linked to `context.abortSignal` (turn/run Stop) plus a
 *   `CHECKER_DEADLINE_MS` timer. A hanging request cannot hold the gate (§9:
 *   "Deadline expiry aborts maker/checker/tool awaits"). Abort → unknown
 *   (AC-24: no late verified result).
 * - **One retry on invalid/transient output.** §8.2: "One checker retry per
 *   unchanged candidate is allowed for transient/invalid output, using the
 *   same evidence." The retry is bounded by the 2-per-candidate budget cap
 *   (`reserveCheckerAttempt` returns `Exhausted` on the second reserve). A
 *   valid `pass`/`fail`/`unknown` verdict is final — the checker cannot
 *   override a deterministic fail.
 * - **Entitlement.** Re-checked inside `openAIChatCompletion` at the start of
 *   every dispatch (including retries) — NFR-04. Not duplicated here.
 *
 * Fail-closed default: budget exhausted, dispatch error, abort, or invalid
 * output after retry → `"unknown"` (AC-21: no false Completed).
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
    const prompt = buildCheckerPrompt(criterion, context.content);
    // The guard above narrowed context.checkerDispatch to non-undefined; bind
    // it to a local so dispatchOnce has a stable non-optional reference.
    const dispatch = context.checkerDispatch;

    // First attempt (already reserved by the controller's budgetReserveChecker
    // closure before this evaluate() is called — but guard anyway for direct
    // callers). Exhausted → unknown fail-closed.
    const firstReservation = context.budgetReserveChecker
      ? context.budgetReserveChecker()
      : BudgetReservationResult.Reserved;
    if (firstReservation === BudgetReservationResult.Exhausted) {
      return unknown(criterion.id, "checker budget exhausted (qualitative skipped, fail-closed)");
    }

    const firstResult = await this.dispatchOnce(criterion, prompt, context, dispatch);
    if (firstResult.kind === "verdict") {
      return summarizeVerdict(criterion, firstResult, false);
    }
    // Abort (Stop / deadline) is TERMINAL — no retry (AC-24: no late
    // verified result). A Stop mid-check cannot be retried into a pass.
    if (firstResult.kind === "aborted") {
      return unknown(criterion.id, firstResult.reason);
    }
    // First attempt produced invalid/transient output → one retry within
    // budget (§8.2: "One checker retry per unchanged candidate is allowed for
    // transient/invalid output, using the same evidence"). The retry uses a
    // distinct request id (`:retry`) so the budget dedup does not collapse it
    // onto the first reserve. Exhausted / AlreadyReserved → unknown fail-closed
    // (no third dispatch — the 2-per-candidate cap is enforced by the budget).
    const retryReservation = context.budgetReserveChecker
      ? context.budgetReserveChecker()
      : BudgetReservationResult.Reserved;
    if (retryReservation !== BudgetReservationResult.Reserved) {
      return unknown(
        criterion.id,
        `checker invalid on first attempt (${firstResult.reason}); no retry budget (fail-closed)`
      );
    }
    const retryResult = await this.dispatchOnce(criterion, prompt, context, dispatch);
    if (retryResult.kind === "verdict") {
      return summarizeVerdict(criterion, retryResult, true);
    }
    return unknown(
      criterion.id,
      `checker invalid after retry (first=${firstResult.reason}, retry=${retryResult.reason})`
    );
  }

  /**
   * One dispatch + parse, wrapped in the abort/deadline race. Returns either a
   * valid verdict (pass/fail/unknown — schema-valid, criterion-id match,
   * admissible evidence) or an invalid outcome (transient error / invalid
   * JSON / schema mismatch / invented references). Abort (turn or deadline) →
   * invalid-but-not-retried: the caller treats abort as terminal fail-closed,
   * not a transient retry, per AC-24 ("no late verified result").
   */
  private async dispatchOnce(
    criterion: TaskCriterion,
    prompt: string,
    context: AdapterContext,
    dispatch: (prompt: string, signal?: AbortSignal) => Promise<string>
  ): Promise<DispatchOutcome> {
    // AbortSignal.any links the parent (turn/run Stop) and the per-dispatch
    // deadline controller into one signal — a parent abort or deadline aborts
    // the in-flight dispatch with no manual listener bookkeeping to clean up.
    // The deadline aborts the controller (abort() → AbortError, keeping the
    // AC-24 terminal-abort classification); a parent abort propagates through
    // any() automatically.
    const dispatchController = new AbortController();
    const timer = setTimeout(
      () => dispatchController.abort(),
      CHECKER_DEADLINE_MS
    );
    try {
      const combined = AbortSignal.any(
        context.abortSignal
          ? [context.abortSignal, dispatchController.signal]
          : [dispatchController.signal]
      );
      const response = await dispatch(prompt, combined);
      return parseCheckerVerdict(response, criterion);
    } catch (error) {
      if (isAbortError(error)) {
        // AC-24: Stop or deadline-aborted mid-dispatch → terminal unknown, no
        // retry (no late verified result). Signal this via a distinct outcome.
        return { kind: "aborted", reason: "checker LLM aborted (Stop or deadline)" };
      }
      // Transient error (network/timeout/entitlement throw) → retryable.
      return { kind: "invalid", reason: `checker LLM error: ${errorMessage(error)}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Outcome of one dispatch attempt. */
type DispatchOutcome =
  | {
      readonly kind: "verdict";
      readonly verdict: CriterionState;
      readonly evidenceIds: readonly string[];
      readonly reason: string;
    }
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "aborted"; readonly reason: string };

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

function buildCheckerPrompt(criterion: TaskCriterion, content: string): string {
  // §8.2: the checker judges whether the content satisfies the criterion and
  // returns a per-criterion JSON result. The prompt enumerates the admissible
  // evidence IDs (the criterion id — the checker cannot see prior evidence
  // rows; the evaluator is the boundary) so the checker knows what it may
  // cite. A pass REQUIRES admissible supporting evidence (§8.2: "Every pass
  // cites admissible supporting evidence"). Output is parsed strictly — no
  // provider JSON-mode reliance (§8.2).
  return `You are a task completion verifier. Determine whether the following criterion is satisfied by the assistant's response. Reply ONLY with a single JSON object, no prose, no code fences.

JSON schema (exactly one entry in "criteria"):
{
  "criteria": [
    {
      "criterionId": "${criterion.id}",
      "verdict": "pass" | "fail" | "unknown",
      "evidenceIds": ["${criterion.id}"],
      "reason": "one short sentence"
    }
  ]
}

Rules:
- "verdict": "pass" REQUIRES at least one evidenceId drawn from the admissible set below.
- "verdict": "fail" means the response clearly does NOT satisfy the criterion.
- "verdict": "unknown" means you cannot determine it.
- Do NOT cite evidence ids outside the admissible set.
- Output ONLY the JSON object. No text before or after.

Criterion (${criterion.id}): ${criterion.description}

Admissible evidence ids: ["${criterion.id}"]

Assistant response:
${content.slice(0, 8000)}`;
}

/** Deadline for one checker dispatch (NFR-02; §9 line 445). A hanging request cannot hold the gate. */
const CHECKER_DEADLINE_MS = 30_000;
/** Length bound on the checker's `reason` field (NFR-08). */
const MAX_CHECKER_REASON = 500;

/**
 * Zod schema for the §8.2 checker JSON contract. Strict: exactly one
 * criterion result, enum verdict, string evidence ids, bounded reason.
 */
const checkerResultSchema = z.object({
  criteria: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        verdict: z.enum(["pass", "fail", "unknown"]),
        evidenceIds: z.array(z.string()),
        reason: z.string(),
      })
    )
    .length(1),
});

/**
 * Extract a JSON object from raw LLM output (tolerates code fences / stray
 * text). Mirrors the emailReply helper without importing cross-domain.
 */
function extractJsonObject(raw: string): string | null {
  const fenced = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return fenced.slice(start, end + 1);
}

/**
 * Parse + validate the checker's response against the §8.2 contract.
 * Returns a `verdict` outcome only when the output is schema-valid AND the
 * cross-checks pass (criterionId match, evidenceIds ⊆ admissible, non-empty
 * on pass). Any violation → `invalid` (the caller retries once within budget,
 * then fails closed). Malformed `PASS ...` prefix and prompt-injection text
 * never yield a verdict here — they are not valid JSON (AC-11/21).
 */
function parseCheckerVerdict(
  response: string,
  criterion: TaskCriterion
): DispatchOutcome {
  const jsonText = extractJsonObject(response);
  if (!jsonText) {
    return { kind: "invalid", reason: "no JSON object in checker response" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { kind: "invalid", reason: "checker response is not valid JSON" };
  }
  const result = checkerResultSchema.safeParse(parsed);
  if (!result.success) {
    return {
      kind: "invalid",
      reason: `checker JSON failed schema validation: ${result.error.message.slice(0, 200)}`,
    };
  }
  const entry = result.data.criteria[0];
  if (entry.criterionId !== criterion.id) {
    return {
      kind: "invalid",
      reason: `checker criterionId mismatch: got "${entry.criterionId}" expected "${criterion.id}"`,
    };
  }
  // Admissible evidence set: the criterion id (the evaluator is the boundary;
  // the checker cannot cite external evidence ids).
  const admissible = new Set<string>([criterion.id]);
  const allAdmissible = entry.evidenceIds.every((id) => admissible.has(id));
  if (!allAdmissible) {
    return {
      kind: "invalid",
      reason: `checker cited non-admissible evidence ids: ${JSON.stringify(entry.evidenceIds)}`,
    };
  }
  // §8.2: "Every pass cites admissible supporting evidence." Empty evidence on
  // pass → invalid (invented/absent references cannot satisfy a pass).
  if (entry.verdict === "pass" && entry.evidenceIds.length === 0) {
    return {
      kind: "invalid",
      reason: "checker verdict pass with no evidence ids (citations required)",
    };
  }
  return {
    kind: "verdict",
    verdict: entry.verdict,
    evidenceIds: entry.evidenceIds,
    reason: entry.reason.slice(0, MAX_CHECKER_REASON),
  };
}

/** Build the CriterionEvalResult summary for a valid verdict. */
function summarizeVerdict(
  criterion: TaskCriterion,
  result: { readonly verdict: CriterionState; readonly evidenceIds: readonly string[]; readonly reason: string },
  retried: boolean
): CriterionEvalResult {
  return {
    state: result.verdict,
    // The validated evidence ids the checker cited + the structural criterion
    // anchor. The service persists both as evidence rows.
    referenceIds: [...result.evidenceIds, criterion.id],
    summary: truncate(
      `${result.verdict}: qualitative "${criterion.description.slice(0, 80)}"${retried ? " (after retry)" : ""} reason: ${result.reason}`
    ),
  };
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
