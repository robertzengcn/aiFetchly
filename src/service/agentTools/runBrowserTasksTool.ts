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

export interface BrowserBatchTaskInput {
  readonly goal: string;
  readonly start_url?: string;
  readonly account_id?: number;
  readonly proxy_id?: number;
  readonly keep_open?: boolean;
}

export interface BrowserBatchTaskResult {
  readonly task_index: number;
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

/** Entry used by the skillsRegistry wrapper. */
export async function runBrowserTasksForTool(
  tasks: readonly BrowserBatchTaskInput[],
  concurrency: number,
  conversationId: string,
  signal: AbortSignal
): Promise<{ batchId: string; results: BrowserBatchTaskResult[] }> {
  return runBrowserTasks(tasks, concurrency, conversationId, signal);
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

export async function runBrowserTasks(
  tasks: readonly BrowserBatchTaskInput[],
  concurrency: number,
  conversationId: string,
  signal: AbortSignal,
  deps: RunBrowserTasksDeps = {}
): Promise<{ batchId: string; results: BrowserBatchTaskResult[] }> {
  const batchId = `batch_${randomUUID().slice(0, 12)}`;
  const control = deps.control ?? getDefaultAgentTaskControlService();

  const results = await runWithConcurrency(
    tasks,
    concurrency,
    async (task, index): Promise<BrowserBatchTaskResult> => {
      const taskId = `${batchId}:${index}`;
      control.register(taskId, conversationId);
      const childAbort = new AbortController();
      const onParentAbort = (): void => childAbort.abort();
      signal.addEventListener("abort", onParentAbort, { once: true });
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
          },
          { ...getDefaultAgentRuntimeDeps(), signal: childAbort.signal }
        );
        // A late abort (user Stop) outranks a successful agent result.
        const aborted = childAbort.signal.aborted || signal.aborted;
        const finalStatus = aborted
          ? "cancelled"
          : result.status === "completed"
            ? "completed"
            : "failed";
        control.setState(taskId, finalStatus);
        return {
          task_index: index,
          status: finalStatus as BrowserBatchTaskResult["status"],
          summary: (result.output as { summary?: string } | null)?.summary ?? String(result.errorMessage ?? result.status),
          extracted: (result.output as { extracted?: unknown[] } | null)?.extracted ?? [],
          final_url: (result.output as { final_url?: string } | null)?.final_url ?? null,
          evidence: (result.output as { evidence?: string[] } | null)?.evidence ?? [],
          needs_user: (result.output as { needs_user?: { type: string } } | null)?.needs_user ?? null,
          user_interventions: control.get(taskId)?.interventions ?? [],
          ...(task.keep_open
            ? { session_id: (result.output as { session_id?: string } | null)?.session_id }
            : {}),
        };
      } catch (error) {
        control.setState(
          taskId,
          signal.aborted ? "cancelled" : "failed",
          error instanceof Error ? error.message : "task_error"
        );
        return {
          task_index: index,
          status: signal.aborted ? "cancelled" : "failed",
          summary: error instanceof Error ? error.message : "task error",
          extracted: [],
          final_url: null,
          evidence: [],
          needs_user: null,
          user_interventions: control.get(taskId)?.interventions ?? [],
        };
      } finally {
        signal.removeEventListener("abort", onParentAbort);
      }
    }
  );

  return { batchId, results };
}

function buildTaskPrompt(
  task: BrowserBatchTaskInput,
  index: number,
  total: number
): string {
  return [
    `Browser task ${index + 1}/${total}: ${task.goal}`,
    task.start_url ? `Start URL: ${task.start_url}` : "",
    "Rules: use ONE browser session you start yourself; stop the session at the end unless keep_open was requested;",
    "never use another session id; observe before acting; do NOT perform consequential actions (submit/send/publish/delete/upload) — return them as a needs_user proposal instead;",
    "return the strict output schema: status, summary (<=1000 chars), extracted, final_url, evidence, needs_user, user_interventions, session_id (only when keep_open).",
  ]
    .filter(Boolean)
    .join("\n");
}
