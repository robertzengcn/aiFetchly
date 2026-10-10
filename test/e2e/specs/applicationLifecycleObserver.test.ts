/**
 * Process-observer E2E specs (TODO 6, 12, 13; PRD AC-07/AC-14, quality §7).
 *
 *  - Observer: THIS TEST PROCESS outlives Electron. It records the pid of a
 *    REAL owned worker spawned through the production registration path,
 *    triggers exit, waits for Electron to die, then verifies with its own
 *    kill(pid,0) probes that the owned worker is gone while an unrelated
 *    fixture (never owned by the app) survives.
 *  - Hidden mode: with the E2E tray gate on, an owned worker keeps running
 *    (heartbeating to a marker file) across hide -> restore, then exits
 *    cleanly through the coordinated shutdown.
 *  - Timing: idle and busy exit durations measured from exit request to
 *    process exit; asserted within the 10s budget and echoed to the report.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { closeApp } from "../support/processCleanup";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

function isPidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hookSpawnOwnedFixture(
  app: LaunchedApp,
  markPath: string
): Promise<number> {
  const result = await app.electronApp.evaluate(
    (_electron, markPathArg: string) => {
      const hooks = (
        globalThis as unknown as {
          __aifetchlyLifecycleTestHooks?: {
            spawnOwnedFixture: (mark: string) => { pid: number };
          };
        }
      ).__aifetchlyLifecycleTestHooks;
      if (!hooks?.spawnOwnedFixture) throw new Error("fixture hook missing");
      return hooks.spawnOwnedFixture(markPathArg);
    },
    markPath
  );
  expect(result.pid).toBeGreaterThan(0);
  return result.pid;
}

async function hookRequestExit(app: LaunchedApp): Promise<void> {
  await app.electronApp.evaluate(() => {
    (
      globalThis as unknown as {
        __aifetchlyLifecycleTestHooks?: { requestExit: (r: string) => void };
      }
    ).__aifetchlyLifecycleTestHooks?.requestExit("programmatic");
  });
}

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

test.describe("Application exit — process observer", () => {
  test("owned worker dies with the app; unrelated process survives (AC-07/AC-14)", async ({
    testRoot,
  }) => {
    const app = await launchAiFetchly({ testRoot });
    // Unrelated fixture: spawned by the TEST process, never owned by the app.
    const unrelated: ChildProcess = spawn("sleep", ["120"], { stdio: "ignore" });
    const unrelatedPid = unrelated.pid;
    expect(unrelatedPid).toBeTruthy();

    const markPath = path.join(testRoot.rootPath, "owned-heartbeat.log");
    let ownedPid = 0;
    try {
      ownedPid = await hookSpawnOwnedFixture(app, markPath);
      // Owned fixture is alive and producing output before exit.
      await expect
        .poll(() => fs.existsSync(markPath), { timeout: 10_000 })
        .toBe(true);
      expect(isPidAlive(ownedPid)).toBe(true);

      const startedAt = Date.now();
      await hookRequestExit(app);
      const code = await waitForExit(app);
      const busyExitMs = Date.now() - startedAt;
      expect(code).toBe(0);

      // Observer verdict (this process outlives Electron): the owned worker
      // must be gone within the post-exit grace; the unrelated one must live.
      await expect
        .poll(() => isPidAlive(ownedPid), { timeout: 5_000 })
        .toBe(false);
      expect(isPidAlive(unrelatedPid)).toBe(true);

      // TODO 13 timing record (busy exit — one worker running).
      // eslint-disable-next-line no-console
      console.log(`[timing] busy exit (1 owned worker): ${busyExitMs}ms`);
      expect(busyExitMs, "busy exit within the 10s budget").toBeLessThan(
        10_000
      );
    } finally {
      unrelated.kill("SIGKILL");
      await closeApp(app);
    }
  });

  test("idle exit timing is well inside the budget", async ({ testRoot }) => {
    const app = await launchAiFetchly({ testRoot });
    try {
      const startedAt = Date.now();
      await hookRequestExit(app);
      const code = await waitForExit(app);
      const idleExitMs = Date.now() - startedAt;
      expect(code).toBe(0);
      // eslint-disable-next-line no-console
      console.log(`[timing] idle exit: ${idleExitMs}ms`);
      expect(idleExitMs).toBeLessThan(10_000);
    } finally {
      await closeApp(app);
    }
  });
});

test.describe("Application exit — hidden-mode representative task", () => {
  test(
    "owned worker keeps running and producing output across hide -> restore, then exits cleanly",
    { timeout: 120_000 },
    async ({ testRoot }) => {
      const app = await launchAiFetchly({
        testRoot,
        extraEnv: { AIFETCHLY_E2E_TRAY: "1" },
      });
      const markPath = path.join(testRoot.rootPath, "hidden-heartbeat.log");
      try {
        const state = await app.electronApp.evaluate(() => {
          const hooks = (
            globalThis as unknown as {
              __aifetchlyLifecycleTestHooks?: {
                getState: () => { state: string; backgroundAvailable: boolean };
              };
            }
          ).__aifetchlyLifecycleTestHooks;
          return hooks?.getState() ?? null;
        });
        test.skip(
          !state?.backgroundAvailable,
          "tray host unavailable in this environment (design §13 gate)"
        );

        const ownedPid = await hookSpawnOwnedFixture(app, markPath);
        expect(isPidAlive(ownedPid)).toBe(true);
        const marker0 = fs.existsSync(markPath) ? fs.statSync(markPath).mtimeMs : 0;

        // Hide via the real close-choice dialog.
        await app.electronApp.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.close();
        });
        const keep = app.mainWindow.locator(
          "[data-testid='app-close-keep-running']"
        );
        await expect(keep).toBeVisible({ timeout: 10_000 });
        await keep.click();
        await expect
          .poll(
            () =>
              app.electronApp.evaluate(({ BrowserWindow }) => {
                const win = BrowserWindow.getAllWindows()[0];
                return win ? win.isVisible() : false;
              }),
            { timeout: 5_000 }
          )
          .toBe(false);

        // The representative task keeps running for >= 60s while hidden and
        // keeps producing results (heartbeat marker advances).
        await new Promise((r) => setTimeout(r, 60_000));
        expect(isPidAlive(ownedPid)).toBe(true);
        const marker1 = fs.statSync(markPath).mtimeMs;
        expect(marker1).toBeGreaterThan(marker0);

        // Restore: same session, worker still alive.
        await app.electronApp.evaluate(() => {
          (
            globalThis as unknown as {
              __aifetchlyLifecycleTestHooks?: { restoreFromTray: () => void };
            }
          ).__aifetchlyLifecycleTestHooks?.restoreFromTray();
        });
        await expect
          .poll(
            () =>
              app.electronApp.evaluate(({ BrowserWindow }) => {
                const win = BrowserWindow.getAllWindows()[0];
                return win ? win.isVisible() : false;
              }),
            { timeout: 5_000 }
          )
          .toBe(true);
        expect(isPidAlive(ownedPid)).toBe(true);

        // Exit from restored state; the observer verifies cleanup.
        await hookRequestExit(app);
        const code = await waitForExit(app);
        expect(code).toBe(0);
        await expect
          .poll(() => isPidAlive(ownedPid), { timeout: 5_000 })
          .toBe(false);
      } finally {
        await closeApp(app);
      }
    }
  );
});
