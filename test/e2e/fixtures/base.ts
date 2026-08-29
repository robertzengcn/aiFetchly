/**
 * Shared E2E fixtures: provides each test with a unique isolated temporary root
 * and a launched AiFetchly Electron instance, then tears them down in order.
 *
 *   testRoot  — per-test isolated temp root.
 *   app       — plain launch (no AI/auth state) for launch/security tests.
 *   fakeAi    — worker-scoped FakeOpenAI loopback server + controller.
 *   aiApp     — authenticated + local-enabled launch (requests hit fakeAi).
 *   disabledApp — authenticated + hosted-disabled launch (AI gate rejects).
 *   fakeHub   — worker-scoped FakePluginHub loopback server + controller.
 *   pluginsApp — authenticated launch whose Plugin Hub traffic hits fakeHub
 *                (unified plugin page critical flow, UPD-GAP-05/06).
 */

import { test as base, expect } from "@playwright/test";
import { createTemporaryRoot, writeStateManifest } from "./temporaryState";
import { launchAiFetchly, type LaunchedApp } from "./electronApp";
import { closeApp } from "../support/processCleanup";
import {
  startFakeOpenAiServer,
  type FakeOpenAiController,
} from "./fakeOpenAiServer";
import {
  startFakePluginHubServer,
  type FakePluginHubController,
} from "./fakePluginHubServer";
import type { E2ETestRoot } from "./types";

export interface E2EFixtures {
  testRoot: E2ETestRoot;
  app: LaunchedApp;
  fakeAi: FakeOpenAiController;
  aiApp: LaunchedApp;
  disabledApp: LaunchedApp;
  fakeHub: FakePluginHubController;
  pluginsApp: LaunchedApp;
}

export const e2eTest = base.extend<E2EFixtures>({
  // eslint-disable-next-line no-empty-pattern
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

  // Worker-scoped: start the fake AI server once per worker, share across tests.
  // eslint-disable-next-line no-empty-pattern
  fakeAi: async ({}, use) => {
    const fakeAi = await startFakeOpenAiServer();
    await use(fakeAi);
    await fakeAi.stop();
  },

  aiApp: async ({ testRoot, fakeAi }, use) => {
    await fakeAi.reset();
    writeStateManifest(testRoot, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: testRoot.workspacePath,
    });
    const app = await launchAiFetchly({
      testRoot,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    await use(app);
    await closeApp(app);
  },

  disabledApp: async ({ testRoot, fakeAi }, use) => {
    await fakeAi.reset();
    // Hosted-disabled: gate rejects before transport. Point the (unused)
    // provider URL at the fake server so any transport attempt is observable.
    writeStateManifest(testRoot, {
      authState: "authenticated",
      aiState: "hosted-disabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: testRoot.workspacePath,
    });
    const app = await launchAiFetchly({
      testRoot,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    await use(app);
    await closeApp(app);
  },

  // Worker-scoped: FakePluginHub serves the community catalog + fixture zip.
  // eslint-disable-next-line no-empty-pattern
  fakeHub: async ({}, use) => {
    const fakeHub = await startFakePluginHubServer();
    await use(fakeHub);
    await fakeHub.stop();
  },

  // Authenticated launch with Plugin Hub traffic pinned to fakeHub. Plugin
  // flows are non-AI-gated, so no AI provider state is needed; AI stays
  // hosted-disabled with the (unused) provider URL pointed at the fake AI
  // server for observability.
  pluginsApp: async ({ testRoot, fakeAi, fakeHub }, use) => {
    await fakeHub.reset();
    writeStateManifest(testRoot, {
      authState: "authenticated",
      aiState: "hosted-disabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: testRoot.workspacePath,
    });
    const app = await launchAiFetchly({
      testRoot,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      hubBaseUrl: fakeHub.baseUrl,
    });
    await use(app);
    await closeApp(app);
  },
});

export { expect };
