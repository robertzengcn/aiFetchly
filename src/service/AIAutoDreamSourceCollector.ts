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
    const packets: WorkspaceAwareAutoDreamSourcePacket[] = [];

    const conversations = await this.chatModule.getConversations();
    // 1. Filter by reviewedSince BEFORE applying limits (tech-design §14.1).
    // 2. Sort oldest-first (ascending) so a bounded batch advances the cursor
    //    through the oldest eligible sources first — never skipping any.
    const filteredChat = conversations
      .filter((c) => {
        const ts = new Date(c.lastMessageTimestamp).getTime();
        if (!Number.isFinite(ts)) return true;
        return input.reviewedSince ? ts >= input.reviewedSince.getTime() : true;
      })
      .sort((a, b) =>
        compareAscending(a.lastMessageTimestamp, b.lastMessageTimestamp)
      )
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
        updatedAt: c.lastMessageTimestamp ?? toIsoNow(),
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
        updatedAt: toIso(t.finishedAt) ?? toIso(t.updatedAt) ?? toIsoNow(),
        title: (t.prompt ?? id).slice(0, 120),
        messages,
        toolCalls,
      });
    }

    // Source-derived cursor: the greatest updatedAt among INCLUDED packets.
    // Never use new Date() as a success cursor — advancing the watermark
    // past unprocessed material would skip eligible sources forever
    // (tech-design §14.1, §2.5).
    const reviewedThrough = maxIncludedUpdatedAt(packets);
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

/**
 * Compare two timestamp values ascending (oldest first). Non-finite or missing
 * timestamps sort last so they are never accidentally skipped. Used to order
 * candidates oldest-first so a bounded batch advances the cursor without gaps.
 */
function compareAscending(
  a: string | Date | undefined | null,
  b: string | Date | undefined | null
): number {
  const ta = toMillis(a);
  const tb = toMillis(b);
  if (ta === tb) return 0;
  if (!Number.isFinite(ta)) return 1;
  if (!Number.isFinite(tb)) return -1;
  return ta - tb;
}

function toMillis(v: string | Date | undefined | null): number {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Current time as an ISO string. Used only for fallback packet timestamps,
 * never as the success cursor (which is source-derived). */
function toIsoNow(): string {
  return new Date().toISOString();
}

/**
 * Derive the reviewedThrough cursor from the greatest `updatedAt` among
 * INCLUDED packets. Returns the wall-clock now only when no packets were
 * collected (a no-source run returns early before reaching this, so this
 * fallback is defensive). This is the source-derived cursor the service
 * commits with a successful run — advancing it past unprocessed material
 * would skip eligible sources forever.
 */
function maxIncludedUpdatedAt(
  packets: readonly WorkspaceAwareAutoDreamSourcePacket[]
): Date {
  let maxMs = NaN;
  for (const p of packets) {
    const ms = toMillis(p.updatedAt);
    if (Number.isFinite(ms) && (Number.isNaN(maxMs) || ms > maxMs)) {
      maxMs = ms;
    }
  }
  if (!Number.isNaN(maxMs)) {
    return new Date(maxMs);
  }
  return new Date();
}
