<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="640">
    <v-card>
      <v-card-title>{{ t("plugins.marketplace.add_title") || "Add Plugin Marketplace" }}</v-card-title>
      <v-card-text>
        <v-text-field
v-model="form.source"
          :label="t('plugins.marketplace.source_label') || 'Marketplace source (owner/repo, git URL, folder, or marketplace.json URL)'" />
        <v-text-field
v-model="form.ref"
          :label="t('plugins.marketplace.ref_label') || 'Branch / tag / commit (optional)'" />
        <div class="text-caption text-medium-emphasis mt-1">
          {{ t("plugins.marketplace.source_hint") || "Examples: owner/repo, https://github.com/owner/repo.git, /local/folder, https://host/marketplace.json" }}
        </div>
        <v-alert v-if="errorMsg" type="error" variant="tonal" class="mt-3">{{ errorMsg }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t("common.cancel") || "Cancel" }}</v-btn>
        <v-btn color="primary" :loading="working" :disabled="!canSubmit" @click="doAdd">
          {{ t("plugins.marketplace.add_button") || "Add" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { addPluginMarketplace, type AddPluginMarketplaceRequest } from "@/views/api/pluginMarketplaces";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean]; added: [] }>();
const { t } = useI18n();
const form = reactive<AddPluginMarketplaceRequest>({ source: "" });
const working = ref(false);
const errorMsg = ref("");
const canSubmit = computed(() => form.source.trim().length > 0);

watch(() => props.modelValue, (open) => {
  if (open) { form.source = ""; form.ref = undefined; form.overwrite = undefined; errorMsg.value = ""; }
});

async function doAdd(): Promise<void> {
  if (!canSubmit.value) return;
  working.value = true; errorMsg.value = "";
  try {
    const r = await addPluginMarketplace({ ...form });
    if (!r) { errorMsg.value = t("plugins.marketplace.add_failed") || "Failed to add marketplace."; return; }
    emit("added"); emit("update:modelValue", false);
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally { working.value = false; }
}
function close(): void { emit("update:modelValue", false); }
</script>
