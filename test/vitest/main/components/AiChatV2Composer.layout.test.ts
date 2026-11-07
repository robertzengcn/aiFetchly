import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import AiChatV2Composer from "@/views/components/aiChatV2/AiChatV2Composer.vue";
// Raw SFC source so the test can pin CSS layout contracts (happy-dom cannot
// compute flex `gap` / getComputedStyle reliably) — mirrors the pattern used
// by SkillApprovalCard.permissionPreview.test.ts.
import composerSource from "@/views/components/aiChatV2/AiChatV2Composer.vue?raw";

type ComposerProps = InstanceType<typeof AiChatV2Composer>["$props"];

vi.mock("@/views/api/slashCommands", () => ({
  listSlashCommands: vi.fn(),
  onAifetchlyConfigChanged: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock("@/views/api/aiChatAtMentions", () => ({
  listAtMentionSuggestions: vi.fn(),
}));

vi.mock("@/views/components/aiChatV2/voice/BrowserVoiceRecorder", () => ({
  BrowserVoiceRecorder: vi.fn(function BrowserVoiceRecorderMock() {
    return {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
    };
  }),
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

// VTextarea stub: mirrors v-model AND reflects row/auto-grow attrs on a real
// <textarea> so DOM-order and row assertions see the actual configuration.
const TextareaStub = defineComponent({
  name: "VTextarea",
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue", "keydown"],
  template:
    '<div data-testid="ai-chat-composer"><textarea :rows="$attrs.rows" :data-auto-grow="$attrs[\'auto-grow\'] !== undefined ? \'\' : undefined" :data-max-rows="$attrs[\'max-rows\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" /><slot name="append-inner" /></div>',
});

function mountComposer(
  slots: Record<string, string> = {},
  props: Partial<ComposerProps> = {}
) {
  return mount(AiChatV2Composer, {
    global: {
      plugins: [i18n],
      stubs: {
        "v-textarea": TextareaStub,
        "v-btn": {
          template: '<button class="stub-btn"><slot /></button>',
        },
        "v-icon": true,
        "v-chip": true,
        "v-slide-y-reverse-transition": {
          template: '<div class="stub-transition"><slot /></div>',
        },
        AiChatV2SlashSuggestions: true,
        AiChatV2AtMentionSuggestions: true,
      },
    },
    slots,
    // Call sites pass a Partial (test props are optional); @vue/test-utils'
    // strict mount signature wants the full prop set, which the component
    // tolerates as undefined at runtime in tests (see the no-props mounts).
    props: props as ComposerProps,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AiChatV2Composer layout (chat-first shell design §10)", () => {
  it("renders a textarea that starts at two visible rows", () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("rows")).toBe("2");
  });

  it("auto-grows with a six-row ceiling", () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    expect(textarea.attributes("data-auto-grow")).toBeDefined();
    expect(textarea.attributes("data-max-rows")).toBe("6");
  });

  it("places the lower-toolbar controls after the textarea in DOM order", () => {
    const wrapper = mountComposer({
      controls: '<div data-testid="slot-controls">mode model approval</div>',
    });
    const composerIndex = wrapper
      .get('[data-testid="ai-chat-composer"]')
      .element.compareDocumentPosition(
        wrapper.get('[data-testid="slot-controls"]').element
      );
    // FOLLOWING (4) = controls node comes after the textarea node.
    expect(composerIndex & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      wrapper.get('[data-testid="v2-composer-controls"]').text()
    ).toContain("mode model approval");
  });

  it("keeps the legacy prepend slot rendering when controls is absent (rollback)", () => {
    const wrapper = mountComposer({
      prepend: '<div data-testid="slot-prepend">legacy controls</div>',
    });
    expect(wrapper.get('[data-testid="slot-prepend"]').text()).toBe(
      "legacy controls"
    );
    expect(wrapper.find('[data-testid="slot-controls"]').exists()).toBe(false);
  });

  it("prefers the controls slot when both are provided", () => {
    const wrapper = mountComposer({
      controls: '<div data-testid="slot-controls">new</div>',
      prepend: '<div data-testid="slot-prepend">legacy</div>',
    });
    expect(wrapper.find('[data-testid="slot-prepend"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="slot-controls"]').text()).toBe("new");
  });

  it("renders toolbar-actions before the send control", () => {
    const wrapper = mountComposer({
      "toolbar-actions": '<div data-testid="slot-actions">spoken</div>',
    });
    const actionsBar = wrapper.get(
      '[data-testid="v2-composer-toolbar-actions"]'
    );
    expect(actionsBar.text()).toBe("spoken");
    const send = wrapper.get('[data-testid="ai-chat-send"]');
    const relation = actionsBar.element.compareDocumentPosition(send.element);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("AiChatV2Composer lower-toolbar order (PRD §13.3)", () => {
  it("renders controls, then attachment, then spoken-response, then send", () => {
    const wrapper = mountComposer({
      controls:
        '<div data-testid="order-controls">mode model approval context</div>',
      "toolbar-actions": '<div data-testid="order-spoken">spoken</div>',
    });

    const position = (a: string, b: string): boolean => {
      const elA = wrapper.find('[data-testid="' + a + '"]').element;
      const elB = wrapper.find('[data-testid="' + b + '"]').element;
      return (
        (elA.compareDocumentPosition(elB) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0
      );
    };

    // PRD §13.3 (authoritative): mode/model/approval/context (the controls
    // slot) → attachment → spoken-response → Send.
    expect(position("order-controls", "ai-chat-attach")).toBe(true);
    expect(position("ai-chat-attach", "order-spoken")).toBe(true);
    expect(position("order-spoken", "ai-chat-send")).toBe(true);
  });
});

describe("AiChatV2Composer stop/send spacing (streaming toolbar)", () => {
  it("renders the streaming Stop button inside the actions strip, before Send", () => {
    const wrapper = mountComposer({}, { isStreaming: true });
    const stop = wrapper.get('[data-testid="ai-chat-stop"]');
    const send = wrapper.get('[data-testid="ai-chat-send"]');
    const actions = wrapper.get(".v2-composer__actions");
    // Stop must be the immediate left-hand neighbor of Send, inside the
    // trailing actions strip — that adjacency is the pair the gap styles.
    expect(actions.element.contains(stop.element)).toBe(true);
    const relation = stop.element.compareDocumentPosition(send.element);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pins a flex gap on the actions strip so Stop is not flush against Send", () => {
    // happy-dom cannot resolve scoped flex `gap`, so pin the CSS contract on
    // the raw source: the actions strip rule must declare a positive gap.
    const rule = composerSource.match(/\.v2-composer__actions\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const gap = rule?.[0].match(/gap:\s*(\d+)px/);
    expect(gap).not.toBeNull();
    expect(Number(gap?.[1])).toBeGreaterThan(0);
  });
});
