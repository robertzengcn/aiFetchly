import { ref, type Ref } from "vue";

export interface UseApiCallOptions {
  /**
   * Invoked with the error message when the wrapped call rejects — typically
   * wired to a snackbar/toast so the user sees the failure. Optional; if
   * omitted the error is still captured in the returned `error` ref.
   */
  onError?: (message: string) => void;
}

export interface UseApiCallResult<T> {
  /** True while the wrapped call is in flight. */
  loading: Ref<boolean>;
  /** The last error message, or null when the last call succeeded. */
  error: Ref<string | null>;
  /** True iff the last run captured an error. */
  hasError: Ref<boolean>;
  /** Runs the wrapped call. Returns its value, or undefined on failure. */
  run: () => Promise<T | undefined>;
}

/**
 * Wraps an async IPC call (typically `windowInvoke`) with standardized
 * loading + error handling (WS-6 R6.5).
 *
 * - Sets `loading` true while the call is in flight, false afterwards
 *   (including on failure).
 * - On failure, captures the message into `error`, invokes the optional
 *   `onError` (e.g. to show a snackbar), and returns `undefined` — it does
 *   NOT re-throw, so callers don't need their own try/catch just to avoid an
 *   unhandled rejection.
 * - Resets `error` at the start of each run.
 *
 * Example:
 *   const { run, loading, error } = useApiCall(() => windowInvoke("x:list"), {
 *     onError: (m) => (snackbar.value = { show: true, message: m, type: "error" }),
 *   });
 */
export function useApiCall<T>(
  fn: () => Promise<T>,
  options?: UseApiCallOptions
): UseApiCallResult<T> {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasError = ref(false);

  const run = async (): Promise<T | undefined> => {
    loading.value = true;
    error.value = null;
    hasError.value = false;
    try {
      return await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      error.value = message;
      hasError.value = true;
      options?.onError?.(message);
      return undefined;
    } finally {
      loading.value = false;
    }
  };

  return { loading, error, hasError, run };
}
