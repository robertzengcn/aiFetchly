<template>
  <div
    v-if="workspaceRequired"
    class="at-mention-dropdown at-mention-dropdown--empty"
    role="status"
  >
    <v-icon size="small" class="mr-2">mdi-folder-off-outline</v-icon>
    <span class="at-mention-dropdown__hint">{{
      t("aiChatV2.atMentions.noWorkspace") ||
      "Choose a workspace to mention files."
    }}</span>
    <v-btn
      size="x-small"
      variant="tonal"
      color="primary"
      class="ml-2"
      :aria-label="
        t('aiChatV2.atMentions.chooseWorkspace') || 'Choose workspace'
      "
      @click="emit('request-workspace')"
    >
      {{ t("aiChatV2.atMentions.chooseWorkspace") || "Choose workspace" }}
    </v-btn>
  </div>
  <div
    v-else-if="suggestions.length === 0"
    class="at-mention-dropdown at-mention-dropdown--empty"
    role="status"
  >
    <v-icon size="small" class="mr-2">mdi-magnify</v-icon>
    <span class="at-mention-dropdown__hint">{{
      t("aiChatV2.atMentions.noMatches") || "No matching files"
    }}</span>
  </div>
  <ul
    v-else
    :aria-label="ariaLabel"
    class="at-mention-dropdown"
    role="listbox"
  >
    <li
      v-for="(suggestion, index) in suggestions"
      :key="suggestion.id"
      ref="optionRefs"
      role="option"
      :aria-selected="index === highlightedIndex"
      :class="[
        'at-mention-option',
        { 'at-mention-option--highlighted': index === highlightedIndex },
      ]"
      :title="suggestion.relativePath"
      @mouseenter="emit('highlight', index)"
      @click="emit('select', index)"
    >
      <v-icon size="small" class="at-mention-option__icon">
        {{
          suggestion.kind === "directory"
            ? "mdi-folder-outline"
            : "mdi-file-document-outline"
        }}
      </v-icon>
      <span class="at-mention-option__path">{{ suggestion.displayText }}</span>
      <span class="at-mention-option__badge">
        {{
          suggestion.kind === "directory"
            ? t("aiChatV2.atMentions.directory") || "dir"
            : t("aiChatV2.atMentions.file") || "file"
        }}
      </span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ChatV2AtMentionSuggestionView } from "@/entityTypes/aiChatAtMentionTypes";

const props = defineProps<{
  suggestions: readonly ChatV2AtMentionSuggestionView[];
  highlightedIndex: number;
  workspaceRequired?: boolean;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  (e: "select", index: number): void;
  (e: "highlight", index: number): void;
  (e: "request-workspace"): void;
}>();

const { t } = useI18n();

// Keep the highlighted option scrolled into view for keyboard users (a11y §16).
const optionRefs = ref<ReadonlyArray<HTMLElement | null> | null>(null);
watch(
  () => props.highlightedIndex,
  (idx) => {
    if (idx < 0 || !optionRefs.value) return;
    void nextTick(() => {
      optionRefs.value?.[idx]?.scrollIntoView({ block: "nearest" });
    });
  }
);
</script>

<style scoped>
.at-mention-dropdown {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 240px;
  overflow-y: auto;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 20;
  font-size: 13px;
}
.at-mention-dropdown--empty {
  display: flex;
  align-items: center;
  padding: 8px 10px;
}
.at-mention-dropdown__hint {
  opacity: 0.8;
}
.at-mention-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}
.at-mention-option__icon {
  flex: 0 0 auto;
  opacity: 0.7;
}
.at-mention-option__path {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-mention-option__badge {
  flex: 0 0 auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.55;
}
.at-mention-option--highlighted {
  background: rgba(25, 118, 210, 0.12);
}
</style>
