/**
 * Pure TypeScript types for AI Chat V2 goal & loop (`/goal`, `/loop`).
 *
 * Shared between main-process services, the renderer, and tests. Must not
 * import Electron, Vue, TypeORM, or services.
 *
 * Source: docs/prd/ai-chat-goal-loop-technical-design.md §4.1.
 */

/** Lifecycle of a conversation goal. Terminal states: complete/blocked/failed/cancelled. */
export type AIChatGoalStatus =
  | "draft"
  | "active"
  | "running"
  | "complete"
  | "blocked"
  | "cancelled"
  | "needs_user_input"
  | "failed";

/** How a single acceptance criterion is verified. */
export type GoalVerificationKind = "command" | "file" | "manual" | "llm";

/** Verification configuration for one criterion. */
export interface GoalCriterionVerification {
  readonly kind: GoalVerificationKind;
  readonly command?: string;
  readonly expectedExitCode?: number;
  readonly expectedOutputPattern?: string;
  readonly filePath?: string;
  readonly expectedFileState?: "exists" | "changed";
}

/** One acceptance criterion in a goal contract. */
export interface AIChatGoalCriterion {
  readonly criterionId: string;
  readonly description: string;
  readonly required: boolean;
  readonly verification: GoalCriterionVerification;
}

/** Bounded limits copied into each loop run. */
export interface AIChatGoalLoopLimits {
  readonly maxIterations: number;
  readonly maxRuntimeMs: number;
  readonly repeatedFailureThreshold: number;
}

/** Per-criterion verifier outcome. */
export interface GoalCriterionResult {
  readonly criterionId: string;
  readonly passed: boolean;
  readonly evidenceRefs: readonly string[];
  readonly reason: string;
}

/** Overall verdict returned by GoalVerificationService. */
export interface GoalVerificationResult {
  readonly verdict: "satisfied" | "not_satisfied" | "blocked" | "needs_user_input";
  readonly criteria: readonly GoalCriterionResult[];
  readonly nextAction?: string;
}

/** Evidence source kind recorded for a criterion. */
export type GoalEvidenceSourceKind = "command" | "file" | "tool" | "log" | "manual";

/** Renderer-safe evidence summary (no raw logs/stdout). */
export interface GoalEvidenceSummary {
  readonly evidenceId: string;
  readonly criterionId?: string;
  readonly sourceKind: GoalEvidenceSourceKind;
  readonly state: "pass" | "fail" | "pending";
  readonly timestamp: string;
  readonly excerpt?: string;
}

/** Renderer-safe goal view (no raw criteria payloads beyond what the UI needs). */
export interface AIChatGoalView {
  readonly goalId: string;
  readonly conversationId: string;
  readonly objective: string;
  readonly criteria: readonly AIChatGoalCriterion[];
  readonly planId?: string;
  readonly status: AIChatGoalStatus;
  readonly iterationCount: number;
  readonly latestVerdict?: GoalVerificationResult["verdict"];
  readonly terminalReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Renderer-safe loop run view. */
export interface AIChatGoalRunView {
  readonly runId: string;
  readonly goalId: string;
  readonly conversationId: string;
  readonly status: AIChatGoalStatus;
  readonly iterationCount: number;
  readonly maxIterations: number;
  readonly cancelled: boolean;
  readonly terminalReason?: string;
  readonly startedAt: string;
  readonly endedAt?: string;
}

/** Payload for the goal_state stream event. */
export interface ChatV2GoalStateEvent {
  readonly goalId: string;
  readonly conversationId: string;
  readonly status: AIChatGoalStatus;
  readonly objective: string;
  readonly iterationCount?: number;
  readonly terminalReason?: string;
  readonly latestVerdict?: GoalVerificationResult["verdict"];
}

/** Payload for the goal_iteration stream event. */
export interface ChatV2GoalIterationEvent {
  readonly goalId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly iteration: number;
  readonly maxIterations: number;
}

/** Payload for the goal_evidence stream event (summary only). */
export interface ChatV2GoalEvidenceEvent {
  readonly goalId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly evidence: GoalEvidenceSummary;
}

/** Payload for the goal_verification stream event. */
export interface ChatV2GoalVerificationEvent {
  readonly goalId: string;
  readonly runId: string;
  readonly conversationId: string;
  readonly result: GoalVerificationResult;
}
