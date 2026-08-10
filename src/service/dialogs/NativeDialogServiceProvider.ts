/**
 * Process-wide {@link NativeDialogService} selector (design §11).
 *
 * Returns the E2E manifest-driven adapter when AIFETCHLY_E2E=1 and a state
 * manifest is configured (so tests never open a real OS dialog), and the
 * Electron-backed implementation otherwise. IPC handlers obtain the dialog
 * service through {@link getNativeDialogService} so the dependency is
 * substitutable without each call site branching.
 */

import { ElectronNativeDialogService } from "./ElectronNativeDialogService";
import { E2ENativeDialogService } from "@/main-process/e2e/E2ENativeDialogService";
import { loadE2EEnvironment } from "@/main-process/e2e/E2EEnvironment";
import type { NativeDialogService } from "./NativeDialogService";

let active: NativeDialogService | null = null;

export function getNativeDialogService(): NativeDialogService {
  if (active) return active;
  const env = process.env;
  if (
    env.AIFETCHLY_E2E === "1" &&
    env.AIFETCHLY_E2E_ROOT &&
    env.AIFETCHLY_E2E_STATE_FILE
  ) {
    try {
      const environment = loadE2EEnvironment(env);
      active = new E2ENativeDialogService(
        environment,
        env.AIFETCHLY_E2E_STATE_FILE
      );
      return active;
    } catch {
      // Invalid E2E config — fall through to the production service.
    }
  }
  active = new ElectronNativeDialogService();
  return active;
}

/** Reset the cached service (test-only). */
export function resetNativeDialogService(): void {
  active = null;
}
