/**
 * Chat inspector adapter (chat-first shell §12.2): store bridge onto the
 * chat inspector surface. Focus here is the Compact action's routing — the
 * legacy ai-chat-v2:compact-conversation channel had no handler and no
 * preload allowlist entry, so the action silently no-oped (B05/G02 repair);
 * it must call the bounded coordinator's compaction-start path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ChatInspectorAdapter from "@/views/components/appShell/inspectors/ChatInspectorAdapter.vue";
import { useAppInspectorStore } from "@/views/store/appInspector";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";

const startCompactionMock = vi.fn().mockResolvedValue({ started: true });

vi.mock("@/views/api/aiChatV2", () => ({
  startCompaction: (...args: unknown[]) => startCompactionMock(...args),
}));

/** Stubbed inspector surface: buttons that emit the compact / open-memory events. */
const InspectorStub = {
  name: "AiChatInspector",
  props: ["activeTab", "width", "overlay", "conversationId", "messages"],
  emits: ["update:tab", "update:width", "compact", "open-memory", "close"],
  template:
    '<button data-testid="inspector-compact-stub" @click="$emit(\'compact\')" />' +
    '<button data-testid="inspector-memory-stub" @click="$emit(\'open-memory\')" />',
};

function mountAdapter() {
  return mount(ChatInspectorAdapter, {
    global: {
      stubs: { AiChatInspector: InspectorStub },
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  startCompactionMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatInspectorAdapter compact routing", () => {
  it("starts the bounded compaction coordinator for the selected chat", async () => {
    const inspector = useAppInspectorStore();
    inspector.open({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "conv-adapt",
      tab: "activity",
    });

    const wrapper = mountAdapter();
    await wrapper.find('[data-testid="inspector-compact-stub"]').trigger("click");
    await flushPromises();

    expect(startCompactionMock).toHaveBeenCalledWith("conv-adapt");
    expect(startCompactionMock).toHaveBeenCalledTimes(1);
  });

  it("never dispatches compaction without a chat target", async () => {
    useAppInspectorStore();

    const wrapper = mountAdapter();
    await wrapper.find('[data-testid="inspector-compact-stub"]').trigger("click");
    await flushPromises();

    expect(startCompactionMock).not.toHaveBeenCalled();
  });

  it("swallows compaction failures (the activity tab still shows run state)", async () => {
    startCompactionMock.mockRejectedValueOnce(new Error("coordinator busy"));
    const inspector = useAppInspectorStore();
    inspector.open({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "conv-adapt-2",
      tab: "activity",
    });

    const wrapper = mountAdapter();
    await wrapper.find('[data-testid="inspector-compact-stub"]').trigger("click");
    await flushPromises();

    // Non-fatal by design: the rejection must not surface as an unhandled
    // error (onCompact catches) — reaching here without throwing is the pass.
    expect(startCompactionMock).toHaveBeenCalledWith("conv-adapt-2");
  });

  /** R8 P2 (FR-WSP-007): the Context panel's memory entry opens the same
   * shared memory overlay the workspace badge uses — through the store
   * flag so the chat-first shell stays the single owner. */
  it("opens the workspace memory overlay from the context memory entry point", async () => {
    const inspector = useAppInspectorStore();
    inspector.open({
      kind: "chat",
      ownerRoute: "/aiworkspace",
      conversationId: "conv-adapt",
      tab: "context",
    });

    const wrapper = mountAdapter();
    await wrapper
      .find('[data-testid="inspector-memory-stub"]')
      .trigger("click");
    await flushPromises();

    const chatWorkspace = useChatWorkspaceStore();
    expect(chatWorkspace.memoryOverlayOpen).toBe(true);
  });
});
