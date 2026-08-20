<template>
  <!-- Focused one-question-at-a-time flow (PRD §12.8, FR-057): progress,
       explicit selection semantics, Back/Continue, review when >1 question. -->
  <section
    class="plan-question-flow"
    data-testid="workspace-plan-question-flow"
    aria-labelledby="plan-question-heading"
  >
    <h2 id="plan-question-heading" class="flow-heading">
      {{ t('workspaceChat.plan.planningQuestions') || 'Planning questions' }}
      <span class="flow-progress">
        {{ t('workspaceChat.plan.questionProgress', { current: currentIndex + 1, total: questions.length }) || `${currentIndex + 1} of ${questions.length}` }}
      </span>
    </h2>

    <div v-if="currentQuestion" class="question-body">
      <p class="question-text">
        <strong>{{ currentQuestion.header }}</strong>
        {{ currentQuestion.question }}
      </p>
      <p class="select-mode" aria-live="polite">
        {{
          currentQuestion.multiSelect
            ? (t('workspaceChat.plan.multiSelect') || 'Select one or more')
            : (t('workspaceChat.plan.singleSelect') || 'Select one')
        }}
      </p>
      <div class="option-list" role="listbox" :aria-multiselectable="currentQuestion.multiSelect">
        <button
          v-for="(option, index) in currentQuestion.options"
          :key="index"
          type="button"
          class="option-row"
          :class="{ selected: isSelected(index) }"
          role="option"
          :aria-selected="isSelected(index)"
          :data-testid="`workspace-plan-option-${index}`"
          @click="toggle(index)"
        >
          <v-icon
            :icon="currentQuestion.multiSelect ? 'mdi-checkbox-outline' : 'mdi-radiobox-blank'"
            size="16"
            aria-hidden="true"
          />
          <span class="option-label">{{ option.label }}</span>
          <span v-if="option.description" class="option-description">
            {{ option.description }}
          </span>
        </button>
      </div>
    </div>

    <div class="flow-actions">
      <button
        type="button"
        class="flow-secondary"
        :disabled="currentIndex === 0"
        data-testid="workspace-plan-question-back"
        @click="back"
      >
        {{ t('common.back') || 'Back' }}
      </button>
      <button
        v-if="!atLastQuestion"
        type="button"
        class="flow-secondary"
        data-testid="workspace-plan-question-continue"
        @click="forward"
      >
        {{ t('common.continue') || 'Continue' }}
      </button>
      <button
        v-else
        type="button"
        class="flow-primary"
        :disabled="!hasAllAnswers"
        data-testid="workspace-plan-question-submit"
        @click="submit"
      >
        {{ questions.length > 1 ? (t('workspaceChat.plan.reviewAndSubmit') || 'Review and submit') : (t('common.submit') || 'Submit') }}
      </button>
    </div>

    <!-- Answer review before submission (PRD §12.8.5). -->
    <div
      v-if="showReview"
      class="answer-review"
      data-testid="workspace-plan-question-review"
    >
      <h3>{{ t('workspaceChat.plan.answerReview') || 'Your answers' }}</h3>
      <ul>
        <li v-for="(item, index) in questions" :key="index">
          <span class="review-question">{{ item.question }}</span>
          <span class="review-answer">{{ answerLabelFor(index) || '—' }}</span>
        </li>
      </ul>
      <button
        type="button"
        class="flow-primary"
        data-testid="workspace-plan-review-submit"
        @click="confirmSubmit"
      >
        {{ t('common.submit') || 'Submit' }}
      </button>
    </div>

    <p v-if="submitError" class="submit-error" role="alert">{{ submitError }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AIChatPlanQuestionView,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";
import {
  createPlanQuestionDraft,
  draftMove,
  draftToggleOption,
  type PlanQuestionDraft,
} from "./planPresentationProjection";

const props = defineProps<{
  question: AIChatPlanQuestionView;
}>();

const emit = defineEmits<{
  (e: "submit", answers: AskUserQuestionAnswer[]): void;
}>();

const { t } = useI18n();

const draft = ref<PlanQuestionDraft>(createPlanQuestionDraft(props.question));
const showReview = ref(false);
const submitError = ref<string | null>(null);

const questions = computed(() => props.question.questions);
const currentIndex = computed(() => draft.value.currentIndex);
const currentQuestion = computed(() => questions.value[currentIndex.value]);
const atLastQuestion = computed(
  () => currentIndex.value >= questions.value.length - 1
);
const hasAllAnswers = computed(() =>
  questions.value.every(
    (_, index) =>
      (draft.value.selectedByIndex[index]?.length ?? 0) > 0 ||
      draft.value.customTextByIndex[index]?.trim()
  )
);

function isSelected(optionIndex: number): boolean {
  return (
    draft.value.selectedByIndex[currentIndex.value]?.includes(optionIndex) ??
    false
  );
}

function toggle(optionIndex: number): void {
  draft.value = draftToggleOption(draft.value, optionIndex);
}

function back(): void {
  draft.value = draftMove(draft.value, -1, questions.value.length);
}

function forward(): void {
  draft.value = draftMove(draft.value, 1, questions.value.length);
}

function answerLabelFor(index: number): string {
  const selected = draft.value.selectedByIndex[index] ?? [];
  const labels = selected
    .map((optionIndex) => questions.value[index]?.options[optionIndex]?.label)
    .filter((label): label is string => Boolean(label));
  const custom = draft.value.customTextByIndex[index]?.trim();
  return [...labels, custom ? `"${custom}"` : ""].filter(Boolean).join(", ");
}

function buildAnswers(): AskUserQuestionAnswer[] {
  return questions.value.map((item, index) => {
    const labels = (draft.value.selectedByIndex[index] ?? [])
      .map((optionIndex) => item.options[optionIndex]?.label ?? "")
      .filter((label) => label.length > 0);
    const custom = draft.value.customTextByIndex[index]?.trim();
    return {
      question: item.question,
      // The durable contract takes the selected labels (string | string[]).
      answer: item.multiSelect ? labels : (labels[0] ?? ""),
      customText: custom || undefined,
    };
  });
}

function submit(): void {
  // Retain the draft until persisted success; show retry on failure
  // (design §31 risk table).
  submitError.value = null;
  if (questions.value.length > 1) {
    showReview.value = true;
    return;
  }
  confirmSubmit();
}

function confirmSubmit(): void {
  emit("submit", buildAnswers());
}
</script>

<style scoped>
.plan-question-flow {
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.05);
  padding: 12px 14px;
  margin: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.flow-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13.5px;
  font-weight: 700;
  margin: 0;
}

.flow-progress {
  font-weight: 500;
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.question-text {
  margin: 0;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.select-mode {
  margin: 0;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.option-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  text-align: left;
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.2);
  border-radius: 6px;
  background: transparent;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12.5px;
}

.option-row.selected {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}

.option-row:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.option-label {
  font-weight: 600;
}

.option-description {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 11.5px;
}

.flow-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.flow-primary {
  border: none;
  border-radius: 6px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 600;
  font-size: 12.5px;
  padding: 6px 16px;
  cursor: pointer;
}

.flow-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.flow-secondary {
  border: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.25);
  border-radius: 6px;
  background: transparent;
  font-size: 12.5px;
  padding: 6px 14px;
  cursor: pointer;
}

.answer-review {
  border-top: 1px solid rgba(var(--v-border-color, 0, 0, 0), 0.2);
  padding-top: 8px;
  font-size: 12px;
}

.answer-review ul {
  list-style: none;
  padding: 0;
  margin: 4px 0 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-question {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 11.5px;
}

.review-answer {
  font-weight: 600;
}

.submit-error {
  margin: 0;
  color: rgb(var(--v-theme-error));
  font-size: 12px;
}
</style>
