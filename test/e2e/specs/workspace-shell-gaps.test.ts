import { e2eTest as test, expect } from "../fixtures/base";
import { warmLazyRouteModules } from "../support/devServerWarmup";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";

/**
 * Gap-closing shell E2E matrix (PRD §26.4 / acceptance criteria 4, 10, 12,
 * 21, 22, 25, 35; FR-QUAL-004/005). Deterministic and provider-independent:
 * workspace approval goes through the stubbed folder dialog, conversation
 * selection uses the real sidebar rows, drafts survive inner-page round
 * trips through the app-scoped store, and the accessibility checks measure
 * the real rendered geometry.
 */

test.beforeAll(() => warmLazyRouteModules());

async function openWorkspace(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.goto("http://127.0.0.1:5173/#/aiworkspace");
  await expect(page.getByTestId("chat-center-surface")).toBeVisible({
    timeout: 20_000,
  });
}

function composerTextarea(
  page: import("@playwright/test").Page
): import("@playwright/test").Locator {
  return page
    .getByTestId("ai-chat-composer")
    .locator("textarea.v-field__input:not(.v-textarea__sizer)");
}

test.describe("workspace chooser (acceptance criteria 9/10/12, FR-WS-004)", () => {
  test("choosing and approving a workspace updates the badge state", async ({
    page: _page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
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
        dialogResponses: {
          open: { action: "confirmed", paths: [root.workspacePath] },
        },
      });
      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        const page = app.mainWindow;
        await openWorkspace(page);
        await page.getByTestId("workspace-new-chat").click();
        await expect(composerTextarea(page)).toBeVisible({ timeout: 10_000 });

        // No workspace: the explicit Choose action is offered (criterion 10).
        await expect(page.getByTestId("workspace-badge-choose")).toBeVisible();
        await page.getByTestId("workspace-badge-choose").click();

        // Pick folder through the real required-card flow + stubbed dialog.
        const card = page.getByTestId("workspace-required");
        await expect(card).toBeVisible({ timeout: 10_000 });
        await card.getByRole("button", { name: /pick folder/i }).click();

        // Approved state is shown above the transcript with name + status
        // text (criterion 9, FR-QUAL-004: never color alone).
        const badge = page.getByTestId("workspace-badge");
        await expect(badge).toBeVisible({ timeout: 15_000 });
        await expect(badge.locator(".workspace-badge__status")).toHaveText(
          /approved/i,
          { timeout: 15_000 }
        );
        await expect(page.getByTestId("workspace-badge-change")).toBeVisible();
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });
});

test.describe("conversation selection from an inner page (criterion 4)", () => {
  test("selecting a conversation row returns the center to that chat", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.getByTestId("workspace-new-chat").click();
    await expect(composerTextarea(page)).toBeVisible({ timeout: 10_000 });

    // New chats land in the collapsed "Other chats" folder — expand it so
    // the conversation row is in the DOM.
    await page.locator('[data-nav-row="unassigned"]').click();
    const rowTestid = await page.evaluate(() => {
      const row = document.querySelector(
        '[data-testid^="workspace-conversation-v2-"]'
      );
      return row ? row.getAttribute("data-testid") : null;
    });
    expect(rowTestid).toMatch(/^workspace-conversation-v2-/);

    await page.getByTestId("workspace-plugins").click();
    await expect(page.getByTestId("chat-center-surface")).toBeHidden();

    // FR-SHELL-008: while an inner route is current, the retained selected
    // conversation is NOT simultaneously exposed as current — the inner nav
    // item holds aria-current="page" and the row keeps only aria-selected.
    const rowOnInner = page.getByTestId(String(rowTestid));
    await expect(rowOnInner).toHaveAttribute("aria-selected", "true");
    await expect(rowOnInner).not.toHaveAttribute("aria-current");
    await expect(page.getByTestId("workspace-plugins")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await rowOnInner.click();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();
    await expect(composerTextarea(page)).toBeVisible({ timeout: 10_000 });
    // Back on the chat route the selected conversation becomes current.
    await expect(page.getByTestId(String(rowTestid))).toHaveAttribute(
      "aria-current",
      "true"
    );
  });
});

test.describe("draft continuity (FR-COMP-011, criterion 21)", () => {
  test("an unsent draft is restored after an inner-page round trip", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.getByTestId("workspace-new-chat").click();
    const textarea = composerTextarea(page);
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill("draft survives the round trip");

    // New chats land in the collapsed "Other chats" folder — expand it now so
    // the sidebar row is clickable when we come back from the inner page.
    await page.locator('[data-nav-row="unassigned"]').click();

    await page.getByTestId("workspace-insights").click();
    await expect(page.getByTestId("chat-center-surface")).toBeHidden();

    // Return to the SAME conversation via its sidebar row (the folder stays
    // expanded across center-route changes — the sidebar never remounts).
    const rowTestid = await page.evaluate(() => {
      const row = document.querySelector(
        '[data-testid^="workspace-conversation-v2-"]'
      );
      return row ? row.getAttribute("data-testid") : null;
    });
    expect(rowTestid).toBeTruthy();
    await page.getByTestId(String(rowTestid)).click();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();
    await expect(await composerTextarea(page).inputValue()).toBe(
      "draft survives the round trip"
    );
  });
});

test.describe("browser history navigation (criterion 7)", () => {
  test("back/forward never duplicates the shell surfaces", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.getByTestId("workspace-insights").click();
    await expect(page.getByTestId("workspace-insights")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.goBack();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible();
    expect(await page.getByTestId("workspace-tree").count()).toBe(1);
    expect(await page.getByTestId("app-center-route-host").count()).toBe(1);

    await page.goForward();
    await expect(page.getByTestId("workspace-insights")).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(await page.getByTestId("workspace-tree").count()).toBe(1);
    expect(await page.getByTestId("app-center-route-host").count()).toBe(1);
  });
});

test.describe("window restoration (FR-WIN-007, criterion 35)", () => {
  test("deterministic maximized startup keeps valid normal bounds", async ({
    page: _page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
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
      });
      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        initialMaximized: true,
      });
      try {
        const page = app.mainWindow;
        await openWorkspace(page);
        // The E2E X server runs WITHOUT a window manager, so EWMH maximized
        // state is not observable here (isMaximized() stays false even after
        // win.maximize()). Assert the observable launch contract instead:
        // the env reached the main process (the unit test proves
        // resolveInitialState then returns maximized: true and background
        // applies it before the first show), and the restore-down bounds
        // stay the deterministic valid size.
        const envApplied = await app.electronApp.evaluate(
          () => process.env.AIFETCHLY_E2E_INITIAL_MAXIMIZED ?? "(unset)"
        );
        expect(envApplied).toBe("1");
        const geometry = await app.electronApp.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          return win.getNormalBounds();
        });
        expect(geometry.width).toBe(1280);
        expect(geometry.height).toBe(800);
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });
});

test.describe("voice visibility (FR-VOICE-001/005, criterion 22/25)", () => {
  test("spoken-response toggle is visible and the microphone appears when enabled", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.getByTestId("workspace-new-chat").click();
    await expect(composerTextarea(page)).toBeVisible({ timeout: 10_000 });

    // Spoken-response toggle is always part of the composer toolbar.
    await expect(page.getByTestId("spoken-response-toggle")).toBeVisible();

    // Enable push-to-talk through the real settings IPC, then reload so the
    // composer re-runs loadSettings: the microphone must appear (criterion
    // 22) rather than being hidden by default policy.
    await page.evaluate(async () => {
      const api = (
        window as unknown as {
          api: {
            invoke: (c: string, d?: unknown) => Promise<unknown>;
          };
        }
      ).api;
      await api.invoke(
        "ai-chat-v2:voice-set-settings",
        JSON.stringify({
          inputMode: "push_to_talk",
          ttsMode: "disabled",
          autoSendTranscript: false,
          sttLanguage: "auto",
          ttsLanguage: "auto",
          sttModelId: "stt",
          ttsModelId: "tts",
          ttsSpeed: 1,
          maxRecordingMs: 60000,
        })
      );
    });
    await page.reload();
    await expect(page.getByTestId("chat-center-surface")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("ai-chat-microphone")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("accessibility contract (PRD §16.4/§21, FR-QUAL-004)", () => {
  test("the narrow navigation opener is at least 40x40px", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.setViewportSize({ width: 700, height: 800 });
    const toggle = page.getByTestId("app-shell-nav-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
  });

  test("200% zoom keeps the shell operable without horizontal scrolling", async ({
    shellApp: app,
  }) => {
    const page = app.mainWindow;
    await openWorkspace(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const overflow = await page.evaluate(() => {
      document.body.style.zoom = "2";
      const body = document.body;
      return {
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
      };
    });
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Operability: the composer is still reachable and typable at 200%.
    const textarea = composerTextarea(page);
    await textarea.fill("typing at 200% zoom");
    expect(await textarea.inputValue()).toBe("typing at 200% zoom");
  });
});
