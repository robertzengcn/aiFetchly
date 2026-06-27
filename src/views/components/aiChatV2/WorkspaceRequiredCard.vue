<template>
  <v-card class="workspace-required-card" elevation="2" rounded border>
    <v-card-item>
      <div class="workspace-required-card__header">
        <v-icon size="small" color="primary">mdi-folder-plus-outline</v-icon>
        <span class="text-subtitle-1 font-weight-bold">{{ titleText }}</span>
      </div>
    </v-card-item>

    <v-card-text>
      <p class="text-body-2">{{ bodyText }}</p>
      <p v-if="errorText" class="text-error text-body-2 mt-2">
        <v-icon size="small" start>mdi-alert-circle-outline</v-icon>
        {{ errorText }}
      </p>
    </v-card-text>

    <v-card-actions class="workspace-required-card__actions">
      <v-spacer />
      <v-btn variant="text" :disabled="loading" @click="onCancel">
        {{ cancelText }}
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="loading"
        @click="onPick"
      >
        <v-icon start size="small">mdi-folder-open</v-icon>
        {{ pickText }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  setWorkspace,
  approveWorkspace,
  pickFolder,
} from "@/views/api/workspace";
import type { WorkspaceRecord } from "@/entityTypes/workspaceTypes";

const props = defineProps<{
  conversationId: string;
}>();

const emit = defineEmits<{
  (e: "approved", workspaceId: number, rootPath: string): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

const loading = ref(false);
const errorText = ref<string | null>(null);

const titleText = t("workspace.required.title") || "Choose a workspace folder";
const bodyText =
  t("workspace.required.body") ||
  "Pick a folder where AI file tools can read and write.";
const cancelText = t("workspace.required.cancel") || "Cancel";
const pickText = t("workspace.required.pick") || "Pick folder";

function onCancel(): void {
  emit("cancel");
}

async function onPick(): Promise<void> {
  errorText.value = null;
  loading.value = true;
  try {
    const folder = await pickFolder();
    if (!folder) {
      // User cancelled the OS dialog - no error, just bail.
      return;
    }
    const created = await setWorkspace({
      conversationId: props.conversationId,
      rootPath: folder,
    });
    if (!created) {
      errorText.value = "Failed to create workspace.";
      return;
    }
    const approved = await approveWorkspace(created.id);
    if (!approved) {
      errorText.value = "Failed to approve workspace.";
      return;
    }
    emit("approved", approved.id, approved.rootPath);
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.workspace-required-card {
  width: 100%;
}
.workspace-required-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.workspace-required-card__actions {
  padding: 8px 16px;
}
</style>
