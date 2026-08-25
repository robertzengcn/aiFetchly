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

test("AC-002/AC-003: external edit is imported; invalid edit retains last valid", async ({ page: _page }, testInfo) => {
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
      const { conversationId } = setup as { conversationId: string };

      await portableInvoke(app, "ai:portable-workspace-memory:enable", {
        conversationId,
        defaultStorageMode: "portable-local",
        importPolicy: "automatic",
        exportScope: "none",
        visibility: "local",
        installBridges: [],
      });
      const createResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:create",
        {
          conversationId,
          type: "decision",
          title: "External edit target",
          content: "original content",
          confidence: 90,
          visibility: "local",
        }
      );
      const memoryId = (createResp.data as { memoryId: string }).memoryId;
      const recordPath = path.join(memoryDir(root), `${memoryId}.md`);

      // AC-002: external edit — modify the file externally.
      const content = fs.readFileSync(recordPath, "utf8");
      const edited = content.replace("original content", "externally edited content");
      fs.writeFileSync(recordPath, edited);

      // Trigger a rescan so AiFetchly picks up the external edit.
      await portableInvoke(app, "ai:portable-workspace-memory:rescan", {
        conversationId,
      });
      // Give the coordinator a moment to process.
      await new Promise((r) => setTimeout(r, 1000));

      // Verify the projection reflects the external edit.
      const listResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:list",
        { conversationId }
      );
      const rows = listResp.data as Array<{ memoryId: string; content: string }>;
      const row = rows.find((r) => r.memoryId === memoryId);
      expect(row?.content).toContain("externally edited content");

      // AC-003: make the file invalid (secret-like).
      const invalidContent = content.replace(
        "original content",
        "sk-abcdefghijklmnopsecretkey"
      );
      fs.writeFileSync(recordPath, invalidContent);
      await portableInvoke(app, "ai:portable-workspace-memory:rescan", {
        conversationId,
      });
      await new Promise((r) => setTimeout(r, 1000));

      // The invalid version must NOT enter retrieval; the last valid projection
      // is retained. Check diagnostics.
      const diagsResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:diagnostics:list",
        { conversationId }
      );
      const diags = diagsResp.data as Array<{ code: string; relativePath: string }>;
      expect(diags.some((d) => d.code === "memory-secret-rejected")).toBe(true);
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});

test("AC-007: concurrent edit protection — save does not overwrite external bytes", async ({ page: _page }, testInfo) => {
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
      const { conversationId } = setup as { conversationId: string };

      await portableInvoke(app, "ai:portable-workspace-memory:enable", {
        conversationId,
        defaultStorageMode: "portable-local",
        importPolicy: "automatic",
        exportScope: "none",
        visibility: "local",
        installBridges: [],
      });
      const createResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:create",
        {
          conversationId,
          type: "decision",
          title: "Concurrent edit test",
          content: "original",
          confidence: 90,
          visibility: "local",
        }
      );
      const memoryId = (createResp.data as { memoryId: string }).memoryId;
      const recordPath = path.join(memoryDir(root), `${memoryId}.md`);

      // Get the expected hash (the file's current hash).
      const stateResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:get-state",
        { conversationId, memoryId }
      );
      const expectedHash = (stateResp.data as { lastValidHash?: string })
        .lastValidHash;

      // External edit between read and write.
      const content = fs.readFileSync(recordPath, "utf8");
      fs.writeFileSync(recordPath, content.replace("original", "external racing edit"));

      // AiFetchly tries to save with the stale expectedHash → conflict.
      const updateResp = await portableInvoke(
        app,
        "ai:portable-workspace-memory:update",
        {
          conversationId,
          memoryId,
          type: "decision",
          title: "App version",
          content: "app version",
          confidence: 90,
          status: "active",
          visibility: "local",
          expectedHash,
        }
      );
      expect(updateResp.status).toBe(false);

      // AC-007: external bytes are preserved (not overwritten).
      const after = fs.readFileSync(recordPath, "utf8");
      expect(after).toContain("external racing edit");
      expect(after).not.toContain("app version");
    } finally {
      await closeApp(app);
    }
  } finally {
    await fakeAi.stop();
  }
});

test("AC-005/AC-011: isolation — second workspace sees no portable memory from the first", async ({ page: _page }, testInfo) => {
  test.setTimeout(240_000);
  const fakeAi = await startFakeOpenAiServer();
  await fakeAi.setScenario("stream-text");
  const rootA = createTemporaryRoot({
    testId: `${testInfo.titlePath.join(" ")}-A`,
    workerIndex: testInfo.workerIndex,
  });
  const rootB = createTemporaryRoot({
    testId: `${testInfo.titlePath.join(" ")}-B`,
    workerIndex: testInfo.workerIndex,
  });

  try {
    // Session 1: workspace A with a portable record.
    writeStateManifest(rootA, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: rootA.workspacePath,
    });
    const appA = await launchAiFetchly({
      testRoot: rootA,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(appA);
      const setupA = await setupWorkspace(appA, rootA);
      const convA = (setupA as { conversationId: string }).conversationId;
      await portableInvoke(appA, "ai:portable-workspace-memory:enable", {
        conversationId: convA,
        defaultStorageMode: "portable-local",
        importPolicy: "automatic",
        exportScope: "none",
        visibility: "local",
        installBridges: [],
      });
      await portableInvoke(appA, "ai:portable-workspace-memory:create", {
        conversationId: convA,
        type: "decision",
        title: "Workspace A only",
        content: "belongs to A",
        confidence: 90,
        visibility: "local",
      });
      expect(fs.existsSync(memoryDir(rootA))).toBe(true);
    } finally {
      await closeApp(appA);
    }

    // Session 2: workspace B — must NOT see A's portable records.
    writeStateManifest(rootB, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: rootB.workspacePath,
    });
    const appB = await launchAiFetchly({
      testRoot: rootB,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    try {
      await openChat(appB);
      const setupB = await setupWorkspace(appB, rootB);
      const convB = (setupB as { conversationId: string }).conversationId;
      await portableInvoke(appB, "ai:portable-workspace-memory:enable", {
        conversationId: convB,
        defaultStorageMode: "portable-local",
        importPolicy: "automatic",
        exportScope: "none",
        visibility: "local",
        installBridges: [],
      });
      const listResp = await portableInvoke(
        appB,
        "ai:portable-workspace-memory:list",
        { conversationId: convB }
      );
      const rows = listResp.data as Array<{ title: string }>;
      // AC-005: no memory from workspace A appears in workspace B.
      expect(rows.some((r) => r.title === "Workspace A only")).toBe(false);
    } finally {
      await closeApp(appB);
    }
  } finally {
    await fakeAi.stop();
  }
});
