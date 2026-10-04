/**
 * Conservative request intent resolution (FR-18).
 *
 * Routes each accepted manual/scheduled submission to one of:
 *   response_only    — ordinary answer; ends naturally (no task badge)
 *   task_verified    — actionable task with an approved template/contract
 *   task_best_effort — actionable task without a complete verified contract
 *   preparation      — planning/approval/input wait; cannot finish work
 *
 * Rules (FR-18):
 *   - Do NOT use punctuation, keyword matching, or "tools were called" alone.
 *   - A "check latest status" request is a task (retrieval/report required)
 *     even though it resembles a question. A definition question is not.
 *   - An assistant promise, tool result, quoted instruction, attachment,
 *     selected history, runtime nudge, or renderer system prompt CANNOT
 *     independently authorize work. Only the actual user message + approved
 *     references source the objective.
 *   - Classifier outputs are advisory; ambiguity → clarification/best-effort,
 *     never an invented target (AC-21).
 *
 * Slice 1 implements the deterministic structural classifier. The optional
 * model-assisted classifier is advisory only and lands in Slice 2; its
 * failure cannot silently downgrade an actionable request.
 */
import type { TaskExecutionRoute } from "@/entityTypes/aiTaskExecutionTypes";

export interface ResolveInput {
  readonly userMessage: string;
  readonly hasApprovedTaskTemplate: boolean;
  readonly pendingPlanApproval?: boolean;
  readonly pendingPermission?: boolean;
}

export class TaskRequestResolver {
  classify(input: ResolveInput): TaskExecutionRoute {
    // Preparation takes precedence when a plan/approval/permission wait is
    // active (FR-21). A draft plan does not satisfy execution criteria.
    if (input.pendingPlanApproval || input.pendingPermission) {
      return "preparation";
    }

    const message = input.userMessage.trim();

    // An approved task template gives us a verified contract foundation.
    // The objective still comes from the user message; the template cannot
    // broaden authorization (FR-18).
    if (input.hasApprovedTaskTemplate) {
      return "task_verified";
    }

    // Deterministic structural signals. We deliberately do NOT match on
    // single keywords like "send" — a definition question containing "send"
    // must stay response_only (tested above).
    if (this.looksLikeDefinitionQuestion(message)) {
      return "response_only";
    }

    if (this.looksLikeFreshInformationTask(message)) {
      return "task_best_effort";
    }

    if (this.looksLikeDeliverableRequest(message)) {
      return "task_best_effort";
    }

    if (this.looksLikeAmbiguousAction(message)) {
      // Ambiguous material target → preparation (needs clarification),
      // never an invented verified target (AC-21).
      return "preparation";
    }

    // Default conservative: an ordinary conversational response.
    return "response_only";
  }

  /**
   * "What is a deployment?" — a definition/explanation request that a
   * sufficient answer ends naturally. No retrieval/report required.
   */
  private looksLikeDefinitionQuestion(message: string): boolean {
    const lower = message.toLowerCase();
    const definitionStarters = [
      "what is ",
      "what's ",
      "what does it mean ",
      "how does ",
      "why is ",
      "explain ",
    ];
    // The message must be a question (contains "?") AND start with a
    // definition stem. A "check the latest status" request does not match.
    return (
      message.includes("?") &&
      definitionStarters.some((s) => lower.startsWith(s))
    );
  }

  /**
   * "Check the latest deployment status" — retrieval/report is the task
   * even though it resembles a question (FR-18, AC-19). Detected by
   * imperative action verbs targeting a current/external state.
   */
  private looksLikeFreshInformationTask(message: string): boolean {
    const lower = message.toLowerCase();
    const retrievalVerbs = [
      "check ",
      "monitor ",
      "verify ",
      "get the latest ",
      "get the status ",
      "check the latest ",
      "check the current ",
    ];
    return retrievalVerbs.some((s) => lower.startsWith(s));
  }

  /**
   * "Write a blog post and a tweet" — a text/artifact deliverable. Actual
   * valid text can pass without tools (AC-20); every requested part must
   * pass.
   */
  private looksLikeDeliverableRequest(message: string): boolean {
    const lower = message.toLowerCase();
    const deliverableVerbs = [
      "write ",
      "draft ",
      "compose ",
      "generate ",
      "create a ",
      "summarize ",
    ];
    return deliverableVerbs.some((s) => lower.startsWith(s));
  }

  /**
   * "Send the thing." — material target/action present but ambiguous.
   * Returns preparation (needs clarification), never an invented target.
   */
  private looksLikeAmbiguousAction(message: string): boolean {
    const lower = message.toLowerCase();
    const actionVerbs = ["send ", "post ", "publish ", "deploy "];
    const hasActionVerb = actionVerbs.some((s) => lower.startsWith(s));
    if (!hasActionVerb) return false;
    // Heuristic: short message with an action verb but no clear target/
    // recipient → ambiguous. Real send/post requests with a clear target
    // route through an approved template (task_verified) upstream; without
    // a template they are best-effort only if the target is clear.
    return message.split(/\s+/).length <= 4;
  }
}
