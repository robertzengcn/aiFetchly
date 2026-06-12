<template>
  <div class="v2-stream-status" v-if="visible">
    <v-progress-circular
      v-if="status === 'streaming'"
      indeterminate
      size="14"
      width="2"
      color="primary"
      class="mr-2"
    />
    <v-icon v-else-if="status === 'cancelled'" size="14" color="grey" class="mr-1">
      mdi-cancel
    </v-icon>
    <v-icon v-else-if="status === 'error'" size="14" color="error" class="mr-1">
      mdi-alert-circle-outline
    </v-icon>
    <span class="v2-stream-status__text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

type Status = "idle" | "streaming" | "cancelled" | "error";
const props = defineProps<{ status: Status; errorMessage?: string }>();
const { t } = useI18n();

const visible = computed(() => props.status !== "idle");
const text = computed(() => {
  if (props.status === "streaming") return t("aiChatV2.streaming") || "Generating…";
  if (props.status === "cancelled") return t("aiChatV2.cancelled") || "Cancelled";
  if (props.status === "error")
    return props.errorMessage || t("aiChatV2.server_unavailable") || "Error";
  return "";
});
</script>

<style scoped>
.v2-stream-status {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
}
.v2-stream-status__text {
  line-height: 1;
}
</style>
