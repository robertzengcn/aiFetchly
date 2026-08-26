import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Messages from "@/views/components/aiChatV2/AiChatV2Messages.vue";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2GeneratedImageReference,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";

/**
 * Component test for event forwarding through the message list.
 *
 * AiChatV2Messages must re-emit `use-generated-image` and
 * `edit-generated-image` from each inner AiChatV2Message verbatim,
 * carrying the exact opaque `{ messageId, imageIndex }` reference.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (happy-dom environment).
 */

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        generated_image_alt: "AI generated image",
        open_generated_image: "Open generated image",
        generatedImageRefs: {
          useAsReference: "Use as reference",
          edit: "Edit",
        },
      },
    },
  },
});

function makeAssistantImageMessage(): ChatV2MessageView {
  return {
    id: "assistant-1",
    conversationId: "c1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: {
      source: "chat-v2",
      generatedImages: [{ url: "https://example.com/gen-1.png" }],
    },
  } as unknown as ChatV2MessageView;
}

type MessagesWrapper = ReturnType<typeof mountMessages>;

function mountMessages() {
  return mount(AiChatV2Messages, {
    props: {
      messages: [makeAssistantImageMessage()],
      activeAssistantMessageId: null,
      streamStatus: "idle" as const,
    },
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

function emittedRefs(
  wrapper: MessagesWrapper,
  event: string
): ChatV2GeneratedImageReference[] {
  const events = wrapper.emitted(event) ?? [];
  return events.map((args) => args[0] as ChatV2GeneratedImageReference);
}

describe("AiChatV2Messages generated image event forwarding", () => {
  it("forwards use-generated-image from the inner message verbatim", async () => {
    const wrapper = mountMessages();
    const inner = wrapper.findComponent(AiChatV2Message);
    expect(inner.exists()).toBe(true);

    const reference: ChatV2GeneratedImageReference = {
      messageId: "assistant-1",
      imageIndex: 0,
    };
    await inner.vm.$emit("use-generated-image", reference);

    expect(emittedRefs(wrapper, "use-generated-image")).toEqual([reference]);
  });

  it("forwards edit-generated-image from the inner message verbatim", async () => {
    const wrapper = mountMessages();
    const inner = wrapper.findComponent(AiChatV2Message);
    expect(inner.exists()).toBe(true);

    const reference: ChatV2GeneratedImageReference = {
      messageId: "assistant-1",
      imageIndex: 0,
    };
    await inner.vm.$emit("edit-generated-image", reference);

    expect(emittedRefs(wrapper, "edit-generated-image")).toEqual([reference]);
  });
});
