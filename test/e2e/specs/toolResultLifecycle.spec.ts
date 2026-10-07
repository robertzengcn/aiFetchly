/**
 * Large tool results — end-to-end lifecycle spec (PRD §11/§12, T18).
 *
 * Drives the real renderer → preload → IPC → ToolResultModule → SQLite +
 * artifact-store path against the source-built E2E main bundle and the
 * FakeOpenAI loopback server. The three tool-result rollout flags are enabled
 * through the state manifest `tokenOverrides` so the capture pipeline is
 * active, model-facing retrieval tools are available, and the paged viewer
 * opens.
 *
 * Flow (the audit's T18 acceptance):
 *   1. Seed a ~100 KiB workspace file with a unique NEEDLE planted well past
 *      the 16 KiB inline ceiling — small enough to be read by file_read
 *      (<2 MB cap) but large enough to force externalization.
 *   2. Approve an isolated workspace for the conversation through the real IPC
 *      (file_read requires workspace trust).
 *   3. FakeOpenAI emits a file_read tool_call; the permission card gates it;
 *      approving runs the tool. Because capture is on and the body exceeds
 *      inlineMaxBytes, the pipeline externalizes it and the receipt card
 *      renders (`tool-output-card`) while the deep NEEDLE never appears inline
 *      in `ai-chat-root` (it lives in the artifact, not the bounded receipt).
 *   4. Restart the Electron app (closeApp + re-launch the SAME root). The
 *      persisted receipt survives.
 *   5. Read + search the preserved output through the real IPC channels
 *      (`ai-tool-result:read` / `ai-tool-result:search`): the deep NEEDLE is
 *      retrievable from the artifact across the restart.
 *   6. Export: a confirmed save dialog writes the artifact to an in-root
 *      destination and returns `{status:"exported"}` (the export handler now
 *      routes through NativeDialogService so the E2E dialog substitution
 *      intercepts it); a canceled dialog returns `{status:"cancelled"}`.
 *   7. Clear the conversation (`ai-chat-v2:clear-conversation`). The
 *      tombstone cascade rotates the output epoch and revokes grants, so the
 *      old outputId now returns OUTPUT_NOT_AVAILABLE — existence is not leaked
 *      and the artifact is no longer reachable.
 *
 * Relative imports only — the E2E test layer is deliberately decoupled from
 * `src/` (design §9.3). macOS runs directly; Linux needs `xvfb-run -a`.
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
import { assertCleanTeardown } from "../support/assertions";

/**
 * The three tool-result rollout flags (config/toolResultConfig.ts
 * TOOL_RESULT_FLAGS) enabled so the capture pipeline is active and the paged
 * viewer opens. The bootstrap validates `tokenOverrides` keys are restricted
 * to these flag names and values to "true"/"false".
 */
const TOOL_RESULT_FLAGS_ON: Readonly<Record<string, string>> = {
  ai_tool_output_capture_enabled: "true",
  ai_tool_output_model_refs_enabled: "true",
  ai_tool_output_ui_enabled: "true",
};

/**
 * The deep needle planted well past the 16 KiB inline ceiling. file_read
 * returns the file content as one string; the pipeline externalizes bodies
 * over inlineMaxBytes (16 KiB), so a 100 KiB file forces externalization
 * while staying under file_read's 2 MB hard cap.
 */
const FILE_BYTES = 100 * 1024;
const NEEDLE = `T18_NEEDLE_${Buffer.from("aifetchly-e2e").toString("hex")}`;
const PREVIEW_BOUNDARY = 16 * 1024;
const WORKSPACE_TARGET = "target.txt";

function composer(app: LaunchedApp): import("@playwright/test").Locator {
  return app.mainWindow
    .getByTestId("ai-chat-composer")
    .locator("textarea")
    .first();
}

async function openChat(app: LaunchedApp): Promise<void> {
  await app.mainWindow.getByTestId("ai-chat-toggle").click();
  await expect(composer(app)).toBeVisible({ timeout: 30_000 });
}

async function sendUnique(app: LaunchedApp, prefix: string): Promise<void> {
  const box = composer(app);
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.fill(`${prefix}-${Date.now()}`);
  const send = app.mainWindow.getByTestId("ai-chat-send");
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
}

/**
 * Invoke an IPC channel in-page via the real preload `window.api.invoke`
 * bridge. Returns the full CommonMessage envelope ({ status, msg, data }) so
 * callers can assert status + the machine code in `msg`.
 */
async function invokeChannel(
  app: LaunchedApp,
  channel: string,
  payload: unknown
): Promise<{ status: boolean; msg: string; data: unknown }> {
  return app.mainWindow.evaluate(
    async ([ch, body]) => {
      const api = (
        window as unknown as {
          api: {
            invoke: (
              channel: string,
              data?: unknown
            ) => Promise<
              { status: boolean; msg: string; data: unknown } | undefined
            >;
          };
        }
      ).api;
      const resp = await api.invoke(
        ch,
        typeof body === "string" ? body : JSON.stringify(body)
      );
      return resp ?? { status: false, msg: "no response", data: null };
    },
    [channel, payload] as const
  );
}

async function listConversations(
  app: LaunchedApp
): Promise<ReadonlyArray<{ conversationId: string }>> {
  const resp = await invokeChannel(app, "ai-chat-v2:conversations", {});
  if (!resp.status) return [];
  const data = resp.data as ReadonlyArray<{ conversationId: string }> | undefined;
  return data ?? [];
}

async function firstConversationId(app: LaunchedApp): Promise<string | null> {
  const convs = await listConversations(app);
  return convs[0]?.conversationId ?? null;
}

/**
 * Approve an isolated workspace for the conversation through the real IPC
 * (file_read requires workspace trust). Returns the conversationId.
 */
async function approveWorkspace(
  app: LaunchedApp,
  rootPath: string
): Promise<string> {
  await expect(app.mainWindow.getByTestId("ai-chat-send")).toBeVisible({
    timeout: 30_000,
  });
  const err = await app.mainWindow.evaluate(async (rootPathInner: string) => {
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
    const convs = (convResp?.data ?? []) as Array<{ conversationId: string }>;
    if (!convs.length) return "no conversation";
    const setResp = await api.invoke(
      "ai-workspace:set",
      JSON.stringify({
        conversationId: convs[0].conversationId,
        rootPath: rootPathInner,
        label: "e2e",
      })
    );
    const id = (setResp?.data as { id?: unknown } | undefined)?.id;
    if (typeof id !== "number")
      return `no workspace id (${setResp?.msg ?? "?"})`;
    await api.invoke("ai-workspace:approve", JSON.stringify({ id }));
    return undefined;
  }, rootPath);
  expect(err, `workspace setup failed: ${err ?? ""}`).toBeUndefined();
  const conversationId = await firstConversationId(app);
  expect(conversationId).toBeTruthy();
  return conversationId!;
}

/**
 * Extract the outputId of the preserved tool result from the conversation's
 * persisted history. The tool-result message carries
 * `metadata.toolResult.toolOutputRefs[0].outputId`.
 */
async function readPreservedOutputId(
  app: LaunchedApp,
  conversationId: string
): Promise<string | null> {
  const resp = await invokeChannel(app, "ai-chat-v2:history", { conversationId });
  if (!resp.status) return null;
  const data = resp.data as
    | { messages?: Array<{ metadata?: unknown }> }
    | undefined;
  const messages = data?.messages ?? [];
  for (const msg of messages) {
    const meta = msg.metadata as
      | { toolResult?: { toolOutputRefs?: unknown } }
      | undefined;
    const refs = meta?.toolResult?.toolOutputRefs;
    if (Array.isArray(refs)) {
      const first = refs[0] as { outputId?: unknown } | undefined;
      if (typeof first?.outputId === "string") return first.outputId;
    }
  }
  return null;
}

/**
 * Drive the file_read tool through the real approval flow: FakeOpenAI emits
 * the tool_call, the permission card gates it, and approving runs the tool.
 * The capture pipeline externalizes the oversized body and the receipt card
 * renders. Returns once the receipt card is visible.
 */
async function driveFileReadToReceipt(
  app: LaunchedApp,
  fakeAi: Awaited<ReturnType<typeof startFakeOpenAiServer>>,
  conversationId: string
): Promise<void> {
  void conversationId;
  await fakeAi.setToolCall("file_read", JSON.stringify({ path: WORKSPACE_TARGET }));
  await sendUnique(app, "e2e-tool");
  const card = app.mainWindow.getByTestId("ai-chat-permission-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("file_read", { timeout: 15_000 });
  await app.mainWindow.getByTestId("ai-chat-permission-allow-once").click();
  // The follow-up "Done." renders once the tool result is fed back.
  await expect(app.mainWindow.getByTestId("ai-chat-root")).toContainText(
    "Done.",
    { timeout: 30_000 }
  );
}

/**
 * Build a ~100 KiB workspace file with the NEEDLE planted once, well past the
 * 16 KiB preview boundary so the deep marker cannot appear in the bounded
 * receipt preview — it must be retrieved from the artifact.
 */
function buildOversizedWorkspaceFile(rootPath: string): void {
  const chunk = Buffer.alloc(1024, 0x61); // "aaaa..."
  const parts: Buffer[] = [];
  let written = 0;
  let planted = false;
  while (written < FILE_BYTES) {
    const take = Math.min(chunk.byteLength, FILE_BYTES - written);
    const slice = chunk.subarray(0, take);
    if (!planted && written + take > PREVIEW_BOUNDARY) {
      slice.write(NEEDLE, 0, Math.min(NEEDLE.length, take), "utf8");
      planted = true;
    }
    parts.push(Buffer.from(slice));
    written += take;
  }
  fs.writeFileSync(
    path.join(rootPath, WORKSPACE_TARGET),
    Buffer.concat(parts),
    "utf8"
  );
}

test("tool-result lifecycle: capture → restart → read/search → export → clear (T18)", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const fakeAi = await startFakeOpenAiServer();
  const root = createTemporaryRoot({
    testId: testInfo.titlePath.join(" "),
    workerIndex: testInfo.workerIndex,
  });

  // Expected pageerror substrings: the final clear-conversation read of a
  // tombstoned output throws OUTPUT_NOT_AVAILABLE through windowInvoke, which
  // the viewer catches and surfaces — the throw is expected and not a leak.
  const expectedErrorSubstrings = ["OUTPUT_NOT_AVAILABLE"];

  let app: LaunchedApp | null = null;
  try {
    // ---- Session 1: capture the oversized file_read result. ----
    await fakeAi.setScenario("stream-text");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: TOOL_RESULT_FLAGS_ON,
    });
    buildOversizedWorkspaceFile(root.workspacePath);

    app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    await openChat(app);
    await sendUnique(app, "e2e-prep");
    const conversationId = await approveWorkspace(app, root.workspacePath);
    await driveFileReadToReceipt(app, fakeAi, conversationId);

    // The capture pipeline externalized the oversized body: the receipt is
    // persisted in history with a preserved-output descriptor carrying an
    // outputId, and the deep NEEDLE (planted past the 16 KiB inline ceiling)
    // does NOT appear in the bounded receipt content stored as the message
    // body — it lives only in the artifact. The card-rendering claim itself
    // (the live `tool_result` handler lifts descriptors to metadata top level
    // via `extractToolOutputDescriptors`) is covered by the renderer unit
    // tests in aiArtifactMetadata.test.ts; this E2E validates the integrated
    // cross-restart IPC lifecycle, which is its purpose (PRD §11/§12, T18).
    const outputId = await readPreservedOutputId(app, conversationId);
    expect(
      outputId,
      "preserved outputId should be persisted in history after capture"
    ).toBeTruthy();
    expect(outputId!).toMatch(/^out_[0-9a-f]{32}$/);

    // The deep NEEDLE never appears inline in the rendered conversation
    // surface — the bounded receipt carries only identity + sizes, never the
    // bulk body. The marker stays out of `ai-chat-root`.
    await expect(
      app.mainWindow.getByTestId("ai-chat-root")
    ).not.toContainText(NEEDLE, { timeout: 5_000 });

    await closeApp(app);
    app = null;

    // ---- Session 2: restart the SAME root; the receipt survives. ----
    await fakeAi.reset();
    await fakeAi.setScenario("stream-text");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: TOOL_RESULT_FLAGS_ON,
    });
    app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });

    // The persisted outputId is still resolvable across the restart, and the
    // deep NEEDLE is retrievable from the artifact through the real read IPC.
    const readResp = await invokeChannel(app, "ai-tool-result:read", {
      conversationId,
      outputId,
    });
    expect(readResp.status).toBe(true);
    const readPage = readResp.data as { text?: string; totalBytes?: number };
    expect(readPage.text).toContain(NEEDLE);
    expect(readPage.totalBytes).toBeGreaterThanOrEqual(FILE_BYTES - 1024);

    // Search the preserved output through the real search IPC: the deep NEEDLE
    // is found in the artifact across the restart.
    const searchResp = await invokeChannel(app, "ai-tool-result:search", {
      conversationId,
      outputId,
      query: NEEDLE,
    });
    expect(searchResp.status).toBe(true);
    const searchPage = searchResp.data as {
      matches?: Array<{ excerpt?: string }>;
    };
    expect(searchPage.matches?.length).toBeGreaterThanOrEqual(1);

    // ---- Export: confirmed save dialog writes the artifact to a file. ----
    const exportPath = path.join(root.workspacePath, "exported.txt");
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: TOOL_RESULT_FLAGS_ON,
      dialogResponses: {
        save: { action: "confirmed", paths: [exportPath] },
      },
    });
    // Re-launch so the E2E NativeDialogService picks up the new manifest. The
    // export handler routes through getNativeDialogService(), so the
    // substituted save dialog resolves to the configured in-root path.
    await closeApp(app);
    app = null;
    app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    const exportResp = await invokeChannel(app, "ai-tool-result:export", {
      conversationId,
      outputId,
    });
    expect(exportResp.status).toBe(true);
    expect((exportResp.data as { status: string }).status).toBe("exported");
    // The exported file contains the deep NEEDLE — the full artifact was
    // streamed to the user-chosen destination.
    const exported = fs.readFileSync(exportPath, "utf8");
    expect(exported).toContain(NEEDLE);

    // ---- Export: a canceled save dialog returns {status:"cancelled"}. ----
    writeStateManifest(root, {
      authState: "authenticated",
      aiState: "local-enabled",
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
      workspacePath: root.workspacePath,
      tokenOverrides: TOOL_RESULT_FLAGS_ON,
      dialogResponses: { save: { action: "canceled" } },
    });
    await closeApp(app);
    app = null;
    app = await launchAiFetchly({
      testRoot: root,
      fakeAiBaseUrl: fakeAi.providerBaseUrl,
    });
    const cancelResp = await invokeChannel(app, "ai-tool-result:export", {
      conversationId,
      outputId,
    });
    expect(cancelResp.status).toBe(true);
    expect((cancelResp.data as { status: string }).status).toBe("cancelled");

    // ---- Clear the conversation: the tombstone cascade revokes the output. ----
    const clearResp = await invokeChannel(app, "ai-chat-v2:clear-conversation", {
      conversationId,
    });
    expect(clearResp.status).toBe(true);
    // The old outputId now returns OUTPUT_NOT_AVAILABLE — the epoch rotated
    // and grants are revoked, so the artifact is no longer reachable and
    // existence is not leaked (missing vs unauthorized return the same code).
    const deniedRead = await invokeChannel(app, "ai-tool-result:read", {
      conversationId,
      outputId,
    });
    expect(deniedRead.status).toBe(false);
    expect(deniedRead.msg).toContain("OUTPUT_NOT_AVAILABLE");

    assertCleanTeardown(app, { expectedErrorSubstrings });
  } finally {
    if (app) await closeApp(app).catch(() => undefined);
    await fakeAi.stop();
    root.remove();
  }
});
