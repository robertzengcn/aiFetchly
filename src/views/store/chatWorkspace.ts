import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ConversationSummaryEvent,
  WorkspaceConversationSummary,
  WorkspaceGroupSummary,
} from "@/entityTypes/aiChatWorkspaceTypes";
import {
  bootstrapWorkspace,
  subscribeSummaryEvents,
} from "@/views/api/aiChatWorkspace";

/**
 * Application-shell state for the redesigned chat workspace
 * (technical-design §14.1): workspace groups, conversation summaries,
 * selection generation, and inspector shell state. It applies redacted
 * summary events and NEVER stores full inactive histories.
 */

export type WorkspaceInspectorTab = "artifacts" | "activity" | "context";

const INSPECTOR_PREFS_KEY = "aiChatWorkspace.inspector";
const COLLAPSED_PREFS_KEY = "aiChatWorkspace.collapsedWorkspaces";
/** Bounded recent-conversation rows per workspace before `More` (PRD §10.2). */
export const WORKSPACE_ROW_LIMIT = 30;

interface InspectorPrefs {
  open: boolean;
  tab: WorkspaceInspectorTab;
  width: number;
}

const DEFAULT_INSPECTOR_PREFS: InspectorPrefs = {
  open: false,
  tab: "activity",
  width: 420,
};

function loadInspectorPrefs(): InspectorPrefs {
  try {
    const raw = localStorage.getItem(INSPECTOR_PREFS_KEY);
    if (!raw) return { ...DEFAULT_INSPECTOR_PREFS };
    const parsed = JSON.parse(raw) as Partial<InspectorPrefs>;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : false,
      tab:
        parsed.tab === "artifacts" ||
        parsed.tab === "activity" ||
        parsed.tab === "context"
          ? parsed.tab
          : DEFAULT_INSPECTOR_PREFS.tab,
      width:
        typeof parsed.width === "number"
          ? Math.min(720, Math.max(320, parsed.width))
          : DEFAULT_INSPECTOR_PREFS.width,
    };
  } catch {
    return { ...DEFAULT_INSPECTOR_PREFS };
  }
}

function loadCollapsedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_PREFS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((k): k is string => typeof k === "string"));
    }
  } catch {
    // fall through
  }
  return new Set();
}

export const useChatWorkspaceStore = defineStore("chatWorkspace", () => {
  // -----------------------------------------------------------------------
  // Sidebar projection
  // -----------------------------------------------------------------------
  const workspaces = ref<readonly WorkspaceGroupSummary[]>([]);
  const unassigned = ref<readonly WorkspaceConversationSummary[]>([]);
  const conversationsById = ref<Map<string, WorkspaceConversationSummary>>(
    new Map()
  );
  const bootstrapError = ref<string | null>(null);
  const bootstrapped = ref(false);

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------
  const selectedConversationId = ref<string | null>(null);
  const selectionGeneration = ref(0);
  const searchQuery = ref("");

  // -----------------------------------------------------------------------
  // Inspector shell (persisted per application window, design §14.1)
  // -----------------------------------------------------------------------
  const inspectorPrefs = ref<InspectorPrefs>(loadInspectorPrefs());
  const collapsedWorkspaceKeys = ref<Set<string>>(loadCollapsedKeys());

  let summaryUnsubscribe: (() => void) | null = null;

  function rebuildConversationIndex(): void {
    const index = new Map<string, WorkspaceConversationSummary>();
    for (const group of workspaces.value) {
      for (const conversation of group.conversations) {
        index.set(conversation.conversationId, conversation);
      }
    }
    for (const conversation of unassigned.value) {
      index.set(conversation.conversationId, conversation);
    }
    conversationsById.value = index;
  }

  /** Load the sidebar projection and start the summary subscription once. */
  async function bootstrap(): Promise<void> {
    bootstrapError.value = null;
    try {
      const response = await bootstrapWorkspace();
      workspaces.value = response.workspaces;
      unassigned.value = response.unassigned;
      rebuildConversationIndex();
      bootstrapped.value = true;
      if (!summaryUnsubscribe) {
        summaryUnsubscribe = subscribeSummaryEvents((event) => {
          applySummaryEvent(event);
        });
      }
    } catch (err) {
      bootstrapError.value =
        err instanceof Error ? err.message : "Failed to load workspace";
    }
  }

  /**
   * Apply one redacted summary event to the sidebar projection. Only status
   * metadata is present — no content bodies ever arrive here (PRD §18.3).
   */
  function applySummaryEvent(event: ConversationSummaryEvent): void {
    const existing = conversationsById.value.get(event.conversationId);
    const updated: WorkspaceConversationSummary = {
      conversationId: event.conversationId,
      workspaceKey: event.workspaceKey ?? existing?.workspaceKey ?? null,
      title: event.title ?? existing?.title ?? "",
      preview: existing?.preview ?? "",
      lastActivityAt: event.lastActivityAt,
      unread: event.unread,
      attention: event.attention,
      runtimeStatus: event.runtimeStatus,
      activeRunId: event.runId ?? null,
    };
    if (!existing) {
      // A conversation first seen via an event (e.g. a brand-new chat)
      // appears under Unassigned until the next bootstrap refresh.
      unassigned.value = [updated, ...unassigned.value];
    }
    // Replace within its group.
    let replaced = false;
    workspaces.value = workspaces.value.map((group) => {
      if (
        group.workspaceKey !== null &&
        updated.workspaceKey !== group.workspaceKey
      ) {
        return group;
      }
      const conversations = group.conversations.map((c) =>
        c.conversationId === updated.conversationId ? updated : c
      );
      if (
        conversations.some((c) => c.conversationId === updated.conversationId)
      ) {
        replaced = true;
      }
      return { ...group, conversations };
    });
    if (!replaced) {
      unassigned.value = unassigned.value.map((c) =>
        c.conversationId === updated.conversationId ? updated : c
      );
    }
    rebuildConversationIndex();
  }

  /** Register a locally created conversation before the first summary. */
  function upsertLocalConversation(
    conversation: WorkspaceConversationSummary
  ): void {
    const existing = conversationsById.value.get(conversation.conversationId);
    if (existing) {
      applySummaryEvent({
        conversationId: conversation.conversationId,
        workspaceKey: conversation.workspaceKey,
        runtimeStatus: conversation.runtimeStatus,
        attention: conversation.attention,
        unread: conversation.unread,
        lastActivityAt: conversation.lastActivityAt,
        reason: "conversation_updated",
        title: conversation.title || undefined,
      });
      return;
    }
    unassigned.value = [conversation, ...unassigned.value];
    rebuildConversationIndex();
  }

  /** Artifact the inspector should preview (FR-026/FR-030 auto-open). */
  const requestedArtifactId = ref<string | null>(null);

  function requestArtifactPreview(artifactId: string): void {
    requestedArtifactId.value = artifactId;
    openInspector("artifacts");
  }

  function markConversationReadLocally(conversationId: string): void {
    const existing = conversationsById.value.get(conversationId);
    if (!existing || !existing.unread) return;
    applySummaryEvent({
      conversationId,
      workspaceKey: existing.workspaceKey,
      runtimeStatus: existing.runtimeStatus,
      attention: existing.attention === "failure" ? "failure" : "none",
      unread: false,
      lastActivityAt: existing.lastActivityAt,
      reason: "conversation_updated",
    });
  }

  // -----------------------------------------------------------------------
  // Selection handshake bookkeeping (selectedConversation store drives it)
  // -----------------------------------------------------------------------
  function nextGeneration(): number {
    selectionGeneration.value += 1;
    return selectionGeneration.value;
  }

  function setSelected(conversationId: string | null): void {
    selectedConversationId.value = conversationId;
  }

  // -----------------------------------------------------------------------
  // Inspector + expansion persistence
  // -----------------------------------------------------------------------
  function toggleInspector(): void {
    inspectorPrefs.value = { ...inspectorPrefs.value, open: !inspectorPrefs.value.open };
    persistInspector();
  }

  function openInspector(tab?: WorkspaceInspectorTab): void {
    inspectorPrefs.value = {
      ...inspectorPrefs.value,
      open: true,
      ...(tab ? { tab } : {}),
    };
    persistInspector();
  }

  function setInspectorTab(tab: WorkspaceInspectorTab): void {
    inspectorPrefs.value = { ...inspectorPrefs.value, tab };
    persistInspector();
  }

  function setInspectorWidth(width: number): void {
    inspectorPrefs.value = {
      ...inspectorPrefs.value,
      width: Math.min(720, Math.max(320, width)),
    };
    persistInspector();
  }

  function persistInspector(): void {
    try {
      localStorage.setItem(INSPECTOR_PREFS_KEY, JSON.stringify(inspectorPrefs.value));
    } catch {
      // Storage unavailable — session-only fallback.
    }
  }

  function toggleWorkspaceCollapsed(workspaceKey: string): void {
    const next = new Set(collapsedWorkspaceKeys.value);
    if (next.has(workspaceKey)) next.delete(workspaceKey);
    else next.add(workspaceKey);
    collapsedWorkspaceKeys.value = next;
    try {
      localStorage.setItem(COLLAPSED_PREFS_KEY, JSON.stringify([...next]));
    } catch {
      // ignore
    }
  }

  function teardown(): void {
    if (summaryUnsubscribe) {
      summaryUnsubscribe();
      summaryUnsubscribe = null;
    }
  }

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------
  const selectedConversation = computed(
    () =>
      (selectedConversationId.value
        ? conversationsById.value.get(selectedConversationId.value)
        : undefined) ?? null
  );

  /** Flatten groups honoring collapse + search (sidebar rendering input). */
  const visibleWorkspaceGroups = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    return workspaces.value.map((group) => {
      const collapsed = collapsedWorkspaceKeys.value.has(group.workspaceKey);
      const filtered = query
        ? group.conversations.filter(
            (c) =>
              c.title.toLowerCase().includes(query) ||
              c.preview.toLowerCase().includes(query)
          )
        : group.conversations;
      return {
        ...group,
        conversations: filtered.slice(0, WORKSPACE_ROW_LIMIT),
        totalCount: filtered.length,
        collapsed: query ? false : collapsed,
      };
    });
  });

  const visibleUnassigned = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return unassigned.value.slice(0, WORKSPACE_ROW_LIMIT);
    return unassigned.value
      .filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.preview.toLowerCase().includes(query)
      )
      .slice(0, WORKSPACE_ROW_LIMIT);
  });

  return {
    workspaces,
    unassigned,
    conversationsById,
    bootstrapped,
    bootstrapError,
    bootstrap,
    applySummaryEvent,
    upsertLocalConversation,
    markConversationReadLocally,
    requestedArtifactId,
    requestArtifactPreview,
    selectedConversationId,
    selectedConversation,
    selectionGeneration,
    nextGeneration,
    setSelected,
    searchQuery,
    visibleWorkspaceGroups,
    visibleUnassigned,
    collapsedWorkspaceKeys,
    toggleWorkspaceCollapsed,
    inspectorOpen: computed(() => inspectorPrefs.value.open),
    inspectorTab: computed(() => inspectorPrefs.value.tab),
    inspectorWidth: computed(() => inspectorPrefs.value.width),
    toggleInspector,
    openInspector,
    setInspectorTab,
    setInspectorWidth,
    teardown,
  };
});
