import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import { AIUserMemoryRetrievalService } from "@/service/AIUserMemoryRetrievalService";
import { AIWorkspaceMemoryRetrievalService } from "@/service/AIWorkspaceMemoryRetrievalService";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { AgentDefinitionModule } from "@/modules/AgentDefinitionModule";
import {
  ai_memory_injection_enabled,
  ai_workspace_memory_injection_enabled,
  ai_custom_context_directive,
} from "@/config/settinggroupInit";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { AIFetchlyContextLoader } from "@/service/aifetchlyConfig/AIFetchlyContextLoader";
import { buildAvailableAgentsBlock } from "@/service/aifetchlyConfig/availableAgentsBlock";
import { buildHtmlArtifactGuidanceSection } from "@/service/HtmlArtifactPromptSection";
import path from "node:path";
import os from "node:os";
import type {
  OpenAIChatMessage,
  OpenAIMessageRole,
  OpenAITextContentPart,
  OpenAIImageUrlContentPart,
} from "@/api/aiChatApi";
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
  readonly currentUserContentParts?: Array<
    OpenAITextContentPart | OpenAIImageUrlContentPart
  >;
}

export interface AIChatContextAssembleResult {
  readonly messages: OpenAIChatMessage[];
  readonly tokenEstimate: number;
  readonly usedSessionMemory: boolean;
  readonly usedFullCompact: boolean;
  readonly usedWorkspaceMemory: boolean;
  readonly workspaceMemoryCount: number;
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
  private readonly workspaceMemory = new AIWorkspaceMemoryRetrievalService();
  private readonly systemSettings = new SystemSettingModule();
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

    // Environment & system context. Informs the model of the OS, app
    // version, and local date/time so OS-specific advice, file-path
    // lookups, and time-relative queries work correctly.
    try {
      const envBlock = await this.buildEnvironmentContext();
      messages.push({ role: "system", content: envBlock });
    } catch (err) {
      console.error(
        "[ai-chat-context] failed to build environment context:",
        err
      );
    }

    // AiFetchly global AGENTS.md injection. Reads from the in-memory cache
    // populated by AIFetchlyConfigManager; failures degrade to no-injection.
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

    // Available agents block for run_subagent discovery. Use the same runtime
    // catalog as AGENT_DEFINITION_LIST so persisted plugin-owned agents are
    // visible only when active, healthy, and owned by an enabled plugin.
    try {
      const agents = await new AgentDefinitionModule().listActiveForRuntime();
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

    // HTML-artifact usage guidance (design §15). A static, main-process-safe
    // instruction that tells the model to call create_html_artifact instead of
    // pasting raw HTML into chat or reaching for workspace file tools. Static
    // text — injection can never meaningfully fail, but degrade to no-injection
    // like the surrounding blocks so a future change cannot break chat.
    try {
      messages.push({
        role: "system",
        content: buildHtmlArtifactGuidanceSection(),
      });
    } catch (err) {
      console.error(
        "[ai-chat-context] html artifact guidance injection failed:",
        err
      );
    }

    // Durable user memory injection. Reads the user-controllable toggle from
    // the system_setting table (default-on when absent). Placed before compact
    // context so recent conversation history wins when they conflict.
    let injectionEnabled = true;

    // Workspace memory injection. Project-scoped memories for the active
    // approved workspace. Resolves the workspace (and its key) in the main
    // process; returns an empty block when no workspace is approved or the
    // toggle is off. Placed AFTER the active-workspace block and BEFORE durable
    // user memory so workspace memory wins over global memory for
    // project-specific behavior. Retrieval failure must never break chat —
    // degrade to no-injection (do NOT fall back to global user memory).
    let workspaceInjectionEnabled = true;
    try {
      const wv = await this.systemSettings.getSettingValue(
        ai_workspace_memory_injection_enabled
      );
      workspaceInjectionEnabled = wv !== "false";
    } catch (err) {
      console.error(
        "[ai-chat-context] failed to read workspace memory injection toggle:",
        err
      );
    }
    let workspaceContextBlock = "";
    let workspaceMemoryCount = 0;
    if (workspaceInjectionEnabled) {
      try {
        // Caps (8 memories / 1800 tokens) are owned by the retrieval service's
        // own defaults — not duplicated here, so a default change propagates.
        const workspaceMem = await this.workspaceMemory.retrieve({
          currentUserMessage: input.currentUserMessage,
          conversationId: input.conversationId,
          mode: input.mode,
        });
        workspaceContextBlock = workspaceMem.contextBlock;
        workspaceMemoryCount = workspaceMem.memories.length;
      } catch (err) {
        console.error(
          "[ai-chat-context] workspace memory retrieval failed:",
          err
        );
      }
    }
    if (workspaceContextBlock.length > 0) {
      messages.push({ role: "system", content: workspaceContextBlock });
    }

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

    messages.push({
      role: "user",
      content: input.currentUserContentParts ?? input.currentUserMessage,
    });

    const tokenEstimate = this.estimator.estimateMessages(messages);

    return {
      messages,
      tokenEstimate,
      usedSessionMemory: !fullCompact && !!sessionMemory,
      usedFullCompact: !!fullCompact,
      usedWorkspaceMemory: workspaceMemoryCount > 0,
      workspaceMemoryCount,
      usedDurableMemory: durableMemoryCount > 0,
      durableMemoryCount,
      compactTriggered: false,
      warnings,
    };
  }

  private async buildEnvironmentContext(): Promise<string> {
    const platform = os.type();
    const release = os.release();
    const arch = process.arch;

    let appVersion = "unknown";
    try {
      const { app } = await import("electron");
      const fn = (app as unknown as { getVersion?: () => string }).getVersion;
      appVersion = typeof fn === "function" ? fn.call(app) : "unknown";
    } catch {
      // Not running inside Electron (e.g. test runner) — leave as "unknown".
    }

    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, " UTC");

    return [
      "# Environment & System Context",
      `- Operating System: ${platform} ${release} (${arch})`,
      `- App Version: ${appVersion}`,
      `- Local Date & Time: ${now}`,
    ].join("\n");
  }
}
