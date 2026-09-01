<template>
  <v-btn
    data-testid="report-conversation"
    variant="text"
    size="small"
    :icon="compact"
    :disabled="!enabled"
    :aria-label="ariaLabel"
    :title="enabled ? ariaLabel : (disabledReason || ariaLabel)"
    class="ai-conversation-report-btn"
    @click="onClick"
  >
    <v-icon size="small" :start="!compact">mdi-flag-outline</v-icon>
    <template v-if="!compact">{{ actionLabel }}</template>
  </v-btn>
</template>

<script setup lang="ts">
/**
 * Header-level "Report conversation" action (design §10.1).
 *
 * Unlike the per-message AIContentReportButton (single output), this opens the
 * multi-select conversation report dialog. The button is disabled (not
 * hidden) when the capability envelope says v2 reporting is off or the backend
 * is unreachable — so the action's presence is stable and the disabled reason
 * is announced (PRD §11.4, design §10.1).
 *
 * Reporting is NOT AI-gated: the parent may show this button regardless of
 * USER_AI_ENABLED (design §2, PRD FR-4.4).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    /** False when the capability envelope disables v2 reporting. */
    enabled: boolean;
    /** Loading state while capabilities are fetched. */
    loading?: boolean;
    /** Why the action is disabled (announced as title/tooltip). */
    disabledReason?: string;
    /** Icon-only variant for compact headers. */
    compact?: boolean;
  }>(),
  { loading: false, compact: false, disabledReason: "" }
);

const emit = defineEmits<{
  (e: "open"): void;
}>();

const { t } = useI18n();
const actionLabel = computed(
  () => t("aiConversationReport.action") || "Report conversation"
);
const ariaLabel = computed(
  () =>
    t("aiConversationReport.actionAriaLabel") ||
    "Report this conversation for review"
);

function onClick(): void {
  if (!props.enabled || props.loading) return;
  emit("open");
}
</script>

<style scoped>
.ai-conversation-report-btn {
  text-transform: none;
}
/* Compact (icon-only) variant matches the surrounding header icon buttons;
   the text variant keeps a 44px touch target. */
.ai-conversation-report-btn:not(.v-btn--icon) {
  min-width: 44px;
  min-height: 44px;
}
</style>
