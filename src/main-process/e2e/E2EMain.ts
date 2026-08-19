/**
 * Playwright Electron E2E bootstrap entry (design §6.2).
 *
 * Launched by Playwright's `_electron.launch({ args: ['.vite/e2e/build/e2e-main.js'] })`.
 *
 * Responsibilities (in order, BEFORE any production module initializes):
 *   1. Validate the E2E environment (fail-closed; design §6.3, §9).
 *   2. Reject packaged production builds — this bootstrap is test-only.
 *   3. Redirect Electron `userData` and `ELECTRON_USER_DATA_PATH` into the
 *      per-test temporary root so Token / USERSDBPATH / AI-provider config /
 *      SQLite all isolate to the test root (design §8.2).
 *   4. Mark `IS_TEST`/`NODE_ENV` so background.ts skips DevTools auto-open and
 *      Vue Devtools install.
 *   5. Dynamic-import the normal background entry. The dynamic import is
 *      required: a static import would let background's module-load-time code
 *      run before the paths/policy above are established.
 *
 * Step 2 (isolation foundation) inserts the network guard, state seeder, and
 * startup-policy wiring between steps 4 and 5. They are intentionally absent
 * from this initial build-proof entry.
 */

import { app } from "electron";
import { loadE2EEnvironment } from "./E2EEnvironment";
import { installE2ENetworkGuard } from "./E2ENetworkGuard";
import { seedE2EState } from "./E2EStateSeeder";

async function start(): Promise<void> {
  const environment = loadE2EEnvironment(process.env);

  if (app.isPackaged) {
    throw new Error("The E2E source bootstrap cannot run in a packaged app");
  }

  app.setPath("userData", environment.userDataPath);
  process.env.ELECTRON_USER_DATA_PATH = environment.userDataPath;
  process.env.IS_TEST = "1";
  process.env.NODE_ENV = "test";

  // Plain `vite build` (unlike forge plugin-vite) resolves the package.json
  // `browser` field for some Node packages (e.g. joi, form-data), pulling
  // browser/worker builds whose UMD wrappers reference `self`/`window` at
  // module load and crash the Electron MAIN process (ReferenceError: self is
  // not defined). Node 22 already provides FormData/fetch/Response on
  // globalThis, so alias the web globals so those browser bundles resolve
  // against the real Node implementations. E2E-only; production main builds
  // (forge plugin-vite) bundle the Node entries and are unaffected.
  const globalScope = globalThis as Record<string, unknown>;
  if (globalScope.self === undefined) {
    globalScope.self = globalThis;
  }
  if (globalScope.window === undefined) {
    globalScope.window = globalThis;
  }

  // Install the default-deny network guard BEFORE importing production code so
  // any outbound non-loopback request fails closed and is recorded (design §10.1).
  installE2ENetworkGuard(environment);

  // Seed deterministic AI/auth/database state from the validated state manifest
  // before the production window/IPC graph initializes (design §8.3).
  seedE2EState(environment);

  // Dynamic import: lets background.ts run only AFTER userData/flags/policy are set.
  await import("../../background");
}

start().catch((err: unknown) => {
  // A bootstrap failure must terminate the process so Playwright observes a
  // failed launch instead of a hang. Don't run any app-lifecycle quit here —
  // the failure happened before the app graph initialized.
  // eslint-disable-next-line no-console
  console.error("[E2E bootstrap] failed to start:", err);
  process.exit(1);
});
