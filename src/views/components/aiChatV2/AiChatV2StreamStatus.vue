<template>
  <div class="v2-stream-status" v-if="visible">
    <v-progress-circular
      v-if="status === 'streaming'"
      indeterminate
      size="14"
      width="2"
      color="primary"
      class="mr-2"
    />
    <v-icon v-else-if="status === 'cancelled'" size="14" color="grey" class="mr-1">
      mdi-cancel
    </v-icon>
    <v-icon v-else-if="status === 'error'" size="14" color="error" class="mr-1">
      mdi-alert-circle-outline
    </v-icon>
    <span class="v2-stream-status__text">
      <template v-for="(part, index) in textParts" :key="index">
        <a
          v-if="part.href"
          :href="part.href"
          target="_blank"
          rel="noopener noreferrer"
          class="v2-stream-status__link"
        >
          {{ part.text }}
        </a>
        <template v-else>{{ part.text }}</template>
      </template>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

type Status = "idle" | "streaming" | "cancelled" | "error";
const props = defineProps<{ status: Status; errorMessage?: string }>();
const { t } = useI18n();

const visible = computed(() => props.status !== "idle");
const text = computed(() => {
  if (props.status === "streaming") return t("aiChatV2.streaming") || "Generating…";
  if (props.status === "cancelled") return t("aiChatV2.cancelled") || "Cancelled";
  if (props.status === "error")
    return props.errorMessage || t("aiChatV2.server_unavailable") || "Error";
  return "";
});

// Matches http/https URLs so error text (e.g. the AI quota-exhausted message,
// which carries VITE_LOGIN_URL) can render them as clickable links. The
// Electron main process routes target=_blank external links to
// shell.openExternal, so no extra IPC wiring is needed here.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;

const textParts = computed<Array<{ text: string; href?: string }>>(() => {
  const raw = text.value;
  const parts: Array<{ text: string; href?: string }> = [];
  let lastIndex = 0;
  for (const match of raw.matchAll(URL_PATTERN)) {
    const url = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push({ text: raw.slice(lastIndex, start) });
    }
    parts.push({ text: url, href: url });
    lastIndex = start + url.length;
  }
  if (lastIndex < raw.length) {
    parts.push({ text: raw.slice(lastIndex) });
  }
  if (parts.length === 0) {
    parts.push({ text: raw });
  }
  return parts;
});
</script>

<style scoped>
.v2-stream-status {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
}
.v2-stream-status__text {
  line-height: 1;
}
.v2-stream-status__link {
  color: #1a73e8;
  text-decoration: underline;
  cursor: pointer;
  word-break: break-all;
}
.v2-stream-status__link:hover {
  color: #0b57d0;
}
</style>
