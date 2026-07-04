<template>
  <!--
    AiChatV2SlashSuggestions.vue (Phase 13 — Plan 04, CMD-05)
    Presentational dropdown listing renderer-safe slash commands.

    Trust boundary (TRS-07): pure UI — never imports fs/path/os. Renders ONLY
    the SlashCommandView projection (name/description/aliases/source/argumentHint/
    enabled/disabledReason). Vue's default template escaping prevents HTML
    injection from command names/descriptions (T-13-Inject mitigation — do NOT
    use v-html for suggestion content).
  -->
  <div
    v-if="open && commands.length > 0"
    ref="rootEl"
    class="slash-suggestions"
    role="listbox"
    :aria-label="t('slashCommands.aria_label') || 'Slash commands'"
  >
    <div
      v-for="(cmd, idx) in commands"
      :key="cmd.id"
      :ref="(el) => setItemRef(idx, el as HTMLElement | null)"
      class="slash-suggestions__item"
      :class="{
        'slash-suggestions__item--highlighted': idx === highlightedIndex,
        'slash-suggestions__item--disabled': !cmd.enabled,
      }"
      role="option"
      :aria-selected="idx === highlightedIndex ? 'true' : 'false'"
      :aria-disabled="cmd.enabled ? 'false' : 'true'"
      tabindex="-1"
      @click="onItemClick(idx)"
      @mouseenter="onItemHover(idx)"
    >
      <div class="slash-suggestions__row">
        <span class="slash-suggestions__name">/{{ cmd.name }}</span>
        <span
          class="slash-suggestions__badge"
          :class="`slash-suggestions__badge--${badgeClass(cmd.source)}`"
        >
          {{ badgeLabel(cmd.source) }}
        </span>
      </div>
      <div class="slash-suggestions__meta">
        <span v-if="cmd.description" class="slash-suggestions__desc">{{
          cmd.description
        }}</span>
        <span
          v-if="cmd.argumentHint"
          class="slash-suggestions__arg-hint"
        >{{ cmd.argumentHint }}</span>
      </div>
      <div
        v-if="!cmd.enabled && cmd.disabledReason"
        class="slash-suggestions__disabled-reason"
      >
        {{ cmd.disabledReason }}
      </div>
    </div>
    <div
      v-if="commands.length === 0"
      class="slash-suggestions__empty"
    >
      {{ t("slashCommands.noMatches") || "No matching commands" }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import type {
  SlashCommandView,
  SlashCommandSource,
} from "@/entityTypes/slashCommandTypes";

const props = defineProps<{
  /** Renderer-safe command views (already stripped of body/metadata). */
  readonly commands: readonly SlashCommandView[];
  /** Index of the highlighted row (-1 = none). */
  readonly highlightedIndex: number;
  /** Whether the dropdown should render. */
  readonly open: boolean;
}>();

const emit = defineEmits<{
  (e: "select", index: number): void;
  (e: "highlight", index: number): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

const rootEl = ref<HTMLElement | null>(null);
// Sparse map of index -> element ref, used to scroll the highlighted row
// into view when the highlight changes (keyboard navigation).
const itemEls = new Map<number, HTMLElement>();

function setItemRef(idx: number, el: HTMLElement | null): void {
  if (el) {
    itemEls.set(idx, el);
  } else {
    itemEls.delete(idx);
  }
}

function onItemClick(idx: number): void {
  emit("select", idx);
}

function onItemHover(idx: number): void {
  emit("highlight", idx);
}

/**
 * Map a command's source to the color-coded CSS modifier class.
 * Built-in=primary, User=info, Workspace=warning, Plugin=secondary
 * (mirrors WorkspaceBadge.vue's color conventions — design §18.1).
 */
function badgeClass(source: SlashCommandSource): string {
  switch (source) {
    case "built-in":
      return "primary";
    case "user":
      return "info";
    case "workspace":
      return "warning";
    case "plugin":
      return "secondary";
    default:
      return "primary";
  }
}

/**
 * Localized source label for the badge. Falls back to the capitalized
 * source name if the i18n key is missing (Plan 13-05 lands the full
 * 6-language coverage; English fallback is the safety net per CLAUDE.md).
 */
function badgeLabel(source: SlashCommandSource): string {
  switch (source) {
    case "built-in":
      return t("slashCommands.sourceBuiltin") || "Built-in";
    case "user":
      return t("slashCommands.sourceUser") || "User";
    case "workspace":
      return t("slashCommands.sourceWorkspace") || "Workspace";
    case "plugin":
      return t("slashCommands.sourcePlugin") || "Plugin";
    default:
      return source;
  }
}

// Scroll the highlighted row into view whenever highlightedIndex changes.
// watchEffect would also fire on commands change; we want a precise trigger
// only on highlight moves, so a plain watch on highlightedIndex is cleaner.
watch(
  () => props.highlightedIndex,
  async (idx) => {
    if (idx < 0) return;
    await nextTick();
    const el = itemEls.get(idx);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }
);

// Clean up item element refs on unmount to avoid leaking detached nodes.
onBeforeUnmount(() => {
  itemEls.clear();
});
</script>

<style scoped>
.slash-suggestions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  margin-bottom: 4px;
  max-height: 280px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  z-index: 20;
  padding: 4px 0;
}
.slash-suggestions__item {
  padding: 6px 12px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}
.slash-suggestions__item--highlighted {
  background-color: rgba(var(--v-theme-primary), 0.12);
}
.slash-suggestions__item--disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.slash-suggestions__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.slash-suggestions__name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}
.slash-suggestions__badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
}
.slash-suggestions__badge--primary {
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
}
.slash-suggestions__badge--info {
  background: rgba(var(--v-theme-info), 0.16);
  color: rgb(var(--v-theme-info));
}
.slash-suggestions__badge--warning {
  background: rgba(var(--v-theme-warning), 0.18);
  color: rgb(var(--v-theme-warning));
}
.slash-suggestions__badge--secondary {
  background: rgba(var(--v-theme-secondary), 0.18);
  color: rgb(var(--v-theme-secondary));
}
.slash-suggestions__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
}
.slash-suggestions__desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}
.slash-suggestions__arg-hint {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  opacity: 0.7;
}
.slash-suggestions__disabled-reason {
  margin-top: 2px;
  font-size: 11px;
  color: rgb(var(--v-theme-warning));
}
.slash-suggestions__empty {
  padding: 10px 12px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.5);
  text-align: center;
}
</style>
