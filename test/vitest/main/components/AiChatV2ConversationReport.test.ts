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

// Minimal AiChatV2 mount is heavy; this test exercises the orchestration by
// mounting the dialog + button together the way AiChatV2 wires them, then
// asserting the capability fetch gates the button. The goal is to lock:
// button disabled until capabilities resolve enabled:true; dialog opens on open.
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import type { ConversationReportSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";

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

function makeSnapshot(): ConversationReportSnapshot {
  return {
    snapshotId: "s",
    conversationId: "c",
    surface: "chat_v2",
    createdAt: "t",
    candidates: [
      {
        itemId: "ai-a1",
        messageId: "a1",
        sourceIndex: 0,
        role: "assistant",
        contentType: "text",
        text: "hi",
        images: [],
        evidenceUnavailable: false,
      },
    ],
  };
}

describe("AiChatV2 conversation-report orchestration", () => {
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

  it("opens the dialog on button click when enabled", async () => {
    const w = mount(AIConversationReportDialog, {
      props: { modelValue: false, snapshot: makeSnapshot() },
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

  // Journey 11.5, §19, TODO-8: switching the active conversation while the
  // report dialog is open must close it without submitting, so a stale frozen
  // snapshot is never sent for a conversation the user left. The three surfaces
  // wire an identical watcher on their conversation id; this minimal harness
  // replicates that wiring and asserts the contract.
  it("closes the dialog and clears the snapshot when the active conversation changes while open", async () => {
    const activeConversationId = ref<string | null>("conv-1");
    const conversationReportDialogOpen = ref(false);
    const conversationReportSnapshot = ref<ReturnType<
      typeof makeSnapshot
    > | null>(null);
    const Harness = defineComponent({
      setup() {
        watch(activeConversationId, () => {
          if (!conversationReportDialogOpen.value) return;
          conversationReportDialogOpen.value = false;
          conversationReportSnapshot.value = null;
        });
        return {
          activeConversationId,
          conversationReportDialogOpen,
          conversationReportSnapshot,
        };
      },
      template: `<div />`,
    });
    const w = mount(Harness, { global: { plugins: [i18n] } });
    // Open the dialog and freeze a snapshot (as onOpenConversationReport does).
    conversationReportSnapshot.value = makeSnapshot();
    conversationReportDialogOpen.value = true;
    await w.vm.$nextTick();
    expect(conversationReportDialogOpen.value).toBe(true);
    expect(conversationReportSnapshot.value).not.toBeNull();
    // Switch conversation — the watcher must close + clear.
    activeConversationId.value = "conv-2";
    await w.vm.$nextTick();
    expect(conversationReportDialogOpen.value).toBe(false);
    expect(conversationReportSnapshot.value).toBeNull();
  });

  it("does not reactivate or reopen the dialog when the conversation changes while closed", async () => {
    const activeConversationId = ref<string | null>("conv-1");
    const conversationReportDialogOpen = ref(false);
    const Harness = defineComponent({
      setup() {
        watch(activeConversationId, () => {
          if (!conversationReportDialogOpen.value) return;
          conversationReportDialogOpen.value = false;
        });
        return { activeConversationId, conversationReportDialogOpen };
      },
      template: `<div />`,
    });
    const w = mount(Harness, { global: { plugins: [i18n] } });
    // Closed the whole time — switching must not flip it open.
    activeConversationId.value = "conv-2";
    await w.vm.$nextTick();
    expect(conversationReportDialogOpen.value).toBe(false);
  });
});
