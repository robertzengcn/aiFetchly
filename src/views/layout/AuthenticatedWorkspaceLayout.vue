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
        :redesign-default="redesignDefault"
        @select="(id) => void openConversation(id)"
        @new-chat="() => void createChat()"
        @retry="() => void chatWorkspace.bootstrap()"
        @toggle-mode="onToggleMode"
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
  </AppWorkspaceShell>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";
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
  isWorkspaceRedesignEnabled,
  setWorkspaceRedesignEnabled,
} from "@/views/api/aiChatWorkspace";
import {
  emitShellDiagnostic,
  trackShellMounted,
  trackShellUnmounted,
} from "@/views/utils/shellDiagnostics";

const router = useRouter();
const { t } = useI18n();
const shell = useAppShellStore();
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

/** Rollout flag state (workspace redesign PRD §33) — footer mode toggle. */
const redesignDefault = ref(false);

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

async function createChat(): Promise<string> {
  await ensureChatRoute();
  return createAndSelectWorkspaceChat();
}

/**
 * Route to the chat center unconditionally. During a pending lazy navigation
 * (e.g. Plugins was clicked and its chunk is still loading) the reactive
 * route still names the PREVIOUS route, so an "already there?" check would
 * skip the push and strand the user on the departing page (FR-SHELL-010).
 * vue-router resolves same-location pushes as a harmless duplicated
 * navigation failure instead of throwing.
 */
async function ensureChatRoute(): Promise<void> {
  await router.push({ name: "AI_Chat_Workspace" });
}

provide(CHAT_WORKSPACE_SELECTION_KEY, { openConversation, createChat });

/** Rollback path: switching to classic re-shows the dock after navigation. */
async function onToggleMode(): Promise<void> {
  const next = !redesignDefault.value;
  try {
    await setWorkspaceRedesignEnabled(next);
    redesignDefault.value = next;
  } catch {
    // Flag write failed — mode stays unchanged.
  }
  if (!next) {
    void router.push("/dashboard/home");
  }
}

onMounted(() => {
  emitShellDiagnostic({ type: "shell.mounted", duplicateCount: trackShellMounted().duplicates });
  // Application-scoped bootstrap: exactly one summary subscription for the
  // authenticated lifetime (design §8.3), torn down only when the
  // authenticated application unmounts — never on center-route changes.
  void chatWorkspace.bootstrap();
  void isWorkspaceRedesignEnabled()
    .then((enabled) => {
      redesignDefault.value = enabled;
    })
    .catch(() => {
      redesignDefault.value = false;
    });
});

onUnmounted(() => {
  trackShellUnmounted();
  chatWorkspace.teardown();
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
