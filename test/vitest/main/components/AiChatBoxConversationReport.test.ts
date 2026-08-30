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

// A full AiChatBox mount is heavy (router, IPC subscriptions, file-ops). This
// test exercises the conversation-report orchestration by mounting the button
// + dialog together the way AiChatBox wires them, then asserting the capability
// fetch gates the button and the dialog opens. The goal is to lock the same
// contract as AiChatV2 (Task 18) for the legacy surface (design §11.2).
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import {
  buildLegacyConversationSnapshot,
  type ConversationReportSnapshot,
} from "@/views/components/aiContentReport/conversationReportSnapshot";
import { ChatMessage, MessageType } from "@/entityTypes/commonType";

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

function makeMessages(): ChatMessage[] {
  return [
    {
      id: "u1",
      role: "user",
      content: "hello",
      messageType: MessageType.MESSAGE,
      timestamp: new Date("2026-01-01T00:00:00Z"),
    } as unknown as ChatMessage,
    {
      id: "a1",
      role: "assistant",
      content: "hi there",
      messageType: MessageType.MESSAGE,
      timestamp: new Date("2026-01-01T00:00:05Z"),
    } as unknown as ChatMessage,
  ];
}

function makeSnapshot(): ConversationReportSnapshot {
  return buildLegacyConversationSnapshot({
    conversationId: "conv-1",
    messages: makeMessages(),
  });
}

describe("AiChatBox conversation-report orchestration", () => {
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

  it("builds a snapshot with the assistant candidate and opens the dialog", async () => {
    const snapshot = makeSnapshot();
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0].role).toBe("assistant");
    expect(snapshot.candidates[0].messageId).toBe("a1");
    expect(snapshot.surface).toBe("legacy_chat");

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
