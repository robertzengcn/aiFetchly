<template>
  <!--
    Chat inspector adapter (chat-first shell design §12.2): maps the typed
    AppInspectorTarget + shell geometry onto the existing chat inspector
    surface. AppInspectorHost remains the ONLY global mount point — the
    adapter owns no state of its own beyond the store bridge.
  -->
  <AiChatInspector
    :active-tab="chatWorkspace.inspectorTab"
    :width="chatWorkspace.inspectorWidth"
    :overlay="shell.mode !== 'wide'"
    :conversation-id="conversationId"
    :messages="[...selected.messages]"
    @update:tab="chatWorkspace.setInspectorTab"
    @update:width="chatWorkspace.setInspectorWidth"
    @compact="onCompact"
    @open-memory="onOpenMemory"
    @close="onClose"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import AiChatInspector from "@/views/components/aiChatWorkspace/AiChatInspector.vue";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { useAppShellStore } from "@/views/store/appShell";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { startCompaction } from "@/views/api/aiChatV2";

const inspector = useAppInspectorStore();
const shell = useAppShellStore();
const chatWorkspace = useChatWorkspaceStore();
const selected = useSelectedConversationStore();

const conversationId = computed<string | null>(() => {
  const target = inspector.target;
  if (!target || target.kind !== "chat") return null;
  return target.conversationId;
});

async function onCompact(): Promise<void> {
  if (!conversationId.value) return;
  try {
    // B05/G02 repair: the legacy ai-chat-v2:compact-conversation channel has
    // NO main-process handler/allowlist (removed by the §13.1 "START-only"
    // contract) — route the action through the bounded incremental
    // coordinator (compaction-start, §13.1).
    await startCompaction(conversationId.value);
  } catch {
    // Non-fatal — the activity tab still shows run progress.
  }
}

function onClose(): void {
  chatWorkspace.setInspectorOpen(false);
  inspector.close();
}

/** R8 P2 (FR-WSP-007): the Context-inspector memory entry opens the same
 * shared overlay the workspace badge entry opens (single store owner). */
function onOpenMemory(): void {
  chatWorkspace.openMemoryOverlay();
}
</script>
