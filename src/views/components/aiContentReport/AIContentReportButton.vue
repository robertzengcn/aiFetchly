<template>
  <v-btn
    variant="text"
    size="small"
    :disabled="reported"
    :aria-label="ariaLabel"
    :title="ariaLabel"
    class="ai-content-report-btn"
    @click="onClick"
  >
    <v-icon size="small" start>mdi-flag-outline</v-icon>
    {{ reported ? reportedLabel : actionLabel }}
  </v-btn>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ReportableOutputDescriptor } from "./reportableOutput";

/**
 * Reusable "Report AI output" action button.
 *
 * PRD FR-1.1 / FR-1.3: icon plus visible text on primary surfaces; an
 * accessible label so screen readers announce "Report this AI-generated
 * output" (PRD §11.4). When the report has been submitted this session,
 * the button is disabled and labeled "Reported" (PRD FR-1.4, §9.1).
 *
 * The parent owns dialog mount (one dialog per surface region) to avoid
 * stacked-dialog focus races; the button just emits `report` with the
 * descriptor.
 */
const props = defineProps<{
  descriptor: ReportableOutputDescriptor;
  /** True after a successful submission this session. */
  reported?: boolean;
}>();
const emit = defineEmits<{
  (e: "report", descriptor: ReportableOutputDescriptor): void;
}>();
const { t } = useI18n();
const actionLabel = computed(() => t("aiContentReport.action") || "Report AI output");
const reportedLabel = computed(() => t("aiContentReport.reported") || "Reported");
const ariaLabel = computed(
  () => t("aiContentReport.actionAriaLabel") || "Report this AI-generated output"
);
function onClick(): void {
  if (props.reported) return;
  emit("report", props.descriptor);
}
</script>

<style scoped>
.ai-content-report-btn {
  text-transform: none;
}
</style>
