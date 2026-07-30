<template>
  <v-dialog
    :model-value="modelValue"
    max-width="820px"
    persistent
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-web</v-icon>
        {{ t("knowledge.website_import_title") }}
      </v-card-title>

      <v-card-text>
        <p class="text-body-2 text-grey-darken-1 mb-4">
          {{ t("knowledge.website_import_subtitle") }}
        </p>

        <!-- Mode selector -->
        <div class="text-subtitle-2 mb-2">
          {{ t("knowledge.website_import_mode") }}
        </div>
        <v-btn-toggle
          v-model="mode"
          mandatory
          divided
          color="primary"
          class="w-100 d-flex mb-4"
          @update:model-value="onModeChange"
        >
          <v-btn value="single_page" class="flex-grow-1 mode-btn">
            <div class="d-flex flex-column align-center py-1">
              <v-icon>mdi-file-document-outline</v-icon>
              <span class="text-caption mt-1">{{
                t("knowledge.website_import_mode_single")
              }}</span>
            </div>
          </v-btn>
          <v-btn value="url_list" class="flex-grow-1 mode-btn">
            <div class="d-flex flex-column align-center py-1">
              <v-icon>mdi-format-list-bulleted</v-icon>
              <span class="text-caption mt-1">{{
                t("knowledge.website_import_mode_list")
              }}</span>
            </div>
          </v-btn>
          <v-btn value="site_crawl" class="flex-grow-1 mode-btn">
            <div class="d-flex flex-column align-center py-1">
              <v-icon>mdi-sitemap-outline</v-icon>
              <span class="text-caption mt-1">{{
                t("knowledge.website_import_mode_crawl")
              }}</span>
            </div>
          </v-btn>
        </v-btn-toggle>

        <!-- URL field for single_page and site_crawl -->
        <v-text-field
          v-if="mode !== 'url_list'"
          v-model="url"
          :label="
            mode === 'site_crawl'
              ? t('knowledge.website_import_seed_url')
              : t('knowledge.website_import_url')
          "
          :hint="t('knowledge.website_import_url_hint')"
          persistent-hint
          prepend-inner-icon="mdi-link-variant"
          placeholder="https://example.com/docs"
          clearable
          class="mb-3"
          :disabled="importing"
        />

        <!-- Title override only for single_page -->
        <v-text-field
          v-if="mode === 'single_page'"
          v-model="title"
          :label="t('knowledge.website_import_title_field')"
          :hint="t('knowledge.website_import_title_hint')"
          persistent-hint
          prepend-inner-icon="mdi-format-title"
          clearable
          class="mb-3"
          :disabled="importing"
        />

        <!-- URL list textarea -->
        <v-textarea
          v-if="mode === 'url_list'"
          v-model="urlsText"
          :label="t('knowledge.website_import_urls')"
          :hint="
            t('knowledge.website_import_urls_hint', {
              max: WEBSITE_IMPORT_LIMITS.maxUrls,
            })
          "
          persistent-hint
          prepend-inner-icon="mdi-format-list-text"
          placeholder="https://example.com/pricing&#10;https://example.com/faq"
          rows="5"
          auto-grow
          class="mb-3"
          :disabled="importing"
        />

        <!-- Max pages for url_list and site_crawl -->
        <div v-if="mode !== 'single_page'" class="mb-3">
          <div class="d-flex justify-space-between align-center">
            <span class="text-subtitle-2">{{
              t("knowledge.website_import_max_pages")
            }}</span>
            <v-chip size="small" color="primary" variant="tonal">{{
              maxPages
            }}</v-chip>
          </div>
          <v-slider
            v-model="maxPages"
            :min="WEBSITE_IMPORT_LIMITS.maxPages.min"
            :max="WEBSITE_IMPORT_LIMITS.maxPages.max"
            :step="1"
            thumb-label
            :disabled="importing"
          />
        </div>

        <!-- Max depth only for site_crawl -->
        <div v-if="mode === 'site_crawl'" class="mb-3">
          <div class="d-flex justify-space-between align-center">
            <span class="text-subtitle-2">{{
              t("knowledge.website_import_max_depth")
            }}</span>
            <v-chip size="small" color="primary" variant="tonal">{{
              maxDepth
            }}</v-chip>
          </div>
          <v-slider
            v-model="maxDepth"
            :min="WEBSITE_IMPORT_LIMITS.maxDepth.min"
            :max="WEBSITE_IMPORT_LIMITS.maxDepth.max"
            :step="1"
            thumb-label
            :disabled="importing"
          />
        </div>

        <!-- Common metadata -->
        <v-row dense>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="tagsText"
              :label="t('knowledge.website_import_tags')"
              :hint="t('knowledge.website_import_tags_hint')"
              persistent-hint
              prepend-inner-icon="mdi-tag-multiple"
              :disabled="importing"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="author"
              :label="t('knowledge.website_import_author')"
              prepend-inner-icon="mdi-account-outline"
              :disabled="importing"
            />
          </v-col>
        </v-row>

        <v-textarea
          v-model="description"
          :label="t('knowledge.website_import_description')"
          rows="2"
          auto-grow
          class="mt-2"
          :disabled="importing"
        />

        <v-select
          v-model="duplicatePolicy"
          :items="policyOptions"
          item-title="label"
          item-value="value"
          :label="t('knowledge.website_import_duplicate_policy')"
          prepend-inner-icon="mdi-content-duplicate"
          :disabled="importing"
          class="mt-2"
        />

        <v-alert type="info" variant="tonal" density="compact" class="mt-4">
          {{ t("knowledge.website_import_hint") }}
        </v-alert>

        <v-alert
          v-if="importing || currentProgress"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          <div
            class="d-flex justify-space-between align-center mb-2 progress-header"
          >
            <span class="text-subtitle-2">{{ progressTitle }}</span>
            <span class="text-caption text-grey-darken-1">{{
              progressCounts
            }}</span>
          </div>
          <v-progress-linear
            :model-value="progressPercent ?? 0"
            :indeterminate="progressPercent === undefined"
            color="primary"
            height="6"
            rounded
            class="mb-2"
          />
          <div
            v-if="currentProgress?.url"
            class="text-caption text-wrap progress-url"
          >
            {{ t("knowledge.website_import_current_page") || "Current page" }}:
            {{ currentProgress.url }}
          </div>
          <div
            v-if="currentProgress?.discoveredCount !== undefined"
            class="text-caption text-grey-darken-1"
          >
            {{
              t("knowledge.website_import_progress_discovered", {
                count: currentProgress.discoveredCount,
              }) || `Discovered ${currentProgress.discoveredCount} link(s)`
            }}
          </div>
        </v-alert>

        <v-alert
          v-if="formError"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{ formError }}
        </v-alert>

        <!-- Results -->
        <div v-if="successResult || errorResult" class="mt-4">
          <v-divider class="mb-3" />

          <template v-if="successResult">
            <v-alert
              type="success"
              variant="tonal"
              density="compact"
              class="mb-3"
            >
              {{ successResult.summary }}
            </v-alert>

            <div
              v-if="successResult.discoveredCount !== undefined"
              class="text-caption text-grey mb-2"
            >
              {{
                t("knowledge.website_import_result_discovered", {
                  count: successResult.discoveredCount,
                })
              }}
            </div>

            <div v-if="successResult.imported.length" class="mb-3">
              <div class="text-subtitle-2 mb-1">
                {{ t("knowledge.website_import_result_imported") }} ({{
                  successResult.imported.length
                }})
              </div>
              <v-list
                density="compact"
                class="result-list bg-grey-lighten-4 rounded"
              >
                <v-list-item
                  v-for="(doc, i) in successResult.imported"
                  :key="`imp-${i}`"
                >
                  <template #prepend>
                    <v-icon color="success" size="small"
                      >mdi-check-circle</v-icon
                    >
                  </template>
                  <v-list-item-title>{{
                    doc.title || doc.name
                  }}</v-list-item-title>
                  <v-list-item-subtitle class="text-wrap">
                    {{ doc.sourceUrl }}
                    <span class="text-grey">
                      ·
                      {{
                        t("knowledge.website_import_chunks", {
                          count: doc.chunksCreated,
                        })
                      }}
                    </span>
                  </v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </div>

            <div v-if="successResult.skipped.length">
              <div class="text-subtitle-2 mb-1">
                {{ t("knowledge.website_import_result_skipped") }} ({{
                  successResult.skipped.length
                }})
              </div>
              <v-list
                density="compact"
                class="result-list bg-grey-lighten-4 rounded"
              >
                <v-list-item
                  v-for="(sk, i) in successResult.skipped"
                  :key="`sk-${i}`"
                >
                  <template #prepend>
                    <v-icon color="warning" size="small">mdi-alert</v-icon>
                  </template>
                  <v-list-item-title class="text-wrap">{{
                    sk.url
                  }}</v-list-item-title>
                  <v-list-item-subtitle class="text-wrap">{{
                    sk.reason
                  }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
            </div>
          </template>

          <v-alert
            v-else-if="errorResult"
            type="error"
            variant="tonal"
            density="compact"
          >
            <strong>{{ t("knowledge.website_import_failed") }}</strong> —
            {{ errorResult.error }}
          </v-alert>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="closeDialog">
          {{
            hasResult ? t("knowledge.website_import_close") : t("common.cancel")
          }}
        </v-btn>
        <v-btn
          v-if="successResult"
          color="primary"
          variant="outlined"
          prepend-icon="mdi-refresh"
          @click="resetForAnother"
        >
          {{ t("knowledge.website_import_another") }}
        </v-btn>
        <v-btn
          v-else
          color="primary"
          prepend-icon="mdi-download"
          :loading="importing"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{
            importing
              ? t("knowledge.website_import_importing")
              : t("knowledge.website_import_import")
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import {
  importWebsite,
  onWebsiteImportProgress,
  type WebsiteImportOptions,
} from "@/views/api/rag";
import { WEBSITE_IMPORT_LIMITS } from "@/entityTypes/knowledgeLibraryAiToolTypes";
import type {
  ImportKnowledgeWebsiteResult,
  KnowledgeLibraryToolError,
  KnowledgeLibraryWebsiteImportOutcome,
  KnowledgeLibraryWebsiteImportProgressEvent,
} from "@/entityTypes/knowledgeLibraryAiToolTypes";

type WebsiteMode = "single_page" | "url_list" | "site_crawl";
type FormText = string | null;

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "completed", outcome: ImportKnowledgeWebsiteResult): void;
}>();

const { t } = useI18n();

// ── Form state ──────────────────────────────────────────────────────────
const mode = ref<WebsiteMode>("single_page");
const url = ref<FormText>("");
const urlsText = ref<FormText>("");
const title = ref<FormText>("");
const description = ref<FormText>("");
const tagsText = ref<FormText>("");
const author = ref<FormText>("Website");
const maxPages = ref(WEBSITE_IMPORT_LIMITS.maxPages.default);
const maxDepth = ref(WEBSITE_IMPORT_LIMITS.maxDepth.default);
const duplicatePolicy = ref<"fail" | "allow">("fail");

// ── Runtime state ───────────────────────────────────────────────────────
const importing = ref(false);
const result = ref<KnowledgeLibraryWebsiteImportOutcome | null>(null);
const formError = ref("");
const currentProgress = ref<KnowledgeLibraryWebsiteImportProgressEvent | null>(
  null
);
const progressEvents = ref<KnowledgeLibraryWebsiteImportProgressEvent[]>([]);
let removeProgressListener: (() => void) | null = null;

const policyOptions = computed(() => [
  { label: t("knowledge.website_import_policy_fail"), value: "fail" },
  { label: t("knowledge.website_import_policy_allow"), value: "allow" },
]);

function textValue(value: FormText): string {
  return value ?? "";
}

function trimmedText(value: FormText): string {
  return textValue(value).trim();
}

/** URLs parsed from the textarea, one per non-empty line. */
const parsedUrls = computed(() =>
  textValue(urlsText.value)
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
);

const canSubmit = computed(() => {
  if (importing.value) return false;
  if (mode.value === "url_list") return parsedUrls.value.length > 0;
  return trimmedText(url.value).length > 0;
});

const hasResult = computed(() => result.value !== null);

const progressTitle = computed(() => {
  const phase = currentProgress.value?.phase ?? "starting";
  const key = `knowledge.website_import_progress_${phase}`;
  return t(key) || t("knowledge.website_import_importing") || "Importing...";
});

const progressCounts = computed(() => {
  const progress = currentProgress.value;
  const importedCount = progress?.importedCount ?? 0;
  const skippedCount = progress?.skippedCount ?? 0;
  return (
    t("knowledge.website_import_progress_counts", {
      imported: importedCount,
      skipped: skippedCount,
    }) || `Imported ${importedCount}, skipped ${skippedCount}`
  );
});

const progressPercent = computed((): number | undefined => {
  const progress = currentProgress.value;
  if (!progress) return undefined;
  if (progress.phase === "completed") return 100;
  const total = progress.requestedCount ?? progress.maxPages;
  const processed = progress.processedPages;
  if (!total || !processed) return undefined;
  return Math.min(100, Math.round((processed / total) * 100));
});

/** Narrowed success outcome for template rendering (null when no success). */
const successResult = computed((): ImportKnowledgeWebsiteResult | null =>
  result.value && result.value.success ? result.value : null
);

/** Narrowed error outcome for template rendering (null when no error). */
const errorResult = computed((): KnowledgeLibraryToolError | null =>
  result.value && !result.value.success ? result.value : null
);

// Reset transient state whenever the dialog is (re)opened.
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      result.value = null;
      formError.value = "";
      currentProgress.value = null;
      progressEvents.value = [];
    }
  }
);

function parseTags(): string[] {
  return textValue(tagsText.value)
    .split(",")
    .map((tg) => tg.trim())
    .filter((tg) => tg.length > 0);
}

function onModeChange(): void {
  // Clear any stale validation/result when switching modes.
  formError.value = "";
  result.value = null;
  currentProgress.value = null;
  progressEvents.value = [];
}

function stopProgressListener(): void {
  if (removeProgressListener) {
    removeProgressListener();
    removeProgressListener = null;
  }
}

function startProgressListener(): void {
  stopProgressListener();
  currentProgress.value = null;
  progressEvents.value = [];
  removeProgressListener = onWebsiteImportProgress((event) => {
    currentProgress.value = event;
    progressEvents.value = [event, ...progressEvents.value].slice(0, 8);
  });
}

async function submit(): Promise<void> {
  if (importing.value) return; // guard against double-submit while in-flight
  formError.value = "";

  if (mode.value !== "url_list") {
    if (!trimmedText(url.value)) {
      formError.value = t("knowledge.website_import_url_required");
      return;
    }
  } else if (parsedUrls.value.length === 0) {
    formError.value = t("knowledge.website_import_urls_required");
    return;
  }

  // Client-side cap so the user gets immediate feedback instead of a backend
  // INVALID_INPUT rejection after the IPC round-trip.
  if (
    mode.value === "url_list" &&
    parsedUrls.value.length > WEBSITE_IMPORT_LIMITS.maxUrls
  ) {
    formError.value = t("knowledge.website_import_too_many_urls", {
      max: WEBSITE_IMPORT_LIMITS.maxUrls,
    });
    return;
  }

  const options: WebsiteImportOptions = {
    mode: mode.value,
    duplicatePolicy: duplicatePolicy.value,
    tags: parseTags(),
    description: trimmedText(description.value) || undefined,
    author: trimmedText(author.value) || undefined,
  };

  if (mode.value === "single_page") {
    options.url = trimmedText(url.value);
    const trimmedTitle = trimmedText(title.value);
    if (trimmedTitle) options.title = trimmedTitle;
  } else if (mode.value === "url_list") {
    options.urls = parsedUrls.value;
    options.maxPages = maxPages.value;
  } else {
    options.url = trimmedText(url.value);
    options.maxPages = maxPages.value;
    options.maxDepth = maxDepth.value;
  }

  importing.value = true;
  result.value = null;
  startProgressListener();
  try {
    const outcome = await importWebsite(options);
    result.value = outcome;
    if (outcome.success) {
      emit("completed", outcome);
    }
  } catch (err) {
    // windowInvoke throws on an IPC-level failure (e.g. boundary validation).
    formError.value = err instanceof Error ? err.message : String(err);
  } finally {
    importing.value = false;
    stopProgressListener();
  }
}

function closeDialog(): void {
  stopProgressListener();
  emit("update:modelValue", false);
}

function resetForAnother(): void {
  result.value = null;
  formError.value = "";
  currentProgress.value = null;
  progressEvents.value = [];
  url.value = "";
  urlsText.value = "";
  title.value = "";
}

onBeforeUnmount(() => {
  stopProgressListener();
});

// Exposed for component testing (drive submit() + assert state). No parent
// references the dialog via ref, so this has no production-visible effect.
defineExpose({
  submit,
  mode,
  url,
  urlsText,
  duplicatePolicy,
  formError,
  importing,
  currentProgress,
  progressEvents,
});
</script>

<style scoped>
.mode-btn {
  text-transform: none;
}

.result-list {
  max-height: 240px;
  overflow-y: auto;
}

.progress-header {
  gap: 12px;
}

.progress-url {
  word-break: break-word;
}
</style>
