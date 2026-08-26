import { ref, computed } from "vue";
import { defineStore } from "pinia";

export interface ConfirmRequest {
  readonly title: string;
  readonly body: string;
  readonly tone: "info" | "danger";
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
}

interface ActiveConfirm extends ConfirmRequest {
  busy: boolean;
  resolver: (result: boolean) => void;
}

/**
 * Shared destructive-confirmation store (design §20.2).
 * Cancel-focused; one active dialog at a time; callers await a boolean.
 */
export const useAppConfirmStore = defineStore("appConfirm", () => {
  const active = ref<ActiveConfirm | null>(null);

  const isOpen = computed(() => active.value !== null);

  /**
   * Show a confirmation dialog and await the user's decision.
   * Returns true if confirmed, false if cancelled.
   */
  function request(req: ConfirmRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      active.value = { ...req, busy: false, resolver: resolve };
    });
  }

  function confirm(): void {
    if (!active.value) return;
    const a = active.value;
    a.busy = true;
    // The caller's async operation happens after the promise resolves;
    // the store closes the dialog immediately.
    active.value = null;
    a.resolver(true);
  }

  function cancel(): void {
    if (!active.value) return;
    const a = active.value;
    active.value = null;
    a.resolver(false);
  }

  return { active, isOpen, request, confirm, cancel };
});
