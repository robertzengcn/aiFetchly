/**
 * The typed app-inspector bridge (chat-first shell design §12.2):
 *
 * Clicking "Review full plan" calls workspaceStore.openInspector("activity").
 * When the chat inspector is ALREADY open (e.g. parked on the Artifacts tab
 * for the same conversation) the appInspector target's staleness check does
 * NOT re-open — the tab switch must still reach the inspector through the
 * persisted preference binding (ChatInspectorAdapter → AiChatInspector
 * active-tab), so the Activity tab (with the full plan document) becomes
 * active instead of the ride appearing dead.
 */
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        inspector: {
          region: "Inspector",
          close: "Close",
          artifacts: "Artifacts",
          activity: "Activity",
          context: "Context",
          resize: "Resize",
        },
      },
    },
  },
});

vi.mock("@/views/api/aiChatV2", () => ({
  startCompaction: vi.fn(),
}));

import ChatInspectorAdapter from "@/views/components/appShell/inspectors/ChatInspectorAdapter.vue";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useSelectedConversationStore } from "@/views/store/selectedConversation";
import { useAppShellStore } from "@/views/store/appShell";

function mountAdapter() {
  return mount(ChatInspectorAdapter, {
    props: {},
    global: {
      plugins: [i18n],
      stubs: {
        AiChatInspector: {
          name: "AiChatInspector",
          props: [
            "activeTab",
            "width",
            "conversationId",
            "messages",
            "overlay",
          ],
          template: '<div data-testid="inspector-stub" :data-tab="activeTab" />',
        },
      },
    },
  });
}

describe("ChatInspectorAdapter tab binding (§12.2)", () => {
  it("switches the activity tab when the chat preference changes while open", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const wrapper = mountAdapter();

    const inspector = useAppInspectorStore();
    const chatWorkspace = useChatWorkspaceStore();
    const selected = useSelectedConversationStore();
    useAppShellStore();

    chatWorkspace.setSelected("v2-conv-1");
    selected.messages = [
      {
        id: "m1",
        conversationId: "v2-conv-1",
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        messageType: "message",
        metadata: { source: "chat-v2" },
      },
    ] as never;

    // Inspector already OPEN for the same conversation, parked on artifacts.
    chatWorkspace.openInspector("artifacts");
    inspector.open({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "v2-conv-1",
      tab: "artifacts",
    });
    await flushPromises();
    expect(chatWorkspace.inspectorTab).toBe("artifacts");

    // The bridge does NOT re-open a non-stale target, so ONLY the persisted
    // preference can carry the Review-full-plan tab switch — verify it does.
    chatWorkspace.openInspector("activity");
    await flushPromises();
    expect(chatWorkspace.inspectorTab).toBe("activity");
    expect(inspector.target?.kind).toBe("chat");
    // The inspector stub renders with the Activity tab active.
    const stub = wrapper.get('[data-testid="inspector-stub"]');
    expect(stub.attributes("data-tab")).toBe("activity");
    wrapper.unmount();
  });
});
