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
import { sanitizeEnterPlanModeArgs } from "@/service/EnterPlanModeTool";

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

    // Local mutable copies so EnterPlanMode can swap them mid-run.
    let planContext = input.planContext;
    const currentTools = [...input.openAITools];

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
            currentTools.length
          }`
        );

        await this.deps.streamChatCompletion(
          {
            messages,
            model: input.request.model,
            temperature: input.request.temperature,
            max_tokens: input.request.maxTokens,
            stream: true,
            tools: currentTools.length > 0 ? currentTools : undefined,
            tool_choice: currentTools.length > 0 ? "auto" : undefined,
          },
          (rawChunk) => {
            if (input.abortController.signal.aborted) return;
            if (!input.isActiveTurn()) return;
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

        // Surface token usage from this round so the UI can render a live
        // context-usage indicator. The server emits a usage object on the
        // final chunk when stream_options.include_usage is true.
        const roundUsage = accumulator.state.usage;
        if (roundUsage) {
          eventSink.emit({
            type: "usage_update",
            conversationId: input.conversationId,
            messageId: input.assistantMessageId,
            model: accumulator.state.model,
            promptTokens: roundUsage.prompt_tokens,
            completionTokens: roundUsage.completion_tokens,
            totalTokens: roundUsage.total_tokens,
          });
        }

        const parsedCalls = accumulator
          .tryParseToolCallArguments()
          .filter((call) => call.name && call.id);

        // Some OpenAI-compatible servers emit finish_reason="stop" (or omit
        // it entirely) even when tool-call deltas were streamed. The
        // presence of valid parsed tool calls is the reliable signal that
        // the model wants tools executed — not finish_reason.
        const willContinue = parsedCalls.length > 0;
        console.log(
          `[ai-chat-v2] round ${round} ← finishReason=${accumulator.state.finishReason} sawToolCallDelta=${accumulator.state.sawToolCallDelta} parsedCalls=${parsedCalls.length} willContinue=${willContinue}`
        );

        if (accumulator.state.sawToolCallDelta && parsedCalls.length === 0) {
          throw new Error(
            "AI server stream ended before returning a complete response."
          );
        }

        if (!willContinue) {
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

          // Model-initiated Plan Mode entry (chat mode only).
          if (call.name === "EnterPlanMode" && !planContext && input.autoPlan) {
            const transition = await this.handleEnterPlanMode(
              input,
              messages,
              call,
              eventSink
            );
            if (transition.status === "transitioned") {
              planContext = {
                planModule: input.autoPlan.planModule,
                planState: transition.newPlanState,
              };
              input.planContext = planContext;
              // Keep input.openAITools in sync so helper-built pending turns
              // (e.g. paused_for_plan_question) carry the post-transition tool
              // set. The local `currentTools` is the source of truth inside
              // run(); this just keeps the input object consistent for helpers
              // that still read input.openAITools.
              input.openAITools = currentTools;
              for (const t of input.autoPlan.planTools) {
                if (
                  !currentTools.some(
                    (ct) => ct.function.name === t.function.name
                  )
                ) {
                  currentTools.push(t);
                }
              }
            }
            continue;
          }

          if (
            call.name === "EnterPlanMode" &&
            (!input.autoPlan || planContext)
          ) {
            const reason = planContext
              ? "Already in Plan Mode; EnterPlanMode is not available."
              : "EnterPlanMode is not available. Plan Mode auto-entry is disabled.";
            const errContent = serializeToolResultContent({
              success: false,
              error: reason,
            });
            eventSink.emit({
              type: "tool_result",
              conversationId: input.conversationId,
              messageId: input.assistantMessageId,
              toolCallId: call.id,
              toolName: call.name,
              fullContent: errContent,
              toolResult: { success: false, error: reason },
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: errContent,
            });
            continue;
          }

          // Plan tools are intercepted locally.
          if (planContext && isPlanToolName(call.name)) {
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
          if (planContext && planContext.planState) {
            const skillDef = this.deps.getSkillDefinition(call.name);
            const policyDecision = checkPlanModeToolPolicy({
              toolName: call.name,
              skillPermissionCategory: skillDef?.permissionCategory,
              context: {
                conversationId: input.conversationId,
                planState: planContext.planState,
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
                openAITools: currentTools,
                nextRound: round + 1,
                toolCallId: call.id,
                toolName: call.name,
                toolArguments: call.arguments ?? {},
                planContext,
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
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          partialContent: finalAccumulator?.state.fullContent ?? "",
          model: finalAccumulator?.state.model,
          responseId: finalAccumulator?.state.responseId,
        };
      }

      const fullContent = finalAccumulator?.state.fullContent ?? "";
      const finishReason = finalAccumulator?.state.finishReason ?? "stop";
      return {
        type: "completed",
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        fullContent,
        finishReason,
        model: finalAccumulator?.state.model,
        responseId: finalAccumulator?.state.responseId,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return {
          type: "cancelled",
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          partialContent: activeAccumulator?.state.fullContent ?? "",
          model: activeAccumulator?.state.model,
          responseId: activeAccumulator?.state.responseId,
        };
      }
      return {
        type: "failed",
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
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

  /**
   * Handle a model-initiated EnterPlanMode tool call. Creates plan state,
   * emits plan_state, injects a system reminder, and pushes the tool result.
   * Returns "transitioned" on success or "error" (with an error tool result
   * already pushed to messages) on failure.
   */
  private async handleEnterPlanMode(
    input: AIChatQueryLoopInput,
    messages: OpenAIChatMessage[],
    call: {
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    },
    eventSink: AIChatQueryEventSink
  ): Promise<
    | { status: "transitioned"; newPlanState: AIChatPlanStateView }
    | { status: "error" }
  > {
    if (!input.autoPlan || !call.id) {
      return { status: "error" };
    }
    const args = sanitizeEnterPlanModeArgs(call.arguments ?? {});
    const objective = args.objective ?? input.request.message.slice(0, 500);
    const title = input.request.message.slice(0, 80) || "New plan";

    let planState: AIChatPlanStateView;
    try {
      planState = await input.autoPlan.planModule.ensurePlanForConversation({
        conversationId: input.conversationId,
        title,
        objective,
      });
    } catch (err) {
      console.error("[ai-chat-v2] EnterPlanMode ensurePlan failed:", err);
      const errContent = serializeToolResultContent({
        success: false,
        error:
          err instanceof Error ? err.message : "Failed to enter Plan Mode.",
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: errContent,
      });
      return { status: "error" };
    }

    if (planState.status === "approved") {
      const errContent = serializeToolResultContent({
        success: false,
        error: "Plan is already approved; cannot re-enter Plan Mode.",
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: errContent,
      });
      return { status: "error" };
    }

    eventSink.emit({
      type: "plan_state",
      conversationId: input.conversationId,
      messageId: input.assistantMessageId,
      planState,
      autoEntered: true,
      rationale: args.rationale,
    });

    // System-role reminder — OpenAI Chat Completions API permits system
    // messages anywhere in the transcript.
    messages.push({
      role: "system",
      content:
        "Plan mode is now active. Follow the plan-mode workflow:\n" +
        "Understand → Explore → Clarify → Design → Submit.\n" +
        "High-impact tools (email, social posting, campaign mutation, shell, " +
        "filesystem writes, bulk scraping) are BLOCKED until the user approves " +
        "the plan via SubmitPlanForApproval.\n" +
        `Current plan state: status=${planState.status} planId=${planState.planId}`,
    });

    const ackContent = serializeToolResultContent({
      success: true,
      status: "plan_mode_entered",
      planId: planState.planId,
      rationale: args.rationale,
      nextSteps: [
        "Understand — restate the objective",
        "Explore — use read-only tools if needed",
        "Clarify — call AskUserQuestion for user-only info",
        "Design — produce a structured plan",
        "Submit — call SubmitPlanForApproval",
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: ackContent,
    });

    return { status: "transitioned", newPlanState: planState };
  }
}
