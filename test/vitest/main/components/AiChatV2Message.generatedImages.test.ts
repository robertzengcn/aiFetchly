import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type {
  ChatV2GeneratedImageReference,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";

/**
 * Component test for the per-image actions ("Use as reference" / "Edit")
 * rendered under each AI-generated image in an assistant message.
 *
 * The component must emit opaque references — exactly
 * `{ messageId, imageIndex }` — and must never leak `localPath`, URLs or
 * any other resolvable payload through these events.
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

/**
 * Build an assistant message carrying two resolvable generated images:
 * one via https URL, one via b64_json data URL.
 */
function makeTwoImageMessage(): ChatV2MessageView {
  return {
    id: "msg-gen-1",
    conversationId: "c1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    messageType: MessageType.MESSAGE,
    metadata: {
      source: "chat-v2",
      generatedImages: [
        { url: "https://example.com/gen-1.png" },
        { b64_json: "QUJD", mime_type: "image/png" },
      ],
    },
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
        VProgressLinear: true,
      },
    },
  });
}

function emittedRefs(
  wrapper: ReturnType<typeof mountWith>,
  event: string
): ChatV2GeneratedImageReference[] {
  const events = wrapper.emitted(event) ?? [];
  return events.map((args) => args[0] as ChatV2GeneratedImageReference);
}

describe("AiChatV2Message generated image actions", () => {
  it("renders an action row with translated labels for every generated image", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const rows = wrapper.findAll(".v2-message__image-actions");
    expect(rows.length).toBe(2);
    expect(wrapper.findAll(".v2-message__use-reference-btn").length).toBe(2);
    expect(wrapper.findAll(".v2-message__edit-image-btn").length).toBe(2);
    expect(wrapper.text()).toContain("Use as reference");
    expect(wrapper.text()).toContain("Edit");
  });

  it("shows a visible order badge of imageIndex + 1", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const badges = wrapper.findAll(".v2-message__generated-image-index");
    expect(badges.length).toBe(2);
    expect(badges[0].text()).toBe("1");
    expect(badges[1].text()).toBe("2");
  });

  it("emits use-generated-image with exact opaque references", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const useButtons = wrapper.findAll(".v2-message__use-reference-btn");
    await useButtons[0].trigger("click");
    await useButtons[1].trigger("click");

    const refs = emittedRefs(wrapper, "use-generated-image");
    expect(refs).toEqual([
      { messageId: "msg-gen-1", imageIndex: 0 },
      { messageId: "msg-gen-1", imageIndex: 1 },
    ]);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["imageIndex", "messageId"]);
      expect(ref).not.toHaveProperty("localPath");
      expect(ref).not.toHaveProperty("url");
    }
  });

  it("emits edit-generated-image with exact opaque references", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    const editButtons = wrapper.findAll(".v2-message__edit-image-btn");
    await editButtons[0].trigger("click");
    await editButtons[1].trigger("click");

    const refs = emittedRefs(wrapper, "edit-generated-image");
    expect(refs).toEqual([
      { messageId: "msg-gen-1", imageIndex: 0 },
      { messageId: "msg-gen-1", imageIndex: 1 },
    ]);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["imageIndex", "messageId"]);
    }
  });

  it("keeps the original array index when earlier images are unresolvable", async () => {
    const message = makeTwoImageMessage();
    message.metadata = {
      ...message.metadata,
      generatedImages: [
        {},
        { url: "https://example.com/gen-2.png" },
      ],
    } as ChatV2MessageView["metadata"];
    const wrapper = mountWith(message);
    await flushPromises();

    // The unresolvable first entry renders no action row at all; the second
    // keeps its original index (badge "2", imageIndex 1).
    const rows = wrapper.findAll(".v2-message__image-actions");
    expect(rows.length).toBe(1);
    expect(
      wrapper.find(".v2-message__generated-image-index").text()
    ).toBe("2");

    await wrapper.find(".v2-message__use-reference-btn").trigger("click");
    expect(emittedRefs(wrapper, "use-generated-image")).toEqual([
      { messageId: "msg-gen-1", imageIndex: 1 },
    ]);
  });

  it("exposes translated accessible names on both action buttons", async () => {
    const wrapper = mountWith(makeTwoImageMessage());
    await flushPromises();

    for (const btn of wrapper.findAll(".v2-message__use-reference-btn")) {
      expect(btn.attributes("aria-label")).toBe("Use as reference");
    }
    for (const btn of wrapper.findAll(".v2-message__edit-image-btn")) {
      expect(btn.attributes("aria-label")).toBe("Edit");
    }
  });
});
