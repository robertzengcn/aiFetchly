import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import type { GeneratedImageReferenceView } from "@/views/components/aiChatV2/generatedImageReferenceView";
import { listSlashCommands } from "@/views/api/slashCommands";
import { listAtMentionSuggestions } from "@/views/api/aiChatAtMentions";

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/api/aiChatAtMentions", () => ({
  listAtMentionSuggestions: vi.fn(),
}));

const generatedImageRefsMessages = {
  useAsReference: "Use as reference",
  edit: "Edit",
  remove: "Remove",
  clearAll: "Clear all",
  moveUp: "Move up",
  moveDown: "Move down",
  referenceTrayTitle: "Reference images",
  limitReached: "You can reference up to 3 images per request.",
};

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        input_placeholder: "Send a message",
        send: "Send",
        stop: "Stop",
        generatedImageRefs: generatedImageRefsMessages,
        atMentions: {
          ariaLabel: "Mention workspace files",
          directory: "dir",
          file: "file",
        },
      },
      slashCommands: {
        aria_label: "Slash commands",
        sourceBuiltin: "Built-in",
      },
    },
  },
});

const TextareaStub = defineComponent({
  name: "VTextarea",
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue", "keydown", "input", "keyup", "click", "paste"],
  template:
    '<textarea data-testid="ai-chat-composer" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event)" @keydown="$emit(\'keydown\', $event)" @keyup="$emit(\'keyup\', $event)" @click="$emit(\'click\', $event)" @paste="$emit(\'paste\', $event)" />',
});

const ButtonStub = defineComponent({
  name: "VBtn",
  props: { disabled: { type: Boolean, default: false } },
  emits: ["click"],
  template:
    '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
});

function ref(messageId: string, imageIndex: number): GeneratedImageReferenceView {
  return {
    reference: { messageId, imageIndex },
    fileName: `image-${imageIndex + 1}.png`,
  };
}

interface MountOptions {
  isStreaming?: boolean;
  isProcessing?: boolean;
  selectedGeneratedImages?: GeneratedImageReferenceView[];
  generatedImageReferenceLimit?: number;
}

function mountComposer(options: MountOptions = {}) {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: options.isStreaming ?? false,
      isProcessing: options.isProcessing ?? false,
      selectedGeneratedImages: options.selectedGeneratedImages ?? [],
      generatedImageReferenceLimit: options.generatedImageReferenceLimit ?? 3,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VTextarea: TextareaStub,
        VBtn: ButtonStub,
        VIcon: true,
        VChip: true,
        VSlideYReverseTransition: false,
      },
    },
  });
}

describe("AiChatV2Composer generated-image reference tray", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listSlashCommands as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listAtMentionSuggestions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("renders no tray when selection is empty", () => {
    const wrapper = mountComposer();
    expect(wrapper.find('[data-testid="ai-chat-generated-ref-tray"]').exists()).toBe(false);
  });

  it("renders ordered numbered chips", () => {
    const wrapper = mountComposer({
      selectedGeneratedImages: [ref("assistant-1", 0), ref("assistant-2", 0)],
    });
    const tray = wrapper.find('[data-testid="ai-chat-generated-ref-tray"]');
    expect(tray.exists()).toBe(true);
    const chips = wrapper.findAll('[data-testid="ai-chat-generated-ref-chip"]');
    expect(chips).toHaveLength(2);
    expect(chips[0]?.text()).toContain("1");
    expect(chips[1]?.text()).toContain("2");
  });

  it("emits remove-generated-image with the exact reference object", async () => {
    const item = ref("assistant-7", 3);
    const wrapper = mountComposer({ selectedGeneratedImages: [item] });
    const chip = wrapper.findAll('[data-testid="ai-chat-generated-ref-chip"]')[0];
    const removeButton = chip
      ?.findAll("button")
      .find((b) => b.attributes("aria-label") === "Remove");
    expect(removeButton).toBeDefined();
    await removeButton?.trigger("click");
    const emitted = wrapper.emitted("remove-generated-image");
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toEqual({ messageId: "assistant-7", imageIndex: 3 });
  });

  it("emits clear-generated-images from the clear-all action", async () => {
    const wrapper = mountComposer({
      selectedGeneratedImages: [ref("assistant-1", 0)],
    });
    await wrapper.find('[data-testid="ai-chat-generated-ref-clear"]').trigger("click");
    expect(wrapper.emitted("clear-generated-images")).toHaveLength(1);
  });

  it("emits reorder-generated-images with the full reordered array on move-down", async () => {
    const first = ref("assistant-1", 0);
    const second = ref("assistant-2", 0);
    const third = ref("assistant-3", 0);
    const wrapper = mountComposer({
      selectedGeneratedImages: [first, second, third],
    });
    const chip0 = wrapper.findAll('[data-testid="ai-chat-generated-ref-chip"]')[0];
    const downButton = chip0
      ?.findAll("button")
      .find((b) => b.attributes("aria-label") === "Move down");
    expect(downButton).toBeDefined();
    await downButton?.trigger("click");
    const emitted = wrapper.emitted("reorder-generated-images");
    expect(emitted?.[0]?.[0]).toEqual([
      { messageId: "assistant-2", imageIndex: 0 },
      { messageId: "assistant-1", imageIndex: 0 },
      { messageId: "assistant-3", imageIndex: 0 },
    ]);
  });

  it("disables move-up on the first chip and move-down on the last", () => {
    const wrapper = mountComposer({
      selectedGeneratedImages: [ref("a1", 0), ref("a2", 0)],
    });
    const chips = wrapper.findAll('[data-testid="ai-chat-generated-ref-chip"]');
    const upOfFirst = chips[0]
      ?.findAll("button")
      .find((b) => b.attributes("aria-label") === "Move up");
    const downOfLast = chips[1]
      ?.findAll("button")
      .find((b) => b.attributes("aria-label") === "Move down");
    expect(upOfFirst?.attributes("disabled")).toBeDefined();
    expect(downOfLast?.attributes("disabled")).toBeDefined();
  });

  it("enables send with references only and empty draft", async () => {
    const wrapper = mountComposer({
      selectedGeneratedImages: [ref("assistant-1", 0)],
    });
    const send = wrapper.find('[data-testid="ai-chat-send"]');
    expect(send.attributes("disabled")).toBeUndefined();
  });

  it("keeps send disabled while streaming", () => {
    const wrapper = mountComposer({
      isStreaming: true,
      selectedGeneratedImages: [ref("assistant-1", 0)],
    });
    expect(wrapper.find('[data-testid="ai-chat-send"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ai-chat-stop"]').exists()).toBe(true);
  });

  it("shows the limit notice at or above the limit and hides it below", () => {
    const below = mountComposer({
      selectedGeneratedImages: [ref("a1", 0), ref("a2", 0)],
      generatedImageReferenceLimit: 3,
    });
    expect(below.find('[data-testid="ai-chat-generated-ref-limit"]').exists()).toBe(false);

    const at = mountComposer({
      selectedGeneratedImages: [ref("a1", 0), ref("a2", 0), ref("a3", 0)],
      generatedImageReferenceLimit: 3,
    });
    expect(at.find('[data-testid="ai-chat-generated-ref-limit"]').exists()).toBe(true);
  });

  it("distinguishes generated-image chips from uploaded file chips", () => {
    const wrapper = mountComposer({
      selectedGeneratedImages: [ref("assistant-1", 0)],
    });
    expect(
      wrapper.find('[data-testid="ai-chat-generated-ref-chip"]').exists()
    ).toBe(true);
    expect(wrapper.find(".v2-composer__generated-ref-badge").exists()).toBe(true);
    expect(wrapper.find(".v2-composer__files").exists()).toBe(false);
  });
});
