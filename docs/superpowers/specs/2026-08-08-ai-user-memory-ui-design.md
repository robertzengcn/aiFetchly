# AI User Memory Management UI — Design

- **Date:** 2026-08-08
- **Status:** Brainstorm-approved → pending implementation plan
- **Scope:** Frontend only (Vue 3 + Vuetify). No backend, IPC, preload, entity, or type changes.

## 1. Overview

Add a UI in System Settings that lets users view and manage their durable AI user
memories (records in the `ai_user_memories` table). Users get full CRUD: list,
search, filter, create, edit, archive, and permanently delete.

The entry point is a **left-column nav button** in System Settings that opens a
dedicated sub-page, mirroring the existing "Manage MCP Tools" and "Manage Skills"
pattern.

## 2. Context — the backend already exists

The entire data path is implemented and wired end-to-end. This feature adds the
missing UI only.

| Layer | File | Status |
|---|---|---|
| Entity | `src/entity/AIUserMemory.entity.ts` (`AIUserMemoryEntity`) | exists |
| Model | `src/model/AIUserMemory.model.ts` (`AIUserMemoryModel`) | exists |
| Module | `src/modules/AIUserMemoryModule.ts` (`AIUserMemoryModule`) | exists |
| Service | `src/service/AIUserMemoryService.ts` (`AIUserMemoryService`) | exists |
| IPC | `src/main-process/communication/ai-user-memory-ipc.ts` (7 channels) | exists |
| Preload | `src/preload.ts` (`validChannels` allowlist) | exists |
| Frontend API | `src/views/api/aiUserMemory.ts` (`aiUserMemoryApi`) | exists |
| Types | `src/entityTypes/aiUserMemoryTypes.ts` | exists |
| Channel constants | `src/config/channellist.ts:410-417` | exists |

The frontend API (`aiUserMemoryApi`) already exposes `list`, `create`, `update`,
`archive`, `delete`, `runAutoDream`, `autoDreamStatus`. It uses **Pattern B**: it
returns the full `CommonMessage<T>` envelope (`{ status, msg, data }`) and does
**not** throw — callers must check `.status`.

## 3. Decisions (from brainstorm)

1. **Entry point** — left-column nav button in System Settings → new
   `system_setting_ai_memory` sub-page. Mirrors MCP/Skills exactly; needs no hack
   to the generic settings renderer.
2. **Edit power** — full CRUD on **all** memories regardless of source kind
   (`manual`, `chat_v2`, `agent_task`, `auto_dream`). Source is shown read-only.
3. **Removal** — Archive (soft, recoverable) is the default remove action;
   permanent Delete is a second, deliberately sterner action. A Status filter
   (active / archived / contradicted) lets users find archived items to restore
   and see auto-dream–contradicted memories.

## 4. Architecture

Two new Vue files + one router entry + one nav button + i18n keys in 6 languages.
The page shell owns the table/filters/pagination and delegates create/edit to a
small form-dialog component (keeps each file in the 200–400 line comfort zone per
the project's "many small files" rule).

### File map

| Purpose | Path | Action |
|---|---|---|
| Nav button | `src/views/pages/systemsetting/index.vue` (left column, after "Manage Skills") | add button + `navigateToAIMemory` |
| Route | `src/views/router/index.ts` (after `system_setting_plugins`) | add `system_setting_ai_memory` child, hidden |
| Page | `src/views/pages/systemsetting/aiMemory.vue` (new) | table + filters + search + pagination + row actions |
| Form dialog | `src/views/pages/systemsetting/components/AiMemoryFormDialog.vue` (new) | create/edit form + validation |
| i18n button label | `src/views/lang/{en,zh,es,fr,de,ja}.ts` → `system_settings.manage_ai_memories` | add key |
| i18n page strings | `src/views/lang/{en,zh,es,fr,de,ja}.ts` → new `aiMemory` namespace | add namespace |

No changes to `src/views/api/aiUserMemory.ts`, `src/entityTypes/aiUserMemoryTypes.ts`,
or `src/config/channellist.ts`.

## 5. Component design

### 5.1 Navigation entry (`index.vue`)

A third button in the left column, identical shape to the two existing ones:

```ts
function navigateToAIMemory() {
  router.push({ name: 'system_setting_ai_memory' });
}
```

### 5.2 Page (`aiMemory.vue`)

Shell mirrors `skills.vue` (back button `mdi-arrow-left` → `system_setting_index`,
`v-card`, loading/empty/error states). The list mirrors `ProxyTable.vue`
(`v-data-table-server`).

- **Toolbar**
  - Search `v-text-field` (debounced ~300 ms) → `query` param (matches title + content).
  - Type filter `v-select`: preference / fact / decision / reference / workflow.
  - Status filter `v-select`, default **active**: active / archived / contradicted.
  - Source filter `v-select`: manual / chat_v2 / agent_task / auto_dream.
  - "Create" `v-btn` → opens `AiMemoryFormDialog` in `create` mode.
  - All filter option lists reuse the readonly arrays + type guards already exported
    from `aiUserMemoryTypes.ts`.
- **Table (`v-data-table-server`)**
  - Server-side pagination: `items-per-page` (default 50), `items-length`,
    `@update:options` → `loadMemories()`.
  - Columns: Title, Type (chip), Content (truncated ~80 chars), Status (chip),
    Source, UpdatedAt, Actions.
- **States**: loading skeleton; empty ("No memories yet — create one"); error with retry.
- **Data**: `aiUserMemoryApi.list({ query, type, status, sourceKind, limit, offset })`.

### 5.3 Form dialog (`AiMemoryFormDialog.vue`)

One component handles both create and edit.

- **Props**: `modelValue: boolean` (visibility), `mode: 'create' | 'edit'`,
  `memory?: AIUserMemoryView | null`.
- **Emits**: `update:modelValue`, `saved (memory: AIUserMemoryView)`.
- **Fields** (validated on submit):
  - Type — `v-select`, required (one of 5 types).
  - Title — `v-text-field`, required, trimmed non-empty, ≤ 200 chars.
  - Content — `v-textarea` (auto-grow), required, trimmed non-empty.
  - Status — `v-select`; create defaults to `active`, edit allows active/archived/contradicted.
  - Confidence — `v-slider` 0–100, default 100.
  - Source — read-only display. Create forces `manual`; edit shows the existing source.
- `memoryId`: generated on create via `crypto.randomUUID()`; not user-editable.
- On save: `aiUserMemoryApi.create(...)` or `update(...)`, check `.status`, emit `saved`,
  close. Surface errors via snackbar.

### 5.4 Row actions & confirm flows

Per row: **Edit** (`mdi-pencil` → opens dialog in `edit` mode), **Archive**
(`mdi-archive`), **Delete** (`mdi-delete`).

- **Archive** → `v-dialog` confirm → `aiUserMemoryApi.archive(memoryId)` → success
  snackbar + refresh.
- **Delete** → separate, sterner `v-dialog` confirm ("permanent, cannot be undone") →
  `aiUserMemoryApi.delete(memoryId)` → refresh.
- **Restore**: an archived memory is restored by editing it and setting Status back to
  `active` (no dedicated restore button needed in v1).

## 6. Data flow

```
aiMemory.vue → aiUserMemoryApi.{list,create,update,archive,delete}
  → window.api.invoke(channel, JSON.stringify(input))
  → preload validChannels
  → ipcMain.handle (ai-user-memory-ipc.ts)
  → AIUserMemoryService
  → AIUserMemoryModule
  → AIUserMemoryModel
  → SQLite (ai_user_memories)
```

## 7. Validation rules

| Field | Rule |
|---|---|
| title | required; trimmed non-empty; ≤ 200 chars |
| content | required; trimmed non-empty |
| type | required; must pass `isAIUserMemoryType` |
| status | required; must pass `isAIUserMemoryStatus` (create defaults `active`) |
| confidence | integer 0–100; default 100 |
| sourceKind (create) | forced to `manual` |

## 8. Error handling

- Every API call checks `result.status`. On `false`: show `result.msg` in a snackbar,
  leave table/dialog state intact. Never swallow errors.
- Unexpected IPC/network errors: caught, surfaced with a generic message + retry
  affordance.
- No hardcoded strings in the UI — all user-facing text via i18n with inline English
  fallback (`t('aiMemory.x') || 'English Text'`).

## 9. Internationalization (mandatory)

- Add `system_settings.manage_ai_memories` for the nav button, in **all 6** language
  files (`en`, `zh`, `es`, `fr`, `de`, `ja`).
- Add a new `aiMemory` namespace (page title/description, column headers, filter
  labels, dialog labels, validation messages, confirm texts, empty/error states) in
  **all 6** language files.
- English is the source of truth; every `t()` call carries an inline English fallback.

## 10. Testing

- **Component unit tests** (vitest + @vue/test-utils), `aiUserMemoryApi` mocked:
  - `AiMemoryFormDialog`: required-field validation, type/status guards, confidence
    bounds, create-vs-edit modes.
  - `aiMemory.vue`: initial load, debounced search, filter changes, pagination,
    create/edit/archive/delete flows with refresh.
- Backend (IPC/service/module/model) is already covered by existing tests — no new
  backend tests required.
- Test placement follows existing `test/vitest/` frontend conventions; the
  implementation plan will confirm the exact subdirectory by matching existing
  frontend component tests.

## 11. Out of scope (v1)

- "Run consolidation now" / auto-dream status controls on this page (already exposed
  as a toggle in AI Preferences; can add a status badge later).
- Bulk operations (select-all archive/delete). Per-row actions suffice for v1.
- A dedicated "restore" button (restore-via-edit is enough for v1).

## 12. Risks & notes

- **Edit of AI-extracted memory**: editing an `auto_dream`/`chat_v2` memory's content
  may be overwritten by a later consolidation run. Accepted per decision #2; users are
  free to curate. (If this becomes a problem, a future `metadata.manuallyEdited` flag
  could exclude a memory from re-consolidation — not in scope now.)
- **Worktree commits**: dev-based worktrees fail the husky `yarn typecheck` precommit.
  Commit with `--no-verify` and run `yarn vue-check` (one-shot) + the vitest suite
  manually before considering work done.
- **Worktree node_modules**: ensure the worktree has a working `node_modules`
  (symlink from the main repo if needed) so `vue-tsc`/vitest run.
