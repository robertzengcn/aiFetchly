import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import type { GeneratedImageReferenceView } from "@/views/components/aiChatV2/generatedImageReferenceView";

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/api/aiChatAtMentions", () => ({
  listAtMentionSuggestions: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        input_placeholder: "Send a message",
        send: "Send",
        stop: "Stop",
        attachments: {
          text_required:
            "Add a message to send with your attachments.",
        },
      },
    },
  },
});

const TextareaStub = defineComponent({
  name: "VTextarea",
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue", "keydown"],
  template:
    '<div><textarea data-testid="composer-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /></div>',
});

const ButtonStub = defineComponent({
  name: "VBtn",
  props: { disabled: { type: Boolean, default: false } },
  emits: ["click"],
  template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

function imageRef(messageId: string, imageIndex: number): GeneratedImageReferenceView {
  return {
    reference: { messageId, imageIndex },
    fileName: `image-${imageIndex + 1}.png`,
  };
}

const TransitionStub = defineComponent({
  name: "VSlideYReverseTransition",
  template: "<div><slot /></div>",
});

function mountComposer(
  options: {
    selectedGeneratedImages?: GeneratedImageReferenceView[];
  } = {}
) {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: false,
      isProcessing: false,
      selectedGeneratedImages: options.selectedGeneratedImages ?? [],
      voiceChatReady: true,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VTextarea: TextareaStub,
        VBtn: ButtonStub,
        VIcon: true,
        VChip: true,
        VSlideYReverseTransition: TransitionStub,
      },
    },
  });
}

async function attachFile(wrapper: ReturnType<typeof mountComposer>, name: string): Promise<void> {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [new File(["content"], name, { type: "application/pdf" })],
    configurable: true,
  });
  await input.trigger("change");
  await flushPromises();
}

describe("AiChatV2Composer file-only send handling (audit B05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => Promise.resolve() },
      configurable: true,
    });
  });

  it("rejects a file-only send with a visible localized explanation instead of silently doing nothing", async () => {
    const wrapper = mountComposer();
    await attachFile(wrapper, "report.pdf");
    await flushPromises();

    await wrapper.find('[data-testid="ai-chat-send"]').trigger("click");
    await flushPromises();

    // No submission rides out for an attachment-only message.
    expect(wrapper.emitted("send")).toBeUndefined();
    // The user gets a visible explanation (PRD §18 validation behavior).
    expect(wrapper.text()).toContain(
      "Add a message to send with your attachments."
    );
  });

  it("still accepts a message with text and attachments (regression)", async () => {
    const wrapper = mountComposer();
    await attachFile(wrapper, "report.pdf");
    await wrapper.find("textarea").setValue("Please summarize report.pdf");
    await flushPromises();

    await wrapper.find('[data-testid="ai-chat-send"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("send")).toHaveLength(1);
    expect(wrapper.emitted("send")![0][0]).toBe(
      "Please summarize report.pdf"
    );
  });

  it("still accepts an image-reference-only send (surface supplies the fallback prompt)", async () => {
    const wrapper = mountComposer({
      selectedGeneratedImages: [imageRef("assistant-1", 0)],
    });

    await wrapper.find('[data-testid="ai-chat-send"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("send")).toHaveLength(1);
  });
});
