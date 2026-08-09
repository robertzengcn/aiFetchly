/**
 * Shared E2E fixture: provides each test with a unique isolated temporary root
 * and a launched AiFetchly Electron instance, then tears them down in order.
 */

import { test as base, expect } from "@playwright/test";
import { createTemporaryRoot } from "./temporaryState";
import { launchAiFetchly, type LaunchedApp } from "./electronApp";
import { closeApp } from "../support/processCleanup";
import type { E2ETestRoot } from "./types";

export interface E2EFixtures {
  testRoot: E2ETestRoot;
  app: LaunchedApp;
}

export const e2eTest = base.extend<E2EFixtures>({
  testRoot: async ({}, use, testInfo) => {
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    await use(root);
    // Retain the root on failure for artifact inspection; remove on success.
    if (testInfo.status === "passed") {
      root.remove();
    }
  },
  app: async ({ testRoot }, use) => {
    const app = await launchAiFetchly({ testRoot });
    await use(app);
    await closeApp(app);
  },
});

export { expect };
