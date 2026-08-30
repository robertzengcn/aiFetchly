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
    <AppCenterRouteHost />
  </AppWorkspaceShell>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppWorkspaceShell from "@/views/components/appShell/AppWorkspaceShell.vue";
import AppCenterRouteHost from "@/views/components/appShell/AppCenterRouteHost.vue";
import AiChatWorkspaceSidebar from "@/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue";
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

const route = useRoute();
const router = useRouter();
const chatWorkspace = useChatWorkspaceStore();
const selectedStore = useSelectedConversationStore();

/** Rollout flag state (workspace redesign PRD §33) — footer mode toggle. */
const redesignDefault = ref(false);

/**
 * Conversation-selection coordinator (design §8.4): routing FIRST when an
 * inner page is open, then the selection handshake only when the selection
 * actually changed. Switching conversations never cancels the previously
 * selected conversation's main-process run.
 */
async function openConversation(conversationId: string): Promise<void> {
  if (route.name !== "AI_Chat_Workspace") {
    await router.push({ name: "AI_Chat_Workspace" });
  }
  if (chatWorkspace.selectedConversationId !== conversationId) {
    await selectedStore.loadSelection(conversationId);
  }
}

async function createChat(): Promise<string> {
  if (route.name !== "AI_Chat_Workspace") {
    await router.push({ name: "AI_Chat_Workspace" });
  }
  return createAndSelectWorkspaceChat();
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
  chatWorkspace.teardown();
});
</script>
