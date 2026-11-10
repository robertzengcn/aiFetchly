import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ConversationSummaryEvent,
  WorkspaceConversationSummary,
  WorkspaceGroupSummary,
} from "@/entityTypes/aiChatWorkspaceTypes";
import type { ChatTitleUpdatedEvent } from "@/service/aiChatTitle/AIChatTitleTypes";
import {
  bootstrapWorkspace,
  subscribeSummaryEvents,
  subscribeTitleEvents,
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
/**
 * Audit R7-03: the selected conversation survives a renderer reload/crash
 * through this pointer. It stores ONLY an id — the authoritative content
 * and runtime snapshot always come from `loadSelection` after the sidebar
 * projection validates the conversation still exists.
 */
const SELECTED_POINTER_KEY = "aiChatWorkspace.selectedConversation";
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

function readSelectedPointer(): string | null {
  try {
    const raw = localStorage.getItem(SELECTED_POINTER_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

function persistSelectedPointer(conversationId: string | null): void {
  try {
    if (conversationId) localStorage.setItem(SELECTED_POINTER_KEY, conversationId);
    else localStorage.removeItem(SELECTED_POINTER_KEY);
  } catch {
    // Storage unavailable — restore is best-effort.
  }
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
  let titleUnsubscribe: (() => void) | null = null;
  /**
   * B18: ids whose AUTHORITATIVE versioned title state is known (bootstrap,
   * title event, or versioned summary). A legacy unversioned title can
   * initialize a never-known row but never overwrite a known one — not even
   * a cleared-to-empty known title.
   */
  const titleVersionedKnown = new Set<string>();
  /**
   * B17: title events arriving while a bootstrap response is in flight.
   * Buffered (newest revision per id) and reconciled after install so a
   * newer event can never be lost to the empty local index.
   */
  let bootstrapInFlight = false;
  const pendingTitleEvents = new Map<string, ChatTitleUpdatedEvent>();
  /**
   * B23/F11: monotonic scope/bootstrap generation. EVERY request captures the
   * current value and only the newest request may install results, write
   * errors, clear in-flight state, or drain the title buffer — a stale
   * success, rejection, or scope-reset response owns nothing.
   */
  let bootstrapGeneration = 0;
  let activeBootstrapGeneration: number | null = null;

  // ---------------------------------------------------------------------------
  // BUGFIX 2026-11-02 (left menu never shows the new chat's workspace folder):
  // the sidebar projection only regroups at bootstrap. Summary events carry a
  // `workspaceKey` — when one introduces or changes a NON-NULL key for a row,
  // the row belongs in a workspace folder it is not placed in yet. Debounce a
  // re-bootstrap so the authoritative main-process projection rebuilds the
  // folder set (display names, trust state, ordering) instead of duplicating
  // grouping rules renderer-side. Bursts collapse into a single fetch.
  // ---------------------------------------------------------------------------
  const GROUPING_REFRESH_DEBOUNCE_MS = 500;
  let groupingRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let groupingRefreshInFlight = false;
  let groupingRefreshQueued = false;

  function scheduleGroupingRefresh(): void {
    if (groupingRefreshTimer !== null) {
      clearTimeout(groupingRefreshTimer);
    }
    groupingRefreshTimer = setTimeout(() => {
      groupingRefreshTimer = null;
      void runGroupingRefresh();
    }, GROUPING_REFRESH_DEBOUNCE_MS);
  }

  async function runGroupingRefresh(): Promise<void> {
    if (groupingRefreshInFlight) {
      // A refresh is already reading: events may have landed after that
      // fetch snapshot — queue exactly one more pass when it completes.
      groupingRefreshQueued = true;
      return;
    }
    groupingRefreshInFlight = true;
    try {
      await bootstrap();
    } finally {
      groupingRefreshInFlight = false;
      if (groupingRefreshQueued) {
        groupingRefreshQueued = false;
        scheduleGroupingRefresh();
      }
    }
  }

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

  /**
   * Load the sidebar projection. Event subscriptions start BEFORE the
   * request so an update arriving mid-bootstrap cannot be lost
   * (chat-titles design §10.3); the response then merges by revision.
   */
  async function bootstrap(): Promise<void> {
    bootstrapError.value = null;
    startEventSubscriptions();
    bootstrapInFlight = true;
    const generation = ++bootstrapGeneration;
    activeBootstrapGeneration = generation;
    try {
      const response = await bootstrapWorkspace();
      // F11/B23: a scope reset or a NEWER request superseded this one —
      // install nothing and own no state transitions.
      if (generation !== bootstrapGeneration) return;
      workspaces.value = mergeGroupTitles(response.workspaces);
      unassigned.value = mergeUnassignedTitles(response.unassigned);
      rebuildConversationIndex();
      // B17/B18: the response is a versioned source — every delivered row
      // now has authoritative title state.
      for (const conversation of conversationsById.value.values()) {
        titleVersionedKnown.add(conversation.conversationId);
      }
      bootstrapped.value = true;
    } catch (err) {
      // F11: a superseded request's rejection must not set the current
      // scope's error state.
      if (generation !== bootstrapGeneration) return;
      bootstrapError.value =
        err instanceof Error ? err.message : "Failed to load workspace";
    } finally {
      // F11: only the ACTIVE request may clear in-flight state and drain
      // the shared buffer — a stale request must not consume current events.
      if (activeBootstrapGeneration === generation) {
        activeBootstrapGeneration = null;
        bootstrapInFlight = false;
        // B17: reconcile events buffered during the request (newer wins).
        const buffered = [...pendingTitleEvents.values()];
        pendingTitleEvents.clear();
        for (const event of buffered) {
          applyTitleUpdate(event);
        }
      }
    }
  }

  function startEventSubscriptions(): void {
    if (!summaryUnsubscribe) {
      summaryUnsubscribe = subscribeSummaryEvents((event) => {
        applySummaryEvent(event);
      });
    }
    if (!titleUnsubscribe) {
      titleUnsubscribe = subscribeTitleEvents((event) => {
        applyTitleUpdate(event);
      });
    }
  }

  /**
   * Titles PRD §10.3: an old bootstrap response must not replace a NEWER
   * locally known title. Merge keeps the response row but restores a local
   * title/revision that is strictly newer.
   */
  function mergeConversationTitle(
    row: WorkspaceConversationSummary
  ): WorkspaceConversationSummary {
    const local = conversationsById.value.get(row.conversationId);
    if (!local) return row;
    if (local.titleRevision > row.titleRevision) {
      return { ...row, title: local.title, titleRevision: local.titleRevision };
    }
    return row;
  }

  function mergeGroupTitles(
    groups: readonly WorkspaceGroupSummary[]
  ): WorkspaceGroupSummary[] {
    return groups.map((group) => ({
      ...group,
      conversations: group.conversations.map(mergeConversationTitle),
    }));
  }

  function mergeUnassignedTitles(
    rows: readonly WorkspaceConversationSummary[]
  ): WorkspaceConversationSummary[] {
    return rows.map(mergeConversationTitle);
  }

  /**
   * Apply one redacted summary event to the sidebar projection. Only status
   * metadata is present — no content bodies ever arrive here (PRD §18.3).
   */
  function applySummaryEvent(event: ConversationSummaryEvent): void {
    const existing = conversationsById.value.get(event.conversationId);
    // Titles PRD §10.3: apply a summary-carried title only when versioned
    // at least as new as the stored revision; an unversioned legacy title
    // cannot replace a versioned one (first-seen rows still accept it).
    const storedRevision = existing?.titleRevision ?? 0;
    // B18: a versioned summary marks the row known; a legacy unversioned
    // title initializes only never-known rows (never a cleared-known one).
    if (event.titleRevision !== undefined) {
      titleVersionedKnown.add(event.conversationId);
    }
    const titleIsNewer =
      event.titleRevision === undefined
        ? !titleVersionedKnown.has(event.conversationId)
        : event.titleRevision > storedRevision;
    const mergedTitle = event.title !== undefined && titleIsNewer;
    const updated: WorkspaceConversationSummary = {
      conversationId: event.conversationId,
      workspaceKey: event.workspaceKey ?? existing?.workspaceKey ?? null,
      title: mergedTitle ? (event.title ?? "") : (existing?.title ?? ""),
      titleRevision: mergedTitle
        ? event.titleRevision !== undefined
          ? event.titleRevision
          : storedRevision
        : storedRevision,
      preview: existing?.preview ?? "",
      lastActivityAt: event.lastActivityAt,
      unread: event.unread,
      attention: event.attention,
      runtimeStatus: event.runtimeStatus,
      activeRunId: event.runId ?? null,
    };
    // BUGFIX 2026-11-02: a non-null workspaceKey that is NOT the row's
    // current placement (first sight of an assigned conversation, or a key
    // change) requires the folder set to be rebuilt from the authoritative
    // projection; schedule exactly one debounced refresh.
    const needsGroupingRefresh =
      bootstrapped.value &&
      updated.workspaceKey !== null &&
      (!existing || existing.workspaceKey !== updated.workspaceKey);
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
    if (needsGroupingRefresh) {
      scheduleGroupingRefresh();
    }
  }

  /**
   * Titles design §10.2: revision-guarded title-only update. Ignores older
   * revisions and unknown conversations (never resurrects deleted rows).
   */
  function applyTitleUpdate(event: ChatTitleUpdatedEvent): void {
    const existing = conversationsById.value.get(event.conversationId);
    if (!existing) {
      // B17: an unknown id during bootstrap is buffered and reconciled
      // after install; outside bootstrap it is ignored (never resurrects a
      // deleted row).
      if (bootstrapInFlight) {
        const buffered = pendingTitleEvents.get(event.conversationId);
        if (!buffered || event.titleRevision >= buffered.titleRevision) {
          pendingTitleEvents.set(event.conversationId, event);
        }
      }
      return;
    }
    titleVersionedKnown.add(event.conversationId);
    // r3 G06: the FIRST versioned title initializes the row — a local
    // placeholder (revision 0, empty title) accepts revision 0 as the
    // authoritative seed. After initialization, equal revisions are
    // idempotent duplicates (content never changes) and older are ignored.
    const uninitializedPlaceholder =
      existing.title === "" && existing.titleRevision === 0;
    if (
      !uninitializedPlaceholder &&
      event.titleRevision < existing.titleRevision
    ) {
      return;
    }
    if (
      !uninitializedPlaceholder &&
      event.titleRevision === existing.titleRevision &&
      existing.title !== (event.title ?? "")
    ) {
      // Equal revision, conflicting content: never overwrite (B18).
      return;
    }
    const updated: WorkspaceConversationSummary = {
      ...existing,
      title: event.title ?? "",
      titleRevision: event.titleRevision,
    };
    workspaces.value = workspaces.value.map((group) => ({
      ...group,
      conversations: group.conversations.map((c) =>
        c.conversationId === updated.conversationId ? updated : c
      ),
    }));
    unassigned.value = unassigned.value.map((c) =>
      c.conversationId === updated.conversationId ? updated : c
    );
    rebuildConversationIndex();
  }

  /** Register a locally created conversation before the first summary. */
  function upsertLocalConversation(
    conversation: Omit<WorkspaceConversationSummary, "titleRevision"> & {
      titleRevision?: number;
    }
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
    unassigned.value = [
      { ...conversation, titleRevision: conversation.titleRevision ?? 0 },
      ...unassigned.value,
    ];
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
    // Audit R7-03: track the latest selection so a reload/crash recovery can
    // re-select it; explicit deselection drops the pointer immediately.
    persistSelectedPointer(conversationId);
  }

  /**
   * Audit R7-03: after a reload, restore the previously selected
   * conversation through the ordinary selection coordinator.
   *
   * Returns the restorable id, or null when there is nothing to restore
   * (no pointer) or a selection is already active (deep link, notification
   * entry). Validity is NOT decided against the sidebar projection: the
   * boot-time projection legitimately lags (durable summary rows for turns
   * completed in the previous session materialize via the once-per-process
   * backfill and summary events, not at bootstrap), so the AUTHORITATIVE
   * validator is the selection handshake's runtime snapshot — an
   * unknown/deleted conversation hydrates an empty transcript and never
   * starts a run; `loadSelection` is read-only.
   */
  function consumeRestorableSelectionPointer(): string | null {
    const stored = readSelectedPointer();
    if (!stored || selectedConversationId.value) return null;
    return stored;
  }

  // -----------------------------------------------------------------------
  // Inspector + expansion persistence
  // -----------------------------------------------------------------------
  function toggleInspector(): void {
    inspectorPrefs.value = {
      ...inspectorPrefs.value,
      open: !inspectorPrefs.value.open,
    };
    persistInspector();
  }

  /**
   * Explicit open-state setter used by the app-inspector bridge: route-owned
   * closure (AppCenterRouteHost → onRouteChanged) must clear the chat
   * preference without toggling (chat-first shell design §12.3).
   */
  function setInspectorOpen(open: boolean): void {
    inspectorPrefs.value = { ...inspectorPrefs.value, open };
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

  // R8 P2 (FR-WSP-007): the workspace memory overlay is shell-shared state —
  // the badge entry (center surface) and the Context-inspector entry (app
  // shell adapter bridge) both open THE SAME overlay through this flag, so
  // the dialog binding has a single owner.
  const memoryOverlayOpen = ref(false);

  function openMemoryOverlay(): void {
    memoryOverlayOpen.value = true;
  }

  function setMemoryOverlayOpen(open: boolean): void {
    memoryOverlayOpen.value = open;
  }

  function persistInspector(): void {
    try {
      localStorage.setItem(
        INSPECTOR_PREFS_KEY,
        JSON.stringify(inspectorPrefs.value)
      );
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
    if (titleUnsubscribe) {
      // B16: clear THIS handle — a stale truthy handle must never block
      // re-subscription on the next mount.
      titleUnsubscribe();
      titleUnsubscribe = null;
    }
    // BUGFIX 2026-11-02: drop any pending grouping refresh with the
    // subscription it would have been triggered by.
    if (groupingRefreshTimer !== null) {
      clearTimeout(groupingRefreshTimer);
      groupingRefreshTimer = null;
    }
  }

  /**
   * B23: authenticated data-scope change reset — drop the previous scope's
   * conversation/title state so no old bootstrap response, event, or title
   * can populate the new scope. Safe to call repeatedly.
   */
  function resetForScopeChange(): void {
    bootstrapGeneration += 1; // B23/F11: invalidate in-flight bootstrap work
    activeBootstrapGeneration = null;
    bootstrapInFlight = false;
    teardown();
    workspaces.value = [];
    unassigned.value = [];
    conversationsById.value = new Map();
    titleVersionedKnown.clear();
    pendingTitleEvents.clear();
    bootstrapInFlight = false;
    bootstrapped.value = false;
    bootstrapError.value = null;
    selectedConversationId.value = null;
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
    applyTitleUpdate,
    resetForScopeChange,
    upsertLocalConversation,
    markConversationReadLocally,
    requestedArtifactId,
    requestArtifactPreview,
    selectedConversationId,
    selectedConversation,
    selectionGeneration,
    nextGeneration,
    setSelected,
    consumeRestorableSelectionPointer,
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
    setInspectorOpen,
    setInspectorTab,
    setInspectorWidth,
    memoryOverlayOpen,
    openMemoryOverlay,
    setMemoryOverlayOpen,
    teardown,
  };
});
