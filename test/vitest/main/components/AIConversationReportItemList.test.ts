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
    })),
  };
}

function mountList(props: {
  snapshot: ConversationReportSnapshot;
  selectedItemIds: Set<string>;
}) {
  return mount(AIConversationReportItemList, {
    props,
    global: { plugins: [i18n] },
  });
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
});
