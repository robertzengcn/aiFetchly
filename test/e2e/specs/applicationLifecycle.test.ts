/**
 * Application exit & system tray E2E specs
 * (docs/prd/application-exit-and-system-tray-prd.md; design §13).
 *
 * Covers the Electron-level flows that unit/component tests cannot reach:
 *  - × close → renderer close-choice dialog → cancel keeps window (AC-01)
 *  - × close → hide → restore round-trip without duplicate windows (AC-02/03)
 *  - dialog Exit runs the coordinated cleanup and exits (AC-04, AC-15)
 *  - repeated quit requests produce ONE cleanup + exit (AC-08)
 *  - main-process-owned exit works with a crashed renderer (AC-13)
 *
 * The native-dialog fallback (renderer unresponsive for the CHOICE dialog)
 * needs a real OS dialog and is covered by packaged manual checks, not here.
 * The tray icon itself needs a tray host; the hide scenario runs only when
 * the E2E tray gate reports background mode available (design §13).
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { closeApp } from "../support/processCleanup";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import * as fs from "fs";
import * as path from "path";

interface LifecycleTestHooks {
  restoreFromTray: () => void;
  requestExit: (reason: string) => void;
  getState: () => { state: string; backgroundAvailable: boolean };
}

/**
 * NOTE: electronApp.evaluate() serializes its return value — hook FUNCTIONS
 * never survive the bridge. Every hook invocation must run INSIDE an
 * evaluate callback; only plain-object results may be returned.
 */
async function getLifecycleState(
  app: LaunchedApp
): Promise<{ state: string; backgroundAvailable: boolean } | null> {
  return app.electronApp.evaluate(() => {
    const hooks = (
      globalThis as unknown as {
        __aifetchlyLifecycleTestHooks?: LifecycleTestHooks;
      }
    ).__aifetchlyLifecycleTestHooks;
    return hooks ? hooks.getState() : null;
  });
}

async function hookRestoreFromTray(app: LaunchedApp): Promise<void> {
  await app.electronApp.evaluate(() => {
    (
      globalThis as unknown as {
        __aifetchlyLifecycleTestHooks?: LifecycleTestHooks;
      }
    ).__aifetchlyLifecycleTestHooks?.restoreFromTray();
  });
}

async function hookRequestExit(
  app: LaunchedApp,
  reason: string
): Promise<void> {
  await app.electronApp.evaluate((_electron, reasonArg: string) => {
    (
      globalThis as unknown as {
        __aifetchlyLifecycleTestHooks?: LifecycleTestHooks;
      }
    ).__aifetchlyLifecycleTestHooks?.requestExit(reasonArg);
  }, reason);
}

/** Trigger a real user-style window close from the MAIN process. */
async function userCloseWindow(app: LaunchedApp): Promise<void> {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("no main window to close");
    win.close();
  });
}

async function windowCount(app: LaunchedApp): Promise<number> {
  return app.electronApp.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length
  );
}

async function isWindowVisible(app: LaunchedApp): Promise<boolean> {
  return app.electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win ? win.isVisible() : false;
  });
}

/** Wait for the Electron process to exit (bounded). */
async function waitForExit(
  app: LaunchedApp,
  timeoutMs = 20_000
): Promise<number> {
  const proc = app.electronApp.process();
  if (proc.exitCode !== null) return proc.exitCode;
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("app did not exit within budget")),
      timeoutMs
    );
    proc.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });
}

function readShutdownReports(app: LaunchedApp): unknown[] {
  const file = path.join(
    app.testRoot.userDataPath,
    "diagnostics",
    "shutdown-reports.jsonl"
  );
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test.describe("Application exit and system tray", () => {
  test("close shows one choice dialog; cancel keeps the window and app (AC-01)", async ({
    app,
  }) => {
    const { mainWindow } = app;

    await userCloseWindow(app);

    // Exactly one dialog renders, with Exit available; Keep running only
    // when the tray is available (gated off by default in E2E).
    const card = mainWindow.locator("[data-testid='app-close-dialog-card']");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(
      mainWindow.locator("[data-testid='app-close-exit']")
    ).toHaveCount(1);
    await expect(
      mainWindow.locator("[data-testid='app-close-cancel']")
    ).toHaveCount(1);

    // Cancel: window survives, still exactly one window.
    await mainWindow.locator("[data-testid='app-close-cancel']").click();
    await expect(card).toHaveCount(0);
    expect(await windowCount(app)).toBe(1);
    expect(await isWindowVisible(app)).toBe(true);
  });

  test("hide keeps the window alive and restore brings it back (AC-02/AC-03)", async ({
    testRoot,
  }) => {
    const app = await launchAiFetchly({
      testRoot,
      extraEnv: { AIFETCHLY_E2E_TRAY: "1" },
    });
    try {
      const state = await getLifecycleState(app);
      test.skip(
        !state?.backgroundAvailable,
        "tray host unavailable in this environment (design §13 gate)"
      );

      const { mainWindow } = app;
      await userCloseWindow(app);
      const card = mainWindow.locator("[data-testid='app-close-dialog-card']");
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Hide: window hidden but NOT destroyed — renderer stays alive.
      await mainWindow
        .locator("[data-testid='app-close-keep-running']")
        .click();
      await expect(card).toHaveCount(0);
      expect(await windowCount(app)).toBe(1);
      await expect
        .poll(() => isWindowVisible(app), { timeout: 5_000 })
        .toBe(false);

      // Restore (tray Open equivalent): same window visible again, state visible.
      await hookRestoreFromTray(app);
      await expect
        .poll(() => isWindowVisible(app), { timeout: 5_000 })
        .toBe(true);
      expect(await windowCount(app)).toBe(1);
      expect((await getLifecycleState(app))?.state).toBe("visible");
    } finally {
      await closeApp(app);
    }
  });

  test("Escape on the close dialog cancels — window and app stay open (FR-08/AC-12 keyboard)", async ({
    app,
  }) => {
    const { mainWindow } = app;

    await userCloseWindow(app);
    const card = mainWindow.locator("[data-testid='app-close-dialog-card']");
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Escape must mean cancel, never Exit (exit requires deliberate action).
    await mainWindow.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    expect(await windowCount(app)).toBe(1);
    expect(await isWindowVisible(app)).toBe(true);
    // App did not exit: the lifecycle state is still visible.
    expect((await getLifecycleState(app))?.state).toBe("visible");
  });

  test("dialog Exit runs coordinated cleanup, writes the report, and exits (AC-04/AC-15)", async ({
    testRoot,
  }) => {
    const app = await launchAiFetchly({ testRoot });
    try {
      const { mainWindow } = app;
      await userCloseWindow(app);
      const card = mainWindow.locator("[data-testid='app-close-dialog-card']");
      await expect(card).toBeVisible({ timeout: 10_000 });

      await mainWindow.locator("[data-testid='app-close-exit']").click();

      const code = await waitForExit(app);
      expect(code).toBe(0);

      // Normal exit produces a cleanup report (AC-15).
      const reports = readShutdownReports(app);
      expect(reports.length).toBeGreaterThanOrEqual(1);
      const last = reports[reports.length - 1] as {
        reason: string;
        clean: boolean;
        attemptId: string;
      };
      expect(last.reason).toBe("close-dialog");
      expect(typeof last.attemptId).toBe("string");
    } finally {
      await closeApp(app);
    }
  });

  test("repeated quit requests cause one cleanup and one exit (AC-08)", async ({
    testRoot,
  }) => {
    const app = await launchAiFetchly({ testRoot });
    try {
      // Fire three near-simultaneous quit sources through different paths.
      await app.electronApp.evaluate(async ({ app: electronAppInstance }) => {
        electronAppInstance.quit();
        electronAppInstance.quit();
        const hooks = (
          globalThis as unknown as {
            __aifetchlyLifecycleTestHooks?: {
              requestExit: (r: string) => void;
            };
          }
        ).__aifetchlyLifecycleTestHooks;
        hooks?.requestExit("programmatic");
      });

      const code = await waitForExit(app);
      expect(code).toBe(0);
      // Exactly one shutdown attempt recorded.
      const reports = readShutdownReports(app);
      expect(reports).toHaveLength(1);
    } finally {
      await closeApp(app);
    }
  });

  test("main-process-owned exit works with an unresponsive renderer (AC-13)", async ({
    testRoot,
  }) => {
    const app = await launchAiFetchly({ testRoot });
    try {
      // Crash the renderer first — the main process must still exit cleanly.
      await app.electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) throw new Error("no main window");
        win.webContents.forcefullyCrashRenderer();
      });
      // Give the crash a moment to land, then exit from the main process.
      await app.mainWindow
        .waitForEvent("close", { timeout: 10_000 })
        .catch(() => undefined);

      await hookRequestExit(app, "programmatic");

      const code = await waitForExit(app);
      expect(code).toBe(0);
      const reports = readShutdownReports(app);
      expect(reports.length).toBeGreaterThanOrEqual(1);
    } finally {
      await closeApp(app);
    }
  });
});
