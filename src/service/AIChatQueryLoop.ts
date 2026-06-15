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
import type { SkillDefinition, SkillExecutionContext } from "@/entityTypes/skillTypes";
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
export function serializeToolResultContent(payload: Record<string, unknown>): string {
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
    // Placeholder — implemented in Step 2.
    void input;
    void this.deps;
    throw new Error("AIChatQueryLoop.run() not implemented");
  }
}
