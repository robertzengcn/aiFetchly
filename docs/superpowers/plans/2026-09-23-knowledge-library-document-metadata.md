# Knowledge Library Document Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect author, tags, description on the Knowledge Library file-upload dialog, persist them on `rag_documents`, and make them usable by AI search via exact SQL filters plus a metadata header in embeddings, with author/tags/description returned on every search hit.

**Architecture:** Renderer builds one metadata object per file via a pure builder (`fileUploadMetadata.ts`); existing IPC (`copyFileToTemp` / `RAG_UPLOAD_DOCUMENT`) persists it through `RAGDocumentModule.uploadDocument` (only writer); retrieval filters document IDs with a parameterized query (`RAGDocumentModel.findSearchableDocumentIds`), restricts vector search to those IDs, embeds header+body but stores body-only, and returns structured metadata on each hit. No new IPC channel, no new index, no Phase 3 columns.

**Tech Stack:** TypeScript 5.x, Vue 3 + Vuetify + vue-i18n, Electron IPC (`registerValidatedHandler`, `ipcMain.on` streaming), TypeORM + better-sqlite3 (SQLite `synchronize: true`), Zod v4 (`zod`, `lazySchema`), Vitest + @vue/test-utils + happy-dom, existing RAG pipeline (`RagSearchModule`, `RAGDocumentModule`, `RAGDocumentModel`, `VectorSearchService`, `VectorStoreService`, `skillsRegistry`).

**Spec:** `docs/prd/knowledge-library-document-metadata-prd.md` (product requirements, §§8–9, 15–16, 18–19) and `docs/prd/knowledge-library-document-metadata-technical-design.md` (implementation design, §§4–5, 7–8, 10). The plan argues from the tech design; executors read both.

## Global Constraints

- TypeScript: NEVER use `any`; define explicit interfaces; every function has an explicit return type; catch blocks use `unknown`.
- Static imports only; no dynamic `await import()` in new code except where the existing codebase already does it.
- Three-layer DB: Vue page collects strings and calls renderer API only (no SQL); `RAGDocumentModule.uploadDocument` remains the only writer of `title/description/tags/author`; IPC handlers validate with Zod and pass through (no repositories in `rag-ipc.ts`); child processes never read/write document metadata.
- IPC Zod: keep `.passthrough()` on `ragUploadDocumentInputSchema`; reject over-limit values with a Zod/translated error; do not silently clip tags.
- Security: all user text is bound parameters, never concatenated into SQL; escape `%`, `_`, `"` before `LIKE`; header labels are fixed constants `Title/Author/Tags/Description`; collapse newlines in header fields to spaces; render metadata as text (no `v-html`); tool results omit `filePath`.
- i18n: every new label in all six files `src/views/lang/{en,zh,es,fr,de,ja}.ts`; Vue uses `t('knowledge.…')` with English fallback.
- UI + tests ship together: `yarn test:components` is a hard gate; component test asserts the API payload.
- Phase 3 (`language`, `documentDate`, `customMetadata`) is OUT OF SCOPE for this change. Do not add those columns.
- Tag JSON stays a string column (`JSON.stringify(string[])` once in the module); no tags join table.

---

## File Structure

New files (what each owns):

- `src/views/pages/knowledge/fileUploadMetadata.ts` — pure renderer builder: defaults, title-stem, tag normalization. No Vue, no IPC, no DB.
- `src/service/knowledgeMetadataHeader.ts` — pure main-process builder: header+body embedding input, omit rules, newline collapsing.
- `test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts` — dialog component test + builder unit cases (PRD §16.1).
- `test/vitest/utilitycode/knowledgeMetadataHeader.test.ts` — header unit test (design §8.2).

Modified files:

- `src/views/pages/knowledge/KnowledgeLibrary.vue` — three inputs + hint, both upload paths, clear-on-cancel/success.
- `src/views/pages/knowledge/DocumentManagement.vue` — author field on dead dialog + author/tags table columns.
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` — `knowledge.author`, `knowledge.upload_metadata_hint`.
- `src/schemas/ipc/rag.ts` — typed optional `title/description/author/tags` on `ragUploadDocumentInputSchema`.
- `src/main-process/communication/rag-ipc.ts` — SAVE_TEMP_FILE metadata Zod limits (RAG_UPLOAD_DOCUMENT rides the schema).
- `src/model/RAGDocument.model.ts` — new `findSearchableDocumentIds`.
- `src/modules/RagSearchModule.ts` — `resolveAllowedDocumentIds` via query, empty-list early return, `embedAndStoreChunks` header source, `candidateToResultItem` + neighbors metadata.
- `src/service/VectorSearchService.ts` — `SearchOptions.documentIds`, `search`/`searchCandidates` honor it, `SearchResult.document` metadata, `getDetailedResults` copies it.
- `src/service/RagSearchTypes.ts` — `RagSearchCandidate.document` + `KnowledgeSearchResultItem` gain `author/tags/description`.
- `src/config/skillsRegistry.ts` — tool description text for search + list, optional `author` param on list tool.
- `test/vitest/main/service/KnowledgeSearchTool.test.ts` — extended search tests (PRD §16.2).

---

### Task 1: Pure upload-metadata builder

**Files:**
- Create: `src/views/pages/knowledge/fileUploadMetadata.ts`
- Test: `test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts` (builder unit section, Task 6)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `buildFileUploadMetadata(fileName: string, input: FileUploadMetadataInput): FileUploadMetadata`, `normalizeUploadTags(tags: readonly unknown[]): string[]` — used by Task 2 (`KnowledgeLibrary.vue`) and asserted by Task 6.

- [ ] **Step 1: Create the builder file**

```typescript
export interface FileUploadMetadataInput {
  author: string;
  description: string;
  tags: readonly unknown[];
}

export interface FileUploadMetadata {
  title: string;
  description: string;
  tags: string[];
  author: string;
}

const MAX_AUTHOR_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 64;
const DEFAULT_TAGS: string[] = ["uploaded", "knowledge"];
const DEFAULT_AUTHOR = "User";

export function normalizeUploadTags(tags: readonly unknown[]): string[] {
  const kept: string[] = [];
  const seenLower = new Set<string>();
  for (const entry of tags) {
    const trimmed: string = String(entry ?? "").trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > MAX_TAG_LENGTH) {
      throw new Error(`Tag exceeds ${MAX_TAG_LENGTH} characters: ${trimmed}`);
    }
    const folded: string = trimmed.toLowerCase();
    if (seenLower.has(folded)) {
      continue;
    }
    seenLower.add(folded);
    kept.push(trimmed);
    if (kept.length > MAX_TAGS) {
      throw new Error(`Too many tags (max ${MAX_TAGS})`);
    }
  }
  return kept;
}

function stemFileName(fileName: string): string {
  const stem: string = fileName.replace(/\.[^/.]+$/, "");
  return stem.length > 0 ? stem : fileName;
}

export function buildFileUploadMetadata(
  fileName: string,
  input: FileUploadMetadataInput
): FileUploadMetadata {
  const authorTrimmed: string = input.author.trim();
  if (authorTrimmed.length > MAX_AUTHOR_LENGTH) {
    throw new Error(`Author exceeds ${MAX_AUTHOR_LENGTH} characters`);
  }
  const descriptionTrimmed: string = input.description.trim();
  if (descriptionTrimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  const tags: string[] = normalizeUploadTags(input.tags);
  return {
    title: stemFileName(fileName),
    description:
      descriptionTrimmed.length > 0
        ? descriptionTrimmed
        : `Uploaded document: ${fileName}`,
    tags: tags.length > 0 ? tags : [...DEFAULT_TAGS],
    author: authorTrimmed.length > 0 ? authorTrimmed : DEFAULT_AUTHOR,
  };
}
```

- [ ] **Step 2: Typecheck the new file**

Run: `yarn vue-check 2>&1 | tail -n 20`
Expected: no errors mentioning `fileUploadMetadata`.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/knowledge/fileUploadMetadata.ts
git commit -m "feat: add file upload metadata builder with defaults and tag normalization"
```

### Task 2: Upload dialog fields + both upload paths

**Files:**
- Modify: `src/views/pages/knowledge/KnowledgeLibrary.vue`

**Interfaces:**
- Consumes: `buildFileUploadMetadata` (Task 1), `copyFileToTemp as copyFileToTempAPI`, `uploadDocument as uploadDocumentAPI` from `@/views/api/rag`, `currentModel` ref, `t('knowledge.*')` (Task 3).
- Produces: dialog collects one metadata set per batch; `doUpload` persists it on both paths; cancel/success clears, failure keeps.

- [ ] **Step 1: Add imports and dialog state (next to `uploadFiles`, ~line 536)**

```typescript
import { buildFileUploadMetadata } from "@/views/pages/knowledge/fileUploadMetadata";
import {
  getRAGStats,
  selectFilesNative as selectFilesNativeAPI,
  copyFileToTemp as copyFileToTempAPI,
  uploadDocument as uploadDocumentAPI,
  checkDocumentDuplicate,
} from "@/views/api/rag";
import type { UploadedDocument } from "@/entityTypes/commonType";
```

```typescript
const uploadAuthor = ref<string>("");
const uploadDescription = ref<string>("");
const uploadTags = ref<string[]>([]);

function clearUploadMetadata(): void {
  uploadAuthor.value = "";
  uploadDescription.value = "";
  uploadTags.value = [];
}

function isNativePathObject(file: File): boolean {
  const maybePath: unknown = (file as unknown as { path?: unknown }).path;
  return typeof maybePath === "string" && maybePath.length > 0 && !(file instanceof File);
}

function toUploadedDocumentFromResponse(response: unknown, fallbackName: string, fallbackPath: string): UploadedDocument {
  if (typeof response === "object" && response !== null && "document" in response) {
    const doc: unknown = (response as { document: unknown }).document;
    if (typeof doc === "object" && doc !== null && "name" in doc) {
      return doc as UploadedDocument;
    }
  }
  if (typeof response === "object" && response !== null && "id" in response && "name" in response) {
    return response as unknown as UploadedDocument;
  }
  return {
    id: Date.now(),
    name: fallbackName,
    title: fallbackName.replace(/\.[^/.]+$/, ""),
    filePath: fallbackPath,
    status: "pending",
    description: `Uploaded document: ${fallbackName}`,
    tags: ["uploaded", "knowledge"],
    author: "User",
  } as UploadedDocument;
}
```

- [ ] **Step 2: Add template fields after the selected-file list, before the error alert (~line 210)**

```vue
<div v-if="uploadFiles.length > 0" class="upload-metadata mt-4">
  <div class="text-caption text-grey mb-2">
    {{ t('knowledge.upload_metadata_hint') || 'Optional. Applied to every file in this upload.' }}
  </div>
  <v-text-field
    v-model="uploadAuthor"
    :label="t('knowledge.author') || 'Author'"
    maxlength="255"
    density="compact"
    class="mb-2"
  />
  <v-combobox
    v-model="uploadTags"
    :label="t('knowledge.tags') || 'Tags'"
    :hint="t('knowledge.tags_hint') || 'Press Enter to add tags'"
    multiple
    chips
    closable-chips
    density="compact"
    class="mb-2"
  />
  <v-textarea
    v-model="uploadDescription"
    :label="t('knowledge.description') || 'Description'"
    maxlength="2000"
    rows="2"
    density="compact"
  />
</div>
```

- [ ] **Step 3: Replace `doUpload` body to use the builder on both paths**

Replace the hardcoded `copyFileToTempAPI(file, {title, description, tags})` block (~line 1153) with:

```typescript
const metadata = buildFileUploadMetadata(file.name, {
  author: uploadAuthor.value,
  description: uploadDescription.value,
  tags: uploadTags.value,
});
const nativePath: unknown = (file as unknown as { path?: unknown }).path;
if (typeof nativePath === "string" && nativePath.length > 0 && !(file instanceof File)) {
  const response: unknown = await uploadDocumentAPI({
    filePath: nativePath,
    name: file.name,
    modelName: currentModel.value || "text-embedding-3-small",
    title: metadata.title,
    description: metadata.description,
    tags: metadata.tags,
    author: metadata.author,
  });
  const doc: UploadedDocument = toUploadedDocumentFromResponse(response, file.name, nativePath);
  return doc;
}
currentUploadingFile.value = file.name;
const uploadResult = await copyFileToTempAPI(
  file,
  {
    title: metadata.title,
    description: metadata.description,
    tags: metadata.tags,
    author: metadata.author,
  },
  (progress: FileUploadProgress) => {
    uploadProgress.value.set(file.name, progress);
  },
  (result: FileUploadComplete) => {
    uploadProgress.value.delete(file.name);
  }
);
filePath = uploadResult.tempFilePath;
if (uploadResult.document) {
  return uploadResult.document;
}
return {
  id: Date.now(),
  name: file.name,
  title: metadata.title,
  filePath: filePath,
  status: "pending",
  description: metadata.description,
  tags: metadata.tags,
  author: metadata.author,
} as UploadedDocument;
```

Delete the old `else` branch that returned a fake in-memory row for native paths (~line 1191–1203); the native branch above replaces it. A real `File` that happens to carry `path` stays on `copyFileToTemp`. Wrap per-file validation errors so the dialog stays open: in the `catch` of `doUpload`, set `uploadError` to `t('knowledge.upload_failed') + ': ' + message` and do NOT clear the three refs.

- [ ] **Step 4: Clear-on-cancel/success, keep-on-failure**

In `cancelUpload()` (~line 1046) add `clearUploadMetadata();`. After `await Promise.all(uploadPromises)` and `handleUploadSuccess` loop succeeds, call `clearUploadMetadata();` before `cancelUpload();` (or rely on `cancelUpload` clearing). Do NOT clear in the `catch` path. `handleSkipDuplicates`/`handleUploadAnyway` keep calling `doUpload` with the already-entered values.

- [ ] **Step 5: Run component tests for this file (after Task 6 exists) / typecheck now**

Run: `yarn vue-check 2>&1 | tail -n 20`
Expected: no new type errors in `KnowledgeLibrary.vue`.

- [ ] **Step 6: Commit**

```bash
git add src/views/pages/knowledge/KnowledgeLibrary.vue
git commit -m "feat: collect author tags description on knowledge upload dialog and persist on both paths"
```

### Task 3: i18n keys in all six languages

**Files:**
- Modify: `src/views/lang/en.ts`, `src/views/lang/zh.ts`, `src/views/lang/es.ts`, `src/views/lang/fr.ts`, `src/views/lang/de.ts`, `src/views/lang/ja.ts`

**Interfaces:**
- Consumes: existing `knowledge.tags`, `knowledge.tags_hint`, `knowledge.description`.
- Produces: `knowledge.author`, `knowledge.upload_metadata_hint` for Task 2 template.

- [ ] **Step 1: Add the two keys inside each `knowledge: { … }` block, next to `tags`**

```typescript
// en.ts
author: "Author",
upload_metadata_hint: "Optional. Applied to every file in this upload.",
// zh.ts
author: "作者",
upload_metadata_hint: "可选。将应用于本次上传的每个文件。",
// es.ts
author: "Autor",
upload_metadata_hint: "Opcional. Se aplica a todos los archivos de esta subida.",
// fr.ts
author: "Auteur",
upload_metadata_hint: "Facultatif. Appliqué à chaque fichier de cet envoi.",
// de.ts
author: "Autor",
upload_metadata_hint: "Optional. Gilt für jede Datei dieses Uploads.",
// ja.ts
author: "作成者",
upload_metadata_hint: "任意。このアップロードのすべてのファイルに適用されます。",
```

Do not touch `knowledge.website_import_author`. Reuse existing `knowledge.tags`, `knowledge.tags_hint`, `knowledge.description`.

- [ ] **Step 2: Verify keys exist in all six files**

Run: `rg -n "upload_metadata_hint|^\s*author:" src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts`
Expected: each file lists both `author` and `upload_metadata_hint` under `knowledge`.

- [ ] **Step 3: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat: add knowledge upload metadata i18n keys in six languages"
```

### Task 4: IPC Zod validation

**Files:**
- Modify: `src/schemas/ipc/rag.ts`, `src/main-process/communication/rag-ipc.ts`

**Interfaces:**
- Consumes: Zod `z`, `lazySchema`.
- Produces: typed optional metadata on `RAG_UPLOAD_DOCUMENT`; SAVE_TEMP_FILE rejects over-limit metadata. `RAGDocumentModule.uploadDocument` unchanged.

- [ ] **Step 1: Extend `ragUploadDocumentInputSchema` in `src/schemas/ipc/rag.ts`**

```typescript
export const ragUploadDocumentInputSchema = lazySchema(() =>
  z
    .object({
      filePath: z.string().min(1, "filePath is required"),
      name: z.string().min(1, "name is required"),
      modelName: z.string().min(1, "modelName is required"),
      title: z.string().trim().max(500).optional(),
      description: z.string().trim().max(2000).optional(),
      author: z.string().trim().max(255).optional(),
      tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    })
    .passthrough()
);
```

Keep `.passthrough()`.

- [ ] **Step 2: Validate SAVE_TEMP_FILE metadata in `src/main-process/communication/rag-ipc.ts` before `uploadDocument`**

Insert after `const metadataTyped = metadata as {…}` (~line 216), before building `uploadOptions`:

```typescript
import { z } from "zod";

const saveTempFileMetadataSchema = z.object({
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  author: z.string().trim().max(255).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
});

const parsedMetadata = saveTempFileMetadataSchema.safeParse(metadataTyped);
if (!parsedMetadata.success) {
  const errorResponse: CommonMessage<SaveTempFileResponse> = {
    status: false,
    msg: `Invalid upload metadata: ${parsedMetadata.error.issues.map((i) => i.message).join("; ")}`,
    data: { tempFilePath: "", databaseSaved: false, databaseError: "Invalid upload metadata" },
  };
  (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
    SAVE_TEMP_FILE_COMPLETE,
    JSON.stringify(errorResponse)
  );
  return;
}
```

Then build `uploadOptions` from `parsedMetadata.data` (falling back to existing defaults for missing fields). Do not clip; reject.

- [ ] **Step 3: Run main-process typecheck/tests touching rag-ipc**

Run: `yarn vue-check 2>&1 | tail -n 20`
Expected: no new errors in `rag-ipc.ts` or `schemas/ipc/rag.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/schemas/ipc/rag.ts src/main-process/communication/rag-ipc.ts
git commit -m "fix: validate knowledge upload metadata limits on IPC boundary"
```

### Task 5: Author field on the unused DocumentManagement dialog

**Files:**
- Modify: `src/views/pages/knowledge/DocumentManagement.vue`

**Interfaces:**
- Consumes: existing `uploadData {title, description, tags}` + `uploadDocumentAPI`.
- Produces: same form plus `author`; payload and reset include it. Opener button stays commented out.

- [ ] **Step 1: Add author input under the tags combobox (~line 211)**

```vue
<v-text-field
  v-model="uploadData.author"
  :label="t('knowledge.author') || 'Author'"
  maxlength="255"
  density="compact"
/>
```

Extend the `uploadData` ref (~line 289) with `author: ""`:

```typescript
const uploadData = ref<{ title: string; description: string; tags: string[]; author: string }>({
  title: "",
  description: "",
  tags: [],
  author: "",
});
```

Include `author: uploadData.value.author.trim() || undefined` in the `uploadDocumentAPI({filePath, name, title, description, tags, author})` call (~line 519), and reset `author` to `""` alongside the other fields (~line 534).

- [ ] **Step 2: Verify the opener is still commented out (~line 38)**

No change: leave the open button commented.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/knowledge/DocumentManagement.vue
git commit -m "feat: add author field to unused document management upload dialog"
```

### Task 6: Component test for the upload dialog

**Files:**
- Create: `test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts`

**Interfaces:**
- Consumes: `KnowledgeLibrary.vue`, `@/views/api/rag` (`copyFileToTemp`, `selectFilesNative`, `uploadDocument`, `getRAGStats`, `checkDocumentDuplicate`), `@/views/api/localAiRuntime`, `buildFileUploadMetadata`.
- Produces: gate for Phase 1 (PRD §16.1, §18).

- [ ] **Step 1: Write the failing test first**

```typescript
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgeLibrary from "@/views/pages/knowledge/KnowledgeLibrary.vue";
import { buildFileUploadMetadata } from "@/views/pages/knowledge/fileUploadMetadata";

const ragApiMocks = vi.hoisted(() => ({
  copyFileToTempMock: vi.fn(),
  selectFilesNativeMock: vi.fn(),
  uploadDocumentMock: vi.fn(),
  getRAGStatsMock: vi.fn(),
  checkDocumentDuplicateMock: vi.fn(),
}));

vi.mock("@/views/api/rag", () => ({
  getRAGStats: (...args: unknown[]) => ragApiMocks.getRAGStatsMock(...args),
  selectFilesNative: (...args: unknown[]) => ragApiMocks.selectFilesNativeMock(...args),
  copyFileToTemp: (...args: unknown[]) => ragApiMocks.copyFileToTempMock(...args),
  uploadDocument: (...args: unknown[]) => ragApiMocks.uploadDocumentMock(...args),
  checkDocumentDuplicate: (...args: unknown[]) => ragApiMocks.checkDocumentDuplicateMock(...args),
  chunkAndEmbedDocument: vi.fn(),
  getAvailableEmbeddingModelsWithDefault: vi.fn().mockResolvedValue({ models: [], defaultModel: "text-embedding-3-small" }),
  updateEmbeddingModel: vi.fn(),
}));

vi.mock("@/views/api/localAiRuntime", () => ({
  getLocalAiRuntimeStatus: vi.fn().mockResolvedValue({ installed: false }),
  prepareLocalAiRuntimeInstall: vi.fn(),
  installLocalAiRuntime: vi.fn(),
  cancelLocalAiRuntimeInstall: vi.fn(),
  onLocalAiRuntimeProgress: vi.fn().mockReturnValue(() => undefined),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      knowledge: {
        author: "Author",
        tags: "Tags",
        tags_hint: "Press Enter to add tags",
        description: "Description",
        upload_metadata_hint: "Optional. Applied to every file in this upload.",
        upload_failed: "Upload failed",
        no_files_selected: "No files selected",
      },
      common: { cancel: "Cancel" },
    },
  },
});

const stubs = {
  DocumentManagement: { template: "<div />" },
  SearchInterface: { template: "<div />" },
  WebsiteImportDialog: { template: "<div />" },
  VDialog: { template: "<div><slot /></div>" },
  VCard: true,
  VCardTitle: true,
  VCardText: true,
  VCardActions: true,
  VBtn: true,
  VIcon: true,
  VList: true,
  VListItem: true,
  VTextField: true,
  VCombobox: true,
  VTextarea: true,
  VAlert: { template: "<div><slot /></div>" },
  VSpacer: true,
  VProgressLinear: true,
};

function mountPage(): ReturnType<typeof mount> {
  return mount(KnowledgeLibrary, { global: { plugins: [i18n], stubs } });
}

beforeEach(() => {
  vi.clearAllMocks();
  ragApiMocks.getRAGStatsMock.mockResolvedValue({ defaultEmbeddingModel: "text-embedding-3-small", totalDocuments: 0 });
  ragApiMocks.checkDocumentDuplicateMock.mockResolvedValue({ isDuplicate: false, existingDocuments: [] });
});

describe("KnowledgeLibrary upload metadata", () => {
  it("renders author, tags, and description inputs", async () => {
    const wrapper = mountPage();
    (wrapper.vm as unknown as { showUploadDialog: boolean }).showUploadDialog = true;
    await flushPromises();
    expect(wrapper.html()).toContain("Author");
  });

  it("passes typed metadata plus filename-stem title to copyFileToTemp", async () => {
    const wrapper = mountPage();
    const vm = wrapper.vm as unknown as {
      showUploadDialog: boolean;
      uploadFiles: Array<{ name: string; size: number }>;
      uploadAuthor: string;
      uploadDescription: string;
      uploadTags: string[];
      confirmUpload: () => Promise<void>;
    };
    vm.showUploadDialog = true;
    vm.uploadFiles = [{ name: "refund-policy.pdf", size: 10 } as unknown as File];
    vm.uploadAuthor = "Alice Chen";
    vm.uploadTags = ["pricing", "enterprise"];
    vm.uploadDescription = "Refund rules";
    ragApiMocks.copyFileToTempMock.mockResolvedValue({ tempFilePath: "/tmp/x.pdf", document: { id: 1, name: "refund-policy.pdf", status: "completed" } });
    await vm.confirmUpload();
    await flushPromises();
    expect(ragApiMocks.copyFileToTempMock).toHaveBeenCalledTimes(1);
    const metadata = ragApiMocks.copyFileToTempMock.mock.calls[0][1] as { title: string; description: string; tags: string[]; author: string };
    expect(metadata).toEqual({ title: "refund-policy", description: "Refund rules", tags: ["pricing", "enterprise"], author: "Alice Chen" });
  });

  it("uses defaults when fields are blank", () => {
    const out = buildFileUploadMetadata("memo.pdf", { author: "  ", description: "", tags: [] });
    expect(out).toEqual({ title: "memo", description: "Uploaded document: memo.pdf", tags: ["uploaded", "knowledge"], author: "User" });
  });

  it("trims, drops empties, and dedupes tags case-insensitively keeping first spelling", () => {
    const out = buildFileUploadMetadata("a.pdf", { author: "Bob", description: "d", tags: [" Pricing ", "", "pricing", "ENTERPRISE"] });
    expect(out.tags).toEqual(["Pricing", "ENTERPRISE"]);
  });

  it("rejects too many tags and over-long tags", () => {
    expect(() => buildFileUploadMetadata("a.pdf", { author: "", description: "", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toThrow();
    expect(() => buildFileUploadMetadata("a.pdf", { author: "", description: "", tags: ["x".repeat(65)] })).toThrow();
  });
});
```

Mount via the real page (dialog lives in `KnowledgeLibrary.vue`); stub `DocumentManagement`, `SearchInterface`, `WebsiteImportDialog` per tech design §8.1. Keep assertions on the `copyFileToTemp` payload, not on Vuetify internals. Cancel-clears is covered by asserting `clearUploadMetadata` behavior through `cancelUpload` in a follow-up edit if the first run shows the ref names differ — update the test, do not delete the case.

- [ ] **Step 2: Run the new test to verify it fails before Task 2 (if running plan out of order) or passes now**

Run: `yarn test:components test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts 2>&1 | tail -n 30`
Expected: PASS after Tasks 1–3. If a selector/ref name mismatches, fix the test to match the implementation (keep all five cases).

- [ ] **Step 3: Commit together with the UI change if not already committed**

```bash
git add test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts
git commit -m "test: cover knowledge upload dialog metadata payload and defaults"
```

### Task 7: Embedding header builder + unit test

**Files:**
- Create: `src/service/knowledgeMetadataHeader.ts`
- Create: `test/vitest/utilitycode/knowledgeMetadataHeader.test.ts`

**Interfaces:**
- Consumes: parent document fields.
- Produces: `buildEmbeddingInput(source: EmbeddingHeaderSource, chunkContent: string): string` — used by Task 10.

- [ ] **Step 1: Write the failing header test**

```typescript
import { describe, expect, it } from "vitest";
import { buildEmbeddingInput } from "@/service/knowledgeMetadataHeader";

describe("buildEmbeddingInput", () => {
  it("returns body unchanged when only defaults are present", () => {
    const out = buildEmbeddingInput(
      { fileName: "memo.pdf", title: "memo", author: "User", tags: ["uploaded", "knowledge"], description: "Uploaded document: memo.pdf" },
      "body text"
    );
    expect(out).toBe("body text");
  });

  it("prefixes title, author, tags, description", () => {
    const out = buildEmbeddingInput(
      { fileName: "q3.pdf", title: "Q3 refund policy", author: "Alice Chen", tags: ["refund-policy", "enterprise"], description: "Refund rules" },
      "chunk body"
    );
    expect(out.startsWith("Title: Q3 refund policy\nAuthor: Alice Chen\nTags: refund-policy, enterprise\nDescription: Refund rules\n\n")).toBe(true);
    expect(out.endsWith("chunk body")).toBe(true);
  });

  it("collapses newlines inside fields so no extra header lines are smuggled", () => {
    const out = buildEmbeddingInput(
      { fileName: "a.pdf", title: "t", description: "line one\nline two" },
      "body"
    );
    expect(out).toContain("Description: line one line two");
    expect(out.match(/^Description:/gm)?.length).toBe(1);
  });

  it("omits User author and default tags", () => {
    const out = buildEmbeddingInput(
      { fileName: "a.pdf", title: "t", author: "User", tags: ["knowledge", "uploaded"] },
      "body"
    );
    expect(out).toBe("Title: t\n\nbody");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/knowledgeMetadataHeader.test.ts 2>&1 | tail -n 20`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement the header builder**

```typescript
export interface EmbeddingHeaderSource {
  fileName: string;
  title?: string;
  author?: string;
  tags?: string[];
  description?: string;
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function isDefaultTags(tags: string[] | undefined): boolean {
  if (!tags || tags.length === 0) {
    return true;
  }
  const folded: string[] = tags.map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0);
  if (folded.length === 0) {
    return true;
  }
  if (folded.length !== 2) {
    return false;
  }
  return folded.includes("uploaded") && folded.includes("knowledge");
}

export function buildEmbeddingInput(source: EmbeddingHeaderSource, chunkContent: string): string {
  const lines: string[] = [];
  const title: string = (source.title ?? "").trim();
  if (title.length > 0) {
    lines.push(`Title: ${singleLine(title)}`);
  }
  const author: string = (source.author ?? "").trim();
  if (author.length > 0 && author !== "User") {
    lines.push(`Author: ${singleLine(author)}`);
  }
  if (!isDefaultTags(source.tags)) {
    const tags: string[] = (source.tags ?? []).map((t: string) => singleLine(t)).filter((t: string) => t.length > 0);
    if (tags.length > 0) {
      lines.push(`Tags: ${tags.join(", ")}`);
    }
  }
  const description: string = (source.description ?? "").trim();
  const defaultDescription = `Uploaded document: ${source.fileName}`;
  if (description.length > 0 && description !== defaultDescription) {
    lines.push(`Description: ${singleLine(description)}`);
  }
  if (lines.length === 0) {
    return chunkContent;
  }
  return `${lines.join("\n")}\n\n${chunkContent}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/knowledgeMetadataHeader.test.ts 2>&1 | tail -n 20`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/knowledgeMetadataHeader.ts test/vitest/utilitycode/knowledgeMetadataHeader.test.ts
git commit -m "feat: build metadata header for chunk embeddings with defaults omitted"
```

### Task 8: Document-ID query + filter replacement

**Files:**
- Modify: `src/model/RAGDocument.model.ts`, `src/modules/RagSearchModule.ts`

**Interfaces:**
- Consumes: `KnowledgeSearchRequest {query, limit?, documentIds?, documentTypes?, tags?, author?, dateRange?, includeNeighborChunks?}`.
- Produces: `RAGDocumentModel.findSearchableDocumentIds(filters): Promise<number[]>`; `resolveAllowedDocumentIds` returns `undefined` (no filters) | ids | `[]` (filters, no match); `searchKnowledgeForTool` returns empty success on `[]` without calling vector search. Used by Task 9 and Task 12.

- [ ] **Step 1: Add `findSearchableDocumentIds` to `src/model/RAGDocument.model.ts`**

```typescript
async findSearchableDocumentIds(filters: {
  documentIds?: number[];
  fileTypes?: string[];
  author?: string;
  tags?: string[];
  uploadedFrom?: Date;
  uploadedTo?: Date;
}): Promise<number[]> {
  const queryBuilder = this.repository.createQueryBuilder("document");
  queryBuilder.select("document.id", "id");
  queryBuilder.where("document.status = :status", { status: "active" });
  queryBuilder.andWhere("document.processingStatus = :processingStatus", { processingStatus: "completed" });
  if (filters.documentIds && filters.documentIds.length > 0) {
    queryBuilder.andWhere("document.id IN (:...filterDocumentIds)", { filterDocumentIds: filters.documentIds });
  }
  if (filters.fileTypes && filters.fileTypes.length > 0) {
    queryBuilder.andWhere("document.fileType IN (:...filterFileTypes)", { filterFileTypes: filters.fileTypes });
  }
  const authorTrimmed: string = (filters.author ?? "").trim();
  if (authorTrimmed.length > 0) {
    const escaped: string = authorTrimmed.replace(/[\\%_]/g, (m: string) => `\\${m}`);
    queryBuilder.andWhere("LOWER(document.author) LIKE :filterAuthor ESCAPE '\\'", {
      filterAuthor: `%${escaped.toLowerCase()}%`,
    });
  }
  const tags: string[] = (filters.tags ?? []).map((t: string) => t.trim()).filter((t: string) => t.length > 0);
  if (tags.length > 0) {
    const tagClauses: string[] = [];
    const params: Record<string, string> = {};
    tags.forEach((tag: string, index: number) => {
      const escaped: string = tag.replace(/[\\%_"]/g, (m: string) => `\\${m}`).toLowerCase();
      tagClauses.push(`LOWER(document.tags) LIKE :filterTag${index} ESCAPE '\\'`);
      params[`filterTag${index}`] = `%"${escaped}"%`;
    });
    queryBuilder.andWhere(`(${tagClauses.join(" OR ")})`, params);
  }
  if (filters.uploadedFrom) {
    queryBuilder.andWhere("document.uploadedAt >= :uploadedFrom", { uploadedFrom: filters.uploadedFrom });
  }
  if (filters.uploadedTo) {
    queryBuilder.andWhere("document.uploadedAt <= :uploadedTo", { uploadedTo: filters.uploadedTo });
  }
  const rows: Array<{ id: number }> = await queryBuilder.getRawMany();
  return rows.map((r: { id: number }) => r.id);
}
```

The quoted form `%"pricing"%` matches JSON element `"pricing"` and not `"pricing-old"`. All values are bound parameters.

- [ ] **Step 2: Replace the in-memory scan in `resolveAllowedDocumentIds` (`src/modules/RagSearchModule.ts` ~line 1468)**

Replace the `getDocuments` + `JSON.parse` + `includes` block with:

```typescript
private async resolveAllowedDocumentIds(request: KnowledgeSearchRequest): Promise<number[] | undefined> {
  const hasAuthor: boolean = (request.author ?? "").trim().length > 0;
  const hasTags: boolean = (request.tags ?? []).length > 0;
  const hasIds: boolean = (request.documentIds ?? []).length > 0;
  const hasTypes: boolean = (request.documentTypes ?? []).length > 0;
  const hasDates: boolean = request.dateRange !== undefined;
  if (!hasAuthor && !hasTags && !hasIds && !hasTypes && !hasDates) {
    return undefined;
  }
  const model = new RAGDocumentModel(this.dbpath);
  const uploadedFrom: Date | undefined = request.dateRange?.start ? new Date(request.dateRange.start) : undefined;
  const uploadedTo: Date | undefined = request.dateRange?.end ? new Date(request.dateRange.end) : undefined;
  const ids: number[] = await model.findSearchableDocumentIds({
    documentIds: request.documentIds,
    fileTypes: request.documentTypes,
    author: request.author,
    tags: request.tags,
    uploadedFrom,
    uploadedTo,
  });
  return ids;
}
```

Keep the tri-state: no filters → `undefined`; filters with hits → ids; filters with no hits → `[]`.

- [ ] **Step 3: Early empty-success in `searchKnowledgeForTool` (~line 1298)**

Insert immediately after `const allowedDocIds = await this.resolveAllowedDocumentIds(request);`:

```typescript
if (allowedDocIds && allowedDocIds.length === 0) {
  return {
    success: true,
    query: request.query,
    totalCandidates: 0,
    rerankUsed: false,
    truncated: false,
    results: [],
  };
}
```

Change the `searchCandidates` call to pass `documentIds: allowedDocIds` (not the `length > 0` ternary):

```typescript
const candidates = await this.searchService.searchCandidates(request.query, {
  vectorLimit: VECTOR_CANDIDATE_LIMIT,
  keywordLimit: KEYWORD_CANDIDATE_LIMIT,
  maxDistance: undefined,
  documentIds: allowedDocIds,
});
```

- [ ] **Step 4: Run search tests (after Task 14) / typecheck now**

Run: `yarn vue-check 2>&1 | tail -n 20`
Expected: no new errors in `RAGDocument.model.ts` or `RagSearchModule.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/model/RAGDocument.model.ts src/modules/RagSearchModule.ts
git commit -m "fix: filter knowledge search by document query and return empty on no match"
```

### Task 9: Vector search honors the ID list

**Files:**
- Modify: `src/service/VectorSearchService.ts`

**Interfaces:**
- Consumes: `documentIds?: number[]` from Task 8.
- Produces: `search` and `searchCandidates` never open or return documents outside the set.

- [ ] **Step 1: Add `documentIds` to `SearchOptions` (~line 38)**

```typescript
export interface SearchOptions {
  limit?: number;
  threshold?: number;
  maxDistance?: number;
  minScore?: number;
  includeMetadata?: boolean;
  documentTypes?: string[];
  dateRange?: { start: Date; end: Date };
  documentIds?: number[];
}
```

- [ ] **Step 2: Filter in `search` before `groupDocumentsByModel` (~line 120)**

After `const allDocs = await this.getAllDocumentsWithEmbeddings();` insert:

```typescript
const docsInScope = options.documentIds && options.documentIds.length > 0
  ? allDocs.filter((d) => options.documentIds!.includes(d.id))
  : allDocs;
```

Use `docsInScope` for the rest of `search`. When `documentIds` is `[]`, the caller (Task 8) already returned early; defensively, `[]` here means search nothing.

- [ ] **Step 3: Forward IDs in `searchCandidates` (~line 263) and post-filter the merge**

Change:

```typescript
const vectorResults = await this.search(query, { limit: vectorLimit, maxDistance });
```

to:

```typescript
const vectorResults = await this.search(query, { limit: vectorLimit, maxDistance, documentIds: options.documentIds });
```

After the merge (`merged candidates`, ~line 301), insert:

```typescript
const scoped =
  options.documentIds && options.documentIds.length > 0
    ? merged.filter((c) => options.documentIds!.includes(c.documentId))
    : merged;
```

Return `scoped`. Leave `searchWithFilters` untouched.

- [ ] **Step 4: Typecheck**

Run: `yarn vue-check 2>&1 | tail -n 20`
Expected: no new errors in `VectorSearchService.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/service/VectorSearchService.ts
git commit -m "fix: restrict vector search to allowed document ids"
```

### Task 10: Header-on-embed for every chunk path

**Files:**
- Modify: `src/modules/RagSearchModule.ts` (`embedAndStoreChunks`, `generateChunkEmbeddings`, `fallbackToLocalEmbedding`, upload + re-embed callers)

**Interfaces:**
- Consumes: `buildEmbeddingInput` + `EmbeddingHeaderSource` (Task 7).
- Produces: embedding computed on header+body; `storeEmbedding` and `rag_chunks.content` stay body-only.

- [ ] **Step 1: Thread a header source through the embed path**

Change signature (~line 467):

```typescript
private async embedAndStoreChunks(
  chunks: RAGChunkEntity[],
  embedBatchFn: (texts: string[]) => Promise<EmbeddingResult[]>,
  vectorIndexPath: string,
  headerSource: EmbeddingHeaderSource
): Promise<void> {
  const batchSize = LOCAL_EMBEDDING_MAX_BATCH_SIZE;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts: string[] = batch.map((chunk) => buildEmbeddingInput(headerSource, chunk.content));
    const embeddings = await embedBatchFn(texts);
    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding batch returned ${embeddings.length} results for ${batch.length} chunks`);
    }
    for (let j = 0; j < batch.length; j += 1) {
      const chunk = batch[j];
      const embedding = embeddings[j];
      await this.vectorStore.storeEmbedding({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        embedding: embedding.embedding,
        metadata: { chunkIndex: chunk.chunkIndex, pageNumber: chunk.pageNumber },
        vectorIndexPath,
      });
    }
  }
}
```

Update `generateChunkEmbeddings` (~line 302) and `fallbackToLocalEmbedding` (~line 396) to accept `headerSource: EmbeddingHeaderSource` and pass it to all three `embedAndStoreChunks` call sites (~lines 327, 346, 433). In `uploadDocument` (~line 150) and the re-embed path (~line 931), load the document row once and build:

```typescript
import { buildEmbeddingInput, type EmbeddingHeaderSource } from "@/service/knowledgeMetadataHeader";

function toHeaderSource(doc: { name: string; title?: string | null; author?: string | null; tags?: string | null; description?: string | null }): EmbeddingHeaderSource {
  let tags: string[] | undefined;
  try {
    const parsed: unknown = doc.tags ? JSON.parse(doc.tags) : undefined;
    if (Array.isArray(parsed)) {
      tags = parsed.filter((t: unknown): t is string => typeof t === "string");
    }
  } catch {
    tags = undefined;
  }
  return { fileName: doc.name, title: doc.title ?? undefined, author: doc.author ?? undefined, tags, description: doc.description ?? undefined };
}
```

Pass `toHeaderSource(document)` into `generateChunkEmbeddings`. A defaults-only document produces header-less text identical to today.

- [ ] **Step 2: Typecheck**

Run: `yarn vue-check 2>&1 | tail -n 20`
Expected: no new errors in `RagSearchModule.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/RagSearchModule.ts
git commit -m "feat: embed metadata header with chunk body while storing body only"
```

### Task 11: Search hits include author, tags, description

**Files:**
- Modify: `src/service/RagSearchTypes.ts`, `src/service/VectorSearchService.ts`, `src/modules/RagSearchModule.ts`

**Interfaces:**
- Consumes: `rag_documents.author/tags/description` via existing chunk+document join.
- Produces: `RagSearchCandidate.document {author?, description?, tags?}` and `KnowledgeSearchResultItem {author?, tags, description?}`; `content` stays body-only.

- [ ] **Step 1: Extend the types in `src/service/RagSearchTypes.ts`**

```typescript
document: {
  id: number;
  name: string;
  title?: string;
  fileType: string;
  author?: string;
  description?: string;
  tags?: string[];
};
```

```typescript
export interface KnowledgeSearchResultItem {
  citation: string;
  documentId: number;
  documentName: string;
  title?: string;
  fileType: string;
  author?: string;
  tags?: string[];
  description?: string;
  chunkId: number;
  chunkIndex: number;
  score: number;
  rerankScore?: number;
  content: string;
  matchType: "direct" | "neighbor";
}
```

- [ ] **Step 2: Extend `SearchResult.document` in `src/service/VectorSearchService.ts` (~line 24) the same way, and copy in `getDetailedResults` (~line 622)**

In `getDetailedResults`, after loading `document`, parse tags exactly like `KnowledgeLibraryAiTools` (JSON.parse, keep strings only) and attach:

```typescript
let tagList: string[] | undefined;
try {
  const parsed: unknown = document.tags ? JSON.parse(document.tags) : undefined;
  if (Array.isArray(parsed)) {
    tagList = parsed.filter((t: unknown): t is string => typeof t === "string");
  }
} catch {
  tagList = undefined;
}
// attach to each SearchResult.document:
author: document.author ?? undefined,
description: document.description ?? undefined,
tags: tagList,
```

- [ ] **Step 3: Copy through in `candidateToResultItem` (~line 1551) and both neighbor builders (~lines 1364, 1383)**

```typescript
private candidateToResultItem(candidate: RagSearchCandidate, matchType: "direct" | "neighbor"): KnowledgeSearchResultItem {
  return {
    citation: `[doc:${candidate.documentId} chunk:${candidate.metadata.chunkIndex} ${candidate.document.name}]`,
    documentId: candidate.documentId,
    documentName: candidate.document.name,
    title: candidate.document.title,
    fileType: candidate.document.fileType,
    author: candidate.document.author,
    tags: candidate.document.tags ?? [],
    description: candidate.document.description,
    chunkId: candidate.chunkId,
    chunkIndex: candidate.metadata.chunkIndex,
    score: candidate.combinedScore,
    rerankScore: candidate.rerankScore,
    content: candidate.content,
    matchType,
  };
}
```

Apply the same three fields where previous/next neighbor items are constructed. Citation format unchanged.

- [ ] **Step 4: Typecheck**

Run: `yarn vue-check 2>&1 | tail -n 20`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/service/RagSearchTypes.ts src/service/VectorSearchService.ts src/modules/RagSearchModule.ts
git commit -m "feat: return author tags description on knowledge search hits"
```

### Task 12: Tool descriptions + list-documents author filter

**Files:**
- Modify: `src/config/skillsRegistry.ts`, `src/service/KnowledgeLibraryAiTools.ts` (list path only if it owns the query)

**Interfaces:**
- Consumes: `findSearchableDocumentIds` (Task 8).
- Produces: model routes person names to `author`, labels to `tags`, topics to `query`; list tool accepts optional `author`.

- [ ] **Step 1: Update `knowledge_library_search` description (~line 2409)**

Replace with:

```text
Search the local knowledge library for factual information from uploaded documents. Use this before answering questions that require knowledge-base context. When the user names a person, put that name in `author`; when they name a label, put it in `tags`; put the topical words in `query`. Returns relevant passages with source citations; each hit includes `author`, `tags`, and `description`.
```

Keep all existing parameters unchanged.

- [ ] **Step 2: Update `knowledge_library_list_documents` description (~line 2493) and add `author`**

Description becomes:

```text
List documents in the local knowledge library. Returns compact metadata only (id, name, title, author, tags, status, size). Filter by author with the `author` substring, by `tags`, or by `query`.
```

Add parameter:

```typescript
author: { type: "string", description: "Filter by document author (case-insensitive substring)." },
```

Implement with the same case-insensitive substring rule as the search filter (via `findSearchableDocumentIds` or the existing list query — do NOT use `getDocuments` exact `author =` match). `listDocuments` in `KnowledgeLibraryAiTools.ts` (~line 347) gains an optional `author` arg applied after the existing scan-cap fetch or pushed into the ID query.

- [ ] **Step 3: Run the registry test**

Run: `yarn vitest --config vite.main.config.mjs run test/vitest/main/service/KnowledgeSearchTool.test.ts 2>&1 | tail -n 20`
Expected: PASS (existing registration/schema assertions; `author` now also asserted on the list tool after Task 14 extends it).

- [ ] **Step 4: Commit**

```bash
git add src/config/skillsRegistry.ts src/service/KnowledgeLibraryAiTools.ts
git commit -m "feat: document author tags usage on knowledge tools and filter list by author"
```

### Task 13: Document table shows author and tags

**Files:**
- Modify: `src/views/pages/knowledge/DocumentManagement.vue`

**Interfaces:**
- Consumes: `DocumentInfo {author?, tags?}` already returned by `getDocuments` IPC; `t('knowledge.author')`, `t('knowledge.tags')`.
- Produces: author + tags columns; blank author when missing/`User`; chips hiding defaults-only tags; text-only cells.

- [ ] **Step 1: Add headers and cells**

Headers (next to existing file columns):

```typescript
{ key: "author", title: t("knowledge.author") || "Author" },
{ key: "tags", title: t("knowledge.tags") || "Tags" },
```

Author cell: render `""` when `!doc.author || doc.author === "User"`, else plain text `doc.author`. Tags cell: when `!doc.tags || doc.tags.length === 0` render nothing; when tags are exactly `{uploaded, knowledge}` render nothing; otherwise render each remaining tag as a `v-chip` with plain text. No `v-html`.

- [ ] **Step 2: Run component suite**

Run: `yarn test:components 2>&1 | tail -n 20`
Expected: PASS (no existing table test to break; new dialog test from Task 6 still passes).

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/knowledge/DocumentManagement.vue
git commit -m "feat: show author and tags on knowledge document table"
```

### Task 14: Search + header tests gate Phase 2

**Files:**
- Modify: `test/vitest/main/service/KnowledgeSearchTool.test.ts`

**Interfaces:**
- Consumes: Tasks 7–11.
- Produces: PRD §16.2 gate (author exclusion, exact-tag rule, empty-success without vector call, hit metadata, embed-header vs stored-body).

- [ ] **Step 1: Extend the test file (keep existing registration tests, add retrieval cases)**

Add imports for `RagSearchModule`, `RAGDocumentModel`, `VectorSearchService`, and `buildEmbeddingInput`. Mock at the same level as the existing file (`electron`, `VectorStoreService`, `DocumentService`, `ChunkingService`, `SystemSettingModule`). New cases:

```typescript
test("author filter excludes other authors without opening their indexes", async () => {
  // seed two completed docs (Alice Chen vs Bob), mock findSearchableDocumentIds to return [aliceId],
  // spy on VectorSearchService.search to assert it never receives bobId
});

test("tag pricing matches Pricing and excludes pricing-old", async () => {
  // docs tagged ["Pricing"] vs ["pricing-old"]; request tags ["pricing"]; expect only the first
});

test("filters matching nothing return empty success without vector search", async () => {
  // resolveAllowedDocumentIds -> []; expect {success: true, results: []} and searchCandidates not called
});

test("hit includes author, tags, description with body-only content", async () => {
  // candidate with header-embedded vector; expect result.author/tags/description set and content not starting with "Title:"
});

test("embedding input starts with header while stored content is body-only", async () => {
  // assert the string passed to embedBatchFn starts with "Title:" and storeEmbedding received body-only content
});
```

Follow the existing file's mock style (no `any`; use `unknown` + type guards). If the file's current mocks make DB seeding hard, mock `RAGDocumentModel.prototype.findSearchableDocumentIds` and `VectorSearchService.prototype.search/searchCandidates` directly and assert the wiring + mapping rules.

- [ ] **Step 2: Run the search test**

Run: `yarn vitest --config vite.main.config.mjs run test/vitest/main/service/KnowledgeSearchTool.test.ts 2>&1 | tail -n 30`
Expected: PASS (all new + existing cases).

- [ ] **Step 3: Run the full gates**

Run: `yarn test:components 2>&1 | tail -n 10`
Run: `yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/knowledgeMetadataHeader.test.ts 2>&1 | tail -n 10`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add test/vitest/main/service/KnowledgeSearchTool.test.ts
git commit -m "test: gate knowledge metadata filters header and hit fields"
```
