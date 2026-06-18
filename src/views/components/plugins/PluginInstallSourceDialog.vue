<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    max-width="680"
  >
    <v-card>
      <v-card-title>
        {{ t("plugins.install_source.title") || "Install Plugin from Source" }}
      </v-card-title>
      <v-card-text>
        <v-select
          :items="kinds"
          item-title="label"
          item-value="value"
          v-model="kind"
          :label="t('plugins.install_source.kind_label') || 'Source type'"
          density="comfortable"
        />

        <div v-if="kind === 'local-zip'" class="mt-3">
          <v-text-field
            :model-value="form.zipPath"
            readonly
            :label="t('plugins.install_source.zip_label') || 'Choose .zip'"
            prepend-inner-icon="mdi-paperclip"
            @click="pickZip"
          />
        </div>

        <div v-else-if="kind === 'local-folder'" class="mt-3">
          <v-text-field
            :model-value="form.folderPath"
            readonly
            :label="t('plugins.install_source.folder_label') || 'Choose folder'"
            prepend-inner-icon="mdi-folder"
            @click="pickFolder"
          />
          <div class="text-caption text-medium-emphasis">
            {{
              t("plugins.install_source.folder_hint") ||
              "Your source folder will be copied into the plugins cache and never modified."
            }}
          </div>
        </div>

        <div v-else-if="kind === 'git'" class="mt-3">
          <v-text-field
            v-model="form.uri"
            :label="t('plugins.install_source.git_url') || 'Git URL (https or ssh)'"
            placeholder="https://github.com/owner/repo.git"
          />
          <v-text-field
            v-model="form.ref"
            :label="t('plugins.install_source.git_ref') || 'Branch / tag / commit (optional)'"
          />
        </div>

        <div v-else-if="kind === 'github'" class="mt-3">
          <v-text-field
            v-model="form.uri"
            :label="t('plugins.install_source.github_url') || 'GitHub repo or release asset URL'"
            placeholder="https://github.com/owner/repo"
          />
          <v-text-field
            v-model="form.ref"
            :label="t('plugins.install_source.github_ref') || 'Branch / tag (optional)'"
          />
        </div>

        <div v-else-if="kind === 'npm'" class="mt-3">
          <v-text-field
            v-model="form.npmPackage"
            :label="t('plugins.install_source.npm_package') || 'Package name (e.g. @scope/pkg)'"
          />
          <v-text-field
            v-model="form.npmVersion"
            :label="t('plugins.install_source.npm_version') || 'Version (optional)'"
          />
          <v-text-field
            v-model="form.npmRegistry"
            :label="t('plugins.install_source.npm_registry') || 'Registry URL (optional, HTTPS)'"
          />
          <v-text-field
            v-model="form.npmAuthToken"
            type="password"
            :label="t('plugins.install_source.npm_token') || 'Auth token (optional, not stored)'"
            :hint="t('plugins.install_source.npm_token_hint') || 'Used once for this install; not persisted.'"
            persistent-hint
          />
        </div>

        <div v-else-if="kind === 'url'" class="mt-3">
          <v-text-field
            v-model="form.uri"
            :label="t('plugins.install_source.url_label') || 'URL (.zip, git, or GitHub URL)'"
            placeholder="https://example.com/plugin.zip"
          />
          <div class="text-caption text-medium-emphasis">
            {{
              t("plugins.install_source.url_hint") ||
              "Auto-detected: .zip downloads, git URLs clone, GitHub URLs use the release flow."
            }}
          </div>
        </div>

        <v-alert
          v-if="errorMsg"
          type="error"
          variant="tonal"
          class="mt-3"
        >
          {{ errorMsg }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">
          {{ t("common.cancel") || "Cancel" }}
        </v-btn>
        <v-btn
          color="primary"
          :loading="working"
          :disabled="!canInstall"
          @click="doInstall"
        >
          {{ t("plugins.install_button") || "Install" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { windowInvoke } from "@/views/utils/apirequest";
import { CHOOSEFILEDIALOG } from "@/config/channellist";
import {
  installPluginFromSource,
  type PluginInstallSourceRequest,
  type PluginSourceKind,
} from "@/views/api/plugins";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [boolean];
  imported: [];
}>();
const { t } = useI18n();

const kind = ref<PluginSourceKind>("local-folder");
const form = reactive<PluginInstallSourceRequest>({ kind: "local-folder" });
const working = ref(false);
const errorMsg = ref("");

const kinds = computed(() => [
  {
    label:
      t("plugins.install_source.kind_local_zip") || "Local Zip",
    value: "local-zip",
  },
  {
    label:
      t("plugins.install_source.kind_local_folder") || "Local Folder",
    value: "local-folder",
  },
  { label: t("plugins.install_source.kind_git") || "Git", value: "git" },
  {
    label: t("plugins.install_source.kind_github") || "GitHub",
    value: "github",
  },
  { label: t("plugins.install_source.kind_npm") || "npm", value: "npm" },
  { label: t("plugins.install_source.kind_url") || "URL", value: "url" },
]);

const canInstall = computed(() => {
  switch (kind.value) {
    case "local-zip":
      return !!form.zipPath;
    case "local-folder":
      return !!form.folderPath;
    case "git":
    case "github":
    case "url":
      return !!form.uri;
    case "npm":
      return !!form.npmPackage;
    default:
      return false;
  }
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      kind.value = "local-folder";
      Object.assign(form, {
        kind: "local-folder",
        zipPath: undefined,
        folderPath: undefined,
        uri: undefined,
        ref: undefined,
        npmPackage: undefined,
        npmVersion: undefined,
        npmRegistry: undefined,
        npmAuthScope: undefined,
        npmAuthToken: undefined,
      });
      errorMsg.value = "";
    }
  }
);

async function pickZip(): Promise<void> {
  const picked = await windowInvoke(CHOOSEFILEDIALOG, {
    title: t("plugins.install_source.zip_label") || "Choose .zip",
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });
  if (typeof picked === "string" && picked.length > 0) {
    form.zipPath = picked;
  }
}

async function pickFolder(): Promise<void> {
  const picked = await windowInvoke(CHOOSEFILEDIALOG, {
    title: t("plugins.install_source.folder_label") || "Choose folder",
    properties: ["openDirectory"],
  });
  if (typeof picked === "string" && picked.length > 0) {
    form.folderPath = picked;
  }
}

async function doInstall(): Promise<void> {
  if (!canInstall.value) return;
  working.value = true;
  errorMsg.value = "";
  form.kind = kind.value;
  try {
    const r = await installPluginFromSource({ ...form });
    if (!r) {
      errorMsg.value =
        t("plugins.install_source.install_failed") || "Install failed.";
      return;
    }
    emit("imported");
    emit("update:modelValue", false);
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    working.value = false;
  }
}

function close(): void {
  emit("update:modelValue", false);
}
</script>
