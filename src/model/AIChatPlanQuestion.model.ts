import { BaseDb } from "@/model/Basedb";
import { AIChatPlanQuestionEntity } from "@/entity/AIChatPlanQuestion.entity";
import { Repository } from "typeorm";
import type {
  AskUserQuestionItem,
  AskUserQuestionAnswer,
  AIChatPlanQuestionStatus,
} from "@/entityTypes/aiChatPlanTypes";

export class AIChatPlanQuestionModel extends BaseDb {
  public repository: Repository<AIChatPlanQuestionEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatPlanQuestionEntity
    );
  }

  async createQuestion(input: {
    questionId: string;
    planId: string;
    conversationId: string;
    questions: AskUserQuestionItem[];
  }): Promise<AIChatPlanQuestionEntity> {
    const entity = new AIChatPlanQuestionEntity();
    entity.questionId = input.questionId;
    entity.planId = input.planId;
    entity.conversationId = input.conversationId;
    entity.status = "pending";
    entity.questionsJson = JSON.stringify(input.questions);
    entity.answersJson = undefined;
    return await this.repository.save(entity);
  }

  async getByQuestionId(
    questionId: string
  ): Promise<AIChatPlanQuestionEntity | null> {
    return await this.repository.findOne({ where: { questionId } });
  }

  async getPendingByConversation(
    conversationId: string
  ): Promise<AIChatPlanQuestionEntity | null> {
    return await this.repository.findOne({
      where: { conversationId, status: "pending" },
      order: { createdAt: "DESC" },
    });
  }

  async getPendingByPlan(
    planId: string
  ): Promise<AIChatPlanQuestionEntity | null> {
    return await this.repository.findOne({
      where: { planId, status: "pending" },
      order: { createdAt: "DESC" },
    });
  }

  async answerQuestion(input: {
    questionId: string;
    answers: AskUserQuestionAnswer[];
  }): Promise<void> {
    await this.repository.update(
      { questionId: input.questionId },
      {
        status: "answered" as AIChatPlanQuestionStatus,
        answersJson: JSON.stringify(input.answers),
        answeredAt: new Date(),
      }
    );
  }

  async cancelPendingForPlan(planId: string): Promise<number> {
    const result = await this.repository.update(
      { planId, status: "pending" },
      { status: "cancelled" as AIChatPlanQuestionStatus }
    );
    return result.affected ?? 0;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected ?? 0;
  }
}
