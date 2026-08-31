import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AIConversationReportItemList from "@/views/components/aiContentReport/AIConversationReportItemList.vue";
import type { ConversationReportSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiConversationReport: {
        selectionInstruction: "Select",
        selectionCount: "{n} selected",
        relatedUserLabel: "Your message — will be sent",
        attachmentOmitted: "An attachment in your message was omitted",
        relatedMessageUnavailable: "No related message is available",
        itemTypes: {
          text: "Text",
          image: "Image",
          mixed: "Mixed",
          plan: "Plan",
          artifact: "Artifact",
        },
      },
    },
  },
});

function makeSnapshot(
  candidates: Partial<ConversationReportSnapshot["candidates"][number]>[] = [
    { messageId: "a1", text: "hello", contentType: "text" },
  ]
): ConversationReportSnapshot {
  return {
    snapshotId: "snap-1",
    conversationId: "conv-1",
    surface: "chat_v2",
    createdAt: "2026-01-01T00:00:00.000Z",
    candidates: candidates.map((c, i) => ({
      itemId: `ai-${c.messageId ?? "m" + i}`,
      messageId: c.messageId ?? "m" + i,
      sourceIndex: i,
      role: "assistant" as const,
      contentType: c.contentType ?? "text",
      text: c.text,
      images: c.images ?? [],
      evidenceUnavailable: c.evidenceUnavailable ?? false,
      generatedAt: c.generatedAt,
      model: c.model,
      relatedUser: c.relatedUser,
    })),
  };
}

function mountList(props: {
  snapshot: ConversationReportSnapshot;
  selectedItemIds: Set<string>;
  includeRelatedUserContext?: boolean;
}) {
  return mount(AIConversationReportItemList, {
    props: { includeRelatedUserContext: false, ...props },
    global: { plugins: [i18n] },
  });
}

function makeRelatedUser(
  overrides: Partial<
    NonNullable<ConversationReportSnapshot["candidates"][number]["relatedUser"]>
  > = {}
) {
  return {
    itemId: "user-u1",
    messageId: "u1",
    sourceIndex: 0,
    role: "user" as const,
    contentType: "text" as const,
    text: "user question",
    omittedAttachmentContent: false,
    ...overrides,
  };
}

describe("AIConversationReportItemList", () => {
  it("renders one checkbox row per candidate", () => {
    const w = mountList({
      snapshot: makeSnapshot([
        { messageId: "a1", text: "one" },
        { messageId: "a2", text: "two" },
      ]),
      selectedItemIds: new Set<string>(),
    });
    expect(w.findAll('[data-testid^="report-item-"]')).toHaveLength(2);
  });

  it("emits toggle with the itemId when a checkbox changes", async () => {
    const w = mountList({
      snapshot: makeSnapshot(),
      selectedItemIds: new Set<string>(),
    });
    await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
    expect(w.emitted("toggle")).toBeTruthy();
    expect(w.emitted("toggle")![0]).toEqual(["ai-a1"]);
  });

  it("reflects the selected count in the summary", () => {
    const w = mountList({
      snapshot: makeSnapshot([{ messageId: "a1" }, { messageId: "a2" }]),
      selectedItemIds: new Set(["ai-a1"]),
    });
    expect(w.text()).toContain("1 selected");
  });

  it("marks a row checked when its id is in selectedItemIds", () => {
    const w = mountList({
      snapshot: makeSnapshot(),
      selectedItemIds: new Set(["ai-a1"]),
    });
    expect(
      (
        w.find('[data-testid="report-item-ai-a1"] input')
          .element as HTMLInputElement
      ).checked
    ).toBe(true);
  });

  describe("related-user context preview", () => {
    it("does not show related-user rows when the toggle is off", () => {
      const w = mountList({
        snapshot: makeSnapshot([
          {
            messageId: "a1",
            text: "answer",
            relatedUser: makeRelatedUser(),
          },
        ]),
        selectedItemIds: new Set<string>(),
        includeRelatedUserContext: false,
      });
      expect(w.find('[data-testid^="related-user-"]').exists()).toBe(false);
    });

    it("shows the related user message with a 'will be sent' label when the toggle is on", () => {
      const w = mountList({
        snapshot: makeSnapshot([
          {
            messageId: "a1",
            text: "answer",
            relatedUser: makeRelatedUser({ text: "why is the sky blue" }),
          },
        ]),
        selectedItemIds: new Set<string>(),
        includeRelatedUserContext: true,
      });
      const row = w.find('[data-testid="related-user-u1"]');
      expect(row.exists()).toBe(true);
      // Distinct label announces the message will be sent (FR-3.3, §10.3).
      expect(row.text()).toContain("Your message — will be sent");
      expect(row.text()).toContain("why is the sky blue");
    });

    it("shows the attachment-omission notice when the related user had an attachment", () => {
      const w = mountList({
        snapshot: makeSnapshot([
          {
            messageId: "a1",
            text: "answer",
            relatedUser: makeRelatedUser({
              omittedAttachmentContent: true,
              text: "see attached",
            }),
          },
        ]),
        selectedItemIds: new Set<string>(),
        includeRelatedUserContext: true,
      });
      const row = w.find('[data-testid="related-user-u1"]');
      expect(row.text()).toContain("An attachment in your message was omitted");
    });

    it("does not show the omission notice when there was no attachment", () => {
      const w = mountList({
        snapshot: makeSnapshot([
          {
            messageId: "a1",
            text: "answer",
            relatedUser: makeRelatedUser({
              omittedAttachmentContent: false,
            }),
          },
        ]),
        selectedItemIds: new Set<string>(),
        includeRelatedUserContext: true,
      });
      expect(w.find('[data-testid="related-user-u1"]').text()).not.toContain(
        "omitted"
      );
    });

    it("renders nothing for a candidate that has no related user even when the toggle is on", () => {
      const w = mountList({
        snapshot: makeSnapshot([
          { messageId: "a1", text: "answer", relatedUser: undefined },
        ]),
        selectedItemIds: new Set<string>(),
        includeRelatedUserContext: true,
      });
      expect(w.find('[data-testid^="related-user-"]').exists()).toBe(false);
    });
  });
});
