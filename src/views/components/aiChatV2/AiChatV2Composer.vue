<template>
  <div class="v2-composer">
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
      <div v-if="$slots.prepend" class="v2-composer__prepend">
        <slot name="prepend" />
        <!-- Attach file button -->
        <v-btn
          v-if="!isStreaming && !isProcessing"
          icon
          size="small"
          variant="text"
          class="ml-1"
          :title="t('aiChatV2.attachments.add') || 'Attach file'"
          @click="triggerFilePicker"
        >
          <v-icon size="small">mdi-paperclip</v-icon>
        </v-btn>
      </div>
      <div class="v2-composer__actions">
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
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const MAX_UPLOAD_FILES = 3;
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const SUPPORTED_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const SUPPORTED_DOC_EXTS = new Set([".pdf", ".docx", ".csv", ".xlsx", ".xls"]);

const props = defineProps<{ isStreaming: boolean; isProcessing?: boolean }>();
const emit = defineEmits<{
  (e: "send", text: string, files: File[]): void;
  (e: "stop"): void;
}>();
const { t } = useI18n();

const draft = ref("");
const selectedFiles = ref<File[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);

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
      console.warn(`[AiChatV2Composer] unsupported file type: ${file.name}`);
      continue;
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      console.warn(`[AiChatV2Composer] file too large: ${file.name} (${file.size} bytes)`);
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
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend();
  }
};
</script>

<style scoped>
.v2-composer {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px 10px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
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
  justify-content: space-between;
  gap: 8px;
}
.v2-composer__prepend {
  display: flex;
  align-items: center;
}
.v2-composer__actions {
  display: flex;
  align-items: center;
}
</style>
