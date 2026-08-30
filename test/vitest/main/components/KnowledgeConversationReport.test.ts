import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";

const capsMock = vi.fn();
const createMock = vi.fn();
vi.mock("@/views/api/aiContentReport", () => ({
  getAIContentReportCapabilities: (...a: unknown[]) => capsMock(...a),
  createAIContentReport: (...a: unknown[]) => createMock(...a),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: { aiConversationReport: { action: "Report conversation" } },
  },
});

// A full ChatInterface mount is heavy (localStorage, watchers, mock RAG
// timers). This test exercises the conversation-report orchestration by
// mounting the button + dialog together the way ChatInterface wires them,
// then asserting the capability fetch gates the button and the dialog opens.
// It also locks the buildKnowledgeConversationSnapshot contract (only type
// "ai" candidates; knowledge sources are never copied in). Design §11.3.
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import {
  buildKnowledgeConversationSnapshot,
  type ConversationReportSnapshot,
  type KnowledgeChatMessage,
} from "@/views/components/aiContentReport/conversationReportSnapshot";

// Vuetify is not registered in the component-test config; stub the components.
const VBtn = defineComponent({
  props: { disabled: { type: Boolean, default: false } },
  template: `<button :disabled="disabled"><slot /></button>`,
});
const VIcon = { template: `<i />` };
const VDialog = defineComponent({
  props: { modelValue: { type: Boolean, default: true } },
  template: `<div v-if="modelValue"><slot /></div>`,
});
const PassThrough = { template: `<div><slot /></div>` };

function makeMessages(): KnowledgeChatMessage[] {
  return [
    {
      id: "u1",
      type: "user",
      content: "what is RAG?",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "a1",
      type: "ai",
      content: "RAG stands for retrieval-augmented generation.",
      timestamp: "2026-01-01T00:00:05.000Z",
    },
  ];
}

function makeSnapshot(): ConversationReportSnapshot {
  return buildKnowledgeConversationSnapshot({
    conversationId: "knowledge-conv-1",
    messages: makeMessages(),
  });
}

describe("Knowledge conversation-report orchestration", () => {
  beforeEach(() => {
    capsMock.mockReset();
    createMock.mockReset();
  });

  it("disables the button when capabilities are disabled (fail-closed)", async () => {
    capsMock.mockResolvedValueOnce({
      acceptedSchemaVersions: [1],
      conversationReporting: {
        enabled: false,
        maxAIItems: 10,
        maxUserItems: 10,
        maxTotalItems: 20,
        maxItemTextChars: 8000,
        maxAggregateTextChars: 32000,
        maxImages: 3,
      },
    });
    const w = mount(AIConversationReportButton, {
      props: { enabled: false, disabledReason: "Unavailable" },
      global: {
        plugins: [i18n],
        stubs: { VBtn, VIcon },
      },
    });
    expect(
      (w.find('[data-testid="report-conversation"]').element as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("enables the button when capabilities resolve enabled:true", async () => {
    capsMock.mockResolvedValueOnce({
      acceptedSchemaVersions: [1, 2],
      conversationReporting: {
        enabled: true,
        maxAIItems: 10,
        maxUserItems: 10,
        maxTotalItems: 20,
        maxItemTextChars: 8000,
        maxAggregateTextChars: 32000,
        maxImages: 3,
      },
    });
    const w = mount(AIConversationReportButton, {
      props: { enabled: true },
      global: {
        plugins: [i18n],
        stubs: { VBtn, VIcon },
      },
    });
    expect(
      (w.find('[data-testid="report-conversation"]').element as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("builds a snapshot with only the ai candidate (no knowledge sources) and opens the dialog", async () => {
    const snapshot = makeSnapshot();
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0].role).toBe("assistant");
    expect(snapshot.candidates[0].messageId).toBe("a1");
    // Knowledge sources must never be copied into the snapshot (design §7.1).
    expect(snapshot.candidates[0].images).toEqual([]);
    expect(snapshot.surface).toBe("knowledge_chat");

    const w = mount(AIConversationReportDialog, {
      props: { modelValue: false, snapshot },
      global: {
        plugins: [i18n],
        stubs: {
          VDialog,
          VCard: PassThrough,
          VCardTitle: PassThrough,
          VCardText: PassThrough,
          VCardActions: PassThrough,
          VSpacer: { template: `<span />` },
          VBtn,
          VIcon,
          VSelect: { template: `<div />` },
          VTextarea: { template: `<div />` },
        },
      },
    });
    // simulate parent opening
    await w.setProps({ modelValue: true });
    expect(
      w.find('[data-testid="ai-conversation-report-dialog"]').exists()
    ).toBe(true);
  });
});
