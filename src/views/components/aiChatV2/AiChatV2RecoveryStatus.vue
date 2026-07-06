<template>
  <div
    v-if="info"
    class="v2-recovery"
    :aria-label="label"
    role="status"
    data-testid="v2-recovery-status"
  >
    <v-icon size="16" class="v2-recovery__icon">{{ icon }}</v-icon>
    <span class="v2-recovery__text">
      {{ label }}
      <span v-if="hasAttempt" class="v2-recovery__count">
        {{
          t("aiChatV2.recovery.attempt", {
            n: attemptN,
            max: attemptMax,
          }) || `(attempt ${attemptN}/${attemptMax})`
        }}
      </span>
      <span v-if="elapsedSec > 0" class="v2-recovery__elapsed">
        · {{ elapsedSec }}s
      </span>
    </span>
    <span class="v2-recovery__hint">
      {{ t("aiChatV2.recovery.stop_hint") || "Press Stop to cancel" }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AIChatRecoveryLayer,
  AIChatRecoveryReason,
} from "@/service/AIChatRecoveryTypes";

const props = defineProps<{
  info?: {
    layer: AIChatRecoveryLayer;
    reason: AIChatRecoveryReason;
    attempt?: number;
    maxAttempts?: number;
    delayMs?: number;
    elapsedMs?: number;
    originalModel?: string;
    currentModel?: string;
    fallbackModel?: string;
    message?: string;
  } | null;
}>();

const { t } = useI18n();

const ICONS: Record<AIChatRecoveryLayer, string> = {
  api_retry: "mdi-connection",
  overload_retry: "mdi-server-network-off",
  output_token_recovery: "mdi-text-recognition",
  reactive_compact: "mdi-arrow-collapse-vertical",
  context_collapse_drain: "mdi-filter-variant",
  model_fallback: "mdi-swap-horizontal",
  persistent_retry: "mdi-history",
};

const icon = computed<string>(() =>
  props.info ? ICONS[props.info.layer] : "mdi-help-circle"
);

const attemptN = computed<number>(() => props.info?.attempt ?? 0);
const attemptMax = computed<number>(() => props.info?.maxAttempts ?? 0);
const hasAttempt = computed<boolean>(
  () =>
    typeof props.info?.attempt === "number" &&
    typeof props.info?.maxAttempts === "number"
);
const elapsedSec = computed<number>(() => {
  const ms = props.info?.elapsedMs;
  return typeof ms === "number" && ms > 0 ? Math.round(ms / 1000) : 0;
});

const label = computed<string>(() => {
  if (!props.info) return "";
  const fallbackByReason: Record<AIChatRecoveryReason, string> = {
    network: "Reconnecting…",
    timeout: "Request timed out, retrying…",
    rate_limit: "Rate limited, waiting…",
    overload: "AI server overloaded, retrying…",
    server_error: "AI server error, retrying…",
    output_limit: "Recovering truncated response…",
    context_overflow: "Reducing context…",
    media_overflow: "Media payload too large…",
    model_unavailable: "Model unavailable, switching…",
    auth: "Authentication error",
    quota: "Quota exceeded",
    cancelled: "Cancelled",
    non_recoverable: "Unrecoverable error",
  };
  const key = `aiChatV2.recovery.${props.info.layer}`;
  const translated = t(key);
  // vue-i18n returns the key itself when missing; fall back to reason text.
  if (translated && translated !== key) return translated;
  return fallbackByReason[props.info.reason] ?? props.info.layer;
});
</script>

<style scoped>
.v2-recovery {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(255, 193, 7, 0.12);
  color: #ffb300;
  font-size: 12px;
  line-height: 18px;
  animation: v2-recovery-pulse 1.6s ease-in-out infinite;
}
.v2-recovery__icon {
  opacity: 0.9;
}
.v2-recovery__text {
  font-weight: 500;
}
.v2-recovery__count,
.v2-recovery__elapsed {
  opacity: 0.8;
}
.v2-recovery__hint {
  opacity: 0.55;
  margin-left: 4px;
  font-size: 11px;
}
@keyframes v2-recovery-pulse {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}
</style>
