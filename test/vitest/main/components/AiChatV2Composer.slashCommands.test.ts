import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import { listSlashCommands } from "@/views/api/slashCommands";
import { listAtMentionSuggestions } from "@/views/api/aiChatAtMentions";
import type { SlashCommandView } from "@/entityTypes/slashCommandTypes";
import type { ChatV2AtMentionSuggestionView } from "@/entityTypes/aiChatAtMentionTypes";

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  // The composer subscribes to config-changed events (PRD Problem 2).
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
        atMentions: {
          ariaLabel: "Mention workspace files",
          directory: "dir",
          file: "file",
        },
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
  emits: ["update:modelValue", "keydown", "input", "keyup", "click"],
  template:
    '<textarea data-testid="ai-chat-composer" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event)" @keydown="$emit(\'keydown\', $event)" @keyup="$emit(\'keyup\', $event)" @click="$emit(\'click\', $event)" />',
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

function folderSuggestion(path: string): ChatV2AtMentionSuggestionView {
  return {
    id: `directory:${path}`,
    displayText: `${path}/`,
    insertText: `@${path}/`,
    relativePath: path,
    kind: "directory",
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
    vi.mocked(listAtMentionSuggestions).mockResolvedValue({
      suggestions: [folderSuggestion("data")],
      workspaceRequired: false,
      truncated: false,
    });
  });

  it("closes suggestions after selecting a command and does not immediately reopen them", async () => {
    const wrapper = mountComposer();

    await wrapper.find('[data-testid="ai-chat-composer"]').setValue("/");
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

  it("closes the suggestion dropdown once a space follows the command token", async () => {
    vi.mocked(listSlashCommands).mockResolvedValue({
      status: true,
      commands: [command("loop")],
      diagnostics: [],
      msg: "",
    });
    const wrapper = mountComposer();
    const input = wrapper.find('[data-testid="ai-chat-composer"]');

    // Typing the command name opens the dropdown (command selection).
    await input.setValue("/loop");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();
    expect(wrapper.find(".slash-suggestions").exists()).toBe(true);

    // A space after the token means the command is selected and the user is
    // now typing arguments — the dropdown must close even though the draft
    // still starts with "/".
    await input.setValue("/loop ");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();
    expect(wrapper.find(".slash-suggestions").exists()).toBe(false);

    // ...and stays closed while the arguments are typed.
    await input.setValue("/loop 5");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();
    expect(wrapper.find(".slash-suggestions").exists()).toBe(false);
  });

  it("sends a message when a stale @-mention dropdown is still open but the cursor is no longer in a mention", async () => {
    const wrapper = mountComposer();
    const input = wrapper.find<HTMLTextAreaElement>(
      '[data-testid="ai-chat-composer"]'
    );

    await input.setValue("@data/");
    await vi.advanceTimersByTimeAsync(130);
    await flushPromises();
    expect(wrapper.find(".at-mention-dropdown").exists()).toBe(true);

    const message = "@data/ what is in the folder?";
    input.element.value = message;
    input.element.setSelectionRange(message.length, message.length);
    wrapper.findComponent(TextareaStub).vm.$emit("update:modelValue", message);
    await wrapper.vm.$nextTick();

    await input.trigger("keydown", { key: "Enter", shiftKey: false });

    expect(wrapper.emitted("send")?.[0]?.slice(0, 2)).toEqual([message, []]);
  });

  it("keeps the draft until the parent accepts the send", async () => {
    const wrapper = mountComposer();
    const input = wrapper.find<HTMLInputElement>(
      '[data-testid="ai-chat-composer"]'
    );
    const message = "/goal keep this draft";

    await input.setValue(message);
    await input.trigger("keydown", { key: "Enter", shiftKey: false });

    expect(wrapper.emitted("send")).toHaveLength(1);
    expect(input.element.value).toBe(message);
  });

  it("clears the draft after the parent accepts the send", async () => {
    const wrapper = mountComposer();
    const input = wrapper.find<HTMLInputElement>(
      '[data-testid="ai-chat-composer"]'
    );

    await input.setValue("accepted message");
    await input.trigger("keydown", { key: "Enter", shiftKey: false });

    const options = wrapper.emitted("send")?.[0]?.[2] as
      | { onAccepted?: () => void }
      | undefined;
    options?.onAccepted?.();
    await wrapper.vm.$nextTick();

    expect(input.element.value).toBe("");
  });
});
