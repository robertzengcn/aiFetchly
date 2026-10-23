import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatInspector from "@/views/components/aiChatWorkspace/AiChatInspector.vue";

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
        },
      },
    },
  },
});

function mountInspector(props: Record<string, unknown> = {}) {
  return mount(AiChatInspector, {
    props: {
      activeTab: "activity",
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

describe("AiChatInspector close control", () => {
  it("renders a close button with accessible label", () => {
    const wrapper = mountInspector();
    const closeBtn = wrapper.find('[data-testid="workspace-inspector-close"]');
    expect(closeBtn.exists()).toBe(true);
    expect(closeBtn.attributes("aria-label")).toBe("Close inspector");
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mountInspector();
    await wrapper
      .find('[data-testid="workspace-inspector-close"]')
      .trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
    expect(wrapper.emitted("close")?.length).toBe(1);
  });

  it("emits close on Escape for keyboard dismissal", async () => {
    const wrapper = mountInspector();
    await wrapper
      .find('[data-testid="workspace-inspector"]')
      .trigger("keydown.escape");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  /** R8 P2 (FR-WSP-007): the memory entry lives in the Context panel; the
   * inspector forwards it so the adapter bridge can open the shared
   * memory overlay. */
  it("forwards the context panel's memory entry point", async () => {
    const wrapper = mount(AiChatInspector, {
      props: {
        activeTab: "context",
        width: 420,
        conversationId: "conv-1",
        messages: [],
      },
      global: {
        plugins: [i18n],
        stubs: {
          VIcon: { template: "<i />" },
          AiChatContextPanel: defineComponent({
            props: ["conversationId", "messages", "showMemory"],
            emits: ["compact", "open-memory"],
            template:
              '<button data-testid="ctx-memory" @click="$emit(\'open-memory\')" />',
          }),
        },
      },
    });

    await wrapper.find('[data-testid="ctx-memory"]').trigger("click");

    expect(wrapper.emitted("open-memory")).toBeTruthy();
  });
});
