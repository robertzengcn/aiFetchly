/**
 * Native dialog spec (design §15.6 / §11, T-11).
 *
 * Exercises the real DIALOG_PICK_FOLDER IPC handler with the OS dialog replaced
 * by the E2E manifest-driven NativeDialogService. A controlled cancellation
 * returns the configured result deterministically (no real OS dialog can be
 * automated, so a clean canceled/confirmed result proves the substitution ran)
 * and leaves application state unchanged.
 */

import { test, expect } from "@playwright/test";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";

async function pickFolder(
  page: import("@playwright/test").Page
): Promise<{ status: boolean; data: unknown }> {
  return page.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          invoke: (
            c: string,
            d?: unknown
          ) => Promise<{ status: boolean; data: unknown } | undefined>;
        };
      }
    ).api;
    const resp = await api.invoke("dialog:pick-folder");
    return resp ?? { status: false, data: undefined };
  });
}

test("native open-dialog cancellation is deterministic (T-11)", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });
  try {
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      dialogResponses: { open: { action: "canceled" } },
    });
    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      const result = await pickFolder(app.mainWindow);
      // Cancellation -> no folder selected, no OS dialog, state unchanged.
      expect(result.status).toBe(true);
      expect(result.data).toBeNull();
      await closeApp(app);
    } catch (err) {
      await closeApp(app);
      throw err;
    }

    // A confirmed pick returns the configured in-root folder (also no OS dialog).
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      dialogResponses: {
        open: { action: "confirmed", paths: [root.workspacePath] },
      },
    });
    const app2 = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      const result = await pickFolder(app2.mainWindow);
      expect(result.status).toBe(true);
      expect(result.data).toBe(root.workspacePath);
      await closeApp(app2);
    } catch (err) {
      await closeApp(app2);
      throw err;
    }
  } finally {
    await fakeAi.stop();
    root.remove();
  }
});
