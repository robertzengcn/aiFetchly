/**
 * AiChatContextPanel (Context inspector, PRD §14.4 / R8 P2, FR-WSP-007).
 *
 * The Context inspector must expose the same workspace-memory entry point
 * the workspace badge owns (count + open action), gated by the memory
 * rollout adapter and an APPROVED workspace binding. Focus here is the
 * entry surface: active count fetch, adapter/approval gating, and the
 * `open-memory` emit for the adapter bridge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatContextPanel from "@/views/components/aiChatWorkspace/AiChatContextPanel.vue";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import { useChatModelsStore } from "@/views/store/chatModels";
import { workspaceMemoryApi } from "@/views/api/aiWorkspaceMemory";
import type {
  WorkspaceConversationSummary,
  WorkspaceGroupSummary,
} from "@/entityTypes/aiChatWorkspaceTypes";

const listMemoriesMock = vi.fn();

vi.mock("@/views/api/aiWorkspaceMemory", () => ({
  workspaceMemoryApi: {
    list: (...args: unknown[]) => listMemoriesMock(...args),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceMemory: {
        title: "Workspace memory",
        memoryAction: "Memory",
      },
    },
  },
});

// One shared pinia instance: seeded state AND the component's store must be
// the same instance (useChatWorkspaceStore inside the panel).
const pinia = createPinia();

const conversation: WorkspaceConversationSummary = {
  conversationId: "conv-1",
  workspaceKey: "w-key",
  title: "T",
  preview: "",
  lastActivityAt: "",
  unread: false,
  attention: "none",
  runtimeStatus: "idle",
  activeRunId: null,
};

function approvedGroup(
  approvalState: string
): WorkspaceGroupSummary {
  return {
    workspaceKey: "w-key",
    displayName: "My Workspace",
    canonicalRootPath: "/tmp/ws",
    approvalState,
    conversations: [conversation],
  };
}

function seedStore(approvalState: string): void {
  const store = useChatWorkspaceStore();
  store.workspaces = [approvedGroup(approvalState)];
  store.conversationsById = new Map([["conv-1", conversation]]);
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(AiChatContextPanel, {
    props: {
      conversationId: "conv-1",
      messages: [],
      showMemory: true,
      ...props,
    },
    global: {
      plugins: [pinia, i18n],
    },
  });
}

describe("AiChatContextPanel memory entry point (FR-WSP-007)", () => {
  beforeEach(() => {
    setActivePinia(pinia);
    listMemoriesMock.mockReset();
    listMemoriesMock.mockResolvedValue({
      status: true,
      data: [{ memoryId: "m1" }, { memoryId: "m2" }, { memoryId: "m3" }],
    });
  });

  it("shows the active memory count for an approved workspace", async () => {
    seedStore("approved");
    const wrapper = mountPanel();
    await flushPromises();

    expect(listMemoriesMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      status: "active",
      limit: 200,
    });

    const entry = wrapper.get('[data-testid="workspace-context-memory"]');
    expect(
      entry.get('[data-testid="workspace-context-memory-count"]').text()
    ).toBe("3");
  });

  it("emits open-memory when the entry point is clicked", async () => {
    seedStore("approved");
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper
      .get('[data-testid="workspace-context-memory"]')
      .trigger("click");

    expect(wrapper.emitted("open-memory")).toBeTruthy();
  });

  it("hides the memory entry when the memory adapter is rolled back", async () => {
    seedStore("approved");
    const wrapper = mountPanel({ showMemory: false });
    await flushPromises();

    expect(
      wrapper.find('[data-testid="workspace-context-memory"]').exists()
    ).toBe(false);
  });

  it("hides the memory entry when the workspace is not approved", async () => {
    seedStore("pending");
    const wrapper = mountPanel();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="workspace-context-memory"]').exists()
    ).toBe(false);
    expect(listMemoriesMock).not.toHaveBeenCalled();
  });
});

describe("AiChatContextPanel context usage (FR-REC-005, R8 P2-11)", () => {
  beforeEach(() => {
    setActivePinia(pinia);
    listMemoriesMock.mockReset();
    listMemoriesMock.mockResolvedValue({ status: true, data: [] });
  });

  it("resolves the percent with the shared model window map, not the util default", async () => {
    seedStore("approved");
    // A model whose window is NOT the util default (256k): a 100k window
    // with 50k used tokens must render 50% — the empty-map fallback would
    // have rendered ~20% and disagreed with the composer badge.
    const modelsStore = useChatModelsStore();
    modelsStore.publishModelCatalog(
      new Map([["small-window-model", 100_000]]),
      "small-window-model"
    );

    const wrapper = mountPanel({
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "long reply",
          tokensUsed: 50_000,
        } as never,
      ],
    });
    await flushPromises();

    const meter = wrapper.get('[role="meter"]');
    expect(meter.attributes("aria-label")).toContain("50%");
  });
});
