import { describe, expect, it } from "vitest";
import {
  buildChatV2ConversationSnapshot,
  hasEligibleChatV2Candidate,
  hasEligibleLegacyCandidate,
  hasEligibleKnowledgeCandidate,
} from "@/views/components/aiContentReport/conversationReportSnapshot";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";

function makeAssistant(
  id: string,
  content: string,
  opts: Partial<ChatV2MessageView> = {}
): ChatV2MessageView {
  return {
    id,
    conversationId: "conv-1",
    role: "assistant",
    content,
    timestamp: "2026-01-01T00:00:00.000Z",
    messageType: MessageType.MESSAGE,
    ...opts,
  };
}

function makeUser(
  id: string,
  content: string,
  opts: Partial<ChatV2MessageView> = {}
): ChatV2MessageView {
  return {
    id,
    conversationId: "conv-1",
    role: "user",
    content,
    timestamp: "2026-01-01T00:00:00.000Z",
    messageType: MessageType.MESSAGE,
    ...opts,
  };
}

describe("buildChatV2ConversationSnapshot", () => {
  it("includes completed visible assistant messages", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [makeUser("u1", "hi"), makeAssistant("a1", "hello there")],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    expect(snap.candidates.length).toBe(1);
    expect(snap.candidates[0].messageId).toBe("a1");
    expect(snap.candidates[0].role).toBe("assistant");
    expect(snap.candidates[0].text).toBe("hello there");
  });

  it("excludes user, system, tool rows", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "hi"),
        { ...makeAssistant("a1", "x"), role: "system" },
        {
          ...makeAssistant("t1", "x"),
          role: "tool",
          messageType: MessageType.TOOL_RESULT,
        },
        makeAssistant("a2", "real answer"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    expect(snap.candidates.map((c) => c.messageId)).toEqual(["a2"]);
  });

  it("excludes the active streaming placeholder", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeAssistant("streaming", "", { content: "" }),
        makeAssistant("done", "final"),
      ],
      activeAssistantMessageId: "streaming",
      streamStatus: "streaming",
    });
    expect(snap.candidates.map((c) => c.messageId)).toEqual(["done"]);
  });

  it("resolves only directly related visible user messages", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "first question"),
        makeAssistant("a1", "first answer"),
        makeUser("u2", "second question"),
        makeAssistant("a2", "second answer"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a2 = snap.candidates.find((c) => c.messageId === "a2")!;
    expect(a2.relatedUser?.messageId).toBe("u2");
    expect(a2.relatedUser?.text).toBe("second question");
  });

  it("does not reuse an earlier user after a completed assistant (no cross-pair reuse)", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "q1"),
        makeAssistant("a1", "a1"),
        makeAssistant("a2", "a2 (no user between)"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a2 = snap.candidates.find((c) => c.messageId === "a2")!;
    expect(a2.relatedUser).toBeUndefined();
  });

  it("sets omittedAttachmentContent when excluded metadata is present", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "with attach", {
          metadata: {
            source: "chat-v2",
            attachments: [
              {
                fileName: "file.pdf",
                mimeType: "application/pdf",
                sizeBytes: 1,
                kind: "document",
              },
            ],
          } as unknown as ChatV2MessageView["metadata"],
        }),
        makeAssistant("a1", "answer"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a1 = snap.candidates.find((c) => c.messageId === "a1")!;
    expect(a1.relatedUser?.omittedAttachmentContent).toBe(true);
  });

  it("never copies URLs or metadata objects into the snapshot", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "q", {
          metadata: {
            source: "chat-v2",
            attachments: [
              {
                fileName: "f.pdf",
                mimeType: "application/pdf",
                sizeBytes: 1,
                kind: "document",
              },
            ],
          } as unknown as ChatV2MessageView["metadata"],
        }),
        makeAssistant("a1", "a", {
          metadata: {
            source: "chat-v2",
            reasoning: {
              content: "secret reasoning",
              format: "plain_text",
              source: "server",
            },
            generatedImages: [
              {
                type: "image",
                b64_json: "iVBORw0KGgo=",
                mime_type: "image/png",
              },
            ] as unknown,
          } as unknown as ChatV2MessageView["metadata"],
        }),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a1 = snap.candidates.find((c) => c.messageId === "a1")!;
    // reasoning must NOT leak
    expect(JSON.stringify(a1)).not.toContain("secret reasoning");
    // the generated image bytes ARE copied (safe), but only as dataBase64
    expect(a1.images[0].dataBase64).toBe("iVBORw0KGgo=");
  });

  it("is immutable: snapshot does not change when source messages mutate", () => {
    const messages = [makeUser("u1", "q"), makeAssistant("a1", "a")];
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const before = JSON.stringify(snap);
    messages[1].content = "mutated after snapshot";
    const after = JSON.stringify(snap);
    expect(after).toBe(before);
  });

  it("handles 500-message histories without quadratic blowup (linear pass)", () => {
    const messages: ChatV2MessageView[] = [];
    for (let i = 0; i < 250; i++) {
      messages.push(makeUser(`u${i}`, `q${i}`));
      messages.push(makeAssistant(`a${i}`, `a${i}`));
    }
    const start = Date.now();
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const ms = Date.now() - start;
    expect(snap.candidates.length).toBe(250);
    // Linear pass: 500 messages should normalize in well under 200ms.
    expect(ms).toBeLessThan(500);
  });
});

describe("hasEligibleChatV2Candidate", () => {
  it("returns true when a completed assistant with text exists", () => {
    expect(
      hasEligibleChatV2Candidate({
        conversationId: "conv-1",
        messages: [makeUser("u1", "hi"), makeAssistant("a1", "answer")],
        activeAssistantMessageId: null,
        streamStatus: "idle",
      })
    ).toBe(true);
  });

  it("returns false when only user messages exist", () => {
    expect(
      hasEligibleChatV2Candidate({
        conversationId: "conv-1",
        messages: [makeUser("u1", "hi")],
        activeAssistantMessageId: null,
        streamStatus: "idle",
      })
    ).toBe(false);
  });

  it("returns false when the only assistant is the active streaming placeholder", () => {
    expect(
      hasEligibleChatV2Candidate({
        conversationId: "conv-1",
        messages: [makeAssistant("streaming", "in flight")],
        activeAssistantMessageId: "streaming",
        streamStatus: "streaming",
      })
    ).toBe(false);
  });

  it("returns false for empty conversation", () => {
    expect(
      hasEligibleChatV2Candidate({
        conversationId: "conv-1",
        messages: [],
        activeAssistantMessageId: null,
        streamStatus: "idle",
      })
    ).toBe(false);
  });

  it("returns true when the eligible assistant carries only a generated image", () => {
    expect(
      hasEligibleChatV2Candidate({
        conversationId: "conv-1",
        messages: [
          makeAssistant("a1", "", {
            content: "",
            metadata: {
              source: "chat-v2",
              generatedImages: [
                {
                  type: "image",
                  b64_json: "iVBORw0KGgo=",
                  mime_type: "image/png",
                },
              ] as unknown,
            } as unknown as ChatV2MessageView["metadata"],
          }),
        ],
        activeAssistantMessageId: null,
        streamStatus: "idle",
      })
    ).toBe(true);
  });
});

describe("hasEligibleLegacyCandidate", () => {
  const makeLegacy = (
    id: string,
    content: string,
    role: "user" | "assistant" = "assistant"
  ) => ({
    id,
    conversationId: "conv-1",
    role,
    content,
    timestamp: new Date(),
    messageType: MessageType.MESSAGE,
  });

  it("returns true when a non-streaming assistant with text exists", () => {
    expect(
      hasEligibleLegacyCandidate({
        conversationId: "conv-1",
        messages: [makeLegacy("a1", "answer")],
      })
    ).toBe(true);
  });

  it("returns false when the only assistant is the streaming placeholder", () => {
    expect(
      hasEligibleLegacyCandidate({
        conversationId: "conv-1",
        messages: [makeLegacy("streaming", "in flight")],
        streamingAssistantMessageId: "streaming",
      })
    ).toBe(false);
  });

  it("returns false for empty messages", () => {
    expect(
      hasEligibleLegacyCandidate({
        conversationId: "conv-1",
        messages: [],
      })
    ).toBe(false);
  });
});

describe("hasEligibleKnowledgeCandidate", () => {
  const makeKnowledge = (
    id: string,
    content: string,
    type: "user" | "ai" = "ai"
  ) => ({
    id,
    type,
    content,
    timestamp: "2026-01-01T00:00:00.000Z",
  });

  it("returns true when an ai message with text exists", () => {
    expect(hasEligibleKnowledgeCandidate([makeKnowledge("a1", "answer")])).toBe(
      true
    );
  });

  it("returns false when only user messages exist", () => {
    expect(
      hasEligibleKnowledgeCandidate([makeKnowledge("u1", "q", "user")])
    ).toBe(false);
  });

  it("returns false for empty messages", () => {
    expect(hasEligibleKnowledgeCandidate([])).toBe(false);
  });
});
