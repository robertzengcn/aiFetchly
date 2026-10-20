import {
  windowInvoke,
  windowSend,
  windowReceive,
  windowRemoveListener,
} from "@/views/utils/apirequest";
import {
  AI_CHAT_WORKSPACE_BOOTSTRAP,
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
  AI_CHAT_WORKSPACE_GET_FLAG,
  AI_CHAT_WORKSPACE_SET_FLAG,
  AI_CHAT_WORKSPACE_SUMMARY_EVENT,
  AI_CHAT_WORKSPACE_DETAIL_EVENT,
} from "@/config/channellist";
import type {
  CancelChatRunRequest,
  ChatHistoryPageRequest,
  ChatRunDetailEvent,
  ConversationSummaryEvent,
  HistoryCursor,
  MarkConversationReadRequest,
  PlanContinuationIdentityMeta,
  RenameConversationRequest,
  SelectConversationResponse,
  StartChatRunResponse,
  WorkspaceSidebarResponse,
} from "@/entityTypes/aiChatWorkspaceTypes";

/** Renderer-safe workspace run activity row (bounded, safe fields). */
export interface WorkspaceActivityRun {
  readonly runId: string;
  readonly owner: string;
  readonly status: string;
  readonly resourceClass: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
  readonly errorSummary: string | null;
}

export interface StartWorkspaceRunRequest {
  readonly conversationId: string;
  readonly clientRequestId: string;
  readonly message: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly mode?: "chat" | "plan";
  readonly showReasoning?: boolean;
  readonly reasoning?: {
    enabled: boolean;
    effort?: "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
  readonly toolApprovalMode?:
    | "ask_for_approval"
    | "approve_for_me"
    | "full_access";
  readonly uploadedFiles?: readonly {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentBase64: string;
    kind: "document" | "image";
  }[];
  /** Generated images attached as edit references (message + tile index). */
  readonly generatedImageReferences?: readonly {
    messageId: string;
    imageIndex: number;
  }[];
  /**
   * FR-SUB-004 (capability parity): send-time paste bodies, keyed by the
   * composer's numeric paste ids. Mirrors the strict IPC schema fields.
   */
  readonly pastedContents?: Record<string, string>;
  /** FR-IMG-004 trusted channel: user-confirmed generated-image batch set. */
  readonly confirmedGeneratedImageBatch?: {
    references: readonly {
      messageId: string;
      imageIndex: number;
    }[];
  };
  /** FR-HIS-002 transport: opaque archive references (never bodies). */
  readonly historySelectionIds?: readonly string[];
  /** Retry-stable submission identity resolved at engine start ack. */
  readonly submissionId?: string;
  readonly resourceClass?: "general";
  /** Audit R2 G01: plan-continuation timing association (identity only). */
  readonly planContinuation?: PlanContinuationIdentityMeta;
}

/** Create a fresh Chat V2 conversation id (renderer-side, main validates). */
export function createWorkspaceConversationId(): string {
  return `v2-${
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }`;
}

/** Send-button retry safety: one id per send attempt. */
export function createClientRequestId(): string {
  return `cr-${
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }`;
}

export async function bootstrapWorkspace(): Promise<WorkspaceSidebarResponse> {
  return windowInvoke(AI_CHAT_WORKSPACE_BOOTSTRAP, {});
}

export async function selectConversation(
  conversationId: string | null,
  generation: number
): Promise<SelectConversationResponse> {
  return windowInvoke(AI_CHAT_WORKSPACE_SELECT, {
    conversationId,
    generation,
  });
}

export function unsubscribeDetail(): void {
  void windowSend(AI_CHAT_WORKSPACE_UNSUBSCRIBE_DETAIL, {});
}

export async function startChatRun(
  request: StartWorkspaceRunRequest
): Promise<StartChatRunResponse> {
  return windowInvoke(AI_CHAT_WORKSPACE_START_RUN, request);
}

export async function cancelChatRun(
  request: CancelChatRunRequest
): Promise<{ cancelled: boolean }> {
  return windowInvoke(AI_CHAT_WORKSPACE_CANCEL_RUN, request);
}

export async function loadHistoryPage(
  conversationId: string,
  limit: number,
  before?: HistoryCursor
): Promise<
  import("@/entityTypes/aiChatWorkspaceTypes").ChatHistoryPageResponse
> {
  const request: ChatHistoryPageRequest = {
    conversationId,
    limit,
    ...(before ? { before } : {}),
  };
  return windowInvoke(AI_CHAT_WORKSPACE_HISTORY_PAGE, request);
}

export async function markConversationRead(
  request: MarkConversationReadRequest
): Promise<{ advanced: boolean }> {
  return windowInvoke(AI_CHAT_WORKSPACE_MARK_READ, request);
}

export async function renameConversation(
  request: RenameConversationRequest
): Promise<{ renamed: boolean }> {
  return windowInvoke(AI_CHAT_WORKSPACE_RENAME, request);
}

export async function loadWorkspaceActivity(
  conversationId: string,
  limit?: number
): Promise<WorkspaceActivityRun[]> {
  return windowInvoke(AI_CHAT_WORKSPACE_ACTIVITY, {
    conversationId,
    ...(limit !== undefined ? { limit } : {}),
  });
}

/** Parse a main→renderer event payload (JSON string or already-decoded). */
function parseEventPayload<T>(raw: unknown): T | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw as T;
  return null;
}

/** Subscribe to redacted sidebar summary events. Returns an unsubscriber. */
export function subscribeSummaryEvents(
  cb: (event: ConversationSummaryEvent) => void
): () => void {
  const listener = (raw: unknown): void => {
    const event = parseEventPayload<ConversationSummaryEvent>(raw);
    if (event) cb(event);
  };
  windowReceive(AI_CHAT_WORKSPACE_SUMMARY_EVENT, listener);
  return () => {
    windowRemoveListener(AI_CHAT_WORKSPACE_SUMMARY_EVENT, listener);
  };
}

/** Subscribe to selected-conversation detail events. Returns an unsubscriber. */
export function subscribeDetailEvents(
  cb: (event: ChatRunDetailEvent) => void
): () => void {
  const listener = (raw: unknown): void => {
    const event = parseEventPayload<ChatRunDetailEvent>(raw);
    if (event) cb(event);
  };
  windowReceive(AI_CHAT_WORKSPACE_DETAIL_EVENT, listener);
  return () => {
    windowRemoveListener(AI_CHAT_WORKSPACE_DETAIL_EVENT, listener);
  };
}

// ---------------------------------------------------------------------------
// Rollout flag (PRD §33): default-off redesign with a validated rollback.
// ---------------------------------------------------------------------------

export async function isWorkspaceRedesignEnabled(): Promise<boolean> {
  const result = await windowInvoke(AI_CHAT_WORKSPACE_GET_FLAG, {});
  return (result as { enabled?: boolean } | null)?.enabled === true;
}

/**
 * A02 (design §30.2): the rollout preference with its explicitness. The
 * authenticated layout's mount-time enforcement may only persist the
 * DEFAULT when the preference is unset — an operator's explicit rollback
 * (enabled=false) or pin (enabled=true) must never be overwritten by
 * mounting the workspace.
 */
export async function fetchWorkspaceRedesignPreference(): Promise<{
  enabled: boolean;
  explicit: boolean;
} | null> {
  const result = await windowInvoke(AI_CHAT_WORKSPACE_GET_FLAG, {});
  const shaped = result as { enabled?: boolean; explicit?: boolean } | null;
  if (!shaped) return null;
  return {
    enabled: shaped.enabled === true,
    explicit: shaped.explicit === true,
  };
}

export async function setWorkspaceRedesignEnabled(
  enabled: boolean
): Promise<boolean> {
  const result = await windowInvoke(AI_CHAT_WORKSPACE_SET_FLAG, { enabled });
  return (result as { enabled?: boolean } | null)?.enabled === enabled;
}

/**
 * A02 (design §23.1): independent adapter controls shared with the redesign
 * preference channel. Adapter toggles change presentation/dispatch wiring
 * only — never durable rows, run identities or permission gates.
 */
export type WorkspaceRolloutFeatureName =
  | "redesign"
  | "shared_orchestration"
  | "specialized_results"
  | "voice_memory";

export interface WorkspaceRolloutAdapters {
  readonly sharedOrchestration: boolean;
  readonly specializedResults: boolean;
  readonly voiceMemory: boolean;
}

export async function fetchWorkspaceRolloutFlags(): Promise<{
  enabled: boolean;
  explicit: boolean;
  adapters: WorkspaceRolloutAdapters;
} | null> {
  const result = await windowInvoke(AI_CHAT_WORKSPACE_GET_FLAG, {});
  const shaped = result as
    | {
        enabled?: boolean;
        explicit?: boolean;
        adapters?: Partial<WorkspaceRolloutAdapters>;
      }
    | null;
  if (!shaped) return null;
  return {
    enabled: shaped.enabled === true,
    explicit: shaped.explicit === true,
    adapters: {
      // Unreadable/absent adapter values degrade the shell to its shipped
      // default state: adapters ON (see AIChatWorkspaceRollout defaults).
      sharedOrchestration: shaped.adapters?.sharedOrchestration !== false,
      specializedResults: shaped.adapters?.specializedResults !== false,
      voiceMemory: shaped.adapters?.voiceMemory !== false,
    },
  };
}

export async function setWorkspaceRolloutAdapter(
  feature: Exclude<WorkspaceRolloutFeatureName, "redesign">,
  enabled: boolean
): Promise<boolean> {
  const result = await windowInvoke(AI_CHAT_WORKSPACE_SET_FLAG, {
    feature,
    enabled,
  });
  const shaped = result as { enabled?: boolean; feature?: string } | null;
  return shaped?.enabled === enabled && shaped?.feature === feature;
}

export interface ExportedConversationMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly timestamp: string;
  readonly messageType: string;
  readonly model?: string | null;
}

/** Confirmed destructive deletion — the renderer asks the user first. */
export async function deleteConversation(
  conversationId: string
): Promise<{ deleted: boolean }> {
  return windowInvoke(AI_CHAT_WORKSPACE_DELETE, {
    conversationId,
    confirm: true,
  });
}

export async function duplicateConversation(
  conversationId: string
): Promise<{ conversationId: string }> {
  return windowInvoke(AI_CHAT_WORKSPACE_DUPLICATE, { conversationId });
}

export async function exportConversation(
  conversationId: string
): Promise<{
  conversationId: string;
  messages: ExportedConversationMessage[];
}> {
  return windowInvoke(AI_CHAT_WORKSPACE_EXPORT, { conversationId });
}
