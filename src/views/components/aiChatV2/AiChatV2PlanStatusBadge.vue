<template>
  <v-chip size="x-small" variant="tonal" :color="color">
    <v-icon start size="x-small">{{ icon }}</v-icon>
    {{ label }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AIChatPlanStatus } from "@/entityTypes/aiChatPlanTypes";

const props = defineProps<{
  status: AIChatPlanStatus;
}>();
const { t } = useI18n();

const config = computed(() => {
  switch (props.status) {
    case "draft":
      return { color: "default", icon: "mdi-pencil-outline" };
    case "awaiting_question":
      return { color: "info", icon: "mdi-help-circle-outline" };
    case "awaiting_approval":
      return { color: "warning", icon: "mdi-clock-outline" };
    case "approved":
      return { color: "success", icon: "mdi-check-circle" };
    case "rejected":
      return { color: "error", icon: "mdi-close-circle" };
    case "completed":
      return { color: "primary", icon: "mdi-flag-checkered" };
    case "cancelled":
      return { color: "default", icon: "mdi-cancel" };
    default:
      return { color: "default", icon: "mdi-circle-outline" };
  }
});

const color = computed(() => config.value.color);
const icon = computed(() => config.value.icon);

const label = computed(() => {
  const key = `aiChatV2Plan.status_${props.status}`;
  const fallback = props.status.replace(/_/g, " ");
  return t(key) || fallback;
});
</script>
