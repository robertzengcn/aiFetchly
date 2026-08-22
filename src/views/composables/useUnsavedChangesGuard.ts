import { onBeforeUnmount, type Ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

/**
 * Dirty-state navigation guard (design §14.3, IPR-024): compares normalized
 * meaningful snapshots and warns before unsaved loss via onBeforeRouteLeave
 * plus a renderer beforeunload listener while dirty. Never serializes files,
 * secrets, or non-repeatable handles.
 */
export function useUnsavedChangesGuard(options: {
  initialSnapshot: () => string;
  currentSnapshot: () => string;
  submitting: Ref<boolean>;
  onResetAfterSave?(): void;
}): { isDirty(): boolean; resetBaseline(): void } {
  const { initialSnapshot, currentSnapshot, submitting, onResetAfterSave } = options;
  let baseline = initialSnapshot();

  function isDirty(): boolean {
    if (submitting.value) return false; // submit path owns its own guard
    return currentSnapshot() !== baseline;
  }

  function resetBaseline(): void {
    baseline = initialSnapshot();
    onResetAfterSave?.();
  }

  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };

  window.addEventListener("beforeunload", beforeUnload);
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", beforeUnload);
  });

  // Route-leave guard (IPR-024). Outside a component setup context this is a
  // no-op warning in Vue; unit tests exercise isDirty/resetBaseline directly.
  try {
    onBeforeRouteLeave(() => {
      if (!isDirty()) return true;
      return window.confirm(
        "You have unsaved changes. Leave and discard them?"
      );
    });
  } catch {
    // Non-component usage (unit tests): only the beforeunload guard applies.
  }

  return { isDirty, resetBaseline };
}
