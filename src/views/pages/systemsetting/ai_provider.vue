<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t('aiProvider.title') || 'AI Provider' }}</span>
        <v-btn icon size="small" variant="text" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text>
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
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { ref } from "vue";
import AIProviderSettingsPanel from "@/views/components/settings/AIProviderSettingsPanel.vue";
import AiChatVoiceSettingsPanel from "@/views/components/settings/AiChatVoiceSettingsPanel.vue";
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
