<template>
  <div class="ai-voice-panel">
    <h3 class="text-subtitle-1 font-weight-bold mb-1">
      {{ t("aiChatV2.voice.settings_title") || "Voice" }}
    </h3>
    <p class="text-body-2 text-grey-darken-1 mb-4">
      {{
        t("aiChatV2.voice.runtime_unavailable") ||
        "Local speech recognition and spoken responses run on-device."
      }}
    </p>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="comfortable"
      class="mb-4"
    >
      {{ error }}
    </v-alert>

    <div v-if="loading" class="text-body-2 text-grey-darken-1 pa-4">
      <v-progress-circular indeterminate size="20" class="mr-2" />
      {{ t("common.loading") || "Loading…" }}
    </div>

    <div v-else>
      <v-switch
        v-model="voiceInputOn"
        color="primary"
        hide-details
        density="compact"
        class="mb-2"
        :label="t('aiChatV2.voice.enable_input') || 'Enable voice input'"
        @update:model-value="save"
      />
      <v-switch
        v-model="spokenOn"
        color="primary"
        hide-details
        density="compact"
        class="mb-2"
        :label="t('aiChatV2.voice.enable_spoken_responses') || 'Enable spoken responses'"
        @update:model-value="save"
      />
      <v-switch
        v-if="spokenOn"
        v-model="speakAfterVoiceOnly"
        color="primary"
        hide-details
        density="compact"
        class="mb-4"
        :label="t('aiChatV2.voice.speak_after_voice_input') || 'Speak only after voice input'"
        @update:model-value="save"
      />
      <v-switch
        v-model="autoSend"
        color="primary"
        hide-details
        density="compact"
        class="mb-4"
        :label="t('aiChatV2.voice.auto_send') || 'Send voice transcript automatically'"
        @update:model-value="save"
      />

      <v-row dense>
        <v-col cols="12" sm="6">
          <v-select
            v-model="sttLanguage"
            :items="languageItems"
            :label="t('aiChatV2.voice.stt_language') || 'Speech recognition language'"
            density="compact"
            variant="outlined"
            @update:model-value="save"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="ttsLanguage"
            :items="languageItems"
            :label="t('aiChatV2.voice.tts_language') || 'Speech response language'"
            density="compact"
            variant="outlined"
            @update:model-value="save"
          />
        </v-col>
      </v-row>

      <div class="mb-2">
        <span class="text-body-2">
          {{ t("aiChatV2.voice.speech_speed") || "Speech speed" }}: {{ speed.toFixed(1) }}x
        </span>
        <v-slider
          v-model="speed"
          :min="0.5"
          :max="2"
          :step="0.1"
          color="primary"
          hide-details
          @end="save"
        />
      </div>

      <v-text-field
        v-model.number="maxRecordingSeconds"
        type="number"
        :min="1"
        :max="600"
        :label="t('aiChatV2.voice.max_recording_duration') || 'Max recording duration (seconds)'"
        density="compact"
        variant="outlined"
        @update:model-value="save"
      />

      <v-divider class="my-4" />
      <h3 class="text-subtitle-1 font-weight-bold mb-2">Voice Models</h3>
      <div
        v-for="model in models"
        :key="model.id"
        class="d-flex align-center justify-space-between pa-2 mb-2 rounded"
      >
        <div>
          <div class="text-body-2 font-weight-medium">{{ model.name }}</div>
          <div class="text-caption text-grey-darken-1">
            {{
              model.type === "stt" ? "Speech Recognition" : "Text-to-Speech"
            }}
            · ~{{ model.approxSizeMb }}MB
          </div>
          <div
            v-if="downloadProgress[model.id]"
            class="text-caption text-primary"
          >
            {{ downloadProgressText(model.id) }}
          </div>
        </div>
        <div>
          <v-chip
            v-if="model.installed"
            color="success"
            size="small"
            variant="tonal"
          >
            <v-icon start size="small">mdi-check</v-icon>
            Installed
          </v-chip>
          <v-btn
            v-else-if="!downloadProgress[model.id]"
            size="small"
            color="primary"
            variant="tonal"
            @click="onDownload(model.id)"
          >
            <v-icon start size="small">mdi-download</v-icon>
            Download
          </v-btn>
          <v-btn
            v-else
            size="small"
            color="error"
            variant="tonal"
            @click="onCancelDownload(model.id)"
          >
            Cancel
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  getVoiceSettings,
  setVoiceSettings,
  listVoiceModels,
  downloadVoiceModel,
  cancelVoiceModelDownload,
  onVoiceModelDownloadProgress,
} from "@/views/api/aiChatV2Voice";
import type {
  AiChatVoiceSettingsView,
  VoiceModelDownloadProgress,
} from "@/entityTypes/aiChatVoiceTypes";
import type { VoiceModelCatalogEntry } from "@/service/aiChatVoice/VoiceModelCatalogService";

const { t } = useI18n();

const loading = ref(true);
const error = ref<string | null>(null);

const inputMode = ref<"disabled" | "push_to_talk">("disabled");
const ttsMode = ref<"disabled" | "after_voice_input" | "all_assistant_messages">(
  "disabled"
);
const autoSend = ref(false);
const sttLanguage = ref("auto");
const ttsLanguage = ref("auto");
const sttModelId = ref("sherpa-onnx:stt:auto");
const ttsModelId = ref("sherpa-onnx:tts:auto");
const ttsVoiceId = ref<string | undefined>(undefined);
const speed = ref(1);
const maxRecordingMs = ref(60_000);

const voiceInputOn = computed({
  get: () => inputMode.value === "push_to_talk",
  set: (value: boolean) => {
    inputMode.value = value ? "push_to_talk" : "disabled";
  },
});
const spokenOn = computed({
  get: () => ttsMode.value !== "disabled",
  set: (value: boolean) => {
    // Default to "speak only after voice input" when first enabled.
    ttsMode.value = value ? "after_voice_input" : "disabled";
  },
});
const speakAfterVoiceOnly = computed({
  get: () => ttsMode.value === "after_voice_input",
  set: (value: boolean) => {
    ttsMode.value = value ? "after_voice_input" : "all_assistant_messages";
  },
});

const maxRecordingSeconds = computed({
  get: () => Math.round(maxRecordingMs.value / 1000),
  set: (value: number) => {
    const seconds = Number.isFinite(value) ? value : 60;
    maxRecordingMs.value = Math.min(600, Math.max(1, Math.round(seconds))) * 1000;
  },
});

const languageItems = [
  { title: "Auto", value: "auto" },
  { title: "English", value: "en" },
  { title: "中文", value: "zh" },
  { title: "Español", value: "es" },
  { title: "Français", value: "fr" },
  { title: "Deutsch", value: "de" },
  { title: "日本語", value: "ja" },
];

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const s = await getVoiceSettings();
    inputMode.value = s.inputMode;
    ttsMode.value = s.ttsMode;
    autoSend.value = s.autoSendTranscript;
    sttLanguage.value = s.sttLanguage;
    ttsLanguage.value = s.ttsLanguage;
    sttModelId.value = s.sttModelId;
    ttsModelId.value = s.ttsModelId;
    ttsVoiceId.value = s.ttsVoiceId;
    speed.value = s.ttsSpeed;
    maxRecordingMs.value = s.maxRecordingMs;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  error.value = null;
  try {
    const view: AiChatVoiceSettingsView = {
      inputMode: inputMode.value,
      ttsMode: ttsMode.value,
      autoSendTranscript: autoSend.value,
      sttLanguage: sttLanguage.value,
      ttsLanguage: ttsLanguage.value,
      sttModelId: sttModelId.value,
      ttsModelId: ttsModelId.value,
      ttsSpeed: speed.value,
      maxRecordingMs: maxRecordingMs.value,
      ...(ttsVoiceId.value !== undefined
        ? { ttsVoiceId: ttsVoiceId.value }
        : {}),
    };
    const saved = await setVoiceSettings(view);
    // Reflect server-side clamping/normalization.
    speed.value = saved.ttsSpeed;
    maxRecordingMs.value = saved.maxRecordingMs;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

// --- Phase 5: Model catalog + download ---
const models = ref<VoiceModelCatalogEntry[]>([]);
const downloadProgress = ref<
  Record<string, VoiceModelDownloadProgress | undefined>
>({});

function downloadProgressText(modelId: string): string {
  const p = downloadProgress.value[modelId];
  if (!p) return "";
  if (p.phase === "downloading") return `Downloading... ${p.pct ?? 0}%`;
  if (p.phase === "verifying") return "Verifying...";
  if (p.phase === "extracting") return "Extracting...";
  if (p.phase === "error") return `Error: ${p.error ?? ""}`;
  return "";
}

async function loadModels(): Promise<void> {
  try {
    models.value = await listVoiceModels();
  } catch {
    models.value = [];
  }
}

async function onDownload(modelId: string): Promise<void> {
  downloadProgress.value = {
    ...downloadProgress.value,
    [modelId]: { modelId, phase: "downloading", pct: 0 },
  };
  try {
    await downloadVoiceModel(modelId);
    await loadModels();
  } catch {
    /* error shown via progress */
  }
  downloadProgress.value = { ...downloadProgress.value, [modelId]: undefined };
}

function onCancelDownload(modelId: string): void {
  cancelVoiceModelDownload(modelId);
}

onMounted(() => {
  void load();
  void loadModels();
  onVoiceModelDownloadProgress((p) => {
    downloadProgress.value = { ...downloadProgress.value, [p.modelId]: p };
  });
});
</script>

<style scoped>
.ai-voice-panel {
  margin-top: 1.5rem;
}
</style>
