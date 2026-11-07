/**
 * Session-scope reported-output state (R9 B04 / FR-RPT-009, AD-005).
 *
 * A successfully submitted report (single-output or conversation) marks its
 * selected outputs so the transcript can show the bounded "Reported" badge.
 * Module-scope SHARED state — every caller observes the same refs, so the
 * markers survive a center-column remount (route change / selection-bound
 * overlay rebuild) without ever being persisted or transferred to unrelated
 * messages. Same pattern as useInnerPageShellFlag (design §26.2/§30.2):
 * no pinia requirement, no storage writes.
 */
import { computed, ref } from "vue";

/** Session-scope singleton: the reported output ids. */
const reportedIds = ref(new Set<string>());

export function useChatReportState(): {
  /** Reactive view of the session's reported output ids. */
  readonly reportedMessageIds: import("vue").ComputedRef<Set<string>>;
  markReported(ids: readonly string[]): void;
  isReported(id: string): boolean;
} {
  return {
    reportedMessageIds: computed(() => reportedIds.value),
    markReported(ids: readonly string[]): void {
      const next = new Set(reportedIds.value);
      for (const id of ids) {
        if (id) next.add(id);
      }
      reportedIds.value = next;
    },
    isReported(id: string): boolean {
      return reportedIds.value.has(id);
    },
  };
}

/** Test isolation only: clear the session markers. */
export function resetChatReportStateForTest(): void {
  reportedIds.value = new Set<string>();
}
