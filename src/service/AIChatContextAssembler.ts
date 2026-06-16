import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import type {
  OpenAIChatMessage,
  OpenAIMessageRole,
} from "@/api/aiChatApi";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

const DEFAULT_RECENT_MESSAGE_WINDOW = 30;

const COMPACT_PREAMBLE =
  "Conversation compact context:\nThe following summary is a point-in-time memory of earlier conversation messages.\nUse it as context, but prefer recent messages when there is a conflict.\n\n";

export interface AIChatContextAssembleInput {
  readonly conversationId: string;
  readonly currentUserMessage: string;
  readonly baseSystemPrompt: string;
  readonly mode: "chat" | "plan";
  readonly model?: string;
  readonly maxTokens?: number;
  readonly planState?: AIChatPlanStateView | null;
  readonly recentMessageWindow?: number;
}

export interface AIChatContextAssembleResult {
  readonly messages: OpenAIChatMessage[];
  readonly tokenEstimate: number;
  readonly usedSessionMemory: boolean;
  readonly usedFullCompact: boolean;
  readonly compactTriggered: boolean;
  readonly warnings: readonly string[];
}

function isMessageRow(row: { messageType?: MessageType }): boolean {
  return row.messageType === MessageType.MESSAGE;
}

function roleOf(role: string): OpenAIMessageRole {
  if (role === "system" || role === "user" || role === "assistant") {
    return role;
  }
  return "user";
}

export class AIChatContextAssembler {
  private readonly memory = new AIChatSessionMemoryModule();
  private readonly compact = new AIChatCompactModule();
  private readonly v2 = new AIChatV2Module();
  private readonly estimator = new AIChatTokenEstimator();

  async assemble(
    input: AIChatContextAssembleInput
  ): Promise<AIChatContextAssembleResult> {
    const warnings: string[] = [];

    const systemPrompt =
      input.mode === "plan" && input.planState
        ? buildPlanModeSystemPrompt({
            baseSystemPrompt: input.baseSystemPrompt,
            planState: input.planState,
          })
        : input.baseSystemPrompt;

    const sessionMemory = await this.memory.getByConversation(
      input.conversationId
    );
    const fullCompact = await this.compact.getActiveSummary(
      input.conversationId
    );

    const historyRows = await this.v2.getConversationMessages(
      input.conversationId
    );
    const sorted = [...historyRows].sort((a, b) => {
      const t = a.timestamp.getTime() - b.timestamp.getTime();
      return t !== 0 ? t : a.id - b.id;
    });
    const window = input.recentMessageWindow ?? DEFAULT_RECENT_MESSAGE_WINDOW;
    const recent = sorted.slice(-window).filter(isMessageRow);

    // Drop any recent message that is already covered by an active full
    // compact boundary. Session memory is advisory and may overlap with
    // recent history.
    const trimmedRecent = fullCompact
      ? recent.filter(
          (r) =>
            r.timestamp.getTime() >
            new Date(fullCompact.throughTimestamp).getTime()
        )
      : recent;

    const messages: OpenAIChatMessage[] = [];
    messages.push({ role: "system", content: systemPrompt });

    if (fullCompact) {
      messages.push({
        role: "system",
        content: COMPACT_PREAMBLE + fullCompact.summary,
      });
    } else if (sessionMemory) {
      messages.push({
        role: "system",
        content: COMPACT_PREAMBLE + sessionMemory.summary,
      });
    }

    for (const r of trimmedRecent) {
      messages.push({ role: roleOf(r.role), content: r.content });
    }

    messages.push({ role: "user", content: input.currentUserMessage });

    const tokenEstimate = this.estimator.estimateMessages(messages);

    return {
      messages,
      tokenEstimate,
      usedSessionMemory: !fullCompact && !!sessionMemory,
      usedFullCompact: !!fullCompact,
      compactTriggered: false,
      warnings,
    };
  }
}
