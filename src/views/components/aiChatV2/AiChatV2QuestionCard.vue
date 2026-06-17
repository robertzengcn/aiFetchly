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

/** selected[questionIndex] = array of selected option indices */
const selected = ref<Record<number, number[]>>({});
const submitted = ref(false);

watch(
  () => props.question.questionId,
  () => {
    selected.value = {};
    submitted.value = false;
  }
);

const isSelected = (qi: number, oi: number): boolean =>
  (selected.value[qi] ?? []).includes(oi);

const toggleSelect = (qi: number, oi: number): void => {
  if (submitted.value) return;
  const current = selected.value[qi] ?? [];
  const multi = props.question.questions[qi]?.multiSelect ?? false;
  if (multi) {
    selected.value = {
      ...selected.value,
      [qi]: current.includes(oi)
        ? current.filter((i) => i !== oi)
        : [...current, oi],
    };
  } else {
    selected.value = { ...selected.value, [qi]: [oi] };
  }
};

const allAnswered = computed(() => {
  return props.question.questions.every(
    (_, qi) => (selected.value[qi] ?? []).length > 0
  );
});

const onSubmit = (): void => {
  if (!allAnswered.value || submitted.value) return;
  submitted.value = true;
  const answers: AskUserQuestionAnswer[] = props.question.questions.map(
    (q, qi) => {
      const indices = selected.value[qi] ?? [];
      const labels = indices.map((i) => q.options[i]?.label ?? "");
      return {
        question: q.question,
        answer: q.multiSelect ? labels : (labels[0] ?? ""),
      };
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
</style>
