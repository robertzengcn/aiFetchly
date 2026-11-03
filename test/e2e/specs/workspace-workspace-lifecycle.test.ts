import { e2eTest as test, expect } from "../fixtures/base";
import { RENDERER_ORIGIN } from "../fixtures/types";
import { warmLazyRouteModules } from "../support/devServerWarmup";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import {
  seedAgentTasks,
  readAgentTaskStatuses,
} from "../support/agentTaskSeed";
import * as fs from "fs";
import * as path from "path";

/**
 * Workspace lifecycle E2E over the DEFAULT surface (FR-WSP-002, TRS-03/07,
 * FR-INT-003): choose → approved, change via the badge (second pick through
 * the stubbed dialog FIFO), remove via the badge affordance, untrusted
 * instructions → trust card → "Trust instructions only", and the
 * selected-live open_app_page navigation.
 *
 * Everything is deterministic: the folder dialog is answered from the state
 * manifest (multi-path entries are served pick-in-order), the AI provider is
 * the fake OpenAI server, and the navigation tool is a pure built-in skill.
 */

test.beforeAll(() => warmLazyRouteModules());

function composerTextarea(
  page: import("@playwright/test").Page
): import("@playwright/test").Locator {
  return page
    .getByTestId("ai-chat-composer")
    .locator("textarea.v-field__input:not(.v-textarea__sizer)");
}

async function openCenter(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.goto(`${RENDERER_ORIGIN}/#/aiworkspace`);
  await expect(page.getByTestId("chat-center-surface")).toBeVisible({
    timeout: 20_000,
  });
}

async function pickFolderFromCard(
  page: import("@playwright/test").Page
): Promise<void> {
  const card = page.getByTestId("workspace-required");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole("button", { name: /pick folder/i }).click();
}

test.describe("workspace lifecycle through the default surface", () => {
  test("choose, change, and remove a workspace updates the badge through each canonical flow (FR-WSP-002)", async ({}, testInfo) => {
    test.setTimeout(210_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    const alpha = path.join(root.workspacePath, "projects-alpha");
    const beta = path.join(root.workspacePath, "projects-beta");
    fs.mkdirSync(alpha, { recursive: true });
    fs.mkdirSync(beta, { recursive: true });
    try {
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
        // FIFO dialog queue: pick #1 → projects-alpha, pick #2 → projects-beta.
        dialogResponses: {
          open: { action: "confirmed", paths: [alpha, beta] },
        },
      });
      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        const page = app.mainWindow;
        await openCenter(page);
        await page.getByTestId("workspace-new-chat").click();
        await expect(composerTextarea(page)).toBeVisible({ timeout: 10_000 });

        // CHOOSE leg (pick #1): unset badge → card → approved with root A.
        await expect(page.getByTestId("workspace-badge-choose")).toBeVisible();
        await page.getByTestId("workspace-badge-choose").click();
        await pickFolderFromCard(page);
        const badge = page.getByTestId("workspace-badge");
        await expect(badge).toBeVisible({ timeout: 15_000 });
        await expect(badge).toHaveAttribute("title", /projects-alpha/, {
          timeout: 15_000,
        });
        await expect(badge.locator(".workspace-badge__status")).toHaveText(
          /approved/i,
          { timeout: 15_000 }
        );

        // The remove affordance is present for an approved workspace.
        await expect(page.getByTestId("workspace-badge-remove")).toBeVisible();

        // CHANGE leg (pick #2): the badge's path button reopens the setup
        // flow and the second dialog pick binds projects-beta.
        await page.getByTestId("workspace-badge-path").click();
        await pickFolderFromCard(page);
        await expect(badge).toHaveAttribute("title", /projects-beta/, {
          timeout: 15_000,
        });
        await expect(badge.locator(".workspace-badge__status")).toHaveText(
          /approved/i,
          { timeout: 15_000 }
        );
        await expect(page.getByTestId("workspace-badge-unset")).toHaveCount(0);

        // REMOVE leg: the remove affordance revokes the binding and the badge
        // returns to its unset state with a fresh explicit Choose action.
        await page.getByTestId("workspace-badge-remove").click();
        await expect(page.getByTestId("workspace-badge-unset")).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByTestId("workspace-badge-remove")).toHaveCount(0);
        await expect(page.getByTestId("workspace-badge-choose")).toBeVisible();
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });

  test("untrusted workspace instructions surface the trust card and trusting instructions dismisses it (TRS-03/07)", async ({}, testInfo) => {
    test.setTimeout(210_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    const alpha = path.join(root.workspacePath, "projects-instruct");
    fs.mkdirSync(path.join(alpha, ".aifetchly"), { recursive: true });
    fs.writeFileSync(
      path.join(alpha, ".aifetchly", "AGENTS.md"),
      "# Workspace instructions\n- e2e trust journey marker\n",
      "utf8"
    );
    try {
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
        dialogResponses: {
          open: { action: "confirmed", paths: [alpha] },
        },
      });
      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        const page = app.mainWindow;
        await openCenter(page);
        await page.getByTestId("workspace-new-chat").click();
        await expect(composerTextarea(page)).toBeVisible({ timeout: 10_000 });
        const textarea = composerTextarea(page);

        // Persist the conversation row first (watchers bind by the
        // conversation id; the chat row materializes on first send).
        await textarea.fill(`setup ${Date.now()}`);
        await page.getByTestId("ai-chat-send").click();
        await expect(page.getByTestId("workspace-transcript")).toContainText(
          "Hello world!",
          { timeout: 30_000 }
        );

        await page.getByTestId("workspace-badge-choose").click();
        await pickFolderFromCard(page);
        const badge = page.getByTestId("workspace-badge");
        await expect(badge).toBeVisible({ timeout: 15_000 });
        await expect(badge.locator(".workspace-badge__status")).toHaveText(
          /approved/i,
          { timeout: 15_000 }
        );

        // The trust card mounts with the untrusted instructions; the preview
        // shows the AGENTS.md body read by the main process (TRS-07: the
        // renderer never receives a path).
        await expect(
          page.getByTestId("trust-card-trust-instructions-btn")
        ).toBeVisible({ timeout: 20_000 });
        await page.getByTestId("trust-card-preview-btn").click();
        await expect(
          page.getByTestId("trust-card-preview-content")
        ).toContainText("e2e trust journey marker", { timeout: 10_000 });

        // Trust instructions only → the card is dismissed for the session.
        await page.getByTestId("trust-card-trust-instructions-btn").click();
        await expect(
          page.getByTestId("trust-card-trust-instructions-btn")
        ).toHaveCount(0, { timeout: 15_000 });
        await expect(badge.locator(".workspace-badge__status")).toHaveText(
          /approved/i,
          { timeout: 15_000 }
        );
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });

  test("selected-live navigation opens the email service page through the open_app_page tool result (FR-INT-003)", async ({}, testInfo) => {
    test.setTimeout(210_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    const alpha = path.join(root.workspacePath, "projects-nav");
    fs.mkdirSync(alpha, { recursive: true });
    try {
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
        dialogResponses: {
          open: { action: "confirmed", paths: [alpha] },
        },
      });
      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        const page = app.mainWindow;
        await openCenter(page);
        await page.getByTestId("workspace-new-chat").click();
        const textarea = composerTextarea(page);
        await expect(textarea).toBeVisible({ timeout: 10_000 });

        // Warm the send pipeline with a plain streamed exchange first.
        await textarea.fill(`warm up ${Date.now()}`);
        await page.getByTestId("ai-chat-send").click();
        await expect(page.getByTestId("workspace-transcript")).toContainText(
          "Hello world!",
          { timeout: 30_000 }
        );

        // The next model round is scripted to call the pure built-in
        // navigation skill — no approval is required (permissionCategory
        // "pure"), and the live sink resolves the selected route.
        await fakeAi.setToolCall(
          "open_app_page",
          JSON.stringify({ query: "open the email service list page" })
        );
        await textarea.fill("take me to the email service page");
        await page.getByTestId("ai-chat-send").click();
        await expect(page).toHaveURL(/emailmarketing\/emailservice\/list/, {
          timeout: 30_000,
        });
        await expect(page.getByTestId("app-page-shell")).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByTestId("app-page-title")).toHaveText(
          /email service/i,
          { timeout: 15_000 }
        );
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });

  test("workspace-scoped slash suggestions register with the approved workspace and drop after removal (FR-SUB scope, Phase-14 D-TrustUX)", async ({}, testInfo) => {
    test.setTimeout(210_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    const alpha = path.join(root.workspacePath, "projects-cmds");
    fs.mkdirSync(path.join(alpha, ".aifetchly", "commands"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(alpha, ".aifetchly", "commands", "wslintpatch.md"),
      "---\nname: wslintpatch\ndescription: e2e workspace slash journey\ntype: prompt\n---\nLint and patch $ARGUMENTS\n",
      "utf8"
    );
    try {
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
        dialogResponses: {
          open: { action: "confirmed", paths: [alpha] },
        },
      });
      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        const page = app.mainWindow;
        await openCenter(page);
        await page.getByTestId("workspace-new-chat").click();
        const textarea = composerTextarea(page);
        await expect(textarea).toBeVisible({ timeout: 10_000 });

        // Persist the conversation row; the scope is resolved per bound
        // conversation.
        await textarea.fill(`setup ${Date.now()}`);
        await page.getByTestId("ai-chat-send").click();
        await expect(page.getByTestId("workspace-transcript")).toContainText(
          "Hello world!",
          { timeout: 30_000 }
        );

        // Approve the workspace. Approval is the only trust gate — commands
        // register through the D-TrustUX single gate (no AGENTS.md here).
        await page.getByTestId("workspace-badge-choose").click();
        await pickFolderFromCard(page);
        const badge = page.getByTestId("workspace-badge");
        await expect(badge).toBeVisible({ timeout: 15_000 });
        await expect(badge.locator(".workspace-badge__status")).toHaveText(
          /approved/i,
          { timeout: 15_000 }
        );

        // Typing "/wslint…" opens the dropdown; only an APPROVED workspace's
        // commands reach the scope (the resolver reads the bound conversation
        // from the module, not the renderer).
        const suggestions = page.locator(".slash-suggestions");
        await textarea.fill("/wslint");
        await expect(
          suggestions.locator(".slash-suggestions__name").filter({
            hasText: "/wslintpatch",
          })
        ).toBeVisible({ timeout: 20_000 });

        // Removing the workspace unbinds the conversation; a fresh slash
        // query must no longer return the workspace-sourced command.
        await textarea.fill("");
        await page.getByTestId("workspace-badge-remove").click();
        await expect(page.getByTestId("workspace-badge-unset")).toBeVisible({
          timeout: 15_000,
        });
        await textarea.fill("/wslint");
        await expect(suggestions).toBeVisible({ timeout: 10_000 });
        await expect(
          suggestions.locator(".slash-suggestions__name").filter({
            hasText: "/wslintpatch",
          })
        ).toHaveCount(0, { timeout: 10_000 });
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });
  test("live watcher events refresh an open slash dropdown without keystrokes (Phase-14 D-04 watcher-status)", async ({}, testInfo) => {
    test.setTimeout(210_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    const alpha = path.join(root.workspacePath, "projects-watch");
    const commandsDir = path.join(alpha, ".aifetchly", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    const seedPath = path.join(commandsDir, "wssteady.md");
    fs.writeFileSync(
      seedPath,
      "---\nname: wssteady\ndescription: stationary watcher command\ntype: prompt\n---\nSteady $ARGUMENTS\n",
      "utf8"
    );
    try {
      writeStateManifest(root, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: root.workspacePath,
        dialogResponses: {
          open: { action: "confirmed", paths: [alpha] },
        },
      });
      const app = await launchAiFetchly({
        testRoot: root,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      try {
        const page = app.mainWindow;
        await openCenter(page);
        await page.getByTestId("workspace-new-chat").click();
        const textarea = composerTextarea(page);
        await expect(textarea).toBeVisible({ timeout: 10_000 });

        // Persist the conversation row first.
        await textarea.fill(`setup ${Date.now()}`);
        await page.getByTestId("ai-chat-send").click();
        await expect(page.getByTestId("workspace-transcript")).toContainText(
          "Hello world!",
          { timeout: 30_000 }
        );

        // Approve — approval spawns the watch (acquire is chat-open; the
        // references land once the renderer binds the conversation).
        await page.getByTestId("workspace-badge-choose").click();
        await pickFolderFromCard(page);
        const badge = page.getByTestId("workspace-badge");
        await expect(badge).toBeVisible({ timeout: 15_000 });
        await expect(badge.locator(".workspace-badge__status")).toHaveText(
          /approved/i,
          { timeout: 15_000 }
        );

        // Seed the dropdown from the pre-existing command.
        const suggestions = page.locator(".slash-suggestions");
        await textarea.fill("/ws");
        await expect(
          suggestions.locator(".slash-suggestions__name").filter({
            hasText: "/wssteady",
          })
        ).toBeVisible({ timeout: 20_000 });

        // DROP a new command file while the dropdown is open — the workspace
        // watcher (.aifetchly/**, awaitWriteFinish 500ms) must turn the file
        // event into AIFETCHLY_CONFIG_CHANGED and the composer refreshes the
        // OPEN dropdown without any further keystrokes.
        const addedPath = path.join(commandsDir, "wsquiver.md");
        await page.evaluate(() => {
          const w = window as unknown as {
            api: {
              receive: (c: string, cb: (...a: unknown[]) => void) => void;
            };
            __configEvents?: string[];
          };
          w.__configEvents = [];
          w.api.receive("aifetchly-config:changed", (...args: unknown[]) => {
            if (w.__configEvents) {
              w.__configEvents.push(String(args[0]));
            }
          });
        });
        fs.writeFileSync(
          addedPath,
          "---\nname: wsquiver\ndescription: watcher live add probe\ntype: prompt\n---\nQuiver $ARGUMENTS\n",
          "utf8"
        );
        await expect(
          suggestions.locator(".slash-suggestions__name").filter({
            hasText: "/wsquiver",
          })
        ).toBeVisible({ timeout: 40_000 });

        // Delete it — the watcher must drop it from the still-open dropdown.
        fs.unlinkSync(addedPath);
        await expect(
          suggestions.locator(".slash-suggestions__name").filter({
            hasText: "/wsquiver",
          })
        ).toHaveCount(0, { timeout: 40_000 });
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });
  test("background agent tasks cancel EXACTLY the targeted task from the surface menu (FR-INT-004, T5/D7)", async ({}, testInfo) => {
    test.setTimeout(210_000);
    const fakeAi = await startFakeOpenAiServer();
    await fakeAi.setScenario("stream-text");
    const root = createTemporaryRoot({
      testId: testInfo.titlePath.join(" "),
      workerIndex: testInfo.workerIndex,
    });
    fs.mkdirSync(root.workspacePath, { recursive: true });
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
        await openCenter(page);
        await page.getByTestId("workspace-new-chat").click();
        await expect(composerTextarea(page)).toBeVisible({
          timeout: 10_000,
        });

        // Two seeded rows: only the running one offers the surface cancel; the
        // completed sibling must survive the cancellation untouched.
        await seedAgentTasks(root, [
          {
            agentTaskId: "agt-run-e2e",
            agentId: "lint-reviewer",
            status: "running",
          },
          {
            agentTaskId: "agt-done-e2e",
            agentId: "summarizer",
            status: "completed",
          },
        ]);

        // The task list opens from the conversation-header overflow menu.
        // The old title-attribute activator button is gone.
        await page.getByTestId("workspace-header-overflow").click();
        const agents = page.getByTestId("workspace-overflow-agent-tasks");
        await expect(agents).toBeVisible({ timeout: 10_000 });
        await agents.click();

        // The list loads through the real agent-runtime channel: both rows are
        // rendered with their exact agent ids.
        await expect(page.getByText("lint-reviewer")).toBeVisible({
          timeout: 15_000,
        });
        await expect(page.getByText("summarizer")).toBeVisible();

        // Only the running row exposes the cancel affordance.
        const runningItem = page
          .locator(".agent-task-item")
          .filter({ hasText: "lint-reviewer" });
        const doneItem = page
          .locator(".agent-task-item")
          .filter({ hasText: "summarizer" });
        await runningItem.getByTitle("Cancel", { exact: true }).click();

        // Poll refresh (5s) flips the chip to Cancelled inside the open menu.
        await expect(runningItem.locator(".v-chip")).toHaveText(/cancelled/i, {
          timeout: 12_000,
        });

        const statuses = await readAgentTaskStatuses(root, [
          "agt-run-e2e",
          "agt-done-e2e",
        ]);
        expect(statuses.get("agt-run-e2e")?.status).toBe("cancelled");
        expect(statuses.get("agt-run-e2e")?.finishedAt).toBeTruthy();
        expect(statuses.get("agt-done-e2e")?.status).toBe("completed");

        // The terminal sibling never re-opens a cancel affordance.
        await expect(
          doneItem.getByTitle("Cancel", { exact: true })
        ).toHaveCount(0);
      } finally {
        await closeApp(app);
      }
    } finally {
      await fakeAi.stop();
      root.remove();
    }
  });
});
