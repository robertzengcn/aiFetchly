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
            aria-describedby="git-local-hint-el"
          />
          <v-text-field
            v-model="form.ref"
            :label="t('plugins.install_source.git_ref') || 'Branch / tag / commit (optional)'"
          />
          <!-- GF §13.1: a local Git install may be required for THIS source. -->
          <div
            id="git-local-hint-el"
            class="text-caption text-medium-emphasis"
            data-testid="git-local-hint"
          >
            {{
              t("plugins.install_source.git_helper") ||
              "A local Git installation may be required for this source. Public GitHub repositories do not need Git — choose GitHub instead."
            }}
          </div>
        </div>

        <div v-else-if="kind === 'github'" class="mt-3">
          <v-text-field
            v-model="form.uri"
            :label="t('plugins.install_source.github_url') || 'GitHub repo or release asset URL'"
            placeholder="https://github.com/owner/repo"
            :aria-describedby="githubDescribedBy"
          />
          <v-text-field
            v-model="form.ref"
            :label="t('plugins.install_source.github_ref') || 'Branch / tag / commit (optional)'"
            :aria-describedby="errorMsg ? 'plugin-install-error' : undefined"
          />
          <!-- GF PRD §11.1/FR-25: disclose the no-Git/no-token contract, but
               only while the main process actually has archive install on. -->
          <div
            v-if="githubArchiveEnabled"
            id="github-no-git-hint-el"
            class="text-caption text-medium-emphasis"
            data-testid="github-no-git-hint"
          >
            {{
              t("plugins.install_source.github_helper") ||
              "Public repositories install without Git or a GitHub token. Leave the revision empty for the default branch."
            }}
          </div>
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
          id="plugin-install-error"
          type="error"
          variant="tonal"
          class="mt-3"
          role="alert"
          data-testid="install-error"
        >
          {{ errorMsg }}
        </v-alert>

        <!-- GF §11.5/NFR-10: polite live region so assistive tech hears the
             working stage and the cancelled outcome, not just failures. -->
        <p
          v-if="working || statusMsg"
          role="status"
          aria-live="polite"
          data-testid="install-status"
          class="text-caption text-medium-emphasis mt-2 mb-0"
        >
          {{ working ? stageText : statusMsg }}
        </p>
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
          data-testid="install-btn"
          @click="doInstall"
        >
          {{ t("plugins.install_button") || "Install" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
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
// operationId keys main-process cancellation (GF design §12); regenerated
// per dialog session.
const operationId = ref(crypto.randomUUID());
const form = reactive<PluginInstallSourceRequest>({
  operationId: "",
  kind: "local-folder",
});
watch(operationId, (id) => {
  form.operationId = id;
});
form.operationId = operationId.value;
const working = ref(false);
const errorMsg = ref("");
/** Polite-status message (cancellation outcome); shown in the live region
 *  once `working` goes false (GF §11.5, NFR-10). */
const statusMsg = ref("");
/** FR-25/GF §13.1: show the no-Git helper only when the main process
 *  actually has archive install enabled (capability-aware copy). */
const githubArchiveEnabled = ref(true);
onMounted(() => {
  void (async () => {
    try {
      const { getPluginInstallCapabilities } = await import(
        "@/views/api/plugins"
      );
      const caps = await getPluginInstallCapabilities();
      if (caps) githubArchiveEnabled.value = caps.githubArchiveInstallEnabled;
    } catch {
      /* keep the default */
    }
  })();
});

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

/** §11.2 working-stage copy per source kind (single invoke, no event
 *  stream — the stage line describes the phase the install is in). */
const stageText = computed(() => {
  switch (kind.value) {
    case "github":
      return (
        t("plugins.install_source.working_archive") ||
        "Resolving the revision and downloading the archive…"
      );
    case "git":
      return t("plugins.install_source.working_clone") || "Cloning the repository…";
    case "url":
      return (
        t("plugins.install_source.working_download") || "Downloading the archive…"
      );
    case "npm":
      return (
        t("plugins.install_source.working_fetch") || "Fetching the npm package…"
      );
    default:
      return t("plugins.install_source.working_import") || "Importing the plugin…";
  }
});

/** GF §11.5: the URL field is described by the no-Git helper (when shown)
 *  and by the live error alert once one exists. */
const githubDescribedBy = computed(() => {
  const ids: string[] = [];
  if (githubArchiveEnabled.value) ids.push("github-no-git-hint-el");
  if (errorMsg.value) ids.push("plugin-install-error");
  return ids.length > 0 ? ids.join(" ") : undefined;
});

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
      statusMsg.value = "";
    }
  }
);

async function pickZip(): Promise<void> {
  try {
    const picked = await windowInvoke(CHOOSEFILEDIALOG, {
      title: t("plugins.install_source.zip_label") || "Choose .zip",
      filters: [{ name: "Zip", extensions: ["zip"] }],
      properties: ["openFile"],
    });
    if (typeof picked === "string" && picked.length > 0) {
      form.zipPath = picked;
    }
  } catch (e: unknown) {
    // The dialog rejects with "canceled" when the user closes it without
    // picking anything — that is expected, not an error.
    if (e instanceof Error && e.message === "canceled") return;
    errorMsg.value = e instanceof Error ? e.message : String(e);
  }
}

async function pickFolder(): Promise<void> {
  try {
    const picked = await windowInvoke(CHOOSEFILEDIALOG, {
      title: t("plugins.install_source.folder_label") || "Choose folder",
      properties: ["openDirectory"],
    });
    if (typeof picked === "string" && picked.length > 0) {
      form.folderPath = picked;
    }
  } catch (e: unknown) {
    // The dialog rejects with "canceled" when the user closes it without
    // picking anything — that is expected, not an error.
    if (e instanceof Error && e.message === "canceled") return;
    errorMsg.value = e instanceof Error ? e.message : String(e);
  }
}

async function doInstall(): Promise<void> {
  if (!canInstall.value) return;
  working.value = true;
  errorMsg.value = "";
  statusMsg.value = "";
  form.kind = kind.value;
  try {
    const r = await installPluginFromSource({ ...form });
    if (!r) {
      errorMsg.value =
        t("plugins.install_source.install_failed") || "Install failed.";
      return;
    }
    if (!r.success) {
      // Typed domain failure (GF §13.3): map stable codes to localized
      // guidance; user cancellation shows no alert.
      const first = r.errors[0];
      if (first?.code === "source-cancelled") {
        // Announce the cancellation politely; no failure alert (GF §13.3).
        statusMsg.value =
          t("plugins.install_source.error_source-cancelled") ||
          "Installation cancelled.";
        return;
      }
      errorMsg.value =
        (first && installErrorText(first.code)) ||
        first?.message ||
        (t("plugins.install_source.install_failed") || "Install failed.");
      return;
    }
    emit("imported");
    emit("update:modelValue", false);
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    working.value = false;
    // A fresh operation id per attempt so a retry gets a fresh controller.
    operationId.value = crypto.randomUUID();
  }
}

/** Exhaustive stable-code → localized guidance map (GF §13.3). */
function installErrorText(code: string): string {
  const key = `plugins.install_source.error_${code}`;
  const text = t(key);
  return text === key ? "" : text;
}

function close(): void {
  emit("update:modelValue", false);
}
</script>
