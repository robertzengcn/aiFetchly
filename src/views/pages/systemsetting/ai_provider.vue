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
    <!-- Chat-titles FR-08: master switch + informational model rows. -->
    <div class="ai-chat-titles-settings" data-testid="chat-titles-settings">
      <h3 class="text-subtitle-1 font-weight-bold mb-1">
        {{ t("aiProvider.chatTitles.section") || "Chat titles" }}
      </h3>
      <p class="text-body-2 text-grey-darken-1 mb-2">
        {{ t("aiProvider.chatTitles.description") || "Automatic naming uses a short excerpt of the conversation and may incur a small amount of provider usage." }}
      </p>
      <v-switch
        :model-value="autoChatTitles"
        color="primary"
        hide-details
        density="compact"
        :label="t('aiProvider.chatTitles.autoToggle') || 'Automatically name new chats'"
        data-testid="chat-titles-toggle"
        @update:model-value="onAutoTitlesToggle"
      />
      <p class="text-caption text-grey-darken-1 mt-1">
        {{
          providerMode === "local"
            ? (t("aiProvider.chatTitles.customModelHint") || "Uses your configured provider. Set the title model in the provider form above.")
            : (t("aiProvider.chatTitles.hostedModelHint") || "Hosted mode uses the service's lightweight model.")
        }}
      </p>
    </div>
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
import {
  getAIProviderSettings,
  saveAIProviderSettings,
} from "@/views/api/aiProvider";
import AiChatVoiceSettingsPanel from "@/views/components/settings/AiChatVoiceSettingsPanel.vue";
import LocalAiComponentsPanel from "@/views/components/settings/LocalAiComponentsPanel.vue";
import AppPageShell from "@/views/components/pageTemplates/AppPageShell.vue";
import {
  readAiChatReasoningVisible,
  writeAiChatReasoningVisible,
} from "@/views/utils/aiChatReasoningPreference";

const { t } = useI18n();
const router = useRouter();
const autoChatTitles = ref(true);
const providerMode = ref<"hosted" | "local">("hosted");

// Hydrate once on setup so the switch reflects stored settings.
void getAIProviderSettings()
  .then((view) => {
    autoChatTitles.value = view.autoChatTitlesEnabled;
    providerMode.value = view.mode;
  })
  .catch(() => undefined);

async function onAutoTitlesToggle(value: boolean | null): Promise<void> {
  if (typeof value !== "boolean") return;
  try {
    const view = await saveAIProviderSettings({
      mode: providerMode.value,
      autoChatTitlesEnabled: value,
    });
    autoChatTitles.value = view.autoChatTitlesEnabled;
    providerMode.value = view.mode;
  } catch {
    // Keep the previous toggle state; the next settings load re-syncs.
  }
}

const showReasoningProcess = ref<boolean>(readAiChatReasoningVisible());

function goBack(): void {
  router.push({ name: "system_setting_index" });
}

function onReasoningVisibilityChange(value: boolean | null): void {
  if (typeof value !== "boolean") {
    return;
  }
  showReasoningProcess.value = value;
  writeAiChatReasoningVisible(value);
}
</script>

<style scoped></style>
