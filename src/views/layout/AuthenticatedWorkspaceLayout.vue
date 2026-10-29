<template>
  <!--
    Persistent authenticated shell composition (chat-first shell design §7.2).
    Exactly one AppWorkspaceShell: the workspace sidebar in the navigation
    slot, the center route host in the center, and the single typed inspector
    host owned by the shell. The summary subscription is bootstrapped once
    per authenticated application — center-route changes never re-run it.
  -->
  <AppWorkspaceShell>
    <template #navigation>
      <AiChatWorkspaceSidebar
        @select="(id) => void openConversation(id)"
        @new-chat="() => void createChat()"
        @retry="() => void chatWorkspace.bootstrap()"
      />
    </template>
    <!-- Narrow mode needs a visible menu action (PRD §16.3): the sidebar
         becomes an opt-in drawer owned by the shell. -->
    <button
      v-if="shell.mode === 'narrow'"
      type="button"
      class="layout-nav-toggle"
      data-testid="app-shell-nav-toggle"
      :aria-label="t('workspaceChat.sidebar.region') || 'Chat workspaces'"
      @click="shell.toggleNavigation()"
    >
      <v-icon icon="mdi-menu" size="20" aria-hidden="true" />
    </button>
    <AppCenterRouteHost />
    <!-- System-message toasts (ported host from the legacy layout). -->
    <v-snackbar
      :model-value="systemNotice !== null"
      :timeout="4000"
      location="bottom right"
      @update:model-value="systemNotice = null"
    >
      {{ systemNotice }}
    </v-snackbar>
  </AppWorkspaceShell>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from "vue";
import { initializeSavedFontScale } from "@/views/utils/initializeFontScale";
import { useRouter } from "vue-router";
import { enqueueRoutePush } from "@/views/utils/enqueueRoutePush";
import { useI18n } from "vue-i18n";
import AppWorkspaceShell from "@/views/components/appShell/AppWorkspaceShell.vue";
import AppCenterRouteHost from "@/views/components/appShell/AppCenterRouteHost.vue";
import AiChatWorkspaceSidebar from "@/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue";
import { useAppShellStore } from "@/views/store/appShell";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import {
  CHAT_WORKSPACE_SELECTION_KEY,
  createAndSelectWorkspaceChat,
} from "@/views/composables/chatWorkspaceSelection";
import {
  fetchWorkspaceRedesignPreference,
  setWorkspaceRedesignEnabled,
} from "@/views/api/aiChatWorkspace";
import {
  emitShellDiagnostic,
  trackShellMounted,
  trackShellUnmounted,
} from "@/views/utils/shellDiagnostics";
import { useInnerPageShellFlag } from "@/views/composables/useInnerPageShellFlag";
import { getIpcTransport } from "@/views/utils/ipcTransport";
import {
  AI_CHAT_V2_OPEN_FROM_NOTIFY,
  SYSTEM_MESSAGE,
} from "@/config/channellist";
import { windowReceive, windowRemoveListener } from "@/views/utils/apirequest";
import type { CommonDialogMsg } from "@/entityTypes/commonType";

const router = useRouter();
const { t } = useI18n();
const shell = useAppShellStore();
const innerPageShell = useInnerPageShellFlag();
const chatWorkspace = useChatWorkspaceStore();
const selectedStore = useSelectedConversationStore();

// Structured, content-free diagnostics (design §22): shell mount counting
// doubles as duplicate-shell detection in development.
watch(
  () => [shell.mode, shell.navigationOpen] as const,
  ([mode, open]) => {
    emitShellDiagnostic({
      type: "shell.navigation_overlay_changed",
      mode,
      open,
    });
  }
);

/**
 * Conversation-selection coordinator (design §8.4): routing FIRST when an
 * inner page is open, then the selection handshake only when the selection
 * actually changed. Switching conversations never cancels the previously
 * selected conversation's main-process run.
 */
async function openConversation(conversationId: string): Promise<void> {
  await ensureChatRoute();
  if (chatWorkspace.selectedConversationId !== conversationId) {
    await selectedStore.loadSelection(conversationId);
  }
}

/**
 * Audit R7-03: reload/crash restore. After the sidebar projection loads,
 * re-select the persisted selected conversation through the ordinary
 * coordinator — the selection handshake hydrates persisted content and
 * re-attaches detail subscriptions for any live run WITHOUT starting a
 * duplicate run. Deleted/unavailable selections are dropped by the store;
 * a restore failure is non-fatal (the shell still opens at the chat).
 */
async function restoreWorkspaceSession(): Promise<void> {
  await chatWorkspace.bootstrap();
  const restorable = chatWorkspace.consumeRestorableSelectionPointer();
  if (!restorable) return;
  try {
    await openConversation(restorable);
  } catch {
    // Best-effort restore — selection state stays unset on failure.
  }
}

async function createChat(): Promise<string> {
  await ensureChatRoute();
  return createAndSelectWorkspaceChat();
}

/**
 * Route to the chat center unconditionally. A same-route push does not
 * cancel an in-flight lazy navigation (Plugins' chunk can still be loading
 * while the committed route is still chat), so the push is queued behind
 * whatever the sidebar already started (FR-SHELL-010).
 */
async function ensureChatRoute(): Promise<void> {
  await enqueueRoutePush(router, { name: "AI_Chat_Workspace" });
}

provide(CHAT_WORKSPACE_SELECTION_KEY, { openConversation, createChat });

// --- Application-level chat integrations (ported from the legacy layout) ----
// The classic layout.vue was the only listener for the dashboard "ask AI"
// entry, desktop-notification chat clicks, and system-message toasts. The
// persistent shell owns them now (review: lost-integration fix).

const systemNotice = ref<string | null>(null);
let systemNoticeTimer: ReturnType<typeof setTimeout> | null = null;

function showSystemNotice(text: string): void {
  systemNotice.value = text;
  if (systemNoticeTimer !== null) clearTimeout(systemNoticeTimer);
  systemNoticeTimer = setTimeout(() => {
    systemNotice.value = null;
  }, 4_000);
}

function openAiChatFromDashboard(event: Event): void {
  const detail = (event as CustomEvent<{ prompt?: string }>).detail;
  const text = detail?.prompt?.trim();
  if (!text) return;
  void enqueueRoutePush(router, {
    path: "/aiworkspace",
    query: { prompt: text },
  });
}

function handleOpenFromNotify(raw: unknown): void {
  const payload =
    raw && typeof raw === "object"
      ? (raw as { conversationId?: string | null })
      : null;
  const conversationId =
    typeof payload?.conversationId === "string"
      ? payload.conversationId.trim()
      : "";
  if (!conversationId) return;
  void openConversation(conversationId);
}

function handleSystemMessage(res: CommonDialogMsg): void {
  if (!res.data) return;
  showSystemNotice(`${t(res.data.title)}: ${t(res.data.content)}`);
}

function onRawSystemMessage(raw: unknown): void {
  if (typeof raw !== "string") return;
  try {
    handleSystemMessage(JSON.parse(raw) as CommonDialogMsg);
  } catch {
    // Malformed system message — ignore.
  }
}

onMounted(() => {
  void initializeSavedFontScale();
  emitShellDiagnostic({ type: "shell.mounted", duplicateCount: trackShellMounted().duplicates });
  window.addEventListener("aifetchly:open-ai-chat", openAiChatFromDashboard);
  getIpcTransport().receive(
    AI_CHAT_V2_OPEN_FROM_NOTIFY,
    handleOpenFromNotify as (value: unknown) => void
  );
  windowReceive(SYSTEM_MESSAGE, onRawSystemMessage);
  // Application-scoped bootstrap: exactly one summary subscription for the
  // authenticated lifetime (design §8.3), torn down only when the
  // authenticated application unmounts — never on center-route changes.
  // Audit R7-03: the bootstrap also drives the reload/crash restore of the
  // persisted selected conversation.
  void restoreWorkspaceSession();
  // The workspace shell is now the only shell (footer toggle removed):
  // land the durable redesign DEFAULT and the boundary flag on mount so the
  // app always lands on the converged shell — but never overwrite an
  // EXPLICIT operator choice (A02, design §30.2): a flag-only rollback
  // (enabled=false) must survive mounting the workspace, so the write only
  // happens while the preference is unset. The in-memory shell boundary
  // flag is renderer-local and stays enforced on every mount.
  void fetchWorkspaceRedesignPreference()
    .then((preference) => {
      if (preference && preference.explicit) return;
      return setWorkspaceRedesignEnabled(true).catch(() => {
        // Preference write failed — the in-memory shell flag below still
        // applies and the unset default already reads enabled.
      });
    })
    .catch(() => {
      // Preference read failed — fall through to the shell flag only.
    });
  innerPageShell.setShellEnabled(true);
});

onUnmounted(() => {
  trackShellUnmounted();
  window.removeEventListener("aifetchly:open-ai-chat", openAiChatFromDashboard);
  getIpcTransport().removeListener(
    AI_CHAT_V2_OPEN_FROM_NOTIFY,
    handleOpenFromNotify as (value: unknown) => void
  );
  windowRemoveListener(SYSTEM_MESSAGE, onRawSystemMessage);
  if (systemNoticeTimer !== null) clearTimeout(systemNoticeTimer);
  chatWorkspace.teardown();
  // Authentication ended (expiry / account switch in the same renderer):
  // clear the selected conversation's buffers and detail subscription so the
  // next account never sees this transcript (review: auth-lifecycle fix).
  selectedStore.teardown();
});
</script>

<style scoped>
/* Narrow drawer opener — positioned against the shell root, which is the
   positioning context in narrow mode (AppWorkspaceShell). */
.layout-nav-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 45;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* PRD §16.4: pointer/touch targets are at least 40x40px. */
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 6px;
  background: var(--app-shell, rgba(255, 255, 255, 0.9));
  color: var(--app-text, inherit);
  cursor: pointer;
}

.layout-nav-toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
}
</style>
