<template>
  <div v-if="capabilities" class="ai-provider-badges d-flex flex-wrap gap-2">
    <v-chip
      v-for="badge in badges"
      :key="badge.label"
      :color="badge.color"
      size="small"
      variant="tonal"
    >
      <v-icon start :icon="badge.icon" />
      {{ badge.label }}: {{ badge.text }}
    </v-chip>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  LocalAIProviderCapabilities,
  ProviderCapabilityStatus,
  VisionCapabilityStatus,
} from "@/entityTypes/aiProviderTypes";

const props = defineProps<{
  capabilities: LocalAIProviderCapabilities | null;
}>();
const { t } = useI18n();

type Tone = "success" | "error" | "warning" | "default";

function toneFor(status: ProviderCapabilityStatus): Tone {
  switch (status) {
    case "supported":
      return "success";
    case "unsupported":
    case "failed":
      return "error";
    case "unknown":
      return "warning";
  }
}

function toneForVision(status: VisionCapabilityStatus): Tone {
  switch (status) {
    case "supported":
      return "success";
    case "unsupported":
      return "error";
    case "unknown":
      return "warning";
  }
}

function iconFor(tone: Tone): string {
  switch (tone) {
    case "success":
      return "mdi-check-circle";
    case "error":
      return "mdi-close-circle";
    case "warning":
      return "mdi-help-circle";
    default:
      return "mdi-circle-outline";
  }
}

function colorFor(tone: Tone): string {
  switch (tone) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "grey";
  }
}

const badges = computed(() => {
  const caps = props.capabilities;
  if (!caps) return [];
  const entries: { label: string; text: string; tone: Tone }[] = [
    {
      label: t("aiProvider.cap_label_models") || "Models",
      text: t(`aiProvider.cap_${caps.modelsEndpoint}`) || caps.modelsEndpoint,
      tone: toneFor(caps.modelsEndpoint),
    },
    {
      label: t("aiProvider.cap_label_chat") || "Chat",
      text: t(`aiProvider.cap_${caps.chat}`) || caps.chat,
      tone: toneFor(caps.chat),
    },
    {
      label: t("aiProvider.cap_label_streaming") || "Streaming",
      text: t(`aiProvider.cap_${caps.streaming}`) || caps.streaming,
      tone: toneFor(caps.streaming),
    },
    {
      label: t("aiProvider.cap_label_tools") || "Tools",
      text: t(`aiProvider.cap_${caps.tools}`) || caps.tools,
      tone: toneFor(caps.tools),
    },
    {
      label: t("aiProvider.cap_label_vision") || "Vision",
      text: t(`aiProvider.cap_${caps.vision}`) || caps.vision,
      tone: toneForVision(caps.vision),
    },
  ];
  if (typeof caps.contextSize === "number" && caps.contextSize > 0) {
    entries.push({
      label: t("aiProvider.cap_label_context") || "Context",
      text: String(caps.contextSize),
      tone: "default",
    });
  }
  return entries.map((e) => ({
    label: e.label,
    text: e.text,
    tone: e.tone,
    color: colorFor(e.tone),
    icon: iconFor(e.tone),
  }));
});
</script>

<style scoped>
.ai-provider-badges {
  gap: 8px;
}
</style>
