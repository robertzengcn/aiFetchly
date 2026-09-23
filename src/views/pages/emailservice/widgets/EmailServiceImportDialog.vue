<template>
  <v-dialog :model-value="dialog" width="560" @update:model-value="onDialogInput">
    <v-card>
      <v-card-title class="headline">{{
        CapitalizeFirstLetter(t("emailservice.import_dialog_title"))
      }}</v-card-title>
      <v-card-text>
        {{ t("emailservice.import_dialog_hint") }}
      </v-card-text>
      <v-card-actions class="d-flex flex-wrap ga-2 pa-4">
        <v-btn
          variant="outlined"
          prepend-icon="mdi-download"
          data-testid="email-service-import-template-btn"
          @click="handleDownloadTemplate"
        >
          {{ t("common.download_template") }}
        </v-btn>
        <v-btn
          variant="flat"
          color="#5865f2"
          prepend-icon="mdi-import"
          :loading="importing"
          data-testid="email-service-import-select-btn"
          @click="handleSelectFile"
        >
          {{ t("common.select_file_import") }}
        </v-btn>
        <v-spacer></v-spacer>
        <v-btn variant="text" @click="closeDialog">
          {{ CapitalizeFirstLetter(t("common.close")) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <notice-snackbar
    v-model="notice.show"
    :message="notice.message"
    :type="notice.type"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { importEmailServices } from "@/views/api/emailservice";
import { downloadEmailServiceCsvTemplate } from "@/views/utils/emailServiceImportTemplate";
import { CapitalizeFirstLetter } from "@/views/utils/function";
import NoticeSnackbar from "@/views/components/widgets/noticeSnackbar.vue";

const { t } = useI18n({ inheritLocale: true });

const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits(["update:modelValue", "imported"]);

const dialog = computed<boolean>(() => props.modelValue);

const importing = ref<boolean>(false);
const notice = ref<{
  show: boolean;
  type: "success" | "error" | "info" | "warning";
  message: string;
}>({
  show: false,
  type: "info",
  message: "",
});

function onDialogInput(value: boolean): void {
  emit("update:modelValue", value);
}

function closeDialog(): void {
  emit("update:modelValue", false);
}

function handleDownloadTemplate(): void {
  downloadEmailServiceCsvTemplate();
}

async function handleSelectFile(): Promise<void> {
  if (importing.value) return;
  importing.value = true;
  try {
    const result = await importEmailServices();
    if (result.skipped > 0) {
      const errs: string = result.errors.join(", ");
      notice.value = {
        show: true,
        type: "warning",
        message: `${t("common.import_partial", {
          imported: result.imported,
          skipped: result.skipped,
        })}${errs ? t("common.import_partial_skipped", { errors: errs }) : ""}`,
      };
    } else {
      notice.value = {
        show: true,
        type: "success",
        message: `${t("common.import_success")}: ${result.imported}`,
      };
    }
    emit("imported");
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    const cancelled: boolean = /cancel/i.test(msg);
    const noRows: boolean = /import_no_valid_rows/i.test(msg);
    const invalidFile: boolean = /import_invalid_file/i.test(msg);
    const importFailed: boolean = /import_failed/i.test(msg);
    notice.value = {
      show: true,
      type: cancelled ? "info" : "error",
      message: cancelled
        ? t("common.import_cancelled")
        : noRows
          ? t("common.import_no_valid_rows")
          : invalidFile
            ? t("common.import_invalid_file")
            : importFailed
              ? t("common.import_failed")
              : `${t("common.import_failed")}: ${msg}`,
    };
    console.error("Email service import failed:", error);
  } finally {
    importing.value = false;
  }
}
</script>
