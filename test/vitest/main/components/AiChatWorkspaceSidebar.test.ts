import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatWorkspaceSidebar from "@/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";
import type { WorkspaceConversationSummary } from "@/entityTypes/aiChatWorkspaceTypes";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        newChat: "New chat",
        automations: "Automations",
        customize: "Customize",
        insights: "Insights",
        knowledgeLibrary: "Knowledge Library",
        plugins: "Plugins",
        backToApp: "Back to app",
        mode: {
          classic: "Use classic chat",
          makeDefault: "Make this my default chat",
        },
        search: { placeholder: "Search conversations" },
        sidebar: {
          region: "Chat workspaces",
          loadError: "Failed to load workspaces",
          empty: "No conversations yet",
          unassigned: "Other chats",
          needsAttentionCount: "{count} conversations need attention",
        },
      },
    },
  },
});

beforeEach(() => {
  push.mockClear();
  setActivePinia(createPinia());
});

function mountSidebar() {
  return mount(AiChatWorkspaceSidebar, {
    props: { redesignDefault: false },
    global: { plugins: [i18n] },
  });
}

describe("AiChatWorkspaceSidebar global nav", () => {
  it("renders the Insights, Knowledge Library, and Plugins nav links", () => {
    const wrapper = mountSidebar();
    expect(wrapper.get('[data-testid="workspace-insights"]').text()).toContain("Insights");
    expect(
      wrapper.get('[data-testid="workspace-knowledge-library"]').text()
    ).toContain("Knowledge Library");
    expect(wrapper.get('[data-testid="workspace-plugins"]').text()).toContain("Plugins");
  });

  it("navigates to /insights when Insights is clicked", async () => {
    const wrapper = mountSidebar();
    await wrapper.get('[data-testid="workspace-insights"]').trigger("click");
    expect(push).toHaveBeenCalledWith("/insights");
  });

  it("navigates to /knowledge/library when Knowledge Library is clicked", async () => {
    const wrapper = mountSidebar();
    await wrapper.get('[data-testid="workspace-knowledge-library"]').trigger("click");
    expect(push).toHaveBeenCalledWith("/knowledge/library");
  });

  it("navigates to /plugins/management when Plugins is clicked", async () => {
    const wrapper = mountSidebar();
    await wrapper.get('[data-testid="workspace-plugins"]').trigger("click");
    expect(push).toHaveBeenCalledWith("/plugins/management");
  });
});

describe("AiChatWorkspaceSidebar Other chats folder", () => {
  function unassigned(conversationId: string): WorkspaceConversationSummary {
    return {
      conversationId,
      workspaceKey: null,
      title: `Chat ${conversationId}`,
      preview: "Preview",
      runtimeStatus: "idle",
      attention: "none",
      unread: false,
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      activeRunId: null,
    };
  }

  function mountWithUnassigned() {
    const store = useChatWorkspaceStore();
    store.unassigned = [unassigned("u1"), unassigned("u2")];
    return mountSidebar();
  }

  it("defaults to closed, hiding the other chats", () => {
    const wrapper = mountWithUnassigned();
    const header = wrapper.get('[data-nav-row="unassigned"]');
    expect(header.attributes("aria-expanded")).toBe("false");
    expect(wrapper.findAll('[data-testid="workspace-conversation-u1"]').length).toBe(0);
    expect(wrapper.text()).not.toContain("Chat u1");
  });

  it("opens on click and shows the other chats", async () => {
    const wrapper = mountWithUnassigned();
    await wrapper.get('[data-nav-row="unassigned"]').trigger("click");
    await flushPromises();
    const header = wrapper.get('[data-nav-row="unassigned"]');
    expect(header.attributes("aria-expanded")).toBe("true");
    expect(wrapper.text()).toContain("Chat u1");
    expect(wrapper.text()).toContain("Chat u2");
  });

  it("collapses again on a second click", async () => {
    const wrapper = mountWithUnassigned();
    const header = wrapper.get('[data-nav-row="unassigned"]');
    await header.trigger("click");
    await flushPromises();
    await header.trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-nav-row="unassigned"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("Chat u1");
  });
});
