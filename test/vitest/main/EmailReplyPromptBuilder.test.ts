import { describe, it, expect } from "vitest";
import {
  buildReplySystemMessage,
  buildReplyUserMessage,
  containsBannedPhrase,
  findPromptLeakage,
} from "@/service/emailReply/EmailReplyPromptBuilder";
import type { EmailReplyIdentityProfileEntity } from "@/entity/EmailReplyIdentityProfile.entity";
import type { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";

function fakeMessage(
  over: Partial<EmailReceivedMessageEntity> = {}
): EmailReceivedMessageEntity {
  return {
    id: 1,
    emailServiceId: 7,
    providerUid: "uid-1",
    messageId: "<msg@x>",
    threadKey: "<msg@x>",
    inReplyTo: null,
    referencesHeader: null,
    fromAddress: "prospect@example.com",
    fromName: "Prospect",
    replyToAddress: null,
    toAddressesJson: "[]",
    ccAddressesJson: null,
    subject: "Pricing question",
    bodyText: "How much does the Team plan cost?",
    bodyHtmlSanitized: null,
    snippet: null,
    receivedAt: new Date(),
    isUnread: 1,
    classification: null,
    classificationConfidence: null,
    replyStatus: "not_started",
    processedAt: null,
    ...over,
  } as EmailReceivedMessageEntity;
}

function fakeProfile(
  over: Partial<EmailReplyIdentityProfileEntity> = {}
): EmailReplyIdentityProfileEntity {
  return {
    id: 1,
    emailServiceId: 7,
    ownerName: "Jane Doe",
    ownerRole: "Founder",
    companyName: "Acme",
    preferredTone: "friendly",
    signature: "— Jane",
    styleNotes: null,
    forbiddenPhrasesJson: JSON.stringify(["cheap", "discount"]),
    discloseAutomation: 0,
    ...over,
  } as EmailReplyIdentityProfileEntity;
}

describe("buildReplySystemMessage", () => {
  it("enforces owner-voice + no-AI-disclosure policy", () => {
    const sys = buildReplySystemMessage(fakeProfile());
    const content = sys.content as string;
    expect(content).toContain("mailbox owner");
    expect(content.toLowerCase()).toContain("do not mention");
    expect(content).toContain("UNTRUSTED customer content");
    expect(content).toContain("Jane Doe");
    expect(content).toContain("— Jane");
  });

  it("forbids configured forbidden phrases", () => {
    const sys = buildReplySystemMessage(fakeProfile());
    expect(sys.content).toContain("cheap");
    expect(sys.content).toContain("discount");
  });

  it("requests valid JSON with the classification enum", () => {
    const sys = buildReplySystemMessage(fakeProfile());
    expect(sys.content).toContain("classification");
    expect(sys.content).toContain("interested");
    expect(sys.content).toContain("needs_human_review");
  });

  it("allows a disclosure line only when the owner opted in", () => {
    const off = buildReplySystemMessage(fakeProfile({ discloseAutomation: 0 }));
    const on = buildReplySystemMessage(fakeProfile({ discloseAutomation: 1 }));
    expect(off.content).toContain(
      "Do NOT add any AI/automation disclosure line"
    );
    expect(on.content).toContain("opted into automation disclosure");
  });
});

describe("buildReplyUserMessage", () => {
  it("labels knowledge context trusted and email untrusted", () => {
    const msg = buildReplyUserMessage({
      message: fakeMessage(),
      knowledgeSources: [
        {
          chunkId: 1,
          documentId: 2,
          documentName: "pricing.pdf",
          documentTitle: "Pricing",
          content: "Team plan is $49/mo",
          score: 0.9,
        },
      ],
    });
    expect(msg.content).toContain("TRUSTED knowledge-library context");
    expect(msg.content).toContain("UNTRUSTED inbound email");
    expect(msg.content).toContain("pricing.pdf");
    expect(msg.content).toContain("How much does the Team plan cost?");
  });

  it("notes when no knowledge was retrieved", () => {
    const msg = buildReplyUserMessage({
      message: fakeMessage(),
      knowledgeSources: [],
    });
    expect(msg.content).toContain("No knowledge-library context was retrieved");
  });
});

describe("containsBannedPhrase", () => {
  it("catches banned phrases case-insensitively", () => {
    expect(containsBannedPhrase("As an AI, I think...").found).toBe(true);
    expect(containsBannedPhrase("BASED ON THE PROVIDED CONTEXT...").found).toBe(
      true
    );
    expect(containsBannedPhrase("I do not have access to that").found).toBe(
      true
    );
  });
  it("passes clean human text", () => {
    expect(
      containsBannedPhrase("Thanks for reaching out! Happy to help.").found
    ).toBe(false);
  });
});

describe("findPromptLeakage", () => {
  it("detects retrieval/prompt leakage markers", () => {
    expect(findPromptLeakage("Per the knowledge-library...")).toBe(
      "knowledge-library"
    );
    expect(findPromptLeakage("system prompt says")).toBe("system prompt");
  });
  it("returns null for clean text", () => {
    expect(findPromptLeakage("Let's hop on a call tomorrow.")).toBeNull();
  });
});
