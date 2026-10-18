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
  type WorkspaceRolloutFeature,
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
import {
  setQueueTurnDispatcher,
  setRunOwnerResumeRouter,
  sharedWorkspaceEventRouter,
} from "@/service/aiChatWorkspaceRuntime";
import type { AIChatEventRouter } from "@/service/AIChatEventRouter";
import { getSharedExecutionScheduler } from "@/service/aiChatSharedScheduler";
import { AIChatConversationTurnCoordinator } from "@/service/AIChatConversationTurnCoordinator";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import {
  getQueryEngine,
  getQueueService,
  canUseChat,
  parseMetadata,
  serializeHistoryTimestamp,
  validateAndStageGeneratedImageFields,
} from "@/main-process/communication/ai-chat-v2-ipc";
import { userSafeError, pendingErrorCode } from "@/service/AIChatErrorMapper";
import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";
import { Token } from "@/modules/token";
import {
  AI_CHAT_WORKSPACE_SHARED_ORCHESTRATION,
  AI_CHAT_WORKSPACE_SPECIALIZED_RESULTS,
  AI_CHAT_WORKSPACE_VOICE_MEMORY,
  USER_AI_CHAT_WORKSPACE_REDESIGN,
} from "@/config/usersetting";
import {
  isWorkspaceSharedOrchestrationEnabled,
  isWorkspaceSpecializedResultsEnabled,
  isWorkspaceVoiceMemoryEnabled,
} from "@/service/AIChatWorkspaceRollout";
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
// B02: the coordinator and the durable queue admit through the SAME global
// scheduler instance (see aiChatSharedScheduler) — ordinary interactive work
// cannot bypass resource limits/fairness relative to other owners.
const scheduler = getSharedExecutionScheduler();

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
      // Cross-path terminal notification (shell / message-queue unification):
      // a coordinator-run terminal re-drains or holds durable rows queued
      // behind it. Failures must never break the coordinator path itself.
      onRunTerminal: (conversationId, status) => {
        if (
          status !== "completed" &&
          status !== "cancelled" &&
          status !== "failed"
        ) {
          return;
        }
        void getQueueService()
          .notifyExternalTurnTerminal(conversationId, status)
          .catch((err: unknown) => {
            console.warn(
              "[ai-chat-workspace] queue terminal notification failed:",
              err
            );
          });
      },
    });
    // Stage A §3.4 (FR-004/005): register this coordinator as the execution
    // owner for queue-drained turns. The queue service (wired in
    // ai-chat-v2-ipc.ts) reads the holder at drain time to avoid a static
    // import cycle between the two IPC modules.
    setQueueTurnDispatcher({
      dispatchQueuedTurn: (input) =>
        coordinatorInstance!.dispatchQueuedTurn(input),
    });
    // Stage A §3.5 (FR-024): resume routing for coordinator-owned runs.
    setRunOwnerResumeRouter({
      ownsConversation: (conversationId) =>
        coordinatorInstance!.ownsConversation(conversationId),
      cancelOwnedRun: (conversationId) =>
        coordinatorInstance!.cancelOwnedRun(conversationId),
      resumeRun: (input) => coordinatorInstance!.resumeRun(input),
    });
  }
  return coordinatorInstance;
}

/** Router access for tests and diagnostics. */
export function getAiChatWorkspaceEventRouter(): AIChatEventRouter {
  return eventRouter;
}

/**
 * B03: authoritative busy reason for delete protection. Returns a short
 * reason string when ANY execution owner can still write to the
 * conversation (coordinator live run, engine runtime, non-terminal pending
 * rows covering running/parked/pending dispatch, or a non-terminal durable
 * run envelope), or null when deletion is safe. Renderer state alone is
 * never trusted — this runs in main before any delete proceeds.
 */
async function getConversationBusyReason(
  conversationId: string
): Promise<string | null> {
  if (getAiChatWorkspaceCoordinator().getLiveRuntime(conversationId)) {
    return "live run";
  }
  try {
    if (
      getQueryEngine().getConversationRuntimeStatus(conversationId) !== "idle"
    ) {
      return "engine turn active";
    }
  } catch {
    // Engine status unavailable — fall through to durable checks below.
  }
  try {
    const pending = await getQueueService().list(conversationId);
    if (
      pending.some((row) =>
        ["queued", "steering", "dispatching", "paused"].includes(row.status)
      )
    ) {
      return "queued execution";
    }
  } catch {
    // Queue list unavailable — fall through to run-envelope check.
  }
  try {
    const runs = await new AIChatRunModule().listByConversation(
      conversationId,
      10
    );
    if (
      runs.some((run) =>
        ["queued", "running", "awaiting_permission", "awaiting_user"].includes(
          run.status
        )
      )
    ) {
      return "durable run active";
    }
  } catch {
    // Run lookup unavailable — treat as not busy (fail open would be worse,
    // but without storage we cannot confirm; the layers above already gate).
  }
  return null;
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
  // G04 layering: history paging is owned by AIChatConversationModule —
  // IPC handlers never instantiate Models directly.
  const { rows, hasOlder } = await new AIChatConversationModule().getConversationPage(
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
      // B06: ordinary queue-backed turns never populate the coordinator's
      // liveRuns map — without a durable fallback, selection cannot
      // reconstruct the active run id and background terminals miss the
      // sidebar. Fall back to the latest non-terminal durable run envelope
      // (same precedence as the sidebar projection helper).
      let durableActive: { runId: string; status: string } | null = null;
      if (!live) {
        try {
          const runs = await new AIChatRunModule().listByConversation(
            conversationId,
            10
          );
          const active = runs.find((run) =>
            ["queued", "running", "awaiting_permission", "awaiting_user"].includes(
              run.status
            )
          );
          if (active) {
            durableActive = { runId: active.runId, status: active.status };
          }
        } catch {
          // Durable lookup unavailable — keep coordinator/engine truth.
        }
      }
      const snapshot = AIChatConversationModule.effectiveRuntime(
        conversationId,
        (id) => coordinator.getLiveRuntime(id),
        durableActive
      );
      const runtimeStatus =
        snapshot.activeRunId !== null
          ? snapshot.runtimeStatus
          : engineStatus !== "idle"
            ? engineStatus
            : snapshot.runtimeStatus;
      const response: SelectConversationResponse = {
        acceptedGeneration,
        conversationId,
        messages: page.messages,
        nextBefore: page.nextBefore,
        hasOlder: page.hasOlder,
        runtimeStatus,
        activeRunId: snapshot.activeRunId,
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
      // G03 §18.1: entitlement rejections are labeled (deliberate
      // validation/entitlement rejects are excluded from soak acceptance).
      aiChatQueueCounters.incrementLabeled(
        "ai_chat_workspace_submission_rejected_total",
        "ai_disabled"
      );
      return denied(chatAccess.message);
    }
    try {
      const parsed = startChatRunRequestSchema.safeParse(parsePayload(data));
      if (!parsed.success) {
        aiChatQueueCounters.incrementLabeled(
          "ai_chat_workspace_submission_rejected_total",
          "invalid_request"
        );
        return denied("Invalid start-run request");
      }
      // Shared trusted-channel edge (parity with the V2 stream/pending
      // handlers): validate + normalize generated-image references, STAGE the
      // user-confirmed batch set into ConfirmedBatchReferenceRegistry (the
      // registry is what process_artifact_batch consumes — the raw request
      // field is never read downstream), and strip the field so nothing
      // stores or forwards it.
      const validated = validateAndStageGeneratedImageFields(
        parsed.data.uploadedFiles ?? [],
        parsed.data,
        // Codex P1: DO NOT stage at receive time — the coordinator stages
        // when it owns the dispatch, and the durable queue stages when the
        // queued turn dispatches. A receive-time entry under a busy
        // conversation would be consumed by the running turn or cleared by
        // its terminal before the queued turn executes.
        { stage: false }
      );
      if (!validated.ok) {
        aiChatQueueCounters.incrementLabeled(
          "ai_chat_workspace_submission_rejected_total",
          "image_reference_invalid"
        );
        return denied(validated.errorMessage);
      }
      // T1 (AD-001/AD-004, audit): EVERY accepted ordinary send becomes a
      // durable pending row first — idle AND busy. The queue is the single
      // dispatch authority (claim → bridge envelope → engine); the
      // coordinator no longer dispatches ordinary prompts, so a message can
      // never be dispatched twice. forceQueue keeps a busy conversation's
      // row held until the live turn's terminal re-drains.
      const request = {
        ...parsed.data,
        ...validated.request,
        historySelectionIds: validated.request.historySelectionIds
          ? [...validated.request.historySelectionIds]
          : undefined,
      };
      try {
        const engineBusy =
          getQueryEngine().getConversationRuntimeStatus(
            request.conversationId
          ) !== "idle";
        const receipt = await getQueueService().submit({
          forceQueue: engineBusy,
          clientRequestId: request.clientRequestId,
          request,
        });
        if (!receipt.pendingMessage) {
          aiChatQueueCounters.incrementLabeled(
            "ai_chat_workspace_submission_rejected_total",
            "conversation_busy"
          );
          return denied(
            "A run is already active for this conversation. Wait for it to finish or stop it first."
          );
        }
        // G03 §18.1: durable acceptances by disposition (bounded labels).
        aiChatQueueCounters.incrementLabeled(
          "ai_chat_workspace_submission_accepted_total",
          receipt.disposition
        );
        return ok({
          conversationId: request.conversationId,
          runId: `pending-${receipt.pendingMessage.pendingMessageId}`,
          status: "queued",
          acceptedAt: new Date().toISOString(),
        });
      } catch (err) {
        // G03 §18.1: typed queue denials keep their bounded code as the
        // label (codes only — never prompts or payloads); untyped errors
        // fall back to a single unknown label.
        aiChatQueueCounters.incrementLabeled(
          "ai_chat_workspace_submission_rejected_total",
          pendingErrorCode(err) ?? "unknown"
        );
        return denied(userSafeError(err));
      }
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
      // B03: never delete under authoritative execution ownership. The old
      // guard checked only the coordinator's liveRuns map, but ordinary
      // sends now dispatch through the durable queue and never populate it —
      // a running ordinary turn could be deleted and then re-persist content.
      // Deny while ANY owner can still write: coordinator live run, engine
      // runtime, non-terminal pending rows (running/parked/pending dispatch),
      // or a non-terminal durable run envelope.
      const busyReason = await getConversationBusyReason(
        parsed.data.conversationId
      );
      if (busyReason) {
        // G03 §18.1: unsafe-delete denials by guard outcome.
        aiChatQueueCounters.incrementWorkspace(
          "ai_chat_workspace_action_total",
          {
            capability: "workspace",
            action: "conversation_delete",
            outcome: "denied_busy",
          }
        );
        return denied(
          `This conversation is busy (${busyReason}). Stop it before deleting.`
        );
      }
      await new AIChatConversationModule().deleteConversation(
        parsed.data.conversationId
      );
      aiChatQueueCounters.incrementWorkspace("ai_chat_workspace_action_total", {
        capability: "workspace",
        action: "conversation_delete",
        outcome: "deleted",
      });
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
      // Redesign default is OFF with a validated rollback (PRD §33): an
      // unset/empty value reports enabled=false so the legacy dock stays
      // authoritative until the operator (or the A02 mount-time DEFAULT
      // enforcement) records "true". Explicit "false" still rolls back.
      // NOTE: Token.getValue returns "" for missing keys — it never yields
      // null/undefined, so the "" branch is the unset case in practice.
      // A02: `explicit` distinguishes the unset default from an operator's
      // recorded choice — mount-time enforcement may only land the DEFAULT,
      // never overwrite an explicit rollback/disable.
      const enabled = raw === null || raw === undefined ? true : raw === "true";
      const explicit = raw === "true" || raw === "false";
      // A02 (design §23.1): independent adapter controls ride the same
      // channel so the drill toggles each capability through the real shell.
      // Defaults come from the rollout accessors (default-on adapters).
      return ok({
        enabled,
        explicit,
        adapters: {
          sharedOrchestration: isWorkspaceSharedOrchestrationEnabled(),
          specializedResults: isWorkspaceSpecializedResultsEnabled(),
          voiceMemory: isWorkspaceVoiceMemoryEnabled(),
        },
      });
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
      const feature: WorkspaceRolloutFeature = parsed.data.feature ?? "redesign";
      if (feature !== "redesign") {
        // Adapter flags: one presentation/dispatch adapter at a time. The
        // durable queue, run identities and permission gates never change.
        const key =
          feature === "shared_orchestration"
            ? AI_CHAT_WORKSPACE_SHARED_ORCHESTRATION
            : feature === "specialized_results"
              ? AI_CHAT_WORKSPACE_SPECIALIZED_RESULTS
              : AI_CHAT_WORKSPACE_VOICE_MEMORY;
        token.setValue(key, parsed.data.enabled ? "true" : "false");
        return ok({ enabled: parsed.data.enabled, feature });
      }
      token.setValue(
        USER_AI_CHAT_WORKSPACE_REDESIGN,
        parsed.data.enabled ? "true" : "false"
      );
      return ok({ enabled: parsed.data.enabled, feature });
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
