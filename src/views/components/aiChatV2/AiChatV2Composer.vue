<template>
  <div class="v2-composer">
    <!--
      Slash suggestions dropdown (Phase 13 — Plan 04, CMD-05).
      Positioned absolutely above the textarea by AiChatV2SlashSuggestions's
      own scoped styles (bottom: 100%). Only renders when slashOpen && the
      draft starts with '/'. Emits 'select' on Enter/Tab/click.
    -->
    <AiChatV2SlashSuggestions
      :commands="slashCommands"
      :highlighted-index="slashHighlighted"
      :open="slashOpen"
      @select="onSlashSelect"
      @highlight="onSlashHighlight"
    />
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
      @keydown="onKeydown"
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
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiChatV2SlashSuggestions from "./AiChatV2SlashSuggestions.vue";
import { listSlashCommands } from "@/views/api/slashCommands";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";

const props = defineProps<{ isStreaming: boolean }>();
const emit = defineEmits<{
  (e: "send", text: string): void;
  (e: "stop"): void;
  /**
   * Emitted when the user chooses a suggestion (Enter/Tab/click) while the
   * dropdown is open and an item is highlighted. AiChatV2.vue routes the
   * chosen command through dispatchSlashCommand.
   */
  (e: "command-select", command: SlashCommandView): void;
}>();
const { t } = useI18n();

const draft = ref("");

// ---------------------------------------------------------------------------
// Slash-suggestions state (Phase 13 — Plan 04, CMD-05 + Pitfall 4)
// ---------------------------------------------------------------------------
// slashOpen drives the dropdown render. slashCommands is the local cache of
// the renderer-safe views returned by SLASH_COMMAND_LIST. slashHighlighted is
// the index of the currently-focused row (-1 = none); Enter/Tab choose it.
const slashOpen = ref(false);
const slashCommands = ref<SlashCommandView[]>([]);
const slashHighlighted = ref(-1);

let slashFetchToken = 0;
// Tracks whether the current draft still starts with '/' after left-trim.
// Drives open/close + refetch on every relevant edit.
const startsWithSlash = (text: string): boolean =>
  text.trimStart().startsWith("/");

/**
 * Open (or refresh) the dropdown by fetching the renderer-safe command list
 * from the main process. The fetch is token-guarded so a stale response
 * (e.g. user typed '/' then 'x' quickly) never replaces a newer fetch's
 * results. On success, pre-selects the first row so Enter always selects.
 */
async function openSlashDropdown(query: string): Promise<void> {
  slashOpen.value = true;
  const myToken = ++slashFetchToken;
  try {
    const resp = await listSlashCommands({ query });
    if (myToken !== slashFetchToken) return; // a newer fetch superseded us
    slashCommands.value = [...resp.commands];
    slashHighlighted.value = slashCommands.value.length > 0 ? 0 : -1;
  } catch {
    // Non-fatal: leave the dropdown empty. The user can still type / submit.
    if (myToken === slashFetchToken) {
      slashCommands.value = [];
      slashHighlighted.value = -1;
    }
  }
}

function closeSlashDropdown(): void {
  slashOpen.value = false;
  slashCommands.value = [];
  slashHighlighted.value = -1;
}

// Watch the draft for leading '/' to open/close the dropdown. Per design §16.3
// the renderer fetches on '/' and lets the main process's CMD-07 ranking
// handle the filtering — cheaper than client-side fuzzy ranking (FUT-01).
watch(draft, (next) => {
  if (!next) {
    closeSlashDropdown();
    return;
  }
  if (startsWithSlash(next)) {
    // Only refetch when the query token after '/' changes shape significantly
    // (e.g. '/' -> '/x'). For the simple phase-13 case (4 built-ins) a fetch
    // per keystroke is cheap, but the token-guard above already dedupes races.
    const query = next.trimStart().slice(1);
    void openSlashDropdown(query);
  } else if (slashOpen.value) {
    closeSlashDropdown();
  }
});

const onSend = (): void => {
  const text = draft.value.trim();
  if (!text || props.isStreaming) return;
  emit("send", text);
  draft.value = "";
};

/**
 * Hand the chosen command to the parent for dispatch, clear the draft, and
 * close the dropdown. Called from click and Enter/Tab paths. Clearing the
 * draft locally keeps the composer self-contained: selecting a slash command
 * consumes the input (the slash text is not a meaningful chat message).
 */
function selectCommand(cmd: SlashCommandView): void {
  emit("command-select", cmd);
  draft.value = "";
  closeSlashDropdown();
}

/**
 * Keyboard handler (Pitfall 4 — the critical change).
 *
 * Precedence when the dropdown is OPEN and a row is highlighted:
 *   1. Enter or Tab -> preventDefault + selectCommand; do NOT submit.
 *   2. ArrowDown / ArrowUp -> cycle highlight; preventDefault.
 *   3. Escape -> close dropdown; preventDefault.
 *
 * If the dropdown is closed or no row is highlighted, the EXISTING behavior
 * runs: Enter (no Shift) submits via onSend; Shift+Enter inserts a newline
 * (Vuetify default). This preserves the composer's original UX when no
 * suggestion is being chosen.
 */
const onKeydown = (event: KeyboardEvent): void => {
  if (slashOpen.value && slashHighlighted.value >= 0) {
    if (event.key === "Enter" || event.key === "Tab") {
      // Pitfall 4: intercept — do NOT fall through to onSend.
      event.preventDefault();
      const cmd = slashCommands.value[slashHighlighted.value];
      if (cmd) {
        selectCommand(cmd);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const len = slashCommands.value.length;
      if (len > 0) {
        slashHighlighted.value = (slashHighlighted.value + 1) % len;
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const len = slashCommands.value.length;
      if (len > 0) {
        slashHighlighted.value =
          (slashHighlighted.value - 1 + len) % len;
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashDropdown();
      return;
    }
  } else if (slashOpen.value && event.key === "Escape") {
    event.preventDefault();
    closeSlashDropdown();
    return;
  }

  // Existing behavior: Enter (no Shift) submits; Shift+Enter inserts newline.
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend();
  }
};

/** User clicked a suggestion. Resolve + emit + clear draft + close dropdown. */
function onSlashSelect(idx: number): void {
  const cmd = slashCommands.value[idx];
  if (!cmd) return;
  selectCommand(cmd);
}

/** User hovered a row — update the highlight to follow the mouse. */
function onSlashHighlight(idx: number): void {
  slashHighlighted.value = idx;
}
</script>

<style scoped>
.v2-composer {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  position: relative; /* anchor for the absolutely-positioned suggestions dropdown */
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
