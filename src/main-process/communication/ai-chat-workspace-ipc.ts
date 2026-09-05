import { ipcMain } from "electron";
import {
  AI_CHAT_WORKSPACE_BOOTSTRAP,
  AI_CHAT_WORKSPACE_GET_FLAG,
  AI_CHAT_WORKSPACE_SET_FLAG,
  AI_CHAT_WORKSPACE_SELECT,
  AI_CHAT_WORKSPACE_UNSUBSCRIBE_DETAIL,
  AI_CHAT_WORKSPACE_START_RUN,
  AI_CHAT_WORKSPACE_CANCEL_RUN,
  AI_CHAT_WORKSPACE_HISTORY_PAGE,
  AI_CHAT_WORKSPACE_MARK_READ,
  AI_CHAT_WORKSPACE_RENAME,
  AI_CHAT_WORKSPACE_DELETE,
  AI_CHAT_WORKSPACE_DUPLICATE,
  AI_CHAT_WORKSPACE_EXPORT,
  AI_CHAT_WORKSPACE_ACTIVITY,
} from "@/config/channellist";
import {
  workspaceBootstrapRequestSchema,
  workspaceFlagGetRequestSchema,
  workspaceFlagSetRequestSchema,
  selectConversationRequestSchema,
  unsubscribeDetailRequestSchema,
  startChatRunRequestSchema,
  cancelChatRunRequestSchema,
  historyPageRequestSchema,
  markConversationReadRequestSchema,
  renameConversationRequestSchema,
  deleteConversationRequestSchema,
  duplicateConversationRequestSchema,
  exportConversationRequestSchema,
  workspaceActivityRequestSchema,
} from "@/schemas/ipc/aiChatWorkspace";
import { AIChatCoordinator } from "@/service/AIChatCoordinator";
import { sharedWorkspaceEventRouter } from "@/service/aiChatWorkspaceRuntime";
import type { AIChatEventRouter } from "@/service/AIChatEventRouter";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { AIChatConversationTurnCoordinator } from "@/service/AIChatConversationTurnCoordinator";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import {
  getQueryEngine,
  canUseChat,
  parseMetadata,
  serializeHistoryTimestamp,
} from "@/main-process/communication/ai-chat-v2-ipc";
import { userSafeError } from "@/service/AIChatErrorMapper";
import { Token } from "@/modules/token";
import {
  USERSDBPATH,
  USER_AI_CHAT_WORKSPACE_REDESIGN,
} from "@/config/usersetting";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  ChatHistoryPageResponse,
  SelectConversationResponse,
  WorkspaceSidebarResponse,
} from "@/entityTypes/aiChatWorkspaceTypes";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}

// ---------------------------------------------------------------------------
// Singletons shared by every workspace handler.
// ---------------------------------------------------------------------------

const eventRouter = sharedWorkspaceEventRouter;
const scheduler = new AIChatExecutionScheduler();

let coordinatorInstance: AIChatCoordinator | null = null;

export function getAiChatWorkspaceCoordinator(): AIChatCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new AIChatCoordinator({
      engine: getQueryEngine(),
      runModule: new AIChatRunModule(),
      conversationModule: new AIChatConversationModule(),
      router: eventRouter,
      scheduler,
      turnCoordinator: AIChatConversationTurnCoordinator.getInstance(),
      canUseChat,
    });
  }
  return coordinatorInstance;
}

/** Router access for tests and diagnostics. */
export function getAiChatWorkspaceEventRouter(): AIChatEventRouter {
  return eventRouter;
}

/** One-time-per-process projection backfill guard. */
let backfillStarted = false;

function toMessageView(row: {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  timestamp: Date;
  messageType: ChatV2MessageView["messageType"];
  model?: string | null;
  tokensUsed?: number | null;
  metadata?: string | null;
}): ChatV2MessageView {
  return {
    id: row.messageId,
    conversationId: row.conversationId,
    role: (row.role as ChatV2MessageView["role"]) ?? "user",
    content: row.content,
    timestamp: serializeHistoryTimestamp(row.timestamp),
    messageType: row.messageType,
    model: row.model ?? undefined,
    tokensUsed: row.tokensUsed ?? undefined,
    metadata: parseMetadata(row.metadata),
  };
}

async function loadHistoryPage(input: {
  conversationId: string;
  limit: number;
  before?: { timestamp: string; messageId: string };
}): Promise<ChatHistoryPageResponse> {
  const model = new AIChatMessageModel(getDbPathOrThrow());
  const { rows, hasOlder } = await model.getConversationPageDescending(
    input.conversationId,
    input.limit,
    input.before
      ? {
          timestamp: new Date(input.before.timestamp),
          messageId: input.before.messageId,
        }
      : undefined
  );
  const oldest = rows[0];
  return {
    conversationId: input.conversationId,
    messages: rows.map(toMessageView),
    nextBefore:
      hasOlder && oldest
        ? {
            timestamp: serializeHistoryTimestamp(oldest.timestamp),
            messageId: oldest.messageId,
          }
        : null,
    hasOlder,
  };
}

function getDbPathOrThrow(): string {
  // The Token service owns USERSDBPATH; models need the raw path.
  const dbpath = new Token().getValue(USERSDBPATH);
  if (!dbpath) throw new Error("User database path is not initialized");
  return dbpath;
}

type InvokeEvent = {
  sender: {
    id: number;
    isDestroyed(): boolean;
    send(channel: string, payload: string): void;
  };
};

/**
 * Communication-only IPC registration for the redesigned chat workspace
 * (design §11.2). Handlers validate with Zod and delegate to the coordinator
 * and modules — no database access happens here.
 */
export function registerAiChatWorkspaceIpcHandlers(): void {
  // -------------------------------------------------------------------------
  // bootstrap
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_BOOTSTRAP, async (_e, data: unknown) => {
    try {
      const parsed = workspaceBootstrapRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid bootstrap request");
      }
      // FR-020/021: register the sender on bootstrap independently of
      // selection so background summaries arrive immediately, even with
      // no selected conversation.
      eventRouter.register(
        (
          _e as {
            sender: {
              id: number;
              isDestroyed(): boolean;
              send(channel: string, payload: string): void;
            };
          }
        ).sender
      );
      const coordinator = getAiChatWorkspaceCoordinator();
      const conversationModule = new AIChatConversationModule();
      // Idempotent backfill once per process: inserts missing projection
      // rows and workspace keys for legacy conversations.
      if (!backfillStarted) {
        backfillStarted = true;
        // Reconcile abandoned non-terminal runs to `interrupted` BEFORE
        // bootstrap reports runtime state (design §19.4 / FR-036).
        try {
          const reconciled =
            await new AIChatRunModule().reconcileInterruptedRuns(
              "Application restarted before the run finished"
            );
          if (reconciled > 0) {
            console.info(
              `[ai-chat-workspace] reconciled ${reconciled} interrupted run(s)`
            );
          }
        } catch (err) {
          console.warn(
            "[ai-chat-workspace] startup run reconciliation failed:",
            err
          );
        }
        // Backfill missing projection rows and workspace keys (idempotent).
        try {
          await conversationModule.backfillProjections();
          await conversationModule.backfillWorkspaceKeys();
        } catch (err) {
          console.warn("[ai-chat-workspace] projection backfill failed:", err);
        }
      }
      const sidebar: WorkspaceSidebarResponse =
        await conversationModule.getWorkspaceSidebar(
          (conversationId) => coordinator.getLiveRuntime(conversationId),
          null
        );
      return ok(sidebar);
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // select — selection handshake (register subscription BEFORE reading)
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_SELECT, async (_event, data: unknown) => {
    const event = _event as unknown as InvokeEvent;
    try {
      const parsed = selectConversationRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid select request");
      }
      const coordinator = getAiChatWorkspaceCoordinator();
      eventRouter.register(event.sender);
      const acceptedGeneration = eventRouter.select(
        event.sender.id,
        parsed.data.conversationId,
        parsed.data.generation
      );
      coordinator.setSelectedConversation(parsed.data.conversationId);

      if (!parsed.data.conversationId) {
        const empty: SelectConversationResponse = {
          acceptedGeneration,
          conversationId: null,
          messages: [],
          nextBefore: null,
          hasOlder: false,
          runtimeStatus: "idle",
          activeRunId: null,
          title: null,
        };
        return ok(empty);
      }

      const conversationId = parsed.data.conversationId;
      const page = await loadHistoryPage({
        conversationId,
        limit: 50,
      });
      const live = coordinator.getLiveRuntime(conversationId);
      const engineStatus =
        getQueryEngine().getConversationRuntimeStatus(conversationId);
      const runtimeStatus = live?.runtimeStatus ?? engineStatus;
      const response: SelectConversationResponse = {
        acceptedGeneration,
        conversationId,
        messages: page.messages,
        nextBefore: page.nextBefore,
        hasOlder: page.hasOlder,
        runtimeStatus,
        activeRunId: live?.activeRunId ?? null,
        title: null,
      };
      return ok(response);
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // unsubscribe-detail
  // -------------------------------------------------------------------------
  ipcMain.on(AI_CHAT_WORKSPACE_UNSUBSCRIBE_DETAIL, (event, data: unknown) => {
    const parsed = unsubscribeDetailRequestSchema.safeParse(parsePayload(data));
    if (!parsed.success) return;
    eventRouter.clearSelection((event as InvokeEvent).sender.id);
  });

  // -------------------------------------------------------------------------
  // start-run — AI gate FIRST, before request parsing (PRD decision 19)
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_START_RUN, async (_e, data: unknown) => {
    const chatAccess = canUseChat();
    if (!chatAccess.ok) {
      return denied(chatAccess.message);
    }
    try {
      const parsed = startChatRunRequestSchema.safeParse(parsePayload(data));
      if (!parsed.success) {
        return denied("Invalid start-run request");
      }
      const result = await getAiChatWorkspaceCoordinator().startRun(
        parsed.data
      );
      if (!result.ok) {
        return denied(result.message);
      }
      return ok(result.response);
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // cancel-run
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_CANCEL_RUN, async (_e, data: unknown) => {
    try {
      const parsed = cancelChatRunRequestSchema.safeParse(parsePayload(data));
      if (!parsed.success) {
        return denied("Invalid cancel-run request");
      }
      const result = await getAiChatWorkspaceCoordinator().cancelRun(
        parsed.data
      );
      return ok(result);
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // history-page
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_HISTORY_PAGE, async (_e, data: unknown) => {
    try {
      const parsed = historyPageRequestSchema.safeParse(parsePayload(data));
      if (!parsed.success) {
        return denied("Invalid history-page request");
      }
      const page = await loadHistoryPage(parsed.data);
      return ok(page);
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // mark-read
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_MARK_READ, async (_e, data: unknown) => {
    try {
      const parsed = markConversationReadRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid mark-read request");
      }
      const conversationModule = new AIChatConversationModule();
      const advanced = await conversationModule.markRead(
        parsed.data.conversationId,
        new Date(parsed.data.observedThrough)
      );
      getAiChatWorkspaceCoordinator().markReadLive(parsed.data.conversationId);
      return ok({ advanced });
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // rename
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_RENAME, async (_e, data: unknown) => {
    try {
      const parsed = renameConversationRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid rename request");
      }
      const conversationModule = new AIChatConversationModule();
      const renamed = await conversationModule.rename(
        parsed.data.conversationId,
        parsed.data.title
      );
      return ok({ renamed });
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // delete / duplicate / export (PRD §11.5 overflow actions)
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_DELETE, async (_e, data: unknown) => {
    try {
      const parsed = deleteConversationRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid delete request");
      }
      // Never delete under a live run: the engine would keep executing and
      // re-persist its result, silently resurrecting the conversation.
      if (
        getAiChatWorkspaceCoordinator().getLiveRuntime(
          parsed.data.conversationId
        )
      ) {
        return denied(
          "This conversation is running a task. Stop it before deleting."
        );
      }
      await new AIChatConversationModule().deleteConversation(
        parsed.data.conversationId
      );
      return ok({ deleted: true });
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  ipcMain.handle(AI_CHAT_WORKSPACE_DUPLICATE, async (_e, data: unknown) => {
    try {
      const parsed = duplicateConversationRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid duplicate request");
      }
      const conversationModule = new AIChatConversationModule();
      const newConversationId = await conversationModule.duplicateConversation(
        parsed.data.conversationId
      );
      if (!newConversationId) {
        return denied("Conversation has no content to duplicate");
      }
      return ok({ conversationId: newConversationId });
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  ipcMain.handle(AI_CHAT_WORKSPACE_EXPORT, async (_e, data: unknown) => {
    try {
      const parsed = exportConversationRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid export request");
      }
      const messages = await new AIChatConversationModule().exportConversation(
        parsed.data.conversationId
      );
      return ok({ conversationId: parsed.data.conversationId, messages });
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // activity
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_ACTIVITY, async (_e, data: unknown) => {
    try {
      const parsed = workspaceActivityRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid activity request");
      }
      const runModule = new AIChatRunModule();
      const runs = await runModule.listByConversation(
        parsed.data.conversationId,
        parsed.data.limit ?? 20
      );
      // Bounded, safe fields only — no prompts or assistant bodies.
      return ok(
        runs.map((r) => ({
          runId: r.runId,
          owner: r.owner,
          status: r.status,
          resourceClass: r.resourceClass,
          queuedAt: r.queuedAt.toISOString(),
          startedAt: r.startedAt?.toISOString() ?? null,
          finishedAt: r.finishedAt?.toISOString() ?? null,
          errorCode: r.errorCode,
          errorSummary: r.errorSummary,
        }))
      );
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  // -------------------------------------------------------------------------
  // rollout flag (PRD §33): default-off redesign with rollback
  // -------------------------------------------------------------------------
  ipcMain.handle(AI_CHAT_WORKSPACE_GET_FLAG, async (_e, data: unknown) => {
    try {
      const parsed = workspaceFlagGetRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid flag request");
      }
      const raw = new Token().getValue(USER_AI_CHAT_WORKSPACE_REDESIGN);
      // Default-on for dev preview: treat missing value (null/undefined) as
      // enabled so the merged redesign is visible without manual setup.
      // Explicit "false" still disables (rollback per design §30.2).
      const enabled = raw === null || raw === undefined ? true : raw === "true";
      return ok({ enabled });
    } catch (err) {
      return denied(userSafeError(err));
    }
  });

  ipcMain.handle(AI_CHAT_WORKSPACE_SET_FLAG, async (_e, data: unknown) => {
    try {
      const parsed = workspaceFlagSetRequestSchema.safeParse(
        parsePayload(data)
      );
      if (!parsed.success) {
        return denied("Invalid flag request");
      }
      const token = new Token();
      token.setValue(
        USER_AI_CHAT_WORKSPACE_REDESIGN,
        parsed.data.enabled ? "true" : "false"
      );
      return ok({ enabled: parsed.data.enabled });
    } catch (err) {
      return denied(userSafeError(err));
    }
  });
}

function parsePayload(data: unknown): unknown {
  if (typeof data === "string" && data.length > 0) {
    try {
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  return data;
}
