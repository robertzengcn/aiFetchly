// src/service/AIChatQueryLoop.ts
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatMessage,
  OpenAITool,
  OpenAIToolCall,
  ToolExecutionResult,
  StreamRetryInfo,
} from "@/api/aiChatApi";
import type {
  SkillDefinition,
  SkillExecutionContext,
} from "@/entityTypes/skillTypes";
import type {
  AIChatPlanQuestionView,
  AIChatPlanStateView,
  AskUserQuestionPayload,
  SubmitPlanForApprovalPayload,
} from "@/entityTypes/aiChatPlanTypes";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import {
  checkPlanModeToolPolicy,
  isPlanToolName,
} from "@/service/PlanModeToolPolicy";

/** Max model→tool→model rounds per user turn. */
const CHAT_V2_MAX_TOOL_ROUNDS = 8;

/** Dependencies injected into the loop for testability. */
export interface AIChatQueryLoopDeps {
  streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: {
      signal?: AbortSignal;
      onRetry?: (info: StreamRetryInfo) => void;
    }
  ): Promise<void>;

  executeTool(
    name: string,
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<ToolExecutionResult>;

  getSkillDefinition(name: string): SkillDefinition | undefined;
}

/** Serialization helpers (moved from ai-chat-v2-ipc.ts). */
export function serializeToolResultContent(
  payload: Record<string, unknown>
): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      success: false,
      error: "Tool result could not be serialized",
    });
  }
}

export function normalizeToolResult(
  result: ToolExecutionResult
): Record<string, unknown> {
  return {
    success: result.success,
    executionTimeMs: result.execution_time_ms,
    ...result.result,
  };
}

export function isPermissionPromptResult(result: ToolExecutionResult): boolean {
  return result.result.needsPermissionPrompt === true;
}

export function buildAssistantToolCallMessage(
  parsedCalls: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  }>,
  assistantContent: string
): OpenAIChatMessage {
  const toolCalls: OpenAIToolCall[] = parsedCalls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    type: "function",
    function: {
      name: call.name ?? "unknown_tool",
      arguments: JSON.stringify(call.arguments ?? {}),
    },
  }));
  return {
    role: "assistant",
    content: assistantContent || null,
    tool_calls: toolCalls,
  };
}

export class AIChatQueryLoop {
  constructor(private readonly deps: AIChatQueryLoopDeps) {}

  async run(input: AIChatQueryLoopInput): Promise<AIChatQueryLoopResult> {
    const { eventSink } = input;
    let activeAccumulator: OpenAIStreamAccumulator | null = null;
    let finalAccumulator: OpenAIStreamAccumulator | null = null;
    const messages = input.messages;

    try {
      for (
        let round = input.startRound;
        round < CHAT_V2_MAX_TOOL_ROUNDS;
        round += 1
      ) {
        const accumulator = new OpenAIStreamAccumulator();
        activeAccumulator = accumulator;

        console.log(
          `[ai-chat-v2] round ${round} → POST /chat/completions msgs=${
            messages.length
          } roles=[${messages.map((m) => m.role).join(",")}] tools=${
            input.openAITools.length
          }`
        );

        await this.deps.streamChatCompletion(
          {
            messages,
            model: input.request.model,
            temperature: input.request.temperature,
            max_tokens: input.request.maxTokens,
            stream: true,
            tools: input.openAITools.length > 0 ? input.openAITools : undefined,
            tool_choice: input.openAITools.length > 0 ? "auto" : undefined,
          },
          (rawChunk) => {
            if (input.abortController.signal.aborted) return;
            const delta = accumulator.ingest(rawChunk);
            if (delta) {
              eventSink.emit({
                type: "token",
                conversationId: input.conversationId,
                messageId: input.assistantMessageId,
                contentDelta: delta,
                model: accumulator.state.model,
              });
            }
          },
          {
            signal: input.abortController.signal,
            onRetry: (info) => {
              eventSink.emit({
                type: "retry_connect",
                conversationId: input.conversationId,
                messageId: input.assistantMessageId,
                retryAttempt: info.attempt,
                retryMaxAttempts: info.maxAttempts,
                retryDelayMs: info.delayMs,
              });
            },
          }
        );

        finalAccumulator = accumulator;
        const parsedCalls = accumulator
          .tryParseToolCallArguments()
          .filter((call) => call.name && call.id);

        console.log(
          `[ai-chat-v2] round ${round} ← finishReason=${
            accumulator.state.finishReason
          } parsedCalls=${parsedCalls.length} willContinue=${
            accumulator.state.finishReason === "tool_calls" &&
            parsedCalls.length > 0
          }`
        );

        if (
          accumulator.state.finishReason !== "tool_calls" ||
          parsedCalls.length === 0
        ) {
          break;
        }

        if (parsedCalls.some((call) => !call.ok)) {
          throw new Error("Tool call arguments were malformed.");
        }

        messages.push(
          buildAssistantToolCallMessage(
            parsedCalls.filter(
              (
                call
              ): call is typeof call & {
                id: string;
                name: string;
                arguments: Record<string, unknown>;
              } => Boolean(call.id && call.name && call.arguments)
            ),
            accumulator.state.fullContent
          )
        );

        for (const call of parsedCalls) {
          if (!call.ok || !call.id || !call.name) {
            continue;
          }

          eventSink.emit({
            type: "tool_call",
            conversationId: input.conversationId,
            messageId: input.assistantMessageId,
            toolCallId: call.id,
            toolName: call.name,
            toolArguments: call.arguments ?? {},
          });

          // Plan tools are intercepted locally.
          if (input.planContext && isPlanToolName(call.name)) {
            if (call.name === "AskUserQuestion") {
              const paused = await this.handlePlanToolAskUserQuestion(
                input,
                messages,
                call,
                round,
                eventSink
              );
              if (paused) {
                return paused;
              }
              continue;
            }
            if (call.name === "SubmitPlanForApproval") {
              await this.handlePlanToolSubmitForApproval(
                input,
                messages,
                call,
                eventSink
              );
              continue;
            }
          }

          // Plan-mode policy gate.
          if (input.planContext && input.planContext.planState) {
            const skillDef = this.deps.getSkillDefinition(call.name);
            const policyDecision = checkPlanModeToolPolicy({
              toolName: call.name,
              skillPermissionCategory: skillDef?.permissionCategory,
              context: {
                conversationId: input.conversationId,
                planState: input.planContext.planState,
              },
            });
            if (!policyDecision.allowed) {
              const blockedContent = serializeToolResultContent({
                success: false,
                planApprovalRequired: true,
                reason: policyDecision.reason ?? "Plan approval required.",
              });
              eventSink.emit({
                type: "plan_blocked_tool",
                conversationId: input.conversationId,
                messageId: input.assistantMessageId,
                toolCallId: call.id,
                toolName: call.name,
                fullContent: blockedContent,
                planBlockedToolName: call.name,
                planBlockedReason: policyDecision.reason ?? undefined,
              });
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: blockedContent,
              });
              continue;
            }
          }

          const toolResult = await this.deps.executeTool(
            call.name,
            call.arguments ?? {},
            {
              conversationId: input.conversationId,
              toolCallId: call.id,
              args: call.arguments,
            }
          );
          const toolPayload = normalizeToolResult(toolResult);
          const toolContent = serializeToolResultContent(toolPayload);
          console.log(
            `[ai-chat-v2] tool ${call.name} ok=${
              toolResult.success
            } needsPermission=${isPermissionPromptResult(toolResult)}`
          );

          eventSink.emit({
            type: "tool_result",
            conversationId: input.conversationId,
            messageId: input.assistantMessageId,
            toolCallId: call.id,
            toolName: call.name,
            fullContent: toolContent,
            toolResult: toolPayload,
          });

          if (isPermissionPromptResult(toolResult)) {
            return {
              type: "paused_for_permission",
              pending: {
                conversationId: input.conversationId,
                assistantMessageId: input.assistantMessageId,
                conversationMessages: messages,
                abortController: input.abortController,
                request: input.request,
                openAITools: input.openAITools,
                nextRound: round + 1,
                toolCallId: call.id,
                toolName: call.name,
                toolArguments: call.arguments ?? {},
                planContext: input.planContext,
                eventSink: eventSink,
              },
            };
          }

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: toolContent,
          });
          console.log(
            `[ai-chat-v2] tool ${call.name} result pushed → round ${round} will continue`
          );
        }
      }

      if (input.abortController.signal.aborted) {
        return {
          type: "cancelled",
          partialContent: finalAccumulator?.state.fullContent ?? "",
          model: finalAccumulator?.state.model,
          responseId: finalAccumulator?.state.responseId,
        };
      }

      const fullContent = finalAccumulator?.state.fullContent ?? "";
      const finishReason = finalAccumulator?.state.finishReason ?? "stop";
      return {
        type: "completed",
        fullContent,
        finishReason,
        model: finalAccumulator?.state.model,
        responseId: finalAccumulator?.state.responseId,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          type: "cancelled",
          partialContent: activeAccumulator?.state.fullContent ?? "",
          model: activeAccumulator?.state.model,
          responseId: activeAccumulator?.state.responseId,
        };
      }
      return {
        type: "failed",
        error: err,
        partialContent: activeAccumulator?.state.fullContent ?? "",
        model: activeAccumulator?.state.model,
        responseId: activeAccumulator?.state.responseId,
      };
    }
  }

  private async handlePlanToolAskUserQuestion(
    input: AIChatQueryLoopInput,
    messages: OpenAIChatMessage[],
    call: {
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    },
    round: number,
    eventSink: AIChatQueryEventSink
  ): Promise<AIChatQueryLoopResult | null> {
    if (!input.planContext || !call.id || !call.name) return null;
    const payload = (call.arguments ?? {}) as unknown as AskUserQuestionPayload;
    if (!payload || !Array.isArray(payload.questions)) return null;

    let questionView: AIChatPlanQuestionView;
    try {
      questionView = await input.planContext.planModule.saveQuestion({
        conversationId: input.conversationId,
        planId: input.planContext.planState.planId,
        payload,
      });
    } catch (err) {
      console.error("[ai-chat-v2] saveQuestion failed:", err);
      const errContent = serializeToolResultContent({
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "AskUserQuestion payload was rejected.",
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: errContent,
      });
      return null;
    }

    eventSink.emit({
      type: "ask_user_question",
      conversationId: input.conversationId,
      messageId: input.assistantMessageId,
      toolCallId: call.id,
      toolName: call.name,
      question: questionView,
      planState: input.planContext.planState,
    });

    const ackContent = serializeToolResultContent({
      success: true,
      status: "awaiting_answer",
      questionId: questionView.questionId,
    });
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: ackContent,
    });

    return {
      type: "paused_for_plan_question",
      pending: {
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        conversationMessages: messages,
        abortController: input.abortController,
        request: input.request,
        openAITools: input.openAITools,
        nextRound: round + 1,
        toolCallId: call.id,
        questionId: questionView.questionId,
        planId: input.planContext.planState.planId,
        eventSink: eventSink,
      },
    };
  }

  private async handlePlanToolSubmitForApproval(
    input: AIChatQueryLoopInput,
    messages: OpenAIChatMessage[],
    call: {
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    },
    eventSink: AIChatQueryEventSink
  ): Promise<void> {
    if (!input.planContext || !call.id) return;
    const payload = (call.arguments ??
      {}) as unknown as SubmitPlanForApprovalPayload;
    let updatedPlan: AIChatPlanStateView;
    try {
      updatedPlan = await input.planContext.planModule.submitPlanForApproval({
        conversationId: input.conversationId,
        planId: input.planContext.planState.planId,
        payload,
      });
    } catch (err) {
      console.error("[ai-chat-v2] submitPlanForApproval failed:", err);
      const errContent = serializeToolResultContent({
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "SubmitPlanForApproval payload was rejected.",
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: errContent,
      });
      return;
    }

    eventSink.emit({
      type: "plan_submitted",
      conversationId: input.conversationId,
      messageId: input.assistantMessageId,
      toolCallId: call.id,
      toolName: call.name ?? "SubmitPlanForApproval",
      planState: updatedPlan,
    });

    const ackContent = serializeToolResultContent({
      success: true,
      status: "awaiting_approval",
      planId: updatedPlan.planId,
      version: updatedPlan.currentVersion,
    });
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: ackContent,
    });
  }
}
