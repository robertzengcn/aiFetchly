<template>
  <div class="ai-provider-panel">
    <p class="text-body-2 text-grey-darken-1 mb-4">
      {{ t('aiProvider.description') || 'Custom providers can power AI Chat with your own model. Hosted aiFetchly AI features still require a subscription.' }}
    </p>

    <v-radio-group v-model="mode" inline density="compact" class="mb-2">
      <v-radio :label="t('aiProvider.mode_hosted') || 'Hosted aiFetchly'" value="hosted" />
      <v-radio :label="t('aiProvider.mode_local') || 'Custom / Local Provider'" value="local" />
    </v-radio-group>

    <v-alert
      v-if="mode === 'hosted'"
      type="info"
      variant="tonal"
      density="comfortable"
      class="mb-4"
    >
      <span v-if="hostedEnabled">
        {{ t('aiProvider.hosted_enabled') || 'Hosted aiFetchly AI is enabled for your account.' }}
      </span>
      <span v-else>
        {{ t('aiProvider.hosted_requires_subscription') || 'Hosted aiFetchly AI requires a subscription.' }}
      </span>
    </v-alert>

    <div v-if="mode === 'local'">
      <v-row dense>
        <v-col cols="12" sm="6">
          <v-select
            v-model="preset"
            :items="presetItems"
            item-value="preset"
            item-title="displayName"
            :label="t('aiProvider.preset') || 'Provider preset'"
            density="compact"
            variant="outlined"
            @update:model-value="onPresetChange"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-text-field
            v-model="name"
            :label="t('aiProvider.name') || 'Provider name'"
            density="compact"
            variant="outlined"
          />
        </v-col>
      </v-row>

      <v-text-field
        v-model="baseUrl"
        :label="t('aiProvider.base_url') || 'Base URL'"
        density="compact"
        variant="outlined"
        class="mb-2"
        :placeholder="t('aiProvider.base_url_placeholder') || 'http://localhost:11434/v1'"
      />

      <v-text-field
        v-model="apiKey"
        :label="t('aiProvider.api_key') || 'API key (optional)'"
        :type="showApiKey ? 'text' : 'password'"
        density="compact"
        variant="outlined"
        class="mb-1"
        :placeholder="apiKeyConfigured ? (t('aiProvider.api_key_configured') || 'API key configured — leave blank to keep') : ''"
        :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
        @click:append-inner="showApiKey = !showApiKey"
      />
      <div class="d-flex align-center mb-3">
        <v-chip
          v-if="apiKeyConfigured"
          color="success"
          size="x-small"
          variant="tonal"
          class="mr-2"
        >
          {{ t('aiProvider.api_key_configured') || 'API key configured' }}
        </v-chip>
        <v-btn
          variant="text"
          size="small"
          color="error"
          :disabled="!apiKeyConfigured"
          @click="onClearApiKey"
        >
          {{ t('aiProvider.clear_api_key') || 'Clear API key' }}
        </v-btn>
      </div>

      <v-row dense>
        <v-col cols="12" sm="8">
          <v-combobox
            v-model="defaultModel"
            :items="modelItems"
            item-value="id"
            item-title="id"
            :label="t('aiProvider.default_model') || 'Default model'"
            density="compact"
            variant="outlined"
            :return-object="false"
          />
        </v-col>
        <v-col cols="12" sm="4">
          <v-text-field
            v-model.number="contextSize"
            type="number"
            :label="t('aiProvider.context_size') || 'Context size (optional)'"
            density="compact"
            variant="outlined"
          />
        </v-col>
      </v-row>

      <div class="d-flex flex-wrap gap-2 mb-4">
        <v-btn
          variant="outlined"
          color="primary"
          :loading="refreshing"
          @click="onRefreshModels"
        >
          <v-icon start>mdi-refresh</v-icon>
          {{ t('aiProvider.refresh_models') || 'Refresh Models' }}
        </v-btn>
        <v-btn
          variant="outlined"
          color="secondary"
          :loading="testing"
          @click="onTestConnection"
        >
          <v-icon start>mdi-connection</v-icon>
          {{ t('aiProvider.test_connection') || 'Test Connection' }}
        </v-btn>
        <v-btn
          variant="flat"
          color="primary"
          :loading="saving"
          @click="onSave"
        >
          <v-icon start>mdi-content-save</v-icon>
          {{ t('aiProvider.save') || 'Save' }}
        </v-btn>
      </div>

      <AIProviderCapabilityBadges :capabilities="capabilities" />
    </div>

    <v-alert
      v-if="message"
      :type="message.type"
      variant="tonal"
      density="comfortable"
      class="mt-3"
      closable
      @click:close="message = null"
    >
      {{ message.text }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import AIProviderCapabilityBadges from "./AIProviderCapabilityBadges.vue";
import { AI_PROVIDER_PRESETS } from "@/service/aiProvider/AIProviderPresets";
import type {
  AIProviderMode,
  LocalAIProviderCapabilities,
  LocalAIProviderConfigInput,
  LocalAIProviderPreset,
} from "@/entityTypes/aiProviderTypes";
import {
  getAIProviderSettings,
  saveAIProviderSettings,
  refreshLocalAIModels,
  testLocalAIProvider,
  clearLocalAIProviderApiKey,
} from "@/views/api/aiProvider";

const { t } = useI18n();

type MessageType = "success" | "error" | "warning" | "info";
interface UIMessage {
  type: MessageType;
  text: string;
}

const mode = ref<AIProviderMode>("hosted");
const hostedEnabled = ref(false);
const preset = ref<LocalAIProviderPreset>("ollama");
const name = ref("");
const baseUrl = ref("");
const apiKey = ref("");
const apiKeyConfigured = ref(false);
const showApiKey = ref(false);
const defaultModel = ref("");
const contextSize = ref<number | null>(null);
const capabilities = ref<LocalAIProviderCapabilities | null>(null);

const refreshing = ref(false);
const testing = ref(false);
const saving = ref(false);
const message = ref<UIMessage | null>(null);

const presetItems = AI_PROVIDER_PRESETS;
const modelItems = ref<string[]>([]);

function buildInput(): LocalAIProviderConfigInput {
  // Construct immutably — LocalAIProviderConfigInput fields are readonly.
  return {
    preset: preset.value,
    name: name.value,
    baseUrl: baseUrl.value,
    defaultModel: defaultModel.value,
    ...(apiKey.value.trim().length > 0
      ? { apiKey: apiKey.value.trim() }
      : {}),
    ...(typeof contextSize.value === "number" && contextSize.value > 0
      ? { contextSize: contextSize.value }
      : {}),
  };
}

function onPresetChange(value: LocalAIProviderPreset): void {
  const def = AI_PROVIDER_PRESETS.find((p) => p.preset === value);
  if (!def) return;
  if (!name.value) name.value = def.defaultName;
  if (!baseUrl.value) baseUrl.value = def.defaultBaseUrl;
}

async function loadSettings(): Promise<void> {
  try {
    const view = await getAIProviderSettings();
    mode.value = view.mode;
    hostedEnabled.value = view.hostedAIEnabled;
    if (view.localProvider) {
      const cfg = view.localProvider;
      preset.value = cfg.preset;
      name.value = cfg.name;
      baseUrl.value = cfg.baseUrl;
      defaultModel.value = cfg.defaultModel;
      contextSize.value = typeof cfg.contextSize === "number" ? cfg.contextSize : null;
      apiKeyConfigured.value = !!cfg.apiKeyConfigured;
      // Never hydrate the plaintext API key from storage.
      apiKey.value = "";
      capabilities.value = cfg.capabilities ?? null;
    }
  } catch (err) {
    message.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  }
}

async function onRefreshModels(): Promise<void> {
  refreshing.value = true;
  message.value = null;
  try {
    const res = await refreshLocalAIModels({ provider: buildInput() });
    modelItems.value = res.models.map((m) => m.id);
    if (res.default_model && !defaultModel.value) {
      defaultModel.value = res.default_model;
    }
    message.value = {
      type: res.warning ? "warning" : "success",
      text:
        res.warning ??
        (t("aiProvider.models_loaded") || "Model list loaded."),
    };
  } catch (err) {
    message.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  } finally {
    refreshing.value = false;
  }
}

async function onTestConnection(): Promise<void> {
  testing.value = true;
  message.value = null;
  try {
    const result = await testLocalAIProvider({ provider: buildInput() });
    capabilities.value = result.capabilities;
    const tone: MessageType =
      result.status === "passed"
        ? "success"
        : result.status === "partial"
          ? "warning"
          : "error";
    message.value = { type: tone, text: result.message };
  } catch (err) {
    message.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  } finally {
    testing.value = false;
  }
}

async function onSave(): Promise<void> {
  saving.value = true;
  message.value = null;
  try {
    const view = await saveAIProviderSettings({
      mode: mode.value,
      ...(mode.value === "local" ? { localProvider: buildInput() } : {}),
    });
    hostedEnabled.value = view.hostedAIEnabled;
    if (view.localProvider) {
      apiKeyConfigured.value = !!view.localProvider.apiKeyConfigured;
      baseUrl.value = view.localProvider.baseUrl;
      apiKey.value = ""; // clear the transient field after save
    }
    message.value = {
      type: "success",
      text:
        mode.value === "local"
          ? t("aiProvider.saved_local") ||
            "Local AI provider saved. AI Chat can now use your configured model."
          : t("aiProvider.saved_hosted") || "Hosted AI provider saved.",
    };
  } catch (err) {
    message.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  } finally {
    saving.value = false;
  }
}

async function onClearApiKey(): Promise<void> {
  try {
    const view = await clearLocalAIProviderApiKey();
    apiKeyConfigured.value = !!view.localProvider?.apiKeyConfigured;
    apiKey.value = "";
    message.value = {
      type: "success",
      text: t("aiProvider.api_key_cleared") || "API key cleared.",
    };
  } catch (err) {
    message.value = {
      type: "error",
      text: err instanceof Error ? err.message : String(err),
    };
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<style scoped>
.ai-provider-panel {
  max-width: 760px;
}
.gap-2 {
  gap: 8px;
}
</style>
