import { onBeforeUnmount, onMounted } from "vue";
import { useAppShellStore } from "@/views/store/appShell";

/**
 * One shell measurement system (design §10.1): a single ResizeObserver with
 * rAF-debounced mode application. Pages consume `appShell.mode`; they never
 * install their own window resize listeners.
 */
export function useResponsiveShell(
  observeElement: () => HTMLElement | null
): { start(): void; stop(): void } {
  const shell = useAppShellStore();
  let observer: ResizeObserver | null = null;
  let frame: number | null = null;

  const apply = (width: number): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      shell.setModeFromWidth(width);
    });
  };

  const start = (): void => {
    if (observer) return;
    const el = observeElement();
    if (!el || typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        apply(entry.contentRect.width);
      }
    });
    observer.observe(el);
    apply(el.clientWidth);
  };

  const stop = (): void => {
    observer?.disconnect();
    observer = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  onMounted(start);
  onBeforeUnmount(stop);

  return { start, stop };
}
