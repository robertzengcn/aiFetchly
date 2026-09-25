import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import {
  composerDraftKeyFor,
  useComposerDraftStore,
} from "@/views/store/composerDrafts";

/**
 * FR-COMP-011 (acceptance criterion 21): with a draftKey the composer mirrors
 * its draft (text, files, pasted blocks) into the app-scoped composerDrafts
 * store, restores it after unmount/remount (a center-route round trip
 * destroys the route component), switches content with the key, and clears
 * only through the accepted-send rule.
 */

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/api/aiChatAtMentions", () => ({
  listAtMentionSuggestions: vi.fn(),
}));

vi.mock("@/views/components/aiChatV2/voice/BrowserVoiceRecorder", () => ({
  BrowserVoiceRecorder: vi.fn(),
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
        voice: { stop_speaking: "Stop speaking" },
      },
    },
  },
});

const TextareaStub = defineComponent({
  name: "VTextarea",
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue", "keydown"],
  template:
    '<div data-testid="ai-chat-composer"><textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /><slot name="append-inner" /></div>',
});

function mountComposer(options: {
  draftKey?: string | null;
  pinia: Pinia;
}) {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: false,
      conversationId: options.draftKey ?? null,
      draftKey: options.draftKey,
    },
    global: {
      plugins: [options.pinia, i18n],
      stubs: {
        "v-textarea": TextareaStub,
        "v-btn": { template: '<button class="stub-btn"><slot /></button>' },
        "v-icon": true,
        "v-chip": { template: '<span class="stub-chip"><slot /></span>' },
        "v-slide-y-reverse-transition": {
          template: '<div class="stub-transition"><slot /></div>',
        },
        AiChatV2SlashSuggestions: true,
        AiChatV2AtMentionSuggestions: true,
      },
    },
  });
}

function typeInto(wrapper: ReturnType<typeof mountComposer>, text: string) {
  return wrapper
    .get('[data-testid="ai-chat-composer"] textarea')
    .setValue(text);
}

function textareaValue(wrapper: ReturnType<typeof mountComposer>): string {
  const el = wrapper.get('[data-testid="ai-chat-composer"] textarea').element;
  return (el as HTMLTextAreaElement).value;
}

describe("AiChatV2Composer draft persistence (FR-COMP-011)", () => {
  let pinia: Pinia;
  let store: ReturnType<typeof useComposerDraftStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);
    store = useComposerDraftStore();
  });

  it("mirrors typed text into the store under the draft key", async () => {
    const wrapper = mountComposer({ draftKey: "conv-1", pinia });
    await typeInto(wrapper, "hello draft");
    await flushPromises();

    expect(store.getDraft("conv-1")?.text).toBe("hello draft");
    expect(store.getDraft(composerDraftKeyFor(null))).toBeNull();
  });

  it("keeps component-local state when no draftKey is provided (legacy dock)", async () => {
    const wrapper = mountComposer({ draftKey: undefined, pinia });
    await typeInto(wrapper, "local only");
    await flushPromises();

    expect(store.drafts.size).toBe(0);
    expect(textareaValue(wrapper)).toBe("local only");
  });

  it("restores text, files, and pasted chips after a remount (route round trip)", async () => {
    const first = mountComposer({ draftKey: "conv-1", pinia });
    await typeInto(first, "unsent work");
    await flushPromises();

    // Seed attachment + pasted block directly in the store (set through the
    // same durable boundary the route change uses).
    const file = new File(["bytes"], "shot.png", { type: "image/png" });
    store.updateComposerState(
      "conv-1",
      "unsent work",
      [file],
      { "3": "line1\nline2" },
      [{ id: 3, lineCount: 2, kind: "truncated" }]
    );
    first.unmount();

    const second = mountComposer({ draftKey: "conv-1", pinia });
    await flushPromises();

    expect(textareaValue(second)).toBe("unsent work");
    // Attachment chip row renders again.
    expect(second.find(".v2-composer__files").exists()).toBe(true);
    // Pasted chip renders with its id-derived label (stubbed chip shows slot).
    expect(second.text()).toContain("shot.png");
  });

  it("clears the stored draft only through the accepted-send rule", async () => {
    const wrapper = mountComposer({ draftKey: "conv-1", pinia });
    await typeInto(wrapper, "send me");
    await flushPromises();
    expect(store.getDraft("conv-1")?.text).toBe("send me");

    // Press Enter: the composer emits send with the onAccepted callback and
    // keeps the draft until the parent accepts.
    await wrapper
      .get('[data-testid="ai-chat-composer"] textarea')
      .trigger("keydown", { key: "Enter" });
    const sendEvents = wrapper.emitted("send");
    expect(sendEvents).toBeTruthy();
    const options = sendEvents?.[0]?.[2] as { onAccepted?: () => void };
    expect(options.onAccepted).toBeTypeOf("function");
    expect(store.getDraft("conv-1")?.text).toBe("send me"); // not yet accepted

    options.onAccepted?.();
    await flushPromises();
    expect(store.getDraft("conv-1")).toBeNull(); // cleared on acceptance
  });

  it("switches to the target conversation's draft when the key changes", async () => {
    const wrapper = mountComposer({ draftKey: "conv-1", pinia });
    await typeInto(wrapper, "first conversation");
    await flushPromises();

    store.updateComposerState("conv-2", "second conversation", [], {}, []);
    await wrapper.setProps({ draftKey: "conv-2" });
    await flushPromises();

    expect(textareaValue(wrapper)).toBe("second conversation");
    // The first conversation's draft is untouched for its return trip.
    expect(store.getDraft("conv-1")?.text).toBe("first conversation");
  });
});
