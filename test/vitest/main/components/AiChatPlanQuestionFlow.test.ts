// test/vitest/main/components/AiChatPlanQuestionFlow.test.ts
//
// Covers the AskUserQuestion option bullets in the workspace plan question
// flow. Regression guard: the bullet glyph must swap between blank and
// marked state on selection. The old implementation bound a STATIC icon
// (`mdi-radiobox-blank` for single-select / `mdi-checkbox-outline` for
// multi-select), so clicking an option highlighted the row but the
// circle/box never showed the filled "point inside" state.
//
// Same glyph-family contract as AiChatV2QuestionCard.test.ts: only use
// glyph names the installed @mdi/font ships (blank/marked pairs).

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AiChatPlanQuestionFlow from "@/views/components/aiChatWorkspace/AiChatPlanQuestionFlow.vue";
import type {
  AIChatPlanQuestionView,
  AskUserQuestionItem,
} from "@/entityTypes/aiChatPlanTypes";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        plan: {
          planningQuestions: "Planning questions",
          questionProgress: "{current} of {total}",
          multiSelect: "Select one or more",
          singleSelect: "Select one",
          customAnswer: "Custom answer (optional)",
          reviewAndSubmit: "Review and submit",
          answerReview: "Your answers",
        },
      },
      ui: { actions: { retry: "Retry" } },
      common: { back: "Back", continue: "Continue", submit: "Submit" },
    },
  },
});

/** VIcon stub that keeps the bound `icon` prop inspectable as text. */
const CapturingIcon = defineComponent({
  props: { icon: { type: String, default: "" } },
  template: `<i data-testid="v-icon-capture">{{ icon }}</i>`,
});
const SlotStub = { template: "<div><slot /></div>" };

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

function mountFlow(question: AIChatPlanQuestionView) {
  return mount(AiChatPlanQuestionFlow, {
    props: { question },
    global: {
      plugins: [i18n],
      stubs: {
        VIcon: CapturingIcon,
        VTextField: SlotStub,
      },
    },
  });
}

function optionAt(wrapper: ReturnType<typeof mountFlow>, idx: number) {
  return wrapper.find(`[data-testid="workspace-plan-option-${idx}"]`);
}
function iconText(wrapper: ReturnType<typeof mountFlow>, idx: number): string {
  return optionAt(wrapper, idx)
    .find('[data-testid="v-icon-capture"]')
    .text();
}

describe("AiChatPlanQuestionFlow — option bullet glyph state", () => {
  it("single-select: circle swaps radiobox-blank -> radiobox-marked on click", async () => {
    const wrapper = mountFlow(makeQuestion([SINGLE]));

    // Unchecked -> empty circle.
    expect(iconText(wrapper, 0)).toContain("mdi-radiobox-blank");
    expect(iconText(wrapper, 0)).not.toContain("marked");

    await optionAt(wrapper, 0).trigger("click");

    // Checked -> filled circle (the "point inside the circle").
    expect(iconText(wrapper, 0)).toContain("mdi-radiobox-marked");
    // The untouched option stays an empty circle.
    expect(iconText(wrapper, 1)).toContain("mdi-radiobox-blank");
    expect(iconText(wrapper, 1)).not.toContain("marked");
  });

  it("single-select: selection moves the marked circle (radio semantics)", async () => {
    const wrapper = mountFlow(makeQuestion([SINGLE]));

    await optionAt(wrapper, 0).trigger("click");
    expect(iconText(wrapper, 0)).toContain("mdi-radiobox-marked");

    await optionAt(wrapper, 1).trigger("click");
    expect(iconText(wrapper, 0)).toContain("mdi-radiobox-blank");
    expect(iconText(wrapper, 0)).not.toContain("marked");
    expect(iconText(wrapper, 1)).toContain("mdi-radiobox-marked");
  });

  it("multi-select: checkbox swaps checkbox-blank <-> checkbox-marked", async () => {
    const wrapper = mountFlow(makeQuestion([MULTI]));

    // Unchecked -> empty box.
    expect(iconText(wrapper, 0)).toContain("mdi-checkbox-blank");

    await optionAt(wrapper, 0).trigger("click");
    expect(iconText(wrapper, 0)).toContain("mdi-checkbox-marked");
    expect(iconText(wrapper, 1)).toContain("mdi-checkbox-blank");

    // Clicking again unchecks it.
    await optionAt(wrapper, 0).trigger("click");
    expect(iconText(wrapper, 0)).toContain("mdi-checkbox-blank");
    expect(iconText(wrapper, 0)).not.toContain("marked");
  });

  it("multi-select: marked boxes accumulate across options", async () => {
    const wrapper = mountFlow(makeQuestion([MULTI]));

    await optionAt(wrapper, 0).trigger("click");
    await optionAt(wrapper, 1).trigger("click");
    expect(iconText(wrapper, 0)).toContain("mdi-checkbox-marked");
    expect(iconText(wrapper, 1)).toContain("mdi-checkbox-marked");
  });
});
