/**
 * Portable workspace memory Electron E2E specs (PRD §21.6 / AC-001..AC-013).
 *
 * These drive the REAL renderer → preload → IPC → service → SQLite → filesystem
 * path inside an isolated temp root. The app is seeded authenticated with a
 * local-enabled fake provider. Each spec:
 *   1. Opens the AI chat dock (creates a conversation).
 *   2. Sets + approves a workspace rooted at the test's temp workspacePath.
 *   3. Drives the portable-memory IPC through window.api.invoke (the renderer's
 *      real preload-allowlisted channel), exercising the production service.
 *   4. Asserts filesystem + SQLite projection state.
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

function memoryDir(root: E2ETestRoot): string {
  return path.join(root.workspacePath, ".aifetchly", "memory");
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(
    app.mainWindow.getByTestId("ai-chat-composer")
  ).toBeVisible({ timeout: 30_000 });
}

async function setupWorkspace(
  app: LaunchedApp,
  root: E2ETestRoot
): Promise<{ conversationId: string; workspaceId: number } | string> {
  return app.mainWindow.evaluate(
    async (rootPath) => {
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
      const convResp = await api.invoke(
        "ai-chat-v2:conversations",
        JSON.stringify({})
      );
      const convs = (convResp?.data ?? []) as Array<{
        conversationId: string;
      }>;
      if (!convs.length) return "no conversation";
      const conversationId = convs[0].conversationId;
      const setResp = await api.invoke(
        "ai-workspace:set",
        JSON.stringify({
          conversationId,
          rootPath,
          label: "e2e-portable",
        })
      );
      const id = (setResp?.data as { id?: unknown } | undefined)?.id;
      if (typeof id !== "number")
        return `no workspace id (${setResp?.msg ?? "?"})`;
      await api.invoke("ai-workspace:approve", JSON.stringify({ id }));
      return { conversationId, workspaceId: id };
    },
    root.workspacePath
  );
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
      return (
        resp ?? { status: false, data: undefined, msg: "no response" }
      ) as { status: boolean; data: unknown; msg?: string };
    },
    { channel, payload }
  );
}

test("AC-001/AC-006/AC-009: enable portable memory, create a record, verify file + projection", async ({ page: _page }, testInfo) => {
  test.setTimeout(240_000);
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
    });
    try {
      await openChat(app);
      const setup = await setupWorkspace(app, root);
      expect(setup, `workspace setup failed: ${setup}`).not.toEqual(
        expect.any(String)
      );
      const { conversationId } = setup as {
        conversationId: string;
        workspaceId: number;
      };

      const enableResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:enable",
        {
          conversationId,
          defaultStorageMode: "portable-local",
          importPolicy: "automatic",
          exportScope: "none",
          visibility: "local",
          installBridges: [],
        }
      );
      expect(enableResp.status, enableResp.msg ?? "").toBe(true);

      const createResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:create",
        {
          conversationId,
          type: "decision",
          title: "E2E portable decision",
          content: "Files own portable fields (AC-001).",
          confidence: 95,
          visibility: "local",
        }
      );
      expect(createResp.status, createResp.msg ?? "").toBe(true);
      const created = createResp.data as { memoryId: string };
      expect(created.memoryId).toMatch(/^wmem-/);

      // AC-001: cross-agent readable file.
      const recordPath = path.join(memoryDir(root), `${created.memoryId}.md`);
      expect(fs.existsSync(recordPath)).toBe(true);
      const content = fs.readFileSync(recordPath, "utf8");
      expect(content).toContain("schema: aifetchly.memory/v1");
      expect(content).toContain("E2E portable decision");

      // AC-006: complete file (balanced fences, trailing newline).
      expect(content.startsWith("---\n")).toBe(true);
      expect(content.includes("\n---\n")).toBe(true);
      expect(content.endsWith("\n")).toBe(true);

      // INDEX references the record.
      const indexPath = path.join(memoryDir(root), "INDEX.md");
      expect(fs.existsSync(indexPath)).toBe(true);
      expect(fs.readFileSync(indexPath, "utf8")).toContain(
        "E2E portable decision"
      );

      // AC-009: projection is recoverable (status reports the record).
      const statusResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:status",
        { conversationId }
      );
      expect(statusResp.status).toBe(true);
      const status = statusResp.data as {
        portableCount: number;
        enabled: boolean;
      };
      expect(status.enabled).toBe(true);
      expect(status.portableCount).toBeGreaterThanOrEqual(1);
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});

test("AC-008: no Git mutation on enable/create", async ({ page: _page }, testInfo) => {
  test.setTimeout(180_000);
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
    });
    try {
      await openChat(app);
      const setup = await setupWorkspace(app, root);
      const { conversationId } = setup as { conversationId: string };

      await portableInvoke(app, "ai:portable-workspace-memory:enable", {
        conversationId,
        defaultStorageMode: "portable-local",
        importPolicy: "automatic",
        exportScope: "none",
        visibility: "local",
        installBridges: [],
      });
      await portableInvoke(app, "ai:portable-workspace-memory:create", {
        conversationId,
        type: "decision",
        title: "No-publish test",
        content: "AiFetchly must never auto-commit (AC-008).",
        confidence: 90,
        visibility: "local",
      });

      expect(fs.existsSync(path.join(root.workspacePath, ".git"))).toBe(false);
      expect(
        fs.existsSync(path.join(root.workspacePath, ".gitignore"))
      ).toBe(false);
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});

test("AC-010: AGENTS.md bridge preserves unrelated user content", async ({ page: _page }, testInfo) => {
  test.setTimeout(180_000);
  const fakeAi = await startFakeOpenAiServer();
  await fakeAi.setScenario("stream-text");
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  try {
    const agentsPath = path.join(root.workspacePath, "AGENTS.md");
    fs.writeFileSync(agentsPath, "# My project notes\n\nKeep this line.\n");

    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
    });
    const app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(app);
      const setup = await setupWorkspace(app, root);
      const { conversationId } = setup as { conversationId: string };

      const bridgeResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:bridge:apply",
        { conversationId, target: "AGENTS.md" }
      );
      expect(bridgeResp.status, bridgeResp.msg ?? "").toBe(true);

      const after = fs.readFileSync(agentsPath, "utf8");
      expect(after).toContain("# My project notes");
      expect(after).toContain("Keep this line.");
      expect(after).toContain("aifetchly:project-memory:start");

      const removeResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:bridge:remove",
        { conversationId, target: "AGENTS.md" }
      );
      expect(removeResp.status).toBe(true);
      const afterRemove = fs.readFileSync(agentsPath, "utf8");
      expect(afterRemove).not.toContain("aifetchly:project-memory");
      expect(afterRemove).toContain("# My project notes");
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});
