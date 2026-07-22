<template>
  <div class="v2-composer">
    <!-- Slash command suggestions dropdown -->
    <AiChatV2SlashSuggestions
      :commands="slashCommands"
      :highlighted-index="slashHighlightedIndex"
      :open="slashOpen"
      @select="onSlashSelect"
      @highlight="onSlashHighlight"
      @close="closeSlash"
    />

    <!-- File notice (error/warning inline) -->
    <v-slide-y-reverse-transition>
      <div v-if="fileNotice" class="v2-composer__notice">
        <v-icon size="x-small" color="warning" class="mr-1">mdi-alert-circle-outline</v-icon>
        {{ fileNotice }}
      </div>
    </v-slide-y-reverse-transition>

    <!-- Selected file chips -->
    <div v-if="selectedFiles.length > 0" class="v2-composer__files">
      <v-chip
        v-for="(file, idx) in selectedFiles"
        :key="`${file.name}-${idx}`"
        size="small"
        closable
        class="mr-1 mb-1"
        @click:close="removeFile(idx)"
      >
        <v-icon start size="x-small">
          {{ isImageFile(file) ? "mdi-image" : "mdi-file-document-outline" }}
        </v-icon>
        {{ file.name }}
        <span class="v2-composer__file-size">({{ formatBytes(file.size) }})</span>
      </v-chip>
    </div>

    <v-textarea
      v-model="draft"
      :placeholder="t('aiChatV2.input_placeholder') || 'Send a message…'"
      variant="outlined"
      auto-grow
      rows="1"
      max-rows="6"
      hide-details
      density="comfortable"
      :disabled="isStreaming || isProcessing"
      @keydown="onKeydown"
    />
    <div class="v2-composer__bar">
      <!-- Attach file button. Rendered as its own flex item at the far
           left of the bar so the mode/model/tool selectors in the prepend
           slot can't push it off-screen on narrow chat panels. -->
      <v-btn
        v-if="!isStreaming && !isProcessing"
        icon
        size="small"
        variant="text"
        class="v2-composer__attach"
        :title="t('aiChatV2.attachments.add') || 'Attach file'"
        @click="triggerFilePicker"
      >
        <v-icon size="small">mdi-paperclip</v-icon>
      </v-btn>
      <div v-if="$slots.prepend" class="v2-composer__prepend">
        <slot name="prepend" />
      </div>
      <div class="v2-composer__actions">
        <v-btn
          v-if="voiceEnabled && !isStreaming && !isProcessing"
          icon
          size="small"
          variant="text"
          :color="isRecording ? 'error' : undefined"
          :disabled="isTranscribing"
          :title="t('aiChatV2.voice.microphone') || 'Voice input'"
          :aria-label="isRecording ? (t('aiChatV2.voice.stop_recording') || 'Stop recording') : (t('aiChatV2.voice.start_recording') || 'Start recording')"
          @click="onMicClick"
        >
          <v-icon size="small">{{ isRecording ? "mdi-stop" : "mdi-microphone" }}</v-icon>
        </v-btn>
        <v-btn
          v-if="!isStreaming"
          color="primary"
          icon="mdi-send"
          size="small"
          :disabled="(draft.trim().length === 0 && selectedFiles.length === 0) || isProcessing"
          :loading="isProcessing"
          :aria-label="t('aiChatV2.send') || 'Send'"
          @click="onSend"
        />
        <v-btn
          v-else
          color="error"
          icon="mdi-stop"
          size="small"
          :aria-label="t('aiChatV2.stop') || 'Stop'"
          @click="$emit('stop')"
        />
      </div>
    </div>
    <!-- Hidden file input -->
    <input
      ref="fileInputRef"
      type="file"
      multiple
      accept=".pdf,.docx,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,image/*"
      style="display: none"
      @change="onFileSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiChatV2SlashSuggestions from "./AiChatV2SlashSuggestions.vue";
import { listSlashCommands } from "@/views/api/slashCommands";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";
import { BrowserVoiceRecorder } from "./voice/BrowserVoiceRecorder";
import { transcribeVoice } from "@/views/api/aiChatV2Voice";

const MAX_UPLOAD_FILES = 3;
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const SUPPORTED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const SUPPORTED_DOC_EXTS = new Set([".pdf", ".docx", ".csv", ".xlsx", ".xls"]);

const props = defineProps<{
  isStreaming: boolean;
  isProcessing?: boolean;
  /**
   * Show a push-to-talk microphone button for local voice input. Off by
   * default; the parent enables it from voice settings (PRD §7.1).
   */
  voiceEnabled?: boolean;
  /**
   * Active conversation id, used to scope slash-command suggestions so a
   * workspace command only appears in chats using that workspace (FR-1).
   * null/undefined for a brand-new chat -> the main process returns only
   * non-workspace commands. We deliberately do NOT create a conversation id
   * just for suggestions (design §9.1).
   */
  conversationId?: string | null;
}>();
const emit = defineEmits<{
  (e: "send", text: string, files: File[]): void;
  (e: "stop"): void;
}>();
const { t } = useI18n();

const draft = ref("");
const selectedFiles = ref<File[]>([]);

// --- Local voice input (push-to-talk; PRD §7.1/§7.2) ---
// The composer owns the recorder + transcribe call for the MVP: the transcript
// is appended to the draft for review (no auto-send). Auto-send + spoken
// responses move orchestration to AiChatV2.vue in later phases.
const voiceRecorder = new BrowserVoiceRecorder();
const isRecording = ref(false);
const isTranscribing = ref(false);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read audio"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read audio"));
    reader.readAsDataURL(blob);
  });
}

function appendTranscript(text: string): void {
  const clean = text.trim();
  if (clean.length === 0) return;
  draft.value =
    draft.value.trim().length === 0
      ? clean
      : `${draft.value.trim()} ${clean}`;
}

async function onMicClick(): Promise<void> {
  if (isTranscribing.value) return;
  if (isRecording.value) {
    isRecording.value = false;
    isTranscribing.value = true;
    try {
      const recording = await voiceRecorder.stop();
      const audioBase64 = await blobToBase64(recording.blob);
      const result = await transcribeVoice({
        audioBase64,
        mimeType: recording.mimeType,
      });
      if (result.transcript && result.transcript.trim().length > 0) {
        appendTranscript(result.transcript);
      } else {
        showNotice(t("aiChatV2.voice.empty_transcript") || "No speech was detected.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotice(
        t("aiChatV2.voice.transcription_failed") ||
          `Voice transcription failed: ${msg}`,
      );
    } finally {
      isTranscribing.value = false;
    }
    return;
  }
  // Start recording.
  try {
    await voiceRecorder.start(60_000);
    isRecording.value = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showNotice(
      t("aiChatV2.voice.permission_denied") ||
        `Microphone unavailable: ${msg}`,
    );
  }
}
const fileNotice = ref("");
const fileInputRef = ref<HTMLInputElement | null>(null);

// --- Slash command suggestions ---
const slashCommands = ref<readonly SlashCommandView[]>([]);
const slashOpen = ref(false);
const slashHighlightedIndex = ref(-1);
let slashDebounce: ReturnType<typeof setTimeout> | null = null;
let suppressSlashRefresh = false;
// Monotonic generation token: each refreshSlashSuggestions call increments it
// and captures its generation. After the IPC resolves, a stale callback (from a
// previous conversation or query) sees a mismatch and skips the state write —
// so switching chats mid-suggestion can never flash another workspace's command
// names/descriptions into the now-active chat (AC-1 — "never listable").
let slashGeneration = 0;

/**
 * When the draft starts with '/', fetch matching commands from the registry
 * (via IPC) and show the suggestion dropdown. Debounced so we don't spam IPC
 * on every keystroke.
 */
function refreshSlashSuggestions(): void {
  if (suppressSlashRefresh) {
    suppressSlashRefresh = false;
    return;
  }
  const text = draft.value;
  if (!text.startsWith("/")) {
    slashOpen.value = false;
    slashCommands.value = [];
    return;
  }
  const query = text.slice(1); // strip leading /
  if (slashDebounce) clearTimeout(slashDebounce);
  const generation = ++slashGeneration;
  slashDebounce = setTimeout(async () => {
    try {
      const resp = await listSlashCommands({
        conversationId: props.conversationId ?? undefined,
        query,
      });
      // A newer refresh (new keystroke or conversation switch) superseded this
      // one — drop the stale result instead of flashing it into the wrong chat.
      if (generation !== slashGeneration) return;
      const commands = resp?.commands ?? [];
      slashCommands.value = commands;
      slashOpen.value = commands.length > 0;
      slashHighlightedIndex.value = commands.length > 0 ? 0 : -1;
    } catch {
      if (generation !== slashGeneration) return;
      slashOpen.value = false;
      slashCommands.value = [];
    }
  }, 120);
}

// Watch the draft and trigger slash detection.
watch(draft, () => {
  refreshSlashSuggestions();
});

// Refresh suggestions when the active conversation changes (the scoped command
// set differs per workspace) — but only if the user is already typing a slash
// command, so we never open the dropdown unprompted.
watch(
  () => props.conversationId,
  () => {
    if (draft.value.startsWith("/")) {
      refreshSlashSuggestions();
    }
  }
);

function closeSlash(): void {
  if (slashDebounce) {
    clearTimeout(slashDebounce);
    slashDebounce = null;
  }
  slashOpen.value = false;
  slashCommands.value = [];
  slashHighlightedIndex.value = -1;
}

function onSlashHighlight(idx: number): void {
  slashHighlightedIndex.value = idx;
}

/**
 * When the user selects a command from the dropdown (click or Enter), inject
 * the command name into the draft so the full text is e.g. "/review" and
 * the user can add arguments or press Enter to send.
 */
function onSlashSelect(idx: number): void {
  const cmd = slashCommands.value[idx];
  if (!cmd) return;
  suppressSlashRefresh = true;
  draft.value = `/${cmd.name} `;
  closeSlash();
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function showNotice(msg: string): void {
  fileNotice.value = msg;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { fileNotice.value = ""; }, 4000);
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const name = file.name.toLowerCase();
  for (const ext of SUPPORTED_IMAGE_EXTS) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function isSupportedFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = getFileExtension(file.name);
  return SUPPORTED_DOC_EXTS.has(ext) || SUPPORTED_IMAGE_EXTS.has(ext);
}

function triggerFilePicker(): void {
  fileInputRef.value?.click();
}

function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;

  const newFiles: File[] = [];
  for (const file of input.files) {
    if (!isSupportedFile(file)) {
      showNotice(t("aiChatV2.attachments.unsupported", { name: file.name }) || `${file.name} is not a supported file type.`);
      continue;
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      showNotice(t("aiChatV2.attachments.too_large", { name: file.name, maxSize: formatBytes(MAX_UPLOAD_FILE_BYTES) }) || `${file.name} exceeds the ${formatBytes(MAX_UPLOAD_FILE_BYTES)} limit.`);
      continue;
    }
    newFiles.push(file);
  }

  const combined = [...selectedFiles.value, ...newFiles].slice(0, MAX_UPLOAD_FILES);
  selectedFiles.value = combined;

  // Reset input so the same files can be re-selected after removal.
  input.value = "";
}

function removeFile(idx: number): void {
  selectedFiles.value = selectedFiles.value.filter((_, i) => i !== idx);
}

const onSend = (): void => {
  const text = draft.value.trim();
  if ((!text && selectedFiles.value.length === 0) || props.isStreaming) return;
  const files = [...selectedFiles.value];
  emit("send", text, files);
  draft.value = "";
  selectedFiles.value = [];
  closeSlash();
};

const onKeydown = (event: KeyboardEvent): void => {
  // Slash suggestion keyboard navigation
  if (slashOpen.value && slashCommands.value.length > 0) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      slashHighlightedIndex.value = Math.min(
        slashHighlightedIndex.value + 1,
        slashCommands.value.length - 1
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      slashHighlightedIndex.value = Math.max(slashHighlightedIndex.value - 1, 0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (slashHighlightedIndex.value >= 0) {
        onSlashSelect(slashHighlightedIndex.value);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlash();
      return;
    }
  }
  // Normal send (Enter without shift)
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend();
  }
};
</script>

<style scoped>
.v2-composer {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px 10px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.v2-composer__notice {
  display: flex;
  align-items: center;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(255, 152, 0, 0.1);
  color: rgba(0, 0, 0, 0.7);
}
.v2-composer__files {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding-bottom: 4px;
}
.v2-composer__file-size {
  font-size: 11px;
  opacity: 0.7;
  margin-left: 2px;
}
.v2-composer__bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Attach button never shrinks — always visible on the far left. */
.v2-composer__attach {
  flex: 0 0 auto;
}
/* Prepend slot wraps and can shrink; selectors move to the next line on
   narrow panels instead of pushing the attach/send buttons off-screen. */
.v2-composer__prepend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  row-gap: 4px;
}
.v2-composer__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  margin-left: auto;
}
</style>
