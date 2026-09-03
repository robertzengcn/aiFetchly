<template>
  <AppPageShell
    page-id="settings-ai-provider"
    title-key="route.ai_provider"
    content-width="wide"
  >
    <template #context>
      <button
        type="button"
        class="back-link"
        data-testid="settings-ai-provider-back"
        @click="goBack"
      >
        <v-icon icon="mdi-arrow-left" size="14" aria-hidden="true" />
        {{ t("route.system_setting") }}
      </button>
    </template>
    <AIProviderSettingsPanel />
    <v-divider class="my-4"></v-divider>
    <div class="ai-chat-reasoning-settings">
      <h3 class="text-subtitle-1 font-weight-bold mb-1">
        {{ t("aiProvider.reasoning_settings_title") || "Reasoning" }}
      </h3>
      <p class="text-body-2 text-grey-darken-1 mb-2">
        {{
          t("aiProvider.reasoning_settings_description") ||
          "Control whether AI Chat shows the model reasoning process."
        }}
      </p>
      <v-switch
        v-model="showReasoningProcess"
        color="primary"
        hide-details
        density="compact"
        :label="
          t('aiProvider.show_reasoning_process') ||
          'Show reasoning process'
        "
        @update:model-value="onReasoningVisibilityChange"
      />
    </div>
    <v-divider class="my-4"></v-divider>
    <AiChatVoiceSettingsPanel />
    <v-divider class="my-4"></v-divider>
    <LocalAiComponentsPanel />
  </AppPageShell>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { ref } from "vue";
import AIProviderSettingsPanel from "@/views/components/settings/AIProviderSettingsPanel.vue";
import AiChatVoiceSettingsPanel from "@/views/components/settings/AiChatVoiceSettingsPanel.vue";
import LocalAiComponentsPanel from "@/views/components/settings/LocalAiComponentsPanel.vue";
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import {
  readAiChatReasoningVisible,
  writeAiChatReasoningVisible,
} from "@/views/utils/aiChatReasoningPreference";

const { t } = useI18n();
const router = useRouter();
const showReasoningProcess = ref<boolean>(readAiChatReasoningVisible());

function goBack(): void {
  router.push({ name: "system_setting_index" });
}

function onReasoningVisibilityChange(value: boolean | null): void {
  const visible = value === true;
  showReasoningProcess.value = visible;
  writeAiChatReasoningVisible(visible);
}
</script>

<style scoped></style>
