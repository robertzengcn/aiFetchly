import { ref } from "vue";

/**
 * Convergence rollout flags (design §26.2): `innerPageShellV2` enables the
 * shared authenticated shell; per-family enablement (scheduleUiV2) controls
 * converged content. Flags are ROLLOUT CONTROLS, not permissions, and use
 * the existing local settings mechanism (localStorage) so rollback is a
 * single toggle with no data migration (design §30.2).
 */
const SHELL_FLAG_KEY = "aifetchly.innerPageShellV2";
const SCHEDULE_FLAG_KEY = "aifetchly.scheduleUiV2";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Storage unavailable — session-only flag state.
  }
}

export function useInnerPageShellFlag(): {
  shellEnabled: ReturnType<typeof ref<boolean>>;
  scheduleEnabled: ReturnType<typeof ref<boolean>>;
  setShellEnabled(value: boolean): void;
  setScheduleEnabled(value: boolean): void;
} {
  const shellEnabled = ref(readFlag(SHELL_FLAG_KEY));
  const scheduleEnabled = ref(readFlag(SCHEDULE_FLAG_KEY));

  return {
    shellEnabled,
    scheduleEnabled,
    setShellEnabled(value: boolean): void {
      shellEnabled.value = value;
      writeFlag(SHELL_FLAG_KEY, value);
    },
    setScheduleEnabled(value: boolean): void {
      scheduleEnabled.value = value;
      writeFlag(SCHEDULE_FLAG_KEY, value);
    },
  };
}
