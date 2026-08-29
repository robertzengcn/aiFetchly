import { computed, ref, watch, type Ref } from "vue";
import type { WorkspaceSummary } from "@/entityTypes/workspaceTypes";
import { getWorkspace } from "@/views/api/workspace";
import {
  acquireWorkspaceWatch,
  previewWorkspaceAgents,
  releaseWorkspaceWatch,
} from "@/views/api/workspaceWatch";
import { workspaceMemoryApi } from "@/views/api/aiWorkspaceMemory";

/**
 * Shared conversation-workspace state (chat-first shell design §9.1).
 *
 * Extracted from the classic chat (`AiChatV2.vue` workspace tracking) so the
 * classic dock and the new chat center surface consume ONE implementation of
 * badge state, memory counting, setup-card flow, filesystem-watch lifecycle,
 * and the AGENTS.md trust card.
 *
 * Contract rules (design §9.1):
 * - Conversation ID changes are a request-generation boundary; stale
 *   workspace responses are rejected.
 * - Filesystem watching stays scoped to the current APPROVED workspace and is
 *   released on conversation change or disposal.
 * - The renderer never touches the filesystem or database directly — every
 *   capability flows through the existing preload API wrappers.
 */
export interface ConversationWorkspaceState {
  /** Resolved workspace for the active conversation; null when unassigned. */
  readonly workspace: Readonly<Ref<WorkspaceSummary | null>>;
  readonly loading: Readonly<Ref<boolean>>;
  readonly errorMessage: Readonly<Ref<string | null>>;
  /** Whether the pick-a-folder card should render for this conversation. */
  readonly setupOpen: Readonly<Ref<boolean>>;
  readonly memoryCount: Readonly<Ref<number>>;
  /** AGENTS.md trust card mount gate (approved + watching + has content). */
  readonly trustCardVisible: Readonly<Ref<boolean>>;
  /** Watch token for the approved workspace (slash-config filter key). */
  readonly watchId: Readonly<Ref<string | null>>;
  refresh(): Promise<void>;
  refreshMemoryCount(): Promise<void>;
  requestSetup(): void;
  closeSetup(): void;
  /**
   * Adopt a workspace the main process just created + approved (the
   * WorkspaceRequiredCard flow) without a re-fetch.
   */
  applyApprovedWorkspace(workspaceId: number, rootPath: string): void;
  /** Trust-card handlers — dismiss the card for this session. */
  trustAccepted(): void;
  trustDismissed(): void;
  dispose(): Promise<void>;
}

export function useConversationWorkspace(
  conversationId: Readonly<Ref<string | null>>
): ConversationWorkspaceState {
  const workspace = ref<WorkspaceSummary | null>(null);
  const loading = ref(false);
  const errorMessage = ref<string | null>(null);
  const setupOpen = ref(false);
  const memoryCount = ref(0);

  const watchId = ref<string | null>(null);
  /** Conversation the active watch belongs to — releases must target it even
   * after the active conversation changed (classic-chat parity fix). */
  let watchedConversationId: string | null = null;
  const workspaceHasAgents = ref(false);
  /** Per-session dismissals — the card must not reappear until remount. */
  const dismissedTrustWatchIds = ref<ReadonlySet<string>>(new Set());

  const trustCardVisible = computed(() => {
    const wid = watchId.value;
    if (!wid) return false;
    if (!workspace.value) return false;
    if (workspace.value.approvalState !== "approved") return false;
    if (!workspaceHasAgents.value) return false;
    if (dismissedTrustWatchIds.value.has(wid)) return false;
    return true;
  });

  /** Monotonic refresh generation — stale responses are dropped. */
  let refreshGeneration = 0;

  async function refreshMemoryCount(): Promise<void> {
    const id = conversationId.value;
    if (
      !id ||
      !workspace.value ||
      workspace.value.approvalState !== "approved"
    ) {
      memoryCount.value = 0;
      return;
    }
    try {
      // One IPC + DB round-trip: fetch up to 200 active memories and use the
      // returned length as the badge count (beyond that the exact number does
      // not matter to the user).
      const resp = await workspaceMemoryApi.list({
        conversationId: id,
        status: "active",
        limit: 200,
      });
      memoryCount.value =
        resp.status && Array.isArray(resp.data) ? resp.data.length : 0;
    } catch {
      memoryCount.value = 0;
    }
  }

  /** Fetch the workspace (if any) for the active conversation (design §9.1). */
  async function refresh(): Promise<void> {
    const id = conversationId.value;
    const generation = ++refreshGeneration;
    if (!id) {
      workspace.value = null;
      setupOpen.value = false;
      errorMessage.value = null;
      loading.value = false;
      void refreshMemoryCount();
      return;
    }
    loading.value = true;
    errorMessage.value = null;
    try {
      const ws = await getWorkspace(id);
      if (generation !== refreshGeneration) return; // stale response
      workspace.value = ws
        ? {
            id: ws.id,
            conversationId: ws.conversationId,
            rootPath: ws.rootPath,
            label: ws.label,
            approvalState: ws.approvalState,
          }
        : null;
      // Keep an in-flight setup card open only while no workspace resolved.
      if (ws) setupOpen.value = false;
    } catch (err) {
      if (generation !== refreshGeneration) return; // stale response
      // Non-fatal: fall back to the last known safe summary and surface an
      // inline retry state without broadening tool permissions (design §9.3).
      errorMessage.value =
        err instanceof Error ? err.message : "Failed to load workspace";
    } finally {
      if (generation === refreshGeneration) {
        loading.value = false;
      }
    }
    void refreshMemoryCount();
  }

  function requestSetup(): void {
    // Allow re-picking even when a workspace is already set — re-picking
    // creates a new pending workspace that supersedes the previous one once
    // approved (WorkspaceModule.setWorkspace). The CALLER ensures a
    // conversation id exists first.
    setupOpen.value = true;
  }

  function closeSetup(): void {
    setupOpen.value = false;
  }

  function applyApprovedWorkspace(workspaceId: number, rootPath: string): void {
    workspace.value = {
      id: workspaceId,
      conversationId: conversationId.value ?? "",
      rootPath,
      label: null,
      approvalState: "approved",
    };
    setupOpen.value = false;
  }

  async function acquireWatch(id: string): Promise<void> {
    // Release any previous watch first (covers workspace switch).
    await releaseWatch();
    workspaceHasAgents.value = false;
    try {
      const result = await acquireWorkspaceWatch({ conversationId: id });
      if (!result) {
        // No approved workspace / resolver miss — fail closed, no watch.
        watchId.value = null;
        return;
      }
      watchId.value = result.workspaceId;
      watchedConversationId = id;
      // Probe for AGENTS.md content via the preview channel — the renderer
      // NEVER touches the filesystem (TRS-07).
      try {
        const content = await previewWorkspaceAgents(result.workspaceId);
        workspaceHasAgents.value = content.length > 0;
      } catch {
        workspaceHasAgents.value = false;
      }
    } catch (err) {
      // Non-fatal: chat still works without live workspace updates.
      console.error(
        "[useConversationWorkspace] acquireWorkspaceWatch failed (non-fatal):",
        err
      );
      watchId.value = null;
    }
  }

  async function releaseWatch(): Promise<void> {
    const wid = watchId.value;
    const id = watchedConversationId;
    watchId.value = null;
    watchedConversationId = null;
    if (!wid || !id) return;
    try {
      await releaseWorkspaceWatch({ conversationId: id, workspaceId: wid });
    } catch (err) {
      // Non-fatal: main GCs the consumer when no other consumers remain.
      console.error(
        "[useConversationWorkspace] releaseWorkspaceWatch failed (non-fatal):",
        err
      );
    }
  }

  function dismissTrustCard(): void {
    const wid = watchId.value;
    if (!wid) return;
    dismissedTrustWatchIds.value = new Set([
      ...dismissedTrustWatchIds.value,
      wid,
    ]);
  }

  function trustAccepted(): void {
    dismissTrustCard();
  }

  function trustDismissed(): void {
    dismissTrustCard();
  }

  async function dispose(): Promise<void> {
    await releaseWatch();
    workspaceHasAgents.value = false;
  }

  // Conversation changes release the previous watch and refresh the badge.
  watch(conversationId, () => {
    void dispose().finally(() => {
      void refresh();
    });
  });

  // Workspace material changes (switch / approval flip) re-acquire the watch.
  watch(workspace, (next, prev) => {
    const prevKey = prev ? `${prev.id}:${prev.approvalState}` : "null";
    const nextKey = next ? `${next.id}:${next.approvalState}` : "null";
    if (prevKey === nextKey) return;
    if (!next || next.approvalState !== "approved") {
      void releaseWatch();
      return;
    }
    const id = conversationId.value;
    if (!id) return;
    void acquireWatch(id);
  });

  return {
    workspace,
    loading,
    errorMessage,
    setupOpen,
    memoryCount,
    trustCardVisible,
    watchId,
    refresh,
    refreshMemoryCount,
    requestSetup,
    closeSetup,
    applyApprovedWorkspace,
    trustAccepted,
    trustDismissed,
    dispose,
  };
}
