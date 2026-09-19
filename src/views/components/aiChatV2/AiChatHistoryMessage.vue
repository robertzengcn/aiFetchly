<template>
  <div class="ai-history-message pa-2" :class="roleClass">
    <div class="d-flex align-center ga-1 mb-1">
      <v-icon size="x-small" aria-hidden="true">{{ roleIcon }}</v-icon>
      <span class="text-caption text-medium-emphasis">{{ excerpt.role }}</span>
      <span class="text-caption text-disabled">·</span>
      <span class="text-caption text-disabled">{{ formattedTimestamp }}</span>
      <v-spacer />
      <v-btn
        v-if="excerpt.exact"
        size="x-small"
        variant="text"
        :aria-label="t('aiChatHistory.select_passage') || 'Select passage'"
        data-testid="ai-history-select-passage"
        @click="emitSelect"
      >
        {{ t("aiChatHistory.select_passage") || "Select passage" }}
      </v-btn>
    </div>
    <div class="text-body-2 text-pre-wrap">{{ excerpt.text }}</div>
    <div v-if="excerpt.hasMore" class="d-flex ga-1 mt-1">
      <v-btn
        size="x-small"
        variant="text"
        color="primary"
        :aria-label="t('aiChatHistory.read_more') || 'Read more'"
        data-testid="ai-history-read-more"
        @click="emitExpand"
        @keydown.enter="emitExpand"
      >
        {{ t("aiChatHistory.read_more") || "Read more" }}
      </v-btn>
      <v-btn
        size="x-small"
        variant="text"
        :aria-label="t('aiChatHistory.go_to_message') || 'Go to message'"
        data-testid="ai-history-go-to-message"
        @click="emitNavigate"
        @keydown.enter="emitNavigate"
      >
        {{ t("aiChatHistory.go_to_message") || "Go to message" }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { HistoryExcerpt } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Renders a single archived history excerpt (technical-design §13.1) inside
 * the history drawer. The excerpt carries trusted text + offsets from the
 * backend; the renderer never quotes its own text as the original passage —
 * only the opaque `sourceId` is emitted for selection. Expansion loads the
 * complete original passage via a bounded read; navigation asks the parent to
 * reveal the source message. Viewing never mutates model context.
 */
const props = defineProps<{
  excerpt: HistoryExcerpt;
}>();

const emit = defineEmits<{
  (e: "select", excerpt: HistoryExcerpt): void;
  (e: "expand", excerpt: HistoryExcerpt): void;
  (e: "navigate", excerpt: HistoryExcerpt): void;
}>();

const { t } = useI18n();

const roleClass = computed(() => `ai-history-message--${props.excerpt.role}`);

const roleIcon = computed(() => {
  switch (props.excerpt.role) {
    case "user":
      return "mdi-account-outline";
    case "assistant":
      return "mdi-robot-outline";
    case "system":
      return "mdi-cog-outline";
    case "tool":
      return "mdi-tools";
    default:
      return "mdi-comment-outline";
  }
});

const formattedTimestamp = computed(() => {
  try {
    const d = new Date(props.excerpt.timestamp);
    return Number.isNaN(d.getTime())
      ? props.excerpt.timestamp
      : d.toLocaleString();
  } catch {
    return props.excerpt.timestamp;
  }
});

function emitSelect(): void {
  emit("select", props.excerpt);
}

function emitExpand(): void {
  emit("expand", props.excerpt);
}

function emitNavigate(): void {
  emit("navigate", props.excerpt);
}
</script>
