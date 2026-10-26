import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import WorkspaceStatusIndicator from "@/views/components/aiChatWorkspace/WorkspaceStatusIndicator.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

/**
 * A11Y-001–010 certification, automated subset (PRD §16 / audit bullet 281).
 *
 * Covers the axes that are deterministically assertable at component level:
 *   - A11Y-001/002 (header-carried): the WorkspaceStatusIndicator stays
 *     accessible — named/role=img status with presentational icons; the
 *     header's goal/loop chips are text-only spans (non-color meaning), and
 *     the header actions tests live in AiChatConversationHeader.test.ts.
 *   - A11Y-010: reasoning is excluded from consideration output when the
 *     reasoning display is disabled (element not rendered).
 *
 * The run strip (A11Y-003 strip actions / A11Y-007 strip sizing) was removed
 * from the product on 2026-10-26; its stop affordance moved to the composer
 * send button (real <button>, same sizing rule from layout.scss), so those
 * certifications retired with the component.
 *
 * Vuetify VDialog (aria-modal, focus trap, initial focus, Escape, focus
 * return) covers A11Y-004/006 for every decision dialog it hosts; the
 * aria-live=polite status regions in AiChatCenterSurface (recovery detail
 * :36, TTS notice :437) carry A11Y-005 one-time announcements; reduced
 * motion is enforced once globally via --app-duration-* = 0ms
 * (src/views/styles/tokens.scss:57) for the shared tokens A11Y-008 relies
 * on. Those axes are recorded in the audit record rather than re-mounted
 * whole-surface here.
 */
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        runStrip: {
          running: "Working…",
          queued: "Queued",
          permission: "Waiting for approval",
          userInput: "Waiting for your answer",
          failed: "Failed",
          recovering: "Recovering",
          interrupted: "Interrupted",
          stop: "Stop",
          details: "Details",
          goal: "Goal: {objective}",
          loopRunning: "Scheduled loop running",
          loopPaused: "Scheduled loop paused",
        },
      },
      aiChatV2: {
        copy_message: "Copy message",
        copied: "Copied",
        copy_message_aria: "Copy this AI response",
      },
      aiContentReport: {
        action: "Report AI output",
        actionAriaLabel: "Report this AI-generated output",
        reported: "Reported",
      },
    },
  },
});

const VBtn = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
    title: { type: String, default: undefined },
    ariaLabel: { type: String, default: undefined },
    icon: { type: [Boolean, String], default: false },
  },
  setup(_, { attrs, slots }) {
    return { attrs, slots };
  },
  template: `<button :disabled="disabled" :title="title" :aria-label="ariaLabel"><slot /></button>`,
});
const VIcon = defineComponent({
  props: { icon: { type: String, default: "" } },
  template: `<i :data-icon="icon" aria-hidden="true"><slot /></i>`,
});

const mountGlobals = {
  plugins: [i18n],
  stubs: {
    VBtn,
    VIcon,
    SkillApprovalCard: true,
    AiChatV2StreamStatus: true,
    AiChatV2PlanApprovalCard: true,
  },
};

function makeMessage(
  reasoning: string | undefined,
  showReasoning: boolean
): ChatV2MessageView {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant",
    content: "Final answer.",
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: reasoning
      ? { source: "chat-v2", reasoning: { content: reasoning } }
      : { source: "chat-v2" },
  } as unknown as ChatV2MessageView;
}

function mountMessage(reasoning: string, showReasoning: boolean) {
  return mount(AiChatV2Message, {
    props: {
      message: makeMessage(reasoning, showReasoning),
      showReasoning,
    },
    global: mountGlobals,
  });
}

describe("A11Y-010 hidden reasoning excluded from output", () => {
  const REASONING =
    "I should quote the internal price margin before answering.";

  it("does not render the reasoning disclosure when display is disabled", () => {
    const wrapper = mountMessage(REASONING, false);
    expect(wrapper.find('[data-testid="reasoning"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("internal price margin");
  });

    it("renders the reasoning disclosure when display is enabled", async () => {
      const wrapper = mountMessage(REASONING, true);
      const details = wrapper.find('[data-testid="reasoning"]');
      expect(details.exists()).toBe(true);
      // The user explicitly opted into reasoning display: the content is
      // inside a <details> element (expandable, not broadcast).
      expect((details.element as HTMLDetailsElement).open).toBe(true);
    });
});

describe("A11Y-001/002 accessible name + non-color status", () => {
  it("names the status indicator and keeps the icon presentational", () => {
    const wrapper = mount(WorkspaceStatusIndicator, {
      props: {
        visual: {
          icon: "mdi-cog",
          spinning: false,
          labelKey: "workspaceChat.runStrip.running",
          fallback: "Working…",
          tone: "info",
        } as never,
      },
      global: { plugins: [i18n], stubs: { VIcon } },
    });
    const host = wrapper.find(".status-indicator");
    expect(host.attributes("role")).toBe("img");
    expect(host.attributes("aria-label")).toBe("Working…");
    expect(host.attributes("title")).toBe("Working…");
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(true);
  });
});
