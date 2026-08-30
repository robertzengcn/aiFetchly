import { describe, expect, it } from "vitest";
import {
  createAIConversationReportSchema,
  createAnyAIContentReportSchema,
} from "@/schemas/ipc/aiContentReport";
import type { CreateAIConversationReportRequest } from "@/entityTypes/aiContentReportTypes";

function makeValidV2(
  overrides: Partial<CreateAIConversationReportRequest> = {}
): CreateAIConversationReportRequest {
  return {
    schemaVersion: 2,
    clientReportId: "client-uuid-v2",
    surface: "chat_v2",
    reportScope: "selected_ai_outputs",
    category: "other",
    comment: "Conversation issue",
    items: [
      {
        itemId: "item-1",
        messageId: "msg-1",
        sequence: 0,
        role: "assistant",
        contentType: "text",
        text: "AI response text",
      },
    ],
    context: {
      conversationId: "conv-1",
      selectedAIItemCount: 1,
      includedUserItemCount: 0,
      appVersion: "1.0.0",
      platform: "win32",
      locale: "en-US",
    },
    ...overrides,
  };
}

describe("createAIConversationReportSchema (v2)", () => {
  it("accepts a minimal valid v2 request", () => {
    const r = createAIConversationReportSchema().safeParse(makeValidV2());
    expect(r.success).toBe(true);
  });

  it("accepts an opted-in request with a related user item", () => {
    const req = makeValidV2({
      reportScope: "selected_ai_outputs_with_related_user_context",
      items: [
        {
          itemId: "item-0",
          messageId: "user-msg-0",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "What is the capital?",
          consentSource: "related_user_context_toggle",
        },
        {
          itemId: "item-1",
          messageId: "msg-1",
          sequence: 1,
          role: "assistant",
          contentType: "text",
          text: "Paris",
        },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 1,
        includedUserItemCount: 1,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(
      true
    );
  });

  it("rejects zero assistant items", () => {
    const r = createAIConversationReportSchema().safeParse(
      makeValidV2({ items: [] })
    );
    expect(r.success).toBe(false);
  });

  it("rejects more than 10 assistant items", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      itemId: `item-${i}`,
      messageId: `msg-${i}`,
      sequence: i,
      role: "assistant" as const,
      contentType: "text" as const,
      text: "x",
    }));
    const r = createAIConversationReportSchema().safeParse(
      makeValidV2({ items })
    );
    expect(r.success).toBe(false);
  });

  it("rejects user items in selected_ai_outputs scope", () => {
    const req = makeValidV2({
      reportScope: "selected_ai_outputs",
      items: [
        {
          itemId: "u-0",
          messageId: "u-msg-0",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "hi",
          consentSource: "related_user_context_toggle",
        },
        {
          itemId: "a-1",
          messageId: "a-msg-1",
          sequence: 1,
          role: "assistant",
          contentType: "text",
          text: "hello",
        },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 1,
        includedUserItemCount: 1,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(
      false
    );
  });

  it("rejects with_related_user_context with zero user items", () => {
    const r = createAIConversationReportSchema().safeParse(
      makeValidV2({
        reportScope: "selected_ai_outputs_with_related_user_context",
      })
    );
    expect(r.success).toBe(false);
  });

  it("rejects non-contiguous sequences", () => {
    const req = makeValidV2({
      items: [
        {
          itemId: "i0",
          messageId: "m0",
          sequence: 0,
          role: "assistant",
          contentType: "text",
          text: "a",
        },
        {
          itemId: "i1",
          messageId: "m1",
          sequence: 5,
          role: "assistant",
          contentType: "text",
          text: "b",
        },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 2,
        includedUserItemCount: 0,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(
      false
    );
  });

  it("rejects aggregate text over 32000 chars", () => {
    const huge = "x".repeat(33000);
    const req = makeValidV2({
      items: [
        {
          itemId: "i0",
          messageId: "m0",
          sequence: 0,
          role: "assistant",
          contentType: "text",
          text: huge,
        },
      ],
    });
    // Per-item cap is 8000, so this also fails the per-item rule.
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(
      false
    );
  });

  it("rejects user item without consentSource", () => {
    const req = makeValidV2({
      reportScope: "selected_ai_outputs_with_related_user_context",
      items: [
        {
          itemId: "u-0",
          messageId: "u-msg-0",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "hi",
          // consentSource omitted
        },
        {
          itemId: "a-1",
          messageId: "a-msg-1",
          sequence: 1,
          role: "assistant",
          contentType: "text",
          text: "hello",
        },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 1,
        includedUserItemCount: 1,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(
      false
    );
  });

  it("rejects unknown keys (strictObject)", () => {
    const r = createAIConversationReportSchema().safeParse({
      ...makeValidV2(),
      sneaky: "leak",
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 3 total image previews", () => {
    const b64 = "iVBORw0KGgoAAAANS"; // tiny stub
    const img = {
      mimeType: "image/png" as const,
      dataBase64: b64,
      width: 1,
      height: 1,
    };
    const req = makeValidV2({
      items: [
        {
          itemId: "i0",
          messageId: "m0",
          sequence: 0,
          role: "assistant" as const,
          contentType: "mixed" as const,
          text: "a",
          imagePreviews: [img, img],
        },
        {
          itemId: "i1",
          messageId: "m1",
          sequence: 1,
          role: "assistant" as const,
          contentType: "mixed" as const,
          text: "b",
          imagePreviews: [img, img],
        },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 2,
        includedUserItemCount: 0,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(
      false
    );
  });
});

describe("createAnyAIContentReportSchema (union)", () => {
  it("accepts a v1 request", () => {
    const v1 = {
      schemaVersion: 1,
      clientReportId: "c1",
      surface: "chat_v2",
      contentType: "text",
      category: "other",
      comment: "x",
      output: { text: "AI output" },
      context: {
        conversationId: "c",
        messageId: "m",
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    };
    expect(createAnyAIContentReportSchema().safeParse(v1).success).toBe(true);
  });

  it("accepts a v2 request", () => {
    expect(
      createAnyAIContentReportSchema().safeParse(makeValidV2()).success
    ).toBe(true);
  });

  it("rejects a v1 object carrying v2 keys (no items leak into v1)", () => {
    const v1WithV2Keys = {
      schemaVersion: 1,
      clientReportId: "c1",
      surface: "chat_v2",
      contentType: "text",
      category: "other",
      output: { text: "AI output" },
      context: { appVersion: "1.0.0", platform: "win32", locale: "en-US" },
      items: [
        {
          itemId: "x",
          messageId: "y",
          sequence: 0,
          role: "assistant",
          contentType: "text",
          text: "z",
        },
      ],
      reportScope: "selected_ai_outputs",
    };
    expect(
      createAnyAIContentReportSchema().safeParse(v1WithV2Keys).success
    ).toBe(false);
  });

  it("rejects an unknown schemaVersion", () => {
    expect(
      createAnyAIContentReportSchema().safeParse({
        ...makeValidV2(),
        schemaVersion: 9,
      }).success
    ).toBe(false);
  });
});
