<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ t("emailservice.manage_tags") || "Manage tags" }}</v-card-title>
      <v-card-text>
        <v-alert v-if="errorMessage" type="error" class="mb-4">
          {{ errorMessage }}
        </v-alert>
        <v-form @submit.prevent="saveTag">
          <div class="d-flex ga-2 align-center">
            <v-text-field
              data-testid="tag-name"
              v-model="draftName"
              :label="editingId ? (t('emailservice.rename_tag') || 'Rename tag') : (t('emailservice.new_tag') || 'New tag')"
              :disabled="loading"
              :error-messages="validationMessage"
              maxlength="64"
              counter
              hide-details="auto"
            />
            <v-btn color="primary" type="submit" :loading="loading">
              {{ editingId ? (t("common.save") || "Save") : (t("emailservice.create_tag") || "Create tag") }}
            </v-btn>
            <v-btn v-if="editingId" variant="text" :disabled="loading" @click="cancelEdit">
              {{ t("common.cancel") || "Cancel" }}
            </v-btn>
          </div>
        </v-form>

        <v-text-field v-model="search" data-testid="tag-search" :label="t('common.search') || 'Search'" class="mt-4" />
        <v-list class="mt-4" lines="two">
          <v-list-item v-for="tag in filteredTags" :key="tag.id">
            <template #title>{{ tag.name }}</template>
            <template #subtitle>
              {{ t("emailservice.tag_service_count", { count: tag.serviceCount }) || `${tag.serviceCount} services` }}
            </template>
            <template #append>
              <v-btn icon="mdi-pencil" variant="text" :aria-label="t('emailservice.rename_tag') || 'Rename tag'" :disabled="loading" @click="startEdit(tag)" />
              <v-btn
                icon="mdi-delete"
                :aria-label="t('emailservice.delete_tag') || 'Delete tag'"
                :data-testid="`delete-tag-${tag.id}`"
                variant="text"
                :disabled="loading"
                @click="pendingDelete = tag"
              />
            </template>
          </v-list-item>
          <v-list-item v-if="filteredTags.length === 0 && !loading">
            <v-list-item-title>{{ t("emailservice.no_tags") || "No tags" }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="plain" @click="emit('update:modelValue', false)">
          {{ t("common.close") || "Close" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog :model-value="pendingDelete !== null" max-width="480" @update:model-value="pendingDelete = null">
    <v-card v-if="pendingDelete">
      <v-card-text>
        {{ t("emailservice.delete_tag_confirm", { name: pendingDelete.name, count: pendingDelete.serviceCount }) || `Delete ${pendingDelete.name}? ${pendingDelete.serviceCount} services will become untagged.` }}
      </v-card-text>
      <v-card-actions>
        <v-btn data-testid="cancel-delete-tag" :disabled="loading" @click="pendingDelete = null">
          {{ t("common.cancel") || "Cancel" }}
        </v-btn>
        <v-btn data-testid="confirm-delete-tag" color="error" :loading="loading" @click="removeTag(pendingDelete)">
          {{ t("emailservice.delete_tag") || "Delete tag" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { emailServiceTagErrorKey } from "@/views/utils/emailServiceTagError";
import { useI18n } from "vue-i18n";
import {
  createEmailServiceTag,
  deleteEmailServiceTag,
  getEmailServiceTags,
  updateEmailServiceTag,
} from "@/views/api/emailservice";
import type { EmailServiceTagSummary } from "@/entityTypes/emailmarketingType";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  changed: [];
}>();
const { t } = useI18n({ inheritLocale: true });
const tags = ref<EmailServiceTagSummary[]>([]);
const draftName = ref("");
const editingId = ref<number | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const validationMessage = ref("");
const pendingDelete = ref<EmailServiceTagSummary | null>(null);
const search = ref("");
const filteredTags = computed(() =>
  tags.value.filter((tag) => tag.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))
);

async function loadTags(): Promise<void> {
  loading.value = true;
  errorMessage.value = "";
  try {
    tags.value = await getEmailServiceTags();
  } catch (error: unknown) {
    errorMessage.value = t(emailServiceTagErrorKey(error)) || "Unable to load tags.";
  } finally {
    loading.value = false;
  }
}

function startEdit(tag: EmailServiceTagSummary): void {
  editingId.value = tag.id;
  draftName.value = tag.name;
  validationMessage.value = "";
}

function cancelEdit(): void {
  editingId.value = null;
  draftName.value = "";
  validationMessage.value = "";
}

async function saveTag(): Promise<void> {
  if (loading.value) return;
  const name = draftName.value.trim();
  if (!name) {
    validationMessage.value = t("emailservice.tag_required") || "A tag name is required.";
    return;
  }
  if (name.length > 64) {
    validationMessage.value = t("emailservice.tag_too_long") || "Tag names must be at most 64 characters.";
    return;
  }
  // Intentional control-character guard for tag names (security validation).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(draftName.value)) {
    validationMessage.value = t("emailservice.tag_invalid_characters") || "Control characters are not allowed.";
    return;
  }

  loading.value = true;
  errorMessage.value = "";
  validationMessage.value = "";
  try {
    if (editingId.value) {
      await updateEmailServiceTag(editingId.value, name);
    } else {
      await createEmailServiceTag(name);
    }
    cancelEdit();
    await loadTags();
    emit("changed");
  } catch (error: unknown) {
    const key = emailServiceTagErrorKey(error);
    if (key === "emailservice.tag_duplicate") {
      validationMessage.value = t(key) || "A tag with this name already exists.";
    } else {
      errorMessage.value = t(key) || "Unable to save tag.";
    }
  } finally {
    loading.value = false;
  }
}

async function removeTag(tag: EmailServiceTagSummary): Promise<void> {
  if (loading.value) return;

  loading.value = true;
  errorMessage.value = "";
  try {
    await deleteEmailServiceTag(tag.id);
    pendingDelete.value = null;
    if (editingId.value === tag.id) cancelEdit();
    await loadTags();
    emit("changed");
  } catch (error: unknown) {
    errorMessage.value = t(emailServiceTagErrorKey(error)) || "Unable to delete tag.";
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      cancelEdit();
      search.value = "";
      void loadTags();
    }
  },
  { immediate: true }
);
</script>
