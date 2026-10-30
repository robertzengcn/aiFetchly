<template>
  <v-dialog
    :model-value="modelValue"
    max-width="440"
    @update:model-value="onToggle"
  >
    <v-card
      v-if="modelValue"
      data-testid="rename-dialog"
      :aria-label="t('workspaceChat.renameDialog.title') || 'Rename chat'"
    >
      <v-card-title>{{ t("workspaceChat.renameDialog.title") || "Rename chat" }}</v-card-title>
      <v-card-text>
        <v-text-field
          ref="input"
          v-model="draft"
          :label="t('workspaceChat.renameDialog.label') || 'Chat name'"
          :hint="t('workspaceChat.renameDialog.limitHint') || 'Max 200 characters'"
          :persistent-hint="true"
          :error-messages="errorText ? [errorText] : []"
          counter="200"
          density="compact"
          variant="outlined"
          autofocus
          data-testid="rename-dialog-input"
          :aria-label="t('workspaceChat.renameDialog.label') || 'Chat name'"
          :aria-invalid="errorText !== null"
          :aria-errormessage="errorText ? 'rename-dialog-error' : undefined"
          @keydown.enter="onEnter"
          @keydown.esc="onCancel"
        />
        <p
          v-if="errorText"
          id="rename-dialog-error"
          role="alert"
          class="text-caption text-error mt-1"
          data-testid="rename-dialog-error"
        >
          {{ errorText }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          data-testid="rename-dialog-cancel"
          @click="onCancel"
        >
          {{ t("workspaceChat.renameDialog.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="saveDisabled"
          :loading="saving"
          data-testid="rename-dialog-save"
          @click="onSave"
        >
          {{ t("workspaceChat.renameDialog.save") || "Save" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { validateManualTitle } from "@/service/aiChatTitle/AIChatTitleValidator";

/**
 * Shared manual-rename dialog (chat-titles FR-06 / design §10.4). One
 * component serves the header overflow action and every sidebar row. The
 * target conversation id is captured by the PARENT when opening — this
 * dialog only owns draft/validation/keyboard handling and emits the final
 * normalized name. Save errors stay visible and the draft is preserved
 * (AC-08); Enter respects IME composition (AC-14).
 */
const props = defineProps<{
  modelValue: boolean;
  /** Current visible name, prefilled and selected on open. */
  initialTitle: string;
  /** True while the parent is persisting; disables duplicate submission. */
  saving: boolean;
  /**
   * External save-failure hint: "unavailable" maps to the chat-missing
   * message, anything else to the generic retry message.
   */
  error: string | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "save", title: string): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const draft = ref("");
const input = ref<{ focus: () => void; select?: () => void; $el?: HTMLElement } | null>(
  null
);
/** True once the user edited the prefilled value. */
const touched = ref(false);
const prefilling = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      prefilling.value = true;
      draft.value = props.initialTitle;
      touched.value = false;
      void nextTick(() => {
        prefilling.value = false;
        const el = focusTarget();
        el?.focus?.();
        if (el instanceof HTMLInputElement) el.select?.();
      });
    }
  },
  { immediate: true }
);

watch(draft, () => {
  if (!prefilling.value) touched.value = true;
});

/** Resolve the focus target across real Vuetify components and test stubs. */
function focusTarget(): HTMLElement | null {
  const ref = input.value as unknown as { $el?: HTMLElement } | HTMLElement | null;
  if (!ref) return null;
  if (ref instanceof HTMLElement) return ref;
  return ref.$el instanceof HTMLElement ? ref.$el : null;
}

const validation = computed(() => validateManualTitle(draft.value));

const errorText = computed<string | null>(() => {
  if (props.error === "unavailable") {
    return t("workspaceChat.renameDialog.errorUnavailable") || "This chat is no longer available";
  }
  if (props.error) {
    return t("workspaceChat.renameDialog.errorSaveFailed") || "Couldn't rename this chat. Please try again.";
  }
  if (!touched.value || validation.value.ok) return null;
  if (validation.value.reason === "empty") {
    return t("workspaceChat.renameDialog.errorEmpty") || "Enter a name for this chat";
  }
  if (validation.value.reason === "too_long") {
    return t("workspaceChat.renameDialog.errorTooLong") || "Names must be 200 characters or fewer";
  }
  return t("workspaceChat.renameDialog.errorInvalid") || "That name contains unsupported characters";
});

const saveDisabled = computed<boolean>(
  () => props.saving || !validation.value.ok
);

/** Enter saves unless an IME composition is active (Chinese/Japanese input). */
function onEnter(event: KeyboardEvent): void {
  if (event.isComposing) return;
  onSave();
}

function onSave(): void {
  if (props.saving || !validation.value.ok) return;
  emit("save", validation.value.title);
}

function onCancel(): void {
  if (props.saving) return;
  emit("cancel");
  emit("update:modelValue", false);
}

function onToggle(value: boolean): void {
  if (!value) {
    onCancel();
    return;
  }
  emit("update:modelValue", true);
}
</script>
