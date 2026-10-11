<template>
  <v-chip
    size="x-small"
    variant="tonal"
    :color="color"
    :title="tooltip"
  >
    <v-icon start size="x-small">{{ icon }}</v-icon>
    {{ label }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AiTaskExecutionStatus,
  TaskOutcome,
} from "@/entityTypes/aiTaskExecutionTypes";

const props = defineProps<{
  status: AiTaskExecutionStatus;
  /**
   * Honest terminal outcome (PRD FR-13/15/22, AC-16/21/27/32). When status is
   * `terminal` and an outcome is supplied, the badge derives its color and
   * label from the OUTCOME, not from a blanket "completed" green. Only
   * `verified_complete` renders success-green; every other outcome has an
   * honest label and a non-green color so a stalled/cancelled/failed run is
   * never disguised as a clean finish. Absent at terminal = legacy display
   * (green "completed") so older callers do not regress.
   */
  outcome?: TaskOutcome;
  /** Optional terminal reason code (TASK_EXECUTION_REASON_CODES) shown as a
   * tooltip so the user sees *why* a run ended without a wall of diagnostics. */
  reasonCode?: string;
}>();
const { t, te } = useI18n();

/**
 * T14 terminal-outcome display map. Only `verified_complete` is success-green
 * with the checkered flag. Each non-success outcome has a color that reflects
 * severity (error for failed/incomplete/timeout, warning for needs-input /
 * blocked-by-policy, default-grey for cancelled) and its own icon.
 *
 * Colors are Vuetify tonal semantic tokens (`success`/`error`/`warning`/
 * `default`) so the chip reads correctly under light and dark themes.
 */
const terminalOutcomeConfig: Record<
  TaskOutcome,
  { color: string; icon: string }
> = {
  verified_complete: { color: "success", icon: "mdi-flag-checkered" },
  incomplete: { color: "error", icon: "mdi-alert-circle-outline" },
  needs_user_input: { color: "warning", icon: "mdi-help-circle" },
  blocked_by_policy: { color: "warning", icon: "mdi-shield-lock-outline" },
  failed: { color: "error", icon: "mdi-alert-octagon-outline" },
  cancelled: { color: "default", icon: "mdi-cancel" },
  timeout: { color: "error", icon: "mdi-timer-alert-outline" },
};

const config = computed(() => {
  switch (props.status) {
    case "resolving":
      return { color: "default", icon: "mdi-dot-net" };
    case "preparing":
      return { color: "info", icon: "mdi-progress-pencil" };
    case "active":
      return { color: "primary", icon: "mdi-autorenew" };
    case "verifying":
      return { color: "info", icon: "mdi-check-decagram" };
    case "continuing":
      return { color: "primary", icon: "mdi-fast-forward" };
    case "waiting_permission":
      return { color: "warning", icon: "mdi-shield-account" };
    case "waiting_input":
      return { color: "warning", icon: "mdi-help-circle" };
    case "waiting_approval":
      return { color: "warning", icon: "mdi-clock-alert" };
    case "waiting_external_job":
      return { color: "info", icon: "mdi-link-variant" };
    case "terminal": {
      // T14: at terminal, derive color/icon from the honest outcome, not a
      // blanket success-green. Absent outcome → legacy green display so
      // older callers (and the no-outcome IPC projection for in-flight
      // rows) do not regress.
      if (props.outcome) {
        return terminalOutcomeConfig[props.outcome];
      }
      return { color: "success", icon: "mdi-flag-checkered" };
    }
    default:
      return { color: "default", icon: "mdi-circle-outline" };
  }
});

const color = computed(() => config.value.color);
const icon = computed(() => config.value.icon);

const label = computed(() => {
  // T14: at terminal with an outcome, render the outcome's honest label
  // (e.g. "incomplete", "failed", "timed out") instead of the blanket
  // "completed" status label — so the user sees what actually happened.
  if (props.status === "terminal" && props.outcome) {
    const outcomeKey = `aiChatV2.taskExecution.outcome_${props.outcome}`;
    if (!te(outcomeKey)) return props.outcome.replace(/_/g, " ");
    return t(outcomeKey);
  }
  const key = `aiChatV2.taskExecution.status_${props.status}`;
  // vue-i18n's t() returns the key itself when missing, so gate on te() to
  // make the humanized-status fallback actually reachable (FR-15 fallback).
  if (!te(key)) return props.status.replace(/_/g, " ");
  return t(key);
});

const tooltip = computed(() => {
  if (!props.reasonCode) return "";
  const key = `aiChatV2.taskExecution.errors.${props.reasonCode}`;
  // Unknown reason codes (e.g. newer server codes) fall back to a humanized
  // form instead of leaking the raw i18n key path into the tooltip.
  if (!te(key)) return props.reasonCode.replace(/_/g, " ").toLowerCase();
  return t(key);
});
</script>
