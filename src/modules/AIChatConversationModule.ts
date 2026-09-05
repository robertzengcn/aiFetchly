import { BaseModule } from "@/modules/baseModule";
import { AIChatConversationModel } from "@/model/AIChatConversation.model";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import { WorkspaceModel } from "@/model/Workspace.model";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { WorkspaceEntity } from "@/entity/Workspace.entity";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";
import type {
  ConversationAttention,
  ConversationRuntimeStatus,
  WorkspaceConversationSummary,
  WorkspaceGroupSummary,
  WorkspaceSidebarResponse,
} from "@/entityTypes/aiChatWorkspaceTypes";

/** Conversations included in the workspace sidebar (Chat V2 namespace). */
const V2_CONVERSATION_PREFIX = "v2-";

const TITLE_EXCERPT_MAX = 80;
const PREVIEW_EXCERPT_MAX = 160;

/** Bounded single-line excerpt safe for navigation surfaces. */
function excerpt(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.slice(0, max);
}

/** Live runtime lookup supplied by the coordinator (design §16.1). */
export interface LiveRuntimeLookup {
  (conversationId: string): {
    runtimeStatus: ConversationRuntimeStatus;
    activeRunId: string | null;
  } | null;
}

/**
 * Conversation/workspace/sidebar business rules for the redesigned workspace
 * (technical-design §8, §16). Owns the effective-summary projection so the
 * renderer never infers status from message content.
 */
export class AIChatConversationModule extends BaseModule {
  private convModel(): AIChatConversationModel {
    return new AIChatConversationModel(this.dbpath);
  }

  private runModel(): AIChatRunModel {
    return new AIChatRunModel(this.dbpath);
  }

  private workspaceModel(): WorkspaceModel {
    return new WorkspaceModel(this.dbpath);
  }

  private messageModel(): AIChatMessageModel {
    return new AIChatMessageModel(this.dbpath);
  }

  /**
   * Effective conversation summary projection (design §8.6):
   * live run state first, durable non-terminal run second, idle otherwise.
   */
  static effectiveRuntime(
    conversationId: string,
    live: LiveRuntimeLookup,
    durableActive: { runId: string; status: string } | null
  ): { runtimeStatus: ConversationRuntimeStatus; activeRunId: string | null } {
    const liveState = live(conversationId);
    if (liveState) {
      return {
        runtimeStatus: liveState.runtimeStatus,
        activeRunId: liveState.activeRunId,
      };
    }
    if (durableActive) {
      return {
        runtimeStatus: durableActive.status as ConversationRuntimeStatus,
        activeRunId: durableActive.runId,
      };
    }
    return { runtimeStatus: "idle", activeRunId: null };
  }

  static attentionFor(
    runtimeStatus: ConversationRuntimeStatus,
    unread: boolean
  ): ConversationAttention {
    if (runtimeStatus === "awaiting_permission") return "permission";
    if (runtimeStatus === "awaiting_user") return "user_input";
    if (
      unread &&
      (runtimeStatus === "failed" || runtimeStatus === "interrupted")
    ) {
      return "failure";
    }
    return "none";
  }

  /**
   * Bounded sidebar projection (design §16.1). Runtime state is joined in
   * memory from the coordinator's live registry after durable summaries
   * load; durable non-terminal rows that were never reconciled are reported
   * as their durable status only when no live state exists.
   */
  async getWorkspaceSidebar(
    live: LiveRuntimeLookup = () => null,
    selectedConversationId: string | null = null
  ): Promise<WorkspaceSidebarResponse> {
    await this.ensureConnection();
    const convModel = this.convModel();

    const projections = (await convModel.listAll()).filter(
      (p) =>
        p.conversationId.startsWith(V2_CONVERSATION_PREFIX) && !p.archivedAt
    );

    // Newest binding row per conversation → workspace group + trust state.
    const bindings = await this.workspaceModel().repository.find({
      order: { createdAt: "DESC" },
    });
    const bindingByConversation = new Map<string, WorkspaceEntity>();
    for (const row of bindings) {
      if (!bindingByConversation.has(row.conversationId)) {
        bindingByConversation.set(row.conversationId, row);
      }
    }

    const conversationIds = projections.map((p) => p.conversationId);
    const durableActive = await this.runModel().listActiveByConversationIds(
      conversationIds
    );
    const durableActiveByConversation = new Map<
      string,
      { runId: string; status: string }
    >();
    for (const run of durableActive) {
      // listByConversation ordering: first row wins (newest created).
      if (!durableActiveByConversation.has(run.conversationId)) {
        durableActiveByConversation.set(run.conversationId, {
          runId: run.runId,
          status: run.status,
        });
      }
    }

    const groups = new Map<
      string,
      {
        displayName: string | null;
        canonicalRootPath: string | null;
        approvalState: string;
        conversations: WorkspaceConversationSummary[];
      }
    >();
    const unassigned: WorkspaceConversationSummary[] = [];

    for (const projection of projections) {
      const id = projection.conversationId;
      const runtime = AIChatConversationModule.effectiveRuntime(
        id,
        live,
        durableActiveByConversation.get(id) ?? null
      );
      const unread = AIChatConversationModel.isUnread(projection);
      const binding = bindingByConversation.get(id);
      const workspaceKey =
        binding?.workspaceKey ?? projection.workspaceKey ?? null;
      const summary: WorkspaceConversationSummary = {
        conversationId: id,
        workspaceKey,
        title: projection.title ?? "",
        preview: projection.preview,
        lastActivityAt: (
          projection.lastMessageAt ??
          projection.createdAt ??
          projection.updatedAt ??
          new Date(0)
        ).toISOString(),
        unread,
        attention: AIChatConversationModule.attentionFor(
          runtime.runtimeStatus,
          unread
        ),
        runtimeStatus: runtime.runtimeStatus,
        activeRunId: runtime.activeRunId,
      };

      if (!workspaceKey) {
        unassigned.push(summary);
        continue;
      }
      let group = groups.get(workspaceKey);
      if (!group) {
        group = {
          displayName: binding?.label ?? null,
          canonicalRootPath: binding?.canonicalRootPath ?? null,
          approvalState: binding?.approvalState ?? "unverified",
          conversations: [],
        };
        groups.set(workspaceKey, group);
      }
      group.conversations.push(summary);
    }

    const workspaces: WorkspaceGroupSummary[] = Array.from(
      groups.entries()
    ).map(([workspaceKey, group]) => ({
      workspaceKey,
      displayName: group.displayName ?? "",
      canonicalRootPath: group.canonicalRootPath,
      approvalState: group.approvalState,
      conversations: group.conversations,
    }));

    return { workspaces, unassigned, selectedConversationId };
  }

  /** Point lookup for the conversation projection row (send hot path). */
  async getConversationProjection(conversationId: string) {
    await this.ensureConnection();
    return this.convModel().getByConversationId(conversationId);
  }

  /** Persisted stable workspace key for a conversation, or null. */
  async getWorkspaceKeyForConversation(
    conversationId: string
  ): Promise<string | null> {
    await this.ensureConnection();
    return this.workspaceModel().findWorkspaceKeyForConversation(conversationId);
  }

  /** Advance the durable read marker monotonically (design §8.5). */
  async markRead(
    conversationId: string,
    observedThrough: Date
  ): Promise<boolean> {
    await this.ensureConnection();
    const updated = await this.convModel().markRead(
      conversationId,
      observedThrough
    );
    return updated !== null;
  }

  async rename(conversationId: string, title: string): Promise<boolean> {
    await this.ensureConnection();
    const updated = await this.convModel().rename(conversationId, title);
    return updated !== null;
  }

  /** Update the projection after any message persistence. */
  async recordMessagePersisted(input: {
    conversationId: string;
    isResult: boolean;
    previewText: string;
    generatedTitle?: string | null;
    timestamp: Date;
  }): Promise<void> {
    await this.ensureConnection();
    // Use the binding's already-persisted stable key — no FS resolution in
    // the message hot path. Unresolved bindings leave the projection null
    // until the workspace-key backfill runs.
    const workspaceKey =
      await this.workspaceModel().findWorkspaceKeyForConversation(
        input.conversationId
      );
    await this.convModel().recordMessagePersisted({
      ...input,
      workspaceKey,
    });
  }

  async deleteProjection(conversationId: string): Promise<void> {
    await this.ensureConnection();
    await this.convModel().deleteByConversationId(conversationId);
  }

  /**
   * Confirmed destructive deletion (PRD §11.5): cascades messages, compact
   * summaries, session memory, and artifacts via the V2 module, then removes
   * the workspace binding and the sidebar projection row.
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await this.ensureConnection();
    const v2 = new AIChatV2Module();
    await v2.clearConversation(conversationId);
    await this.workspaceModel().repository.delete({ conversationId });
    await this.convModel().deleteByConversationId(conversationId);
  }

  /**
   * Duplicate a conversation from allowed durable content (design §11.2):
   * message rows are copied under a fresh conversation id with new message
   * ids; artifacts stay owned by the original conversation.
   */
  async duplicateConversation(conversationId: string): Promise<string | null> {
    await this.ensureConnection();
    const messageModel = this.messageModel();
    const rows = await messageModel.getMessagesByConversation(conversationId);
    if (rows.length === 0) return null;

    const newConversationId = `v2-${
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }`;
    for (const row of rows) {
      const copy = new AIChatMessageEntity();
      copy.messageId = `dup-${row.messageId}-${
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Date.now()
      }`;
      copy.conversationId = newConversationId;
      copy.role = row.role;
      copy.content = row.content;
      copy.timestamp = row.timestamp;
      copy.model = row.model;
      copy.tokensUsed = row.tokensUsed;
      copy.metadata = row.metadata;
      copy.messageType = row.messageType;
      await messageModel.saveMessage(copy);
    }

    const source = await this.convModel().getByConversationId(conversationId);
    await this.convModel().createProjection({
      conversationId: newConversationId,
      workspaceKey: source?.workspaceKey ?? null,
      title: source?.title ?? null,
      preview: source?.preview ?? "",
      createdAt: new Date(),
    });
    return newConversationId;
  }

  /** Full transcript for export (bounded views; renderer triggers download). */
  async exportConversation(conversationId: string): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      timestamp: string;
      messageType: string;
      model?: string | null;
    }>
  > {
    await this.ensureConnection();
    const rows = await this.messageModel().getMessagesByConversation(conversationId);
    return rows.map((row) => ({
      id: row.messageId,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp.toISOString(),
      messageType: row.messageType,
      model: row.model,
    }));
  }

  /**
   * Idempotent conversation-projection backfill (design §26.2). Enumerates
   * distinct v2 conversation ids from messages in bounded pages, derives
   * safe title/preview/count/timestamps, resolves the newest workspace
   * binding, and inserts or repairs projection rows without overwriting
   * user-renamed titles. Returns the number of rows inserted or repaired.
   */
  async backfillProjections(): Promise<number> {
    await this.ensureConnection();
    const convModel = this.convModel();
    const messageModel = this.messageModel();

    const allConversations = await messageModel.getConversationsWithMetadata();
    let changed = 0;
    for (const conv of allConversations) {
      if (!conv.conversationId.startsWith(V2_CONVERSATION_PREFIX)) continue;

      const existing = await convModel.getByConversationId(conv.conversationId);
      if (existing) continue; // repair pass is limited to missing rows

      const messages = await messageModel.getMessagesByConversation(
        conv.conversationId,
        50
      );
      const firstUser = messages.find(
        (m) => m.role === "user" && m.content.trim().length > 0
      );
      const lastAssistantResult = [...messages]
        .reverse()
        .find((m) => m.role === "assistant" && m.content.trim().length > 0);

      await convModel.createProjection({
        conversationId: conv.conversationId,
        // Filled by the workspace-key backfill; null rows stay Unassigned.
        workspaceKey: null,
        title: firstUser ? excerpt(firstUser.content, TITLE_EXCERPT_MAX) : null,
        preview: excerpt(conv.lastMessage, PREVIEW_EXCERPT_MAX),
        createdAt: conv.createdAt,
      });
      // Repair counters/timestamps in one pass after creation.
      const projection = await convModel.getByConversationId(
        conv.conversationId
      );
      if (projection) {
        const entity = { ...projection };
        entity.messageCount = conv.messageCount;
        entity.lastMessageAt = conv.lastMessageTimestamp;
        entity.lastResultAt = lastAssistantResult?.timestamp ?? null;
        entity.lastReadAt = conv.lastMessageTimestamp; // backfilled rows start read
        entity.updatedAt = new Date();
        await convModel.repository.save(entity);
      }
      changed += 1;
    }
    return changed;
  }

  /**
   * Workspace-key backfill (design §26.3): resolve each binding row's stable
   * key via WorkspaceKeyService and persist it. Inaccessible paths stay null
   * and remain visible under the Unassigned group.
   */
  async backfillWorkspaceKeys(): Promise<number> {
    await this.ensureConnection();
    const workspaceModel = this.workspaceModel();
    const keyService = new WorkspaceKeyService();
    const rows = await workspaceModel.repository.find();
    let updated = 0;
    for (const row of rows) {
      if (row.workspaceKey) continue;
      try {
        const resolution = await keyService.resolve(row.rootPath);
        const entity = { ...row };
        entity.workspaceKey = resolution.workspaceKey;
        entity.canonicalRootPath = resolution.canonicalRootPath;
        await workspaceModel.repository.save(entity);
        updated += 1;
      } catch (err) {
        // Leave unresolved — surfaced under Unassigned instead of guessing.
        console.warn(
          "[ai-chat-workspace] workspace key backfill failed for binding",
          row.id,
          err
        );
      }
    }
    return updated;
  }

}
