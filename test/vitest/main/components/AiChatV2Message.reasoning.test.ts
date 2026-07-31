import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

/**
 * Component tests for the optional reasoning panel on assistant messages.
 *
 * Must run under the dedicated happy-dom config:
 *   yarn vitest --config test/vitest/main/components/vitest.config.mjs run \
 *       test/vitest/main/components/AiChatV2Message.reasoning.test.ts
 */
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiChatV2: { reasoning_title: "Reasoning" } } },
});

function makeAssistantMessage(reasoning?: {
  content: string;
}): ChatV2MessageView {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant",
    content: "Final answer.",
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: reasoning
      ? {
          source: "chat-v2",
          reasoning: {
            content: reasoning.content,
            format: "plain_text",
            source: "server",
            truncated: false,
          },
        }
      : { source: "chat-v2" },
  } as unknown as ChatV2MessageView;
}

function mountWith(message: ChatV2MessageView) {
  return mount(AiChatV2Message, {
    props: { message },
    global: {
      plugins: [i18n],
      stubs: {
        SkillApprovalCard: true,
        AiChatV2StreamStatus: true,
        AiChatV2PlanApprovalCard: true,
        VIcon: true,
      },
    },
  });
}

describe("AiChatV2Message reasoning panel", () => {
  it("renders the reasoning panel when metadata.reasoning.content exists", async () => {
    const wrapper = mountWith(
      makeAssistantMessage({ content: "I considered X." })
    );
    await flushPromises();
    expect(wrapper.find(".v2-message__reasoning").exists()).toBe(true);
    expect(wrapper.text()).toContain("I considered X.");
  });

  it("omits the panel when there is no reasoning metadata", async () => {
    const wrapper = mountWith(makeAssistantMessage());
    await flushPromises();
    expect(wrapper.find(".v2-message__reasoning").exists()).toBe(false);
  });

  it("renders reasoning as escaped text, not HTML", async () => {
    const wrapper = mountWith(
      makeAssistantMessage({ content: "<script>alert(1)</script>" })
    );
    await flushPromises();
    // Text interpolation escapes the string — no live script element.
    expect(wrapper.find(".v2-message__reasoning script").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>alert(1)</script>");
  });
});
