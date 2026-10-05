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

/**
 * Leading politeness/preamble prefixes that must not defeat verb detection.
 * "Please check the deployment status now" is a fresh-information task, not
 * response_only — the previous startsWith-only matcher misrouted it because
 * it began with "please " instead of "check " (FR-17, AC-19).
 */
const POLITE_PREFIXES = [
  "please ",
  "could you ",
  "can you ",
  "would you ",
  "kindly ",
  "i need you to ",
  "i want you to ",
] as const;

/**
 * Imperative verbs that indicate a material action on a target — save,
 * collect, find, search, gather, add, import — beyond the original
 * send/post/publish/deploy set. "Save 100 qualifying contacts" must enroll
 * as a task even without an approved template (FR-17). FR-18 forbids
 * keyword-only matching, so these are matched as whole imperative leads
 * (word boundary), not as substrings anywhere in the message.
 */
const ACTION_VERBS = [
  "send",
  "post",
  "publish",
  "deploy",
  "save",
  "collect",
  "find",
  "search",
  "gather",
  "add",
  "import",
  "export",
  "extract",
  "scrape",
  "fetch",
] as const;

const RETRIEVAL_VERBS = [
  "check",
  "monitor",
  "verify",
  "get the latest",
  "get the status",
  "check the latest",
  "check the current",
] as const;

const DELIVERABLE_VERBS = [
  "write",
  "draft",
  "compose",
  "generate",
  "create a",
  "summarize",
] as const;

const DEFINITION_STARTERS = [
  "what is",
  "what's",
  "what does it mean",
  "how does",
  "why is",
  "explain",
] as const;

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

    // A definition question is response_only even if it contains an action
    // verb ("what is send?"). Checked before action-verb detection so a
    // definition stem wins over a verb match.
    if (this.looksLikeDefinitionQuestion(message)) {
      return "response_only";
    }

    if (this.looksLikeFreshInformationTask(message)) {
      return "task_best_effort";
    }

    if (this.looksLikeDeliverableRequest(message)) {
      return "task_best_effort";
    }

    const actionMatch = this.detectActionVerb(message);
    if (actionMatch) {
      // Ambiguous material target → preparation (needs clarification),
      // never an invented verified target (AC-21). Clear target → best_effort.
      if (this.looksLikeAmbiguousAction(message, actionMatch)) {
        return "preparation";
      }
      return "task_best_effort";
    }

    // Default conservative: an ordinary conversational response.
    return "response_only";
  }

  /**
   * Strip leading politeness/preamble so verb detection sees the imperative.
   * "Please check the deployment status" → "check the deployment status".
   */
  private stripPolitePrefix(lower: string): string {
    let stripped = lower.trimStart();
    // Strip one prefix; a second polite word is rare and would itself be
    // ambiguous. Loop guards against "please kindly check ...".
    for (let i = 0; i < 2; i++) {
      const prefix = POLITE_PREFIXES.find((p) => stripped.startsWith(p));
      if (!prefix) break;
      stripped = stripped.slice(prefix.length).trimStart();
    }
    return stripped;
  }

  /**
   * Detect an imperative action verb at the start of the message (after
   * polite-prefix stripping). Returns the matched verb or null. Whole-word
   * match at the imperative position — NOT a substring scan — so "send" in
   * the middle of a definition question does not trigger (FR-18).
   */
  private detectActionVerb(message: string): string | null {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    for (const verb of ACTION_VERBS) {
      // Match the verb followed by a word boundary (space, punctuation, or
      // end-of-string) so "save" doesn't match "saving" or "saved".
      if (lower === verb || lower.startsWith(verb + " ") || lower.startsWith(verb + ",") || lower.startsWith(verb + ".")) {
        return verb;
      }
    }
    return null;
  }

  /**
   * "What is a deployment?" — a definition/explanation request that a
   * sufficient answer ends naturally. No retrieval/report required.
   */
  private looksLikeDefinitionQuestion(message: string): boolean {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    // The message must be a question (contains "?") AND start with a
    // definition stem. A "check the latest status" request does not match.
    return (
      message.includes("?") &&
      DEFINITION_STARTERS.some((s) => lower.startsWith(s + " ") || lower === s)
    );
  }

  /**
   * "Check the latest deployment status" — retrieval/report is the task
   * even though it resembles a question (FR-18, AC-19). Detected by
   * imperative action verbs targeting a current/external state.
   */
  private looksLikeFreshInformationTask(message: string): boolean {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    return RETRIEVAL_VERBS.some(
      (s) => lower.startsWith(s + " ") || lower === s
    );
  }

  /**
   * "Write a blog post and a tweet" — a text/artifact deliverable. Actual
   * valid text can pass without tools (AC-20); every requested part must
   * pass.
   */
  private looksLikeDeliverableRequest(message: string): boolean {
    const lower = this.stripPolitePrefix(message.toLowerCase());
    return DELIVERABLE_VERBS.some(
      (s) => lower.startsWith(s + " ") || lower === s
    );
  }

  /**
   * "Send the thing." — material target/action present but ambiguous.
   * Returns preparation (needs clarification), never an invented target.
   *
   * An action verb with no clear recipient/target/quantity is ambiguous.
   * We look for a target signal: a recipient phrase ("to <X>"), a quantity
   * ("<N> <things>"), or enough words to imply a described target. Without
   * one, the request needs clarification (AC-21).
   */
  private looksLikeAmbiguousAction(message: string, _verb: string): boolean {
    const lower = message.toLowerCase();
    // A recipient phrase "to <someone>" or "into <place>" indicates a target.
    if (/\b(?:to|into|onto|at|for)\s+\S/.test(lower)) {
      return false;
    }
    // A quantity ("<N> <things>") indicates a concrete target.
    if (/\b\d+\s+\S/.test(lower)) {
      return false;
    }
    // Enough words to describe a target (heuristic threshold). Short
    // imperatives like "send it" or "post this" are ambiguous.
    return message.split(/\s+/).length <= 4;
  }
}
