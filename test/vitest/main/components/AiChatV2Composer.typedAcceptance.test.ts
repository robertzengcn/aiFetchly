import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type DOMWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createPinia, type Pinia } from "pinia";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
import { useComposerDraftStore } from "@/views/store/composerDrafts";

/**
 * Typed-send acceptance ownership (audit 2026-10-20 B03): when a durable
 * pending receipt is accepted AFTER the user typed a newer unsent draft
 * (same conversation or after a switch round trip), acceptance must consume
 * only the submitted snapshot — newer unsent edits must survive, and a stale
 * double dispatch must be idempotent.
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

async function enterSends(target: DOMWrapper<Element>): Promise<void> {
  await target.trigger("keydown", { key: "Enter" });
  await flushPromises();
}

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        input_placeholder: "Send a message",
        send: "Send",
        stop: "Stop",
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
    '<div><textarea data-testid="composer-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /><slot name="append-inner" /></div>',
});

function mountComposer(
  pinia: Pinia,
  props: Record<string, unknown> = {}
) {
  return mount(AiChatV2Composer, {
    props: {
      isStreaming: false,
      isProcessing: false,
      draftKey: "conv-1",
      ...props,
    },
    global: {
      plugins: [pinia, i18n],
      stubs: {
        VTextarea: TextareaStub,
        VBtn: true,
        VIcon: true,
        VChip: true,
      },
    },
  });
}

function draftText(wrapper: ReturnType<typeof mountComposer>): string {
  return wrapper.findComponent(TextareaStub).props("modelValue") as string;
}

interface SendOptions {
  onAccepted?: () => void;
  pastedContents?: Record<string, string>;
}

describe("AiChatV2Composer typed acceptance and newer drafts", () => {
  let pinia: Pinia;

  beforeEach(() => {
    vi.clearAllMocks();
    pinia = createPinia();
  });

  it("acceptance of an unedited composer clears the submitted draft (existing contract)", async () => {
    const wrapper = mountComposer(pinia);
    await wrapper.find("textarea").setValue("first request");
    await enterSends(wrapper.find("textarea"));

    const options = (wrapper.emitted("send")![0][2] as SendOptions) ?? {};
    expect(typeof options.onAccepted).toBe("function");
    expect(useComposerDraftStore(pinia).getDraft("conv-1")?.text).toBe(
      "first request"
    );

    options.onAccepted?.();
    await wrapper.vm.$nextTick();

    expect(draftText(wrapper)).toBe("");
    expect(useComposerDraftStore(pinia).getDraft("conv-1")).toBeNull();
  });

  it("B01/B02 class: edits typed while the acceptance is pending survive even after switching away and back", async () => {
    const wrapper = mountComposer(pinia);
    await wrapper.find("textarea").setValue("first request");
    await enterSends(wrapper.find("textarea"));

    const options = (wrapper.emitted("send")![0][2] as SendOptions) ?? {};

    // The user keeps typing in the same conversation while the durable
    // receipt is pending...
    await wrapper.find("textarea").setValue("newer unsent draft");
    // ...moves away and returns (draft reloaded from the store)...
    await wrapper.setProps({ draftKey: "conv-2" });
    await wrapper.setProps({ draftKey: "conv-1" });
    expect(useComposerDraftStore(pinia).getDraft("conv-1")?.text).toBe(
      "newer unsent draft"
    );

    // ...and then the send is accepted.
    options.onAccepted?.();
    await wrapper.vm.$nextTick();

    // The accepted submission is gone from the transcript it belonged to;
    // the newer unsent text is still the draft.
    expect(draftText(wrapper)).toBe("newer unsent draft");
    expect(useComposerDraftStore(pinia).getDraft("conv-1")?.text).toBe(
      "newer unsent draft"
    );
  });

  it("B03: acceptance processed in another conversation leaves that conversation alone while cleaning the submitted snapshot", async () => {
    const wrapper = mountComposer(pinia);
    await wrapper.find("textarea").setValue("first request");
    await enterSends(wrapper.find("textarea"));

    const options = (wrapper.emitted("send")![0][2] as SendOptions) ?? {};

    // The user switches with the receipt pending and types in B.
    await wrapper.setProps({ draftKey: "conv-2" });
    await wrapper.find("textarea").setValue("B private draft");
    await flushPromises();

    options.onAccepted?.();
    await wrapper.vm.$nextTick();

    // B is untouched.
    expect(draftText(wrapper)).toBe("B private draft");
    expect(useComposerDraftStore(pinia).getDraft("conv-2")?.text).toBe(
      "B private draft"
    );
  });

  it("double-dispatched acceptance is idempotent on an already-cleared composer", async () => {
    const wrapper = mountComposer(pinia);
    await wrapper.find("textarea").setValue("first request");
    await enterSends(wrapper.find("textarea"));

    const options = (wrapper.emitted("send")![0][2] as SendOptions) ?? {};
    options.onAccepted?.();
    await wrapper.vm.$nextTick();
    expect(draftText(wrapper)).toBe("");

    // User starts typing a NEW draft; a stale duplicate acceptance call must
    // not wipe it.
    await wrapper.find("textarea").setValue("brand new draft");
    options.onAccepted?.();
    await wrapper.vm.$nextTick();

    expect(draftText(wrapper)).toBe("brand new draft");
  });
});
