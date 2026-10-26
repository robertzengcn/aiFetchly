import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatConversationHeader from "@/views/components/aiChatWorkspace/AiChatConversationHeader.vue";
import type { ConversationRuntimeStatus } from "@/entityTypes/aiChatWorkspaceTypes";

vi.mock("@/views/components/aiChatWorkspace/WorkspaceStatusIndicator.vue", () => ({
  default: { template: "<span />" },
}));

function mountHeader(runtimeStatus: ConversationRuntimeStatus) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        workspaceChat: { header: { backgroundAgents: "Background Agents" } },
      },
    },
  });
  return mount(AiChatConversationHeader, {
    props: {
      title: "Test",
      runtimeStatus,
      recovering: false,
      activeToolCount: 0,
      inspectorOpen: false,
      hasConversation: true,
    },
    global: {
      plugins: [i18n],
      stubs: {
        // Render slots so the Delete item stays queryable; leave
        // v-list-item unstubbed so its disabled attr is observable.
        "v-menu": { template: "<div><slot /><slot name=\"activator\" /></div>" },
        "v-list": { template: "<div><slot /></div>" },
        "v-divider": { template: "<hr />" },
        "v-icon": { template: "<i />" },
        "v-tooltip": { template: "<div><slot /><slot name=\"activator\" /></div>" },
      },
    },
  });
}

/**
 * B03: Delete is disabled while the conversation can still receive writes.
 * The main-process IPC guard (getConversationBusyReason) is authoritative;
 * this covers the matching UI disablement.
 */
describe("AiChatConversationHeader delete protection (B03)", () => {
  it.each([
    "running",
    "queued",
    "awaiting_permission",
    "awaiting_user",
  ] as const)(
    "disables Delete while %s",
    (status) => {
      const wrapper = mountHeader(status);
      const deleteItem = wrapper.find('[data-testid="workspace-overflow-delete"]');
      expect(deleteItem.attributes("disabled")).toBeDefined();
    }
  );

  it.each([
    "idle",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ] as const)(
    "enables Delete when %s",
    (status) => {
      const wrapper = mountHeader(status);
      const deleteItem = wrapper.find('[data-testid="workspace-overflow-delete"]');
      // Unstubbed custom element renders :disabled="false" as disabled="false".
      expect(deleteItem.attributes("disabled")).toBe("false");
    }
  );
});

/**
 * P1-1 (audit 2026-10-22, FR-LIF-005): Clear must be disabled for the SAME
 * states as Delete. A parked permission/question run can still write
 * transcript content, so clearing must not be clickable — the main-process
 * busy guard refuses it too.
 */
describe("AiChatConversationHeader clear protection (P1-1)", () => {
  it.each([
    "running",
    "queued",
    "awaiting_permission",
    "awaiting_user",
  ] as const)(
    "disables Clear while %s",
    (status) => {
      const wrapper = mountHeader(status);
      const clearItem = wrapper.find('[data-testid="workspace-overflow-clear"]');
      expect(clearItem.attributes("disabled")).toBeDefined();
    }
  );

  it.each([
    "idle",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ] as const)(
    "enables Clear when %s",
    (status) => {
      const wrapper = mountHeader(status);
      const clearItem = wrapper.find('[data-testid="workspace-overflow-clear"]');
      // Unstubbed custom element renders :disabled="false" as disabled="false".
      expect(clearItem.attributes("disabled")).toBe("false");
    }
  );
});

/**
 * The background-agents task list is reachable from the header overflow
 * "..." menu as a TEXT entry (the old bottom-left icon activator in the
 * center surface was removed).
 */
describe("AiChatConversationHeader background-agents entry", () => {
  it("renders a text menu item and emits open-agent-tasks on click", async () => {
    const wrapper = mountHeader("idle");
    const item = wrapper.find(
      '[data-testid="workspace-overflow-agent-tasks"]'
    );
    expect(item.exists()).toBe(true);
    // Text trigger (the v-list-item title), not an icon-only control.
    expect(item.attributes("title")).toBe("Background Agents");

    await item.trigger("click");
    expect(wrapper.emitted("open-agent-tasks")).toHaveLength(1);
  });
});
