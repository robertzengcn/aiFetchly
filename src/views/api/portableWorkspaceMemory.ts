import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  PortableMemoryDiagnosticView,
  PortableMemoryRowView,
  PortableMemorySyncSummary,
  PortableWorkspaceStatusView,
} from "@/entityTypes/portableWorkspaceMemoryTypes";

interface ApiShape {
  invoke(
    channel: string,
    data?: string | Record<string, unknown> | unknown
  ): Promise<CommonMessage<unknown>>;
}

interface EventApiShape {
  on(
    channel: string,
    listener: (payload: unknown) => void
  ): unknown;
  removeAllListeners(channel: string): unknown;
}

function api(): ApiShape {
  const w = window as unknown as {
    api?: ApiShape;
  };
  if (!w.api || typeof w.api.invoke !== "function") {
    throw new Error("window.api is not exposed by preload");
  }
  return w.api;
}

function eventApi(): EventApiShape | null {
  const w = window as unknown as { api?: EventApiShape };
  if (!w.api || typeof w.api.on !== "function") {
    return null;
  }
  return w.api;
}

function toData(input: unknown): string {
  if (input === undefined) return "";
  if (typeof input === "string") return input;
  return JSON.stringify(input);
}

async function call<T>(channel: string, input?: unknown): Promise<CommonMessage<T>> {
  return (await api().invoke(channel, toData(input))) as CommonMessage<T>;
}

// Channel constants kept local to this wrapper to avoid coupling the
// renderer import graph to the main-process channellist module.
const CH = {
  STATUS: "ai:portable-workspace-memory:status",
  LIST: "ai:portable-workspace-memory:list",
  ENABLE_PREVIEW: "ai:portable-workspace-memory:enable:preview",
  ENABLE: "ai:portable-workspace-memory:enable",
  EXPORT_PREVIEW: "ai:portable-workspace-memory:export:preview",
  EXPORT: "ai:portable-workspace-memory:export",
  RESCAN: "ai:portable-workspace-memory:rescan",
  DIAGNOSTICS: "ai:portable-workspace-memory:diagnostics:list",
  CONFLICTS: "ai:portable-workspace-memory:conflicts:list",
  CONFLICT_RESOLVE: "ai:portable-workspace-memory:conflict:resolve",
  POLICY: "ai:portable-workspace-memory:policy:update",
  PROMOTE: "ai:portable-workspace-memory:promote",
  PRIVATIZE: "ai:portable-workspace-memory:privatize",
  REVIEW_APPROVE: "ai:portable-workspace-memory:review:approve",
  REVIEW_REJECT: "ai:portable-workspace-memory:review:reject",
  GIT_STATUS: "ai:portable-workspace-memory:git-status",
  GET_STATE: "ai:portable-workspace-memory:get-state",
  BRIDGE_PREVIEW: "ai:portable-workspace-memory:bridge:preview",
  BRIDGE_APPLY: "ai:portable-workspace-memory:bridge:apply",
  BRIDGE_REMOVE: "ai:portable-workspace-memory:bridge:remove",
  IDENTITY_REGENERATE: "ai:portable-workspace-memory:identity:regenerate",
  CHANGED: "ai:portable-workspace-memory:changed",
} as const;

/** Enable-preview view mirrored from the main-process service. */
export interface PortableMemoryEnablePreviewView {
  identityState: "missing" | "valid" | "invalid";
  existingRecordCount: number;
  memoryDirectoryPresent: boolean;
  plannedFiles: string[];
  gitTrackingState: string;
  bridges: {
    target: "AGENTS.md" | "CLAUDE.md";
    preview: {
      target: string;
      exists: boolean;
      action: string;
      beforeHash?: string;
      unifiedDiff: string;
      diagnostic?: { code: string; message: string };
    };
  }[];
}

export interface PortableMemoryExportPreviewView {
  exportableCount: number;
  skipped: { memoryId: string; reason: string }[];
}

export interface PortableMemoryExportResultView {
  exportedCount: number;
  skippedCount: number;
}

export interface PortableMemoryConflictView {
  memoryId: string;
  relativePath: string;
  lastValidHash?: string | null;
  observedHash?: string | null;
  message: string;
  currentFileContent?: string;
  currentFileParseable: boolean;
}

export const portableWorkspaceMemoryApi = {
  status: (conversationId: string) =>
    call<PortableWorkspaceStatusView>(CH.STATUS, { conversationId }),
  list: (conversationId: string) =>
    call<PortableMemoryRowView[]>(CH.LIST, { conversationId }),
  enablePreview: (conversationId: string) =>
    call<PortableMemoryEnablePreviewView>(CH.ENABLE_PREVIEW, {
      conversationId,
    }),
  enable: (input: {
    conversationId: string;
    defaultStorageMode:
      | "private-only"
      | "portable-local"
      | "portable-team"
      | "ask-each-time";
    importPolicy: "automatic" | "review-new" | "review-all";
    exportScope: "none" | "active" | "all";
    visibility: "local" | "team";
    installBridges: ("AGENTS.md" | "CLAUDE.md")[];
  }) => call<PortableWorkspaceStatusView>(CH.ENABLE, input),
  exportPreview: (conversationId: string) =>
    call<PortableMemoryExportPreviewView>(CH.EXPORT_PREVIEW, {
      conversationId,
    }),
  exportMemories: (input: {
    conversationId: string;
    scope: "active" | "all";
    visibility: "local" | "team";
  }) => call<PortableMemoryExportResultView>(CH.EXPORT, input),
  rescan: (conversationId: string) =>
    call<PortableMemorySyncSummary | null>(CH.RESCAN, { conversationId }),
  diagnostics: (conversationId: string) =>
    call<PortableMemoryDiagnosticView[]>(CH.DIAGNOSTICS, { conversationId }),
  conflictsList: (conversationId: string) =>
    call<PortableMemoryConflictView[]>(
      CH.CONFLICTS,
      { conversationId }
    ),
  resolveConflict: (input: {
    conversationId: string;
    memoryId: string;
    action: "use-file" | "use-app" | "merge";
    mergedDocument?: {
      title: string;
      content: string;
      type: "project" | "decision" | "workflow" | "convention" | "reference" | "warning";
      status: "active" | "archived" | "contradicted";
      confidence: number;
      visibility: "local" | "team";
    };
  }) => call<null>(CH.CONFLICT_RESOLVE, input),
  updatePolicy: (input: {
    conversationId: string;
    portableEnabled?: boolean;
    defaultStorageMode?: string;
    importPolicy?: "automatic" | "review-new" | "review-all";
  }) => call<PortableWorkspaceStatusView>(CH.POLICY, input),
  promote: (input: {
    conversationId: string;
    memoryId: string;
    visibility: "local" | "team";
  }) => call<null>(CH.PROMOTE, input),
  privatize: (input: { conversationId: string; memoryId: string }) =>
    call<null>(CH.PRIVATIZE, input),
  approveReview: (input: {
    conversationId: string;
    memoryId: string;
  }) => call<null>(CH.REVIEW_APPROVE, input),
  rejectReview: (input: { conversationId: string; memoryId: string }) =>
    call<null>(CH.REVIEW_REJECT, input),
  gitStatus: (conversationId: string) =>
    call<string>(CH.GIT_STATUS, { conversationId }),
  getPortableState: (input: { conversationId: string; memoryId: string }) =>
    call<{
      portable: boolean;
      syncState?: string;
      lastValidHash?: string | null;
      relativePath?: string;
      visibility?: string;
    }>(CH.GET_STATE, input),
  bridgePreview: (input: {
    conversationId: string;
    target: "AGENTS.md" | "CLAUDE.md";
  }) => call<PortableMemoryEnablePreviewView["bridges"][number]["preview"]>(
    CH.BRIDGE_PREVIEW,
    input
  ),
  bridgeApply: (input: {
    conversationId: string;
    target: "AGENTS.md" | "CLAUDE.md";
    expectedBeforeHash?: string;
  }) =>
    call<{ target: string; applied: boolean; message: string }>(
      CH.BRIDGE_APPLY,
      input
    ),
  bridgeRemove: (input: {
    conversationId: string;
    target: "AGENTS.md" | "CLAUDE.md";
    expectedBeforeHash?: string;
  }) =>
    call<{ target: string; applied: boolean; message: string }>(
      CH.BRIDGE_REMOVE,
      input
    ),
  regenerateIdentity: (conversationId: string) =>
    call<PortableWorkspaceStatusView>(CH.IDENTITY_REGENERATE, {
      conversationId,
    }),
  /** Subscribe to sync summaries. Returns an unsubscribe function. */
  onChanged(listener: (summary: PortableMemorySyncSummary) => void): () => void {
    const events = eventApi();
    if (!events) return () => undefined;
    const wrapped = (payload: unknown): void => {
      try {
        const parsed =
          typeof payload === "string"
            ? (JSON.parse(payload) as PortableMemorySyncSummary)
            : (payload as PortableMemorySyncSummary);
        if (parsed && typeof parsed === "object" && "scopeId" in parsed) {
          listener(parsed);
        }
      } catch {
        // Malformed event — ignore (never trust event data as full records).
      }
    };
    events.on(CH.CHANGED, wrapped);
    return () => {
      events.removeAllListeners(CH.CHANGED);
    };
  },
};
