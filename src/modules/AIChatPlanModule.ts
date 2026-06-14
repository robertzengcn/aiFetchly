import { BaseModule } from "@/modules/baseModule";
import { AIChatPlanModel } from "@/model/AIChatPlan.model";
import { AIChatPlanVersionModel } from "@/model/AIChatPlanVersion.model";
import { AIChatPlanQuestionModel } from "@/model/AIChatPlanQuestion.model";
import { AIChatPlanApprovalModel } from "@/model/AIChatPlanApproval.model";
import type {
  AIChatPlanStateView,
  AIChatPlanVersionView,
  AIChatPlanQuestionView,
  AIChatPlanStatus,
  AskUserQuestionItem,
  AskUserQuestionAnswer,
  AskUserQuestionPayload,
  SubmitPlanForApprovalPayload,
  AIChatPlanVersionAuthor,
} from "@/entityTypes/aiChatPlanTypes";

const V2_PREFIX = "v2-";

function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson<T>(raw?: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export class AIChatPlanModule extends BaseModule {
  private planModel: AIChatPlanModel;
  private versionModel: AIChatPlanVersionModel;
  private questionModel: AIChatPlanQuestionModel;
  private approvalModel: AIChatPlanApprovalModel;

  constructor() {
    super();
    this.planModel = new AIChatPlanModel(this.dbpath);
    this.versionModel = new AIChatPlanVersionModel(this.dbpath);
    this.questionModel = new AIChatPlanQuestionModel(this.dbpath);
    this.approvalModel = new AIChatPlanApprovalModel(this.dbpath);
  }

  // ---------- Views ----------

  private toVersionView(v: {
    planId: string;
    version: number;
    planMarkdown: string;
    planJson?: string | null;
    changeReason?: string | null;
    createdAt: Date;
    createdBy: string;
  }): AIChatPlanVersionView {
    return {
      planId: v.planId,
      version: v.version,
      planMarkdown: v.planMarkdown,
      planJson: parseJson<Record<string, unknown>>(v.planJson ?? undefined),
      changeReason: v.changeReason ?? undefined,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy as AIChatPlanVersionAuthor,
    };
  }

  private toQuestionView(q: {
    questionId: string;
    planId: string;
    conversationId: string;
    status: string;
    questionsJson: string;
    answersJson?: string | null;
    createdAt: Date;
    answeredAt?: Date | null;
  }): AIChatPlanQuestionView {
    return {
      questionId: q.questionId,
      planId: q.planId,
      conversationId: q.conversationId,
      status: q.status as AIChatPlanQuestionView["status"],
      questions: parseJson<AskUserQuestionItem[]>(q.questionsJson) ?? [],
      answers: parseJson<AskUserQuestionAnswer[]>(
        q.answersJson ?? undefined
      ),
      createdAt: q.createdAt.toISOString(),
      answeredAt: q.answeredAt ? q.answeredAt.toISOString() : undefined,
    };
  }

  private async buildStateView(
    planId: string
  ): Promise<AIChatPlanStateView | null> {
    const plan = await this.planModel.getByPlanId(planId);
    if (!plan) return null;
    const latest = await this.versionModel.getLatest(planId);
    const pending = await this.questionModel.getPendingByPlan(planId);
    return {
      planId: plan.planId,
      conversationId: plan.conversationId,
      status: plan.status as AIChatPlanStatus,
      title: plan.title,
      objective: plan.objective,
      currentVersion: plan.currentVersion,
      latestVersion: latest ? this.toVersionView(latest) : undefined,
      pendingQuestion: pending ? this.toQuestionView(pending) : undefined,
      approvedAt: plan.approvedAt
        ? plan.approvedAt.toISOString()
        : undefined,
      rejectedAt: plan.rejectedAt
        ? plan.rejectedAt.toISOString()
        : undefined,
    };
  }

  // ---------- Public API ----------

  async ensurePlanForConversation(input: {
    conversationId: string;
    title?: string;
    objective?: string;
  }): Promise<AIChatPlanStateView> {
    if (!input.conversationId.startsWith(V2_PREFIX)) {
      throw new Error("Plan mode requires a v2- conversation id");
    }
    const existing = await this.planModel.getActiveByConversation(
      input.conversationId
    );
    if (existing) {
      const view = await this.buildStateView(existing.planId);
      if (view) return view;
    }
    const planId = `plan-${uuid()}`;
    const plan = await this.planModel.createPlan({
      planId,
      conversationId: input.conversationId,
      title: input.title?.slice(0, 200) || "New plan",
      objective: input.objective?.slice(0, 2000) || "",
      status: "draft",
    });
    const view = await this.buildStateView(plan.planId);
    return view!;
  }

  async getPlanState(
    conversationId: string
  ): Promise<AIChatPlanStateView | null> {
    const plan = await this.planModel.getActiveByConversation(conversationId);
    if (!plan) return null;
    return this.buildStateView(plan.planId);
  }

  async getPlanStateByPlanId(
    planId: string
  ): Promise<AIChatPlanStateView | null> {
    return this.buildStateView(planId);
  }

  private validateQuestionPayload(
    payload: AskUserQuestionPayload
  ): string | null {
    if (!Array.isArray(payload.questions))
      return "questions must be an array";
    if (payload.questions.length === 0)
      return "questions must not be empty";
    if (payload.questions.length > 3)
      return "questions must contain at most 3 items";
    for (const q of payload.questions) {
      if (!q.header || typeof q.header !== "string")
        return "each question needs a header";
      if (!q.question || typeof q.question !== "string")
        return "each question needs question text";
      if (
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        q.options.length > 4
      ) {
        return "each question needs 2-4 options";
      }
      for (const opt of q.options) {
        if (!opt.label || typeof opt.label !== "string")
          return "each option needs a label";
        if (typeof opt.description !== "string")
          return "each option needs a description";
      }
    }
    return null;
  }

  async saveQuestion(input: {
    conversationId: string;
    planId?: string;
    payload: AskUserQuestionPayload;
  }): Promise<AIChatPlanQuestionView> {
    const validationError = this.validateQuestionPayload(input.payload);
    if (validationError) throw new Error(validationError);

    const plan =
      (input.planId
        ? await this.planModel.getByPlanId(input.planId)
        : null) ??
      (await this.planModel.getActiveByConversation(input.conversationId));
    if (!plan) throw new Error("No active plan for conversation");

    // Only one pending question per plan at a time.
    await this.questionModel.cancelPendingForPlan(plan.planId);

    const questionId = `question-${uuid()}`;
    const entity = await this.questionModel.createQuestion({
      questionId,
      planId: plan.planId,
      conversationId: input.conversationId,
      questions: input.payload.questions,
    });
    await this.planModel.updateStatus({
      planId: plan.planId,
      status: "awaiting_question",
    });
    return this.toQuestionView(entity);
  }

  async answerQuestion(input: {
    conversationId: string;
    questionId: string;
    answers: AskUserQuestionAnswer[];
  }): Promise<{
    question: AIChatPlanQuestionView;
    planState: AIChatPlanStateView;
  }> {
    const entity = await this.questionModel.getByQuestionId(input.questionId);
    if (!entity) throw new Error("Question not found");
    if (entity.status !== "pending")
      throw new Error("This question is no longer active");
    if (entity.conversationId !== input.conversationId) {
      throw new Error("Question does not belong to this conversation");
    }

    await this.questionModel.answerQuestion({
      questionId: input.questionId,
      answers: input.answers,
    });
    await this.planModel.updateStatus({
      planId: entity.planId,
      status: "draft",
    });
    const updated = await this.questionModel.getByQuestionId(input.questionId);
    const planState = await this.buildStateView(entity.planId);
    return {
      question: this.toQuestionView(updated!),
      planState: planState!,
    };
  }

  async submitPlanForApproval(input: {
    conversationId: string;
    planId?: string;
    payload: SubmitPlanForApprovalPayload;
  }): Promise<AIChatPlanStateView> {
    const { title, objective, planMarkdown } = input.payload;
    if (!title || typeof title !== "string")
      throw new Error("title is required");
    if (!objective || typeof objective !== "string")
      throw new Error("objective is required");
    if (!planMarkdown || typeof planMarkdown !== "string")
      throw new Error("planMarkdown is required");

    const plan =
      (input.planId
        ? await this.planModel.getByPlanId(input.planId)
        : null) ??
      (await this.planModel.getActiveByConversation(input.conversationId));
    if (!plan) throw new Error("No active plan for conversation");

    const nextVersion = plan.currentVersion + 1;
    await this.versionModel.createVersion({
      planId: plan.planId,
      version: nextVersion,
      planMarkdown,
      planJson: input.payload.planJson,
      createdBy: "assistant",
    });
    await this.planModel.updateCurrentVersion(plan.planId, nextVersion);
    if (plan.title !== title || plan.objective !== objective) {
      await this.planModel.updateTitle(plan.planId, title, objective);
    }
    await this.planModel.updateStatus({
      planId: plan.planId,
      status: "awaiting_approval",
    });
    return (await this.buildStateView(plan.planId))!;
  }

  async approvePlan(input: {
    conversationId: string;
    planId: string;
    version: number;
  }): Promise<AIChatPlanStateView> {
    const plan = await this.planModel.getByPlanId(input.planId);
    if (!plan) throw new Error("Plan not found");
    if (plan.conversationId !== input.conversationId) {
      throw new Error("Plan does not belong to this conversation");
    }
    if (plan.status !== "awaiting_approval") {
      throw new Error("Plan is not awaiting approval");
    }
    if (input.version !== plan.currentVersion) {
      throw new Error(
        "A newer plan version is available. Review the latest plan before approving."
      );
    }
    await this.approvalModel.createDecision({
      planId: plan.planId,
      version: input.version,
      decision: "approved",
    });
    await this.planModel.updateStatus({
      planId: plan.planId,
      status: "approved",
      approvedAt: new Date(),
    });
    return (await this.buildStateView(plan.planId))!;
  }

  async rejectPlan(input: {
    conversationId: string;
    planId: string;
    version: number;
    feedback?: string;
  }): Promise<AIChatPlanStateView> {
    const plan = await this.planModel.getByPlanId(input.planId);
    if (!plan) throw new Error("Plan not found");
    if (plan.conversationId !== input.conversationId) {
      throw new Error("Plan does not belong to this conversation");
    }
    if (input.version !== plan.currentVersion) {
      throw new Error("A newer plan version is available.");
    }
    await this.approvalModel.createDecision({
      planId: plan.planId,
      version: input.version,
      decision: "rejected",
      feedback: input.feedback,
    });
    await this.planModel.updateStatus({
      planId: plan.planId,
      status: "rejected",
      rejectedAt: new Date(),
    });
    return (await this.buildStateView(plan.planId))!;
  }

  async requestPlanChanges(input: {
    conversationId: string;
    planId: string;
    version: number;
    feedback: string;
  }): Promise<AIChatPlanStateView> {
    if (!input.feedback || input.feedback.trim().length === 0) {
      throw new Error("feedback is required");
    }
    const plan = await this.planModel.getByPlanId(input.planId);
    if (!plan) throw new Error("Plan not found");
    if (plan.conversationId !== input.conversationId) {
      throw new Error("Plan does not belong to this conversation");
    }
    if (input.version !== plan.currentVersion) {
      throw new Error("A newer plan version is available.");
    }
    await this.approvalModel.createDecision({
      planId: plan.planId,
      version: input.version,
      decision: "changes_requested",
      feedback: input.feedback,
    });
    await this.planModel.updateStatus({
      planId: plan.planId,
      status: "draft",
    });
    return (await this.buildStateView(plan.planId))!;
  }

  async listVersions(planId: string): Promise<AIChatPlanVersionView[]> {
    const rows = await this.versionModel.listByPlanId(planId);
    return rows.map((r) => this.toVersionView(r));
  }

  async clearConversationPlanState(conversationId: string): Promise<void> {
    await this.questionModel.deleteByConversation(conversationId);
    await this.planModel.deleteByConversation(conversationId);
    // Versions and approvals for deleted plans remain orphaned but harmless in V1.
  }
}
