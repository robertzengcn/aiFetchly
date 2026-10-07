import { windowInvoke } from "@/views/utils/apirequest";
import {
  AI_CHAT_V2_TASK_CONTINUE,
  AI_CHAT_V2_TASK_RETRY,
} from "@/config/channellist";

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
