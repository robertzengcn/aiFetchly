import { BaseModule } from "@/modules/baseModule";
import { AIChatConversationModel } from "@/model/AIChatConversation.model";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import { WorkspaceModel } from "@/model/Workspace.model";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { WorkspaceEntity } from "@/entity/Workspace.entity";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";
import { MessageType } from "@/entityTypes/commonType";
import { isSubstantiveRequest } from "@/service/aiChatTitle/AIChatTitleEligibility";
import {
  GENERATED_TITLE_MAX_CODEPOINTS,
  normalizeText,
  sanitizeExcerpt,
  sanitizeText,
} from "@/service/aiChatTitle/AIChatTitleText";
import type {
  ChatTitleFailureCode,
  ManualRenameResult,
  PreparedTitleCandidate,
} from "@/service/aiChatTitle/AIChatTitleTypes";
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
   * G04 layering: conversation history paging owned by the Module (IPC
   * handlers never touch Models/repositories directly). Returns rows newest
   * (descending) with the older-data flag.
   */
  async getConversationPage(
    conversationId: string,
    limit: number,
    before?: { timestamp: Date; messageId: string }
  ): Promise<{
    rows: AIChatMessageEntity[];
    hasOlder: boolean;
  }> {
    await this.ensureConnection();
    return this.messageModel().getConversationPageDescending(
      conversationId,
      limit,
      before
    );
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
        titleRevision: projection.titleRevision,
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

  /**
   * Atomic manual rename returning authoritative post-commit state (titles
   * design §5.3). `missing` is reported to the renderer as an unavailable
   * conversation — never as a successful rename.
   */
  async applyManualRename(
    conversationId: string,
    title: string
  ): Promise<ManualRenameResult> {
    await this.ensureConnection();
    const updated = await this
      .convModel()
      .renameWithOwnership(conversationId, title);
    if (!updated) return { outcome: "missing" };
    return {
      outcome: "renamed",
      title: updated.title ?? "",
      titleRevision: updated.titleRevision,
    };
  }

  /**
   * Evaluate the first-three-completed-exchanges window (titles design §7.1)
   * from durable rows only — renderer-submitted text is never trusted.
   * Pairs persisted user/assistant MESSAGE rows in ascending order. When an
   * earlier exchange could not dispatch, the earliest qualifying exchange is
   * returned again (eligibility retry; no model attempt consumed).
   */
  /**
   * Evaluate the first-three-completed-exchanges window (titles design §7.1,
   * audit B01/B02/B07) from durable rows only.
   *
   * B01: user text comes exclusively from the persisted `safeTypedText`
   * metadata projection — attachment/mention/pasted enrichment and any other
   * injected context never reach a title request. Exchanges without typed
   * text (attachment-only) never count as substantive.
   * B02: `trustedAssistantMessageId` binds the candidate to the exchange the
   * completion notification identified; cancelled/failed assistant rows are
   * never paired, and only the FIRST THREE completed exchanges are
   * considered (a delayed evaluation after a fourth exchange cannot make a
   * suppressed conversation eligible again).
   * B07: the epoch is captured once and held fixed; if history was cleared
   * mid-preparation, preparation aborts instead of adopting the new epoch.
   */
  async prepareTitleCandidate(
    conversationId: string,
    trustedAssistantMessageId: string | null = null
  ): Promise<PreparedTitleCandidate> {
    await this.ensureConnection();
    const convModel = this.convModel();
    const row = await convModel.getByConversationId(conversationId);
    if (!row || row.archivedAt) return { kind: "not_ready" };
    if (row.titleIsUserSet || row.titleSource === "user") {
      return { kind: "not_ready" };
    }
    if (row.titleGenerationStatus !== "pending") {
      return { kind: "suppressed" };
    }
    // B07: hold the source epoch fixed for the whole preparation.
    const sourceEpoch = row.titleEpoch;

    const messages = await this
      .messageModel()
      .getMessagesByConversation(conversationId, 40);

    // B01: safe typed text + turn metadata per row.
    const safeText = new Map<string, string>();
    const rowMeta = new Map<
      string,
      {
        cancelled?: boolean;
        error?: string;
        source?: string;
      }
    >();
    for (const message of messages) {
      interface RowTurnMeta {
        safeTypedText?: string;
        cancelled?: boolean;
        error?: string;
        source?: string;
      }
      let meta: RowTurnMeta | null = null;
      if (message.metadata) {
        try {
          meta = JSON.parse(message.metadata) as RowTurnMeta;
        } catch {
          meta = null;
        }
      }
      rowMeta.set(message.messageId, meta ?? {});
      safeText.set(message.messageId, meta?.safeTypedText ?? "");
    }

    // B02: pair completed interactive exchanges from trusted rows. A user
    // row counts only with typed text; an assistant row counts only as a
    // successful (non-cancelled, non-error) completion.
    const exchanges: Array<{ userText: string; assistantText: string; assistantId: string }> = [];
    let pendingUserText: string | null = null;
    let trustedSeen = false;
    for (const message of messages) {
      if (message.messageType !== MessageType.MESSAGE) continue;
      const meta = rowMeta.get(message.messageId) ?? {};
      if (message.role === "user") {
        const typed = safeText.get(message.messageId) ?? "";
        if (typed.trim().length > 0 && pendingUserText === null) {
          pendingUserText = typed;
        }
      } else if (message.role === "assistant") {
        const content = message.content?.trim() ?? "";
        // An empty assistant row is not a completed exchange — keep waiting
        // for this user's real answer.
        if (content.length === 0) continue;
        // B02: a cancelled/failed turn ENDS its exchange. The user row may
        // never be paired with a later user's assistant.
        if (meta.cancelled || meta.error) {
          pendingUserText = null;
          continue;
        }
        if (message.messageId === trustedAssistantMessageId) {
          // Trusted-completion detection is independent of pairing: an
          // attachment-only exchange is still a completed trigger whose
          // exchange simply carries no typed text.
          trustedSeen = true;
        }
        if (pendingUserText === null) continue;
        exchanges.push({
          userText: pendingUserText,
          assistantText: content,
          assistantId: message.messageId,
        });
        pendingUserText = null;
      }
    }

    // B02: when the notification carries a trusted assistant id that is not
    // present among completed exchanges (deleted/cancelled/unknown), the
    // trigger is not trustworthy — do nothing.
    if (trustedAssistantMessageId !== null && !trustedSeen) {
      return { kind: "not_ready" };
    }

    const substantive = exchanges
      .slice(0, 3) // B02: first-three-completed-exchanges window only
      .find((exchange) => isSubstantiveRequest(exchange.userText));
    if (substantive) {
      const userText = sanitizeText(normalizeText(substantive.userText));
      const assistantExcerpt = sanitizeText(
        normalizeText(substantive.assistantText)
      );
      // Improve the visible excerpt to the substantive typed request (FR-01)
      // while still pending — bumping the revision only when the visible
      // title actually changes.
      const nextExcerpt = sanitizeExcerpt(
        substantive.userText,
        GENERATED_TITLE_MAX_CODEPOINTS
      );
      let current = row;
      if ((row.title ?? "") !== nextExcerpt) {
        const changed = await convModel.updateExcerptIfPending({
          conversationId,
          epoch: sourceEpoch,
          excerpt: nextExcerpt,
        });
        if (!changed) return { kind: "not_ready" }; // B07: epoch moved or state changed
        current = (await convModel.getByConversationId(conversationId)) ?? row;
        if (current.titleEpoch !== sourceEpoch) {
          return { kind: "not_ready" }; // B07: cleared mid-preparation
        }
      }
      return {
        kind: "eligible",
        userText,
        assistantExcerpt,
        epoch: sourceEpoch,
        revision: current.titleRevision,
      };
    }

    if (exchanges.length >= 3) {
      // Three completed exchanges with no substantive typed request: stop
      // automatic evaluation for this lifecycle (FR-02).
      await convModel.suppressTitleGeneration(conversationId);
      return { kind: "suppressed" };
    }
    return { kind: "pending_window" };
  }

  /** History-clear title lifecycle (FR-09): fresh epoch, conditional reset. */
  async clearTitleLifecycle(conversationId: string): Promise<void> {
    await this.ensureConnection();
    await this.convModel().clearTitleLifecycleForHistoryClear(conversationId);
  }

  /** Title-service surface: conditional single-attempt claim (design §5.1). */
  async claimTitleAttempt(input: {
    conversationId: string;
    epoch: number;
    revision: number;
    requestId: string;
  }): Promise<boolean> {
    await this.ensureConnection();
    return this.convModel().claimTitleAttempt(input);
  }

  /** Title-service surface: conditional generated-title commit (§5.2). */
  async applyGeneratedTitle(input: {
    conversationId: string;
    epoch: number;
    revision: number;
    requestId: string;
    title: string;
  }): Promise<
    | { outcome: "applied"; title: string; revision: number }
    | { outcome: "stale" }
    | { outcome: "missing" }
  > {
    await this.ensureConnection();
    return this.convModel().applyGeneratedTitle(input);
  }

  /** Title-service surface: bounded failure record (no retry). */
  async markTitleAttemptFailed(input: {
    conversationId: string;
    requestId: string;
    failureCode: ChatTitleFailureCode;
  }): Promise<void> {
    await this.ensureConnection();
    await this.convModel().markTitleAttemptFailed(input);
  }

  /**
   * Startup reconciliation (titles design §6): interrupted dispatched
   * attempts fall back permanently for their lifecycle, and legacy user-set
   * rows are repaired to explicit user provenance. Never enqueues work.
   */
  async reconcileTitleStateOnStartup(): Promise<{
    interrupted: number;
    repaired: number;
  }> {
    await this.ensureConnection();
    const convModel = this.convModel();
    const interrupted = await convModel.reconcileInterruptedTitleClaims();
    const repaired = await convModel.repairLegacyUserTitles();
    return { interrupted, repaired };
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

  /**
   * Queue-path terminal coupling (audit R7-04): project the durable
   * assistant result of a drained turn. Reads the turn's final assistant
   * row (`assistant-pending-<pendingId>`) so semantics match the
   * coordinator's terminal projection (completed/cancelled with content;
   * completion drives unread). Best effort — a projection write must never
   * break the terminal/queue advance.
   */
  async recordTurnResult(input: {
    conversationId: string;
    assistantMessageId: string | null;
    status: "completed" | "failed" | "cancelled" | "interrupted";
  }): Promise<void> {
    await this.ensureConnection();
    if (!input.assistantMessageId) return;
    const row = await this.messageModel().repository.findOne({
      where: {
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
      },
    });
    if (!row || row.content.trim().length === 0) return;
    await this.recordMessagePersisted({
      conversationId: input.conversationId,
      isResult: input.status === "completed",
      previewText: row.content,
      timestamp: row.timestamp,
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
      // Copied nonmanual titles become legacy/suppressed on the duplicate;
      // neither copy starts a naming job for copied history (titles §11).
      title: source?.title ?? null,
      titleSource: "legacy",
      titleGenerationStatus: "suppressed",
      preview: source?.preview ?? "",
      createdAt: new Date(),
    });
    if (source?.titleIsUserSet && source.title) {
      // Manual ownership survives duplication.
      await this
        .convModel()
        .renameWithOwnership(newConversationId, source.title);
    }
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

      try {
        const existing = await convModel.getByConversationId(
          conv.conversationId
        );
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
          title: firstUser
            ? excerpt(firstUser.content, TITLE_EXCERPT_MAX)
            : null,
          preview: excerpt(conv.lastMessage, PREVIEW_EXCERPT_MAX),
          createdAt: conv.createdAt,
        });
        // Repair counters/timestamps in one pass after creation. The update
        // is column-scoped so a concurrent title write can never be rolled
        // back by stale title columns (titles design §5.3 writer audit).
        const projection = await convModel.getByConversationId(
          conv.conversationId
        );
        if (projection) {
          await convModel.repository.update(
            { id: projection.id },
            {
              messageCount: conv.messageCount,
              lastMessageAt: conv.lastMessageTimestamp,
              lastResultAt: lastAssistantResult?.timestamp ?? null,
              lastReadAt: conv.lastMessageTimestamp, // backfilled rows start read
              updatedAt: new Date(),
            }
          );
        }
        changed += 1;
      } catch (err) {
        // Race resilience (audit R7-04): a live coupling can materialize the
        // row mid-pass and hit the unique index — skip and keep the pass
        // running; the next pass reconciles anything still missing.
        console.warn(
          "[ai-chat-workspace] projection backfill skipped conversation",
          conv.conversationId,
          err
        );
      }
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
