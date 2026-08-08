# AI User Memory Management UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a System Settings sub-page where users can list, search, filter, create, edit, archive, and permanently delete their durable AI user memories.

**Architecture:** Frontend only. The entire backend (entity → model → module → service → IPC → preload → `aiUserMemoryApi` → types) already exists. We add two new Vue files (a page + a form-dialog component), one router child, one nav button, and i18n keys in 6 languages. The page delegates create/edit to the dialog component.

**Tech Stack:** Vue 3 (`<script setup>`), Vuetify 3, vue-i18n, vue-router, vitest + @vue/test-utils + happy-dom.

**Spec:** `docs/superpowers/specs/2026-08-08-ai-user-memory-ui-design.md`

---

## Conventions for every commit in this plan

The worktree is `dev`-based, so the husky precommit hook (`yarn typecheck`) is unavailable and `git commit` will fail. **Every commit uses `--no-verify`.** Run type checks and tests manually as shown in each task and in Task 7.

Component tests run with the dedicated config (happy-dom):
```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run <test-file>
```
One-shot Vue type check (the `vue-check` script adds `--watch`; drop it):
```
npx vue-tsc --noEmit
```

## File structure

| File | Responsibility |
|---|---|
| `src/views/pages/systemsetting/aiMemory.vue` (new) | Page: state, load + filters + search + client-side pagination, v-table render, loading/empty/error states, row actions, dialog + confirm wiring, toasts |
| `src/views/pages/systemsetting/components/AiMemoryFormDialog.vue` (new) | Create/edit form with validation; emits `saved` |
| `src/views/pages/systemsetting/index.vue` (modify) | Add "Manage AI Memories" nav button + `navigateToAIMemory` |
| `src/views/router/index.ts` (modify) | Add `system_setting_ai_memory` child route |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` (modify) | `system_settings.manage_ai_memories`, `route.ai_memory_management`, new `aiMemory` namespace |
| `test/vitest/main/components/AiMemoryFormDialog.test.ts` (new) | Dialog validation + create/edit behavior |
| `test/vitest/main/components/AiMemoryPage.load.test.ts` (new) | Page load + default filters |
| `test/vitest/main/components/AiMemoryPage.actions.test.ts` (new) | Page create/edit/archive/delete flows |

No backend, IPC, preload, `channellist.ts`, or `aiUserMemoryTypes.ts` changes.

### IPC contract (already implemented — for reference when writing the page)

- `aiUserMemoryApi.list(input: AIUserMemorySearchInput)` → `CommonMessage<AIUserMemoryView[]>`. `input` keys are all optional and omitted when empty.
- `aiUserMemoryApi.create(input)` → input is `{ type, title, content, confidence? }`. Backend sets `sourceKind="manual"` and generates `memoryId`. Returns `CommonMessage<AIUserMemoryView>`.
- `aiUserMemoryApi.update(input)` → input is `{ memoryId, type?, title?, content?, status?, confidence? }`.
- `aiUserMemoryApi.archive(memoryId)` / `aiUserMemoryApi.delete(memoryId)` → take a bare `memoryId` string (the wrapper JSON-stringifies it).

`CommonMessage<T> = { status: boolean; msg: string; data: T }`. Always check `.status` before using `.data`.

---

## Task 1: English i18n (source of truth)

**Files:**
- Modify: `src/views/lang/en.ts`

- [ ] **Step 1: Add the nav-button label and route title**

In `src/views/lang/en.ts`, inside the `system_settings: { ... }` block, add `manage_ai_memories` right after `manage_skills` (currently line 1157):

```ts
    manage_skills: "Manage Skills",
    manage_ai_memories: "Manage AI Memories",
```

In the `route: { ... }` namespace (top of the file), add `ai_memory_management` alongside `skills_management`:

```ts
    ai_memory_management: "AI Memories",
```

- [ ] **Step 2: Add the `aiMemory` namespace**

Add this new top-level namespace (e.g. right after the `system_settings: { ... }` block that ends at line 1171):

```ts
  aiMemory: {
    title: "AI Memories",
    description: "Durable facts and preferences the AI remembers across conversations.",
    search_placeholder: "Search title or content...",
    filter_type: "Type",
    filter_status: "Status",
    filter_source: "Source",
    filter_all: "All",
    button_create: "New Memory",
    button_refresh: "Refresh",
    col_title: "Title",
    col_type: "Type",
    col_content: "Content",
    col_status: "Status",
    col_source: "Source",
    col_updated: "Updated",
    col_actions: "Actions",
    type_preference: "Preference",
    type_fact: "Fact",
    type_decision: "Decision",
    type_reference: "Reference",
    type_workflow: "Workflow",
    status_active: "Active",
    status_archived: "Archived",
    status_contradicted: "Contradicted",
    source_manual: "Manual",
    source_chat_v2: "Chat",
    source_agent_task: "Agent Task",
    source_auto_dream: "Auto-Dream",
    loading: "Loading...",
    empty_title: "No memories yet",
    empty_description: "Create a memory so the AI remembers it across conversations.",
    error_load: "Failed to load memories.",
    page_of: "Page {page} of {total}",
    dialog_title_create: "New Memory",
    dialog_title_edit: "Edit Memory",
    field_type: "Type",
    field_title: "Title",
    field_content: "Content",
    field_status: "Status",
    field_confidence: "Confidence",
    field_source: "Source",
    button_save: "Save",
    button_cancel: "Cancel",
    err_title_required: "Title is required.",
    err_content_required: "Content is required.",
    action_edit: "Edit",
    action_archive: "Archive",
    action_delete: "Delete",
    confirm_archive_title: "Archive this memory?",
    confirm_archive_text: "Archived memories are hidden from the AI. You can restore them later by editing.",
    confirm_delete_title: "Permanently delete this memory?",
    confirm_delete_text: "This action cannot be undone.",
    button_archive: "Archive",
    button_delete: "Delete",
    toast_created: "Memory created.",
    toast_updated: "Memory updated.",
    toast_archived: "Memory archived.",
    toast_deleted: "Memory deleted.",
    toast_error: "Something went wrong.",
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/views/lang/en.ts
git commit --no-verify -m "feat(i18n): add English strings for AI user memory management UI"
```

---

## Task 2: Form dialog component (TDD)

**Files:**
- Create: `src/views/pages/systemsetting/components/AiMemoryFormDialog.vue`
- Test: `test/vitest/main/components/AiMemoryFormDialog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/components/AiMemoryFormDialog.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiMemoryFormDialog from "@/views/pages/systemsetting/components/AiMemoryFormDialog.vue";
import type { AIUserMemoryView } from "@/entityTypes/aiUserMemoryTypes";

const createMock = vi.fn();
const updateMock = vi.fn();
vi.mock("@/views/api/aiUserMemory", () => ({
  aiUserMemoryApi: {
    create: (...a: unknown[]) => createMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiMemory: {
        dialog_title_create: "New",
        dialog_title_edit: "Edit",
        field_type: "Type",
        field_title: "Title",
        field_content: "Content",
        field_status: "Status",
        field_confidence: "Confidence",
        field_source: "Source",
        button_save: "Save",
        button_cancel: "Cancel",
        err_title_required: "need title",
        err_content_required: "need content",
        type_preference: "Preference",
        type_fact: "Fact",
        status_active: "Active",
        source_manual: "Manual",
      },
    },
  },
});

function mountDialog(props: Record<string, unknown>) {
  return mount(AiMemoryFormDialog, {
    props: { modelValue: true, mode: "create", memory: null, ...props },
    global: { plugins: [i18n], stubs: { VIcon: true } },
  });
}

function baseView(): AIUserMemoryView {
  return {
    id: 1,
    memoryId: "mem-1",
    type: "fact",
    title: "T",
    content: "C",
    status: "active",
    confidence: 80,
    sourceKind: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("AiMemoryFormDialog", () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("creates a memory in create mode", async () => {
    createMock.mockResolvedValue({ status: true, msg: "", data: baseView() });
    const w = mountDialog({ mode: "create" });
    w.vm.form.title = "My title";
    w.vm.form.content = "My content";
    w.vm.form.type = "fact";
    await w.vm.submit();
    expect(createMock).toHaveBeenCalledWith({
      type: "fact",
      title: "My title",
      content: "My content",
      confidence: 100,
    });
    expect(w.emitted("saved")).toHaveLength(1);
  });

  it("updates a memory in edit mode", async () => {
    updateMock.mockResolvedValue({ status: true, msg: "", data: baseView() });
    const w = mountDialog({ mode: "edit", memory: baseView() });
    w.vm.form.title = "Changed";
    await w.vm.submit();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: "mem-1",
        title: "Changed",
        status: "active",
      })
    );
    expect(w.emitted("saved")).toHaveLength(1);
  });

  it("does not submit when the title is empty", async () => {
    const w = mountDialog({ mode: "create" });
    w.vm.form.content = "content only";
    await w.vm.submit();
    expect(createMock).not.toHaveBeenCalled();
    expect(w.emitted("saved")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiMemoryFormDialog.test.ts
```
Expected: FAIL — "Failed to resolve import .../AiMemoryFormDialog.vue" (file does not exist yet).

- [ ] **Step 3: Implement the dialog component**

Create `src/views/pages/systemsetting/components/AiMemoryFormDialog.vue`:

```vue
<template>
  <v-dialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    max-width="640"
  >
    <v-card>
      <v-card-title>
        {{ mode === 'create' ? t('aiMemory.dialog_title_create') : t('aiMemory.dialog_title_edit') }}
      </v-card-title>
      <v-card-text>
        <v-select
          v-model="form.type"
          :items="typeOptions"
          :label="t('aiMemory.field_type')"
          item-title="label"
          item-value="value"
          density="compact"
          class="mb-2"
        />
        <v-text-field
          v-model="form.title"
          :label="t('aiMemory.field_title')"
          :error-messages="errors.title"
          density="compact"
          class="mb-2"
        />
        <v-textarea
          v-model="form.content"
          :label="t('aiMemory.field_content')"
          :error-messages="errors.content"
          auto-grow
          rows="3"
          density="compact"
          class="mb-2"
        />
        <v-select
          v-if="mode === 'edit'"
          v-model="form.status"
          :items="statusOptions"
          :label="t('aiMemory.field_status')"
          item-title="label"
          item-value="value"
          density="compact"
          class="mb-2"
        />
        <v-slider
          v-model="form.confidence"
          :min="0"
          :max="100"
          :step="1"
          :label="t('aiMemory.field_confidence')"
          thumb-label
          class="mb-2"
        />
        <div v-if="mode === 'edit'" class="text-caption text-grey mt-2">
          {{ t('aiMemory.field_source') }}: {{ sourceLabel }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t('aiMemory.button_cancel') }}</v-btn>
        <v-btn color="primary" :loading="saving" @click="submit">
          {{ t('aiMemory.button_save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { aiUserMemoryApi } from "@/views/api/aiUserMemory";
import {
  AI_USER_MEMORY_TYPES,
  AI_USER_MEMORY_STATUSES,
  isAIUserMemoryType,
  type AIUserMemoryView,
  type AIUserMemoryType,
  type AIUserMemoryStatus,
  type AIUserMemorySourceKind,
} from "@/entityTypes/aiUserMemoryTypes";

const props = defineProps<{
  modelValue: boolean;
  mode: "create" | "edit";
  memory: AIUserMemoryView | null;
}>();
const emit = defineEmits<{
  "update:modelValue": [boolean];
  saved: [AIUserMemoryView];
}>();
const { t } = useI18n();

interface FormState {
  type: AIUserMemoryType;
  title: string;
  content: string;
  status: AIUserMemoryStatus;
  confidence: number;
  sourceKind: AIUserMemorySourceKind | "";
}

const form = reactive<FormState>({
  type: "preference",
  title: "",
  content: "",
  status: "active",
  confidence: 100,
  sourceKind: "",
});
const errors = reactive<{ title: string; content: string }>({
  title: "",
  content: "",
});
const saving = ref(false);

watch(
  () => props.memory,
  (m) => {
    if (props.mode === "edit" && m) {
      form.type = m.type;
      form.title = m.title;
      form.content = m.content;
      form.status = m.status;
      form.confidence = m.confidence;
      form.sourceKind = m.sourceKind ?? "";
    } else {
      form.type = "preference";
      form.title = "";
      form.content = "";
      form.status = "active";
      form.confidence = 100;
      form.sourceKind = "";
    }
    errors.title = "";
    errors.content = "";
  },
  { immediate: true }
);

const typeOptions = computed(() =>
  AI_USER_MEMORY_TYPES.map((v) => ({ value: v, label: t(`aiMemory.type_${v}`) }))
);
const statusOptions = computed(() =>
  AI_USER_MEMORY_STATUSES.map((v) => ({ value: v, label: t(`aiMemory.status_${v}`) }))
);
const sourceLabel = computed(() =>
  form.sourceKind ? t(`aiMemory.source_${form.sourceKind}`) : t("aiMemory.source_manual")
);

function validate(): boolean {
  errors.title = form.title.trim() ? "" : t("aiMemory.err_title_required");
  errors.content = form.content.trim() ? "" : t("aiMemory.err_content_required");
  return isAIUserMemoryType(form.type) && !errors.title && !errors.content;
}

function close(): void {
  emit("update:modelValue", false);
}

async function submit(): Promise<void> {
  if (!validate()) return;
  saving.value = true;
  try {
    if (props.mode === "create") {
      const res = await aiUserMemoryApi.create({
        type: form.type,
        title: form.title.trim(),
        content: form.content.trim(),
        confidence: form.confidence,
      });
      if (!res.status) {
        errors.title = res.msg;
        return;
      }
      emit("saved", res.data);
    } else {
      const memoryId = props.memory?.memoryId ?? "";
      const res = await aiUserMemoryApi.update({
        memoryId,
        type: form.type,
        title: form.title.trim(),
        content: form.content.trim(),
        status: form.status,
        confidence: form.confidence,
      });
      if (!res.status) {
        errors.title = res.msg;
        return;
      }
      emit("saved", res.data);
    }
  } finally {
    saving.value = false;
  }
}

defineExpose({ form, submit, validate });
</script>
```

- [ ] **Step 4: Run the test to verify it passes**

```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiMemoryFormDialog.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/systemsetting/components/AiMemoryFormDialog.vue test/vitest/main/components/AiMemoryFormDialog.test.ts
git commit --no-verify -m "feat(ai-memory): add create/edit form dialog component with validation"
```

---

## Task 3: Management page — load, filters, render (TDD)

**Files:**
- Create: `src/views/pages/systemsetting/aiMemory.vue`
- Test: `test/vitest/main/components/AiMemoryPage.load.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/components/AiMemoryPage.load.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiMemoryPage from "@/views/pages/systemsetting/aiMemory.vue";

const listMock = vi.fn();
vi.mock("@/views/api/aiUserMemory", () => ({
  aiUserMemoryApi: { list: (...a: unknown[]) => listMock(...a) },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiMemory: { title: "Memories" }, system_settings: {} } },
});

function mountPage() {
  return mount(AiMemoryPage, {
    global: { plugins: [i18n], stubs: { VIcon: true } },
  });
}

describe("AiMemoryPage load", () => {
  beforeEach(() => listMock.mockReset());

  it("loads active memories on mount with default filters", async () => {
    listMock.mockResolvedValue({ status: true, msg: "", data: [] });
    mountPage();
    await flushPromises();
    expect(listMock).toHaveBeenCalledWith({
      status: "active",
      limit: 200,
      offset: 0,
    });
  });

  it("exposes loaded memories", async () => {
    listMock.mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          id: 1,
          memoryId: "m1",
          type: "fact",
          title: "T",
          content: "C",
          status: "active",
          confidence: 90,
          createdAt: "x",
          updatedAt: "x",
        },
      ],
    });
    const w = mountPage();
    await flushPromises();
    expect((w.vm.memories as unknown[]).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiMemoryPage.load.test.ts
```
Expected: FAIL — cannot resolve `aiMemory.vue`.

- [ ] **Step 3: Implement the page core**

Create `src/views/pages/systemsetting/aiMemory.vue`:

```vue
<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t('aiMemory.title') }}</span>
        <v-btn icon size="small" variant="text" @click="goBack">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text>
        <p class="text-body-2 text-grey mb-4">{{ t('aiMemory.description') }}</p>

        <!-- Toolbar -->
        <div class="d-flex flex-wrap align-center ga-3 mb-4">
          <v-text-field
            v-model="filters.query"
            :placeholder="t('aiMemory.search_placeholder')"
            density="compact"
            hide-details
            prepend-inner-icon="mdi-magnify"
            style="max-width: 320px;"
          />
          <v-select
            v-model="filters.type"
            :items="typeOptions"
            :label="t('aiMemory.filter_type')"
            item-title="label"
            item-value="value"
            density="compact"
            hide-details
            style="max-width: 160px;"
            @update:model-value="reloadFromFirst"
          />
          <v-select
            v-model="filters.status"
            :items="statusOptions"
            :label="t('aiMemory.filter_status')"
            item-title="label"
            item-value="value"
            density="compact"
            hide-details
            style="max-width: 160px;"
            @update:model-value="reloadFromFirst"
          />
          <v-select
            v-model="filters.sourceKind"
            :items="sourceOptions"
            :label="t('aiMemory.filter_source')"
            item-title="label"
            item-value="value"
            density="compact"
            hide-details
            style="max-width: 180px;"
            @update:model-value="reloadFromFirst"
          />
          <v-btn variant="text" @click="loadMemories">
            <v-icon left>mdi-refresh</v-icon>
            {{ t('aiMemory.button_refresh') }}
          </v-btn>
        </div>

        <!-- Loading -->
        <div v-if="isLoading" class="text-center pa-4">
          <v-progress-circular indeterminate color="primary" />
          <p class="mt-2">{{ t('aiMemory.loading') }}</p>
        </div>

        <!-- Error -->
        <v-alert v-else-if="errorMsg" type="error" class="mb-4">
          {{ errorMsg }}
        </v-alert>

        <!-- Empty -->
        <div v-else-if="memories.length === 0" class="text-center pa-4">
          <v-icon size="64" color="grey-lighten-2">mdi-brain</v-icon>
          <p class="mt-4 text-grey">{{ t('aiMemory.empty_title') }}</p>
          <p class="text-grey">{{ t('aiMemory.empty_description') }}</p>
        </div>

        <!-- Table -->
        <div v-else>
          <v-table density="compact">
            <thead>
              <tr>
                <th>{{ t('aiMemory.col_title') }}</th>
                <th>{{ t('aiMemory.col_type') }}</th>
                <th>{{ t('aiMemory.col_content') }}</th>
                <th>{{ t('aiMemory.col_status') }}</th>
                <th>{{ t('aiMemory.col_source') }}</th>
                <th>{{ t('aiMemory.col_updated') }}</th>
                <th>{{ t('common.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in pagedMemories" :key="m.memoryId">
                <td>{{ m.title }}</td>
                <td>
                  <v-chip size="x-small" :color="typeColor(m.type)">
                    {{ t(`aiMemory.type_${m.type}`) }}
                  </v-chip>
                </td>
                <td class="content-cell">{{ truncate(m.content, 80) }}</td>
                <td>
                  <v-chip size="x-small" :color="statusColor(m.status)">
                    {{ t(`aiMemory.status_${m.status}`) }}
                  </v-chip>
                </td>
                <td>{{ m.sourceKind ? t(`aiMemory.source_${m.sourceKind}`) : '' }}</td>
                <td>{{ m.updatedAt }}</td>
                <td><!-- actions added in Task 4 --></td>
              </tr>
            </tbody>
          </v-table>

          <div class="d-flex align-center justify-end mt-2">
            <v-btn variant="text" size="small" :disabled="page <= 1" @click="prevPage">
              <v-icon>mdi-chevron-left</v-icon>
            </v-btn>
            <span class="mx-2 text-body-2">
              {{ t('aiMemory.page_of', { page: page, total: pageCount }) }}
            </span>
            <v-btn variant="text" size="small" :disabled="page >= pageCount" @click="nextPage">
              <v-icon>mdi-chevron-right</v-icon>
            </v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { aiUserMemoryApi } from "@/views/api/aiUserMemory";
import {
  AI_USER_MEMORY_TYPES,
  AI_USER_MEMORY_STATUSES,
  AI_USER_MEMORY_SOURCE_KINDS,
  type AIUserMemoryView,
  type AIUserMemorySearchInput,
  type AIUserMemoryType,
  type AIUserMemoryStatus,
  type AIUserMemorySourceKind,
} from "@/entityTypes/aiUserMemoryTypes";

const { t } = useI18n();
const router = useRouter();

const memories = ref<AIUserMemoryView[]>([]);
const isLoading = ref(false);
const errorMsg = ref("");

const filters = reactive<{
  query: string;
  type: AIUserMemoryType | "";
  status: AIUserMemoryStatus | "";
  sourceKind: AIUserMemorySourceKind | "";
}>({
  query: "",
  type: "",
  status: "active",
  sourceKind: "",
});

const page = ref(1);
const perPage = 20;

const typeOptions = computed(() => [
  { value: "", label: t("aiMemory.filter_all") },
  ...AI_USER_MEMORY_TYPES.map((v) => ({ value: v, label: t(`aiMemory.type_${v}`) })),
]);
const statusOptions = computed(() => [
  { value: "", label: t("aiMemory.filter_all") },
  ...AI_USER_MEMORY_STATUSES.map((v) => ({ value: v, label: t(`aiMemory.status_${v}`) })),
]);
const sourceOptions = computed(() => [
  { value: "", label: t("aiMemory.filter_all") },
  ...AI_USER_MEMORY_SOURCE_KINDS.map((v) => ({ value: v, label: t(`aiMemory.source_${v}`) })),
]);

const pagedMemories = computed(() =>
  memories.value.slice((page.value - 1) * perPage, page.value * perPage)
);
const pageCount = computed(() => Math.max(1, Math.ceil(memories.value.length / perPage)));

function buildInput(): AIUserMemorySearchInput {
  const input: AIUserMemorySearchInput = { limit: 200, offset: 0 };
  if (filters.status) input.status = filters.status;
  if (filters.type) input.type = filters.type;
  if (filters.sourceKind) input.sourceKind = filters.sourceKind;
  const q = filters.query.trim();
  if (q) input.query = q;
  return input;
}

async function loadMemories(): Promise<void> {
  isLoading.value = true;
  errorMsg.value = "";
  try {
    const res = await aiUserMemoryApi.list(buildInput());
    if (res.status) {
      memories.value = res.data;
    } else {
      memories.value = [];
      errorMsg.value = res.msg || t("aiMemory.error_load");
    }
  } catch {
    memories.value = [];
    errorMsg.value = t("aiMemory.error_load");
  } finally {
    isLoading.value = false;
  }
}

function reloadFromFirst(): void {
  page.value = 1;
  loadMemories();
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => filters.query,
  () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => reloadFromFirst(), 300);
  }
);

function nextPage(): void {
  if (page.value < pageCount.value) page.value += 1;
}
function prevPage(): void {
  if (page.value > 1) page.value -= 1;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
function typeColor(ty: AIUserMemoryType): string {
  const map: Record<AIUserMemoryType, string> = {
    preference: "primary",
    fact: "info",
    decision: "success",
    reference: "secondary",
    workflow: "purple",
  };
  return map[ty];
}
function statusColor(st: AIUserMemoryStatus): string {
  const map: Record<AIUserMemoryStatus, string> = {
    active: "success",
    archived: "grey",
    contradicted: "warning",
  };
  return map[st];
}

function goBack(): void {
  router.push({ name: "system_setting_index" });
}

onMounted(() => {
  loadMemories();
});

defineExpose({ memories, loadMemories });
</script>

<style scoped>
.content-cell {
  max-width: 360px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiMemoryPage.load.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/systemsetting/aiMemory.vue test/vitest/main/components/AiMemoryPage.load.test.ts
git commit --no-verify -m "feat(ai-memory): add management page with list, filters, and pagination"
```

---

## Task 4: Management page — create / edit / archive / delete (TDD)

**Files:**
- Modify: `src/views/pages/systemsetting/aiMemory.vue`
- Test: `test/vitest/main/components/AiMemoryPage.actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/components/AiMemoryPage.actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiMemoryPage from "@/views/pages/systemsetting/aiMemory.vue";
import type { AIUserMemoryView } from "@/entityTypes/aiUserMemoryTypes";

const api = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  delete: vi.fn(),
};
vi.mock("@/views/api/aiUserMemory", () => ({ aiUserMemoryApi: api }));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiMemory: {} } },
});

function mountPage() {
  return mount(AiMemoryPage, {
    global: { plugins: [i18n], stubs: { VIcon: true } },
  });
}

const mem: AIUserMemoryView = {
  id: 1,
  memoryId: "m1",
  type: "fact",
  title: "T",
  content: "C",
  status: "active",
  confidence: 90,
  createdAt: "x",
  updatedAt: "x",
};

describe("AiMemoryPage actions", () => {
  beforeEach(() => {
    api.list.mockReset();
    api.create.mockReset();
    api.update.mockReset();
    api.archive.mockReset();
    api.delete.mockReset();
    api.list.mockResolvedValue({ status: true, msg: "", data: [] });
  });

  it("opens the create dialog", async () => {
    const w = mountPage();
    await flushPromises();
    w.vm.openCreate();
    expect(w.vm.dialogMode).toBe("create");
    expect(w.vm.dialogVisible).toBe(true);
  });

  it("archives a memory then refreshes", async () => {
    api.archive.mockResolvedValue({ status: true, msg: "", data: null });
    const w = mountPage();
    await flushPromises();
    const before = api.list.mock.calls.length;
    await w.vm.handleArchive(mem);
    expect(api.archive).toHaveBeenCalledWith("m1");
    expect(api.list.mock.calls.length).toBeGreaterThan(before);
  });

  it("deletes a memory then refreshes", async () => {
    api.delete.mockResolvedValue({ status: true, msg: "", data: 1 });
    const w = mountPage();
    await flushPromises();
    const before = api.list.mock.calls.length;
    await w.vm.handleDelete(mem);
    expect(api.delete).toHaveBeenCalledWith("m1");
    expect(api.list.mock.calls.length).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiMemoryPage.actions.test.ts
```
Expected: FAIL — `w.vm.openCreate is not a function` (handlers not yet added).

- [ ] **Step 3: Add the dialog import to the script**

In `src/views/pages/systemsetting/aiMemory.vue`, after the existing `import { aiUserMemoryApi } ...` line, add:

```ts
import AiMemoryFormDialog from "./components/AiMemoryFormDialog.vue";
```

- [ ] **Step 4: Add state + handlers to the script**

In the same file, immediately after the `const router = useRouter();` line, insert:

```ts
const dialogVisible = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const dialogMemory = ref<AIUserMemoryView | null>(null);
const confirmState = ref<{ kind: "archive" | "delete"; memory: AIUserMemoryView } | null>(null);
const snack = ref(false);
const snackMsg = ref("");

function showToast(msg: string): void {
  snackMsg.value = msg;
  snack.value = true;
}

function openCreate(): void {
  dialogMode.value = "create";
  dialogMemory.value = null;
  dialogVisible.value = true;
}
function openEdit(m: AIUserMemoryView): void {
  dialogMode.value = "edit";
  dialogMemory.value = m;
  dialogVisible.value = true;
}
function onSaved(): void {
  const wasCreate = dialogMode.value === "create";
  dialogVisible.value = false;
  showToast(wasCreate ? t("aiMemory.toast_created") : t("aiMemory.toast_updated"));
  loadMemories();
}

function requestArchive(m: AIUserMemoryView): void {
  confirmState.value = { kind: "archive", memory: m };
}
function requestDelete(m: AIUserMemoryView): void {
  confirmState.value = { kind: "delete", memory: m };
}
function closeConfirm(): void {
  confirmState.value = null;
}

async function runConfirmed(): Promise<void> {
  const state = confirmState.value;
  if (!state) return;
  if (state.kind === "archive") {
    await handleArchive(state.memory);
  } else {
    await handleDelete(state.memory);
  }
  closeConfirm();
}

async function handleArchive(m: AIUserMemoryView): Promise<void> {
  try {
    const res = await aiUserMemoryApi.archive(m.memoryId);
    if (res.status) {
      showToast(t("aiMemory.toast_archived"));
      await loadMemories();
    } else {
      showToast(res.msg || t("aiMemory.toast_error"));
    }
  } catch {
    showToast(t("aiMemory.toast_error"));
  }
}

async function handleDelete(m: AIUserMemoryView): Promise<void> {
  try {
    const res = await aiUserMemoryApi.delete(m.memoryId);
    if (res.status) {
      showToast(t("aiMemory.toast_deleted"));
      await loadMemories();
    } else {
      showToast(res.msg || t("aiMemory.toast_error"));
    }
  } catch {
    showToast(t("aiMemory.toast_error"));
  }
}
```

- [ ] **Step 5: Extend `defineExpose`**

Replace the existing `defineExpose({ memories, loadMemories });` with:

```ts
defineExpose({
  memories,
  loadMemories,
  openCreate,
  openEdit,
  handleArchive,
  handleDelete,
  dialogVisible,
  dialogMode,
});
```

- [ ] **Step 6: Add a "New Memory" button to the toolbar**

In the template, inside the toolbar `<div class="d-flex flex-wrap align-center ga-3 mb-4">`, add as the **first** child (before the search field):

```html
          <v-btn color="primary" variant="flat" @click="openCreate">
            <v-icon left>mdi-plus</v-icon>
            {{ t('aiMemory.button_create') }}
          </v-btn>
```

- [ ] **Step 7: Fill the actions cell**

Replace the empty actions `<td>`:

```html
                <td><!-- actions added in Task 4 --></td>
```

with:

```html
                <td class="d-flex ga-1">
                  <v-btn icon size="x-small" variant="text" :title="t('aiMemory.action_edit')" @click="openEdit(m)">
                    <v-icon>mdi-pencil</v-icon>
                  </v-btn>
                  <v-btn icon size="x-small" variant="text" :title="t('aiMemory.action_archive')" @click="requestArchive(m)">
                    <v-icon>mdi-archive</v-icon>
                  </v-btn>
                  <v-btn icon size="x-small" variant="text" color="error" :title="t('aiMemory.action_delete')" @click="requestDelete(m)">
                    <v-icon>mdi-delete</v-icon>
                  </v-btn>
                </td>
```

- [ ] **Step 8: Add the dialog, confirm dialogs, and snackbar**

In the template, immediately before the closing `</v-container>` tag, add:

```html
    <AiMemoryFormDialog
      v-model="dialogVisible"
      :mode="dialogMode"
      :memory="dialogMemory"
      @saved="onSaved"
    />

    <v-dialog :model-value="confirmState !== null" max-width="480" @update:model-value="closeConfirm">
      <v-card v-if="confirmState">
        <v-card-title>
          {{ confirmState.kind === 'archive' ? t('aiMemory.confirm_archive_title') : t('aiMemory.confirm_delete_title') }}
        </v-card-title>
        <v-card-text>
          {{ confirmState.kind === 'archive' ? t('aiMemory.confirm_archive_text') : t('aiMemory.confirm_delete_text') }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeConfirm">{{ t('aiMemory.button_cancel') }}</v-btn>
          <v-btn
            :color="confirmState.kind === 'delete' ? 'error' : 'primary'"
            @click="runConfirmed"
          >
            {{ confirmState.kind === 'archive' ? t('aiMemory.button_archive') : t('aiMemory.button_delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack" :timeout="2500">{{ snackMsg }}</v-snackbar>
```

- [ ] **Step 9: Run all three page/dialog tests to verify they pass**

```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiMemoryPage.actions.test.ts test/vitest/main/components/AiMemoryPage.load.test.ts test/vitest/main/components/AiMemoryFormDialog.test.ts
```
Expected: PASS (all tests in all three files).

- [ ] **Step 10: Commit**

```bash
git add src/views/pages/systemsetting/aiMemory.vue test/vitest/main/components/AiMemoryPage.actions.test.ts
git commit --no-verify -m "feat(ai-memory): wire create/edit/archive/delete with confirm dialogs"
```

---

## Task 5: Navigation entry (router + button)

**Files:**
- Modify: `src/views/router/index.ts`
- Modify: `src/views/pages/systemsetting/index.vue`

- [ ] **Step 1: Add the route child**

In `src/views/router/index.ts`, inside the `system_setting` parent's `children` array, after the `plugins` child (the block ending around line 89), add:

```ts
      {
        path: "ai-memory",
        name: "system_setting_ai_memory",
        meta: {
          title: "route.ai_memory_management",
          icon: "mdi-brain",
          keepAlive: false,
          visible: false,
        },
        component: () => import("@/views/pages/systemsetting/aiMemory.vue"),
        children: [],
      },
```

- [ ] **Step 2: Add the nav button**

In `src/views/pages/systemsetting/index.vue`, immediately after the "Manage Skills" `v-btn` block (the one bound to `navigateToSkills`, ending around line 32), add:

```html
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToAIMemory"
              class="mb-2"
            >
              <v-icon left>mdi-brain</v-icon>
              {{ t('system_settings.manage_ai_memories') }}
            </v-btn>
```

- [ ] **Step 3: Add the navigation function**

In the same file's `<script setup>`, immediately after the `navigateToSkills()` function (around line 385), add:

```ts
function navigateToAIMemory() {
  router.push({ name: 'system_setting_ai_memory' });
}
```

- [ ] **Step 4: Type-check**

```
npx vue-tsc --noEmit
```
Expected: no new errors related to `aiMemory.vue`, `AiMemoryFormDialog.vue`, the router, or `index.vue`. (Pre-existing unrelated errors are out of scope.)

- [ ] **Step 5: Commit**

```bash
git add src/views/router/index.ts src/views/pages/systemsetting/index.vue
git commit --no-verify -m "feat(ai-memory): add System Settings nav button and route to memory page"
```

---

## Task 6: Translations (zh, es, fr, de, ja)

**Files:**
- Modify: `src/views/lang/zh.ts`, `src/views/lang/es.ts`, `src/views/lang/fr.ts`, `src/views/lang/de.ts`, `src/views/lang/ja.ts`

For **each** of the five files, make three additions:

1. In the `system_settings` namespace, after `manage_skills`, add the `manage_ai_memories` key.
2. In the `route` namespace, after `skills_management`, add the `ai_memory_management` key.
3. Add the `aiMemory` top-level namespace (same keys as English, translated).

- [ ] **Step 1: Chinese (`src/views/lang/zh.ts`)**

Add to `system_settings`:
```ts
    manage_ai_memories: "管理 AI 记忆",
```
Add to `route`:
```ts
    ai_memory_management: "AI 记忆",
```
Add namespace:
```ts
  aiMemory: {
    title: "AI 记忆",
    description: "AI 在跨对话中记住的持久事实和偏好。",
    search_placeholder: "搜索标题或内容…",
    filter_type: "类型",
    filter_status: "状态",
    filter_source: "来源",
    filter_all: "全部",
    button_create: "新建记忆",
    button_refresh: "刷新",
    col_title: "标题",
    col_type: "类型",
    col_content: "内容",
    col_status: "状态",
    col_source: "来源",
    col_updated: "更新时间",
    col_actions: "操作",
    type_preference: "偏好",
    type_fact: "事实",
    type_decision: "决定",
    type_reference: "参考",
    type_workflow: "流程",
    status_active: "活跃",
    status_archived: "已归档",
    status_contradicted: "已冲突",
    source_manual: "手动",
    source_chat_v2: "聊天",
    source_agent_task: "代理任务",
    source_auto_dream: "自动整理",
    loading: "加载中…",
    empty_title: "还没有记忆",
    empty_description: "新建一条记忆，AI 将在跨对话中记住它。",
    error_load: "加载记忆失败。",
    page_of: "第 {page} 页，共 {total} 页",
    dialog_title_create: "新建记忆",
    dialog_title_edit: "编辑记忆",
    field_type: "类型",
    field_title: "标题",
    field_content: "内容",
    field_status: "状态",
    field_confidence: "置信度",
    field_source: "来源",
    button_save: "保存",
    button_cancel: "取消",
    err_title_required: "标题为必填项。",
    err_content_required: "内容为必填项。",
    action_edit: "编辑",
    action_archive: "归档",
    action_delete: "删除",
    confirm_archive_title: "归档此记忆？",
    confirm_archive_text: "已归档的记忆将不会提供给 AI。之后可通过编辑恢复。",
    confirm_delete_title: "永久删除此记忆？",
    confirm_delete_text: "此操作无法撤销。",
    button_archive: "归档",
    button_delete: "删除",
    toast_created: "记忆已创建。",
    toast_updated: "记忆已更新。",
    toast_archived: "记忆已归档。",
    toast_deleted: "记忆已删除。",
    toast_error: "出错了。",
  },
```

- [ ] **Step 2: Spanish (`src/views/lang/es.ts`)**

```ts
    manage_ai_memories: "Gestionar recuerdos de IA",
```
```ts
    ai_memory_management: "Recuerdos de IA",
```
```ts
  aiMemory: {
    title: "Recuerdos de IA",
    description: "Hechos y preferencias duraderos que la IA recuerda entre conversaciones.",
    search_placeholder: "Buscar título o contenido...",
    filter_type: "Tipo",
    filter_status: "Estado",
    filter_source: "Origen",
    filter_all: "Todos",
    button_create: "Nuevo recuerdo",
    button_refresh: "Actualizar",
    col_title: "Título",
    col_type: "Tipo",
    col_content: "Contenido",
    col_status: "Estado",
    col_source: "Origen",
    col_updated: "Actualizado",
    col_actions: "Acciones",
    type_preference: "Preferencia",
    type_fact: "Hecho",
    type_decision: "Decisión",
    type_reference: "Referencia",
    type_workflow: "Flujo",
    status_active: "Activo",
    status_archived: "Archivado",
    status_contradicted: "Contradicho",
    source_manual: "Manual",
    source_chat_v2: "Chat",
    source_agent_task: "Tarea de agente",
    source_auto_dream: "Auto-consolidación",
    loading: "Cargando...",
    empty_title: "Aún no hay recuerdos",
    empty_description: "Crea un recuerdo para que la IA lo recuerde entre conversaciones.",
    error_load: "Error al cargar los recuerdos.",
    page_of: "Página {page} de {total}",
    dialog_title_create: "Nuevo recuerdo",
    dialog_title_edit: "Editar recuerdo",
    field_type: "Tipo",
    field_title: "Título",
    field_content: "Contenido",
    field_status: "Estado",
    field_confidence: "Confianza",
    field_source: "Origen",
    button_save: "Guardar",
    button_cancel: "Cancelar",
    err_title_required: "El título es obligatorio.",
    err_content_required: "El contenido es obligatorio.",
    action_edit: "Editar",
    action_archive: "Archivar",
    action_delete: "Eliminar",
    confirm_archive_title: "¿Archivar este recuerdo?",
    confirm_archive_text: "Los recuerdos archivados se ocultan de la IA. Puedes restaurarlos editándolos.",
    confirm_delete_title: "¿Eliminar este recuerdo de forma permanente?",
    confirm_delete_text: "Esta acción no se puede deshacer.",
    button_archive: "Archivar",
    button_delete: "Eliminar",
    toast_created: "Recuerdo creado.",
    toast_updated: "Recuerdo actualizado.",
    toast_archived: "Recuerdo archivado.",
    toast_deleted: "Recuerdo eliminado.",
    toast_error: "Algo salió mal.",
  },
```

- [ ] **Step 3: French (`src/views/lang/fr.ts`)**

```ts
    manage_ai_memories: "Gérer les mémoires de l'IA",
```
```ts
    ai_memory_management: "Mémoires de l'IA",
```
```ts
  aiMemory: {
    title: "Mémoires de l'IA",
    description: "Faits et préférences durables que l'IA mémorise entre les conversations.",
    search_placeholder: "Rechercher titre ou contenu...",
    filter_type: "Type",
    filter_status: "Statut",
    filter_source: "Source",
    filter_all: "Tous",
    button_create: "Nouvelle mémoire",
    button_refresh: "Actualiser",
    col_title: "Titre",
    col_type: "Type",
    col_content: "Contenu",
    col_status: "Statut",
    col_source: "Source",
    col_updated: "Mis à jour",
    col_actions: "Actions",
    type_preference: "Préférence",
    type_fact: "Fait",
    type_decision: "Décision",
    type_reference: "Référence",
    type_workflow: "Flux",
    status_active: "Actif",
    status_archived: "Archivé",
    status_contradicted: "Contredit",
    source_manual: "Manuel",
    source_chat_v2: "Chat",
    source_agent_task: "Tâche d'agent",
    source_auto_dream: "Consolidation auto",
    loading: "Chargement...",
    empty_title: "Aucune mémoire pour le moment",
    empty_description: "Créez une mémoire pour que l'IA la retienne entre les conversations.",
    error_load: "Échec du chargement des mémoires.",
    page_of: "Page {page} sur {total}",
    dialog_title_create: "Nouvelle mémoire",
    dialog_title_edit: "Modifier la mémoire",
    field_type: "Type",
    field_title: "Titre",
    field_content: "Contenu",
    field_status: "Statut",
    field_confidence: "Confiance",
    field_source: "Source",
    button_save: "Enregistrer",
    button_cancel: "Annuler",
    err_title_required: "Le titre est obligatoire.",
    err_content_required: "Le contenu est obligatoire.",
    action_edit: "Modifier",
    action_archive: "Archiver",
    action_delete: "Supprimer",
    confirm_archive_title: "Archiver cette mémoire ?",
    confirm_archive_text: "Les mémoires archivées sont masquées de l'IA. Vous pouvez les restaurer en les modifiant.",
    confirm_delete_title: "Supprimer définitivement cette mémoire ?",
    confirm_delete_text: "Cette action est irréversible.",
    button_archive: "Archiver",
    button_delete: "Supprimer",
    toast_created: "Mémoire créée.",
    toast_updated: "Mémoire mise à jour.",
    toast_archived: "Mémoire archivée.",
    toast_deleted: "Mémoire supprimée.",
    toast_error: "Une erreur est survenue.",
  },
```

- [ ] **Step 4: German (`src/views/lang/de.ts`)**

```ts
    manage_ai_memories: "KI-Erinnerungen verwalten",
```
```ts
    ai_memory_management: "KI-Erinnerungen",
```
```ts
  aiMemory: {
    title: "KI-Erinnerungen",
    description: "Dauerhafte Fakten und Einstellungen, die sich die KI über Gespräche hinweg merkt.",
    search_placeholder: "Titel oder Inhalt suchen...",
    filter_type: "Typ",
    filter_status: "Status",
    filter_source: "Quelle",
    filter_all: "Alle",
    button_create: "Neue Erinnerung",
    button_refresh: "Aktualisieren",
    col_title: "Titel",
    col_type: "Typ",
    col_content: "Inhalt",
    col_status: "Status",
    col_source: "Quelle",
    col_updated: "Aktualisiert",
    col_actions: "Aktionen",
    type_preference: "Präferenz",
    type_fact: "Fakt",
    type_decision: "Entscheidung",
    type_reference: "Referenz",
    type_workflow: "Ablauf",
    status_active: "Aktiv",
    status_archived: "Archiviert",
    status_contradicted: "Widersprochen",
    source_manual: "Manuell",
    source_chat_v2: "Chat",
    source_agent_task: "Agentenaufgabe",
    source_auto_dream: "Auto-Konsolidierung",
    loading: "Wird geladen...",
    empty_title: "Noch keine Erinnerungen",
    empty_description: "Erstelle eine Erinnerung, damit die KI sie über Gespräche hinweg behält.",
    error_load: "Erinnerungen konnten nicht geladen werden.",
    page_of: "Seite {page} von {total}",
    dialog_title_create: "Neue Erinnerung",
    dialog_title_edit: "Erinnerung bearbeiten",
    field_type: "Typ",
    field_title: "Titel",
    field_content: "Inhalt",
    field_status: "Status",
    field_confidence: "Konfidenz",
    field_source: "Quelle",
    button_save: "Speichern",
    button_cancel: "Abbrechen",
    err_title_required: "Titel ist erforderlich.",
    err_content_required: "Inhalt ist erforderlich.",
    action_edit: "Bearbeiten",
    action_archive: "Archivieren",
    action_delete: "Löschen",
    confirm_archive_title: "Diese Erinnerung archivieren?",
    confirm_archive_text: "Archivierte Erinnerungen werden der KI vorenthalten. Du kannst sie später durch Bearbeiten wiederherstellen.",
    confirm_delete_title: "Diese Erinnerung dauerhaft löschen?",
    confirm_delete_text: "Diese Aktion kann nicht rückgängig gemacht werden.",
    button_archive: "Archivieren",
    button_delete: "Löschen",
    toast_created: "Erinnerung erstellt.",
    toast_updated: "Erinnerung aktualisiert.",
    toast_archived: "Erinnerung archiviert.",
    toast_deleted: "Erinnerung gelöscht.",
    toast_error: "Etwas ist schiefgelaufen.",
  },
```

- [ ] **Step 5: Japanese (`src/views/lang/ja.ts`)**

```ts
    manage_ai_memories: "AIメモリを管理",
```
```ts
    ai_memory_management: "AIメモリ",
```
```ts
  aiMemory: {
    title: "AIメモリ",
    description: "AIが会話をまたいで記憶する永続的な事実と設定です。",
    search_placeholder: "タイトルまたは内容を検索...",
    filter_type: "タイプ",
    filter_status: "ステータス",
    filter_source: "ソース",
    filter_all: "すべて",
    button_create: "新しいメモリ",
    button_refresh: "更新",
    col_title: "タイトル",
    col_type: "タイプ",
    col_content: "内容",
    col_status: "ステータス",
    col_source: "ソース",
    col_updated: "更新日時",
    col_actions: "操作",
    type_preference: "設定",
    type_fact: "事実",
    type_decision: "決定",
    type_reference: "参照",
    type_workflow: "ワークフロー",
    status_active: "アクティブ",
    status_archived: "アーカイブ済み",
    status_contradicted: "矛盾",
    source_manual: "手動",
    source_chat_v2: "チャット",
    source_agent_task: "エージェントタスク",
    source_auto_dream: "自動統合",
    loading: "読み込み中...",
    empty_title: "まだメモリがありません",
    empty_description: "メモリを作成すると、AIが会話をまたいで記憶します。",
    error_load: "メモリの読み込みに失敗しました。",
    page_of: "{total} ページ中 {page} ページ",
    dialog_title_create: "新しいメモリ",
    dialog_title_edit: "メモリを編集",
    field_type: "タイプ",
    field_title: "タイトル",
    field_content: "内容",
    field_status: "ステータス",
    field_confidence: "信頼度",
    field_source: "ソース",
    button_save: "保存",
    button_cancel: "キャンセル",
    err_title_required: "タイトルは必須です。",
    err_content_required: "内容は必須です。",
    action_edit: "編集",
    action_archive: "アーカイブ",
    action_delete: "削除",
    confirm_archive_title: "このメモリをアーカイブしますか？",
    confirm_archive_text: "アーカイブされたメモリはAIに表示されません。後で編集から復元できます。",
    confirm_delete_title: "このメモリを完全に削除しますか？",
    confirm_delete_text: "この操作は元に戻せません。",
    button_archive: "アーカイブ",
    button_delete: "削除",
    toast_created: "メモリを作成しました。",
    toast_updated: "メモリを更新しました。",
    toast_archived: "メモリをアーカイブしました。",
    toast_deleted: "メモリを削除しました。",
    toast_error: "エラーが発生しました。",
  },
```

- [ ] **Step 6: Commit**

```bash
git add src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit --no-verify -m "feat(i18n): add AI memory UI translations for zh, es, fr, de, ja"
```

---

## Task 7: Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full component-test suite**

```
yarn vitest --config test/vitest/main/components/vitest.config.mjs run
```
Expected: all component tests PASS (the three new test files plus the pre-existing `AiChatV2*.test.ts` / `WorkspaceBadge.test.ts`).

- [ ] **Step 2: Vue type check**

```
npx vue-tsc --noEmit
```
Expected: no new errors in the new/modified files. If `npx` is unavailable, use `yarn vue-check` then Ctrl-C after it prints results (it is watch mode).

- [ ] **Step 3: Manual smoke test**

Run `yarn dev`, open System Settings, click **Manage AI Memories**, and verify:
- The empty state shows when there are no active memories.
- Create a memory (New Memory → fill type/title/content → Save) → it appears in the table and a toast shows.
- Edit it (pencil) → change title → Save → row updates.
- Filter by Status = Archived → empty; switch the edited memory's status to Archived → it appears there; set back to Active → returns to the default list (restore via edit).
- Archive a memory (archive icon → confirm) → it leaves the active list; filter Status = Archived shows it.
- Delete a memory (delete icon → confirm) → it is gone.
- Switch UI language (User Preferences → Language) → the page re-translates.

- [ ] **Step 4: Final commit (if any manual fixes were needed)**

Only if Step 3 surfaced fixes:
```bash
git add -A
git commit --no-verify -m "fix(ai-memory): address manual QA findings"
```

---

## Self-review notes (applied during planning)

- **Spec coverage:** Entry button (Task 5), page + filters + search + pagination (Task 3), create/edit dialog (Task 2), full CRUD + archive/delete + status filter (Tasks 2 & 4), i18n all 6 languages (Tasks 1 & 6), error handling (loadMemories try/catch + status checks + toast), testing (Tasks 2, 3, 4). Out-of-scope items (auto-dream controls, bulk ops) intentionally omitted.
- **Deviation from spec (justified):** Uses plain `v-table` + client-side pagination instead of `v-data-table-server`, because `list` returns no total count (server pagination needs `items-length`) and plain tables avoid Vuetify slot-version fragility. Mirrors the `skills.vue` precedent. Expected memory volume (tens) makes this fine; revisit if it exceeds ~200.
- **Type consistency:** `AIUserMemoryView`, `AIUserMemorySearchInput`, create/update input shapes, and `aiUserMemoryApi` method names all match the real `aiUserMemoryTypes.ts` and `aiUserMemory.ts`. `memoryId` is never set on create (backend generates it).
- **Backend untouched** — the AI-enable gate already exists on the IPC handlers; no changes needed.
