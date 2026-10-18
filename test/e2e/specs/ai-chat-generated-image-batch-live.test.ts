/**
 * Live generated-image batch E2E (R-1..R-7).
 *
 * Drives a REAL `process_artifact_batch` execution against the FakeOpenAI
 * loopback server — no seeded history. The fake server's tool-call queue
 * scripts the whole multi-step conversation:
 *
 *   request 1  → process_artifact_batch tool_call (generatedImageReferences)
 *   requests 2..5 → one streamed image each (the 4 isolated agent-batch-worker
 *                  provider calls, concurrency ≤3, JIT-prepared transients)
 *   request 6  → short text completion (the parent follow-up after the tool
 *                  result is fed back)
 *
 * Covers:
 *   R-1  no-workspace 4-image batch → single evolving progress surface
 *        (queued/running/completed counts, N of M, concurrency 3), all
 *        successful outputs render as durable re-homed generated images,
 *        serialized parent tool result carries SlimmedOutputImage only
 *        (no local_path / outputFilePaths / data:image / base64).
 *   R-2  Stop mid-batch → completed retained, queued cancelled.
 *   R-3  Use a batch-produced image as reference in a follow-up edit →
 *        resolves under the PARENT conversation/message identity.
 *   R-4  The batch confirm executes in the user's reference order: clicking
 *        the four tiles in reverse order yields a persisted record whose
 *        items (bounded, per-item receipt) carry the reversed imageIndex
 *        sequence — no silent reordering between confirm and execution.
 *   R-5  Partial success: one worker 500 → the settled record is status
 *        "partial" (3 of 4), exactly one failed item + one failure row, and
 *        the Retry-failed action appears with count (1).
 *   R-6  Retry failed only: the retry action resubmits exactly the failed
 *        reference — exactly one new worker (image-edit) provider request,
 *        not a full 4-request re-run — and the retry turn's record is 1/1.
 *   R-7  Trusted Save: with no approved workspace the export is queued and
 *        the request-workspace card opens; confirming the folder (deterministic
 *        E2E dialog) approves the workspace, auto-retries the export, and the
 *        file exists under the approved workspace root.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import {
  launchAiFetchly,
  type LaunchedApp,
} from "../fixtures/electronApp";
import { writeStateManifest } from "../fixtures/temporaryState";
import { closeApp } from "../support/processCleanup";
import { assertCleanTeardown } from "../support/assertions";
import {
  chatRoot,
  composerTextarea,
  seedGeneratedImagesOnLastTurn,
  startNewConversation,
  switchToConversationByMarker,
  createConversationWithStreamedTurn,
} from "../support/generatedImageSeed";
import type { ScriptedToolCall } from "../fixtures/fakeOpenAiServer";
import type { FakeAiScenarioName } from "../scenarios/openAiProtocol";
import type { E2ETestRoot } from "../fixtures/types";
import * as fs from "fs";
import * as path from "path";

/**
 * Minimal shape of the fake Ai fixture used by these tests (only the
 * controls the spec relies on — keeps the script independent of the full
 * FakeAi surface).
 */
interface FakeAiShape {
  setScenario: (name: FakeAiScenarioName) => Promise<void>;
  setToolCallQueue: (calls: readonly ScriptedToolCall[]) => Promise<void>;
  getRequests: () => Promise<
    readonly { imagePartHashes: readonly string[] }[]
  >;
}

/** Four distinct valid 1x1 PNGs (red/green/blue/yellow) so each worker
 * serves a resolvable, distinguishable generated image. */
const PNG_A =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const PNG_B =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC";
const PNG_C =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC";
const PNG_D =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4/58BAAT/Af9dfQKHAAAAAElFTkSuQmCC";

/** Scripted image response for an isolated worker request. Each entry
 * serves a distinct generated image via the `stream-generated-image`
 * scenario with an `imageB64` override. */
function imageScenario(b64: string): ScriptedToolCall {
  return {
    scenario: "stream-generated-image",
    imageB64: b64,
  };
}

/**
 * The batch flow may raise MULTIPLE sequential permission requests (the
 * batch tool itself, plus child permissions inside the isolated
 * agent-batch-worker). Each transcript row renders the same single
 * decision UI, so grant every pending card until none remain — bounded to
 * four cycles to avoid spinning on a reposting request.
 */
async function drainBatchApprovals(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): Promise<void> {
  const allowOnce = app.mainWindow.getByTestId("ai-chat-permission-allow-once");
  await expect(allowOnce.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 4; i += 1) {
    if ((await allowOnce.count()) === 0) return;
    await allowOnce.first().click();
    // Decision settles and the next request (if any) needs a beat to land.
    await app.mainWindow.waitForTimeout(1_500);
    if ((await allowOnce.count()) === 0) return;
  }
}

/**
 * Soft drain for the TRUSTED retry path: the confirmed-batch channel is
 * pre-approved on the server side, so NO permission card is raised (run
 * evidence: the retry settles without any card). Grant any card that does
 * appear, but never fail when none shows.
 */
async function drainBatchApprovalsIfAny(app: {
  readonly mainWindow: import("@playwright/test").Page;
}): Promise<void> {
  const allowOnce = app.mainWindow.getByTestId("ai-chat-permission-allow-once");
  for (let i = 0; i < 4; i += 1) {
    if ((await allowOnce.count()) === 0) return;
    await allowOnce.first().click();
    // Decision settles and a follow-up request (if any) needs a beat.
    await app.mainWindow.waitForTimeout(1_500);
  }
}

test.describe("Generated-image batch — live (Electron integration)", () => {
  test.setTimeout(240_000);
  test.afterEach(({ app, aiApp }) => {
    const a = aiApp ?? app;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  // The batch confirmation surface IS ported to the chat-first shell
  // (AiChatCenterSurface mounts GeneratedImageBatchConfirmDialog and the
  // shell transcript renders AiChatV2Message batch classes), so the
  // former skip ("surface not ported") was obsolete — V01 item.

  // R-7 launches under an extended fixture whose state manifest presets the
  // deterministic native dialog response: the workspace folder pick resolves
  // to the E2E root's workspace path (approval flow, FR-WSP-007).
  const batchTest = test.extend<{ aiAppWithWorkspacePick: LaunchedApp }>({
    aiAppWithWorkspacePick: async ({ testRoot, fakeAi }, use) => {
      await fakeAi.reset();
      writeStateManifest(testRoot, {
        authState: "authenticated",
        aiState: "local-enabled",
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
        workspacePath: testRoot.workspacePath,
        dialogResponses: {
          open: { action: "confirmed", paths: [testRoot.workspacePath] },
        },
      });
      const app = await launchAiFetchly({
        testRoot,
        fakeAiBaseUrl: fakeAi.providerBaseUrl,
      });
      await use(app);
      await closeApp(app);
    },
  });

  test("R-1: a no-workspace 4-image batch renders progress and durable re-homed outputs", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    // Seed a conversation with 4 generated images to select as the batch input.
    // (No approved workspace — the generated-image batch path needs none.)
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-batch-live-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker, [
      { fileName: "a.png", pngBase64: PNG_A },
      { fileName: "b.png", pngBase64: PNG_B },
      { fileName: "c.png", pngBase64: PNG_C },
      { fileName: "d.png", pngBase64: PNG_D },
    ]);
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const root = chatRoot(aiApp);
    const imageBlocks = root.locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(4);

    // Select all 4 into the tray (the draft cap is 50, so all four land).
    for (let i = 0; i < 4; i += 1) {
      await imageBlocks
        .nth(i)
        .getByRole("button", { name: "Use as reference" })
        .click();
    }

    // Script the queue BEFORE sending so the workers' requests are answered.
    // process_artifact_batch is a DEFERRED catalog tool, so the model first
    // emits tool_catalog_search (intercepted locally by the loop), then on the
    // next provider round emits process_artifact_batch. The queue:
    //   1) tool_catalog_search tool_call (loop intercepts, feeds result back)
    //   2) process_artifact_batch tool_call (the batch execution starts)
    //   3..6) four streamed-image worker responses (isolated agent-batch-worker)
    //   7) the parent follow-up completion (scripted scenario)
    await fakeAi.setToolCallQueue([
      {
        name: "tool_catalog_search",
        arguments: JSON.stringify({ query: "batch edit images" }),
      },
      {
        name: "process_artifact_batch",
        arguments: JSON.stringify({
          instruction: "make the lighting warmer",
          generatedImageReferences: [
            { messageId: "placeholder", imageIndex: 0 },
          ],
          processor: "image_edit",
        }),
      },
      imageScenario(PNG_A),
      imageScenario(PNG_B),
      imageScenario(PNG_C),
      imageScenario(PNG_D),
      { scenario: "stream-text" },
    ]);

    // Sending with 4 explicit references (>3) opens the batch-confirmation
    // dialog instead of streaming immediately.
    await composerTextarea(aiApp).fill("make the lighting warmer");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const confirmDialog = aiApp.mainWindow.getByTestId(
      "ai-chat-generated-batch-confirm"
    );
    await expect(confirmDialog).toBeVisible({ timeout: 30_000 });
    await expect(confirmDialog).toContainText("Process as batch?");

    await aiApp.mainWindow
      .getByTestId("ai-chat-generated-batch-confirm-accept")
      .click();

    // process_artifact_batch is permission-gated (filesystem category);
    // grant every approval the batch flow raises (tool + worker children).
    // The transcript renders one approval card per pending message row
    // (both carry the same single decision UI).
    const permCard = aiApp.mainWindow.getByTestId("ai-chat-permission-card").first();
    await expect(permCard).toBeVisible({ timeout: 30_000 });
    await expect(permCard).toContainText("process_artifact_batch");
    await drainBatchApprovals(aiApp);

    // The batch progress card appears with the evolving surface (N of M,
    // concurrency). The summary line lives in .v2-message__batch-summary.
    const batchSummary = root.locator(".v2-message__batch-summary");
    await expect(batchSummary.first()).toBeVisible({ timeout: 30_000 });
    // Concurrency is bounded to 3 (PROCESSOR_IMAGE_EDIT default).
    await expect(batchSummary.first()).toContainText("concurrency 3");

    // Wait for the turn to settle (follow-up completion runs).
    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 90_000,
    });

    // The serialized process_artifact_batch tool_result must contain
    // SlimmedOutputImage descriptors only — no application paths or bytes
    // (P0-1 invariant). NOTE: the assistant message's generatedImages
    // legitimately carries local_path (the persisted storage descriptor the
    // renderer's resolveGeneratedImageSource reads), so this assertion scopes
    // to the BATCH tool_result's toolResult field, not the whole history.
    const batchToolResult = await aiApp.mainWindow.evaluate(async () => {
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
      const convResp = await api.invoke(
        "ai-chat-v2:conversations",
        JSON.stringify({})
      );
      const convs = (convResp?.data ?? []) as Array<{
        conversationId: string;
      }>;
      for (const conv of convs) {
        const histResp = await api.invoke(
          "ai-chat-v2:history",
          JSON.stringify({ conversationId: conv.conversationId })
        );
        const histData = (histResp?.data ?? {}) as {
          messages?: Array<{
            messageType?: string;
            metadata?: {
              toolName?: string;
              toolResult?: unknown;
            };
          }>;
        };
        // The tool_CALL and tool_RESULT both carry toolName=process_artifact_batch;
        // pick the tool_RESULT (it holds the serialized SlimmedOutputImage payload).
        const batch = (histData.messages ?? []).find(
          (m) =>
            m.messageType === "tool_result" &&
            m.metadata?.toolName === "process_artifact_batch"
        );
        if (batch) return batch.metadata?.toolResult ?? null;
      }
      return null;
    });
    expect(batchToolResult).not.toBeNull();
    const serialized = JSON.stringify(batchToolResult);
    expect(serialized).not.toContain("local_path");
    expect(serialized).not.toContain("outputFilePaths");
    expect(serialized).not.toContain("data:image/");
    expect(serialized).not.toContain("b64_json");
    // The batch ran all 4 items. The durable toolResult is the bounded
    // receipt envelope; the aggregate record rides inside `toolOutputPreview`
    // (the preview that the renderer's batch card parses), so unwrap it.
    const unwrappedPreview = (batchToolResult as {
      toolOutputPreview?: unknown;
    }).toolOutputPreview;
    expect(typeof unwrappedPreview).toBe("string");
    const batchRecord = JSON.parse(unwrappedPreview as string) as {
      requestedCount?: number;
      completedCount?: number;
    };
    expect(batchRecord.requestedCount).toBe(4);
    expect(batchRecord.completedCount).toBe(4);

    // All 4 successful batch outputs render as durable generated images.
    const finalTiles = await root
      .locator(".v2-message__generated-image")
      .count();
    expect(finalTiles).toBeGreaterThanOrEqual(4);
  });

  test("R-2: stopping a batch mid-flight keeps completed outputs and cancels the rest", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    // Seed 4 generated images to select as batch input.
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-batch-cancel-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker, [
      { fileName: "a.png", pngBase64: PNG_A },
      { fileName: "b.png", pngBase64: PNG_B },
      { fileName: "c.png", pngBase64: PNG_C },
      { fileName: "d.png", pngBase64: PNG_D },
    ]);
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const root = chatRoot(aiApp);
    const imageBlocks = root.locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) {
      await imageBlocks
        .nth(i)
        .getByRole("button", { name: "Use as reference" })
        .click();
    }

    // Script the queue with DELAYED worker images so the batch is mid-flight
    // when Stop is pressed. The delayed scenario holds each image behind a
    // 4s barrier — enough margin to observe the running surface and stop.
    await fakeAi.setToolCallQueue([
      {
        name: "tool_catalog_search",
        arguments: JSON.stringify({ query: "batch edit" }),
      },
      {
        name: "process_artifact_batch",
        arguments: JSON.stringify({
          instruction: "make the lighting warmer",
          generatedImageReferences: [
            { messageId: "placeholder", imageIndex: 0 },
          ],
          processor: "image_edit",
        }),
      },
      { scenario: "stream-generated-image-delayed", imageB64: PNG_A },
      { scenario: "stream-generated-image-delayed", imageB64: PNG_B },
      { scenario: "stream-generated-image-delayed", imageB64: PNG_C },
      { scenario: "stream-generated-image-delayed", imageB64: PNG_D },
      { scenario: "stream-text" },
    ]);

    await composerTextarea(aiApp).fill("make the lighting warmer");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const dlg = aiApp.mainWindow.getByTestId("ai-chat-generated-batch-confirm");
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow
      .getByTestId("ai-chat-generated-batch-confirm-accept")
      .click();
    const pc = aiApp.mainWindow.getByTestId("ai-chat-permission-card").first();
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await drainBatchApprovals(aiApp);

    // While work is active the batch tool_call card carries the live progress
    // badge AND the Stop action (the batch-summary only renders on the settled
    // tool_result, which would be too late to stop).
    const stopBtn = root.locator(".v2-message__batch-stop").first();
    await expect(stopBtn).toBeVisible({ timeout: 30_000 });
    await stopBtn.click();

    // Wait for the turn to settle after stop.
    await expect(composerTextarea(aiApp)).not.toBeDisabled({ timeout: 90_000 });

    // After stop: the turn settles, and either a settled batch tool_result
    // exists (partial/cancelled) or the turn ended without one (the abort
    // path may skip the tool_result emit). Either way, whatever completed
    // before the stop must remain persisted and path/byte-free.
    const batchToolResult = await aiApp.mainWindow.evaluate(async () => {
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
      const convResp = await api.invoke(
        "ai-chat-v2:conversations",
        JSON.stringify({})
      );
      const convs = (convResp?.data ?? []) as Array<{ conversationId: string }>;
      for (const conv of convs) {
        const histResp = await api.invoke(
          "ai-chat-v2:history",
          JSON.stringify({ conversationId: conv.conversationId })
        );
        const histData = (histResp?.data ?? {}) as {
          messages?: Array<{
            messageType?: string;
            metadata?: { toolName?: string; toolResult?: unknown };
          }>;
        };
        const batch = (histData.messages ?? []).find(
          (m) =>
            m.messageType === "tool_result" &&
            m.metadata?.toolName === "process_artifact_batch"
        );
        if (batch) return batch.metadata?.toolResult ?? null;
      }
      return null;
    });
    // When the stop landed mid-batch the loop's abort path may skip the
    // tool_result emit entirely (verified in AIChatQueryLoopAsyncPoll); when
    // the batch had already settled a result, it must be partial/cancelled
    // with no paths or bytes. Both outcomes are acceptable stop behavior.
    if (batchToolResult !== null) {
      const serialized = JSON.stringify(batchToolResult);
      expect(serialized).not.toContain("local_path");
      expect(serialized).not.toContain("outputFilePaths");
      expect(serialized).not.toContain("b64_json");
      const result = batchToolResult as {
        status?: string;
        completedCount?: number;
      };
      if (typeof result.status === "string") {
        expect(["partial", "cancelled", "completed"]).toContain(result.status);
      }
    }
    // The stopped turn settles and the seeded inputs remain untouched on disk
    // (cancellation never deletes source images) — proven by the tiles still
    // rendering after the stop.
    const tilesAfterStop = await root
      .locator(".v2-message__generated-image")
      .count();
    expect(tilesAfterStop).toBeGreaterThanOrEqual(4);
  });

  test("R-3: a batch-produced image is usable as a reference in a follow-up edit under the parent identity", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    // Seed 4 generated images, run the batch (reuse R-1's flow), then use one
    // batch output as a reference in a follow-up edit.
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-batch-resel-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker, [
      { fileName: "a.png", pngBase64: PNG_A },
      { fileName: "b.png", pngBase64: PNG_B },
      { fileName: "c.png", pngBase64: PNG_C },
      { fileName: "d.png", pngBase64: PNG_D },
    ]);
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const root = chatRoot(aiApp);
    const imageBlocks = root.locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(4);
    for (let i = 0; i < 4; i += 1) {
      await imageBlocks
        .nth(i)
        .getByRole("button", { name: "Use as reference" })
        .click();
    }

    await fakeAi.setToolCallQueue([
      {
        name: "tool_catalog_search",
        arguments: JSON.stringify({ query: "batch edit" }),
      },
      {
        name: "process_artifact_batch",
        arguments: JSON.stringify({
          instruction: "make the lighting warmer",
          generatedImageReferences: [
            { messageId: "placeholder", imageIndex: 0 },
          ],
          processor: "image_edit",
        }),
      },
      imageScenario(PNG_A),
      imageScenario(PNG_B),
      imageScenario(PNG_C),
      imageScenario(PNG_D),
      { scenario: "stream-text" },
    ]);

    await composerTextarea(aiApp).fill("make the lighting warmer");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const dlg = aiApp.mainWindow.getByTestId("ai-chat-generated-batch-confirm");
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow
      .getByTestId("ai-chat-generated-batch-confirm-accept")
      .click();
    const pc = aiApp.mainWindow.getByTestId("ai-chat-permission-card").first();
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await drainBatchApprovals(aiApp);
    await expect(composerTextarea(aiApp)).not.toBeDisabled({ timeout: 90_000 });

    // After the batch completes, batch-produced images render in the parent
    // conversation. Pick the LAST generated-image tile (a batch output, not
    // one of the 4 seeded inputs) and use it as a reference.
    const tilesAfterBatch = root.locator(".v2-message__generated-image");
    const tileCount = await tilesAfterBatch.count();
    expect(tileCount).toBeGreaterThan(4); // seeded 4 + batch outputs

    const lastTile = tilesAfterBatch.nth(tileCount - 1);
    await lastTile.getByRole("button", { name: "Use as reference" }).click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-chip")
    ).toHaveCount(1);

    // Send a follow-up edit using the batch-produced reference. Script the
    // queue so the follow-up turn returns a streamed image.
    await fakeAi.setToolCallQueue([
      { scenario: "stream-generated-image", imageB64: PNG_A },
    ]);
    const requestsBefore = (await fakeAi.getRequests()).length;
    await composerTextarea(aiApp).fill("add a dog beside this one");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    // The follow-up edit reaches the provider with the batch-produced image.
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(requestsBefore);

    // The batch-produced image's ownership identity in persisted history is
    // the PARENT conversation/message — no agent-v2-*/agent-assistant-* ids
    // leak as ownership segments in the parent's generatedImages descriptors.
    const parentImages = await aiApp.mainWindow.evaluate(async () => {
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
      const convResp = await api.invoke(
        "ai-chat-v2:conversations",
        JSON.stringify({})
      );
      const convs = (convResp?.data ?? []) as Array<{ conversationId: string }>;
      const urls: string[] = [];
      for (const conv of convs) {
        const histResp = await api.invoke(
          "ai-chat-v2:history",
          JSON.stringify({ conversationId: conv.conversationId })
        );
        const histData = (histResp?.data ?? {}) as {
          messages?: Array<{
            role?: string;
            messageType?: string;
            metadata?: { generatedImages?: Array<{ url?: string }> };
          }>;
        };
        for (const m of histData.messages ?? []) {
          if (m.role === "assistant" && m.messageType === "message") {
            for (const img of m.metadata?.generatedImages ?? []) {
              if (img.url) urls.push(img.url);
            }
          }
        }
      }
      return urls;
    });
    // No parent-conversation generated-image descriptor carries an agent-* id.
    expect(parentImages.length).toBeGreaterThan(0);
    for (const url of parentImages) {
      expect(url).not.toContain("agent-v2-");
      expect(url).not.toContain("agent-assistant-");
    }
  });

  /**
   * Shared setup for R-4..R-6: seed a conversation with 4 generated images
   * and select them as batch references in the given tile order.
   */
  async function seedAndSelectBatchInputs(
    aiApp: LaunchedApp,
    fakeAi: FakeAiShape,
    testRoot: E2ETestRoot,
    marker: string,
    /** Tile order to click (default R-1's left-to-right). */
    clickOrder: readonly number[] = [0, 1, 2, 3]
  ): Promise<import("@playwright/test").Locator> {
    await fakeAi.setScenario("stream-text");
    await createConversationWithStreamedTurn(aiApp, marker);
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker, [
      { fileName: "a.png", pngBase64: PNG_A },
      { fileName: "b.png", pngBase64: PNG_B },
      { fileName: "c.png", pngBase64: PNG_C },
      { fileName: "d.png", pngBase64: PNG_D },
    ]);
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const root = chatRoot(aiApp);
    const imageBlocks = root.locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(4);
    for (const i of clickOrder) {
      await imageBlocks
        .nth(i)
        .getByRole("button", { name: "Use as reference" })
        .click();
    }
    return root;
  }

  /**
   * Read the settled `process_artifact_batch` result from persisted history
   * (first conversation that carries one). Returns the durable tool_result.
   */
  async function readSettledBatchRecord(
    aiApp: LaunchedApp
  ): Promise<Record<string, unknown> | null> {
    return (await aiApp.mainWindow.evaluate(async () => {
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
      const convResp = await api.invoke(
        "ai-chat-v2:conversations",
        JSON.stringify({})
      );
      const convs = (convResp?.data ?? []) as Array<{ conversationId: string }>;
      for (const conv of convs) {
        const histResp = await api.invoke(
          "ai-chat-v2:history",
          JSON.stringify({ conversationId: conv.conversationId })
        );
        const histData = (histResp?.data ?? {}) as {
          messages?: Array<{
            messageType?: string;
            metadata?: { toolName?: string; toolResult?: unknown };
          }>;
        };
        // The LAST batch tool_result in history — a retry turn adds a
        // second record, and the newest one is the assertion target.
        const batches = (histData.messages ?? []).filter(
          (m) =>
            m.messageType === "tool_result" &&
            m.metadata?.toolName === "process_artifact_batch"
        );
        const batch = batches[batches.length - 1];
        if (batch) return batch.metadata?.toolResult ?? null;
      }
      return null;
    })) as Record<string, unknown> | null;
  }

  /** Unwrap the bounded receipt envelope's aggregate record (toolOutputPreview). */
  function unwrapBatchRecord(
    toolResult: Record<string, unknown> | null
  ): Record<string, unknown> {
    const preview =
      toolResult?.toolOutputPreview ??
      toolResult ??
      null;
    if (typeof preview === "string") {
      return JSON.parse(preview) as Record<string, unknown>;
    }
    return preview as Record<string, unknown>;
  }

  /** Questionless common script for a plain 4-image batch. */
  function batchQueue(
    extraWorkerEntries: readonly ScriptedToolCall[] = []
  ): ScriptedToolCall[] {
    return [
      {
        name: "tool_catalog_search",
        arguments: JSON.stringify({ query: "batch edit" }),
      },
      {
        name: "process_artifact_batch",
        arguments: JSON.stringify({
          instruction: "make the lighting warmer",
          generatedImageReferences: [
            { messageId: "placeholder", imageIndex: 0 },
          ],
          processor: "image_edit",
        }),
      },
      ...extraWorkerEntries,
      { scenario: "stream-text" },
    ];
  }

  test("R-4: the batch executes in the user's confirmed reference order (FR-IMG-008)", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    // Select tiles in REVERSE order: the tray captures click order, so a
    // faithful execution keeps [3,2,1,0] in the persisted record.
    const root = await seedAndSelectBatchInputs(
      aiApp,
      fakeAi,
      testRoot,
      `e2e-batch-order-${Date.now()}`,
      [3, 2, 1, 0]
    );

    await fakeAi.setToolCallQueue(
      batchQueue([
        imageScenario(PNG_A),
        imageScenario(PNG_B),
        imageScenario(PNG_C),
        imageScenario(PNG_D),
      ])
    );

    await composerTextarea(aiApp).fill("make the lighting warmer");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const confirmDialog = aiApp.mainWindow.getByTestId(
      "ai-chat-generated-batch-confirm"
    );
    await expect(confirmDialog).toBeVisible({ timeout: 30_000 });
    await expect(confirmDialog).toContainText("Process as batch?");
    await expect(confirmDialog).toContainText("All 4 selected images");
    await aiApp.mainWindow
      .getByTestId("ai-chat-generated-batch-confirm-accept")
      .click();

    const permCard = aiApp.mainWindow
      .getByTestId("ai-chat-permission-card")
      .first();
    await expect(permCard).toBeVisible({ timeout: 30_000 });
    await drainBatchApprovals(aiApp);
    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 90_000,
    });

    const record = unwrapBatchRecord(await readSettledBatchRecord(aiApp));
    expect(record.requestedCount).toBe(4);
    expect(record.completedCount).toBe(4);
    const items = (record.items ?? []) as Array<{
      input?: { reference?: { messageId?: string; imageIndex?: number } };
    }>;
    expect(items.length).toBe(4);
    // The confirmed click order is preserved end-to-end: items sit in the
    // exact reverse order the user made (imageIndexes 3,2,1,0).
    expect(
      items.map((it) => it.input?.reference?.imageIndex)
    ).toEqual([3, 2, 1, 0]);
    // All four sources participated (no item dropped or duplicated).
    expect(
      new Set(items.map((it) => it.input?.reference?.imageIndex)).size
    ).toBe(4);
    // Durable outputs still render (4 seeded + >=4 batch outputs).
    const tiles = await root.locator(".v2-message__generated-image").count();
    expect(tiles).toBeGreaterThanOrEqual(4);
  });

  test("R-5: partial success surfaces a failed item with its error and the retry action", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    const root = await seedAndSelectBatchInputs(
      aiApp,
      fakeAi,
      testRoot,
      `e2e-batch-partial-${Date.now()}`
    );

    // The FIRST scripted worker entry is the 5xx — whichever worker pops it,
    // exactly one item fails and three complete.
    await fakeAi.setToolCallQueue(
      batchQueue([
        { scenario: "http-500" },
        imageScenario(PNG_A),
        imageScenario(PNG_B),
        imageScenario(PNG_C),
      ])
    );

    await composerTextarea(aiApp).fill("make the lighting warmer");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const dlg = aiApp.mainWindow.getByTestId("ai-chat-generated-batch-confirm");
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow
      .getByTestId("ai-chat-generated-batch-confirm-accept")
      .click();
    const pc = aiApp.mainWindow.getByTestId("ai-chat-permission-card").first();
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await drainBatchApprovals(aiApp);
    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 90_000,
    });

    // The settled record is partial: 3 of 4 with exactly one failed item.
    const record = unwrapBatchRecord(await readSettledBatchRecord(aiApp));
    expect(record.status).toBe("partial");
    expect(record.requestedCount).toBe(4);
    expect(record.completedCount).toBe(3);
    const items = (record.items ?? []) as Array<{
      status?: string;
      error?: string;
      input?: { reference?: { imageIndex?: number } };
    }>;
    expect(items.length).toBe(4);
    const failedItems = items.filter((it) => it.status === "failed");
    expect(failedItems.length).toBe(1);
    expect(failedItems[0].error).toBeTruthy();
    expect(
      new Set(items.map((it) => it.input?.reference?.imageIndex)).size
    ).toBe(4);

    // The transcript card surfaces the status, the failure rows and the
    // Retry-failed action for exactly 1 item.
    await expect(root.locator(".v2-message__batch-summary").first())
      .toContainText("partial", { timeout: 30_000 });
    const failureRows = root.locator(".v2-message__batch-failure-row");
    await expect(failureRows).toHaveCount(1, { timeout: 30_000 });
    // Localized batch failure text (translatedBatchError maps the worker
    // 5xx to "AI provider returned a server error. Try again later.").
    await expect(failureRows.first()).toContainText(
      "AI provider returned a server error"
    );
    await expect(root.locator(".v2-message__batch-retry").first())
      .toContainText("(1)", { timeout: 30_000 });
  });

  test("R-6: Retry failed only resubmits the failed reference, never the whole batch", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    const root = await seedAndSelectBatchInputs(
      aiApp,
      fakeAi,
      testRoot,
      `e2e-batch-retry-${Date.now()}`
    );

    await fakeAi.setToolCallQueue(
      batchQueue([
        { scenario: "http-500" },
        imageScenario(PNG_A),
        imageScenario(PNG_B),
        imageScenario(PNG_C),
      ])
    );
    await composerTextarea(aiApp).fill("make the lighting warmer");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const dlg = aiApp.mainWindow.getByTestId("ai-chat-generated-batch-confirm");
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow
      .getByTestId("ai-chat-generated-batch-confirm-accept")
      .click();
    const pc = aiApp.mainWindow.getByTestId("ai-chat-permission-card").first();
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await drainBatchApprovals(aiApp);
    // REAL settle gate (the composer never disables while a turn runs):
    // the run strip's "Working…" pill disappears only at the turn terminal.
    await expect(
      aiApp.mainWindow.getByText("Working…")
    ).toHaveCount(0, { timeout: 120_000 });
    // Worker requests (image-edit provider calls) are identifiable by their
    // image_url parts (the isolated worker's packet). A full re-run would be
    // THREE new worker requests; a failed-only retry must be exactly ONE.
    const countImageRequests = (
      rs: readonly { imagePartHashes: readonly string[] }[]
    ): number => rs.filter((r) => r.imagePartHashes.length > 0).length;
    const beforeRetry = countImageRequests(await fakeAi.getRequests());

    // Script ONLY the retry's own provider interactions: the retry turn is
    // a queued turn whose confirmed refs are STAGED at dispatch (FR-IMG-011)
    // and consumed by its process_artifact_batch call — so the model must
    // raise the tool (catalog search + batch call) again; the staged set
    // replaces the placeholder arg refs. If the retry re-ran all four, the
    // remaining three pops would stream text and the record would not
    // settle 1/1.
    await fakeAi.setToolCallQueue(batchQueue([imageScenario(PNG_D)]));

    await root.locator(".v2-message__batch-retry").first().click();
    // The retry runs on the TRUSTED confirmed-batch channel — no permission
    // card is expected; grant one only if the flow still raises it.
    await drainBatchApprovalsIfAny(aiApp);
    // Settle gate: the retried turn's terminal (run strip clears).
    await expect(
      aiApp.mainWindow.getByText("Working…")
    ).toHaveCount(0, { timeout: 120_000 });

    const imageRequestsAfter = countImageRequests(await fakeAi.getRequests());
    expect(imageRequestsAfter - beforeRetry).toBe(1);

    // The retry turn's own settled record is the 1-item batch: 1/1.
    const retryRecord = unwrapBatchRecord(await readSettledBatchRecord(aiApp));
    expect(retryRecord.requestedCount).toBe(1);
    expect(retryRecord.completedCount).toBe(1);
    const retryItems = (retryRecord.items ?? []) as Array<{
      status?: string;
    }>;
    expect(retryItems.length).toBe(1);
    expect(retryItems[0].status).toBe("completed");
  });

  batchTest("R-7: trusted Save queues without a workspace and lands the file after approval", async ({
    aiAppWithWorkspacePick: aiApp,
    fakeAi,
    testRoot,
  }) => {
    const root = await seedAndSelectBatchInputs(
      aiApp,
      fakeAi,
      testRoot,
      `e2e-batch-save-${Date.now()}`
    );

    await fakeAi.setToolCallQueue(
      batchQueue([
        imageScenario(PNG_A),
        imageScenario(PNG_B),
        imageScenario(PNG_C),
        imageScenario(PNG_D),
      ])
    );
    await composerTextarea(aiApp).fill("make the lighting warmer");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const dlg = aiApp.mainWindow.getByTestId("ai-chat-generated-batch-confirm");
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow
      .getByTestId("ai-chat-generated-batch-confirm-accept")
      .click();
    const pc = aiApp.mainWindow.getByTestId("ai-chat-permission-card").first();
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await drainBatchApprovals(aiApp);
    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 90_000,
    });

    // The save is queued — the toast names the missing workspace and the
    // request-workspace card opens.
    const tiles = root.locator(".v2-message__generated-image");
    const tileCount = await tiles.count();
    expect(tileCount).toBeGreaterThanOrEqual(4);
    await tiles
      .nth(tileCount - 1)
    .getByRole("button", { name: "Save to workspace" })
    .click();
    // The workspace shell reports export outcomes in its deferred-image
    // notice (the ai-chat-generated-error-toast id belongs to AiChatV2).
    await expect(
      aiApp.mainWindow.getByTestId("workspace-genimg-notice")
    ).toContainText("approved workspace is required", { timeout: 15_000 });
    const wsCard = aiApp.mainWindow.getByTestId("workspace-required");
    await expect(wsCard).toBeVisible({ timeout: 15_000 });

    // Confirm the folder pick through the deterministic E2E dialog: the
    // workspace is created + approved in the MAIN process, the card's
    // approved event adopts it, and the queued export auto-retries.
    await wsCard.getByRole("button", { name: "Pick folder" }).click();

    // The saved toast carries the file name; the file must exist under the
    // approved workspace root (written by the trusted export path).
    const savedToast = aiApp.mainWindow.getByTestId(
      "workspace-genimg-notice"
    );
    await expect(savedToast).toContainText("Saved", { timeout: 60_000 });
    const toastText = await savedToast.textContent();
    const nameMatch = toastText?.match(/Saved (.+?) to your workspace\./);
    expect(nameMatch).not.toBeNull();
    const savedFile = path.join(
      testRoot.workspacePath,
      "generated-artifacts",
      nameMatch?.[1] ?? ""
    );
    expect(fs.existsSync(savedFile)).toBe(true);
  });
});
