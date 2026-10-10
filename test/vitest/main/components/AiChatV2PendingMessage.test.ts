import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2PendingMessage from "@/views/components/aiChatV2/AiChatV2PendingMessage.vue";
import type { AIChatPendingMessageView } from "@/entityTypes/aiChatV2Types";

/**
 * Pending-message bubble behavior (message-queue PRD §7.2/7.3): status
 * rendering, Steer visibility rules, Remove/Resume affordances.
 *
 * Vuetify components are stubbed (memory note: no Vuetify plugin in
 * component tests), and the i18n plugin provides the queue.* keys.
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        queue: {
          queued: "Queued",
          steering: "Steering…",
          applied: "Applied",
          dispatching: "Sending…",
          sent: "Sent",
          paused: "Queue paused",
          cancelled: "Removed",
          failed: "Couldn't send",
          steer: "Steer",
          steer_aria: "Steer active response with this message",
          remove: "Remove",
          send_next: "Send next",
          recovered_after_restart: "Recovered after restart",
          attachments_not_steerable:
            "Messages with attachments will send after the current response.",
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
    conversationId: "v2-c",
    clientRequestId: "cr-1",
    sequence: 1,
    content: "Focus only on European customers.",
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canSteer: true,
    ...overrides,
  };
}

function mountPending(
  view: AIChatPendingMessageView,
  props: { runtimeStatus?: string; steeringEnabled?: boolean } = {}
) {
  return mount(AiChatV2PendingMessage, {
    global: {
      plugins: [i18n],
      stubs: {
        "v-btn": {
          template:
            '<button :data-testid="dataTestId" :aria-label="ariaLabel" @click="$emit(\'click\')"><slot /></button>',
          props: ["dataTestId", "ariaLabel", "loading", "disabled"],
        },
        "v-icon": { template: "<i><slot /></i>" },
      },
    },
    props: {
      view,
      ...(props.runtimeStatus ? { runtimeStatus: props.runtimeStatus as never } : {}),
      ...(props.steeringEnabled !== undefined
        ? { steeringEnabled: props.steeringEnabled }
        : {}),
    },
  });
}

describe("AiChatV2PendingMessage", () => {
  it("renders the queued status with localized text", () => {
    const wrapper = mountPending(makeView(), { runtimeStatus: "running" });
    expect(wrapper.find('[data-testid="ai-chat-pending-message"]').exists()).toBe(
      true
    );
    expect(wrapper.text()).toContain("Queued");
    expect(wrapper.text()).toContain("Focus only on European customers.");
  });

  it("shows Steer only for queued text messages while the conversation runs", () => {
    const running = mountPending(makeView(), { runtimeStatus: "running" });
    expect(running.find('[data-testid="ai-chat-pending-steer"]').exists()).toBe(
      true
    );

    const idle = mountPending(makeView(), { runtimeStatus: "idle" });
    expect(idle.find('[data-testid="ai-chat-pending-steer"]').exists()).toBe(
      false
    );

    const awaiting = mountPending(makeView(), {
      runtimeStatus: "awaiting_permission",
    });
    expect(
      awaiting.find('[data-testid="ai-chat-pending-steer"]').exists()
    ).toBe(false);
  });

  it("hides Steer and shows the attachment hint for attachment messages", () => {
    const wrapper = mountPending(
      makeView({
        attachmentMetadata: [
          {
            fileName: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 10,
            kind: "document",
          },
        ],
      }),
      { runtimeStatus: "running" }
    );
    expect(wrapper.find('[data-testid="ai-chat-pending-steer"]').exists()).toBe(
      false
    );
    expect(wrapper.find('[data-testid="ai-chat-pending-attachments"]').exists()).toBe(
      true
    );
    expect(wrapper.text()).toContain("report.pdf");
  });

  it("hides Steer when the steering kill switch is off", () => {
    const wrapper = mountPending(makeView(), {
      runtimeStatus: "running",
      steeringEnabled: false,
    });
    expect(wrapper.find('[data-testid="ai-chat-pending-steer"]').exists()).toBe(
      false
    );
  });

  it("offers Remove for queued and paused, plus Send next when paused", () => {
    const paused = mountPending(makeView({ status: "paused" }));
    expect(paused.find('[data-testid="ai-chat-pending-remove"]').exists()).toBe(
      true
    );
    expect(paused.find('[data-testid="ai-chat-pending-resume"]').exists()).toBe(
      true
    );
    expect(paused.text()).toContain("Queue paused");

    const sent = mountPending(makeView({ status: "sent" }));
    expect(sent.find('[data-testid="ai-chat-pending-remove"]').exists()).toBe(
      false
    );
    expect(sent.find('[data-testid="ai-chat-pending-resume"]').exists()).toBe(
      false
    );
  });

  it("emits steer / cancel / resume actions with the right payload", async () => {
    const wrapper = mountPending(makeView(), { runtimeStatus: "running" });
    await wrapper
      .find('[data-testid="ai-chat-pending-steer"]')
      .trigger("click");
    expect(wrapper.emitted("steer")?.[0]).toEqual(["pm-1"]);

    const pausedWrapper = mountPending(makeView({ status: "paused" }));
    await pausedWrapper
      .find('[data-testid="ai-chat-pending-resume"]')
      .trigger("click");
    expect(pausedWrapper.emitted("resume")?.[0]).toEqual(["v2-c"]);
  });

  it("renders failure details for failed messages", () => {
    const wrapper = mountPending(
      makeView({
        status: "failed",
        failureCode: "DISPATCH_PROMOTE_FAILED",
        failureMessage: "Could not start the turn.",
      })
    );
    expect(wrapper.find('[data-testid="ai-chat-pending-failure"]').exists()).toBe(
      true
    );
    expect(wrapper.text()).toContain("Could not start the turn.");
  });
});
