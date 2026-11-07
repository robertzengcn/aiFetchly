import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2QueuedMessages from "@/views/components/aiChatV2/AiChatV2QueuedMessages.vue";
import type { AIChatPendingMessageView } from "@/entityTypes/aiChatV2Types";

/**
 * Queued follow-ups render in a pinned strip, not inside the transcript.
 * The strip stays out of the document when the queue is empty.
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        queue: {
          queued: "Queued",
          region: "Queued messages",
          steer: "Steer",
          remove: "Remove",
          send_next: "Send next",
        },
      },
    },
  },
});

function makeView(
  overrides: Partial<AIChatPendingMessageView> = {}
): AIChatPendingMessageView {
  return {
    pendingMessageId: "pm-1",
    conversationId: "conv-1",
    clientRequestId: "cr-1",
    sequence: 1,
    content: "Follow up after this answer.",
    status: "queued",
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    canSteer: true,
    ...overrides,
  };
}

function mountStrip(
  pendingMessages: readonly AIChatPendingMessageView[]
) {
  return mount(AiChatV2QueuedMessages, {
    props: {
      pendingMessages,
      runtimeStatus: "running",
    },
    global: {
      plugins: [i18n],
      stubs: {
        "v-btn": {
          template:
            '<button :data-testid="dataTestId" @click="$emit(\'click\')"><slot /></button>',
          props: ["dataTestId", "ariaLabel", "loading", "disabled"],
        },
        "v-icon": { template: "<i />" },
      },
    },
  });
}

describe("AiChatV2QueuedMessages", () => {
  it("renders nothing when the queue is empty", () => {
    const wrapper = mountStrip([]);
    expect(wrapper.find('[data-testid="ai-chat-queued-messages"]').exists()).toBe(
      false
    );
  });

  it("renders queued rows in a region outside any transcript scroller", () => {
    const wrapper = mountStrip([
      makeView(),
      makeView({
        pendingMessageId: "pm-2",
        sequence: 2,
        content: "And then this.",
      }),
    ]);
    const region = wrapper.get('[data-testid="ai-chat-queued-messages"]');
    expect(region.attributes("role")).toBe("region");
    expect(region.attributes("aria-label")).toBe("Queued messages");
    expect(region.find(".v2-messages").exists()).toBe(false);
    expect(region.findAll('[data-testid="ai-chat-pending-message"]')).toHaveLength(
      2
    );
    expect(region.text()).toContain("Follow up after this answer.");
    expect(region.text()).toContain("And then this.");
  });

  it("forwards remove and resume from a paused row", async () => {
    const paused = makeView({ status: "paused" });
    const removeWrapper = mountStrip([paused]);
    await removeWrapper
      .get('[data-testid="ai-chat-pending-remove"]')
      .trigger("click");
    expect(removeWrapper.emitted("cancel")?.[0]).toEqual(["pm-1"]);

    const resumeWrapper = mountStrip([paused]);
    await resumeWrapper
      .get('[data-testid="ai-chat-pending-resume"]')
      .trigger("click");
    expect(resumeWrapper.emitted("resume")?.[0]).toEqual(["conv-1"]);
  });
});
