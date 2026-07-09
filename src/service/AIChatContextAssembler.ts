import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import { AIUserMemoryRetrievalService } from "@/service/AIUserMemoryRetrievalService";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import {
  ai_memory_injection_enabled,
  ai_custom_context_directive,
} from "@/config/settinggroupInit";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { AIFetchlyContextLoader } from "@/service/aifetchlyConfig/AIFetchlyContextLoader";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { buildAvailableAgentsBlock } from "@/service/aifetchlyConfig/availableAgentsBlock";
import path from "node:path";
import type { OpenAIChatMessage, OpenAIMessageRole } from "@/api/aiChatApi";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

const DEFAULT_RECENT_MESSAGE_WINDOW = 30;

const COMPACT_PREAMBLE =
  "Conversation compact context:\nThe following summary is a point-in-time memory of earlier conversation messages.\nUse it as context, but prefer recent messages when there is a conflict.\n\n";

export interface AIChatContextAssembleInput {
  readonly conversationId: string;
  readonly currentUserMessage: string;
  readonly currentUserMessageId?: string;
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
  readonly usedDurableMemory: boolean;
  readonly durableMemoryCount: number;
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
  private readonly durableMemory = new AIUserMemoryRetrievalService();
  private readonly systemSettings = new SystemSettingModule();
  // AiFetchly ~/.aifetchly/AGENTS.md cache. Defaults to the module-level
  // singleton store the config manager populates; reads from cache only,
  // never the filesystem (CTX-03 / T-13-Cache).
  private readonly aifetchlyContext = new AIFetchlyContextLoader();

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
    const withoutCurrent = input.currentUserMessageId
      ? recent.filter((r) => r.messageId !== input.currentUserMessageId)
      : recent;
    const trimmedRecent = fullCompact
      ? withoutCurrent.filter(
          (r) =>
            r.timestamp.getTime() >
            new Date(fullCompact.throughTimestamp).getTime()
        )
      : withoutCurrent;

    const messages: OpenAIChatMessage[] = [];
    messages.push({ role: "system", content: systemPrompt });

    // User-defined custom context directive (CLAUDE.md-style).
    // Placed right after the base system prompt so static user instructions
    // win over conversation-specific retrieved memories. Read failures must
    // never break the AI chat — degrade to no-injection.
    try {
      const customDirective = await this.systemSettings.getSettingValue(
        ai_custom_context_directive
      );
      if (customDirective && customDirective.trim().length > 0) {
        messages.push({ role: "system", content: customDirective });
      }
    } catch (err) {
      console.error(
        "[ai-chat-context] failed to read custom context directive:",
        err
      );
    }

    // Active workspace context. Tell the model which folder it has file
    // access to so it can answer questions about the workspace without
    // probing the filesystem. Gracefully degrade on lookup failure.
    try {
      const workspaceResolver = new WorkspaceResolver();
      const resolved = await workspaceResolver.resolve(input.conversationId);
      if (resolved) {
        const displayName = path.basename(resolved.rootPath);
        messages.push({
          role: "system",
          content: `Active workspace: ${resolved.rootPath} (${displayName})`,
        });
      }
    } catch (err) {
      console.error(
        "[ai-chat-context] failed to resolve active workspace:",
        err
      );
    }

    // AiFetchly global AGENTS.md injection (CTX-01). Reads from the in-memory
    // cache populated by AIFetchlyConfigManager at startup; cache miss returns
    // an empty list (CTX-03). Placed AFTER the base prompt + custom directive
    // + active workspace, and BEFORE durable memory + compact + recent history
    // — so static user-owned instructions sit closer to the system prompt than
    // to retrieved memories (design §12.1). Read failures MUST never break the
    // AI chat — degrade to no-injection + console.error (CTX-03, mirrors the
    // custom-directive try/catch above).
    try {
      const blocks = await this.aifetchlyContext.getInstructionBlocks({
        conversationId: input.conversationId,
        mode: input.mode,
      });
      for (const block of blocks) {
        messages.push({
          role: "system",
          content: AIFetchlyContextLoader.formatInstructionBlock(block),
        });
      }
    } catch (err) {
      console.error(
        "[ai-chat-context] aifetchly instructions injection failed:",
        err
      );
    }

    // AiFetchly "Available agents" discovery block (D-Discovery, Plan 16-03).
    // Lets the model discover dispatchable agents and copy the exact scoped id
    // into run_subagent (ties to D-AgentIDs). Reads the live agentRegistry,
    // which the runtime-registry-sync mutates in-place on
    // AIFETCHLY_CONFIG_CHANGED (replaceSource on every reload), so a subsequent
    // assemble() reflects add/rename/delete WITHOUT an app restart — the
    // registry itself is the cache-invalidation mechanism (mirrors how the
    // AIFetchlyContextStore plays the cache role for instruction blocks).
    // Placed AFTER the AGENTS.md instruction blocks and BEFORE durable memory
    // (CTX-01 ordinal: the static agent catalog sits closer to the system
    // prompt than to retrieved memories). Read failures MUST never break the
    // chat — degrade to no-injection + console.error (mirrors the catch above).
    try {
      const agents = getAIFetchlyConfigManager().getAgentRegistry().list();
      const agentsBlock = buildAvailableAgentsBlock(agents);
      if (agentsBlock.length > 0) {
        messages.push({ role: "system", content: agentsBlock });
      }
    } catch (err) {
      console.error(
        "[ai-chat-context] available agents injection failed:",
        err
      );
    }

    // Durable user memory injection. Reads the user-controllable toggle from
    // the system_setting table (default-on when absent). Placed before compact
    // context so recent conversation history wins when they conflict.
    let injectionEnabled = true;
    try {
      const v = await this.systemSettings.getSettingValue(
        ai_memory_injection_enabled
      );
      injectionEnabled = v !== "false";
    } catch (err) {
      console.error(
        "[ai-chat-context] failed to read memory injection toggle:",
        err
      );
    }
    let durableContextBlock = "";
    let durableMemoryCount = 0;
    if (injectionEnabled) {
      try {
        const durable = await this.durableMemory.retrieve({
          currentUserMessage: input.currentUserMessage,
          conversationId: input.conversationId,
          mode: input.mode,
          maxMemories: 10,
          maxTokens: 2000,
        });
        durableContextBlock = durable.contextBlock;
        durableMemoryCount = durable.memories.length;
      } catch (err) {
        console.error(
          "[ai-chat-context] durable memory retrieval failed:",
          err
        );
      }
    }
    if (durableContextBlock.length > 0) {
      messages.push({ role: "system", content: durableContextBlock });
    }

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
      usedDurableMemory: durableMemoryCount > 0,
      durableMemoryCount,
      compactTriggered: false,
      warnings,
    };
  }
}
