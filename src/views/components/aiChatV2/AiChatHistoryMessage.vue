<template>
  <div class="ai-history-message pa-2" :class="roleClass">
    <div class="d-flex align-center ga-1 mb-1">
      <v-icon size="x-small">{{ roleIcon }}</v-icon>
      <span class="text-caption text-medium-emphasis">{{ excerpt.role }}</span>
      <span class="text-caption text-disabled">·</span>
      <span class="text-caption text-disabled">{{ formattedTimestamp }}</span>
      <v-spacer />
      <v-btn
        v-if="excerpt.exact"
        size="x-small"
        variant="text"
        data-testid="ai-history-select-passage"
        @click="emitSelect"
      >
        {{ t("aiChatHistory.select_passage") || "Select passage" }}
      </v-btn>
    </div>
    <div class="text-body-2 text-pre-wrap">{{ excerpt.text }}</div>
    <div v-if="excerpt.hasMore" class="text-caption text-primary mt-1">
      {{ t("aiChatHistory.read_more") || "Read more" }}
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
 * only the opaque `sourceId` is emitted for selection.
 */
const props = defineProps<{
  excerpt: HistoryExcerpt;
}>();

const emit = defineEmits<{
  (e: "select", excerpt: HistoryExcerpt): void;
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
</script>
