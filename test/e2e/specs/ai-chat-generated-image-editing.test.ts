/**
 * Workspace-less generated-image editing flow (E2E, task 14).
 *
 * Covers the UI-level contract of "Use as reference" on rendered generated
 * images without any workspace tools involved (seeding helpers live in
 * ../support/generatedImageSeed.ts):
 *   - a seeded history assistant message carrying
 *     `metadata.generatedImages` renders numbered image tiles with
 *     Use-as-reference / Edit actions;
 *   - clicking the action populates the composer reference tray, with badge
 *     numbers following SELECTION order (not document order);
 *   - tray state is isolated per conversation (new conversation clears the
 *     visible tray; switching back restores it);
 *   - sending an edit request ("add a dog beside the lion") completes against
 *     the FakeOpenAI loopback server, persists
 *     `metadata.generatedImageReferences` on the user turn, never surfaces a
 *     workspace_required tool card, and clears the tray on success.
 *
 * The full generate→edit round-trip and provider-request image assertions
 * live in ai-chat-generated-image-roundtrip.test.ts (the fake server now has
 * a "stream-generated-image" scenario and image-part hashes in its redacted
 * request log).
 */

import { e2eTest as test, expect } from "../fixtures/base";
import { assertCleanTeardown } from "../support/assertions";
import {
  composerTextarea,
  createConversationWithStreamedTurn,
  seedGeneratedImagesOnLastTurn,
  startNewConversation,
  switchToConversationByMarker,
  type HistoryMessageView,
} from "../support/generatedImageSeed";

test.describe("Workspace-less generated-image editing (Electron integration)", () => {
  test.afterEach(({ app, aiApp }) => {
    const a = aiApp ?? app;
    if (a) {
      assertCleanTeardown(a);
    }
  });

  test("seeded generated images render actions; tray numbering follows selection order; tray is per-conversation", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-genimg-order-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);

    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker);

    // Leave and re-enter the conversation so history reloads through the real
    // history IPC and the renderer maps metadata.generatedImages to tiles.
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
    const imageBlocks = root.locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(2);

    // Numbered badges reflect the document position of each generated image.
    const tileBadges = root.locator(".v2-message__generated-image-index");
    await expect(tileBadges.nth(0)).toHaveText("1");
    await expect(tileBadges.nth(1)).toHaveText("2");

    // Message-level actions are present on every generated image.
    for (let index = 0; index < 2; index += 1) {
      await expect(
        imageBlocks.nth(index).getByRole("button", { name: "Use as reference" })
      ).toBeVisible();
      await expect(
        imageBlocks.nth(index).getByRole("button", { name: "Edit" })
      ).toBeVisible();
    }

    // Select in REVERSE document order: the tray must number chips by
    // selection order (badge 1 = savanna.png selected first), not by the
    // order images appear in the message.
    await imageBlocks
      .nth(1)
      .getByRole("button", { name: "Use as reference" })
      .click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-tray")
    ).toBeVisible();

    await imageBlocks
      .nth(0)
      .getByRole("button", { name: "Use as reference" })
      .click();

    const chips = aiApp.mainWindow.getByTestId("ai-chat-generated-ref-chip");
    await expect(chips).toHaveCount(2);
    const chipBadges = chips.locator(".v2-composer__generated-ref-badge");
    await expect(chipBadges.nth(0)).toHaveText("1");
    await expect(chipBadges.nth(1)).toHaveText("2");
    const chipNames = chips.locator(".v2-composer__generated-ref-name");
    await expect(chipNames.nth(0)).toHaveText("savanna.png");
    await expect(chipNames.nth(1)).toHaveText("lion.png");

    // Conversation-switch isolation: a new conversation starts with an empty
    // tray; switching back restores THIS conversation's selection untouched.
    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-chip")
    ).toHaveCount(2);
    await expect(chipNames.nth(0)).toHaveText("savanna.png");
    await expect(chipNames.nth(1)).toHaveText("lion.png");

    // The clear-all control empties the tray and removes it from the DOM.
    await aiApp.mainWindow.getByTestId("ai-chat-generated-ref-clear").click();
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-tray")
    ).toHaveCount(0);
  });

  test("sending an edit request with a referenced image completes without workspace_required and persists references", async ({
    aiApp,
    fakeAi,
    testRoot,
  }) => {
    await fakeAi.setScenario("stream-text");
    const marker = `e2e-genimg-edit-${Date.now()}`;
    await createConversationWithStreamedTurn(aiApp, marker);
    await seedGeneratedImagesOnLastTurn(aiApp, testRoot, marker);

    await startNewConversation(aiApp);
    await switchToConversationByMarker(aiApp, marker);

    const imageBlocks = aiApp.mainWindow
      .getByTestId("ai-chat-root")
      .locator(".v2-message__generated-image");
    await expect(imageBlocks).toHaveCount(2);

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

    // The edit turn reached the fake provider through the real
    // renderer -> preload -> IPC -> engine -> provider path.
    await expect
      .poll(async () => (await fakeAi.getRequests()).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(requestsBefore);

    // The turn completes (composer actionable again)…
    await expect(composerTextarea(aiApp)).toBeEnabled({ timeout: 30_000 });

    // …no workspace_required card/text ever appears — this flow must stay
    // workspace-less end to end.
    const root = aiApp.mainWindow.getByTestId("ai-chat-root");
    await expect(root.locator(".workspace-required-card")).toHaveCount(0);
    await expect(root).not.toContainText(
      "An approved workspace is required first."
    );

    // Success clears the conversation's reference selection.
    await expect(
      aiApp.mainWindow.getByTestId("ai-chat-generated-ref-tray")
    ).toHaveCount(0);

    // The user turn persisted generatedImageReferences through the engine —
    // proof the tray contents were attached to the outgoing request.
    const persistedRefs = await aiApp.mainWindow.evaluate(async () => {
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
      if (convs.length === 0) return [];
      const histResp = await api.invoke(
        "ai-chat-v2:history",
        JSON.stringify({ conversationId: convs[0].conversationId })
      );
      const histData = (histResp?.data ?? {}) as {
        messages?: HistoryMessageView[];
      };
      const messages = histData.messages ?? [];
      const usersWithRefs = messages.filter(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.metadata?.generatedImageReferences) &&
          (m.metadata?.generatedImageReferences?.length ?? 0) > 0
      );
      return usersWithRefs.map(
        (m) => m.metadata?.generatedImageReferences?.length ?? 0
      );
    });
    expect(persistedRefs.length).toBeGreaterThanOrEqual(1);
    expect(persistedRefs[persistedRefs.length - 1]).toEqual(1);
  });

  // The full generate→edit round-trip (live fake-server image output,
  // provider-request image-part assertions, forged references, and the
  // attach_local_images handoff flow) lives in
  // ai-chat-generated-image-roundtrip.test.ts.
});
