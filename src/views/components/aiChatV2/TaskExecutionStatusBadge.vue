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
import type { AiTaskExecutionStatus } from "@/entityTypes/aiTaskExecutionTypes";

const props = defineProps<{
  status: AiTaskExecutionStatus;
  /** Optional terminal reason code (TASK_EXECUTION_REASON_CODES) shown as a
   * tooltip so the user sees *why* a run ended without a wall of diagnostics. */
  reasonCode?: string;
}>();
const { t, te } = useI18n();

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
    case "terminal":
      return { color: "success", icon: "mdi-flag-checkered" };
    default:
      return { color: "default", icon: "mdi-circle-outline" };
  }
});

const color = computed(() => config.value.color);
const icon = computed(() => config.value.icon);

const label = computed(() => {
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
