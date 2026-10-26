import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatConversationHeader from "@/views/components/aiChatWorkspace/AiChatConversationHeader.vue";
import type { ConversationRuntimeStatus } from "@/entityTypes/aiChatWorkspaceTypes";

vi.mock("@/views/components/aiChatWorkspace/WorkspaceStatusIndicator.vue", () => ({
  default: { template: "<span />" },
}));

function mountHeader(
  runtimeStatus: ConversationRuntimeStatus,
  extra: Partial<{
    goalObjective: string | null;
    loopStatus: string | null;
    hasConversation: boolean;
  }> = {}
) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        workspaceChat: {
          header: { backgroundAgents: "Background Agents" },
          runStrip: {
            goal: "Goal: {objective}",
            loopRunning: "Scheduled loop running",
            loopPaused: "Scheduled loop paused",
          },
        },
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
      ...extra,
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

/**
 * Run-strip removal (2026-10-26 design): the goal objective + scheduled-loop
 * state move out of the deleted run strip into the header as display-only
 * chips beside the title, and the inspector (sidebar) toggle moves to the
 * RIGHT of the overflow "..." menu where it is always rendered.
 */
describe("AiChatConversationHeader goal/loop chips + sidebar toggle placement", () => {
  it("renders the goal chip with the objective and keeps it non-interactive", () => {
    const wrapper = mountHeader("running", {
      goalObjective: "Ship the parity suite",
    });
    const chip = wrapper.get('[data-testid="workspace-header-goal"]');
    expect(chip.text()).toBe("Goal: Ship the parity suite");
    // Display-only: a text span, not a button affordance.
    expect(chip.element.tagName).toBe("SPAN");
  });

  it.each([
    ["running", "Scheduled loop running"],
    ["paused", "Scheduled loop paused"],
    ["draining", "draining"],
  ] as const)("renders the loop chip for %s", (loopStatus, expected) => {
    const wrapper = mountHeader("running", { loopStatus });
    expect(wrapper.get('[data-testid="workspace-header-loop"]').text()).toBe(
      expected
    );
  });

  it("renders no chips when goal/loop are not provided", () => {
    const wrapper = mountHeader("running");
    expect(
      wrapper.find('[data-testid="workspace-header-goal"]').exists()
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="workspace-header-loop"]').exists()
    ).toBe(false);
  });

  it("renders the sidebar toggle AFTER (right of) the overflow menu", () => {
    const wrapper = mountHeader("idle");
    const overflow = wrapper.get('[data-testid="workspace-header-overflow"]');
    const toggle = wrapper.get('[data-testid="workspace-inspector-toggle"]');
    // v-menu/v-tooltip stubs wrap their activators in wrapper divs, so the
    // overflow button's wrapper's next sibling must wrap the toggle — and
    // the toggle must be the final element of .header-actions.
    expect(
      overflow.element.parentElement?.nextElementSibling?.contains(
        toggle.element
      )
    ).toBe(true);
    const actions = Array.from(
      wrapper.get(".header-actions").element.children
    ) as Element[];
    const last = actions[actions.length - 1];
    expect(last.contains(toggle.element)).toBe(true);
  });

  it("renders the sidebar toggle even with no conversation selected", () => {
    const wrapper = mountHeader("idle", { hasConversation: false });
    expect(
      wrapper.find('[data-testid="workspace-inspector-toggle"]').exists()
    ).toBe(true);
  });

  /**
   * Reviewer finding (run-strip removal): jsdom does not lay out flexbox,
   * so the clamp is pinned on the CSS source the way the retired A11Y-007
   * test pinned the strip: `.header-chip` must be shrinkable with a
   * working ellipsis (min-width: 0, no flex-shrink: 0) and capped, so a
   * long campaign objective can never push the "..." / inspector buttons
   * out of reach.
   */
  it("clamps the goal/loop chips so long objectives cannot push header actions out of reach", async () => {
    mountHeader("running", {
      goalObjective: "Ship the parity suite",
      loopStatus: "running",
    });
    const source = (
      await import(
        "@/views/components/aiChatWorkspace/AiChatConversationHeader.vue?raw"
      )
    ).default;
    const chipRule = /\.header-chip \{[^}]*\}/.exec(source)?.[0] ?? "";
    expect(chipRule).toContain(".header-chip");
    expect(/\bmin-width:\s*0;/.test(chipRule)).toBe(true);
    expect(/\bflex-shrink:\s*0;/.test(chipRule)).toBe(false);
    expect(/\bmax-width:/.test(chipRule)).toBe(true);
  });
});
