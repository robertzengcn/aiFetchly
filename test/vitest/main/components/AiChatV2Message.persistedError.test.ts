import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        server_unavailable: "Could not connect to the AI server.",
        cancelled: "Cancelled",
      },
    },
  },
});

function mountMessage(
  message: ChatV2MessageView,
  status?: "idle" | "streaming" | "cancelled" | "error"
): ReturnType<typeof mount> {
  return mount(AiChatV2Message, {
    props: {
      message,
      status,
    },
    global: {
      plugins: [i18n],
      stubs: {
        SkillApprovalCard: true,
        AiChatV2PlanApprovalCard: true,
        AiArtifactCard: true,
        SkillInstallCard: true,
      },
    },
  });
}

describe("AiChatV2Message persisted error and stream status", () => {
  it("renders persisted error when loaded from history without status prop", async () => {
    const message: ChatV2MessageView = {
      id: "a-err",
      conversationId: "v2-test",
      role: "assistant",
      content: "",
      timestamp: "2026-11-19T10:00:00.000Z",
      messageType: MessageType.MESSAGE,
      metadata: {
        source: "chat-v2",
        finishReason: "error",
        error: "The AI service is busy or had a transient issue. Please try again in a moment.",
      },
    };

    const wrapper = mountMessage(message, undefined);
    await flushPromises();

    const streamStatus = wrapper.find(".v2-stream-status");
    expect(streamStatus.exists()).toBe(true);
    expect(streamStatus.text()).toContain("The AI service is busy or had a transient issue. Please try again in a moment.");
    expect(streamStatus.find("v-icon").text()).toBe("mdi-alert-circle-outline");
  });

  it("renders cancelled status when loaded from history with metadata.cancelled", async () => {
    const message: ChatV2MessageView = {
      id: "a-cancel",
      conversationId: "v2-test",
      role: "assistant",
      content: "",
      timestamp: "2026-11-19T10:00:00.000Z",
      messageType: MessageType.MESSAGE,
      metadata: {
        source: "chat-v2",
        cancelled: true,
      },
    };

    const wrapper = mountMessage(message, undefined);
    await flushPromises();

    const streamStatus = wrapper.find(".v2-stream-status");
    expect(streamStatus.exists()).toBe(true);
    expect(streamStatus.text()).toContain("Cancelled");
    expect(streamStatus.find("v-icon").text()).toBe("mdi-cancel");
  });

  it("does not render stream status for a normal completed message in history", async () => {
    const message: ChatV2MessageView = {
      id: "a-normal",
      conversationId: "v2-test",
      role: "assistant",
      content: "Hello! How can I help you today?",
      timestamp: "2026-11-19T10:00:00.000Z",
      messageType: MessageType.MESSAGE,
      metadata: {
        source: "chat-v2",
      },
    };

    const wrapper = mountMessage(message, undefined);
    await flushPromises();

    const streamStatus = wrapper.find(".v2-stream-status");
    expect(streamStatus.exists()).toBe(false);
  });
});
