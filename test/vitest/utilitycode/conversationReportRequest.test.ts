import { describe, expect, it, vi } from "vitest";
import { buildCreateAIConversationReportRequest } from "@/views/components/aiContentReport/conversationReportRequest";
import { buildChatV2ConversationSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";

// Mock the image encoder so we don't need a real canvas in node tests.
vi.mock(
  "@/views/components/aiContentReport/AIContentReportImageEncoder",
  () => ({
    encodeReportImagePreview: vi.fn(async (src: { dataBase64?: string }) =>
      src.dataBase64
        ? {
            mimeType: "image/png" as const,
            dataBase64: src.dataBase64,
            width: 1,
            height: 1,
          }
        : null
    ),
  })
);

function snapWithTwoAssistants(): ReturnType<
  typeof buildChatV2ConversationSnapshot
> {
  const messages: ChatV2MessageView[] = [
    {
      id: "u1",
      conversationId: "conv-1",
      role: "user",
      content: "q1",
      timestamp: "2026-01-01T00:00:00.000Z",
      messageType: MessageType.MESSAGE,
    },
    {
      id: "a1",
      conversationId: "conv-1",
      role: "assistant",
      content: "answer1",
      timestamp: "2026-01-01T00:00:01.000Z",
      messageType: MessageType.MESSAGE,
    },
    {
      id: "u2",
      conversationId: "conv-1",
      role: "user",
      content: "q2",
      timestamp: "2026-01-01T00:00:02.000Z",
      messageType: MessageType.MESSAGE,
    },
    {
      id: "a2",
      conversationId: "conv-1",
      role: "assistant",
      content: "answer2",
      timestamp: "2026-01-01T00:00:03.000Z",
      messageType: MessageType.MESSAGE,
    },
  ];
  return buildChatV2ConversationSnapshot({
    conversationId: "conv-1",
    messages,
    activeAssistantMessageId: null,
    streamStatus: "idle",
  });
}

describe("buildCreateAIConversationReportRequest", () => {
  it("builds an assistant-only request with contiguous sequences", async () => {
    const snap = snapWithTwoAssistants();
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1", "ai-a2"]),
      selectedImageIds: new Set(),
      includeRelatedUserContext: false,
      category: "other",
      comment: "issue",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.schemaVersion).toBe(2);
    expect(req.reportScope).toBe("selected_ai_outputs");
    expect(req.items.map((i) => i.sequence)).toEqual([0, 1]);
    expect(req.items.every((i) => i.role === "assistant")).toBe(true);
    expect(req.context.selectedAIItemCount).toBe(2);
    expect(req.context.includedUserItemCount).toBe(0);
  });

  it("merges opted-in related users by sourceIndex", async () => {
    const snap = snapWithTwoAssistants();
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1", "ai-a2"]),
      selectedImageIds: new Set(),
      includeRelatedUserContext: true,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.reportScope).toBe(
      "selected_ai_outputs_with_related_user_context"
    );
    // 2 assistants + 2 related users = 4 items, ordered by sourceIndex
    expect(req.items.length).toBe(4);
    expect(req.items.map((i) => i.sequence)).toEqual([0, 1, 2, 3]);
    expect(req.context.includedUserItemCount).toBe(2);
    // user items carry consentSource
    expect(
      req.items
        .filter((i) => i.role === "user")
        .every((u) => u.consentSource === "related_user_context_toggle")
    ).toBe(true);
  });

  it("rejects zero selections", async () => {
    const snap = snapWithTwoAssistants();
    await expect(
      buildCreateAIConversationReportRequest({
        snapshot: snap,
        selectedAIItemIds: new Set(),
        selectedImageIds: new Set(),
        includeRelatedUserContext: false,
        category: "other",
        locale: "en-US",
        clientReportId: "client-1",
      })
    ).rejects.toThrow();
  });

  it("rejects more than 10 AI selections", async () => {
    // Build a snapshot with 11 actual assistant candidates so the selection
    // limit (>10) is genuinely exercised — not just 11 IDs against 2 candidates.
    const messages: ChatV2MessageView[] = Array.from(
      { length: 11 },
      (_, i) => ({
        id: `a${i}`,
        conversationId: "conv-1",
        role: "assistant" as const,
        content: `answer${i}`,
        timestamp: `2026-01-01T00:00:0${i % 10}.000Z`,
        messageType: MessageType.MESSAGE,
      })
    );
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const ids = new Set(snap.candidates.map((c) => c.itemId));
    await expect(
      buildCreateAIConversationReportRequest({
        snapshot: snap,
        selectedAIItemIds: ids,
        selectedImageIds: new Set(),
        includeRelatedUserContext: false,
        category: "other",
        locale: "en-US",
        clientReportId: "client-1",
      })
    ).rejects.toThrow();
  });

  it("encodes at most three images and stops after three successful previews", async () => {
    const messages: ChatV2MessageView[] = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      conversationId: "conv-1",
      role: "assistant" as const,
      content: `text${i}`,
      timestamp: `2026-01-01T00:00:0${i}.000Z`,
      messageType: MessageType.MESSAGE,
      metadata: {
        source: "chat-v2",
        generatedImages: [
          { type: "image", b64_json: "iVBORw0KGgo=", mime_type: "image/png" },
        ],
      },
    }));
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(snap.candidates.map((c) => c.itemId)),
      selectedImageIds: new Set(
        snap.candidates.flatMap((c) => c.images.map((img) => img.sourceId))
      ),
      includeRelatedUserContext: false,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    const totalImages = req.items.reduce(
      (n, i) => n + (i.imagePreviews?.length ?? 0),
      0
    );
    expect(totalImages).toBeLessThanOrEqual(3);
  });

  it("represents image conversion failure with evidenceUnavailable", async () => {
    const { encodeReportImagePreview } = await import(
      "@/views/components/aiContentReport/AIContentReportImageEncoder"
    );
    vi.mocked(encodeReportImagePreview).mockResolvedValueOnce(null);
    const messages: ChatV2MessageView[] = [
      {
        id: "a1",
        conversationId: "conv-1",
        role: "assistant",
        content: "text",
        timestamp: "2026-01-01T00:00:00.000Z",
        messageType: MessageType.MESSAGE,
        metadata: {
          source: "chat-v2",
          generatedImages: [
            { type: "image", b64_json: "bad", mime_type: "image/png" },
          ],
        },
      },
    ];
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1"]),
      selectedImageIds: new Set(["a1-img-0"]),
      includeRelatedUserContext: false,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.items[0].evidenceUnavailable).toBe(true);
    // The source URL/path is never added (images carry only dataBase64)
    expect(req.items[0].imagePreviews).toBeUndefined();
  });

  it("excludes unselected candidates", async () => {
    const snap = snapWithTwoAssistants();
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1"]),
      selectedImageIds: new Set(),
      includeRelatedUserContext: false,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.items.length).toBe(1);
    expect(req.items[0].messageId).toBe("a1");
  });
});
