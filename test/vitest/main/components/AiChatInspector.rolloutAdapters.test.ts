import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

const rolloutFlagsMock = vi.fn();

vi.mock("@/views/api/aiChatWorkspace", () => ({
  fetchWorkspaceRolloutFlags: (...args: unknown[]) =>
    rolloutFlagsMock(...args),
}));

import AiChatInspector from "@/views/components/aiChatWorkspace/AiChatInspector.vue";
import { resetWorkspaceRolloutAdaptersForTest } from "@/views/composables/aiChatWorkspace/useWorkspaceRolloutAdapters";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        inspector: {
          region: "Inspector",
          close: "Close inspector",
          artifacts: "Artifacts",
          activity: "Activity",
          context: "Context",
          resize: "Resize inspector",
          artifactsDisabled:
            "Artifact results are unavailable while the specialized-results rollout adapter is rolled back.",
        },
      },
    },
  },
});

function mountInspector(props: Record<string, unknown> = {}) {
  return mount(AiChatInspector, {
    props: {
      activeTab: "artifacts",
      width: 420,
      conversationId: "conv-1",
      messages: [],
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VTabs: { template: '<div class="v-tabs"><slot /></div>' },
        VTab: {
          props: ["value"],
          template: '<button class="v-tab"><slot /></button>',
        },
        VIcon: { template: "<i />" },
        AiChatArtifactsPanel: {
          template: '<div data-testid="artifacts-stub" />',
        },
        AiChatActivityPanel: {
          template: '<div data-testid="activity-stub" />',
        },
        AiChatContextPanel: {
          template: '<div data-testid="context-stub" />',
        },
      },
    },
  });
}

beforeEach(() => {
  rolloutFlagsMock.mockReset();
  rolloutFlagsMock.mockResolvedValue(null);
  resetWorkspaceRolloutAdaptersForTest();
});

describe("AiChatInspector specialized-results adapter (A02 §23.1)", () => {
  it("renders the artifacts panel while the adapter flag is on", async () => {
    rolloutFlagsMock.mockResolvedValue({
      enabled: true,
      explicit: true,
      adapters: {
        sharedOrchestration: true,
        specializedResults: true,
        voiceMemory: true,
      },
    });
    const wrapper = mountInspector();
    await flushPromises();
    expect(wrapper.find('[data-testid="artifacts-stub"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="workspace-inspector-artifacts-fallback"]')
        .exists()
    ).toBe(false);
  });

  it("renders the fallback notice and hides the artifacts panel when the adapter flag is rolled off", async () => {
    rolloutFlagsMock.mockResolvedValue({
      enabled: true,
      explicit: true,
      adapters: {
        sharedOrchestration: true,
        specializedResults: false,
        voiceMemory: true,
      },
    });
    const wrapper = mountInspector();
    await flushPromises();
    expect(wrapper.find('[data-testid="artifacts-stub"]').exists()).toBe(false);
    const fallback = wrapper.find(
      '[data-testid="workspace-inspector-artifacts-fallback"]'
    );
    expect(fallback.exists()).toBe(true);
    expect(fallback.text()).toContain(
      "specialized-results rollout adapter is rolled back"
    );
  });

  it("does not gate the activity and context tabs", async () => {
    rolloutFlagsMock.mockResolvedValue({
      enabled: true,
      explicit: true,
      adapters: {
        sharedOrchestration: true,
        specializedResults: false,
        voiceMemory: false,
      },
    });
    const wrapper = mountInspector({ activeTab: "activity" });
    await flushPromises();
    expect(wrapper.find('[data-testid="activity-stub"]').exists()).toBe(true);
  });
});
