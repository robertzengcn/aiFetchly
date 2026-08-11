/**
 * Process-wide {@link NativeDialogService} selector (design §11).
 *
 * Returns the E2E manifest-driven adapter when AIFETCHLY_E2E=1 and a state
 * manifest is configured (so tests never open a real OS dialog), and the
 * Electron-backed implementation otherwise. IPC handlers obtain the dialog
 * service through {@link getNativeDialogService} so the dependency is
 * substitutable without each call site branching.
 *
 * Security:
 *  - The E2E override is rejected in packaged production regardless of env
 *    (design acceptance #12), so a shipped app can never be coerced into
 *    returning manifest-controlled dialog results.
 *  - The E2E adapter + environment loader are loaded via dynamic import ONLY on
 *    the E2E path, so the test-harness modules never enter the production
 *    bundle's reachability graph.
 *  - A misconfigured E2E manifest fails closed (throws) rather than silently
 *    falling through to a real OS dialog.
 */

import { app } from "electron";
import { ElectronNativeDialogService } from "./ElectronNativeDialogService";
import type { NativeDialogService } from "./NativeDialogService";

let activePromise: Promise<NativeDialogService> | null = null;

export function getNativeDialogService(): Promise<NativeDialogService> {
  if (activePromise) return activePromise;
  const env = process.env;
  const isPackaged = Boolean((app as { isPackaged?: boolean }).isPackaged);
  const wantsE2e =
    !isPackaged &&
    env.AIFETCHLY_E2E === "1" &&
    !!env.AIFETCHLY_E2E_ROOT &&
    !!env.AIFETCHLY_E2E_STATE_FILE;
  if (wantsE2e) {
    activePromise = (async () => {
      try {
        // Dynamic import keeps the E2E harness modules out of the production bundle.
        const [{ E2ENativeDialogService }, { loadE2EEnvironment }] = await Promise.all([
          import("@/main-process/e2e/E2ENativeDialogService"),
          import("@/main-process/e2e/E2EEnvironment"),
        ]);
        const environment = loadE2EEnvironment(env);
        return new E2ENativeDialogService(
          environment,
          env.AIFETCHLY_E2E_STATE_FILE as string
        );
      } catch (err) {
        // Fail closed: a broken E2E config must never surface a real OS dialog.
        // eslint-disable-next-line no-console
        console.warn(
          "[NativeDialogService] E2E override misconfigured; refusing to open an OS dialog:",
          err
        );
        throw err;
      }
    })();
    return activePromise;
  }
  activePromise = Promise.resolve(new ElectronNativeDialogService());
  return activePromise;
}
