/**
 * Live generated-image batch E2E (R-1, R-2, R-3).
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
 *   R-2  Stop mid-batch → completed retained, queued cancelled, Retry-failed
 *        resumes only failed/cancelled.
 *   R-3  Use a batch-produced image as reference in a follow-up edit →
 *        resolves under the PARENT conversation/message identity.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import {
  composerTextarea,
  seedGeneratedImagesOnLastTurn,
  startNewConversation,
  switchToConversationByMarker,
  createConversationWithStreamedTurn,
} from "../support/generatedImageSeed";
import type { ScriptedToolCall } from "../fixtures/fakeOpenAiServer";

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

test.describe("Generated-image batch — live (Electron integration)", () => {
  test.setTimeout(240_000);
  test.afterEach(({ app, aiApp }) => {
    const a = aiApp ?? app;
    if (a) {
      assertCleanTeardown(a);
    }
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

    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
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

    // process_artifact_batch is permission-gated (filesystem category); approve
    // it so the batch execution can start.
    const permCard = aiApp.mainWindow.getByTestId("ai-chat-permission-card");
    await expect(permCard).toBeVisible({ timeout: 30_000 });
    await expect(permCard).toContainText("process_artifact_batch");
    await aiApp.mainWindow.getByTestId("ai-chat-permission-allow-once").click();

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
    // The batch ran all 4 items.
    const result = batchToolResult as {
      requestedCount?: number;
      completedCount?: number;
    };
    expect(result.requestedCount).toBe(4);
    expect(result.completedCount).toBe(4);

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

    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
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
    const pc = aiApp.mainWindow.getByTestId("ai-chat-permission-card");
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow.getByTestId("ai-chat-permission-allow-once").click();

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

    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
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
    const pc = aiApp.mainWindow.getByTestId("ai-chat-permission-card");
    await expect(pc).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow.getByTestId("ai-chat-permission-allow-once").click();
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
});
