/**
 * AiChatV2Composer slash-command scoping (FR-1, design §9.2/§9.3).
 *
 * Verifies the composer forwards the active conversationId to listSlashCommands
 * (so suggestions are scoped to the conversation's approved workspace) and
 * re-fetches suggestions when the conversation changes while the user is
 * already typing a slash command.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import { listSlashCommands } from "@/views/api/slashCommands";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
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
          add: "Attach file",
          unsupported: "{name} is not supported.",
          too_large: "{name} is too large.",
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
  props: {
    modelValue: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue", "keydown"],
  template:
    '<textarea data-testid="composer-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
});

const ButtonStub = defineComponent({
  name: "VBtn",
  emits: ["click"],
  template: '<button type="button" @click="$emit(\'click\')"><slot /></button>',
});

function command(name: string): SlashCommandView {
  return {
    id: `built-in:command:${name}`,
    name,
    description: `Run ${name}`,
    aliases: [],
    source: "built-in",
    sourceLabel: "Built-in",
    enabled: true,
  };
}

function mountComposer(conversationId?: string | null) {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: false,
      isProcessing: false,
      conversationId,
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

describe("AiChatV2Composer conversation-scoped slash suggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(listSlashCommands).mockResolvedValue({
      status: true,
      commands: [command("help")],
      diagnostics: [],
      msg: "",
    });
  });

  it("forwards the active conversationId to listSlashCommands", async () => {
    const wrapper = mountComposer("conv-A");
    await wrapper.find('[data-testid="composer-input"]').setValue("/");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();

    expect(listSlashCommands).toHaveBeenCalledWith({
      conversationId: "conv-A",
      query: "",
    });
  });

  it("passes conversationId undefined when the prop is null (new chat)", async () => {
    const wrapper = mountComposer(null);
    await wrapper.find('[data-testid="composer-input"]').setValue("/");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();

    expect(listSlashCommands).toHaveBeenCalledWith({
      conversationId: undefined,
      query: "",
    });
  });

  it("re-fetches scoped suggestions when the conversation changes mid-typing", async () => {
    const wrapper = mountComposer("conv-A");
    await wrapper.find('[data-testid="composer-input"]').setValue("/");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();
    expect(listSlashCommands).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: "conv-A" })
    );

    vi.mocked(listSlashCommands).mockClear();
    // Switch conversation while the draft still starts with "/".
    await wrapper.setProps({ conversationId: "conv-B" });
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();

    expect(listSlashCommands).toHaveBeenCalledWith({
      conversationId: "conv-B",
      query: "",
    });
  });

  it("does NOT open suggestions when the conversation changes if the draft is not a slash command", async () => {
    const wrapper = mountComposer("conv-A");
    // Draft is plain text (no leading "/").
    await wrapper.find('[data-testid="composer-input"]').setValue("hello");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();
    vi.mocked(listSlashCommands).mockClear();

    await wrapper.setProps({ conversationId: "conv-B" });
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();

    expect(listSlashCommands).not.toHaveBeenCalled();
  });
});
