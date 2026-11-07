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
  deps: RunBrowserTasksDeps = {}
): Promise<{ batchId: string; results: BrowserBatchTaskResult[] }> {
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
    throw new Error("managed_browser_disabled:parallel_agents_disabled");
  }
  return runBrowserTasks(tasks, concurrency, conversationId, signal, deps);
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
}

/** T13: live batch abort trees — renderer Stop/Return-now abort children. */
const liveBatches = new Map<string, AbortController>();
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
    | "paused"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  readonly summary?: string;
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

export async function runBrowserTasks(
  tasks: readonly BrowserBatchTaskInput[],
  concurrency: number,
  conversationId: string,
  signal: AbortSignal,
  deps: RunBrowserTasksDeps = {}
): Promise<{ batchId: string; results: BrowserBatchTaskResult[] }> {
  const batchId = `batch_${randomUUID().slice(0, 12)}`;
  const batchAbort = new AbortController();
  const onOuterAbort = (): void => batchAbort.abort();
  signal.addEventListener("abort", onOuterAbort, { once: true });
  liveBatches.set(batchId, batchAbort);
  const control = deps.control ?? getDefaultAgentTaskControlService();
  // F21: the batch card lives from the first lane start.
  emitBatchEvent({ batchId, conversationId, phase: "started" });

  let results: BrowserBatchTaskResult[];
  try {
    results = await runWithConcurrency(
      tasks,
      concurrency,
      async (task, index): Promise<BrowserBatchTaskResult> => {
      const taskId = `${batchId}:${index}`;
      // R07/M-FR-09: refuse already-aborted lanes before starting.
      if (signal.aborted || batchAbort.signal.aborted) {
        return {
          task_index: index,
          status: "cancelled",
          summary: "skipped (batch already aborted)",
          extracted: [],
          final_url: null,
          evidence: [],
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
      try {
        const prompt = buildTaskPrompt(task, index, tasks.length);
        const runtime = (deps.runAgent ?? AgentRuntimeRegistry.getRuntime)();
        const result = await runtime.runSync(
          {
            agentId: "agent-browser-operator",
            prompt,
            taskPacket: {
              userGoal: prompt,
              requiredOutputSchema: BROWSER_OPERATOR_OUTPUT_SCHEMA,
              constraints: { allowInteractivePermissionPrompts: false },
            },
            parentConversationId: conversationId,
          } as unknown as Parameters<typeof runtime.runSync>[0],
          {
            ...getDefaultAgentRuntimeDeps(),
            signal: childAbort.signal,
            // F06: a blocking handoff/credential wait freezes this
            // child's active-time deadline (D-21).
            isUserWaiting: () =>
              getDefaultToolJobRegistry().isAnyWaitingForUser(),
          }
        );
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
        // T13: a parent-signal abort ALWAYS outranks the result. For a
        // return-now or a single-child stop, output that already landed
        // is honored (the work finished before the abort landed).
        if (
          parentCancelled ||
          ((returnNow || childStopped) && !hasUsableOutput)
        ) {
          control.setState(
            taskId,
            returnNow ? "failed" : "cancelled",
            returnNow ? "return_now_partial" : "user_stop"
          );
          return {
            task_index: index,
            status: returnNow ? "partial" : "cancelled",
            summary: returnNow
              ? "returned early (user requested results)"
              : "cancelled by user stop",
            extracted: [],
            final_url: null,
            evidence: returnNow ? ["return_now:unfinished"] : [],
            needs_user: null,
            user_interventions: mapInterventions(
              control.get(taskId)?.interventions ?? []
            ),
          };
        }
        // T12: the AGENT completing is not the BROWSER task succeeding —
        // honor the child's own output.status (failed / needs_user).
        const childOutputStatus = (
          result.output as { status?: string } | null
        )?.status;
        const finalStatus: BrowserBatchTaskResult["status"] =
          result.status !== "completed"
            ? "failed"
            : childOutputStatus === "failed"
              ? "failed"
              : childOutputStatus === "needs_user"
                ? "partial"
                : "completed";
        // F17: cancellation is a CONTROL state, not a failure.
        control.setState(
          taskId,
          finalStatus === "completed" ? "completed" : "failed"
        );
        const outputSessionId = (
          result.output as { session_id?: string } | null
        )?.session_id;
        if (!task.keep_open && typeof outputSessionId === "string" && outputSessionId) {
          // F17: the collector — not the agent prompt — owns cleanup of
          // sessions the child opened (bounded: outputs that carry the
          // session id; crash/cancel without an id is F16's map).
          void import("@/modules/ManagedBrowserModule")
            .then(({ getDefaultManagedBrowserModule }) =>
              getDefaultManagedBrowserModule().stop(outputSessionId, "cancelled")
            )
            .catch(() => undefined);
        }
        return {
          task_index: index,
          status: finalStatus,
          summary: (result.output as { summary?: string } | null)?.summary ?? String(result.errorMessage ?? result.status),
          extracted: (result.output as { extracted?: unknown[] } | null)?.extracted ?? [],
          final_url: (result.output as { final_url?: string } | null)?.final_url ?? null,
          evidence: (result.output as { evidence?: string[] } | null)?.evidence ?? [],
          needs_user: (result.output as { needs_user?: { type: string } } | null)?.needs_user ?? null,
          user_interventions: mapInterventions(control.get(taskId)?.interventions ?? []),
          ...(task.keep_open
            ? { session_id: (result.output as { session_id?: string } | null)?.session_id }
            : {}),
        };
      } catch (error) {
        // F17: classify by the abort source that actually fired.
        const parentCancelled = signal.aborted;
        const returnNow = !parentCancelled && batchAbort.signal.aborted;
        const childStopped =
          !parentCancelled && !returnNow && childAbort.signal.aborted;
        control.setState(
          taskId,
          parentCancelled || childStopped ? "cancelled" : "failed",
          error instanceof Error ? error.message : "task_error"
        );
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
          evidence: returnNow ? ["return_now:error"] : [],
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
  }
  // F21: the card shows final per-task states.
  for (const result of results) {
    emitBatchEvent({
      batchId,
      conversationId,
      phase: "task",
      taskId: `${batchId}:${result.task_index}`,
      state: result.status === "completed"
        ? "completed"
        : result.status === "failed"
          ? "failed"
          : result.status === "cancelled"
            ? "cancelled"
            : "interrupted",
      summary: result.summary,
    });
  }
  emitBatchEvent({ batchId, conversationId, phase: "finished" });
  return { batchId, results };
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
