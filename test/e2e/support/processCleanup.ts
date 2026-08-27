/**
 * Bounded Electron teardown (design §13.4).
 *
 * Closes the app through Playwright first; only if that does not complete within
 * the timeout does it SIGKILL the recorded process. Never uses broad commands
 * like `pkill electron`. Playwright's `ElectronApplication.close()` takes no
 * timeout argument, so we race it against a timer.
 */

import type { LaunchedApp } from "../fixtures/electronApp";

export async function closeApp(
  app: LaunchedApp,
  timeoutMs = 15_000
): Promise<void> {
  try {
    await Promise.race([
      app.electronApp.close(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("Electron close timed out")),
          timeoutMs
        )
      ),
    ]);
    return;
  } catch {
    // Fall through to forceful kill of the recorded pid only.
  }
  if (app.pid !== undefined) {
    try {
      process.kill(app.pid, "SIGKILL");
    } catch {
      // Already exited — nothing to do.
    }
  }
}
