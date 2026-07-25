import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import { listSlashCommands } from "@/views/api/slashCommands";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  // The composer subscribes to config-changed events (PRD Problem 2).
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
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

function mountComposer() {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: false,
      isProcessing: false,
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

describe("AiChatV2Composer slash command selection", () => {
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

  it("closes suggestions after selecting a command and does not immediately reopen them", async () => {
    const wrapper = mountComposer();

    await wrapper.find('[data-testid="composer-input"]').setValue("/");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();
    expect(wrapper.find(".slash-suggestions").exists()).toBe(true);

    vi.mocked(listSlashCommands).mockClear();
    await wrapper.find(".slash-suggestions__item").trigger("click");
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();

    expect(wrapper.find(".slash-suggestions").exists()).toBe(false);
    expect(listSlashCommands).not.toHaveBeenCalled();
  });
});
