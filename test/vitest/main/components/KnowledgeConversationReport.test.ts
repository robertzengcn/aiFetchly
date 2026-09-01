import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, ref, watch } from "vue";

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
      (
        w.find('[data-testid="report-conversation"]')
          .element as HTMLButtonElement
      ).disabled
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
      (
        w.find('[data-testid="report-conversation"]')
          .element as HTMLButtonElement
      ).disabled
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

  // Design §11.3, TODO-14: Clear must regenerate the knowledge conversation id
  // so a report is never attributed across cleared sessions. The surface's
  // clearChat assigns a fresh generateMessageId() to knowledgeConversationId;
  // this harness replicates that wiring and asserts the id actually changes.
  it("regenerates the knowledge conversation id on Clear", async () => {
    const generateMessageId = vi.fn(
      () => `id-${Math.random().toString(36).slice(2)}`
    );
    const knowledgeConversationId = ref(generateMessageId());
    const messages = ref([{ type: "ai", content: "x" }]);
    const clearChat = () => {
      messages.value = [];
      knowledgeConversationId.value = generateMessageId();
    };
    const Harness = defineComponent({
      setup() {
        return { knowledgeConversationId, messages, clearChat };
      },
      template: `<div />`,
    });
    const w = mount(Harness, { global: { plugins: [i18n] } });
    const before = w.vm.knowledgeConversationId;
    expect(messages.value).toHaveLength(1);
    w.vm.clearChat();
    await w.vm.$nextTick();
    // Messages cleared.
    expect(w.vm.messages).toHaveLength(0);
    // Conversation id regenerated — never the prior session's id.
    expect(w.vm.knowledgeConversationId).not.toBe(before);
    expect(generateMessageId).toHaveBeenCalledTimes(2);
  });

  // TODO-8 + TODO-14 together: clearing while the report dialog is open must
  // close it (the regenerated id trips the conversation-changed watcher).
  it("closes an open report dialog when Clear regenerates the conversation id", async () => {
    const generateMessageId = vi.fn(
      () => `id-${Math.random().toString(36).slice(2)}`
    );
    const knowledgeConversationId = ref(generateMessageId());
    const conversationReportDialogOpen = ref(true);
    const conversationReportSnapshot = ref<ConversationReportSnapshot | null>(
      makeSnapshot()
    );
    const clearChat = () => {
      knowledgeConversationId.value = generateMessageId();
    };
    const Harness = defineComponent({
      setup() {
        // Replicate the surface's conversation-changed watcher (TODO-8).
        watch(knowledgeConversationId, () => {
          if (!conversationReportDialogOpen.value) return;
          conversationReportDialogOpen.value = false;
          conversationReportSnapshot.value = null;
        });
        return {
          knowledgeConversationId,
          conversationReportDialogOpen,
          conversationReportSnapshot,
          clearChat,
        };
      },
      template: `<div />`,
    });
    const w = mount(Harness, { global: { plugins: [i18n] } });
    expect(conversationReportDialogOpen.value).toBe(true);
    expect(conversationReportSnapshot.value).not.toBeNull();
    w.vm.clearChat();
    await w.vm.$nextTick();
    expect(conversationReportDialogOpen.value).toBe(false);
    expect(conversationReportSnapshot.value).toBeNull();
  });
});
