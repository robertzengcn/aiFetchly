import { describe, it, expect } from "vitest";
import { findPrecedingAssistantContext } from "@/service/outboundEmail/OutboundEmailPreviousAssistantContext";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";

/**
 * Unit tests for the preceding-assistant-message lookup used by the
 * outbound-email intent resolver (technical design §9.1/§9.4). The engine
 * previously passed `previousAssistantText: null`, which made the contextual
 * affirmation path ("yes, send it" answering "Send batch 42 now?") dead — the
 * resolver could never see that the prior assistant turn asked a
 * send-confirmation question (RC3). This helper is the pure seam that lets the
 * engine supply the real prior message without coupling the resolver to the DB.
 */
function msg(
  role: string,
  messageId: string,
  content: string,
  id: number,
  timestampMs: number
): AIChatMessageEntity {
  return {
    id,
    messageId,
    conversationId: "conv-1",
    role,
    content,
    timestamp: new Date(timestampMs),
    messageType: "MESSAGE" as never,
  } as unknown as AIChatMessageEntity;
}

describe("findPrecedingAssistantContext", () => {
  it("returns the last assistant message immediately before the current user message", () => {
    const messages: AIChatMessageEntity[] = [
      msg("user", "u1", "draft an email to bob", 1, 1000),
      msg("assistant", "a1", "Done. Batch 1 is ready.", 2, 2000),
      msg("user", "u2", "send it now", 3, 3000),
    ];
    const ctx = findPrecedingAssistantContext(messages, "u2");
    expect(ctx.previousAssistantMessageId).toBe("a1");
    expect(ctx.previousAssistantText).toBe("Done. Batch 1 is ready.");
  });

  it("returns null when there is no prior assistant message", () => {
    const messages: AIChatMessageEntity[] = [
      msg("user", "u1", "hello", 1, 1000),
    ];
    const ctx = findPrecedingAssistantContext(messages, "u1");
    expect(ctx.previousAssistantMessageId).toBeNull();
    expect(ctx.previousAssistantText).toBeNull();
  });

  it("ignores assistant messages that come AFTER the current user message", () => {
    // Defensive: ordering must never let a future assistant turn leak in.
    const messages: AIChatMessageEntity[] = [
      msg("user", "u1", "send it now", 1, 1000),
      msg("assistant", "a1", "Sending...", 2, 2000),
    ];
    const ctx = findPrecedingAssistantContext(messages, "u1");
    expect(ctx.previousAssistantMessageId).toBeNull();
    expect(ctx.previousAssistantText).toBeNull();
  });

  it("skips intervening user messages and finds the nearest prior assistant turn", () => {
    const messages: AIChatMessageEntity[] = [
      msg("assistant", "a1", "Shall I send these emails now?", 1, 1000),
      msg("user", "u1", "hold on", 2, 2000),
      msg("assistant", "a2", "Okay, waiting.", 3, 3000),
      msg("user", "u2", "yes, send it", 4, 4000),
    ];
    const ctx = findPrecedingAssistantContext(messages, "u2");
    expect(ctx.previousAssistantMessageId).toBe("a2");
    expect(ctx.previousAssistantText).toBe("Okay, waiting.");
  });

  it("returns null when the current user message is not found", () => {
    const messages: AIChatMessageEntity[] = [
      msg("assistant", "a1", "Hi", 1, 1000),
    ];
    const ctx = findPrecedingAssistantContext(messages, "missing");
    expect(ctx.previousAssistantMessageId).toBeNull();
    expect(ctx.previousAssistantText).toBeNull();
  });
});
