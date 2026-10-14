/**
 * Evidence provider factory (T03, FR-03/04/24, AC-03/04/32).
 *
 * Both production seams (the manual enrollment block in
 * {@link AIChatQueryEngine} and the scheduled enrollment in
 * {@link ScheduledExecutionEnroller}) build the same evidence stack:
 * a module-backed {@link TaskEvidenceService} store, authoritative
 * provider-backed record-count / observation / operation-receipt lookups,
 * and a bounded tool-free checker dispatch. This factory owns that
 * construction so the two seams stay in lockstep and the wiring is
 * testable without mocking an entire engine.
 *
 * Evidence must come from task-specific Models/Modules or validated
 * read-only filesystem adapters — maker text and criterion IDs are not
 * external evidence (FR-03). Every provider is fail-closed: a lookup that
 * cannot map the targetId returns null → the adapter records "unknown" →
 * the criterion is unmet → the controller returns `incomplete`, never a
 * false `verified_complete` (AC-12).
 */
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { AiTaskOperationModule } from "@/modules/AiTaskOperationModule";
import { OutboundEmailDeliveryModule } from "@/modules/OutboundEmailDeliveryModule";
import { SearchModule } from "@/modules/SearchModule";
import { ContactInfoRepository } from "@/model/ContactInfo.model";
import { AiChatApi, openAIContentToString } from "@/api/aiChatApi";
import {
  TaskEvidenceService,
  makeModuleBackedStore,
  type EvidenceStoreSnapshot,
} from "@/service/aiTaskExecution/TaskEvidenceService";
import {
  buildDefaultRegistry,
  type ObservationReceipt,
  type OperationReceipt,
} from "@/service/aiTaskExecution/criteriaAdapters";

/**
 * What the factory returns: the evidence service + the per-evaluation
 * providers the seam threads into `EvidenceContext` (the observation and
 * operation-receipt adapters read these from `adapterContext` per
 * evaluation, not from the registry — the registry only freezes the
 * record-count provider at construction). `artifactBaseDir` roots the
 * read-only filesystem artifact adapter.
 */
export interface EvidenceProviders {
  readonly evidenceService: TaskEvidenceService;
  /** T04: the second arg is the per-dispatch abort signal (turn/run + deadline). */
  readonly checkerDispatch: (
    prompt: string,
    signal?: AbortSignal
  ) => Promise<string>;
  readonly observationProvider: (targetId: string) => Promise<ObservationReceipt | null>;
  readonly operationReceiptProvider: (targetId: string) => Promise<OperationReceipt | null>;
  readonly artifactBaseDir: string | null;
}

/** Narrow shape of the execution row the providers scope their queries to. */
export interface ProviderExecutionScope {
  readonly createdAt: Date | null;
  readonly taskId: number | null;
  readonly parentExecutionId: string | null;
}

/**
 * B03 (FR-02/03/10/24; AC-01/04/11/17/27): target→keyword attribution.
 *
 * Time-bounding alone lets a concurrent extraction for another target
 * satisfy this request's count — rows must also be ATTRIBUTED to the
 * criterion's target. Attribution runs through search keywords (the only
 * domain linkage rows carry: `contact_info.result_id →
 * search_result.keyword_id → search_keyword.keyword`): a keyword matches
 * when its normalized text equals the normalized target or contains / is
 * contained in it (short tokens require exact equality — a 2-letter
 * keyword is a substring of everything).
 *
 * Returns the matched keyword ids; empty means the target names nothing in
 * the universe (fail-closed at the call site — never a global fallback).
 */
const TARGET_SUBSTRING_MIN_LENGTH = 4;

function normalizeTargetToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matchTargetKeywordIds(
  targetId: string,
  keywords: ReadonlyArray<{ readonly id: number; readonly keyword: string }>
): number[] {
  const target = normalizeTargetToken(targetId);
  if (!target) return [];
  const matched: number[] = [];
  for (const { id, keyword } of keywords) {
    const key = normalizeTargetToken(keyword);
    if (!key) continue;
    if (key === target) {
      matched.push(id);
      continue;
    }
    if (key.length >= TARGET_SUBSTRING_MIN_LENGTH && target.includes(key)) {
      matched.push(id);
      continue;
    }
    if (target.length >= TARGET_SUBSTRING_MIN_LENGTH && key.includes(target)) {
      matched.push(id);
    }
  }
  return matched;
}

/**
 * B03 wrong-kind gate for record counts: the criterion target names the row
 * kind it counts ("contacts" → contact rows, "results" → search rows). A
 * target naming neither kind (opaque campaign slugs, deliverable nouns the
 * tables do not hold) resolves null — the caller falls back to the legacy
 * table choice for opaque slugs, or to unknown where no fallback is safe.
 */
function recordKindForTarget(targetId: string): "contacts" | "results" | null {
  const normalized = normalizeTargetToken(targetId);
  if (normalized.includes("contact")) return "contacts";
  if (normalized.includes("result")) return "results";
  return null;
}

/**
 * B19 (§10.3, AC-09): bounded read-only source for a native send attempt's
 * terminal status. Implementations read ONE attempt row by id (indexed
 * point read — no scans, no loops, no sleeps) and return its status string,
 * or null when unreadable. The factory maps only terminal-completion
 * statuses (`completed`, `partially_completed`) to an operation upgrade;
 * every other status (in-flight, uncertain, failed, missing) leaves the
 * stored row untouched.
 */
export interface NativeSendStatusReader {
  readSendAttemptStatus(attemptId: number): Promise<string | null>;
}

/** `receipt_reference` shape stamped by guard settlement (`attempt:<id>`). */
const ATTEMPT_RECEIPT_PATTERN = /^attempt:(\d+)$/;

/**
 * B19 (§10.3, AC-09): production native attempt-status source. Reads ONE
 * attempt row by id (indexed point read — bounded, read-only, never sends).
 * Construct lazily inside enrollment seams (BaseModule TDZ — never at module
 * top level), alongside the sibling modules the seams already build.
 */
export function makeNativeSendStatusReader(): NativeSendStatusReader {
  return {
    readSendAttemptStatus: async (attemptId: number) => {
      try {
        const attempt = await new OutboundEmailDeliveryModule().readSendAttempt(
          attemptId
        );
        return attempt?.status ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Derive the authoritative operation key for a criterion's targetId.
 * T03: the compiler emits free-text slugs ("camp-1", "send-email"), which do
 * not match `operation_key` directly. The stable derivation
 * `op:<executionId>:<targetId>` is the key the operation guard writes when
 * the loop dispatches a consequential operation for this execution
 * (Slice 3 TaskOperationGuard). Unmatched → the provider returns null.
 */
export function deriveOperationKey(executionId: string, targetId: string): string {
  return `op:${executionId}:${targetId}`;
}

/**
 * Maximum tokens for the checker verdict (bounded, NFR-02). T04: the §8.2 JSON
 * contract needs more room than a one-word verdict; 256 caps a single
 * criterion result (verdict + evidence ids + a short reason) without giving
 * the checker room to prose around the schema.
 */
const CHECKER_MAX_TOKENS = 256;
const CHECKER_TEMPERATURE = 0;

/**
 * Build the evidence stack for one execution. Constructed lazily inside the
 * flag-gated enrollment blocks (BaseModule TDZ — never at module top level).
 *
 * `scope` bounds the providers' queries to THIS execution: record counts and
 * observations only consider rows created at/after the execution's
 * `createdAt` (unrelated old records cannot satisfy execution-local work,
 * AC-03), and task-scoped counts use the execution's `taskId` when present.
 */
export function buildEvidenceService(deps: {
  readonly executionId: string;
  readonly execModule: AiTaskExecutionModule;
  readonly operationModule: AiTaskOperationModule;
  readonly searchModule: SearchModule;
  readonly contactInfoRepository: ContactInfoRepository;
  readonly abortSignal?: AbortSignal;
  /**
   * B19 (§10.3, AC-09): optional native attempt-status source for
   * accepted→completed reconciliation. Absent in tests and legacy seams —
   * the provider then reports stored state with no upgrade path (the
   * pre-B19 behavior, preserved byte-identical).
   */
  readonly deliveryStatusReader?: NativeSendStatusReader;
}): EvidenceProviders {
  const { executionId } = deps;

  // The execution row is read once (lazy memo) for scope; the CAS token is
  // always read FRESH per consult (the consult closures own that — see the
  // seams), so this memo is never used for persistence.
  let scopeMemo: ProviderExecutionScope | null | undefined;
  const getScope = async (): Promise<ProviderExecutionScope | null> => {
    if (scopeMemo !== undefined) return scopeMemo;
    try {
      const exec = await deps.execModule.getExecution(executionId);
      scopeMemo = exec
        ? {
            createdAt: exec.createdAt ?? null,
            taskId: exec.schedule_id ?? null,
            parentExecutionId: exec.parent_execution_id ?? null,
          }
        : null;
    } catch {
      scopeMemo = null;
    }
    return scopeMemo;
  };

  /**
   * B03 lineage window (FR-10/24; AC-27): a Continue successor inherits its
   * ancestors' progress — the freshness bound for `lineage` scope is the
   * lineage ROOT's creation (oldest reachable ancestor via
   * `parent_execution_id`, G03 anchor), not the successor's own creation,
   * which would exclude valid ancestor progress. Bounded hops, cycle-safe;
   * a broken chain yields the oldest row reached (never null when the own
   * window exists). Observations stay on the OWN window (freshness means
   * this execution — AC-04); only counts use the lineage window.
   */
  const LINEAGE_PARENT_HOPS_MAX = 20;
  let lineageMemo: Date | null | undefined;
  const getLineageWindowStart = async (): Promise<Date | null> => {
    if (lineageMemo !== undefined) return lineageMemo;
    try {
      const own = await getScope();
      if (!own || !own.createdAt) {
        lineageMemo = null;
        return lineageMemo;
      }
      let rootAt: Date | null = own.createdAt;
      const seen = new Set<string>([executionId]);
      let cursor: string | null = own.parentExecutionId;
      let hops = 0;
      while (cursor && !seen.has(cursor) && hops < LINEAGE_PARENT_HOPS_MAX) {
        seen.add(cursor);
        hops += 1;
        let row: {
          readonly createdAt?: Date | null;
          readonly parent_execution_id?: string | null;
        } | null = null;
        try {
          row = await deps.execModule.getExecution(cursor);
        } catch {
          break;
        }
        if (!row) break;
        if (row.createdAt) rootAt = row.createdAt;
        cursor = row.parent_execution_id ?? null;
      }
      lineageMemo = rootAt;
    } catch {
      lineageMemo = null;
    }
    return lineageMemo;
  };

  // ----- recordCountProvider: authoritative Model-backed counts -----

  // AC-03 freshness bound: `lineage` and `execution` scopes ONLY count rows
  // created at/after this execution's `createdAt`. There is NO global-count
  // fallback — an unmappable or window-less scope returns null → the adapter
  // records "unknown" → the criterion is unmet → the controller returns
  // `incomplete`, never a false `verified_complete`. `cumulative` is the only
  // scope that reads the global total, and the compiler never emits it for
  // execution-local work (TaskCriteriaResolver always sets "execution").
  const recordCountProvider = async (
    targetId: string,
    scope: string
  ): Promise<number | null> => {
    const execScope = await getScope();
    if (!execScope) return null;
    try {
      if (scope === "cumulative") {
        // Cumulative: the ContactInfo statistics total (global count — the
        // only count-capable model without execution scoping). Emitted only
        // for cross-execution totals, never for execution-local work.
        const stats = await deps.contactInfoRepository.getStatistics();
        return stats.total;
      }
      if (scope === "lineage" || scope === "execution") {
        // Freshness bound: the lineage ROOT's creation for `lineage`
        // (Continue inherits ancestor progress — B03), the execution's own
        // creation for `execution`. A missing window cannot bound the
        // count, so return null (fail-closed → unknown).
        const windowStart =
          scope === "lineage"
            ? await getLineageWindowStart()
            : execScope.createdAt;
        if (!windowStart) return null;
        // B03 wrong-kind gate: a target naming a row kind counts ONLY that
        // table (contact rows can never satisfy a results criterion and
        // vice versa). An opaque target keeps the legacy table choice
        // below — task-scoped genuine flows keep working while attributable
        // targets are strictly filtered.
        const kind = recordKindForTarget(targetId);
        if (execScope.taskId !== null) {
          const texts = await deps.searchModule.getKeywordTextsByTask(
            execScope.taskId
          );
          // Attributed subset when the target selects task keywords;
          // otherwise the whole task universe (genuine-task fallback —
          // same-task opaque-slug concurrency needs row-level execution
          // linkage, a schema + pipeline follow-up, and stays documented).
          const matched = matchTargetKeywordIds(targetId, texts);
          const keywordIds =
            matched.length > 0 ? matched : texts.map((t) => t.id);
          if (kind === "contacts") {
            return await deps.contactInfoRepository.countSinceForKeywords(
              windowStart,
              keywordIds
            );
          }
          // "results" and opaque targets count search rows (legacy table
          // choice for opaque slugs — genuine task flows keep working).
          return await deps.searchModule.countSearchResultSinceForKeywords(
            keywordIds,
            windowStart
          );
        }
        // No task linkage: attribute against the global keyword universe.
        // Unmatchable here means unattributable — null (the old global
        // count was the foreign-row hole; there is no safe fallback).
        const texts = await deps.searchModule.getAllKeywordTexts();
        const matched = matchTargetKeywordIds(targetId, texts);
        if (matched.length === 0) return null;
        if (kind === "results") {
          return await deps.searchModule.countSearchResultSinceForKeywords(
            matched,
            windowStart
          );
        }
        return await deps.contactInfoRepository.countSinceForKeywords(
          windowStart,
          matched
        );
      }
      return null;
    } catch {
      return null;
    }
  };

  // ----- operationReceiptProvider: AiTaskOperationModule by derived key -----

  const operationReceiptProvider = async (
    targetId: string
  ): Promise<OperationReceipt | null> => {
    try {
      const direct = await deps.operationModule.getOperation(
        deriveOperationKey(executionId, targetId)
      );
      if (direct) return reconcileAcceptedReceipt(direct);
      // B19 (FR-02/03/11/19, AC-09): the compiler emits free-text target
      // slugs ("send-weekly-report") while the guard writes volatile keys
      // ("op:<exec>:outbound_batch:11"), so exact-key lookup always misses
      // for compiler-derived criteria. Fall back to the execution-scoped
      // singleton: with exactly ONE operation row in this execution the
      // linkage is unambiguous (guard rows are send-dispatch rows). Zero
      // or 2+ rows stay unlinked — linking either could cite the wrong
      // send, so fail closed to null → unknown → unmet.
      const rows = await deps.operationModule.listOperationsByExecution(
        executionId,
        50
      );
      if (rows.length !== 1) return null;
      return reconcileAcceptedReceipt(rows[0]);
    } catch {
      return null;
    }
  };

  /**
   * B19 (§10.3, AC-09): reconcile one resolved operation row against native
   * attempt state. The guard settles `accepted` at job-START (claim
   * receipt); the native worker finishes asynchronously, so stored state
   * alone can never verify final job completion. On an `accepted` row with
   * an `attempt:<id>` receipt, one bounded native read upgrades the row to
   * `completed` (CAS write-back, so reload/history paths converge) when the
   * attempt reached terminal completion. Everything else — non-accepted
   * states (including `unknown`, which must reconcile through
   * dispatched/accepted first and never completes by assertion), missing
   * receipts, absent readers, non-terminal native statuses, read failures,
   * and lost CAS races (converge by re-read) — reports stored state.
   */
  const reconcileAcceptedReceipt = async (op: {
    readonly operation_key: string;
    readonly operation_state: string;
    readonly claim_generation: number;
    readonly receipt_reference: string | null;
  }): Promise<OperationReceipt> => {
    if (
      op.operation_state !== "accepted" ||
      !deps.deliveryStatusReader
    ) {
      return { state: op.operation_state };
    }
    const receiptMatch = op.receipt_reference
      ? ATTEMPT_RECEIPT_PATTERN.exec(op.receipt_reference)
      : null;
    if (!receiptMatch) return { state: op.operation_state };
    let nativeStatus: string | null;
    try {
      nativeStatus = await deps.deliveryStatusReader.readSendAttemptStatus(
        Number(receiptMatch[1])
      );
    } catch {
      return { state: op.operation_state };
    }
    if (nativeStatus !== "completed" && nativeStatus !== "partially_completed") {
      return { state: op.operation_state };
    }
    try {
      const settled = await deps.operationModule.updateState({
        operationKey: op.operation_key,
        expectedClaimGeneration: op.claim_generation,
        newState: "completed",
      });
      if (settled.ok) return { state: "completed" };
      // Lost the CAS race (a concurrent settler moved the row): re-read and
      // report the winner's state — convergent, never invented.
      const fresh = await deps.operationModule.getOperation(op.operation_key);
      return { state: fresh?.operation_state ?? op.operation_state };
    } catch {
      return { state: op.operation_state };
    }
  };

  // ----- observationProvider: fresh execution-scoped observation -----

  // AC-04/AC-03: a real observation is a row created within the execution
  // window, and `observedAt` is that ROW's time — not `now()`. A historical
  // row (created before the execution started) cannot satisfy a fresh-
  // observation check: the provider returns null → unknown → unmet. No
  // createdAt window also returns null (fail-closed).
  const observationProvider = async (
    targetId: string
  ): Promise<ObservationReceipt | null> => {
    const execScope = await getScope();
    if (!execScope || !execScope.createdAt) return null;
    // Observations stay on the OWN execution window (freshness means this
    // execution — AC-04), never the lineage window: ancestor rows are not
    // fresh observations of this run.
    const windowStart = execScope.createdAt;
    try {
      // Task-scoped: the freshest row for the execution's task, attributed
      // to the target's keywords when they select a subset (B03), with a
      // row-bound reference (never a generic task slug).
      if (execScope.taskId !== null) {
        const texts = await deps.searchModule.getKeywordTextsByTask(
          execScope.taskId
        );
        const matched = matchTargetKeywordIds(targetId, texts);
        const keywordIds =
          matched.length > 0 ? matched : texts.map((t) => t.id);
        const freshest =
          await deps.searchModule.findLatestSearchResultSinceForKeywords(
            keywordIds,
            windowStart
          );
        if (freshest) {
          return {
            observedAt: freshest.recordTime.toISOString(),
            referenceId: `search-result:${freshest.id}`,
          };
        }
        return null;
      }
      // No task linkage: attribute against the global keyword universe;
      // unmatchable means unattributable (null — the old global freshest
      // row was the arbitrary-row hole).
      const texts = await deps.searchModule.getAllKeywordTexts();
      const matched = matchTargetKeywordIds(targetId, texts);
      if (matched.length === 0) return null;
      const freshest =
        await deps.contactInfoRepository.findLatestSinceForKeywords(
          windowStart,
          matched
        );
      if (freshest) {
        return {
          observedAt: freshest.extractionDate.toISOString(),
          referenceId: `contact-info:${freshest.id}`,
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // ----- checkerDispatch: bounded tool-free AI verdict (NFR-02) -----

  // T04 (NFR-02/04, AC-24): the dispatch takes a per-dispatch abort signal
  // (the QualitativeEvaluator creates a controller linked to the turn/run
  // signal + a checker deadline) and forwards it to openAIChatCompletion so
  // a Stop or a hanging provider stall aborts the in-flight fetch. The
  // entitlement gate runs inside openAIChatCompletion at the start of every
  // call (including retries) — NFR-04 — so this closure does NOT duplicate it.
  const checkerDispatch = async (
    prompt: string,
    signal?: AbortSignal
  ): Promise<string> => {
    const api = new AiChatApi();
    const response = await api.openAIChatCompletion(
      {
        messages: [{ role: "user", content: prompt }],
        max_tokens: CHECKER_MAX_TOKENS,
        temperature: CHECKER_TEMPERATURE,
      },
      { signal }
    );
    return openAIContentToString(response.choices[0]?.message?.content);
  };

  // ----- evidenceService: module-backed store + provider registry -----

  // The registry freezes the record-count provider at construction (the
  // adapter owns it via the registry); observation/operation-receipt
  // providers are threaded per-evaluation via EvidenceContext (the consult
  // closure captures them from this factory's return value).
  const registry = buildDefaultRegistry({ recordCountProvider });

  // Artifact base dir: the user's userData path is the validated read-only
  // root for artifact criteria. Resolved lazily so a worker process that
  // never evaluates artifact criteria does not crash on the missing Electron
  // `app` object (the factory is only constructed in the main process, but
  // the lazy read keeps the import side-effect free).
  const resolveArtifactBaseDir = (): string | null => {
    try {
      // Lazy require so this module is importable in unit tests that stub
      // Electron. The factory runs in the main process where `app` exists.
      const { app } = require("electron") as {
        app: { getPath: (name: string) => string };
      };
      return app.getPath("userData");
    } catch {
      return null;
    }
  };
  const artifactBaseDir = resolveArtifactBaseDir();

  const evidenceService = new TaskEvidenceService(
    makeModuleBackedStore({
      getExecutionState: async (id: string): Promise<EvidenceStoreSnapshot | null> => {
        const exec = await deps.execModule.getExecution(id);
        if (!exec) return null;
        return {
          stateJson: exec.execution_state_json,
          version: exec.execution_state_version,
          finalized: exec.finalized,
        };
      },
      applyShadowDecisionCas: (input: {
        executionId: string;
        expectedVersion: number;
        mergedStateJson: string;
      }) => deps.execModule.mergeExecutionStateEvidence(input),
    }),
    registry
  );

  return {
    evidenceService,
    checkerDispatch,
    observationProvider,
    operationReceiptProvider,
    artifactBaseDir,
  };
}
