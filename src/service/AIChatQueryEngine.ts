// src/service/AIChatQueryEngine.ts
import type {
  AIChatQueryEventSink,
  AnswerPlanQuestionRequest,
  ResumeToolAfterPermissionRequest,
  ResumeTurnResult,
} from "@/service/AIChatQueryEvents";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";

export interface AIChatQuerySubmitInput {
  eventSink: AIChatQueryEventSink;
  request: ChatV2StreamRequest;
}

export class AIChatQueryEngine {
  constructor(private readonly loop: AIChatQueryLoop) {}

  async submitMessage(input: AIChatQuerySubmitInput): Promise<void> {
    void input;
    void this.loop;
    throw new Error("AIChatQueryEngine.submitMessage() not implemented");
  }

  stopActiveTurn(): void {
    throw new Error("AIChatQueryEngine.stopActiveTurn() not implemented");
  }

  async resumeToolAfterPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error(
      "AIChatQueryEngine.resumeToolAfterPermission() not implemented"
    );
  }

  async answerPlanQuestion(
    request: AnswerPlanQuestionRequest
  ): Promise<ResumeTurnResult> {
    void request;
    throw new Error("AIChatQueryEngine.answerPlanQuestion() not implemented");
  }
}
