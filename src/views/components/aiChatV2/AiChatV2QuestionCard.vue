<template>
  <v-card variant="tonal" color="info" class="v2-question-card" border>
    <v-card-item>
      <div class="v2-question-card__header">
        <v-icon size="small" color="info">mdi-help-circle-outline</v-icon>
        <span class="text-subtitle-2">{{
          t("aiChatV2Plan.questions_title") || "Clarification needed"
        }}</span>
      </div>
    </v-card-item>

    <v-card-text>
      <div
        v-for="(q, qi) in question.questions"
        :key="qi"
        class="v2-question-card__question"
      >
        <div class="text-body-2 font-weight-medium mb-2">
          <v-chip size="x-small" variant="flat" color="info" class="mr-2">{{
            q.header
          }}</v-chip>
          {{ q.question }}
        </div>

        <div class="v2-question-card__options">
          <div
            v-for="(opt, oi) in q.options"
            :key="oi"
            class="v2-question-card__option"
            :class="{
              'v2-question-card__option--selected': isSelected(qi, oi),
            }"
            data-testid="question-option"
            @click="toggleSelect(qi, oi)"
          >
            <v-icon
              size="small"
              :color="isSelected(qi, oi) ? 'primary' : undefined"
            >
              {{ q.multiSelect ? "mdi-checkbox" : "mdi-radiobox" }}
              {{ isSelected(qi, oi) ? "-marked" : "" }}
            </v-icon>
            <div class="v2-question-card__option-text">
              <span class="text-body-2 font-weight-medium">{{ opt.label }}</span>
              <span class="text-caption text-medium-emphasis d-block">{{
                opt.description
              }}</span>
            </div>
          </div>

          <!-- Free-text fallback so the user is never locked into the
               model's preset choices. Selecting it reveals a text area. -->
          <div
            class="v2-question-card__option v2-question-card__option--other"
            :class="{
              'v2-question-card__option--selected': isCustom(qi),
            }"
            data-testid="question-other-option"
            @click="toggleCustom(qi)"
          >
            <v-icon size="small" :color="isCustom(qi) ? 'primary' : undefined">
              {{ q.multiSelect ? "mdi-checkbox" : "mdi-radiobox" }}
              {{ isCustom(qi) ? "-marked" : "" }}
            </v-icon>
            <div class="v2-question-card__option-text">
              <span class="text-body-2 font-weight-medium">{{
                t("aiChatV2Plan.other_option_label") || "Other"
              }}</span>
              <span class="text-caption text-medium-emphasis d-block">{{
                t("aiChatV2Plan.other_option_description") ||
                "Type your own answer"
              }}</span>
            </div>
          </div>

          <v-textarea
            v-if="isCustom(qi)"
            :model-value="customText[qi] ?? ''"
            density="compact"
            variant="outlined"
            rows="2"
            auto-grow
            hide-details
            :maxlength="MAX_CUSTOM_ANSWER_LENGTH"
            counter
            :placeholder="
              t('aiChatV2Plan.custom_answer_placeholder') ||
              'Type your answer...'
            "
            class="v2-question-card__custom-input"
            data-testid="question-custom-input"
            @update:model-value="(v: string) => setCustomText(qi, v)"
          />
        </div>
      </div>
    </v-card-text>

    <v-card-actions>
      <v-spacer />
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        :disabled="!allAnswered"
        data-testid="question-submit-btn"
        @click="onSubmit"
      >
        {{ t("aiChatV2Plan.submit_answers") || "Submit Answers" }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  AIChatPlanQuestionView,
  AskUserQuestionAnswer,
} from "@/entityTypes/aiChatPlanTypes";

const props = defineProps<{
  question: AIChatPlanQuestionView;
}>();
const emit = defineEmits<{
  (e: "answered", questionId: string, answers: AskUserQuestionAnswer[]): void;
}>();
const { t } = useI18n();

/** Cap free-text answers so a paste can't bloat the persisted answersJson
 * (SQLite TEXT) or inflate the AI tool-message tokens. */
const MAX_CUSTOM_ANSWER_LENGTH = 2000;

/** selected[questionIndex] = array of selected option indices */
const selected = ref<Record<number, number[]>>({});
/** customSelected[questionIndex] = whether the free-text "Other" row is active */
const customSelected = ref<Record<number, boolean>>({});
/** customText[questionIndex] = the user-typed free-text answer */
const customText = ref<Record<number, string>>({});
const submitted = ref(false);

watch(
  () => props.question.questionId,
  () => {
    selected.value = {};
    customSelected.value = {};
    customText.value = {};
    submitted.value = false;
  }
);

const isSelected = (qi: number, oi: number): boolean =>
  (selected.value[qi] ?? []).includes(oi);

const isCustom = (qi: number): boolean => Boolean(customSelected.value[qi]);

const hasCustomText = (qi: number): boolean =>
  (customText.value[qi] ?? "").trim().length > 0;

/** A question counts as answered if it has a picked option OR a non-empty
 * free-text answer. */
const isQuestionAnswered = (qi: number): boolean => {
  const hasOptions = (selected.value[qi] ?? []).length > 0;
  return hasOptions || (isCustom(qi) && hasCustomText(qi));
};

const toggleSelect = (qi: number, oi: number): void => {
  if (submitted.value) return;
  const multi = props.question.questions[qi]?.multiSelect ?? false;
  const current = selected.value[qi] ?? [];
  if (multi) {
    selected.value = {
      ...selected.value,
      [qi]: current.includes(oi)
        ? current.filter((i) => i !== oi)
        : [...current, oi],
    };
  } else {
    // Single-select: picking a preset option clears any free-text choice
    // (both the selection and its draft text, so re-clicking "Other" later
    // does not silently restore a stale answer).
    selected.value = { ...selected.value, [qi]: [oi] };
    customSelected.value = { ...customSelected.value, [qi]: false };
    customText.value = { ...customText.value, [qi]: "" };
  }
};

const toggleCustom = (qi: number): void => {
  if (submitted.value) return;
  const multi = props.question.questions[qi]?.multiSelect ?? false;
  const next = !customSelected.value[qi];
  customSelected.value = { ...customSelected.value, [qi]: next };
  if (next && !multi) {
    // Single-select: picking "Other" clears preset options.
    selected.value = { ...selected.value, [qi]: [] };
  }
  if (!next) {
    customText.value = { ...customText.value, [qi]: "" };
  }
};

const setCustomText = (qi: number, value: string): void => {
  if (submitted.value) return;
  customText.value = { ...customText.value, [qi]: value };
};

const allAnswered = computed(() => {
  return props.question.questions.every((_, qi) => isQuestionAnswered(qi));
});

const onSubmit = (): void => {
  if (!allAnswered.value || submitted.value) return;
  submitted.value = true;
  const answers: AskUserQuestionAnswer[] = props.question.questions.map(
    (q, qi) => {
      const indices = selected.value[qi] ?? [];
      const labels = indices.map((i) => q.options[i]?.label ?? "");
      const text = (customText.value[qi] ?? "").trim();
      const useCustom = isCustom(qi) && text.length > 0;
      if (q.multiSelect) {
        const answer = useCustom ? [...labels, text] : labels;
        return useCustom
          ? { question: q.question, answer, customText: text }
          : { question: q.question, answer };
      }
      // Single-select: free-text wins when provided.
      if (useCustom) {
        return { question: q.question, answer: text, customText: text };
      }
      return { question: q.question, answer: labels[0] ?? "" };
    }
  );
  emit("answered", props.question.questionId, answers);
};
</script>

<style scoped>
.v2-question-card {
  margin: 8px 0;
}
.v2-question-card__header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.v2-question-card__question {
  margin-bottom: 16px;
}
.v2-question-card__question:last-child {
  margin-bottom: 0;
}
.v2-question-card__options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.v2-question-card__option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid rgba(0, 0, 0, 0.08);
  transition: background-color 0.15s ease;
}
.v2-question-card__option:hover {
  background-color: rgba(0, 0, 0, 0.03);
}
.v2-question-card__option--selected {
  background-color: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.3);
}
.v2-question-card__option-text {
  flex: 1;
}
.v2-question-card__custom-input {
  margin-top: 4px;
}
</style>
