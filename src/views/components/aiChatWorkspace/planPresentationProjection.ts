import type {
  AIChatPlanQuestionView,
  AIChatPlanStatus,
  AIChatPlanVersionView,
} from "@/entityTypes/aiChatPlanTypes";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

/**
 * Pure plan-presentation projection (PRD §12.6–§12.8, FR-051..064;
 * design §15.12–§15.13). The durable `AIChatPlanStateView` and its version/
 * question records remain authoritative — this selector only chooses WHICH
 * lifecycle surface the conversation shows right now.
 */

export type PlanSurfaceKind =
  | "drafting"
  | "question"
  | "approval"
  | "changes_requested"
  | "approved_receipt"
  | "executing"
  | "completed_receipt"
  | "rejected_receipt"
  | "cancelled_receipt";

export interface PlanPresentationView {
  readonly planId: string;
  readonly version: number;
  readonly status: AIChatPlanStatus;
  readonly surface: PlanSurfaceKind;
  readonly title: string;
  readonly objective: string;
  /** Stored change reason from the version record, when present (§15.12). */
  readonly changeReason?: string;
  /** Authoritative scope values — omitted when unknown (never estimated). */
  readonly scopeSummary?: {
    readonly stepCount?: number;
  };
  readonly pendingQuestion?: AIChatPlanQuestionView;
  /** Durable decision timestamps for Activity receipts. */
  readonly approvedAt?: string;
  readonly rejectedAt?: string;
  /** The full latest version document — rendered only in Activity (FR-054). */
  readonly latestVersion?: AIChatPlanVersionView;
}

function surfaceFor(
  status: AIChatPlanStatus,
  hasPendingQuestion: boolean
): PlanSurfaceKind {
  if (hasPendingQuestion || status === "awaiting_question") {
    return "question";
  }
  switch (status) {
    case "draft":
      return "drafting";
    case "awaiting_approval":
      return "approval";
    case "approved":
      return "approved_receipt";
    case "rejected":
      return "rejected_receipt";
    case "cancelled":
      return "cancelled_receipt";
    case "completed":
      return "completed_receipt";
    case "executing":
      return "executing";
    default:
      return "drafting";
  }
}

function scopeFromVersion(
  version: AIChatPlanVersionView | undefined
): { stepCount?: number } | undefined {
  // Steps live in validated `planJson` when the author provided them; the
  // projection omits unknown values rather than estimating (design §15.12).
  const steps = version?.planJson?.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    return { stepCount: steps.length };
  }
  return undefined;
}

/**
 * Select the presentation for the newest actionable plan in message history.
 * Resolved plans surface as receipts; drafting/executing defer to the run
 * strip; only the latest unresolved decision becomes a pinned surface
 * (design §15.13 precedence).
 */
export function selectPlanPresentation(
  messages: readonly ChatV2MessageView[]
): PlanPresentationView | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const state = messages[i].metadata?.planStateView;
    if (!state?.planId) continue;
    const pendingQuestion =
      state.pendingQuestion?.status === "pending"
        ? state.pendingQuestion
        : undefined;
    const version = state.latestVersion;
    return {
      planId: state.planId,
      version: state.currentVersion,
      status: state.status,
      surface: surfaceFor(state.status, Boolean(pendingQuestion)),
      title: state.title,
      objective: state.objective,
      changeReason:
        typeof version?.changeReason === "string"
          ? version.changeReason
          : undefined,
      scopeSummary: scopeFromVersion(version),
      pendingQuestion,
      approvedAt: state.approvedAt,
      rejectedAt: state.rejectedAt,
      latestVersion: version,
    };
  }
  return null;
}

/** Receipts collapse resolved transitions (PRD §12.6.5, FR-052). */
export function isReceiptSurface(surface: PlanSurfaceKind): boolean {
  return (
    surface === "approved_receipt" ||
    surface === "completed_receipt" ||
    surface === "rejected_receipt" ||
    surface === "cancelled_receipt" ||
    surface === "changes_requested"
  );
}

/** Only question + approval surfaces pin above the composer (FR-058). */
export function isPinnedSurface(surface: PlanSurfaceKind): boolean {
  return surface === "question" || surface === "approval";
}

export interface PlanQuestionDraft {
  readonly questionId: string;
  currentIndex: number;
  selectedByIndex: Record<number, readonly number[]>;
  customTextByIndex: Record<number, string>;
  reviewVisible: boolean;
}

/** Create a focused one-question-at-a-time draft (design §15.14). */
export function createPlanQuestionDraft(
  question: AIChatPlanQuestionView
): PlanQuestionDraft {
  return {
    questionId: question.questionId,
    currentIndex: 0,
    selectedByIndex: {},
    customTextByIndex: {},
    reviewVisible: false,
  };
}

/** Back navigation before final submission (PRD §12.8.4). */
export function draftMove(
  draft: PlanQuestionDraft,
  delta: number,
  total: number
): PlanQuestionDraft {
  const next = Math.min(Math.max(0, draft.currentIndex + delta), total - 1);
  return { ...draft, currentIndex: next };
}

export function draftToggleOption(
  draft: PlanQuestionDraft,
  optionIndex: number
): PlanQuestionDraft {
  const current = draft.selectedByIndex[draft.currentIndex] ?? [];
  const selected = current.includes(optionIndex)
    ? current.filter((i) => i !== optionIndex)
    : [...current, optionIndex];
  return {
    ...draft,
    selectedByIndex: {
      ...draft.selectedByIndex,
      [draft.currentIndex]: selected,
    },
  };
}
