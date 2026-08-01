import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import { MessageType } from "@/entityTypes/commonType";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import type {
  AgentTaskMessageRecord,
  AgentToolCallRecord,
} from "@/entityTypes/agentTypes";
import type { AgentTaskEntity } from "@/entity/AgentTask.entity";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";

const MAX_CHAT_CONVERSATIONS = 5;
const MAX_AGENT_TASKS = 5;
const MAX_MESSAGES_PER_PACKET = 30;
const MAX_MESSAGE_CHARS = 1200;
const MAX_TOOL_SUMMARY_CHARS = 300;

export interface AutoDreamSourcePacket {
  sourceKind: "chat_v2" | "agent_task";
  sourceId: string;
  updatedAt: string;
  title: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt?: string;
  }>;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    status: string;
    resultSummary?: string;
    errorMessage?: string;
  }>;
}

/**
 * A source packet enriched with the resolved workspace (when the source
 * conversation has an approved workspace). Agent tasks have no conversation
 * link in phase 1, so their `workspace` stays undefined and they are skipped
 * by workspace auto-dream grouping.
 */
export interface WorkspaceAwareAutoDreamSourcePacket
  extends AutoDreamSourcePacket {
  readonly workspace?: {
    readonly workspaceId: number;
    readonly workspaceKey: string;
    readonly workspaceRoot: string;
    readonly displayName: string;
  };
}

export interface CollectSourcesResult {
  packets: WorkspaceAwareAutoDreamSourcePacket[];
  chatConversationCount: number;
  agentTaskCount: number;
  reviewedThrough: Date;
}

export class AIAutoDreamSourceCollector {
  private readonly chatModule = new AIChatV2Module();
  private readonly agentModule = new AgentTaskModule();
  private readonly workspaceResolver = new WorkspaceResolver();

  async collect(input: {
    reviewedSince: Date | null;
  }): Promise<CollectSourcesResult> {
    const reviewedThrough = new Date();
    const packets: WorkspaceAwareAutoDreamSourcePacket[] = [];

    const conversations = await this.chatModule.getConversations();
    const filteredChat = conversations
      .filter((c) => {
        const ts = new Date(c.lastMessageTimestamp).getTime();
        if (!Number.isFinite(ts)) return true;
        return input.reviewedSince ? ts >= input.reviewedSince.getTime() : true;
      })
      .slice(0, MAX_CHAT_CONVERSATIONS);

    for (const c of filteredChat) {
      const convId = c.conversationId;
      if (!convId) continue;
      const rows: AIChatMessageEntity[] =
        await this.chatModule.getConversationMessages(convId);
      const messages = rows
        .filter((r) => r.messageType === MessageType.MESSAGE)
        .slice(-MAX_MESSAGES_PER_PACKET)
        .map((r) => ({
          id: r.messageId,
          role: r.role,
          content: clamp(r.content, MAX_MESSAGE_CHARS),
          createdAt:
            r.timestamp instanceof Date ? r.timestamp.toISOString() : undefined,
        }));
      // Resolve the durable workspace identity for this conversation. Failures
      // (no approved workspace, revoked, etc.) yield no workspace context — the
      // packet is still useful for global user-memory consolidation.
      let workspace: WorkspaceAwareAutoDreamSourcePacket["workspace"];
      try {
        const resolved = await this.workspaceResolver.resolveWithKey(convId);
        if (resolved) {
          workspace = {
            workspaceId: resolved.workspaceId,
            workspaceKey: resolved.workspaceKey,
            workspaceRoot: resolved.canonicalRootPath,
            displayName: resolved.displayName,
          };
        }
      } catch {
        // non-fatal; packet proceeds without workspace context
      }
      packets.push({
        sourceKind: "chat_v2",
        sourceId: convId,
        updatedAt: c.lastMessageTimestamp ?? reviewedThrough.toISOString(),
        title: c.title ?? convId,
        messages,
        ...(workspace ? { workspace } : {}),
      });
    }

    const agentTasks: AgentTaskEntity[] =
      await this.agentModule.listFinishedAfter(
        input.reviewedSince,
        MAX_AGENT_TASKS
      );

    for (const t of agentTasks) {
      const id = t.agentTaskId;
      if (!id) continue;
      const msgs: AgentTaskMessageRecord[] =
        await this.agentModule.listMessages(id);
      const messages = msgs.slice(-MAX_MESSAGES_PER_PACKET).map((m) => ({
        id: m.toolCallId ?? "",
        role: m.role,
        content: clamp(m.content, MAX_MESSAGE_CHARS),
      }));
      const tcs: AgentToolCallRecord[] = await this.agentModule.listToolCalls(
        id
      );
      const toolCalls = tcs.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        status: tc.status,
        resultSummary:
          clamp(tc.resultSummary ?? "", MAX_TOOL_SUMMARY_CHARS) || undefined,
        errorMessage: tc.errorMessage ?? undefined,
      }));
      packets.push({
        sourceKind: "agent_task",
        sourceId: id,
        updatedAt:
          toIso(t.finishedAt) ??
          toIso(t.updatedAt) ??
          reviewedThrough.toISOString(),
        title: (t.prompt ?? id).slice(0, 120),
        messages,
        toolCalls,
      });
    }

    return {
      packets,
      chatConversationCount: filteredChat.length,
      agentTaskCount: agentTasks.length,
      reviewedThrough,
    };
  }
}

/**
 * Group workspace-aware packets by their resolved workspaceKey. Packets with no
 * resolved workspace (no approved workspace, or agent tasks without a
 * conversation link in phase 1) are excluded — they cannot contribute to
 * workspace-scoped consolidation.
 */
export function groupByWorkspace(
  packets: readonly WorkspaceAwareAutoDreamSourcePacket[]
): Map<string, WorkspaceAwareAutoDreamSourcePacket[]> {
  const groups = new Map<string, WorkspaceAwareAutoDreamSourcePacket[]>();
  for (const p of packets) {
    const key = p.workspace?.workspaceKey;
    if (!key) continue;
    const list = groups.get(key);
    if (list) {
      list.push(p);
    } else {
      groups.set(key, [p]);
    }
  }
  return groups;
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function toIso(v: Date | string | undefined | null): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString();
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}
