import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatWorkspaceSidebar from "@/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue";

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
