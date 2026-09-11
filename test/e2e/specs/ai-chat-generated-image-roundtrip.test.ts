/**
 * Generated-image editing round-trip + provider-request assertions (E2E).
 *
 * Uses the fake server's "stream-generated-image" scenario (real streamed
 * delta.images through the production parser + storage service) and the
 * redacted request log's image-part HASHES to prove:
 *
 *   P2-3  1. no-workspace generate → use-as-reference → edit round-trip
 *            (edited image renders; outgoing edit request carries exactly the
 *            selected image; no workspace_required anywhere);
 *         2. selection order reaches the provider request (learn-then-assert
 *            on distinct seeded PNGs);
 *         3. selecting an OLDER image excludes the latest unselected one;
 *         6. a forged cross-conversation reference is rejected before any
 *            provider work, without path disclosure.
 *
 *   P2-4     the scripted attachment handoff: glob_files → attach_local_images
 *            (both permission-gated), the metadata-only tool continuation, and
 *            the synthetic multimodal user handoff with bounded image parts.
 *
 * All flows run against the loopback FakeOpenAI server via the real
 * renderer → preload → IPC → engine → provider path.
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import {
  composerTextarea,
  createConversationWithStreamedTurn,
  openChat,
  seedGeneratedImagesOnLastTurn,
  startNewConversation,
  switchToConversationByMarker,
} from "../support/generatedImageSeed";
import type { RedactedRequest } from "../fixtures/fakeOpenAiServer";
import type { LaunchedApp } from "../fixtures/electronApp";
import * as fs from "fs";
import * as path from "path";

test.describe("Generated-image editing round-trip (Electron integration)", () => {
  test.setTimeout(180_000);
  test.afterEach(({ app, aiApp }) => {
    const a = aiApp ?? app;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("generate → use-as-reference → edit returns an edited image without any workspace", async ({
    aiApp,
    fakeAi,
  }) => {
    await fakeAi.setScenario("stream-generated-image");
    const marker = `e2e-roundtrip-${Date.now()}`;
    await openChat(aiApp);

    // 1. Generate: the fake stream carries one generated image; the storage
    //    service persists it and the renderer maps it to a tile with actions.
    await composerTextarea(aiApp).fill(`${marker} draw a lion`);
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
    const imageBlocks = root.locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(1, { timeout: 30_000 });
    await expect(
      imageBlocks.nth(0).getByRole("button", { name: "Use as reference" })
    ).toBeVisible();
    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 30_000,
    });

    // 2. Reference the generated image and send the edit.
    await imageBlocks
      .nth(0)
      .getByRole("button", { name: "Use as reference" })
      .click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-chip")
    ).toHaveCount(1);

    const requestsBefore = (await fakeAi.getRequests()).length;
    await composerTextarea(aiApp).fill("add a dog beside the lion");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    // 3. The edit turn reaches the provider with EXACTLY one image part.
    let editRequest: RedactedRequest | undefined;
    await expect
      .poll(
        async () => {
          const requests = await fakeAi.getRequests();
          editRequest = requests[requests.length - 1];
          return requests.length;
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(requestsBefore);
    expect(editRequest?.imagePartHashes.length).toBe(1);

    // 4. The turn completes with a SECOND generated image and never asks for
    //    a workspace.
    await expect(imageBlocks).toHaveCount(2, { timeout: 30_000 });
    await expect(root.locator(".workspace-required-card")).toHaveCount(0);
    await expect(root).not.toContainText("workspace_required");
    // Success clears the tray.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-tray")
    ).toHaveCount(0);
  });

  test("selected order reaches the provider; an unselected latest image is excluded", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-order-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    // Seed TWO images with distinct PNG bytes (index 0 = transparent,
    // index 1 = red) so request-side hashes are distinguishable.
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker);
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const imageBlocks = aiApp.mainWindow
      .getByTestId("ai-chat-root")
      .locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(2);

    /** Send one edit turn with the currently selected references and return
     * the request's image-part hashes. */
    const sendEditAndGetHashes = async (
      text: string
    ): Promise<readonly string[]> => {
      const before = (await fakeAi.getRequests()).length;
      await composerTextarea(aiApp).fill(text);
      await aiApp.mainWindow.getByTestId("ai-chat-send").click();
      let request: RedactedRequest | undefined;
      await expect
        .poll(
          async () => {
            const requests = await fakeAi.getRequests();
            request = requests[requests.length - 1];
            return requests.length;
          },
          { timeout: 30_000 }
        )
        .toBeGreaterThan(before);
      await expect(composerTextarea(aiApp)).not.toBeDisabled({
        timeout: 30_000,
      });
      return request?.imagePartHashes ?? [];
    };

    // Learn each image's normalized request hash with single-image turns.
    await imageBlocks
      .nth(0)
      .getByRole("button", { name: "Use as reference" })
      .click();
    const hashFirst = await sendEditAndGetHashes("make the first brighter");
    expect(hashFirst.length).toBe(1);

    await imageBlocks
      .nth(1)
      .getByRole("button", { name: "Use as reference" })
      .click();
    const hashSecond = await sendEditAndGetHashes("make the second warmer");
    expect(hashSecond.length).toBe(1);
    expect(hashSecond[0]).not.toBe(hashFirst[0]);

    // Select in REVERSE order (second, then first): the fusion request must
    // carry the hashes in SELECTION order, and no third/unselected image.
    await imageBlocks
      .nth(1)
      .getByRole("button", { name: "Use as reference" })
      .click();
    await imageBlocks
      .nth(0)
      .getByRole("button", { name: "Use as reference" })
      .click();
    const fusionHashes = await sendEditAndGetHashes(
      "put image 1 on the left and image 2 on the right"
    );
    expect(fusionHashes.length).toBe(2);
    expect(fusionHashes[0]).toBe(hashSecond[0]);
    expect(fusionHashes[1]).toBe(hashFirst[0]);
  });

  test("a forged cross-conversation reference is rejected before provider work without path disclosure", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-forge-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    const seeded = await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker);

    // A second, distinct conversation exists before the forged send.
    const secondMarker = `e2e-forge-b-${Date.now()}`;
    await startNewConversation(aiApp);
    await composerTextarea(aiApp).fill(secondMarker);
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();
    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 30_000,
    });

    const requestsBefore = (await fakeAi.getRequests()).length;

    // Forge: from the SECOND conversation, reference the FIRST conversation's
    // generated image directly through the real stream IPC (bypassing the
    // renderer's own selection state). The main process must reject it
    // before any provider call.
    const errorEvents: string[] = [];
    await aiApp.mainWindow.evaluate(
      async ({ conversationId, messageId }) => {
        const api = (
          window as unknown as {
            api: {
              send: (channel: string, data?: unknown) => void;
              receive: (
                channel: string,
                func: (raw: unknown) => void
              ) => () => void;
            };
          }
        ).api;
        // Early rejections ride the COMPLETE channel; later engine errors ride
        // the CHUNK channel — collect from both.
        const collect = (raw: unknown): void => {
          try {
            const chunk = JSON.parse(String(raw)) as {
              eventType?: string;
              errorMessage?: string;
              errorCode?: string;
            };
            if (chunk.eventType === "error" && chunk.errorMessage) {
              const holder = window as unknown as { __forgeErrors?: string[] };
              holder.__forgeErrors ??= [];
              holder.__forgeErrors.push(
                `${chunk.errorMessage}|${chunk.errorCode ?? ""}`
              );
            }
          } catch {
            /* ignore */
          }
        };
        api.receive("ai-chat-v2:stream-chunk", collect);
        api.receive("ai-chat-v2:stream-complete", collect);
        // The IPC handler JSON.parses the payload — send a string.
        api.send(
          "ai-chat-v2:stream",
          JSON.stringify({
            conversationId,
            message: "edit this image",
            mode: "chat",
            generatedImageReferences: [{ messageId, imageIndex: 0 }],
          })
        );
      },
      {
        conversationId: await secondConversationId(aiApp, secondMarker),
        messageId: seeded.assistantMessageId,
      }
    );

    // The forged reference produces NO provider request…
    await aiApp.mainWindow.waitForTimeout(2_000);
    expect((await fakeAi.getRequests()).length).toBe(requestsBefore);

    // …and surfaces a typed, path-free error.
    await expect
      .poll(
        async () => {
          errorEvents.length = 0;
          errorEvents.push(
            ...((await aiApp.mainWindow.evaluate(() => {
              return (
                (window as unknown as { __forgeErrors?: string[] })
                  .__forgeErrors ?? []
              );
            })) as string[])
          );
          return errorEvents.length;
        },
        { timeout: 15_000 }
      )
      .toBeGreaterThan(0);
    const errorText = errorEvents.join("\n").toLowerCase();
    expect(errorText).not.toContain("/tmp");
    expect(errorText).not.toContain(".png");
    expect(errorText).not.toContain("aifetchly-generated-image://");
  });

  test("attach_local_images handoff: permission-gated attach, metadata-only tool message, then bounded multimodal handoff", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    // Workspace with one real PNG the tool can attach.
    const wsRoot = (testRoot as { workspacePath: string }).workspacePath;
    fs.writeFileSync(
      path.join(wsRoot, "lion.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64"
      )
    );

    await fakeAi.setScenario("stream-text");
    const marker = `e2e-attach-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);

    // Approve the isolated workspace for this conversation (real IPC).
    const err = await aiApp.mainWindow.evaluate(async (rootPath: string) => {
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
      const setResp = await api.invoke(
        "ai-workspace:set",
        JSON.stringify({
          conversationId: convs[0].conversationId,
          rootPath,
          label: "e2e",
        })
      );
      const id = (setResp?.data as { id?: unknown } | undefined)?.id;
      if (typeof id !== "number") return `no id (${setResp?.msg ?? "?"})`;
      await api.invoke("ai-workspace:approve", JSON.stringify({ id }));
      return undefined;
    }, wsRoot);
    expect(err, `workspace setup failed: ${err ?? ""}`).toBeUndefined();

    // Script the two-step tool conversation: glob_files first, then
    // attach_local_images. Each request consumes one queue entry.
    await fakeAi.setToolCallQueue([
      { name: "glob_files", arguments: JSON.stringify({ pattern: "*.png" }) },
      {
        name: "attach_local_images",
        arguments: JSON.stringify({ paths: ["lion.png"] }),
      },
    ]);

    const requestsBefore = (await fakeAi.getRequests()).length;
    await composerTextarea(aiApp).fill(
      "attach lion.png and add a dog beside the lion"
    );
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    // Both tool calls are permission-gated: nothing attaches before approval.
    const card = aiApp.mainWindow.getByTestId("ai-chat-permission-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("glob_files");
    await aiApp.mainWindow.getByTestId("ai-chat-permission-allow-once").click();

    // Second gate: attach_local_images requires its own approval.
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("attach_local_images");
    await aiApp.mainWindow.getByTestId("ai-chat-permission-allow-once").click();

    // The flow settles once the synthetic handoff + its completion ran.
    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 60_000,
    });

    const requests = (await fakeAi.getRequests()).slice(requestsBefore);
    expect(requests.length).toBeGreaterThanOrEqual(3);

    // Request 2 (continuation after glob) is metadata-only: a tool-role
    // message with NO image parts.
    const globContinuation = requests[1];
    expect(globContinuation.roles).toContain("tool");
    expect(globContinuation.imagePartHashes.length).toBe(0);

    // The final provider request is the synthetic multimodal handoff — the
    // only image-bearing request in the flow, bounded to 1..3 parts. (Its
    // transcript legitimately still contains the earlier tool messages; the
    // NEW current-turn content is the user-role handoff with image parts.)
    const handoff = requests[requests.length - 1];
    expect(handoff.imagePartHashes.length).toBeGreaterThanOrEqual(1);
    expect(handoff.imagePartHashes.length).toBeLessThanOrEqual(3);
    const withImages = requests.filter((r) => r.imagePartHashes.length > 0);
    expect(withImages.length).toBe(1);
    expect(withImages[0]).toBe(handoff);
  });

  test("denying the attach permission never produces an image handoff request", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    const wsRoot = (testRoot as { workspacePath: string }).workspacePath;
    fs.writeFileSync(
      path.join(wsRoot, "deny.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64"
      )
    );

    await fakeAi.setScenario("stream-text");
    const marker = `e2e-attach-deny-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);

    const err = await aiApp.mainWindow.evaluate(async (rootPath: string) => {
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
      const setResp = await api.invoke(
        "ai-workspace:set",
        JSON.stringify({
          conversationId: convs[0].conversationId,
          rootPath,
          label: "e2e",
        })
      );
      const id = (setResp?.data as { id?: unknown } | undefined)?.id;
      if (typeof id !== "number") return `no id (${setResp?.msg ?? "?"})`;
      await api.invoke("ai-workspace:approve", JSON.stringify({ id }));
      return undefined;
    }, wsRoot);
    expect(err, `workspace setup failed: ${err ?? ""}`).toBeUndefined();

    await fakeAi.setToolCall(
      "attach_local_images",
      JSON.stringify({ paths: ["deny.png"] })
    );

    const requestsBefore = (await fakeAi.getRequests()).length;
    await composerTextarea(aiApp).fill("attach deny.png and edit it");
    await aiApp.mainWindow.getByTestId("ai-chat-send").click();

    const card = aiApp.mainWindow.getByTestId("ai-chat-permission-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await aiApp.mainWindow.getByTestId("ai-chat-permission-deny").click();

    await expect(composerTextarea(aiApp)).not.toBeDisabled({
      timeout: 30_000,
    });

    // Denial completes the turn WITHOUT any image-bearing provider request.
    const requests = (await fakeAi.getRequests()).slice(requestsBefore);
    for (const request of requests) {
      expect(request.imagePartHashes.length).toBe(0);
    }
  });
});

/** Resolve the conversation id whose title contains `marker` (real IPC). */
async function secondConversationId(
  app: LaunchedApp,
  marker: string
): Promise<string> {
  // Conversation titles derive from the assistant reply, so locate the
  // conversation whose history contains a user message with the marker text.
  const id = await app.mainWindow.evaluate(async (titleMarker: string) => {
    const api = (
      window as unknown as {
        api: {
          invoke: (
            channel: string,
            data?: unknown
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
        messages?: Array<{ role?: string; content?: string }>;
      };
      const hasMarker = (histData.messages ?? []).some(
        (m) => m.role === "user" && m.content === titleMarker
      );
      if (hasMarker) return conv.conversationId;
    }
    return null;
  }, marker);
  if (!id) throw new Error(`conversation not found for marker ${marker}`);
  return id;
}
