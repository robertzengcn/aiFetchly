<template>
  <!--
    Reusable spoken-response toggle (chat-first shell design §11.3).
    Presentational only: playback remains in VoicePlaybackQueue + the shared
    useAiChatVoice orchestration. Appears in the classic header and in the
    composer lower toolbar of the chat center surface.
  -->
  <v-btn
    icon
    size="small"
    variant="text"
    data-testid="spoken-response-toggle"
    :color="enabled ? 'primary' : undefined"
    :loading="saving"
    :disabled="saving"
    :title="toggleTitle"
    :aria-label="toggleTitle"
    :aria-pressed="enabled"
    @click="onClick"
  >
    <v-icon size="small">
      {{ enabled ? "mdi-volume-high" : "mdi-volume-off" }}
    </v-icon>
  </v-btn>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    /** Whether spoken responses are currently enabled. */
    enabled?: boolean;
    /** Whether the preference is being persisted (prevents double toggles). */
    saving?: boolean;
    /** TTS capability unavailable — the control routes to settings. */
    unavailable?: boolean;
    /** Whether assistant speech is playing (drives the stop affordance). */
    speaking?: boolean;
  }>(),
  { enabled: false, saving: false, unavailable: false, speaking: false }
);

const emit = defineEmits<{
  (event: "toggle"): void;
  (event: "open-settings"): void;
}>();

const { t } = useI18n();

const toggleTitle = computed(() =>
  props.enabled
    ? t("aiChatV2.voice.disable_spoken_responses") ||
      "Disable spoken responses"
    : t("aiChatV2.voice.enable_spoken_responses") ||
      "Enable spoken responses"
);

function onClick(): void {
  // When the capability is unavailable, enabling would silently fail —
  // route to the voice settings surface instead (PRD §14.4).
  if (props.unavailable && !props.enabled) {
    emit("open-settings");
    return;
  }
  emit("toggle");
}
</script>
