import { windowInvoke } from "@/views/utils/apirequest";
import {
  AI_CHAT_V2_TASK_CONTINUE,
  AI_CHAT_V2_TASK_RETRY,
  AI_CHAT_V2_TASK_STATE_GET,
} from "@/config/channellist";
import type {
  AiTaskExecutionStatus,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

/**
 * Renderer API for the task recovery actions (Continue / Retry) of the
 * completion policy (PRD FR-14: history/restart retain progress and remaining
 * work; recovery never broadens permission to repeat actions).
 *
 * `windowInvoke` returns the unwrapped `result.data` from the IPC handler.
 * Renderer-side: must not import TypeORM, models, or modules. The main-process
 * handler (ai-chat-v2-ipc.ts) derives everything trusted — route, contract
 * snapshot, lineage ledger, completion owner — from the parent execution row.
 */

export interface ContinueTaskRequest {
  /** Parent execution to continue (same lineage ledger, resurrected budget). */
  parentExecutionId: string;
  /** Fresh submissionId (renderer crypto.randomUUID) — one successor (AC-27). */
  submissionId: string;
  /** Optional follow-up message hashed main-side for the successor turn. */
  message?: string;
}

export interface RetryTaskRequest {
  /** Parent execution (lineage only — new ledger, fresh manual-default budget). */
  parentExecutionId: string;
  /** Fresh submissionId for the retried turn. */
  submissionId: string;
  /** Optional follow-up message hashed main-side for the retried turn. */
  message?: string;
}

export interface TaskSuccessorResponse {
  /** New successor execution id; null when the request was reused/deduped. */
  executionId: string | null;
  /** "created" or "reused". */
  status: string;
}

export async function continueTask(
  req: ContinueTaskRequest
): Promise<TaskSuccessorResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_TASK_CONTINUE, req);
  return (resp as TaskSuccessorResponse | null) ?? null;
}

export async function retryTask(
  req: RetryTaskRequest
): Promise<TaskSuccessorResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_TASK_RETRY, req);
  return (resp as TaskSuccessorResponse | null) ?? null;
}

/**
 * T13 (PRD FR-13/14, AC-16/24/25/27/32): read the latest task execution for a
 * conversation so history reload can restore the badge from the stored row.
 * Returns null for response-only answers that never enrolled — the renderer
 * shows no badge in that case. The main-process handler is AI-gated and reads
 * only the latest row's stage/outcome/reasonCode (never trusted input).
 */
export interface TaskExecutionStateView {
  readonly executionId: string;
  readonly conversationId: string;
  readonly status: AiTaskExecutionStatus;
  readonly reasonCode?: string;
  readonly outcome?: TaskOutcome;
  /** G02: durable delivery identity for reload-reconstruction dedup. */
  readonly finalEventIdentity?: string;
}

export async function getChatV2TaskExecutionState(
  conversationId: string
): Promise<TaskExecutionStateView | null> {
  const resp = await windowInvoke(AI_CHAT_V2_TASK_STATE_GET, { conversationId });
  return (resp as TaskExecutionStateView | null) ?? null;
}
