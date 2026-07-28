<template>
  <div class="v2-composer">
    <div class="v2-composer__mention">
      <AiChatV2AtMentionSuggestions
        v-if="atMentionOpen"
        :suggestions="atMentionSuggestions"
        :highlighted-index="atMentionHighlightedIndex"
        :workspace-required="atMentionWorkspaceRequired"
        :aria-label="
          t('aiChatV2.atMentions.ariaLabel') || 'Mention workspace files'
        "
        @select="onAtMentionSelect"
        @highlight="(i: number) => (atMentionHighlightedIndex = i)"
        @request-workspace="emit('request-workspace')"
      />
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
      :disabled="isStreaming"
      :aria-label="t('aiChatV2.input_placeholder') || 'Send a message'"
      @keydown="onKeydown"
      @input="onTextareaInput"
      @keyup="onTextareaCursor"
      @click="onTextareaCursor"
    />
    <div class="v2-composer__bar">
      <div v-if="$slots.prepend" class="v2-composer__prepend">
        <slot name="prepend" />
      </div>
      <div class="v2-composer__actions">
        <v-btn
          v-if="!isStreaming"
          color="primary"
          icon="mdi-send"
          size="small"
          :disabled="draft.trim().length === 0"
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
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiChatV2AtMentionSuggestions from "./AiChatV2AtMentionSuggestions.vue";
import { listAtMentionSuggestions } from "@/views/api/aiChatAtMentions";
import type { ChatV2AtMentionSuggestionView } from "@/entityTypes/aiChatAtMentionTypes";

const props = defineProps<{
  isStreaming: boolean;
  conversationId?: string | null;
}>();
const emit = defineEmits<{
  (e: "send", text: string): void;
  (e: "stop"): void;
  (e: "request-workspace"): void;
}>();
const { t } = useI18n();

const draft = ref("");

// ---------------------------------------------------------------------------
// @-mention autocomplete state (renderer-side; all resolution is in main)
// ---------------------------------------------------------------------------
const atMentionSuggestions = ref<readonly ChatV2AtMentionSuggestionView[]>([]);
const atMentionOpen = ref(false);
const atMentionHighlightedIndex = ref(-1);
const atMentionWorkspaceRequired = ref(false);
const activeAtMentionRange = ref<{ start: number; end: number } | null>(null);
let atMentionDebounce: ReturnType<typeof setTimeout> | null = null;
let atMentionGeneration = 0;
let textareaEl: HTMLTextAreaElement | null = null;

const WHITESPACE_CHARS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
function isWs(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE_CHARS.has(ch);
}

interface ActiveAtMentionQuery {
  readonly query: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Find the active `@` mention query immediately before the cursor.
 * Mirrors the parser boundary rules: `@` must be at start-of-input or after
 * whitespace, and must not be `@@`. Returns null outside a mention.
 */
function findActiveAtMention(
  value: string,
  cursor: number
): ActiveAtMentionQuery | null {
  let i = cursor - 1;
  while (i >= 0) {
    const ch = value[i];
    if (isWs(ch)) break;
    if (ch === "@") {
      const before = i > 0 ? value[i - 1] : "";
      if (i === 0 || isWs(before)) {
        if (value[i + 1] === "@") return null; // ignore @@
        const query = value.slice(i + 1, cursor);
        return { query, start: i, end: cursor };
      }
      return null;
    }
    i--;
  }
  return null;
}

function captureTextarea(event: Event): HTMLTextAreaElement {
  const el = event.target as HTMLTextAreaElement;
  textareaEl = el;
  return el;
}

function closeAtMention(): void {
  atMentionGeneration += 1; // invalidate any in-flight debounced request
  if (atMentionDebounce) {
    clearTimeout(atMentionDebounce);
    atMentionDebounce = null;
  }
  atMentionOpen.value = false;
  atMentionSuggestions.value = [];
  atMentionHighlightedIndex.value = -1;
  atMentionWorkspaceRequired.value = false;
  activeAtMentionRange.value = null;
}

function refreshAtMention(value: string, cursor: number): void {
  const active = findActiveAtMention(value, cursor);
  activeAtMentionRange.value = active
    ? { start: active.start, end: active.end }
    : null;

  if (!active) {
    closeAtMention();
    return;
  }

  const generation = ++atMentionGeneration;
  if (atMentionDebounce) clearTimeout(atMentionDebounce);
  atMentionDebounce = setTimeout(async () => {
    if (generation !== atMentionGeneration) return; // stale
    let resp;
    try {
      resp = await listAtMentionSuggestions({
        conversationId: props.conversationId ?? undefined,
        query: active.query,
      });
    } catch {
      if (generation !== atMentionGeneration) return;
      closeAtMention();
      return;
    }
    if (generation !== atMentionGeneration) return; // stale (conversation switch)
    atMentionSuggestions.value = resp?.suggestions ?? [];
    atMentionWorkspaceRequired.value = resp?.workspaceRequired === true;
    atMentionOpen.value =
      atMentionWorkspaceRequired.value || atMentionSuggestions.value.length > 0;
    atMentionHighlightedIndex.value =
      atMentionSuggestions.value.length > 0 ? 0 : -1;
  }, 120);
}

function onTextareaInput(event: Event): void {
  const ta = captureTextarea(event);
  refreshAtMention(ta.value, ta.selectionStart ?? ta.value.length);
}

function onTextareaCursor(event: Event): void {
  const ta = captureTextarea(event);
  refreshAtMention(ta.value, ta.selectionStart ?? ta.value.length);
}

function moveHighlight(delta: number): void {
  const n = atMentionSuggestions.value.length;
  if (n === 0) return;
  const current =
    atMentionHighlightedIndex.value >= 0 ? atMentionHighlightedIndex.value : 0;
  atMentionHighlightedIndex.value = (current + delta + n) % n;
}

function onAtMentionSelect(index: number): void {
  const suggestion = atMentionSuggestions.value[index];
  const range = activeAtMentionRange.value;
  if (!suggestion || !range) return;

  const ta = textareaEl;
  const value = ta?.value ?? draft.value;
  const next = value.slice(0, range.start) + suggestion.insertText + value.slice(range.end);
  draft.value = next;
  const pos = range.start + suggestion.insertText.length;
  closeAtMention();
  void nextTick(() => {
    if (ta) {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }
  });
}

function onKeydown(event: KeyboardEvent): void {
  const key = event.key;
  const hasSuggestions = atMentionSuggestions.value.length > 0;

  if (atMentionOpen.value && hasSuggestions) {
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      closeAtMention();
      return;
    }
    if (key === "Enter" || key === "Tab") {
      event.preventDefault();
      const idx =
        atMentionHighlightedIndex.value >= 0
          ? atMentionHighlightedIndex.value
          : 0;
      onAtMentionSelect(idx);
      return;
    }
  } else if (atMentionOpen.value && key === "Escape") {
    event.preventDefault();
    closeAtMention();
    return;
  }

  if (key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend();
  }
}

const onSend = (): void => {
  const text = draft.value.trim();
  if (!text || props.isStreaming) return;
  closeAtMention();
  emit("send", text);
  draft.value = "";
};

// Dropping stale suggestions on conversation switch (FR-015 / AC-007).
watch(
  () => props.conversationId,
  () => {
    closeAtMention();
  }
);
</script>

<style scoped>
.v2-composer {
  flex: 0 0 auto;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}
.v2-composer__mention {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 100%;
  pointer-events: none;
}
.v2-composer__mention > * {
  pointer-events: auto;
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
