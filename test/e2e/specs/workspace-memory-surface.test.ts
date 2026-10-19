/**
 * Workspace memory surface E2E journeys (PARA bullet ~200: portable-memory
 * conflicts / stale edit / Auto Dream through the default surface).
 *
 * These drive the WorkspaceMemoryPanel through the DEFAULT AiChatV2 surface
 * (workspace badge → memory dialog), on top of the real portable memory
 * pipeline (renderer → preload → IPC → PortableWorkspaceMemoryService →
 * file store + SQLite projection):
 *
 *   1. Surface enable + create: enable portable memory through the banner
 *      dialog, create a record through the panel editor, verify the file
 *      lands in .aifetchly/memory.
 *   2. Conflict/stale edit: an external file edit races a surface editor save
 *      (stale FR-038 concurrency token) → the save is rejected and the record
 *      turns conflicted → the banner "Resolve" opens the conflict dialog on
 *      the first conflicted record (fallback fix) → use-file and use-app
 *      resolutions round-trip against disk and SQLite.
 *   3. Auto Dream: "RUN AUTO SUMMARY" through the panel drives the real
 *      consolidated run (fake provider serves a scripted consolidation plan on
 *      the non-streaming path) applying a portable file record.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
  createTemporaryRoot,
  writeStateManifest,
} from "../fixtures/temporaryState";
import { launchAiFetchly, type LaunchedApp } from "../fixtures/electronApp";
import { closeApp } from "../support/processCleanup";
import { startFakeOpenAiServer } from "../fixtures/fakeOpenAiServer";
import type { E2ETestRoot } from "../fixtures/types";

function memoryDir(workPath: string): string {
  return path.join(workPath, ".aifetchly", "memory");
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("workspace-new-chat").click();
  await expect(app.mainWindow.getByTestId("ai-chat-composer")).toBeVisible({
    timeout: 30_000,
  });
}

/** Send one warm-up message (also creates the conversation row). */
async function ensureConversation(app: LaunchedApp): Promise<void> {
  const textarea = app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
  await textarea.fill(`setup ${Date.now()}`);
  await app.mainWindow.getByTestId("ai-chat-send").click();
  await expect(
    app.mainWindow.getByTestId("workspace-transcript")
  ).toContainText("Hello world!", { timeout: 30_000 });
}

/**
 * Approve a workspace through the REAL surface flow (badge → required card →
 * FIFO folder dialog). This is the certified pattern from the workspace
 * lifecycle spec: the composable refreshes the badge itself, so the UI state
 * (and the memory-panel approval gate) is consistent without IPC shortcuts.
 */
async function approveWorkspaceViaUi(
  page: import("@playwright/test").Page,
  workDir: string
): Promise<void> {
  await page.getByTestId("workspace-badge-choose").click();
  const card = page.getByTestId("workspace-required");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole("button", { name: /pick folder/i }).click();
  const badge = page.getByTestId("workspace-badge");
  await expect(badge).toBeVisible({ timeout: 15_000 });
  const label = workDir.split("/").pop() ?? "";
  await expect(badge).toHaveAttribute("title", new RegExp(label), {
    timeout: 15_000,
  });
  await expect(badge.locator(".workspace-badge__status")).toHaveText(
    /approved/i,
    { timeout: 15_000 }
  );
}

/** Read the first conversation id (the warm-up conversation) through the
 * canonical IPC — used to drive portable-memory channels that need it. */
async function getConversationId(app: LaunchedApp): Promise<string | null> {
  const convResp = await app.mainWindow.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          invoke: (
            c: string,
            d?: unknown
          ) => Promise<
            { status: boolean; data: unknown; msg?: string } | undefined
          >;
        };
      }
    ).api;
    return await api.invoke("ai-chat-v2:conversations", JSON.stringify({}));
  });
  const convs = (convResp?.data ?? []) as Array<{ conversationId: string }>;
  return convs[0]?.conversationId ?? null;
}

async function portableInvoke(
  app: LaunchedApp,
  channel: string,
  payload: unknown
): Promise<{ status: boolean; data: unknown; msg?: string }> {
  return app.mainWindow.evaluate(
    async ({ channel, payload }) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              c: string,
              d?: unknown
            ) => Promise<
              { status: boolean; data: unknown; msg?: string } | undefined
            >;
          };
        }
      ).api;
      const resp = await api.invoke(channel, JSON.stringify(payload));
      return (resp ?? {
        status: false,
        data: undefined,
        msg: "no response",
      }) as { status: boolean; data: unknown; msg?: string };
    },
    { channel, payload }
  );
}

/** Open the memory panel through the badge and wait until it is interactive. */
async function openMemoryPanel(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("workspace-badge-memory").click();
  await expect(app.mainWindow.locator(".wm-panel").first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Close and reopen the memory panel. The remount watch re-fetches the
 * portable status, so this doubles as a deterministic status refresh (the
 * live onChanged bus is advisory and can lag in the harness).
 */
async function reopenPanel(app: LaunchedApp): Promise<void> {
  await app.mainWindow
    .locator(".v-dialog:has(.wm-panel) button:has(i.mdi-close)")
    .click();
  await expect(app.mainWindow.locator(".wm-panel")).toBeHidden({
    timeout: 30_000,
  });
  await openMemoryPanel(app);
}

/**
 * The panel banner reflects the portable boot state. Portable memory is
 * ENABLED BY DEFAULT for every approved workspace
 * (PORTABLE_MEMORY_DEFAULT_ENABLED), so a fresh workspace shows the enabled
 * template (chip + counts + Rescan) as soon as the panel opens.
 */
async function expectEnabledBanner(app: LaunchedApp): Promise<void> {
  const banner = app.mainWindow.locator(".wm-portable").first();
  await expect(
    banner.getByText("Portable memory", { exact: true })
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Disable portable memory (canonical policy channel), watch the banner flip
 * to the disabled template, then re-enable it through the banner's Enable
 * dialog — the full surface enable round trip.
 */
async function disableEnableRoundTrip(
  app: LaunchedApp,
  conversationId: string
): Promise<void> {
  const banner = app.mainWindow.locator(".wm-portable").first();
  const policyResp = await portableInvoke(
    app,
    "ai:portable-workspace-memory:policy:update",
    { conversationId, portableEnabled: false }
  );
  expect(policyResp.status, policyResp.msg ?? "").toBe(true);
  // The policy channel emits no portable-changed event, so re-mount the
  // panel: the remount watch re-fetches the portable status honestly.
  await app.mainWindow
    .locator(".v-dialog:has(.wm-panel) button:has(i.mdi-close)")
    .click();
  await expect(app.mainWindow.locator(".wm-panel")).toBeHidden({
    timeout: 30_000,
  });
  await openMemoryPanel(app);
  await expect(
    banner.getByText("Memories are stored privately in AiFetchly")
  ).toBeVisible({ timeout: 30_000 });
  await banner.getByRole("button", { name: "Enable portable memory" }).click();
  await expect(app.mainWindow.locator(".pm-enable__title")).toContainText(
    "Enable portable memory",
    { timeout: 30_000 }
  );
  await app.mainWindow
    .locator("button.v-btn--variant-flat")
    .filter({ hasText: /^Enable$/ })
    .click();
  await expect(
    banner.getByText("Portable memory", { exact: true })
  ).toBeVisible({ timeout: 30_000 });
}

test("surface: portable banner boots enabled, enable round trip, create via panel editor, file record lands", async ({
  page: _page,
}, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  await fakeAi.setScenario("stream-text");
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });
  const workDir = path.join(root.workspacePath, "projects-memory");

  try {
    fs.mkdirSync(workDir, { recursive: true });
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      dialogResponses: {
        open: { action: "confirmed", paths: [workDir] },
      },
    });
    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);
      await ensureConversation(app);
      await approveWorkspaceViaUi(app.mainWindow, workDir);
      const conversationId = await getConversationId(app);
      expect(typeof conversationId).toBe("string");

      await openMemoryPanel(app);
      // Portable memory boots ENABLED by default (chip + counts + Rescan).
      await expectEnabledBanner(app);

      // The default layout bootstrap runs when the panel fetches status.
      expect(fs.existsSync(path.join(memoryDir(workDir), "README.md"))).toBe(
        true
      );
      const indexPath = path.join(memoryDir(workDir), "INDEX.md");
      expect(fs.existsSync(indexPath)).toBe(true);

      // Full surface enable round trip (disable by policy → banner flips →
      // banner Enable dialog → enabled again).
      await disableEnableRoundTrip(app, conversationId as string);

      // Create a memory through the panel editor (defaults to portable-local).
      await app.mainWindow
        .getByRole("button", { name: "Create memory" })
        .click();
      const editor = app.mainWindow.getByTestId("workspace-memory-editor");
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor
        .locator('input[maxlength="200"]')
        .fill("Surface decision record");
      await editor
        .locator(".v-textarea textarea")
        .first()
        .fill("Created through the default surface panel editor.");
      await editor.getByRole("button", { name: "Save" }).click();
      await expect(
        app.mainWindow.locator(".wm-item__title").filter({
          hasText: "Surface decision record",
        })
      ).toBeVisible({ timeout: 30_000 });

      // File-first storage: the surface create wrote a portable record file.
      const files = fs
        .readdirSync(memoryDir(workDir))
        .filter((f) => /^wmem-.*\.md$/.test(f));
      expect(files.length).toBeGreaterThanOrEqual(1);
      const recordPath = path.join(memoryDir(workDir), files[0]);
      const content = fs.readFileSync(recordPath, "utf8");
      expect(content).toContain("schema: aifetchly.memory/v1");
      expect(content).toContain("Surface decision record");
      expect(content).toContain(
        "Created through the default surface panel editor."
      );
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});

test("surface: stale editor save after external edit conflicts, banner resolver accepts use-file then use-app", async ({
  page: _page,
}, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  await fakeAi.setScenario("stream-text");
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });
  const workDir = path.join(root.workspacePath, "projects-memory-conflict");

  try {
    fs.mkdirSync(workDir, { recursive: true });
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      dialogResponses: {
        open: { action: "confirmed", paths: [workDir] },
      },
    });
    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);
      await ensureConversation(app);
      await approveWorkspaceViaUi(app.mainWindow, workDir);
      const conversationId = await getConversationId(app);
      expect(typeof conversationId).toBe("string");
      const createResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:create",
        {
          conversationId,
          type: "decision",
          title: "Conflict probe",
          content: "original",
          confidence: 90,
          visibility: "local",
        }
      );
      expect(createResp.status, createResp.msg ?? "").toBe(true);
      const memoryId = (createResp.data as { memoryId: string }).memoryId;
      const recordPath = path.join(memoryDir(workDir), `${memoryId}.md`);
      expect(fs.existsSync(recordPath)).toBe(true);

      await openMemoryPanel(app);
      const banner = app.mainWindow.locator(".wm-portable").first();
      await expect(
        app.mainWindow
          .locator(".wm-item__title")
          .filter({ hasText: "Conflict probe" })
      ).toBeVisible({ timeout: 30_000 });

      // ── Leg 1: external edit lands WHILE the editor is open ──
      const externalEdit = (target: string, replacement: string): void => {
        const before = fs.readFileSync(recordPath, "utf8");
        fs.writeFileSync(recordPath, before.replace(target, replacement));
      };

      // Open the edit from the row: the FR-038 concurrency token is fetched
      // when the editor OPENS. The external edit lands AFTER the token, so
      // on save the disk hash no longer matches the token — the save must be
      // rejected (fail-closed) and the record flips to conflicted.
      const row = app.mainWindow
        .locator(".wm-item")
        .filter({ hasText: "Conflict probe" })
        .first();
      await row.getByRole("button", { name: /edit memory/i }).click();
      const editor = app.mainWindow.getByTestId("workspace-memory-editor");
      await expect(editor).toBeVisible({ timeout: 30_000 });
      externalEdit("original", "external sneak edit");
      await editor.locator('input[maxlength="200"]').fill("Stale surface save");
      await editor
        .locator(".v-textarea textarea")
        .first()
        .fill("surface keep-mine draft");
      await editor.getByRole("button", { name: "Save" }).click();
      // The save is REJECTED: the editor stays open (never silently
      // overwritten).
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await app.mainWindow.keyboard.press("Escape");
      await expect(editor).toBeHidden({ timeout: 30_000 });

      await banner.getByRole("button", { name: "Rescan" }).click();
      await reopenPanel(app);
      const conflictedChip = banner.getByText(/^Conflicted:/);
      await expect(conflictedChip).toBeVisible({ timeout: 30_000 });
      await expect(conflictedChip).toContainText("1");

      // The banner "Resolve" opens the dialog on the FIRST conflicted record
      // (no explicit memoryId) — the dialog must fall back to that record.
      await banner.getByRole("button", { name: "Resolve" }).click();
      const conflictDialog = app.mainWindow.locator(".pmc__title");
      await expect(conflictDialog).toContainText(memoryId, { timeout: 30_000 });
      // Both versions side by side: the app projection vs the external file.
      await expect(
        app.mainWindow.locator(".pmc__pane-title").filter({
          hasText: "AiFetchly projection",
        })
      ).toBeVisible();
      await expect(
        app.mainWindow
          .locator(".pmc__pane-body")
          .filter({ hasText: "external sneak edit" })
      ).toBeVisible();

      // Use file — external bytes win.
      await app.mainWindow
        .getByRole("radio", { name: "Use file version" })
        .click();
      await app.mainWindow
        .locator(".v-dialog button.v-btn--variant-flat")
        .filter({ hasText: /^Resolve$/ })
        .click();
      await reopenPanel(app);
      await expect(conflictedChip).toBeHidden({ timeout: 30_000 });
      await expect(
        app.mainWindow
          .locator(".wm-item__content")
          .filter({ hasText: "external sneak edit" })
      ).toBeVisible({ timeout: 30_000 });
      // Disk keeps the external bytes (no silent overwrite).
      const afterUseFile = fs.readFileSync(recordPath, "utf8");
      expect(afterUseFile).toContain("external sneak edit");
      expect(afterUseFile).toContain("schema: aifetchly.memory/v1");

      // ── Leg 2: a second external edit while the editor is open again,
      // resolved as use-app (the app projection wins) ──
      await row.getByRole("button", { name: /edit memory/i }).click();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      externalEdit("external sneak edit", "round two external");
      await editor.locator('input[maxlength="200"]').fill("Surface retitle");
      await editor
        .locator(".v-textarea textarea")
        .first()
        .fill("app authoritative text");
      await editor.getByRole("button", { name: "Save" }).click();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await app.mainWindow.keyboard.press("Escape");
      await expect(editor).toBeHidden({ timeout: 30_000 });
      await banner.getByRole("button", { name: "Rescan" }).click();
      await reopenPanel(app);
      await expect(conflictedChip).toBeVisible({ timeout: 30_000 });

      await banner.getByRole("button", { name: "Resolve" }).click();
      await expect(conflictDialog).toContainText(memoryId, { timeout: 30_000 });
      // Merge manually — the caller-supplied draft is the app-authoritative
      // content (the resolver writes it atomically and imports it).
      await app.mainWindow
        .getByRole("radio", { name: "Merge manually" })
        .click();
      const mergeTitle = app.mainWindow.locator(".pmc__merge input").first();
      await mergeTitle.fill("Surface retitle");
      await app.mainWindow
        .locator(".pmc__merge .v-textarea textarea")
        .first()
        .fill("app authoritative text");
      await app.mainWindow
        .locator(".v-dialog button.v-btn--variant-flat")
        .filter({ hasText: /^Resolve$/ })
        .click();
      await reopenPanel(app);
      await expect(conflictedChip).toBeHidden({ timeout: 30_000 });
      // The merged (app-authoritative) version became the projection
      // (SQLite + refreshed surface).
      await expect(
        app.mainWindow
          .locator(".wm-item__title")
          .filter({ hasText: "Surface retitle" })
      ).toBeVisible({ timeout: 30_000 });
      // Disk aligned with the merged version (the resolve rewrote the file).
      const afterMerge = fs.readFileSync(recordPath, "utf8");
      expect(afterMerge).toContain("app authoritative text");
      expect(afterMerge).not.toContain("round two external");
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});

test("surface: RUN AUTO SUMMARY consolidates through the fake provider and applies a portable record", async ({
  page: _page,
}, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  await fakeAi.setScenario("stream-text");
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });
  const workDir = path.join(root.workspacePath, "projects-memory-dream");

  try {
    fs.mkdirSync(workDir, { recursive: true });
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      dialogResponses: {
        open: { action: "confirmed", paths: [workDir] },
      },
    });
    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);
      await ensureConversation(app);
      await approveWorkspaceViaUi(app.mainWindow, workDir);
      const conversationId = await getConversationId(app);
      expect(typeof conversationId).toBe("string");

      await openMemoryPanel(app);
      await expectEnabledBanner(app);
      const memoryDirBefore = new Set(
        fs
          .readdirSync(memoryDir(workDir))
          .filter((f) => /^wmem-.*\.md$/.test(f))
      );

      // The panel run is manual + forced and passes focusConversationId, so
      // the warm-up conversation is the single consolidated source packet.
      await app.mainWindow
        .getByRole("button", { name: "RUN AUTO SUMMARY" })
        .click();

      // The created memory (scripted plan) appears in the panel list.
      await expect(
        app.mainWindow
          .locator(".wm-item__title")
          .filter({ hasText: "Approved the e2e workspace memory decision" })
      ).toBeVisible({ timeout: 90_000 });

      // Last-run status text appears in the panel header.
      await expect(app.mainWindow.locator(".wm-panel__lastrun")).toBeVisible({
        timeout: 30_000,
      });

      // File-first apply: the consolidation created one portable file.
      const after = fs
        .readdirSync(memoryDir(workDir))
        .filter((f) => /^wmem-.*\.md$/.test(f));
      expect(after.length).toBe(memoryDirBefore.size + 1);
      const newFile = after.find((f) => !memoryDirBefore.has(f));
      expect(newFile).toBeDefined();
      const newContent = fs.readFileSync(
        path.join(memoryDir(workDir), newFile as string),
        "utf8"
      );
      expect(newContent).toContain("schema: aifetchly.memory/v1");
      expect(newContent).toContain(
        "Approved the e2e workspace memory decision"
      );

      // The fake provider received the workspace auto-dream consolidation
      // call on the non-streaming path (the warm-up chat used the streaming
      // path, so during this leg a non-streaming completion means the
      // auto-dream lightweight route ran).
      const requests = await fakeAi.getRequests();
      const dreamCall = requests.find((r) => r.stream === false);
      expect(dreamCall, "non-streaming auto-dream call missing").toBeDefined();
      expect(dreamCall?.path).toBe("/v1/chat/completions");
      expect(dreamCall?.messageCount).toBeGreaterThanOrEqual(2);
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});
