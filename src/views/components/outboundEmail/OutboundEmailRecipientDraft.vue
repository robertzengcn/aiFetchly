<template>
  <div class="outbound-draft" :data-testid="`outbound-draft-${draft.id}`">
    <div class="outbound-draft__header">
      <v-icon size="small" class="mr-1">mdi-email-outline</v-icon>
      <span class="text-subtitle-2 font-weight-bold">
        {{ draft.recipientDisplayName || draft.recipientAddress }}
      </span>
      <v-chip size="x-small" variant="tonal" class="ml-2">
        {{ `#${draft.revisionNumber}` }}
      </v-chip>
    </div>
    <div class="text-caption text-medium-emphasis">
      {{ draft.recipientAddress }}
    </div>

    <!-- Read-only view -->
    <template v-if="!editMode">
      <div class="outbound-draft__field">
        <strong>{{ t("outboundEmail.subject") || "Subject" }}:</strong>
        <span class="ml-1">{{ draft.subject }}</span>
      </div>
      <div class="outbound-draft__field">
        <strong>{{ t("outboundEmail.body") || "Body" }}:</strong>
        <span class="ml-1 outbound-draft__preview">{{ draft.bodyText }}</span>
      </div>
      <div class="outbound-draft__field">
        <strong>{{ t("outboundEmail.sender") || "Sender" }}:</strong>
        <span class="ml-1">{{ draft.senderAddress }}</span>
      </div>
      <v-btn
        variant="tonal"
        size="small"
        color="primary"
        data-testid="outbound-draft-edit"
        @click="$emit('edit-requested')"
      >
        <v-icon start size="small">mdi-pencil-outline</v-icon>
        {{ t("outboundEmail.edit") || "Edit" }}
      </v-btn>
    </template>

    <!-- Edit view -->
    <template v-else>
      <v-alert
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-3"
      >
        <v-icon start size="small">mdi-alert-outline</v-icon>
        {{
          t("outboundEmail.approval_invalidated") ||
          "Edits invalidate prior approval. Re-approve before sending."
        }}
      </v-alert>
      <v-text-field
        v-model="editedSubject"
        :label="t('outboundEmail.subject') || 'Subject'"
        variant="outlined"
        density="compact"
        hide-details
        class="mb-2"
      />
      <v-textarea
        v-model="editedBodyText"
        :label="t('outboundEmail.body') || 'Body'"
        variant="outlined"
        density="compact"
        rows="4"
        auto-grow
        hide-details
        class="mb-2"
      />
      <div class="outbound-draft__edit-actions">
        <v-btn
          variant="flat"
          color="primary"
          size="small"
          data-testid="outbound-draft-save"
          @click="onSave"
        >
          <v-icon start size="small">mdi-content-save</v-icon>
          {{ t("outboundEmail.save") || "Save" }}
        </v-btn>
        <v-btn
          variant="tonal"
          size="small"
          data-testid="outbound-draft-cancel"
          @click="$emit('cancel')"
        >
          {{ t("outboundEmail.cancel") || "Cancel" }}
        </v-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { OutboundEmailDraftView } from "@/views/api/outboundEmailDelivery";

/**
 * Renders one recipient's current revision in the review dialog (§18). In
 * read-only mode it shows the subject/body/sender preview; in edit mode it
 * collects edits that — on save — create a new revision and invalidate any
 * prior approval (§13.3). The parent owns the actual revision-write call;
 * this component only emits the edited payload.
 */
const props = defineProps<{
  draft: OutboundEmailDraftView;
  editMode: boolean;
}>();

const emit = defineEmits<{
  (e: "edit-requested"): void;
  (e: "save", payload: { subject: string; bodyText: string }): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

const editedSubject = ref<string>(props.draft.subject);
const editedBodyText = ref<string>(props.draft.bodyText);

// Reset the edit fields whenever the draft or editMode changes so a stale
// edit buffer from a prior revision doesn't leak into the new one.
watch(
  () => [props.draft.id, props.draft.revisionNumber, props.editMode] as const,
  () => {
    editedSubject.value = props.draft.subject;
    editedBodyText.value = props.draft.bodyText;
  }
);

function onSave(): void {
  emit("save", {
    subject: editedSubject.value,
    bodyText: editedBodyText.value,
  });
}
</script>

<style scoped>
.outbound-draft {
  padding: 8px 0;
}
.outbound-draft__header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}
.outbound-draft__field {
  margin: 4px 0;
  font-size: 0.875rem;
}
.outbound-draft__preview {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.outbound-draft__edit-actions {
  display: flex;
  gap: 8px;
}
</style>
