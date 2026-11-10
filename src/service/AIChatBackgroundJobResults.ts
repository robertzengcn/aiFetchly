/**
 * B07: truthful deadline/cancel ToolExecutionResult builders (HOST-06/07,
 * design §9). The background-job poll loop used to claim "the underlying
 * work has been stopped" even when cleanup was never confirmed, and a user
 * Stop returned before cleanup was awaited. These builders encode the
 * ACTUAL cleanup confirmation into the payload so the model and renderer
 * can see `cleaned_up` / `cleanup_pending` instead of asserted shutdown.
 */
import type { ToolExecutionResult } from "@/api/aiChatApi";

interface BuilderCall {
  readonly id: string;
  readonly name: string;
}

/** Deadline exceeded: text, code and cleanup truth derived from `cleanedUp`. */
export function buildDeadlineExceededResult(
  call: BuilderCall,
  jobId: string,
  cleanedUp: boolean,
  startedAt: number
): ToolExecutionResult {
  const error = cleanedUp
    ? "Background job exceeded its deadline and was cancelled. The underlying work has been stopped; a retry starts a new job."
    : "Background job exceeded its deadline and was cancelled, but shutdown of the underlying work could not be confirmed within the cleanup window.";
  return {
    tool_call_id: call.id,
    tool_name: call.name,
    success: false,
    result: {
      error,
      code: "JOB_DEADLINE_EXCEEDED",
      job_id: jobId,
      cleaned_up: cleanedUp,
      cleanup_pending: !cleanedUp,
    },
    execution_time_ms: Date.now() - startedAt,
  };
}

/** User Stop: cancellation is always reported, with cleanup truth attached. */
export function buildTurnCancelledResult(
  call: BuilderCall,
  jobId: string,
  cleanedUp: boolean,
  startedAt: number
): ToolExecutionResult {
  return {
    tool_call_id: call.id,
    tool_name: call.name,
    success: false,
    result: {
      error: "Turn cancelled",
      code: "TURN_CANCELLED",
      job_id: jobId,
      cleaned_up: cleanedUp,
      cleanup_pending: !cleanedUp,
    },
    execution_time_ms: Date.now() - startedAt,
  };
}
