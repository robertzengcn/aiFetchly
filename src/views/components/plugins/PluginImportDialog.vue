<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="600"
  >
    <v-card>
      <v-card-title>{{ t("plugins.import_button") }}</v-card-title>
      <v-card-text>
        <v-text-field
          :model-value="zipPath"
          :label="t('plugins.select_zip')"
          readonly
          @click="pickZip"
          prepend-inner-icon="mdi-paperclip"
        />
        <v-alert
          v-if="validation"
          :type="validation.valid ? 'success' : 'error'"
          variant="tonal"
          class="mt-2"
        >
          <div v-if="validation.valid">
            {{ validation.name }} {{ validation.version }}
          </div>
          <div v-else>
            <div>{{ t("plugins.import_validation_failed") }}</div>
            <ul>
              <li v-for="(e, i) in validation.errors || []" :key="i">
                {{ e.message }}
              </li>
            </ul>
          </div>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t("common.cancel") }}</v-btn>
        <v-btn
          color="primary"
          :loading="working"
          :disabled="!zipPath"
          @click="doImport"
        >
          {{ t("plugins.import_button") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { windowInvoke } from "@/views/utils/apirequest";
import { CHOOSEFILEDIALOG } from "@/config/channellist";
import {
  importPlugin,
  validatePluginPackage,
  type PluginValidationResult,
} from "@/views/api/plugins";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [boolean];
  imported: [];
}>();

const { t } = useI18n();
const zipPath = ref("");
const validation = ref<PluginValidationResult | null>(null);
const working = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      zipPath.value = "";
      validation.value = null;
    }
  }
);

async function pickZip(): Promise<void> {
  const picked = await windowInvoke(CHOOSEFILEDIALOG, {
    title: t("plugins.select_zip"),
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (typeof picked === "string" && picked.length > 0) {
    zipPath.value = picked;
    validation.value = await validatePluginPackage(picked);
  }
}

async function doImport(): Promise<void> {
  if (!zipPath.value) return;
  working.value = true;
  try {
    await importPlugin(zipPath.value, true);
    emit("imported");
    emit("update:modelValue", false);
  } finally {
    working.value = false;
  }
}

function close(): void {
  emit("update:modelValue", false);
}
</script>
