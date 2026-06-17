<template>
  <div
    class="ctx-badge"
    :class="`ctx-badge--${tone}`"
    :title="tooltipText"
    :aria-label="ariaLabel"
    role="status"
  >
    <span class="ctx-badge__dot" />
    <span class="ctx-badge__label">CTX</span>
    <span class="ctx-badge__percent">{{ displayPercent }}%</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    percent: number;
    usedTokens?: number;
    totalTokens?: number;
  }>(),
  {
    usedTokens: undefined,
    totalTokens: undefined,
  }
);

const { t } = useI18n();

const safePercent = computed(() => {
  if (!Number.isFinite(props.percent) || props.percent < 0) return 0;
  if (props.percent > 100) return 100;
  return Math.round(props.percent);
});

const displayPercent = computed(() => safePercent.value);

type Tone = "low" | "mid" | "high" | "critical";

const tone = computed<Tone>(() => {
  const p = safePercent.value;
  if (p >= 95) return "critical";
  if (p >= 80) return "high";
  if (p >= 50) return "mid";
  return "low";
});

const tooltipText = computed(() => {
  const template =
    t("aiChatV2.context_usage_tooltip") ||
    "{used} / {total} tokens ({percent}%)";
  const used = props.usedTokens ?? 0;
  const total = props.totalTokens ?? 0;
  return template
    .replace("{used}", String(used))
    .replace("{total}", String(total))
    .replace("{percent}", String(safePercent.value));
});

const ariaLabel = computed(() => {
  const label = t("aiChatV2.context_usage") || "Context";
  return `${label}: ${safePercent.value}%`;
});
</script>

<style scoped>
.ctx-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
  user-select: none;
}
.ctx-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.85;
}
.ctx-badge__label {
  opacity: 0.7;
  font-weight: 600;
  letter-spacing: 0.4px;
}
.ctx-badge__percent {
  font-variant-numeric: tabular-nums;
}

.ctx-badge--low {
  color: rgba(0, 0, 0, 0.55);
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.08);
}
.ctx-badge--mid {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.2);
}
.ctx-badge--high {
  color: #b26a00;
  background: rgba(255, 152, 0, 0.12);
  border-color: rgba(255, 152, 0, 0.35);
}
.ctx-badge--critical {
  color: #c62828;
  background: rgba(229, 57, 53, 0.12);
  border-color: rgba(229, 57, 53, 0.4);
}
</style>
