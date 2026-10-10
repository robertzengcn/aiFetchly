import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";

const bootstrapWorkspaceMock = vi.fn();
const subscribeSummaryEventsMock = vi.fn();
const isWorkspaceRedesignEnabledMock = vi.fn();
const setWorkspaceRedesignEnabledMock = vi.fn();
const createWorkspaceConversationIdMock = vi.fn();
const selectConversationMock = vi.fn();
const subscribeDetailEventsMock = vi.fn();
const startChatRunMock = vi.fn();
const loadHistoryPageMock = vi.fn();

vi.mock("@/views/api/aiChatWorkspace", () => ({
  bootstrapWorkspace: (...args: unknown[]) => bootstrapWorkspaceMock(...args),
  subscribeSummaryEvents: (...args: unknown[]) =>
    subscribeSummaryEventsMock(...args),
  isWorkspaceRedesignEnabled: (...args: unknown[]) =>
    isWorkspaceRedesignEnabledMock(...args),
  setWorkspaceRedesignEnabled: (...args: unknown[]) =>
    setWorkspaceRedesignEnabledMock(...args),
  createWorkspaceConversationId: (...args: unknown[]) =>
    createWorkspaceConversationIdMock(...args),
  renameConversation: vi.fn(),
  deleteConversation: vi.fn(),
  duplicateConversation: vi.fn(),
  exportConversation: vi.fn(),
  selectConversation: (...args: unknown[]) => selectConversationMock(...args),
  subscribeDetailEvents: (...args: unknown[]) =>
    subscribeDetailEventsMock(...args),
  unsubscribeDetail: vi.fn(),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  startChatRun: (...args: unknown[]) => startChatRunMock(...args),
  cancelChatRun: vi.fn(),
  loadHistoryPage: (...args: unknown[]) => loadHistoryPageMock(...args),
  createClientRequestId: vi.fn().mockReturnValue("req-1"),
}));

import AuthenticatedWorkspaceLayout from "@/views/layout/AuthenticatedWorkspaceLayout.vue";
import AiChatWorkspaceSidebar from "@/views/components/aiChatWorkspace/AiChatWorkspaceSidebar.vue";
import { useAppShellStore } from "@/views/store/appShell";
import { useChatWorkspaceStore } from "@/views/store/chatWorkspace";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { loading: "Loading…", retry: "Retry" },
      workspaceChat: {
        newChat: "New chat",
        automations: "Automations",
        customize: "Customize",
        insights: "Insights",
        knowledgeLibrary: "Knowledge Library",
        plugins: "Plugins",
        search: { placeholder: "Search conversations" },
        sidebar: { region: "Chat workspaces" },
        mode: { classic: "Use classic chat", makeDefault: "Default" },
      },
    },
  },
});

/** Minimal route leaf stubs — the layout test must not depend on pages. */
const ChatStub = defineComponent({
  template: '<div data-testid="chat-route-stub">chat</div>',
});
const InsightsStub = defineComponent({
  template: '<div data-testid="insights-route-stub">insights</div>',
});

/**
 * Mount the layout. happy-dom performs no layout, so the responsive shell
 * composable measures clientWidth 0 and would flip the store to narrow;
 * tests therefore pin an explicit shell width after mount.
 */
async function mountLayout(shellWidth = 1400) {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/aiworkspace", name: "AI_Chat_Workspace", component: ChatStub },
      { path: "/insights", name: "InsightsHome", component: InsightsStub },
    ],
  });
  const wrapper = mount(AuthenticatedWorkspaceLayout, {
    global: { plugins: [pinia, i18n, router] },
  });
  setActivePinia(pinia);
  // Let the responsive composable's rAF-debounced initial measurement land
  // (clientWidth 0 in happy-dom), then pin the intended shell width.
  await flushPromises();
  useAppShellStore().setModeFromWidth(shellWidth);
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  vi.clearAllMocks();
  bootstrapWorkspaceMock.mockResolvedValue({ workspaces: [], unassigned: [] });
  subscribeSummaryEventsMock.mockReturnValue(() => undefined);
  isWorkspaceRedesignEnabledMock.mockResolvedValue(true);
  setWorkspaceRedesignEnabledMock.mockResolvedValue(undefined);
  createWorkspaceConversationIdMock.mockReturnValue("fresh-1");
  selectConversationMock.mockResolvedValue({
    acceptedGeneration: 1,
    messages: [],
    nextBefore: null,
    hasOlder: false,
    runtimeStatus: "idle",
    activeRunId: null,
    title: null,
  });
  subscribeDetailEventsMock.mockReturnValue(() => undefined);
});

describe("AuthenticatedWorkspaceLayout (chat-first shell design §7.2, TODO gap 1)", () => {
  it("composes one shell: sidebar navigation slot + center route host", async () => {
    const { wrapper, router } = await mountLayout();
    await router.push("/aiworkspace");
    await router.isReady();
    await flushPromises();

    expect(wrapper.find('[data-testid="app-shell-navigation"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="app-center-route"]').exists()).toBe(
      true
    );
    expect(wrapper.findComponent(AiChatWorkspaceSidebar).exists()).toBe(true);
    await expect(wrapper.find('[data-testid="chat-route-stub"]').exists()).toBe(
      true
    );
  });

  it("keeps the sidebar DOM identity across center-route changes", async () => {
    const { wrapper, router } = await mountLayout();
    await router.push("/aiworkspace");
    await router.isReady();
    await flushPromises();

    const navigation = wrapper.get('[data-testid="app-shell-navigation"]');
    (navigation.element as HTMLElement).dataset.probe = "alive";

    await router.push("/insights");
    await flushPromises();
    await router.push("/aiworkspace");
    await flushPromises();

    // Same element instance — the shell (and sidebar slot) never remounts.
    const probed = wrapper.find('[data-probe="alive"]');
    expect(probed.exists()).toBe(true);
    expect(probed.attributes("data-testid")).toBe("app-shell-navigation");
    expect(wrapper.find('[data-testid="insights-route-stub"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="chat-route-stub"]').exists()).toBe(true);
  });

  it("bootstraps workspace summaries exactly once per authenticated lifetime", async () => {
    const { router } = await mountLayout();
    await router.push("/aiworkspace");
    await router.isReady();
    await flushPromises();

    await router.push("/insights");
    await flushPromises();
    await router.push("/aiworkspace");
    await flushPromises();

    expect(bootstrapWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it("owns conversation selection: routing first, then the handshake", async () => {
    const { wrapper, router } = await mountLayout();
    await router.push("/insights");
    await router.isReady();
    await flushPromises();

    const sidebar = wrapper.findComponent(AiChatWorkspaceSidebar);
    sidebar.vm.$emit("select", "conv-9");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("AI_Chat_Workspace");
    expect(selectConversationMock).toHaveBeenCalledWith("conv-9", 1);

    // Re-selecting the already-selected conversation is a no-op.
    sidebar.vm.$emit("select", "conv-9");
    await flushPromises();
    expect(selectConversationMock).toHaveBeenCalledTimes(1);
  });

  it("routes to chat and creates a conversation on new-chat from an inner page", async () => {
    const { wrapper, router } = await mountLayout();
    await router.push("/insights");
    await router.isReady();
    await flushPromises();

    wrapper.findComponent(AiChatWorkspaceSidebar).vm.$emit("new-chat");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("AI_Chat_Workspace");
    expect(createWorkspaceConversationIdMock).toHaveBeenCalled();
    const chatWorkspace = useChatWorkspaceStore();
    expect(chatWorkspace.selectedConversationId).toBe("fresh-1");
  });

  it("never owns transcript or AI execution during mount and navigation", async () => {
    const { router } = await mountLayout();
    await router.push("/aiworkspace");
    await router.isReady();
    await router.push("/insights");
    await flushPromises();

    // No history loads, no run starts, and no detail subscription are
    // triggered by the layout itself (design §7.2 ownership boundaries).
    expect(loadHistoryPageMock).not.toHaveBeenCalled();
    expect(startChatRunMock).not.toHaveBeenCalled();
    expect(subscribeDetailEventsMock).not.toHaveBeenCalled();
  });

  describe("narrow drawer focus management (design §13)", () => {
    it("opens the drawer, traps Tab focus, closes on Escape, restores focus", async () => {
      const { wrapper, router } = await mountLayout();
      await router.push("/aiworkspace");
      await router.isReady();
      await flushPromises();

      const shell = useAppShellStore();
      shell.setModeFromWidth(700);
      await flushPromises();
      expect(shell.mode).toBe("narrow");

      // happy-dom's focus() never updates document.activeElement, so the
      // focus contract is asserted through a focus spy plus a controlled
      // activeElement getter (browsers behave as simulated here).
      const focusCalls: HTMLElement[] = [];
      const focusSpy = vi
        .spyOn(HTMLElement.prototype, "focus")
        .mockImplementation(function (this: HTMLElement) {
          focusCalls.push(this);
        });
      let simulatedActive: HTMLElement | null = null;
      const activeSpy = vi
        .spyOn(document, "activeElement", "get")
        .mockImplementation(() => simulatedActive);

      try {
        const toggle = wrapper.get('[data-testid="app-shell-nav-toggle"]');
        // Simulate the browser's post-click focus on the opening control.
        simulatedActive = toggle.element as HTMLElement;
        await toggle.trigger("click");
        await flushPromises();
        expect(shell.navigationOpen).toBe(true);

        const navigation = wrapper.get('[data-testid="app-shell-navigation"]');
        const drawerButtons = () =>
          Array.from(
            navigation.element.querySelectorAll<HTMLElement>("button")
          );
        expect(drawerButtons().length).toBeGreaterThan(0);
        const first = drawerButtons()[0];
        const last = drawerButtons()[drawerButtons().length - 1];

        // Opening the drawer moves focus to its first focusable element.
        expect(focusCalls.at(-1)).toBe(first);

        // Focus sits outside the drawer region (or on the last element):
        // forward Tab wraps INTO the drawer at the first element.
        simulatedActive = null;
        await navigation.trigger("keydown", { key: "Tab" });
        expect(focusCalls.at(-1)).toBe(first);

        // Shift+Tab from the first element wraps to the last.
        simulatedActive = first;
        await navigation.trigger("keydown", { key: "Tab", shiftKey: true });
        expect(focusCalls.at(-1)).toBe(last);

        // Escape closes the drawer and restores focus to the opener.
        simulatedActive = first;
        await navigation.trigger("keydown", { key: "Escape" });
        await flushPromises();
        expect(shell.navigationOpen).toBe(false);
        expect(focusCalls.at(-1)).toBe(toggle.element as HTMLElement);
      } finally {
        focusSpy.mockRestore();
        activeSpy.mockRestore();
      }
    });
  });
});
