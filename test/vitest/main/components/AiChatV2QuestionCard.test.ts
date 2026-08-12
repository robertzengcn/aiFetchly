// test/vitest/main/components/AiChatV2QuestionCard.test.ts
//
// Covers the free-text "Other" answer option added to AiChatV2QuestionCard:
//   - Single-select: typing a custom answer emits it as `answer` + `customText`.
//   - Submit stays disabled until the free-text answer is non-empty.
//   - Multi-select: custom text is appended to the chosen labels.
//   - Single-select: choosing "Other" clears a previously picked option, and
//     choosing an option clears "Other".
//   - Existing preset-option behavior is preserved (no customText).

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatV2QuestionCard from "@/views/components/aiChatV2/AiChatV2QuestionCard.vue";
import type {
  AIChatPlanQuestionView,
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from "@/entityTypes/aiChatPlanTypes";

type AnsweredEvent = [string, AskUserQuestionAnswer[]];

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2Plan: {
        questions_title: "Clarification needed",
        submit_answers: "Submit Answers",
        other_option_label: "Other",
        other_option_description: "Type your own answer",
        custom_answer_placeholder: "Type your answer...",
      },
    },
  },
});

// Vuetify is not registered in the component-test config, so stub the
// components the card uses. VTextarea renders a real <textarea> so we can
// drive it; VBtn renders a real <button> that honours `disabled`. The input
// handler lives in setup (not in the template string) because the Vue runtime
// template compiler parses templates as plain JS and cannot strip TS casts.
const VTextarea = defineComponent({
  props: {
    modelValue: { type: String, default: "" },
    placeholder: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(_, { emit }) {
    const onInput = (e: Event): void => {
      const target = e.target as HTMLTextAreaElement | null;
      emit("update:modelValue", target?.value ?? "");
    };
    return { onInput };
  },
  template: `<textarea :value="modelValue" :placeholder="placeholder" @input="onInput" />`,
});
const VBtn = {
  props: { disabled: { type: Boolean, default: false } },
  template: `<button :disabled="disabled"><slot /></button>`,
};
const SlotStub = { template: "<div><slot /></div>" };
const InlineStub = { template: "<span />" };

function makeQuestion(
  items: AskUserQuestionItem[],
  overrides: Partial<AIChatPlanQuestionView> = {}
): AIChatPlanQuestionView {
  return {
    questionId: "q-1",
    planId: "plan-1",
    conversationId: "conv-1",
    status: "pending",
    questions: items,
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

const SINGLE: AskUserQuestionItem = {
  header: "Fruit",
  question: "Pick a fruit",
  options: [
    { label: "Apple", description: "a" },
    { label: "Banana", description: "b" },
  ],
  multiSelect: false,
};

const MULTI: AskUserQuestionItem = {
  header: "Fruit",
  question: "Pick fruits",
  options: [
    { label: "Apple", description: "a" },
    { label: "Banana", description: "b" },
  ],
  multiSelect: true,
};

function mountCard(question: AIChatPlanQuestionView) {
  return mount(AiChatV2QuestionCard, {
    props: { question },
    global: {
      plugins: [i18n],
      stubs: {
        VCard: SlotStub,
        VCardItem: SlotStub,
        VCardText: SlotStub,
        VCardActions: SlotStub,
        VIcon: InlineStub,
        VChip: InlineStub,
        VSpacer: InlineStub,
        VTextarea,
        VBtn,
      },
    },
  });
}

function otherOption(wrapper: ReturnType<typeof mountCard>) {
  return wrapper.find('[data-testid="question-other-option"]');
}
function submitBtn(wrapper: ReturnType<typeof mountCard>) {
  return wrapper.find('[data-testid="question-submit-btn"]');
}
function customInput(wrapper: ReturnType<typeof mountCard>) {
  return wrapper.find('[data-testid="question-custom-input"]');
}

/** Pull the single emitted "answered" payload, asserting it fired exactly once. */
function oneAnswered(wrapper: ReturnType<typeof mountCard>): AnsweredEvent {
  const events = wrapper.emitted("answered");
  expect(events).toHaveLength(1);
  return events![0] as AnsweredEvent;
}

describe("AiChatV2QuestionCard — free-text 'Other' option", () => {
  it("emits a custom single-select answer with customText", async () => {
    const wrapper = mountCard(makeQuestion([SINGLE]));

    await otherOption(wrapper).trigger("click");
    await customInput(wrapper).setValue("Mango");
    await submitBtn(wrapper).trigger("click");

    const [questionId, answers] = oneAnswered(wrapper);
    expect(questionId).toBe("q-1");
    expect(answers).toEqual([
      { question: "Pick a fruit", answer: "Mango", customText: "Mango" },
    ]);
  });

  it("keeps Submit disabled until the free-text answer is non-empty", async () => {
    const wrapper = mountCard(makeQuestion([SINGLE]));

    // Nothing chosen yet → disabled.
    expect(submitBtn(wrapper).attributes("disabled")).toBeDefined();

    // "Other" selected but empty → still disabled.
    await otherOption(wrapper).trigger("click");
    expect(submitBtn(wrapper).attributes("disabled")).toBeDefined();

    // Type something → enabled.
    await customInput(wrapper).setValue("x");
    expect(submitBtn(wrapper).attributes("disabled")).toBeUndefined();
  });

  it("appends custom text to selected labels for multi-select", async () => {
    const wrapper = mountCard(makeQuestion([MULTI]));

    const options = wrapper.findAll('[data-testid="question-option"]');
    await options[0]!.trigger("click"); // Apple
    await options[1]!.trigger("click"); // Banana
    await otherOption(wrapper).trigger("click");
    await customInput(wrapper).setValue("Cherry");
    await submitBtn(wrapper).trigger("click");

    const [, answers] = oneAnswered(wrapper);
    expect(answers).toEqual([
      {
        question: "Pick fruits",
        answer: ["Apple", "Banana", "Cherry"],
        customText: "Cherry",
      },
    ]);
  });

  it("clears a preset option when single-select 'Other' is chosen", async () => {
    const wrapper = mountCard(makeQuestion([SINGLE]));

    const options = wrapper.findAll('[data-testid="question-option"]');
    await options[0]!.trigger("click"); // Apple first
    await otherOption(wrapper).trigger("click");
    await customInput(wrapper).setValue("Mango");
    await submitBtn(wrapper).trigger("click");

    const [, answers] = oneAnswered(wrapper);
    expect(answers).toEqual([
      { question: "Pick a fruit", answer: "Mango", customText: "Mango" },
    ]);
  });

  it("clears 'Other' when a preset option is chosen (single-select)", async () => {
    const wrapper = mountCard(makeQuestion([SINGLE]));

    await otherOption(wrapper).trigger("click");
    await customInput(wrapper).setValue("ignored text");
    // Switching to a preset option hides the custom input and drops the text.
    const options = wrapper.findAll('[data-testid="question-option"]');
    await options[0]!.trigger("click"); // Apple

    expect(customInput(wrapper).exists()).toBe(false);

    await submitBtn(wrapper).trigger("click");
    const [, answers] = oneAnswered(wrapper);
    expect(answers).toEqual([{ question: "Pick a fruit", answer: "Apple" }]);
  });

  it("does not restore a stale Other draft after switching to a preset", async () => {
    const wrapper = mountCard(makeQuestion([SINGLE]));

    await otherOption(wrapper).trigger("click");
    await customInput(wrapper).setValue("should be forgotten");
    const options = wrapper.findAll('[data-testid="question-option"]');
    await options[0]!.trigger("click"); // Apple clears Other + its draft

    // Re-open "Other": the text area must start empty, not show the old draft.
    await otherOption(wrapper).trigger("click");
    expect(customInput(wrapper).element.value).toBe("");
  });

  it("preserves existing preset-only behavior (no customText)", async () => {
    const wrapper = mountCard(makeQuestion([SINGLE]));

    const options = wrapper.findAll('[data-testid="question-option"]');
    await options[1]!.trigger("click"); // Banana
    await submitBtn(wrapper).trigger("click");

    const [, answers] = oneAnswered(wrapper);
    expect(answers).toEqual([{ question: "Pick a fruit", answer: "Banana" }]);
  });

  it("treats whitespace-only free-text as unanswered (trim path)", async () => {
    const wrapper = mountCard(makeQuestion([SINGLE]));

    await otherOption(wrapper).trigger("click");
    await customInput(wrapper).setValue("   ");
    // Whitespace-only does NOT satisfy the question → submit stays disabled.
    expect(submitBtn(wrapper).attributes("disabled")).toBeDefined();
  });

  it("requires every question answered before submit (multi-question card)", async () => {
    const wrapper = mountCard(
      makeQuestion([SINGLE, { ...MULTI, question: "Pick more fruits" }])
    );

    // Answer only the first question (custom); second still pending.
    await otherOption(wrapper).trigger("click");
    await customInput(wrapper).setValue("Mango");
    expect(submitBtn(wrapper).attributes("disabled")).toBeDefined();

    // Now answer the second question (a preset).
    const allOptions = wrapper.findAll('[data-testid="question-option"]');
    // Options for q0 come first (2), then q1's options (2). Pick q1's first.
    await allOptions[2]!.trigger("click");
    expect(submitBtn(wrapper).attributes("disabled")).toBeUndefined();

    await submitBtn(wrapper).trigger("click");
    const [, answers] = oneAnswered(wrapper);
    expect(answers).toHaveLength(2);
    expect(answers[0]!.answer).toBe("Mango");
    expect(answers[1]!.answer).toEqual(["Apple"]);
  });
});
