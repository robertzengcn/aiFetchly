/**
 * A02 renderer rollout drill (technical design §23.1–§23.3).
 *
 * Six scenarios drive the REAL renderer → preload → ipcMain flag channel to
 * prove the acceptance criteria from the audit todo:
 *
 *  1. Mounting the workspace records the redesign DEFAULT; a later GET is
 *     explicit, enabled=true.
 *  2. An operator's explicit rollback (enabled=false) survives reloading the
 *     renderer and remounting the workspace — mount-time enforcement is not
 *     allowed to overwrite a recorded choice — and the real Chat V2 entry
 *     (the legacy dock) remains reachable.
 *  3. Restoring the workspace after a rollback → the workspace default route
 *     is live again, no duplicate DEFAULT writes break anything.
 *  4. Rolling back the shared-orchestration adapter while a durable pending
 *     queue exists preserves pending/run identities and queue stop/resume
 *     (§23.2 presentation-only), and re-enabling causes no duplicate
 *     dispatch.
 *  5. The voice/memory adapter degrades composer voice controls in the real
 *     surface (after a reload re-hydrates the composable).
 *  6. The specialized-results adapter swaps the inspector artifacts panel
 *     for a fallback notice; activity/context stay ungated.
 *
 * Adapter toggles are exercised through the actual renderer IPC path
 * (window.api.invoke of the workspace get/set flag channels — the same
 * allowlisted channels the composables use). The composable caches its
 * hydrated state, so scenarios 5–6 reload the page after each flip like an
 * operator relaunch would.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { RENDERER_ORIGIN } from "../fixtures/types";
import type { LaunchedApp } from "../fixtures/electronApp";
import { assertCleanTeardown } from "../support/assertions";

type FlagEnvelope = {
  status: boolean;
  msg?: string;
  data?: {
    enabled?: boolean;
    explicit?: boolean;
    feature?: string;
    adapters?: {
      sharedOrchestration: boolean;
      specializedResults: boolean;
      voiceMemory: boolean;
    };
  };
};

/** Invoke a flag channel through the renderer's real preload bridge. */
async function invokeFlag(
  page: import("@playwright/test").Page,
  channel: "ai-chat-workspace:get-flag" | "ai-chat-workspace:set-flag",
  payload: Record<string, unknown> = {}
): Promise<FlagEnvelope> {
  return page.evaluate(
    async ([target, body]) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              channel: string,
              data?: unknown
            ) => Promise<{ status: boolean; msg?: string; data?: unknown } | undefined>;
          };
        }
      ).api;
      const raw = (await api.invoke(target, JSON.stringify(body))) ?? {};
      return raw as FlagEnvelope;
    },
    [channel, payload] as const
  );
}

async function openWorkspace(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(page.getByTestId("chat-center-surface")).toBeVisible({
    timeout: 30_000,
  });
}

function composer(page: import("@playwright/test").Page): import("@playwright/test").Locator {
  return page.getByTestId("ai-chat-composer");
}

function textarea(page: import("@playwright/test").Page): import("@playwright/test").Locator {
  return composer(page).locator("textarea").first();
}

async function openChat(
  page: import("@playwright/test").Page
): Promise<void> {
  await openWorkspace(page);
  const newChat = page.getByTestId("workspace-new-chat");
  await newChat.waitFor({ state: "visible", timeout: 10_000 });
  await newChat.click();
  await expect(textarea(page)).toBeVisible({ timeout: 30_000 });
}

async function send(
  page: import("@playwright/test").Page,
  message: string
): Promise<void> {
  await textarea(page).fill(message);
  await page.getByTestId("ai-chat-send").click();
}

async function requestCount(fakeAi: {
  getRequests(): Promise<readonly unknown[]>;
}): Promise<number> {
  return (await fakeAi.getRequests()).length;
}

test.describe("workspace rollout drill (A02, design §23.1–23.3)", () => {
  test.afterEach(({ aiApp }: { aiApp?: LaunchedApp }) => {
    if (aiApp) {
      assertCleanTeardown(aiApp);
    }
  });

  test("mount lands the DEFAULT (explicit) and gets adapters-on", async ({
    aiApp,
  }) => {
    await openWorkspace(aiApp.mainWindow);
    // Mount-time enforcement persists the DEFAULT ("true") when the
    // preference is unset; wait for that write to settle so the recorded
    // choice is deterministic from here on.
    await expect
      .poll(() => invokeFlag(aiApp.mainWindow, "ai-chat-workspace:get-flag"), {
        timeout: 20_000,
      })
      .toMatchObject({
        status: true,
        data: {
          enabled: true,
          explicit: true,
          adapters: {
            sharedOrchestration: true,
            specializedResults: true,
            voiceMemory: true,
          },
        },
      });
  });

  test("explicit rollback survives a reload and the real V2 entry stays reachable", async ({
    aiApp,
  }) => {
    await openWorkspace(aiApp.mainWindow);
    const set = await invokeFlag(aiApp.mainWindow, "ai-chat-workspace:set-flag", {
      enabled: false,
      feature: "redesign",
    });
    expect(set.status).toBe(true);
    expect(set.data?.feature).toBe("redesign");

    // Reload the renderer: the workspace remounts (the app boots on the
    // default route) and must NOT overwrite the rollback.
    await aiApp.mainWindow.reload();
    await openWorkspace(aiApp.mainWindow);
    const afterReload = await invokeFlag(
      aiApp.mainWindow,
      "ai-chat-workspace:get-flag"
    );
    expect(afterReload.data?.enabled).toBe(false);
    expect(afterReload.data?.explicit).toBe(true);

    // Real V2 entry: the durable rollback state must leave the legacy Chat
    // V2 dock (layout.vue, design §27 rollback window) reachable. The shell
    // boundary itself is a renderer-local localStorage control, so an
    // operator reaches the legacy layout by toggling it off FIRST — same
    // mechanism the composable documents (§30.2 single-toggle rollback).
    await aiApp.mainWindow.evaluate(() => {
      localStorage.setItem("aifetchly.innerPageShellV3", "false");
    });
    await aiApp.mainWindow.reload();
    // The legacy layout's app-bar owns the chat toggle when the shell is
    // rolled back; with the redesign flag explicitly off the dock opens
    // on top of the legacy page.
    const chatToggle = aiApp.mainWindow.locator(
      "header button:has(i.mdi-chat), .v-app-bar button:has(i.mdi-chat)"
    );
    await chatToggle.first().click({ timeout: 20_000 });
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-root")
    ).toBeVisible({ timeout: 20_000 });
  });

  test("restore after rollback re-arms the workspace route", async ({
    aiApp,
  }) => {
    await openWorkspace(aiApp.mainWindow);
    await invokeFlag(aiApp.mainWindow, "ai-chat-workspace:set-flag", {
      enabled: false,
      feature: "redesign",
    });
    const restore = await invokeFlag(
      aiApp.mainWindow,
      "ai-chat-workspace:set-flag",
      { enabled: true, feature: "redesign" }
    );
    expect(restore.status).toBe(true);

    await aiApp.mainWindow.reload();
    await openWorkspace(aiApp.mainWindow);
    const state = await invokeFlag(aiApp.mainWindow, "ai-chat-workspace:get-flag");
    expect(state.data?.enabled).toBe(true);
    expect(state.data?.explicit).toBe(true);
    // No duplicate DEFAULT write raced the restore: still explicitly true.
    await expect(
      aiApp.mainWindow.getByTestId("workspace-new-chat")
    ).toBeVisible({ timeout: 20_000 });
  });

  test("shared-orchestration rollback preserves pending identity, stop and clean resume", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-delayed");
    await openChat(aiApp.mainWindow);

    await send(aiApp.mainWindow, "adapting around turn A");
    await send(aiApp.mainWindow, "queued B behind A");
    const pending = aiApp.mainWindow.getByTestId("ai-chat-pending-message");
    await expect(pending).toBeVisible({ timeout: 15_000 });

    // Roll back ONE adapter while the durable queue is carrying work.
    const set = await invokeFlag(aiApp.mainWindow, "ai-chat-workspace:set-flag", {
      enabled: false,
      feature: "shared_orchestration",
    });
    expect(set.status).toBe(true);

    // §23.2 presentation-only: pending identity and transcript survive.
    await expect(pending).toBeVisible();
    const transcript = aiApp.mainWindow
      .getByTestId("workspace-transcript")
      .first();
    await expect(transcript).toContainText("adapting around turn A");

    // Queue stop still works (durable machinery untouched by the adapter).
    await aiApp.mainWindow.getByTestId("ai-chat-stop").click();
    await expect(pending).toContainText("Queue paused", { timeout: 20_000 });
    await aiApp.mainWindow.waitForTimeout(2_000);
    expect(await requestCount(fakeAi)).toBe(1);

    // Resume drains B exactly once.
    await aiApp.mainWindow.getByTestId("ai-chat-pending-resume").click();
    await expect.poll(() => requestCount(fakeAi), { timeout: 60_000 }).toBe(2);
    await expect(pending).toHaveCount(0, { timeout: 45_000 });

    // Re-enable the adapter: no duplicate dispatch may appear, and the
    // next send dispatches normally.
    const restore = await invokeFlag(
      aiApp.mainWindow,
      "ai-chat-workspace:set-flag",
      { enabled: true, feature: "shared_orchestration" }
    );
    expect(restore.status).toBe(true);
    await aiApp.mainWindow.waitForTimeout(3_000);
    expect(await requestCount(fakeAi)).toBe(2);

    await send(aiApp.mainWindow, "restored orchestration C");
    await expect.poll(() => requestCount(fakeAi), { timeout: 45_000 }).toBe(3);
    await expect(aiApp.mainWindow.getByTestId("ai-chat-pending-message")).toHaveCount(0, {
      timeout: 60_000,
    });
  });

  test("voice/memory adapter hides composer voice controls after relaunch", async ({
    aiApp,
  }) => {
    await openWorkspace(aiApp.mainWindow);
    await expect(
      aiApp.mainWindow.getByTestId("spoken-response-toggle")
    ).toBeVisible({ timeout: 20_000 });

    const set = await invokeFlag(aiApp.mainWindow, "ai-chat-workspace:set-flag", {
      enabled: false,
      feature: "voice_memory",
    });
    expect(set.status).toBe(true);

    // The composable hydrated the ON state at mount; an operator's
    // relaunch re-hydrates — the control is hidden without touching
    // speech policy or memory machinery.
    await aiApp.mainWindow.reload();
    await openWorkspace(aiApp.mainWindow);
    await expect(
      aiApp.mainWindow.getByTestId("spoken-response-toggle")
    ).toHaveCount(0);

    // Memory allowed at the storage level stays: opening memory through
    // the badge is unavailable, but a stale registry query is inert
    // (openWorkspaceMemory guard). Voice policy gate itself stays governed
    // by its own module (out of scope here).
    const restore = await invokeFlag(
      aiApp.mainWindow,
      "ai-chat-workspace:set-flag",
      { enabled: true, feature: "voice_memory" }
    );
    expect(restore.status).toBe(true);
    await aiApp.mainWindow.reload();
    await openWorkspace(aiApp.mainWindow);
    await expect(
      aiApp.mainWindow.getByTestId("spoken-response-toggle")
    ).toBeVisible({ timeout: 20_000 });
  });

  test("specialized-results adapter swaps artifacts panel for the fallback; activity stays", async ({
    aiApp,
  }) => {
    await openWorkspace(aiApp.mainWindow);
    await aiApp.mainWindow
      .getByTestId("workspace-inspector-toggle")
      .click();
    const artifactsTab = aiApp.mainWindow.getByTestId(
      "workspace-inspector-tab-artifacts"
    );
    await artifactsTab.click();
    // Adapter ON: a real artifacts panel renders (may be empty — no data
    // seeded) and no fallback notice shows.
    await expect(
      aiApp.mainWindow.getByTestId("workspace-inspector-artifacts-fallback")
    ).toHaveCount(0);

    const set = await invokeFlag(aiApp.mainWindow, "ai-chat-workspace:set-flag", {
      enabled: false,
      feature: "specialized_results",
    });
    expect(set.status).toBe(true);
    await aiApp.mainWindow.reload();
    await openWorkspace(aiApp.mainWindow);
    // The inspector persists its open/active-tab state across reloads; the
    // fallback overlay covers the page, so ensure it is open WITHOUT a
    // toggle click when already visible.
    const inspector = aiApp.mainWindow.getByTestId("workspace-inspector");
    if (!(await inspector.isVisible())) {
      await aiApp.mainWindow.getByTestId("workspace-inspector-toggle").click();
    }
    // Activate artifacts regardless of the persisted active tab; tab
    // buttons live INSIDE the inspector overlay so they stay clickable.
    await aiApp.mainWindow
      .getByTestId("workspace-inspector-tab-artifacts")
      .click();
    await expect(
      aiApp.mainWindow.getByTestId("workspace-inspector-artifacts-fallback")
    ).toBeVisible({ timeout: 20_000 });
    // Localized notice renders translated text, not a raw key (i18n rule).
    await expect(
      aiApp.mainWindow.getByTestId("workspace-inspector-artifacts-fallback")
    ).not.toContainText("artifactsDisabled");

    // Activity tab is NOT among the gated specialized results (tab button
    // inside the overlay; its panel replaces the artifacts body).
    await aiApp.mainWindow.getByTestId("workspace-inspector-tab-activity").click();
    await expect(
      aiApp.mainWindow.getByTestId("workspace-inspector-artifacts-fallback")
    ).toHaveCount(0);
    await expect(
      aiApp.mainWindow.getByTestId("workspace-inspector-tab-activity")
    ).toBeVisible({ timeout: 10_000 });

    const restore = await invokeFlag(
      aiApp.mainWindow,
      "ai-chat-workspace:set-flag",
      { enabled: true, feature: "specialized_results" }
    );
    expect(restore.status).toBe(true);
    await aiApp.mainWindow.reload();
    await openWorkspace(aiApp.mainWindow);
    const inspectorRestored = aiApp.mainWindow.getByTestId("workspace-inspector");
    if (!(await inspectorRestored.isVisible())) {
      await aiApp.mainWindow.getByTestId("workspace-inspector-toggle").click();
    }
    await aiApp.mainWindow
      .getByTestId("workspace-inspector-tab-artifacts")
      .click();
    await expect(
      aiApp.mainWindow.getByTestId("workspace-inspector-artifacts-fallback")
    ).toHaveCount(0);
  });
});
