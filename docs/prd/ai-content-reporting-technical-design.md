# AiFetchly AI-Generated Content Reporting — Technical Design

**Companion to:** `ai-content-reporting-prd.md`
**Status:** Draft v1.0 · 2026-08-27

This document fills the technical-design slot referenced by the PRD. It is
derived from the PRD contract (§12) and the concrete integration points found
in the current codebase. Each module below names the exact file it lives in and
the existing pattern it mirrors.

---

## 1. Architecture Overview

```
┌─────────────────────────────── RENDERER (Vue 3 + Vuetify) ───────────────────────────────┐
│  AIContentReportButton.vue   ← inserted next to every AI-output surface                    │
│        │ emits "report" with a ReportableOutputDescriptor                                   │
│        ▼                                                                                    │
│  AIContentReportDialog.vue  ← owns form state, category, comment, image selection,          │
│                               clientReportId (uuid once per open), success/error UI        │
│        │ submits via                                                                        │
│        ▼                                                                                    │
│  src/views/api/aiContentReport.ts  → windowInvoke(AI_CONTENT_REPORT_CREATE, request)        │
└─────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                              │ contextBridge IPC (preload allowlist)
┌─────────────────────────────────────────────▼──────────────────────────────────────────────┐
│  MAIN PROCESS                                                                               │
│  ai-content-report-ipc.ts  → registerValidatedHandler (NOT registerAiValidatedHandler)       │
│        │  zod safeParse on the renderer payload (boundary)                                  │
│        ▼                                                                                    │
│  AIContentReportService.ts  → evidence normalization + context assembly + HTTP POST        │
│        │  uses HttpClient (existing, auth + refresh) → POST /api/ai/content-reports        │
│        ▼                                                                                    │
│  Backend (marketing repo) — ingest queue + admin review                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Key invariants (from PRD §13, §14):

- The IPC handler uses `registerValidatedHandler`, **never**
  `registerAiValidatedHandler`. Reporting is a safety function and must remain
  available when `USER_AI_ENABLED !== "true"`.
- The handler **never** touches TypeORM/desktop SQLite (PRD §13.2, §5.6). The
  backend is the sole source of truth.
- No report content (text, comment, image bytes, conversation context) is
  written to renderer console, main logs, analytics, or crash reports. Logs may
  contain only `clientReportId`, `reportId`, surface, category, appVersion,
  HTTP result, duration.
- `clientReportId` is generated **once** when the dialog opens and reused for
  every retry until success or cancellation — backend treats repeats as
  idempotent and returns the original `reportId` with `duplicate: true`.

---

## 2. File Layout

```text
src/entityTypes/aiContentReportTypes.ts          # enums + request/response TS types
src/schemas/ipc/aiContentReport.ts                # Zod schemas (lazySchema-wrapped)
src/service/AIContentReportService.ts            # evidence normalization + HTTP submit
src/service/AIContentReportErrorMapper.ts        # HTTP status → safe error code
src/views/components/aiContentReport/AIContentReportImageEncoder.ts  # renderer-side canvas image preview encoder
src/main-process/communication/ai-content-report-ipc.ts
src/config/channellist.ts                         # + AI_CONTENT_REPORT_CREATE
src/preload.ts                                    # + allowlist entry
src/views/api/aiContentReport.ts                  # windowInvoke wrapper
src/views/components/aiContentReport/AIContentReportButton.vue
src/views/components/aiContentReport/AIContentReportDialog.vue
src/views/components/aiContentReport/reportableOutput.ts   # ReportableOutputDescriptor type + builder
src/views/lang/en.ts  zh.ts  es.ts  fr.ts  de.ts  ja.ts    # + aiContentReport.* keys

# Surface integrations (P0)
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/components/aiChatV2/AiChatV2PlanApprovalCard.vue
src/views/components/aiChat/AiChatBox.vue
src/views/pages/knowledge/ChatInterface.vue
src/views/components/aiArtifacts/AiArtifactCard.vue
src/views/pages/emailmarketing/template/templatedetail.vue

# Tests
test/vitest/main/aiContentReportService.test.ts
test/vitest/main/aiContentReportIpc.test.ts
test/vitest/utilitycode/aiContentReportSchema.test.ts
test/vitest/utilitycode/aiContentReportImageEncoder.test.ts
test/vitest/utilitycode/aiContentReportErrorMapper.test.ts
```

---

## 3. Data Contract (`src/entityTypes/aiContentReportTypes.ts`)

Mirrors PRD §12 exactly. Enums are `as const` tuples so Zod can reuse them and
`z.infer` derives the union types.

```ts
export const AI_CONTENT_REPORT_CATEGORIES = [
  "hate_or_harassment", "sexual_content", "violence_or_self_harm",
  "child_safety", "illegal_or_dangerous", "privacy_or_personal_data",
  "misinformation_or_deception", "copyright_or_ownership", "other",
] as const;
export type AIContentReportCategory = typeof AI_CONTENT_REPORT_CATEGORIES[number];

export const AI_CONTENT_TYPES = [
  "text", "image", "mixed", "plan", "artifact", "email_template", "keyword_set",
] as const;
export type AIContentType = typeof AI_CONTENT_TYPES[number];

export const AI_OUTPUT_SURFACES = [
  "chat_v2", "legacy_chat", "knowledge_chat", "ai_artifact",
  "email_template_editor", "keyword_generator", "automatic_email_reply", "other",
] as const;
export type AIOutputSurface = typeof AI_OUTPUT_SURFACES[number];

export interface AIContentReportImagePreview {
  mimeType: "image/jpeg" | "image/webp" | "image/png";
  dataBase64: string;
  width: number;
  height: number;
  sha256?: string;
}
export interface AIContentReportOutput {
  text?: string;
  textTruncated?: boolean;
  imagePreviews?: AIContentReportImagePreview[];
  evidenceUnavailable?: boolean;
}
export interface AIContentReportContext {
  conversationId?: string;
  messageId?: string;
  artifactId?: string;
  model?: string;
  generatedAt?: string;
  appVersion: string;
  platform: "win32" | "darwin" | "linux";
  locale: string;
  installId?: string;
}
export interface CreateAIContentReportRequest {
  schemaVersion: 1;
  clientReportId: string;
  surface: AIOutputSurface;
  contentType: AIContentType;
  category: AIContentReportCategory;
  comment?: string;
  output: AIContentReportOutput;
  context: AIContentReportContext;
}
export interface CreateAIContentReportResponse {
  reportId: string;        // air_...
  status: "submitted";
  receivedAt: string;
  duplicate: boolean;
}
/** Safe, localized error code surfaced to the UI. */
export type AIContentReportErrorCode =
  | "network" | "auth_failed" | "invalid_evidence" | "payload_too_large"
  | "rate_limited" | "service_disabled" | "server_error" | "unknown";
```

---

## 4. Zod Schema (`src/schemas/ipc/aiContentReport.ts`)

Mirrors `src/schemas/ipc/dashboard.ts` — `lazySchema`-wrapped so the
`zodToJsonSchema` WeakMap cache stays warm. Enforces every bound in PRD §12 +
§FR-3:

- `schemaVersion === 1` literal
- `comment` ≤ 2000 chars
- `output.text` ≤ 32000 chars
- `imagePreviews[]` ≤ 3, each decoded-base64 ≤ 1 MiB (enforced via
  `Buffer.byteLength(dataBase64, "base64")` refine), dimensions positive ints,
  mimeType enum
- at-least-one-evidence refine (text XOR imagePreviews XOR evidenceUnavailable;
  evidenceUnavailable alone requires non-empty `comment`)
- `context` field max lengths (128/128/128/128/64/32)
- reject extra keys with `z.strictObject`

The inferred type is re-exported as `CreateAIContentReportRequest` so callers
get static types for free (no hand-mirrored interface).

---

## 5. Service Layer

### 5.1 `AIContentReportService.ts`

Responsibilities (PRD FR-3, FR-4.5–4.8):

1. `assembleContext(partial)` → fill `appVersion` (via `getAppVersion()`
   helper, mirroring `diagnostics-ipc.ts`), `platform = process.platform`,
   `locale` from `useI18n().locale` passed in by the renderer, `installId`
   via `getOrCreateInstallId()` from `@/modules/diagnostics/DiagnosticIdentity`
   (the stable install id already used by diagnostics — PRD FR-4.6).
2. `normalizeText(text)` → truncate to 32000 preserving beginning+end and set
   `textTruncated`.
3. `submitReport(req)` → `new HttpClient().postJson<...>("/api/ai/content-reports", req)`.
   HttpClient already handles baseUrl (`/apis`), Bearer token via `Token`,
   and 401/403 refresh-retry. On response, map via `AIContentReportErrorMapper`.
   On `duplicate: true`, surface the original `reportId` (idempotent, PRD FR-4.8).
4. **Logging boundary:** only `log.info("[ai-content-report] submitted", {
   clientReportId, reportId, surface, category, httpStatus, durationMs })`.
   Never log `output`, `comment`, image bytes, `conversationId`, model, or
   tokens. Mirrors PRD §14.4 + diagnostics pattern.

### 5.2 `AIContentReportImageEncoder.ts` (PRD FR-3.5, FR-3.6)

Renderer-side, dependency-free (browser Canvas API — no `sharp`, which the base
app bundle deliberately excludes). Lives at
`src/views/components/aiContentReport/AIContentReportImageEncoder.ts`.
`encodeReportImagePreview(source): Promise<AIContentReportImagePreview | null>`:

- Accepts a `{ dataBase64; mimeType }` source built from the generated-image
  bytes the user selected.
- **Rejects** SVG, HTML, non-image MIME, `file://`, `aifetchly-generated-image:`
  protocol, and any path/URL that is not the selected generated-image metadata
  itself (PRD §14.6).
- Decode via `createImageBitmap` → resize so longest edge ≤ 1024px (reusing
  the shared `computeScaledDimensions` in `utils/imageScaling.ts`) → re-encode
  to JPEG (PNG preserved for transparency) via `canvas.toBlob`. Progressive
  quality reduction (0.82 → 0.6 → 0.4 → 0.25) to stay under the 1 MiB decoded
  cap; if still over, returns null.
- Mirrors the canvas pattern already proven in
  `views/components/aiChatV2/imageScaleUtil.ts`.
- Returns null on any failure → caller sets `evidenceUnavailable: true` and
  shows the localized "image could not be attached" notice (PRD FR-3.7, §11.1).

### 5.3 `AIContentReportErrorMapper.ts`

Maps `HTTP status / fetch error` → `AIContentReportErrorCode` (PRD FR-5.4):

| Source | Code |
| --- | --- |
| fetch TypeError (offline/DNS) | `network` |
| 400 / 422 | `invalid_evidence` |
| 401 / 403 (after refresh retry exhausted) | `auth_failed` |
| 413 | `payload_too_large` |
| 429 | `rate_limited` |
| 503 | `service_disabled` |
| other 5xx | `server_error` |
| fallback | `unknown` |

Mirrors the structure of `src/service/AIChatErrorMapper.ts` but with a
report-specific, privacy-safe code set.

---

## 6. IPC Handler (`src/main-process/communication/ai-content-report-ipc.ts`)

Mirrors `dashboard-ipc.ts`:

```ts
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { createAIContentReportSchema } from "@/schemas/ipc/aiContentReport";
import { AIContentReportService } from "@/service/AIContentReportService";
import { AI_CONTENT_REPORT_CREATE } from "@/config/channellist";

export function registerAIContentReportIpcHandlers(): void {
  registerValidatedHandler(
    AI_CONTENT_REPORT_CREATE,
    createAIContentReportSchema,
    async (input) => {
      const service = new AIContentReportService();
      return service.submitReport(input);  // returns CreateAIContentReportResponse
    },
  );
}
```

Registered in `src/main-process/communication/index.ts` alongside the other
`register*()` calls. The wrapper already returns the `{ status, msg, data }`
envelope; on validation failure it returns `status:false` without executing.

**Worker guard:** the service is only ever instantiated from the main-process
IPC handler. It uses `HttpClient`, which already refuses to run DB/refresh
logic when `process.env.WORKER_TYPE` is set. No report channel is exposed to
child processes (PRD FR-4.7).

---

## 7. Preload + Channel (`src/config/channellist.ts`, `src/preload.ts`)

`channellist.ts`:

```ts
export const AI_CONTENT_REPORT_CREATE = "ai:content:report:create";
```

`preload.ts` — add `AI_CONTENT_REPORT_CREATE` to the `invoke` `validChannels`
array (the same array that already lists `DASHBOARD_*`, `EMAIL_*`, etc.).
The generic `invoke` bridge already returns `ipcRenderer.invoke(channel, data)`,
so no new `contextBridge.exposeInMainWorld` surface is needed — consistent with
how dashboard/email-receive channels work.

---

## 8. Frontend API (`src/views/api/aiContentReport.ts`)

Mirrors `src/views/api/dashboard.ts`:

```ts
import { windowInvoke } from "@/views/utils/apirequest";
import { AI_CONTENT_REPORT_CREATE } from "@/config/channellist";
import type { CreateAIContentReportRequest, CreateAIContentReportResponse, AIContentReportErrorCode } from "@/entityTypes/aiContentReportTypes";

export async function createAIContentReport(
  request: CreateAIContentReportRequest
): Promise<CreateAIContentReportResponse> {
  return await windowInvoke(AI_CONTENT_REPORT_CREATE, request);
}
```

`windowInvoke` already throws on `status:false` with the envelope `msg`; the
dialog catches and maps via the error mapper's code set.

---

## 9. Vue Components

### 9.1 `ReportableOutputDescriptor` (`reportableOutput.ts`)

A typed, serializable snapshot handed to the button. Built **at the call
site** from the message/artifact the user is reporting — never a live pointer
to reactive state (PRD FR-3.1).

```ts
export interface ReportableOutputDescriptor {
  surface: AIOutputSurface;
  contentType: AIContentType;
  /** Bounded text snapshot (will be truncated to 32000 in service). */
  text?: string;
  /** Generated-image sources for preview encoding. */
  images?: Array<{ dataBase64?: string; mimeType?: string; externalUrl?: string }>;
  context: {
    conversationId?: string;
    messageId?: string;
    artifactId?: string;
    model?: string;
    generatedAt?: string;
  };
}
```

Builder helpers per surface live in the same file:
`buildChatV2Descriptor(message)`, `buildArtifactDescriptor(artifact)`,
`buildPlanDescriptor(...)`, `buildEmailTemplateDescriptor(...)`.

### 9.2 `AIContentReportButton.vue`

- `<v-btn variant="text" size="small">` with `mdi-flag-outline` + visible text
  **Report AI output** on primary surfaces (PRD FR-1.3, §21 risk 1).
- `aria-label="Report this AI-generated output"` (PRD §11.4).
- Props: `descriptor: ReportableOutputDescriptor`, `reported?: boolean`.
- On click → emits `report` with the descriptor (parent owns dialog mount, so
  one dialog per surface region avoids stacked-dialog focus races).
- When `reported` is true → disabled + label **Reported** (PRD FR-1.4, §9.1).
- `script setup lang="ts"`, Composition API — matches `AiArtifactCard.vue`.

### 9.3 `AIContentReportDialog.vue`

Mirrors `WorkspaceMemoryEditorDialog.vue` structure (`v-dialog` +
`model-value` + `@update:model-value`). Features:

- Title **Report AI output** (FR-2.1).
- Read-only, escaped preview (`{{ descriptor.text }}` in a `<div>`, **never**
  `v-html` — PRD FR-2.2, §14.5).
- `v-select` category from the enum (FR-2.3), required.
- `v-textarea` comment, `counter="2000"`, `maxlength="2000"` (FR-2.4).
- For `images.length > 1`: thumbnail grid with per-image `v-checkbox` and
  alt text; require ≥1 selected (FR-2.7). For a single image, auto-include.
- Transmission notice adjacent to Submit (FR-2.5, §11.1 "Consent").
- Optional privacy-policy link (FR-2.6) — not a precondition.
- Submit button: disabled while in flight (FR-1.5); on success show
  `Report submitted. Reference: {reportId}` + Copy-reference action (FR-5.1/5.2).
  On failure: keep all fields, show localized error + **Try again**
  (FR-5.4, §9.4). Closing before submit sends nothing (FR-2.8).
- Generates `clientReportId = crypto.randomUUID()` once on open; reuses on
  retry (PRD §13.2, FR-4.8).
- Accessibility (§11): `@update:model-value` moves focus to heading on open
  and back to the button on close; category + submission errors announced via
  `aria-live="polite"` region; works at 1366×768 / 200% scale.

### 9.4 Surface integrations

Each integration adds `<AIContentReportButton :descriptor="..." @report="..." />`
plus a single mounted `<AIContentReportDialog>` at the page/container root.

| Surface | Descriptor source | Placement |
| --- | --- | --- |
| AiChatV2Message.vue | `buildChatV2Descriptor(message)` for assistant text/image branch (role==='assistant' && messageType!=='TOOL_*') | below the message bubble, in the actions row |
| AiChatV2PlanApprovalCard.vue | `buildPlanDescriptor(...)` | card actions row, visible while pinned **and** after it moves to history (FR-1.6) |
| AiChatBox.vue (legacy) | `buildChatV2Descriptor(message)` | beside Copy/Regenerate/Like |
| ChatInterface.vue (knowledge) | same | beside Copy/Regenerate/Like |
| AiArtifactCard.vue | `buildArtifactDescriptor(artifact)` | card `__actions` row next to Open/Copy |
| templatedetail.vue | `buildEmailTemplateDescriptor(generatedSubject, generatedBody)` | next to generated-content controls before Save/Send (§9.3) |

The button is **hidden** (not shown) for: user messages, system messages, tool
calls, tool results, typing indicators, permission prompts, empty
placeholders, and editor fields whose AI provenance is lost (PRD FR-1.2, §13.2).

---

## 10. i18n (`src/views/lang/*.ts`)

Add a top-level `aiContentReport` block to **all six** files (en/zh/es/fr/de/ja)
matching the §11.1 English source table:

```ts
aiContentReport: {
  action: "Report AI output",
  actionAriaLabel: "Report this AI-generated output",
  dialogTitle: "Report AI output",
  categoryLabel: "What is wrong with this output?",
  commentLabel: "Additional details (optional)",
  consent: "The selected AI output and your description will be sent to AiFetchly for review. Your prompt, other messages, files, and AI reasoning will not be included.",
  submit: "Submit report",
  cancel: "Cancel",
  tryAgain: "Try again",
  copyReference: "Copy reference",
  success: "Report submitted. Reference: {reportId}",
  reported: "Reported",
  imageUnavailable: "This image could not be attached. You can still submit the report with your description.",
  categoryOther: "Other",
  errors: {
    network: "The report could not be submitted. Your details have been kept so you can try again.",
    auth_failed: "Authentication failed. Your details have been kept so you can try again.",
    invalid_evidence: "The report evidence was invalid. Your details have been kept so you can try again.",
    payload_too_large: "The report payload is too large. Your details have been kept so you can try again.",
    rate_limited: "Too many reports were submitted. Please try again later.",
    service_disabled: "Reporting is temporarily unavailable. Please try again later.",
    server_error: "The report could not be submitted. Your details have been kept so you can try again.",
    unknown: "The report could not be submitted. Your details have been kept so you can try again.",
  },
  categories: { hate_or_harassment: "...", sexual_content: "...", /* …9 keys */ other: "Other" },
}
```

Components use `t('aiContentReport.action') || 'Report AI output'` with English
fallback (PRD §11.8).

---

## 11. Testing (PRD §18)

Mirrors the two-tier vitest pattern (`test/vitest/main` + `utilitycode`) plus
the `aiArtifactIpc.test.ts` IPC-mock style:

- **Schema tests** (`utilitycode/aiContentReportSchema.test.ts`): accept every
  valid category/content/surface combo; reject unknown keys; enforce text
  32000 truncation flag; reject >3 images, >1MiB decoded, bad MIME, paths,
  `file://`; reject empty-evidence; reject `evidenceUnavailable` without comment.
- **Image encoder tests** (`utilitycode/aiContentReportImageEncoder.test.ts`):
  resize to ≤1024px longest edge; reject SVG/HTML/non-image; cap 1MiB; sha256
  stable; null on failure.
- **Error mapper tests** (`utilitycode/aiContentReportErrorMapper.test.ts`):
  400/401/403/413/429/503/5xx/network → correct codes.
- **Service tests** (`main/aiContentReportService.test.ts`): request
  construction excludes prompts/reasoning/attachments/tool-args/neighbor
  messages; `clientReportId` reused across retry; duplicate response surfaces
  original `reportId`; metadata-only logging (spy on `log.info` and assert no
  `output`/`comment` keys).
- **IPC tests** (`main/aiContentReportIpc.test.ts`): mock `AIContentReportService`,
  register via the `ipcMain.handle` capture map (like `aiArtifactIpc.test.ts`);
  validate-before-network; works with `isAiEnabled() === false` (assert the
  handler does **not** import `registerAiValidatedHandler`); duplicate treated
  as success.

Component + integration + localization + certification tests are described in
PRD §18.2–18.5 and will be added incrementally.

---

## 12. Phasing (aligns with PRD §16 Phase 1 Store-blocking path)

This implementation delivers Phase 1 items 1–5 (desktop side). Phase 1 item 6
(live backend queue) and item 7 (Store metadata/privacy policy/screenshots/cert
notes) are owned by the marketing/backend PRD and the release checklist
respectively — they are listed as follow-ups, not coded here.

1. **Foundation:** types, Zod schema, channel, preload, frontend API, error
   mapper, image encoder, service. + unit tests.
2. **Shared UI:** button + dialog + descriptor builder + i18n (all 6 langs).
3. **P0 surfaces:** Chat V2 (text/image/plan), legacy chat, knowledge chat,
   artifacts, email-template editor.
4. **IPC + integration tests;** surface-audit note for P1 (keyword generation,
   auto-reply audit, website-analysis) recorded in the release checklist.

---

## 13. Decisions & Rationale

- **One dialog per surface region** (not a single global dialog) so focus
  return-to-origin is unambiguous and stacked dialogs never occur.
- **Descriptor built at the call site**, not from a global message store, so the
  snapshot is exactly the displayed output and cannot accidentally capture
  neighboring messages (PRD §3.4, FR-3.4).
- **Image preview re-encoded in main process** (service layer) rather than the
  renderer: keeps the raw bytes and resize logic off the renderer thread and
  lets us reuse `crypto`/`Buffer` without Electron-in-renderer caveats.
- **`registerValidatedHandler` not `registerAiValidatedHandler`** is the single
  most load-bearing decision — it is what makes the feature survive an expired
  subscription / disabled hosted AI (PRD §9.5, §14.9, FR-4.4).
- **No SQLite entity** — PRD §5.6 explicitly forbids local report storage; the
  backend is the source of truth. This also means no migration / `yarn init`
  change.
