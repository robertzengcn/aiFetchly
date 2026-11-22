/**
 * run_browser_tasks — bounded parallel browser fan-out (PRD M-FR-01..05;
 * technical design §17).
 *
 * One async job; up to 5 tasks at concurrency 1..3, each run by the
 * `agent-browser-operator` sub-agent over its OWN managed-browser session.
 * Failure isolation: one task crashing marks only that task failed and the
 * batch returns partial results. v1 sub-agents do NOT perform consequential
 * actions — they return needs_user proposals (M-FR-05). Extracted data is
 * returned to the parent, which dedupes before any save (M-FR-11).
 */
import { randomUUID } from "node:crypto";
import { AgentRuntimeRegistry, getDefaultAgentRuntimeDeps } from "@/service/AgentRuntimeRegistry";
import { getDefaultAgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";
import { getDefaultToolJobRegistry } from "@/service/ToolJobRegistry";
import { registrableDomainOf } from "@/service/browserDecision/RegistrableDomain";

// B03: the managed-browser module is imported dynamically at every use
// site (the static binding can be uninitialized in mocked/circular
// module graphs — the fast-runner stop path died on exactly that).

export interface BrowserBatchTaskInput {
  readonly goal: string;
  readonly start_url?: string;
  readonly account_id?: number;
  readonly proxy_id?: number;
  readonly keep_open?: boolean;
}

export interface BrowserBatchTaskResult {
  readonly task_index: number;
  /** 'partial' is reserved for Return-results-now handling in a later phase. */
  readonly status: "completed" | "failed" | "cancelled" | "partial";
  readonly summary: string;
  readonly extracted: readonly unknown[];
  readonly final_url: string | null;
  readonly evidence: readonly string[];
  readonly needs_user: { readonly type: string; readonly proposed_action?: string } | null;
  readonly user_interventions: ReadonlyArray<{
    readonly reason: string;
    readonly started_at: number;
    readonly duration_ms: number | null;
  }>;
  readonly session_id?: string;
  /**
   * R07/T15b: externalized output receipts the child produced WITH parent
   * access already granted (AgentRuntime terminal). Deduplicated ACROSS
   * sibling rows at aggregation — the same receipt never surfaces twice
   * to the parent.
   */
  readonly output_ids?: readonly string[];
}

export const MAX_BATCH_TASKS = 5;
export const MAX_BATCH_CONCURRENCY = 3;

/** M-FR-02: strict sub-agent result schema. */
export const BROWSER_OPERATOR_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "failed", "needs_user"] },
    summary: { type: "string", maxLength: 1000 },
    extracted: { type: "array", items: { type: "object" } },
    final_url: { type: ["string", "null"] },
    evidence: { type: "array", items: { type: "string" } },
    needs_user: {
      type: ["object", "null"],
      properties: {
        type: { type: "string", enum: ["approval", "login", "input"] },
        proposed_action: { type: "string" },
      },
    },
    user_interventions: { type: "array", items: { type: "object" } },
    session_id: { type: ["string", "null"] },
  },
  required: ["status", "summary", "extracted", "final_url", "evidence", "needs_user", "user_interventions"],
};

import { z } from "zod";

/** Validated tool arguments for run_browser_tasks (PRD M-FR-03 bounds). */
export const browserBatchArgsSchema = z
  .strictObject({
    tasks: z
      .array(
        z.strictObject({
          goal: z.string().min(1).max(2000),
          start_url: z.string().url().max(2048).optional(),
          account_id: z.number().int().positive().optional(),
          proxy_id: z.number().int().positive().optional(),
          keep_open: z.boolean().optional(),
        })
      )
      .min(1)
      .max(MAX_BATCH_TASKS),
    concurrency: z.number().int().min(1).max(MAX_BATCH_CONCURRENCY).optional(),
    // R04/M-FR-12: the executor — "llm_agent" (default) runs the LLM
    // operator; "fast_runner" drives the decision runner DIRECTLY (no
    // LLM loop) on a session started per task.
    executor: z.enum(["llm_agent", "fast_runner"]).optional(),
  })
  .superRefine((value, ctx) => {
    const uniqueGoals = new Set(value.tasks.map((t) => t.goal));
    if (uniqueGoals.size !== value.tasks.length) {
      ctx.addIssue({ code: "custom", message: "duplicate_task_goal" });
    }
  });

/**
 * F20/D-AC-02: the SAME provider-aware admission as every browser tool —
 * AI availability, browser enablement, and the parallel-agents feature
 * switch are checked BEFORE any session start or agent admission. Note the
 * deliberate ABSENCE of the browserDecisionEnabled check: parallel browser
 * tasks are the EXISTING browser tools path and stay usable when
 * acceleration is disabled (D-AC-12).
 */
export async function runBrowserTasksForTool(
  tasks: readonly BrowserBatchTaskInput[],
  concurrency: number,
  conversationId: string,
  signal: AbortSignal,
  deps: RunBrowserTasksDeps = {},
  /** R11: the calling tool's registry job id (parent poll freeze). */
  parentJobId?: string,
  /** R04/M-FR-12: the executor switch + the sub-agent model override. */
  options?: {
    executor?: "llm_agent" | "fast_runner";
    subAgentModel?: string | null;
  }
): Promise<{
  batchId: string;
  results: BrowserBatchTaskResult[];
  /** M-FR-04: false when the user refused the batch confirmation card. */
  confirmed?: boolean;
}> {
  const { BrowserAiAvailabilityService } = await import(
    "@/service/browserDecision/BrowserAiAvailabilityService"
  );
  if (!new BrowserAiAvailabilityService().isAvailable()) {
    throw new Error("ai_disabled:browser_ai_unavailable");
  }
  const { ManagedBrowserSettingsModule } = await import(
    "@/modules/ManagedBrowserSettingsModule"
  );
  const effective = await new ManagedBrowserSettingsModule()
    .getEffectiveSettings();
  if (!effective.browserEnabled) {
    throw new Error(
      `managed_browser_disabled:${effective.disabledReasonCode ?? "browser_disabled"}`
    );
  }
  if (!effective.parallelAgentsEnabled) {
    throw Error(
      "managed_browser_disabled:parallel_agents_disabled"
    );
  }
  // C01/M-FR-10: the provider gate is scoped by the batch's PROVIDER
  // identity — the fast_runner uses the decision route (mode + model or
  // native endpoint), the llm_agent uses the sub-agent model. Two
  // unrelated routes never serialize against each other's slots.
  const providerScope =
    options?.executor === "fast_runner"
      ? `decision:${effective.decisionRoute.mode}:${effective.decisionRoute.chatDecisionModel ?? ""}:${effective.decisionRoute.nativeProfile?.baseUrl ?? ""}`
      : `agent:${options?.subAgentModel ?? ""}`;
  return runBrowserTasks(
    tasks,
    concurrency,
    conversationId,
    signal,
    deps,
    parentJobId,
    { ...options, providerScope }
  );
}

/** Bounded-concurrency worker-pool executor (modeled on process_artifact_batch). */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const laneCount = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: laneCount }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]!, index);
      }
    })
  );
  return results;
}

export interface RunBrowserTasksDeps {
  readonly runAgent?: typeof AgentRuntimeRegistry.getRuntime;
  readonly control?: ReturnType<typeof getDefaultAgentTaskControlService>;
  /** M-FR-06: the busy-account queue wait (default 8s; tests shrink it). */
  readonly busyQueueWaitMs?: number;
}

/** T13: live batch abort trees — renderer Stop/Return-now abort children. */
const liveBatches = new Map<string, AbortController>();

/**
 * R03/M-FR-10 + C01/M-FR-06/10/12: the SHARED provider gate — parallel
 * lanes serialize on a per-PROVIDER in-flight cap and a batch token/cost
 * ceiling. The cap is scoped by provider identity (two unrelated routes
 * never serialize against each other), acquisition is CANCELABLE (a Stop
 * while queued wakes the waiter and grants NOTHING), and one release
 * corresponds to exactly one granted slot.
 */
const PROVIDER_CONCURRENCY_LIMIT = 2;
const BATCH_TOKEN_BUDGET = 400_000;

const providerInFlightByScope = new Map<string, number>();
interface ProviderSlotWaiter {
  readonly scope: string;
  readonly resolve: () => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}
const providerWaiters: ProviderSlotWaiter[] = [];

function providerUsage(scope: string): number {
  return providerInFlightByScope.get(scope) ?? 0;
}

/**
 * Acquire a provider slot for the given scope. Returns TRUE when a slot
 * was GRANTED (the caller MUST release exactly once); FALSE when the
 * signal aborted before a grant (the caller MUST NOT run provider work
 * and MUST NOT release — the old fall-through decremented a slot it
 * never held).
 */
async function acquireProviderSlot(
  scope: string,
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  while (providerUsage(scope) >= PROVIDER_CONCURRENCY_LIMIT) {
    if (signal.aborted) {
      return false;
    }
    // C01: the wait is abortable — a Stop while queued resolves the
    // waiter (which then returns false) instead of hanging until some
    // unrelated lane releases.
    await new Promise<void>((resolve) => {
      const onAbort = (): void => {
        const idx = providerWaiters.indexOf(waiter);
        if (idx >= 0) {
          providerWaiters.splice(idx, 1);
        }
        resolve();
      };
      const waiter: ProviderSlotWaiter = { scope, resolve, signal, onAbort };
      signal.addEventListener("abort", onAbort, { once: true });
      providerWaiters.push(waiter);
    });
  }
  if (signal.aborted) {
    return false;
  }
  providerInFlightByScope.set(scope, providerUsage(scope) + 1);
  return true;
}

function releaseProviderSlot(scope: string): void {
  providerInFlightByScope.set(scope, Math.max(0, providerUsage(scope) - 1));
  // C01: wake exactly ONE non-aborted waiter holding THIS scope for the
  // freed slot. Aborted waiters are dropped (their acquire returned
  // false); waiters for OTHER scopes keep their independent accounting.
  const deferred: ProviderSlotWaiter[] = [];
  let woke = false;
  for (let waiter = providerWaiters.shift(); waiter; waiter = providerWaiters.shift()) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.signal.aborted) {
      continue;
    }
    if (!woke && waiter.scope === scope) {
      waiter.resolve();
      woke = true;
      continue;
    }
    deferred.push(waiter);
  }
  if (deferred.length > 0) {
    providerWaiters.push(...deferred);
  }
}

/**
 * R03/M-FR-10: the batch token budget — true while the remaining lanes
 * may still call the provider; a lane that would exceed the budget ends
 * the batch with a truthful partial instead of stampeding the endpoint.
 */
interface BatchTokenBudget {
  batchId: string;
  remainingTokens: number;
  exceeded: boolean;
}
const batchTokenBudgets = new Map<string, BatchTokenBudget>();

function registerBatchTokenBudget(batchId: string, budgetTokens: number): void {
  batchTokenBudgets.set(batchId, {
    batchId,
    remainingTokens: budgetTokens,
    exceeded: false,
  });
}

/**
 * Charge a lane's reported usage against its batch budget. Returns false
 * when the charge EXCEEDED the budget (the caller stops the lane).
 */
function chargeBatchTokens(batchId: string, usedTokens: number): boolean {
  const budget = batchTokenBudgets.get(batchId);
  if (!budget) {
    return true;
  }
  budget.remainingTokens -= usedTokens;
  if (budget.remainingTokens < 0) {
    budget.exceeded = true;
    return false;
  }
  return true;
}

/**
 * C01/M-FR-10/12: charge a lane run's reported usage against the batch
 * budget. The envelope carries `tokensUsed` at the TOP level (the
 * fast-runner maps the decision runner's provider-reported usage) and the
 * collector charges EVERY run — the initial dispatch AND a queued-account
 * retry (previously the retry's actual cost was never charged).
 * Returns true when the charge EXCEEDED the budget (the caller aborts the
 * remaining lanes).
 */
function chargeLaneUsage(
  batchId: string,
  result: { tokensUsed?: number; output?: { tokensUsed?: number } }
): boolean {
  const laneUsage =
    typeof result.tokensUsed === "number"
      ? result.tokensUsed
      : typeof result.output?.tokensUsed === "number"
        ? result.output.tokensUsed
        : 0;
  if (laneUsage <= 0) {
    return false;
  }
  return !chargeBatchTokens(batchId, laneUsage);
}

/** True while the batch's token budget has not been exceeded. */
function batchBudgetAlive(batchId: string): boolean {
  return batchTokenBudgets.get(batchId)?.exceeded !== true;
}

function releaseBatchTokenBudget(batchId: string): void {
  batchTokenBudgets.delete(batchId);
}

/**
 * R01/M-FR-04: the batch-scoped ROUTINE-ACTION grant. A confirmed batch
 * grants observe/navigate/click/fill/select to ITS agent tasks for the
 * batch lifetime — consequential actions (the ALWAYS-CONFIRM bar) can
 * never use it (M-FR-05 stays a separate needs_user). The grant is
 * recorded at confirmation and released when the batch settles; routine
 * ops are currently auto-approved globally, so enforcement is invisible
 * until policy tightens them — this registry is the grant source.
 */
interface BatchRoutineGrant {
  readonly batchId: string;
  readonly taskIds: ReadonlyArray<string>;
  /** C02/M-FR-04: registrable domains the confirmed batch may act on. */
  readonly domains: ReadonlySet<string>;
  readonly grantedAtEpochMs: number;
  /** C02/M-FR-04: expiring — bounded to the batch horizon. */
  readonly expiresAtEpochMs: number;
}
/** C02/M-FR-04: routine grants expire (covers the longest user-wait). */
const ROUTINE_GRANT_TTL_MS = 60 * 60_000;
const batchRoutineGrants = new Map<string, BatchRoutineGrant>();

/**
 * C02/M-FR-04: True when the agent task belongs to a LIVE (unexpired)
 * confirmed batch grant AND the dispatch site is in scope. A grant with
 * derived domains only covers those sites; a grant with NO derivable
 * domains covers the batch's own started sessions (tasks without an
 * explicit start_url run on the account's platform home). Consequential
 * approvals are a separate, unchanged path.
 */
export function hasRoutineGrantForAgentTask(
  agentTaskId: string,
  currentDomain?: string | null
): boolean {
  const now = Date.now();
  for (const [batchId, grant] of batchRoutineGrants) {
    if (grant.expiresAtEpochMs <= now) {
      batchRoutineGrants.delete(batchId);
      continue;
    }
    if (!grant.taskIds.includes(agentTaskId)) {
      continue;
    }
    if (grant.domains.size === 0) {
      return true;
    }
    if (currentDomain && grant.domains.has(currentDomain)) {
      return true;
    }
  }
  return false;
}

function registerBatchRoutineGrant(
  batchId: string,
  tasks: readonly BrowserBatchTaskInput[]
): void {
  const domains = new Set<string>();
  for (const task of tasks) {
    if (typeof task.start_url === "string" && task.start_url) {
      try {
        const domain = registrableDomainOf(new URL(task.start_url).hostname);
        if (domain) {
          domains.add(domain);
        }
      } catch {
        /* unparsable start urls contribute no scope */
      }
    }
  }
  batchRoutineGrants.set(batchId, {
    batchId,
    taskIds: Array.from({ length: tasks.length }, (_, index) => `${batchId}:${index}`),
    domains,
    grantedAtEpochMs: Date.now(),
    expiresAtEpochMs: Date.now() + ROUTINE_GRANT_TTL_MS,
  });
}

function releaseBatchRoutineGrant(batchId: string): void {
  batchRoutineGrants.delete(batchId);
}

/** C02 test seam: register a grant exactly as a confirmed batch would. */
export function registerBatchRoutineGrantForTest(input: {
  readonly batchId: string;
  readonly taskIds: readonly string[];
  readonly domains?: readonly string[];
}): void {
  batchRoutineGrants.set(input.batchId, {
    batchId: input.batchId,
    taskIds: [...input.taskIds],
    domains: new Set(input.domains ?? []),
    grantedAtEpochMs: Date.now(),
    expiresAtEpochMs: Date.now() + ROUTINE_GRANT_TTL_MS,
  });
}
/**
 * F17: per-child abort trees — stopping ONE batch child task must
 * never cancel its siblings.
 */
const liveChildren = new Map<string, AbortController>();

/**
 * F21: live batch events reach the renderer's batch control card
 * through this sink (registered by the main-process IPC bridge).
 */
export interface BrowserBatchEvent {
  readonly batchId: string;
  /** P1/M-FR-08: the owning conversation — the card filters by it. */
  readonly conversationId: string;
  readonly phase: "started" | "task" | "finished";
  readonly taskId?: string;
  readonly label?: string;
  readonly state?:
    | "running"
    | "waiting_for_user"
    | "queued"
    | "paused"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted"
    // W02: a partial runner ending reaches the card as its own state.
    | "partial";
  readonly summary?: string;
  /** A05/M-FR-08: the LIVE session id when the lane has one. */
  readonly sessionId?: string;
}
type BatchEventSink = (event: BrowserBatchEvent) => void;
let batchEventSink: BatchEventSink | null = null;

/** Register the renderer sink (main-process IPC bridge). */
export function setBrowserBatchEventSink(sink: BatchEventSink | null): void {
  batchEventSink = sink;
}

function emitBatchEvent(event: BrowserBatchEvent): void {
  try {
    batchEventSink?.(event);
  } catch {
    // A dead renderer never breaks the batch.
  }
}

/** Abort a batch's child tasks (C-FR-11 Return results now / M-FR-09 Stop). */
export function abortBatch(batchId: string): number {
  const controller = liveBatches.get(batchId);
  if (!controller) {
    return 0;
  }
  controller.abort();
  return 1;
}

/** F17: abort a SINGLE batch child task (BROWSER_TASK_STOP on `<batch>:<i>`). */
export function abortTask(taskId: string): number {
  const controller = liveChildren.get(taskId);
  if (!controller) {
    return 0;
  }
  controller.abort();
  return 1;
}

// ---------------------------------------------------------------------------
// M-FR-04/W08: the batch confirmation card. The batch does NOT start until
// the user confirms the listed tasks and sites. The confirm grant is
// consumed by the start and expires with the batch — nothing persists past
// the run (M-FR-04: no standing routine-action consent).
// ---------------------------------------------------------------------------

export interface BatchConfirmTaskPreview {
  readonly index: number;
  readonly goal: string;
  /** Registrable site the task will drive (null when goal-only). */
  readonly site: string | null;
}

export interface PendingBatchConfirmRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly tasks: readonly BatchConfirmTaskPreview[];
  readonly resolve: (input: { confirmed: boolean; cancelled: boolean }) => void;
  readonly createdAt: number;
}

const BATCH_CONFIRM_TTL_MS = 10 * 60_000;

class BatchConfirmWaitRegistry {
  private readonly pending = new Map<string, PendingBatchConfirmRequest>();
  private sink: ((request: PendingBatchConfirmRequest) => void) | null = null;
  /**
   * R07/M-FR-04: fired when a pending card leaves the registry WITHOUT a
   * user decision (parent Stop or TTL expiry) so the renderer can retire
   * the card immediately instead of waiting for its local TTL sweep.
   */
  private dismissalSink:
    | ((input: { requestId: string; conversationId: string }) => void)
    | null = null;

  /** Whether a renderer is wired — without one the card cannot be shown. */
  public hasSink(): boolean {
    return this.sink !== null;
  }

  public setSink(sink: ((request: PendingBatchConfirmRequest) => void) | null): void {
    this.sink = sink;
  }

  public setDismissalSink(
    sink:
      | ((input: { requestId: string; conversationId: string }) => void)
      | null
  ): void {
    this.dismissalSink = sink;
  }

  public create(input: {
    readonly conversationId: string;
    readonly tasks: readonly BatchConfirmTaskPreview[];
  }): {
    readonly request: PendingBatchConfirmRequest;
    readonly promise: Promise<{ confirmed: boolean; cancelled: boolean }>;
  } {
    let resolve!: PendingBatchConfirmRequest["resolve"];
    const promise = new Promise<{ confirmed: boolean; cancelled: boolean }>(
      (res) => {
        resolve = res;
      }
    );
    const requestId = `bconfirm_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const request: PendingBatchConfirmRequest = {
      requestId,
      conversationId: input.conversationId,
      tasks: input.tasks,
      resolve,
      createdAt: Date.now(),
    };
    this.pending.set(requestId, request);
    this.sink?.(request);
    setTimeout(() => {
      const entry = this.pending.get(requestId);
      if (entry) {
        this.pending.delete(requestId);
        entry.resolve({ confirmed: false, cancelled: true });
        // R07: the TTL expiry retires the CARD too (no user decision).
        this.dismissalSink?.({
          requestId,
          conversationId: entry.conversationId,
        });
      }
    }, BATCH_CONFIRM_TTL_MS).unref?.();
    return { request, promise };
  }

  /** Single-use, owner-conversation-bound consume (mirrors the site confirm). */
  public consume(input: {
    readonly requestId: string;
    readonly conversationId: string;
  }): PendingBatchConfirmRequest | null {
    const entry = this.pending.get(input.requestId);
    if (!entry || entry.conversationId !== input.conversationId) {
      return null;
    }
    this.pending.delete(input.requestId);
    return entry;
  }

  /**
   * N06/M-FR-04: RETIRE a pending confirmation — a parent Stop during the
   * wait resolves the waiting lane AND removes the card (the stale request
   * no longer lingers until the TTL or a stray renderer response).
   */
  public cancel(requestId: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return false;
    }
    this.pending.delete(requestId);
    entry.resolve({ confirmed: false, cancelled: true });
    // R07: the parent-Stop retirement reaches the CARD as well.
    this.dismissalSink?.({
      requestId,
      conversationId: entry.conversationId,
    });
    return true;
  }
}

const batchConfirmRegistry = new BatchConfirmWaitRegistry();

/** Renderer-facing accessor for the batch-confirm IPC handler. */
export function getBatchConfirmWaitRegistry(): BatchConfirmWaitRegistry {
  return batchConfirmRegistry;
}

/**
 * W09/M-FR-06: busy-account RESERVATIONS — a queued task holds one across
 * its retry so two waiters for the SAME account can never both pass
 * start. The map chains one promise per account id: acquiring awaits the
 * previous holder's release.
 */
const busyAccountReservations = new Map<number, Promise<void>>();

async function acquireBusyAccountReservation(
  accountId: number
): Promise<() => void> {
  const previous = busyAccountReservations.get(accountId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  busyAccountReservations.set(
    accountId,
    previous.then(() => gate)
  );
  void previous.then(() => gate).catch(() => undefined);
  await previous;
  return release;
}

/** Registrable host of the task's start URL (null when absent/unparseable). */
function batchTaskSiteOf(startUrl: string | undefined): string | null {
  if (!startUrl) {
    return null;
  }
  try {
    return new URL(startUrl).hostname || null;
  } catch {
    return null;
  }
}

/**
 * M-FR-04: the start gate. With a wired renderer the batch waits for the
 * user's confirmation of the listed tasks and sites; without one (headless
 * tool runs) it cannot block forever and proceeds — the per-child tool
 * gates (needs_user, never consequential) still hold.
 */
async function requestBatchConfirmation(
  conversationId: string,
  tasks: readonly BrowserBatchTaskInput[],
  signal: AbortSignal
): Promise<boolean> {
  // R01/M-FR-04: the confirmation is REQUIRED — the old fail-open (no
  // renderer sink → auto-approve) started a consequential batch with
  // zero user consent. Product runs (the desktop app) always wire the
  // sink; a missing one refuses the batch and the model reports it.
  if (!batchConfirmRegistry.hasSink()) {
    return false;
  }
  // B07/M-FR-04: the preview prepopulates sites for ACCOUNT-ONLY tasks —
  // the account's site registrable domain comes from the site registry,
  // never guessed from a start URL the caller did not give.
  const previewTasks = await Promise.all(
    tasks.map(async (task, index) => {
      if (task.start_url) {
        return {
          index,
          goal: task.goal,
          site: batchTaskSiteOf(task.start_url),
        };
      }
      if (typeof task.account_id === "number" && task.account_id > 0) {
        try {
          // N06/S-FR-06: credential-FREE metadata — getAccountDetail
          // decrypts the stored password for the editor; the preview needs
          // only the site identity.
          const { SocialAccountModule } = await import(
            "@/modules/socialAccountModule"
          );
          const meta = await new SocialAccountModule().getAccountSiteMetadata(
            task.account_id
          );
          if (meta) {
            const { getDefaultBrowserSiteModule } = await import(
              "@/modules/BrowserSiteModule"
            );
            const site = await getDefaultBrowserSiteModule().getSite(meta.siteId);
            if (site) {
              return {
                index,
                goal: task.goal,
                site: site.registrableDomain,
              };
            }
          }
        } catch {
          // Unknown account — the preview shows the goal without a site.
        }
      }
      return { index, goal: task.goal, site: null };
    })
  );
  // R07/M-FR-04: the preview lookup is asynchronous — a parent Stop that
  // lands DURING it must not start a wait (or publish a card) afterwards.
  if (signal.aborted) {
    return false;
  }
  const { request, promise } = batchConfirmRegistry.create({
    conversationId,
    tasks: previewTasks,
  });
  // B07/C-FR-09 + N06: the wait is CANCELLATION-AWARE — a parent Stop
  // resolves the wait immediately AND RETIRES the card (the stale request
  // no longer lingers until the TTL or a stray renderer response).
  const confirmation = await new Promise<{
    confirmed: boolean;
    cancelled: boolean;
  }>((resolve) => {
    let settled = false;
    const settle = (value: { confirmed: boolean; cancelled: boolean }): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    void promise.then(settle);
    const onAbort = (): void => {
      batchConfirmRegistry.cancel(request.requestId);
      settle({ confirmed: false, cancelled: true });
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return confirmation.confirmed && !confirmation.cancelled;
}

export async function runBrowserTasks(
  tasks: readonly BrowserBatchTaskInput[],
  concurrency: number,
  conversationId: string,
  signal: AbortSignal,
  deps: RunBrowserTasksDeps = {},
  /** R11/C-FR-09: the PARENT registry job — its user-wait clock freezes
   * while any lane's child sits in a user wait. */
  parentJobId?: string,
  /** R04/M-FR-12: the executor switch + the sub-agent model override. */
  options?: {
    executor?: "llm_agent" | "fast_runner";
    subAgentModel?: string | null;
    /** C01/M-FR-10: the provider-identity scope for the in-flight cap. */
    providerScope?: string;
  }
): Promise<{
  batchId: string;
  results: BrowserBatchTaskResult[];
  /** M-FR-04: false when the user refused the batch confirmation card. */
  confirmed?: boolean;
}> {
  const batchId = `batch_${randomUUID().slice(0, 12)}`;
  const batchAbort = new AbortController();
  const onOuterAbort = (): void => batchAbort.abort();
  signal.addEventListener("abort", onOuterAbort, { once: true });
  liveBatches.set(batchId, batchAbort);
  const control = deps.control ?? getDefaultAgentTaskControlService();
  // M-FR-04/W08: the batch does NOT start until the user confirms the
  // listed tasks and sites. The confirm grant is consumed by this start
  // and expires with the batch (nothing persists past the run). A parent
  // abort during the wait refuses the batch.
  // C03/C-FR-09: the confirmation wait is a USER wait — the parent poll's
  // deadline must freeze for it (the watchdog below only starts once the
  // batch is running; a 45-minute confirmation decision never trips the
  // turn deadline).
  const registryForConfirm = getDefaultToolJobRegistry();
  if (parentJobId && !signal.aborted) {
    registryForConfirm.setUserWait(parentJobId, true, "batch_confirmation_wait");
  }
  const confirmed = signal.aborted
    ? false
    : await requestBatchConfirmation(conversationId, tasks, signal);
  if (parentJobId) {
    registryForConfirm.setUserWait(parentJobId, false);
  }
  if (!confirmed || signal.aborted) {
    liveBatches.delete(batchId);
    signal.removeEventListener("abort", onOuterAbort);
    return {
      batchId,
      results: [],
      confirmed: false,
    };
  }
  // R01/M-FR-04: the confirmed batch's scoped routine grant lives for
  // exactly the batch lifetime.
  registerBatchRoutineGrant(batchId, tasks);
  // R03/M-FR-10: the batch token budget (per batch, all lanes share).
  registerBatchTokenBudget(batchId, BATCH_TOKEN_BUDGET);
  // F21: the batch card lives from the first lane start.
  emitBatchEvent({ batchId, conversationId, phase: "started" });
  // R11/C-FR-09: freeze the PARENT poll's deadline for the full active
  // user wait — a lane's child sitting in an approval/handoff/pause
  // wait must not burn the parent's turn deadline. The watchdog samples
  // the lane control records and flags the parent job accordingly.
  let parentWaitWatchdog: ReturnType<typeof setInterval> | null = null;
  // R04/M-FR-08: the last emitted lane wait-state — the card sees the
  // waiting/paused TRANSITION once, not a per-second repeat.
  const laneWaitState = new Map<string, string>();
  if (parentJobId) {
    const registry = getDefaultToolJobRegistry();
    const { getDefaultManagedBrowserModule: getModuleForWatchdog } =
      await import("@/modules/ManagedBrowserModule");
    parentWaitWatchdog = setInterval(() => {
      try {
        let waiting = false;
        for (let index = 0; index < tasks.length; index++) {
          const rowTaskId = `${batchId}:${index}`;
          const record = control.get(rowTaskId);
          const isWaiting =
            record?.state === "waiting_for_user" || record?.state === "paused";
          if (isWaiting) {
            waiting = true;
          }
          // R04: emit the lane's waiting/paused state on TRANSITION —
          // the card already labels both ("Waiting for you" /
          // "Paused by you") but no producer ever emitted them.
          const waitState = isWaiting
            ? (record?.state as string)
            : record?.state === "running"
              ? "running"
              : null;
          const previous = laneWaitState.get(rowTaskId);
          if (waitState !== null && waitState !== previous) {
            laneWaitState.set(rowTaskId, waitState);
            emitBatchEvent({
              batchId,
              conversationId,
              phase: "task",
              taskId: rowTaskId,
              state: waitState as BrowserBatchEvent["state"],
              // R04/M-FR-08: the wait-state event carries the LIVE
              // session so the row's browser controls stay addressable.
              sessionId:
                getModuleForWatchdog().findSessionIdForAgentTask(rowTaskId) ??
                undefined,
              summary:
                waitState === "paused"
                  ? "paused by user (browser under your control)"
                  : "waiting for your decision",
            });
          }
        }
        registry.setUserWait(
          parentJobId,
          waiting,
          waiting ? "browser_batch_user_wait" : undefined
        );
      } catch {
        // best-effort: the poll deadline is advisory here
      }
    }, 1_000);
    parentWaitWatchdog.unref?.();
  }

  let results: BrowserBatchTaskResult[];
  try {
    results = await runWithConcurrency(
      tasks,
      concurrency,
      async (task, index): Promise<BrowserBatchTaskResult> => {
      const taskId = `${batchId}:${index}`;
      // R07/M-FR-09: refuse already-aborted lanes before starting.
      if (signal.aborted || batchAbort.signal.aborted) {
        // R03/M-FR-10: a budget-killed batch reports the TRUE reason.
        const budgetKilled = !batchBudgetAlive(batchId);
        return {
          task_index: index,
          status: "cancelled",
          summary: budgetKilled
            ? "batch token budget exceeded — lane not run"
            : "skipped (batch already aborted)",
          extracted: [],
          final_url: null,
          evidence: budgetKilled ? ["batch_token_budget_exceeded"] : [],
          needs_user: null,
          user_interventions: [],
        };
      }
      control.register(taskId, conversationId);
      emitBatchEvent({ batchId, conversationId, phase: "task", taskId, label: task.goal, state: "running" });
      const childAbort = new AbortController();
      liveChildren.set(taskId, childAbort);
      const onParentAbort = (): void => childAbort.abort();
      signal.addEventListener("abort", onParentAbort, { once: true });
      batchAbort.signal.addEventListener("abort", onParentAbort, {
        once: true,
      });
      // R04/M-FR-08: the row's LIVE session id rides every event so the
      // card's browser controls address the right session even before
      // the child finishes (resolved from the module's authoritative
      // owner mapping).
      const { getDefaultManagedBrowserModule: getModuleForEvents } =
        await import("@/modules/ManagedBrowserModule");
      const liveSessionId = (): string | undefined =>
        getModuleForEvents().findSessionIdForAgentTask(childAgentTaskId) ??
        undefined;
      // N02/M-AC-01: the child's AUTHORITATIVE ownership key is the
      // CONTROL task id — the child registers it BEFORE any session
      // starts (AgentRuntime passes it as ownerAgentId), so cleanup is
      // scoped correctly even when a crash loses the result.
      const childAgentTaskId: string = taskId;
      try {
        const prompt = buildTaskPrompt(task, index, tasks.length);
        const runtime = (deps.runAgent ?? AgentRuntimeRegistry.getRuntime)();
        // M-FR-06: an account-backed task whose account is BUSY is queued
        // once (bounded wait) instead of failing account_in_use — the
        // sibling holding the account typically finishes within seconds.
        // R04/M-FR-12: "fast_runner" drives the decision runner DIRECTLY
        // (no LLM loop) — start a session for the task, execute the goal
        // through browser_execute_task, stop unless keep_open. "llm_agent"
        // (default) runs the LLM operator, optionally on the configured
        // sub-agent model.
        const runFastRunner = async (): Promise<{
          status: string;
          output: Record<string, unknown>;
          errorMessage?: string;
        }> => {
          const { getDefaultManagedBrowserAiToolService } = await import(
            "@/service/ManagedBrowserAiToolService"
          );
          const service = getDefaultManagedBrowserAiToolService();
          // B03/M-FR-02/07/09: the adapter is typed end to end against the
          // shapes the service actually returns — the start status carries
          // `sessionId` (a `session_id` read silently launched a session
          // the task never received).
          const started = (await service.startSession(
            {
              ...(typeof task.account_id === "number" && task.account_id > 0
                ? { account_id: task.account_id }
                : {}),
              purpose: prompt.slice(0, 300),
              ...(task.start_url ? { requested_start_url: task.start_url } : {}),
              // B03/M-FR-09: the requested proxy rides the START — dropping
              // it silently changed the lane's network route.
              ...(typeof task.proxy_id === "number" && task.proxy_id > 0
                ? { proxy: { proxy_id: task.proxy_id } }
                : {}),
            },
            {
              conversationId,
              toolCallId: `batch-fast-${taskId}`,
              ownerAgentId: childAgentTaskId,
              skipPermissionCheck: true,
              // B03/M-FR-08: Stop DURING the launch aborts the start — the
              // lane signal rides start, not only the task execution.
              signal: childAbort.signal,
            }
          )) as { sessionId?: string; session_id?: string };
          const sessionId = started.sessionId ?? started.session_id;
          if (!sessionId) {
            return {
              status: "failed",
              output: {
                status: "failed",
                summary: "fast_runner start returned no session",
                extracted: [],
                final_url: null,
                evidence: [],
              },
            };
          }
          try {
            const executed = (await service.executeTask(
              {
                session_id: sessionId,
                goal: task.goal,
              },
              {
                conversationId,
                toolCallId: `batch-fast-exec-${taskId}`,
                ownerAgentId: childAgentTaskId,
                signal: childAbort.signal,
                skipPermissionCheck: true,
              }
            )) as {
              status?: string;
              reason?: string;
              extracted?: unknown[];
              evidence?: string[];
              finalObservation?: { url?: string | null } | null;
              tokensUsed?: number;
            };
            // B03: the collector validates output.status strictly against
            // completed | failed | needs_user. interrupted = partial
            // results (no automatic resume) renders as terminal partial;
            // the REAL terminal status and reason ride the summary so
            // nothing is lost in the mapping. The ENVELOPE status is the
            // RUN status (completed = the run finished; the task outcome
            // lives in output.status) — exactly the AgentRuntime.runSync
            // envelope the llm_agent path returns.
            const terminalStatus = executed.status ?? "unknown";
            const terminalReason =
              typeof executed.reason === "string" ? executed.reason.slice(0, 200) : "";
            const taskStatus =
              terminalStatus === "completed"
                ? "completed"
                : terminalStatus === "partial" || terminalStatus === "interrupted"
                  ? "needs_user"
                  : "failed";
            // C01/M-FR-10/12: the decision runner's ACTUAL token usage
            // rides the envelope so the collector charges the batch
            // budget with real cost (never a mock-shaped field).
            const laneTokensUsed =
              typeof executed.tokensUsed === "number" && executed.tokensUsed > 0
                ? executed.tokensUsed
                : undefined;
            return {
              status: "completed",
              ...(laneTokensUsed !== undefined ? { tokensUsed: laneTokensUsed } : {}),
              output: {
                status: taskStatus,
                summary:
                  taskStatus === "completed"
                    ? task.goal
                    : `fast_runner ended ${terminalStatus}${terminalReason ? `: ${terminalReason}` : ""}`.slice(0, 1000),
                extracted: executed.extracted ?? [],
                final_url: executed.finalObservation?.url ?? null,
                evidence: executed.evidence ?? [],
                ...(laneTokensUsed !== undefined
                  ? { tokensUsed: laneTokensUsed }
                  : {}),
                // B03/M-FR-07: the retained session id rides the output —
                // the keep-open transfer reads it; a missing id released
                // the browser even on a COMPLETED keep-open task.
                ...(task.keep_open ? { session_id: sessionId } : {}),
              },
            };
          } catch (error) {
            return {
              status: "failed",
              output: {
                status: "failed",
                summary:
                  error instanceof Error
                    ? error.message.slice(0, 1000)
                    : "fast_runner error",
                extracted: [],
                final_url: null,
                evidence: [],
              },
            };
          } finally {
            if (!task.keep_open) {
              // B03: dynamic import like the other cleanup sites — the
              // module-level static binding can be uninitialized in
              // mocked/circular graphs (the old fast path ALWAYS died
              // here with a TDZ before its finally could stop anything).
              const { getDefaultManagedBrowserModule } = await import(
                "@/modules/ManagedBrowserModule"
              );
              await getDefaultManagedBrowserModule()
                .stop(sessionId, "cancelled")
                .catch(() => undefined);
            }
          }
        };
        const runOnce = async (): Promise<
          Awaited<ReturnType<typeof runtime.runSync>>
        > => {
          if (options?.executor === "fast_runner") {
            return (await runFastRunner()) as Awaited<
              ReturnType<typeof runtime.runSync>
            >;
          }
          return runtime.runSync(
            {
              agentId: "agent-browser-operator",
              ...(options?.subAgentModel
                ? { model: options.subAgentModel }
                : {}),
              prompt,
              taskPacket: {
                userGoal: prompt,
                requiredOutputSchema: BROWSER_OPERATOR_OUTPUT_SCHEMA,
                constraints: { allowInteractivePermissionPrompts: false },
              },
              parentConversationId: conversationId,
              // W06/M-FR-08: user-visible label — notices published for
              // this child's session (challenge/login/handoff) NAME the
              // task in the parent conversation.
              taskLabel: `Browser task ${index + 1}/${tasks.length}`,
              // B02/M-FR-08: ONE task identity — the batch card's row id
              // owns the control record, so Pause/Take-control/Stop and
              // the loop's gate address the SAME record.
              controlTaskId: taskId,
            } as unknown as Parameters<typeof runtime.runSync>[0],
            {
              ...getDefaultAgentRuntimeDeps(),
              signal: childAbort.signal,
              // F06 + N03/C-FR-09: a blocking handoff/credential wait AND
              // an explicit Pause freeze the child's active-time deadline
              // (the registry flag alone misses an explicit pause).
              isUserWaiting: (childConversationId: string) =>
                getDefaultToolJobRegistry().isConversationWaitingForUser(
                  childConversationId
                ) ||
                getDefaultAgentTaskControlService().isUserWaitState(
                  childConversationId
                ),
            }
          );
        };
        // R03/M-FR-10: the lane's provider calls run under the shared
        // per-provider concurrency gate; a lane whose batch already blew
        // the token budget ends with a truthful partial instead of
        // stampeding the endpoint.
        if (!batchBudgetAlive(batchId)) {
          control.setState(taskId, "partial", "batch_token_budget_exceeded");
          return {
            task_index: index,
            status: "partial",
            summary: "batch token budget exceeded — this lane did not run",
            extracted: [],
            final_url: null,
            evidence: ["batch_token_budget_exceeded"],
            needs_user: null,
            user_interventions: mapInterventions(
              control.get(taskId)?.interventions ?? []
            ),
          };
        }
        // C01/M-FR-06/10: a canceled acquire grants NOTHING — the lane
        // ends as a user stop without running provider work and without
        // releasing a slot it never held.
        const providerScope = options?.providerScope ?? "default";
        let result: Awaited<ReturnType<typeof runOnce>>;
        if (
          !(await acquireProviderSlot(providerScope, childAbort.signal))
        ) {
          control.setState(taskId, "cancelled", "user_stop");
          return {
            task_index: index,
            status: "cancelled",
            summary: "cancelled by user stop (queued for a provider slot)",
            extracted: [],
            final_url: null,
            evidence: ["provider_slot_cancelled"],
            needs_user: null,
            user_interventions: mapInterventions(
              control.get(taskId)?.interventions ?? []
            ),
          };
        }
        try {
          result = await runOnce();
        } finally {
          releaseProviderSlot(providerScope);
        }
        // R03/C01: charge the lane's reported usage against the budget.
        if (chargeLaneUsage(batchId, result)) {
          // The batch aborts the REMAINING lanes (truthful partial).
          batchAbort.abort();
        }
        const resultFailedCode = (
          result.output as { reason?: string } | null
        )?.reason;
        const accountBusy =
          typeof task.account_id === "number" &&
          !childAbort.signal.aborted &&
          !batchAbort.signal.aborted &&
          !signal.aborted &&
          (resultFailedCode === "account_in_use" ||
            JSON.stringify(result.output ?? {}).includes("account_in_use"));
        if (accountBusy) {
          // W09/M-FR-06/C-FR-09: the task is QUEUED behind the account's
          // active session — NOT waiting_for_user (no human is involved;
          // a user-wait clock would wrongly freeze active time). The wait
          // POLLS the account lease so the retry starts the moment the
          // holder finishes, instead of one fixed sleep.
          emitBatchEvent({
            batchId,
            conversationId,
            phase: "task",
            taskId,
            state: "queued",
            summary: "account in use — queued behind the active session",
            sessionId: liveSessionId(),
          });
          const { getDefaultManagedBrowserLeaseService, accountLeaseKey } =
            await import("@/service/ManagedBrowserLeaseService");
          const leaseService = getDefaultManagedBrowserLeaseService();
          const leaseKey = accountLeaseKey(task.account_id!);
          // R02/M-FR-06: the queue WAITS for the account, it does not
          // race one short retry — the bound is the batch horizon (10
          // minutes; deps.busyQueueWaitMs overrides for tests), and the
          // task starts the moment the holder releases. The child's own
          // active budget has not begun (the lane has not started), so
          // the queue is bounded by the batch, not by runtime.
          const queueDeadline = Date.now() + (deps.busyQueueWaitMs ?? 10 * 60_000);
          let leaseFree = false;
          while (Date.now() < queueDeadline) {
            if (
              childAbort.signal.aborted ||
              batchAbort.signal.aborted ||
              signal.aborted
            ) {
              break;
            }
            if (!leaseService.isHeld(leaseKey)) {
              leaseFree = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          leaseFree =
            leaseFree &&
            !childAbort.signal.aborted &&
            !batchAbort.signal.aborted &&
            !signal.aborted;
          if (leaseFree) {
            // W09: hold a RESERVATION across the retry — two queued tasks
            // for the SAME account can never both pass start (the second
            // waits for the first's reservation to release).
            const releaseReservation = await acquireBusyAccountReservation(
              task.account_id!
            );
            // R01/M-FR-09: recheck aborts IMMEDIATELY after obtaining the
            // reservation — a Stop/Return-now during the wait must not
            // start the lane it was meant to cancel.
            if (
              childAbort.signal.aborted ||
              batchAbort.signal.aborted ||
              signal.aborted
            ) {
              releaseReservation();
            } else {
              try {
                emitBatchEvent({
                  batchId,
                  conversationId,
                  phase: "task",
                  taskId,
                  state: "running",
                  summary: "queued task retrying",
                  sessionId: liveSessionId(),
                });
                // C01/M-FR-06/10: the retry's acquire is cancelable too —
                // a Stop while queued ends the lane without a slot, and
                // the retry's actual usage IS charged (it was missed).
                if (
                  await acquireProviderSlot(providerScope, childAbort.signal)
                ) {
                  try {
                    result = await runOnce();
                  } finally {
                    releaseProviderSlot(providerScope);
                  }
                  // R03/C01: charge the retry run's reported usage.
                  if (chargeLaneUsage(batchId, result)) {
                    batchAbort.abort();
                  }
                } else {
                  result = {
                    status: "cancelled",
                    output: null,
                  } as unknown as Awaited<ReturnType<typeof runOnce>>;
                }
              } finally {
                releaseReservation();
              }
            }
          }
        }
        // F17: the three abort sources classify DIFFERENTLY.
        //  - parent signal → whole batch cancelled (T13 semantics);
        //  - batchAbort alone → Return-results-now: unfinished tasks
        //    report PARTIAL with bounded evidence, finished tasks keep
        //    their real output;
        //  - per-child abort → that ONE task is cancelled, siblings
        //    continue.
        const parentCancelled = signal.aborted;
        const returnNow = !parentCancelled && batchAbort.signal.aborted;
        const childStopped =
          !parentCancelled && !returnNow && childAbort.signal.aborted;
        const hasUsableOutput =
          result.status === "completed" && result.output != null;
        // B01/M-AC-01: cleanup and session-id validation scope to THIS
        // task's authoritative ownership (childAgentTaskId, lane-level).
        // T13: a parent-signal abort ALWAYS outranks the result. For a
        // return-now or a single-child stop, output that already landed
        // is honored (the work finished before the abort landed).
        if (
          parentCancelled ||
          ((returnNow || childStopped) && !hasUsableOutput)
        ) {
          // C-FR-11: the RESULT says partial — the control record must
          // agree (interrupted = partial results, no automatic resume),
          // never `failed` for a return-now the user requested.
          control.setState(
            taskId,
            returnNow ? "interrupted" : "cancelled",
            returnNow ? "return_now_partial" : "user_stop"
          );
          // B01: the early branch cleans up ITS OWN task's sessions too —
          // a child aborted mid-start would otherwise leak its lease.
          // Awaited so the cancellation result does not claim release
          // before the module acted.
          if (childAgentTaskId) {
            try {
              const { getDefaultManagedBrowserModule } = await import(
                "@/modules/ManagedBrowserModule"
              );
              await getDefaultManagedBrowserModule().stopAllForAgentTask(
                childAgentTaskId,
                "cancelled"
              );
            } catch {
              /* best effort */
            }
          }
          // R11/C-FR-11 + C06/D-FR-09: partial EVIDENCE the child already
          // produced rides the interrupted/cancelled result — bounded like
          // the terminal path (PER-ITEM caps AND the total-byte check the
          // count-only cap missed), and a cancelled child's TEXT result
          // (partialContent — the AgentRuntime cancelled envelope has no
          // output object) is preserved as bounded evidence too.
          const partialOutput = result.output as {
            evidence?: unknown;
            extracted?: unknown;
            final_url?: unknown;
          } | null;
          const partialEvidence = Array.isArray(partialOutput?.evidence)
            ? (partialOutput.evidence as unknown[])
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.slice(0, 300))
                .slice(0, 20)
            : [];
          const cancelledPartialText =
            typeof (result as unknown as { partialContent?: unknown })
              .partialContent === "string"
              ? ((result as unknown as { partialContent: string })
                  .partialContent || ""
                ).slice(0, 2000)
              : "";
          if (cancelledPartialText) {
            partialEvidence.push(`partial_text:${cancelledPartialText}`);
          }
          const partialExtracted = Array.isArray(partialOutput?.extracted)
            ? ((): unknown[] => {
                // C06: the count cap alone let an oversized AGGREGATE
                // through — per-item caps AND the total-byte check apply
                // exactly like the terminal path.
                const items = (partialOutput.extracted as unknown[])
                  .filter(
                    (item) =>
                      typeof item === "string" ||
                      (item !== null && typeof item === "object")
                  )
                  .slice(0, 50);
                const bounded: unknown[] = [];
                let totalBytes = 0;
                for (const item of items) {
                  let safe: unknown = item;
                  if (typeof item === "string") {
                    safe = item.slice(0, 2000);
                  } else if (item !== null && typeof item === "object") {
                    try {
                      const serialized = JSON.stringify(item);
                      if (serialized.length > 2000) {
                        safe = { truncated: true, bytes: serialized.length };
                      }
                    } catch {
                      safe = { truncated: true, bytes: 0 };
                    }
                  }
                  totalBytes += JSON.stringify(safe ?? null).length;
                  if (totalBytes > 64 * 1024) {
                    break;
                  }
                  bounded.push(safe);
                }
                return bounded;
              })()
            : [];
          const partialFinalUrl =
            typeof partialOutput?.final_url === "string" &&
            (() => {
              try {
                const parsed = new URL(partialOutput.final_url);
                return parsed.protocol === "http:" || parsed.protocol === "https:";
              } catch {
                return false;
              }
            })()
              ? (partialOutput.final_url as string).slice(0, 2048)
              : null;
          return {
            task_index: index,
            status: returnNow ? "partial" : "cancelled",
            summary: returnNow
              ? "returned early (user requested results)"
              : "cancelled by user stop",
            extracted: partialExtracted,
            final_url: partialFinalUrl,
            evidence: returnNow
              ? [...partialEvidence, "return_now:unfinished"]
              : partialEvidence,
            needs_user: null,
            user_interventions: mapInterventions(
              control.get(taskId)?.interventions ?? []
            ),
          };
        }
        // T12/R01: the AGENT completing is not the BROWSER task succeeding —
        // the child's output.status is validated STRICTLY against the schema
        // (completed | failed | needs_user). A missing or unrecognized
        // status (lenient parse fallback, malformed output) is a FAILED
        // task, never silently completed.
        const childOutputStatus = (
          result.output as { status?: string } | null
        )?.status;
        const strictChildStatus =
          childOutputStatus === "completed" ||
          childOutputStatus === "failed" ||
          childOutputStatus === "needs_user"
            ? childOutputStatus
            : null;
        const finalStatus: BrowserBatchTaskResult["status"] =
          result.status !== "completed"
            ? "failed"
            : strictChildStatus === "failed"
              ? "failed"
              : strictChildStatus === "needs_user"
                ? "partial"
                : strictChildStatus === "completed"
                  ? "completed"
                  : "failed";
        const cleanupEvidence: string[] = [];
        // C05/M-FR-07: the child-reported session id is read and
        // shape-validated BEFORE terminalization — the ownership check
        // happens in the transfer path below.
        const outputSessionId = (
          result.output as { session_id?: string } | null
        )?.session_id;
        // R01/M-FR-02: batch-boundary output VALIDATION — the child's
        // summary/evidence/final_url are bounded and shape-checked (the
        // schema allows longer strings through the lenient parse path),
        // and a malformed retained session id is dropped.
        const rawOutput = result.output as {
          summary?: string;
          evidence?: string[];
          final_url?: string | null;
        } | null;
        const boundedSummary = String(
          rawOutput?.summary ?? result.errorMessage ?? result.status
        ).slice(0, 1000);
        // A09/M-FR-09: evidence/extracted/needs_user are SHAPE-CHECKED —
        // a malformed value (non-array evidence, wrong container) never
        // throws into the generic handler or changes task ownership.
        const boundedEvidence = Array.isArray(rawOutput?.evidence)
          ? (rawOutput.evidence as unknown[])
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.slice(0, 300))
              .slice(0, 20)
          : [];
        const boundedFinalUrl =
          typeof rawOutput?.final_url === "string" &&
          (() => {
            try {
              const parsed = new URL(rawOutput.final_url);
              return parsed.protocol === "http:" || parsed.protocol === "https:";
            } catch {
              return false;
            }
          })()
            ? rawOutput.final_url.slice(0, 2048)
            : null;
        // R07/M-FR-09: nested extraction is bounded PER ITEM and in
        // TOTAL bytes — the top-level cap alone let one oversized item
        // (or an oversized aggregate) through to the parent envelope.
        const boundedExtracted = Array.isArray(
          (result.output as { extracted?: unknown } | null)?.extracted
        )
          ? ((): unknown[] => {
              const items = ((result.output as { extracted: unknown[] }).extracted as unknown[])
                .slice(0, 200);
              const bounded: unknown[] = [];
              let totalBytes = 0;
              for (const item of items) {
                let safe: unknown = item;
                if (typeof item === "string") {
                  safe = item.slice(0, 2000);
                } else if (item !== null && typeof item === "object") {
                  try {
                    const serialized = JSON.stringify(item);
                    if (serialized.length > 2000) {
                      // An oversized object degrades to a bounded marker —
                      // its content never reaches the parent verbatim.
                      safe = { truncated: true, bytes: serialized.length };
                    }
                  } catch {
                    safe = { truncated: true, bytes: 0 };
                  }
                } else if (typeof item === "number" || typeof item === "boolean") {
                  safe = item;
                } else {
                  safe = null;
                }
                totalBytes += JSON.stringify(safe ?? null).length;
                if (totalBytes > 64 * 1024) {
                  cleanupEvidence.push("extracted_total_bytes_capped");
                  break;
                }
                bounded.push(safe);
              }
              return bounded;
            })()
          : [];
        // R07/M-FR-09: the proposal TYPE is enum-validated against the
        // child output schema (approval | login | input) — a permissive
        // type check let arbitrary strings surface as actionable cards.
        const rawNeedsUser = (result.output as { needs_user?: unknown } | null)?.needs_user;
        const needsUserType = (
          rawNeedsUser as { type?: unknown } | null
        )?.type;
        if (
          rawNeedsUser !== null &&
          typeof rawNeedsUser === "object" &&
          !(
            typeof needsUserType === "string" &&
            ["approval", "login", "input"].includes(needsUserType)
          )
        ) {
          cleanupEvidence.push("needs_user_proposal_dropped:unknown_type");
        }
        const boundedNeedsUser =
          rawNeedsUser !== null &&
          typeof rawNeedsUser === "object" &&
          typeof needsUserType === "string" &&
          ["approval", "login", "input"].includes(needsUserType)
            ? {
                type: needsUserType,
                ...((rawNeedsUser as { proposed_action?: unknown }).proposed_action !== undefined
                  ? {
                      proposed_action: String(
                        (rawNeedsUser as { proposed_action: unknown }).proposed_action
                      ).slice(0, 1000),
                    }
                  : {}),
              }
            : null;
        // F17: cancellation is a CONTROL state, not a failure.
        // W02: the control record carries the result's real status — a
        // needs_user partial is terminal partial, not failed.
        control.setState(taskId, finalStatus);
        // B01/M-AC-01/M-FR-07: cleanup and transfer validate the
        // session's AUTHORITATIVE owner — a child-reported session_id
        // that belongs to another task is never stopped or transferred,
        // and the fallback (no id reported) stops only THIS task's
        // sessions, never the conversation-wide set (which would close
        // sibling and parent sessions). Cleanup is AWAITED so the result
        // does not claim released leases before the module acted.
        if (!task.keep_open) {
          // N02/M-AC-01: the reported id, when owned by this task, is
          // stopped; a FOREIGN id is refused AND the child's own sessions
          // (its true ownership) are still closed — the reported id never
          // suppresses the real cleanup.
          try {
            const { getDefaultManagedBrowserModule } = await import(
              "@/modules/ManagedBrowserModule"
            );
            const module = getDefaultManagedBrowserModule();
            if (typeof outputSessionId === "string" && outputSessionId) {
              const owner = module.getSessionOwnerAgentTaskId(outputSessionId);
              if (owner === childAgentTaskId) {
                // C05/M-FR-09: a failure stopping the REPORTED id must not
                // skip the other owned sessions' cleanup — every stop is
                // attempted and unresolved state is reported in evidence.
                try {
                  await module.stop(outputSessionId, "cancelled");
                } catch {
                  cleanupEvidence.push(
                    `cleanup_stop_failed:${outputSessionId}`
                  );
                }
                // R06: the reported id is closed AND every OTHER
                // child-owned session (a first attempt's leftover) is
                // released too — the reported id never suppresses the
                // full child-scoped cleanup.
                const others = await module.stopAllForAgentTask(
                  childAgentTaskId,
                  "cancelled"
                );
                if (others.failedSessionIds.length > 0) {
                  cleanupEvidence.push(
                    `cleanup_partial:${others.failedSessionIds.join(",")}`
                  );
                }
              } else {
                cleanupEvidence.push("cleanup_skipped:session_owner_mismatch");
                // The foreign session is left alone, but THIS task's own
                // sessions (e.g. a first attempt's) must still close.
                const released = await module.stopAllForAgentTask(
                  childAgentTaskId,
                  "cancelled"
                );
                if (released.failedSessionIds.length > 0) {
                  cleanupEvidence.push(
                    `cleanup_partial:${released.failedSessionIds.join(",")}`
                  );
                }
              }
            } else {
              const released = await module.stopAllForAgentTask(
                childAgentTaskId,
                "cancelled"
              );
              if (released.failedSessionIds.length > 0) {
                cleanupEvidence.push(
                  `cleanup_partial:${released.failedSessionIds.join(",")}`
                );
              }
            }
          } catch {
            cleanupEvidence.push("cleanup_failed");
          }
        }
        // N02/M-FR-07: a keep_open transfer happens ONLY on a successful
        // keep-open result with an OWNED session — the transfer then
        // actually REASSIGNS ownership to the parent conversation; a
        // foreign or unknown-owner id is refused and never surfaced. A
        // FAILED keep-open result cleans the child's sessions up.
        let transferredSessionId: string | undefined = undefined;
        if (task.keep_open) {
          if (finalStatus !== "completed") {
            try {
              const { getDefaultManagedBrowserModule } = await import(
                "@/modules/ManagedBrowserModule"
              );
              const released = await getDefaultManagedBrowserModule().stopAllForAgentTask(
                childAgentTaskId,
                "cancelled"
              );
              // A07/M-AC-01: partial stop failures are REPORTED — the
              // caller can distinguish full cleanup from partial.
              cleanupEvidence.push(
                released.failedSessionIds.length === 0
                  ? "keep_open_failed_sessions_released"
                  : `keep_open_failed_sessions_partial:${released.failedSessionIds.join(",")}`
              );
            } catch {
              cleanupEvidence.push("keep_open_failed_cleanup_error");
            }
          } else if (typeof outputSessionId === "string" && outputSessionId) {
            try {
              const { getDefaultManagedBrowserModule } = await import(
                "@/modules/ManagedBrowserModule"
              );
              const module = getDefaultManagedBrowserModule();
              const owner = module.getSessionOwnerAgentTaskId(outputSessionId);
              if (owner === childAgentTaskId) {
                // N02: the transfer is EXPLICIT — the session is
                // reassigned from the child to the parent conversation.
                await module.transferSessionToConversation(
                  outputSessionId,
                  conversationId
                );
                transferredSessionId = outputSessionId;
                // R06: the transferred session is no longer child-owned —
                // any OTHER child-owned session still closes.
                const others = await module.stopAllForAgentTask(
                  childAgentTaskId,
                  "cancelled"
                );
                if (others.failedSessionIds.length > 0) {
                  cleanupEvidence.push(
                    `keep_open_others_partial:${others.failedSessionIds.join(",")}`
                  );
                }
              } else {
                cleanupEvidence.push("keep_open_transfer_refused:owner_mismatch");
                // Refused transfer: the retained id must NOT surface.
                await module.stopAllForAgentTask(childAgentTaskId, "cancelled");
                cleanupEvidence.push("keep_open_refused_sessions_released");
              }
            } catch {
              cleanupEvidence.push("keep_open_transfer_refused:error");
              // R06: a transfer EXCEPTION still releases the child's
              // sessions — a failed transfer never leaves them running.
              try {
                const released = await getDefaultManagedBrowserModule().stopAllForAgentTask(
                  childAgentTaskId,
                  "cancelled"
                );
                if (released.failedSessionIds.length > 0) {
                  cleanupEvidence.push(
                    `keep_open_refused_partial:${released.failedSessionIds.join(",")}`
                  );
                }
              } catch {
                cleanupEvidence.push("keep_open_refused_cleanup_error");
              }
            }
          } else {
            // R06: a completed keep-open result with NO session id — the
            // child's sessions are still released (a missing id must not
            // leak retained browsers).
            try {
              const released = await getDefaultManagedBrowserModule().stopAllForAgentTask(
                childAgentTaskId,
                "cancelled"
              );
              cleanupEvidence.push(
                released.failedSessionIds.length === 0
                  ? "keep_open_missing_id_sessions_released"
                  : `keep_open_missing_id_partial:${released.failedSessionIds.join(",")}`
              );
            } catch {
              cleanupEvidence.push("keep_open_missing_id_cleanup_error");
            }
          }
        }
        return {
          task_index: index,
          status: finalStatus,
          summary: boundedSummary,
          extracted: boundedExtracted,
          final_url: boundedFinalUrl,
          evidence: [
            ...boundedEvidence,
            // B01: cleanup facts ride the returned evidence — a skipped or
            // failed cleanup is never silently swallowed.
            ...cleanupEvidence,
          ],
          needs_user: boundedNeedsUser,
          user_interventions: mapInterventions(control.get(taskId)?.interventions ?? []),
          ...(task.keep_open
            ? { session_id: transferredSessionId }
            : {}),
          // R07: the child's externalized output receipts ride the row —
          // parent access was granted by the child terminal; the receipts
          // are deduplicated WITHIN the row here and ACROSS rows below.
          ...((() => {
            const raw = (result as { outputIds?: unknown }).outputIds;
            if (!Array.isArray(raw)) {
              return {};
            }
            const seen = new Set<string>();
            const receipts = raw.filter((item): item is string => {
              if (typeof item !== "string" || item.length === 0 || seen.has(item)) {
                return false;
              }
              seen.add(item);
              return true;
            });
            return receipts.length > 0 ? { output_ids: receipts } : {};
          })()),
        };
      } catch (error) {
        // F17: classify by the abort source that actually fired.
        const parentCancelled = signal.aborted;
        const returnNow = !parentCancelled && batchAbort.signal.aborted;
        const childStopped =
          !parentCancelled && !returnNow && childAbort.signal.aborted;
        // W02: a Return-now crash is interrupted (= partial results, the
        // same convention as the try block), not failed.
        control.setState(
          taskId,
          parentCancelled || childStopped
            ? "cancelled"
            : returnNow
              ? "interrupted"
              : "failed",
          error instanceof Error ? error.message : "task_error"
        );
        // B01/M-AC-01: a child that CRASHED releases only ITS OWN task's
        // sessions (agt-scoped, awaited) — the conversation-wide sweep
        // also matches the ROOT conversation and could close sibling and
        // parent sessions. The account lease must not stay held by a dead
        // child (queued siblings would wait on a ghost), but the cleanup
        // must not reach beyond this task.
        if (childAgentTaskId) {
          try {
            const { getDefaultManagedBrowserModule } = await import(
              "@/modules/ManagedBrowserModule"
            );
            await getDefaultManagedBrowserModule().stopAllForAgentTask(
              childAgentTaskId,
              "cancelled"
            );
          } catch {
            /* best effort */
          }
        }
        return {
          task_index: index,
          status:
            parentCancelled || childStopped
              ? "cancelled"
              : returnNow
                ? "partial"
                : "failed",
          summary: error instanceof Error ? error.message : "task error",
          extracted: [],
          final_url: null,
          evidence: [
            ...(returnNow ? ["return_now:error"] : []),
            ...(!childAgentTaskId ? ["cleanup_skipped:agent_task_id_unknown"] : []),
          ],
          needs_user: null,
          user_interventions: mapInterventions(control.get(taskId)?.interventions ?? []),
        };
      } finally {
        liveChildren.delete(taskId);
        signal.removeEventListener("abort", onParentAbort);
        batchAbort.signal.removeEventListener("abort", onParentAbort);
      }
    }
    );
  } finally {
    // R07/M-FR-09: clean the live batch registration and listeners.
    liveBatches.delete(batchId);
    signal.removeEventListener("abort", onOuterAbort);
    // R01/M-FR-04: the scoped routine grant dies with the batch.
    releaseBatchRoutineGrant(batchId);
    // R03/M-FR-10: the token budget dies with the batch.
    releaseBatchTokenBudget(batchId);
  }
  // F21: the card shows final per-task states.
  // W02: the event carries the CONTROL RECORD state — partial and
  // interrupted endings agree with the record instead of collapsing to
  // failed. Lanes skipped before registration have no record; their
  // result status (cancelled) is used directly.
  const eventTerminalStates: ReadonlySet<string> = new Set([
    "completed",
    "failed",
    "cancelled",
    "interrupted",
    "partial",
  ]);
  const { getDefaultManagedBrowserModule } = await import(
    "@/modules/ManagedBrowserModule"
  );
  // R07/T15b: receipts are deduplicated ACROSS sibling rows — two lanes
  // that externalized the same artifact (a shared tool output) surface it
  // to the parent exactly once. The deduped rows feed BOTH the final
  // events and the returned result.
  const surfacedReceipts = new Set<string>();
  // C05/M-FR-11: extracted-row dedupe is CROSS-ROW too — two lanes that
  // scraped the same table surface identical rows to the parent once
  // (the shared identity set spans the whole batch; per-row dedupe is
  // implied by the same mechanism).
  const surfacedRowIdentities = new Set<string>();
  const deduped: BrowserBatchTaskResult[] = results.map((result) => {
    const withUniqueExtracted =
      result.extracted.length > 0
        ? {
            ...result,
            extracted: dedupeExtractedRows(
              result.extracted,
              surfacedRowIdentities
            ),
          }
        : result;
    if (!withUniqueExtracted.output_ids || withUniqueExtracted.output_ids.length === 0) {
      return withUniqueExtracted;
    }
    const unique = withUniqueExtracted.output_ids.filter(
      (receipt) => !surfacedReceipts.has(receipt)
    );
    for (const receipt of unique) {
      surfacedReceipts.add(receipt);
    }
    if (unique.length === withUniqueExtracted.output_ids.length) {
      return withUniqueExtracted;
    }
    return { ...withUniqueExtracted, output_ids: unique };
  });
  for (const result of deduped) {
    const rowTaskId = `${batchId}:${result.task_index}`;
    const recordState = control.getState(rowTaskId);
    emitBatchEvent({
      batchId,
      conversationId,
      phase: "task",
      taskId: rowTaskId,
      state:
        recordState && eventTerminalStates.has(recordState)
          ? recordState
          : result.status,
      summary: result.summary,
      // R04/M-FR-08: the kept-open transferred id first, then the
      // authoritative owner mapping — the row keeps its live session.
      sessionId:
        result.session_id ??
        getDefaultManagedBrowserModule().findSessionIdForAgentTask(rowTaskId) ??
        undefined,
      // R07/T15b: the row's receipts are already cross-row deduplicated.
      ...(result.output_ids && result.output_ids.length > 0
        ? { output_ids: result.output_ids }
        : {}),
    });
  }
  if (parentWaitWatchdog !== null) {
    clearInterval(parentWaitWatchdog);
    parentWaitWatchdog = null;
    if (parentJobId) {
      try {
        getDefaultToolJobRegistry().setUserWait(parentJobId, false);
      } catch {
        // best-effort
      }
    }
  }
  emitBatchEvent({ batchId, conversationId, phase: "finished" });
  // M-FR-11: the returned rows already carry the per-row extracted dedupe
  // and the cross-row output-receipt dedupe (computed above, feeding both
  // the final events and this result).
  return { batchId, results: deduped };
}

/**
 * M-FR-11: order-preserving dedupe of extracted rows by canonical JSON
 * identity — object key order is normalized so `{a:1,b:2}` and
 * `{b:2,a:1}` dedupe to one row.
 */
function dedupeExtractedRows(
  rows: readonly unknown[],
  sharedSeen?: Set<string>
): BrowserBatchTaskResult["extracted"] {
  // C05/M-FR-11: the caller may share the identity set ACROSS sibling
  // rows — identical rows surface to the parent exactly once per batch.
  const seen = sharedSeen ?? new Set<string>();
  const out: unknown[] = [];
  for (const row of rows) {
    let identity: string;
    try {
      if (row !== null && typeof row === "object") {
        const sorted = sortObjectKeys(row as Record<string, unknown>);
        identity = JSON.stringify(sorted);
      } else {
        identity = JSON.stringify(row);
      }
    } catch {
      identity = String(row);
    }
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    out.push(row);
  }
  return out;
}

function sortObjectKeys(value: Record<string, unknown>): unknown {
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [key, v] of entries) {
    out[key] =
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? sortObjectKeys(v as Record<string, unknown>)
        : v;
  }
  return out;
}

function mapInterventions(
  interventions: ReadonlyArray<{
    reason: string;
    startedAtEpochMs: number;
    durationMs: number | null;
  }>
): BrowserBatchTaskResult["user_interventions"] {
  return interventions.map((intervention) => ({
    reason: intervention.reason,
    started_at: intervention.startedAtEpochMs,
    duration_ms: intervention.durationMs,
  }));
}

function buildTaskPrompt(
  task: BrowserBatchTaskInput,
  index: number,
  total: number
): string {
  return [
    `Browser task ${index + 1}/${total}: ${task.goal}`,
    task.start_url ? `Start URL: ${task.start_url}` : "",
    // T12: the caller's task inputs reach the child's OWN session start.
    task.account_id
      ? `Use saved account_id ${task.account_id} when starting your session.`
      : "",
    task.proxy_id
      ? `Use proxy_id ${task.proxy_id} when starting your session.`
      : "",
    task.keep_open
      ? "keep_open: true - do NOT stop your session at the end; return its session_id."
      : "",
    "Rules: use ONE browser session you start yourself; stop the session at the end unless keep_open was requested;",
    "never use another session id; observe before acting; do NOT perform consequential actions (submit/send/publish/delete/upload) — return them as a needs_user proposal instead;",
    "return the strict output schema: status, summary (<=1000 chars), extracted, final_url, evidence, needs_user, user_interventions, session_id (only when keep_open).",
  ]
    .filter(Boolean)
    .join("\n");
}
