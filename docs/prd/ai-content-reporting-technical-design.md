# AiFetchly AI-Generated Content Reporting Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Draft for implementation |
| Created | 2026-08-27 |
| Owner | AiFetchly desktop engineering |
| Source PRD | `docs/prd/ai-content-reporting-prd.md` |
| Backend companion | Marketing repository: `doc/ai-content-reporting-backend-technical-design.md` |
| Policy driver | Microsoft Store Policies 11.16, Live Generative AI Content |
| Target | Windows Store build first; behavior remains consistent on Windows and macOS |

## 1. Purpose

This document translates the AiFetchly AI-content reporting PRD into an implementation design for the Electron main process, preload bridge, Vue renderer, and shared TypeScript contracts.

The feature adds a report action beside each completed, user-visible AI output. The renderer snapshots only the selected output, shows a consent dialog, and submits a strictly bounded request through validated Electron IPC. The main process validates the request again and sends it to the marketing backend without invoking an AI model, consuming credits, or requiring hosted-AI entitlement.

The implementation is complete only when a Microsoft Store reviewer can:

1. find the report action beside an AI output;
2. understand what evidence will be sent;
3. submit the report successfully;
4. receive an `air_...` reference; and
5. have the backend operator locate and action that report.

## 2. Design Constraints

1. Reporting is a safety function, not an AI-generation function.
2. Use `registerValidatedHandler`, never `registerAiValidatedHandler`.
3. Do not read or write the desktop SQLite database for this feature.
4. Do not submit prompts, conversation history, reasoning, tool arguments, tool results, files, cookies, tokens, or local paths.
5. The renderer owns UI state and output selection. The main process owns the remote network call.
6. The backend is the report source of truth. The desktop stores no report queue in v1.
7. A manual retry reuses the same `clientReportId` so it is idempotent, meaning a repeated request does not create a second report.
8. All new user-facing text must exist in English, Chinese, Spanish, French, German, and Japanese.
9. New TypeScript uses explicit types and `unknown`; it must not introduce `any`.
10. Worker and child processes never submit reports directly.

## 3. Current System and Integration Points

### 3.1 Electron IPC

The renderer invokes main-process functions through the generic `window.api.invoke(channel, data)` bridge in `src/preload.ts`. Invoke channels are explicitly allowlisted. Main-process handler registration is centralized in `src/main-process/communication/index.ts`.

`src/main-process/communication/_shared/registerValidatedHandler.ts` already provides:

- JSON-string compatibility for `windowInvoke` callers;
- Zod validation;
- a `CommonMessage<T>` response envelope;
- safe validation errors; and
- handler exception capture.

The feature adds one invoke channel:

```text
ai-content-report:create
```

Constant name:

```typescript
AI_CONTENT_REPORT_CREATE
```

### 3.2 Remote HTTP

`src/modules/lib/httpclient.ts` resolves the configured login base, adds `/apis`, attaches a bearer token when available, and supports access-token refresh. The logical backend endpoint is:

```text
POST /api/ai/content-reports
```

The final URL produced by `HttpClient` is:

```text
{VITE_LOGIN_URL}/apis/api/ai/content-reports
```

The request remains valid without a bearer token when it includes the stable install identifier in `X-AiFetchly-Install-Id`.

### 3.3 Reportable surfaces

P0 integration points are:

| Surface | Current component | Reportable unit |
| --- | --- | --- |
| Chat V2 text and generated images | `src/views/components/aiChatV2/AiChatV2Message.vue` | One completed assistant message |
| Chat V2 plan | `src/views/components/aiChatV2/AiChatV2PlanApprovalCard.vue` | One generated plan version |
| AI artifact card/workspace | `src/views/components/aiArtifacts/AiArtifactCard.vue`, `AiArtifactWorkspace.vue` | One artifact snapshot |
| Legacy chat | `src/views/components/aiChat/AiChatBox.vue` | One completed assistant response |
| Knowledge chat | `src/views/pages/knowledge/ChatInterface.vue` | One AI response |
| Email-template generator | `src/views/pages/emailmarketing/template/templatedetail.vue` | Generated subject/body before user edits |

P1 adapters use the same shared report descriptor for keyword sets, automatic email replies, and other AI narrative output.

## 4. Target Architecture

```text
AI output component
  -> creates immutable ReportableAIOutput descriptor
  -> AIContentReportButton
  -> AIContentReportDialog
       category + optional comment + evidence selection
       renderer-side text/image snapshot builder
       |
       v
src/views/api/aiContentReport.ts
  -> windowInvoke(AI_CONTENT_REPORT_CREATE, request)
       |
       v
preload invoke allowlist
       |
       v
ai-content-report-ipc.ts
  -> registerValidatedHandler
  -> Zod validation
  -> AIContentReportClient
       |
       v
HttpClient + optional bearer token + install ID header
  -> POST /api/ai/content-reports
       |
       v
marketing backend
  -> { reportId, status: "submitted", receivedAt, duplicate }
```

### 4.1 Trust boundaries

| Boundary | Trusted responsibility | Untrusted input |
| --- | --- | --- |
| AI surface to shared dialog | Identifies the displayed output | Text, model output, URLs, metadata |
| Renderer to main IPC | User intent and prepared preview | Entire IPC payload |
| Main process to backend | Auth/install headers and bounded JSON | Renderer-provided evidence |
| Backend response to renderer | Typed success/error mapping | Remote JSON and status codes |

Renderer validation improves user feedback. Main-process validation is mandatory because a compromised renderer can call any allowlisted IPC channel. Backend validation remains authoritative because desktop packages are user-controlled clients.

## 5. File Layout

### 5.1 New files

```text
src/entityTypes/aiContentReportTypes.ts
src/schemas/ipc/aiContentReport.ts
src/service/aiContentReport/AIContentEvidenceBuilder.ts
src/service/aiContentReport/AIContentImagePreview.ts
src/service/aiContentReport/AIContentReportError.ts
src/service/aiContentReport/AIContentReportClient.ts
src/main-process/communication/ai-content-report-ipc.ts
src/views/api/aiContentReport.ts
src/views/components/aiContentReport/AIContentReportButton.vue
src/views/components/aiContentReport/AIContentReportDialog.vue
src/views/components/aiContentReport/useAIContentReport.ts
```

### 5.2 Modified files

```text
src/config/channellist.ts
src/preload.ts
src/main-process/communication/index.ts
src/modules/lib/httpclient.ts
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/components/aiChatV2/AiChatV2PlanApprovalCard.vue
src/views/components/aiArtifacts/AiArtifactCard.vue
src/views/components/aiArtifacts/AiArtifactWorkspace.vue
src/views/components/aiChat/AiChatBox.vue
src/views/pages/knowledge/ChatInterface.vue
src/views/pages/emailmarketing/template/templatedetail.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

### 5.3 Test files

```text
test/vitest/utilitycode/aiContentReport.schema.test.ts
test/vitest/utilitycode/aiContentEvidenceBuilder.test.ts
test/vitest/utilitycode/aiContentImagePreview.test.ts
test/vitest/utilitycode/aiContentReportApi.test.ts
test/vitest/main/aiContentReportIpc.test.ts
test/vitest/main/preloadInvokeAllowlist.test.ts
test/vitest/main/components/AIContentReportDialog.test.ts
test/vitest/main/components/AiChatV2Message.report.test.ts
```

## 6. Canonical TypeScript Contract

Define the complete shared contract in `src/entityTypes/aiContentReportTypes.ts`. Renderer components import descriptor types. The IPC schema and main-process client import wire types.

### 6.1 Enums

```typescript
export const AI_CONTENT_REPORT_CATEGORIES = [
  "hate_or_harassment",
  "sexual_content",
  "violence_or_self_harm",
  "child_safety",
  "illegal_or_dangerous",
  "privacy_or_personal_data",
  "misinformation_or_deception",
  "copyright_or_ownership",
  "other",
] as const;

export type AIContentReportCategory =
  (typeof AI_CONTENT_REPORT_CATEGORIES)[number];

export const AI_CONTENT_TYPES = [
  "text",
  "image",
  "mixed",
  "plan",
  "artifact",
  "email_template",
  "keyword_set",
] as const;

export type AIContentType = (typeof AI_CONTENT_TYPES)[number];

export const AI_CONTENT_SURFACES = [
  "chat_v2",
  "legacy_chat",
  "knowledge_chat",
  "ai_artifact",
  "email_template_editor",
  "keyword_generator",
  "automatic_email_reply",
  "other",
] as const;

export type AIContentSurface = (typeof AI_CONTENT_SURFACES)[number];
```

Do not duplicate string unions inside components. Every surface adapter uses these exported constants.

### 6.2 Reportable output descriptor

The descriptor is a renderer-only input to the shared UI. It may contain display references that are converted before IPC.

```typescript
export interface ReportableAIImageSource {
  readonly id: string;
  readonly src: string;
  readonly alt?: string;
}

export interface ReportableAIOutput {
  readonly surface: AIContentSurface;
  readonly contentType: AIContentType;
  readonly text?: string;
  readonly images?: readonly ReportableAIImageSource[];
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly artifactId?: string;
  readonly model?: string;
  readonly generatedAt?: string;
}
```

Rules:

- Construct a new descriptor from displayed values when the user opens the dialog.
- Do not pass a mutable store object or full message object.
- Do not add prompt, reasoning, attachments, tools, workspace, or provider credentials to this interface.
- `src` is renderer-only and must never cross IPC.

### 6.3 Wire request

```typescript
export interface AIContentImagePreview {
  readonly mimeType: "image/jpeg" | "image/webp" | "image/png";
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface AIContentReportRequest {
  readonly schemaVersion: 1;
  readonly clientReportId: string;
  readonly surface: AIContentSurface;
  readonly contentType: AIContentType;
  readonly category: AIContentReportCategory;
  readonly comment?: string;
  readonly output: {
    readonly text?: string;
    readonly textTruncated: boolean;
    readonly imagePreviews: readonly AIContentImagePreview[];
    readonly evidenceUnavailable: boolean;
  };
  readonly context: {
    readonly conversationId?: string;
    readonly messageId?: string;
    readonly artifactId?: string;
    readonly model?: string;
    readonly generatedAt?: string;
    readonly appVersion: string;
    readonly platform: "win32" | "darwin" | "linux";
    readonly locale: string;
  };
}
```

### 6.4 Renderer-to-main IPC input

The renderer does not supply authoritative app version or platform values. Define a separate IPC input type:

```typescript
export type AIContentReportIPCInput = Omit<
  AIContentReportRequest,
  "context"
> & {
  readonly context: Omit<
    AIContentReportRequest["context"],
    "appVersion" | "platform"
  >;
};
```

The main process converts this input into `AIContentReportRequest` by adding `app.getVersion()` and `process.platform`.

### 6.5 Wire response

```typescript
export interface AIContentReportResult {
  readonly reportId: string;
  readonly status: "submitted";
  readonly receivedAt: string;
  readonly duplicate: boolean;
}
```

The main-process handler returns `AIContentReportResult` as `CommonMessage.data`. `windowInvoke` unwraps that value for the renderer.

## 7. IPC Schema

Create `src/schemas/ipc/aiContentReport.ts` with `lazySchema` and `z.strictObject` at every object boundary. Export two schemas:

- `aiContentReportIPCInputSchema` for renderer input without authoritative desktop fields;
- `aiContentReportRequestSchema` for the complete outbound backend request after main-process enrichment.

```typescript
const imagePreviewSchema = z.strictObject({
  mimeType: z.enum(["image/jpeg", "image/webp", "image/png"]),
  dataBase64: z.string().min(1).max(1_500_000),
  width: z.number().int().min(1).max(1024),
  height: z.number().int().min(1).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
```

The full schema enforces:

| Field | Main-process validation |
| --- | --- |
| `schemaVersion` | Literal `1` |
| `clientReportId` | UUID |
| `surface` | Canonical enum |
| `contentType` | Canonical enum |
| `category` | Canonical enum |
| `comment` | Trimmed, maximum 2,000 Unicode code points |
| `output.text` | Maximum 32,000 Unicode code points |
| `imagePreviews` | Maximum three entries |
| Per-image base64 | Encoded ceiling consistent with 1 MiB decoded data |
| Width/height | Integer 1 through 1,024 |
| Context IDs/model | Maximum 128 characters |
| `locale` | 1 through 32 characters |
| `generatedAt` | RFC3339 string when present |

The complete outbound schema also requires `appVersion` from 1 through 64 characters and `platform` as `win32`, `darwin`, or `linux`. The main process runs this second validation after adding those fields and before making the HTTP request.

Zod string `.max()` counts JavaScript UTF-16 code units, not Unicode code points. Add a reusable refinement based on `Array.from(value).length` for the PRD's user-facing character limits.

Cross-field refinement enforces:

1. text, at least one image, or `evidenceUnavailable=true` is present;
2. evidence-unavailable-only requests have a non-empty comment;
3. `image` content includes an image unless evidence is unavailable;
4. `mixed` accurately describes text/image presence; and
5. the estimated decoded image total does not exceed 3 MiB.

The main process does not trust the renderer-provided SHA-256 for security. The backend recomputes it. The client hash supports request consistency and deterministic tests.

## 8. Shared UI Components

### 8.1 `AIContentReportButton.vue`

Props:

```typescript
interface Props {
  readonly output: ReportableAIOutput;
  readonly density?: "default" | "compact";
  readonly disabled?: boolean;
}
```

Behavior:

- render only when the parent has a completed reportable output;
- default variant uses an alert/flag icon and translated text;
- compact variant keeps an accessible label and tooltip;
- open the dialog on click or keyboard activation;
- disable while submitting;
- show `Reported` after success for the component lifetime;
- do not replace the output or navigate away after success.

The component does not make network calls directly. It opens `AIContentReportDialog.vue` through the composable.

### 8.2 `AIContentReportDialog.vue`

Dialog sections:

1. translated title and short purpose;
2. escaped, read-only evidence preview;
3. radio group with all categories;
4. optional comment field with live remaining count;
5. selected generated-image thumbnails when present;
6. transmission notice;
7. privacy-policy link;
8. Cancel and Submit report actions;
9. inline error or success reference.

State:

```typescript
type DialogState =
  | "editing"
  | "preparing_evidence"
  | "submitting"
  | "succeeded"
  | "failed";
```

Transitions:

```text
closed -> editing
editing -> preparing_evidence -> submitting -> succeeded
                             \-> failed -> preparing_evidence
editing -> closed
succeeded -> closed
```

Closing during `preparing_evidence` or `submitting` asks for no extra confirmation but cancels local preview work and ignores a late response. It cannot cancel a backend request after the server has accepted it. A late success must not trigger a second automatic request.

### 8.3 Category presentation

Keep wire values stable and translate only labels/descriptions.

```text
aiContentReport.categories.hate_or_harassment.label
aiContentReport.categories.hate_or_harassment.description
...
aiContentReport.categories.other.label
```

No category is preselected. The user must make an explicit choice.

## 9. Evidence Construction

### 9.1 Text snapshot

`AIContentEvidenceBuilder` receives the immutable descriptor and returns a wire-safe snapshot.

Algorithm:

1. read only `descriptor.text`;
2. normalize line endings to `\n`;
3. preserve whitespace otherwise because formatting can be relevant evidence;
4. count Unicode code points;
5. if at most 32,000, store unchanged and set `textTruncated=false`;
6. otherwise keep the first 16,000 and last 16,000 code points, join with a translated-independent marker such as `\n...[truncated]...\n`, and set `textTruncated=true`;
7. never read sibling messages or the current prompt.

The truncation marker counts toward the maximum. Adjust the head/tail lengths so the final value remains at or below 32,000 code points.

### 9.2 Image selection

The dialog selects at most the first three displayed generated images by default. If more than three exist, show that only three can be attached. The user may deselect images, but the request must retain reviewable text, another image, or an explanation with `evidenceUnavailable=true`.

### 9.3 Image preview pipeline

`AIContentImagePreview.ts` runs in the renderer because it can access the image already displayed by the component.

```text
selected renderer image source
  -> reject forbidden schemes before loading
  -> load into Image with safe cross-origin behavior
  -> draw to offscreen canvas
  -> scale longest edge to <= 1024
  -> encode PNG when transparency matters, otherwise WebP/JPEG
  -> lower quality until decoded bytes <= 1 MiB
  -> compute SHA-256 with Web Crypto
  -> remove data URL prefix
  -> return AIContentImagePreview
```

Allowed source handling:

| Source | Behavior |
| --- | --- |
| Existing in-memory `data:image/jpeg|png|webp` | Decode and re-encode |
| Displayed `blob:` URL created by the app | Fetch in renderer, decode, re-encode |
| Remote HTTPS image already displayed with usable CORS | Load, draw, re-encode |
| `file:`, custom protocol, local path, `data:text`, SVG | Reject as evidence source |
| Remote image blocked by CORS or unavailable | Set evidence unavailable for that image |

CORS, or cross-origin resource sharing, controls whether a canvas may read pixels from a remote image. A tainted canvas must fail closed. The request never sends the original URL as evidence.

Encoding sequence:

1. constrain dimensions;
2. encode at quality 0.85;
3. if over 1 MiB, retry quality 0.70, 0.55, then 0.40;
4. if still over, reduce dimensions by 20 percent and repeat;
5. stop when within limit or below a 128-pixel longest edge;
6. if no compliant preview can be produced, report that evidence is unavailable.

### 9.4 Comment

Trim leading/trailing whitespace only for presence validation. Preserve the user's entered comment in the request after enforcing 2,000 code points. Never append hidden diagnostic context.

### 9.5 App context

The renderer supplies locale and optional correlation/model/time values. The main process adds authoritative context:

- `appVersion` from `app.getVersion()`;
- `platform` from `process.platform`.

Locale comes from the renderer's active i18n locale because it describes the user's UI language. IDs/model/time remain optional source metadata. The main process validates them but does not resolve database records from them.

## 10. Surface Adapter Design

Each integration constructs only a `ReportableAIOutput`. Shared UI and service logic must not import surface-specific stores.

### 10.1 Chat V2

In `AiChatV2Message.vue`:

- render beside existing completed assistant-message actions;
- exclude user, system, tool-progress, reasoning-only, streaming, empty, and error messages;
- use the displayed assistant text, not hidden reasoning or raw stream events;
- map `message.id`, `message.conversationId`, model metadata, and completion timestamp;
- map displayed `metadata.generatedImages` to renderer image sources;
- select `mixed` when both reportable text and images exist.

The report action remains visible after history reload because it derives from persisted assistant output. The in-session `Reported` state does not need persistence.

### 10.2 Plan approval card

The plan adapter snapshots the exact plan version displayed in `AiChatV2PlanApprovalCard.vue`. It must not include approval comments, tool execution state, or later plan versions. Use `contentType="plan"` and `surface="chat_v2"`.

The action appears while the plan is pinned and after it appears in conversation history.

### 10.3 AI artifacts

Artifact evidence is plain text or a safe textual representation of the displayed artifact. Never submit executable artifact HTML as active markup.

- card menu: compact report action;
- workspace header: visible text action;
- `contentType="artifact"`;
- `surface="ai_artifact"`;
- include `artifactId` when available;
- cap textual snapshot at the shared limit.

### 10.4 Legacy chat

Add the same button beside completed assistant output in `AiChatBox.vue`. Do not reuse thumbs-up/down or plan-revision feedback. Use `surface="legacy_chat"`.

### 10.5 Knowledge chat

Add the action beside Copy and Regenerate in `ChatInterface.vue`. Build preview text from the raw response string. Do not use or copy rendered `v-html`. Use `surface="knowledge_chat"`.

### 10.6 Email-template editor

Capture the generated subject/body immediately when generation completes and keep that immutable generated snapshot separate from later user edits.

```typescript
interface GeneratedEmailTemplateSnapshot {
  readonly subject: string;
  readonly body: string;
  readonly generatedAt: string;
  readonly model?: string;
}
```

The report action uses the latest generated snapshot until another generation replaces it. Saving or manually editing the template does not mutate the report snapshot. Format the evidence as bounded plain text:

```text
Subject: ...

Body:
...
```

Use `surface="email_template_editor"` and `contentType="email_template"`.

## 11. Renderer API

Create `src/views/api/aiContentReport.ts`:

```typescript
import { AI_CONTENT_REPORT_CREATE } from "@/config/channellist";
import type {
  AIContentReportIPCInput,
  AIContentReportResult,
} from "@/entityTypes/aiContentReportTypes";
import { windowInvoke } from "@/views/utils/apirequest";

export async function submitAIContentReport(
  request: AIContentReportIPCInput
): Promise<AIContentReportResult> {
  try {
    return (await windowInvoke(
      AI_CONTENT_REPORT_CREATE,
      request
    )) as AIContentReportResult;
  } catch (error: unknown) {
    throw normalizeAIContentReportError(error);
  }
}
```

`registerValidatedHandler` transports failures through the existing string `msg` field. `AIContentReportClient` therefore throws only a stable error-code token such as `rate_limited`, never backend text or evidence. `normalizeAIContentReportError` validates that token against the known code set and returns `unexpected` for everything else. The UI catches the feature's normalized error class and does not inspect backend response bodies directly.

## 12. Main-Process Handler

Create `src/main-process/communication/ai-content-report-ipc.ts`:

```typescript
export function registerAIContentReportIpcHandlers(): void {
  registerValidatedHandler(
    AI_CONTENT_REPORT_CREATE,
    aiContentReportIPCInputSchema,
    async (input): Promise<AIContentReportResult> => {
      const authoritativeRequest = aiContentReportRequestSchema().parse(
        withDesktopContext(input)
      );
      return AIContentReportClient.create().submit(authoritativeRequest);
    }
  );
}
```

Registration requirements:

1. export `AI_CONTENT_REPORT_CREATE` from `src/config/channellist.ts`;
2. import it in `src/preload.ts`;
3. add it to the generic invoke allowlist;
4. import/register the handler in `src/main-process/communication/index.ts`;
5. register exactly once under the existing HMR guard;
6. do not import `USER_AI_ENABLED` or call `ensureHostedAiEnabled`.

## 13. Main-Process HTTP Client

### 13.1 `AIContentReportClient`

Responsibilities:

- create a fresh `HttpClient` per submission;
- explicitly await `setheaderToken()` so authenticated identity is attached when available;
- read the stable install ID from the existing diagnostics identity helper;
- add `X-AiFetchly-Install-Id`;
- set `Accept: application/json` and `Content-Type: application/json`;
- call `/api/ai/content-reports` with JSON;
- enforce a 20-second timeout through `AbortController`;
- parse the standard backend envelope;
- validate response data before returning;
- map HTTP/network errors to stable client error codes;
- never log request evidence.

### 13.2 Header merge correction

Current `_fetchJSON` applies `headers: this._headers` after spreading `RequestInit`, so headers supplied by `postJson` are overwritten. Correct the shared client with a `Headers` merge:

```typescript
const headers = new Headers(this._headers);
new Headers(options.headers).forEach((value, key) => {
  headers.set(key, value);
});

const res = await fetch(this.baseUrl + endpoint, {
  ...options,
  headers,
});
```

Default authorization/install headers survive, and the JSON method retains its content-type/accept headers. Add regression coverage in `test/vitest/main/httpclient.test.ts` and `test/vitest/utilitycode/httpclientRefresh.test.ts` so token refresh retries preserve the same merged headers.

### 13.3 Typed HTTP errors

Current `_fetchJSON` throws `Error(res.statusText)` for non-auth HTTP failures, which loses reliable status mapping. Add an opt-in typed error without breaking existing callers:

```typescript
export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    public readonly safeCode?: number
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}
```

Before throwing on a non-success response, `_fetchJSON` may parse only a bounded JSON error envelope and include a safe backend code. It must not place response content into the error message or logs.

Existing code that catches `Error` remains compatible. New report code can reliably distinguish 400, 401, 409, 413, 415, 422, 429, 500, and 503.

### 13.4 Optional identity

If no access token exists, submission continues with the install header. If a token exists but is rejected, normal `HttpClient` refresh runs once. A present invalid token must not silently retry anonymously because the backend intentionally returns 401 for that case.

### 13.5 Response validation

Validate remote data before returning:

```typescript
const resultSchema = z.strictObject({
  reportId: z.string().regex(/^air_[a-f0-9]{32}$/),
  status: z.literal("submitted"),
  receivedAt: z.string().datetime(),
  duplicate: z.boolean(),
});
```

If the backend uses a longer random suffix, align the regex in both repositories before implementation. The stable prefix and minimum 128-bit randomness are mandatory.

## 14. Error Model

Stable renderer error codes:

```typescript
export type AIContentReportErrorCode =
  | "invalid_request"
  | "authentication_required"
  | "identifier_conflict"
  | "payload_too_large"
  | "unsupported_evidence"
  | "unreviewable_evidence"
  | "rate_limited"
  | "service_unavailable"
  | "timeout"
  | "offline"
  | "unexpected";
```

```typescript
export class AIContentReportError extends Error {
  constructor(public readonly code: AIContentReportErrorCode) {
    super(code);
    this.name = "AIContentReportError";
  }
}
```

The main process uses the same code strings as safe IPC error messages. The renderer rehydrates them into `AIContentReportError`. Unknown error strings never appear directly in the UI.

Mapping:

| Condition | Code | UI behavior |
| --- | --- | --- |
| Local schema failure | `invalid_request` | Keep dialog open; identify invalid field generically |
| 401 | `authentication_required` | Keep data; ask user to sign in or retry after session recovery |
| 409 | `identifier_conflict` | Generate a new client ID only after the user changes evidence |
| 413 | `payload_too_large` | Ask user to deselect images or shorten comment |
| 415 | `unsupported_evidence` | Remove failed image; keep text/comment |
| 422 | `unreviewable_evidence` | Require text, image, or explanation |
| 429 | `rate_limited` | Do not auto-retry; show retry-later message |
| 503 | `service_unavailable` | Preserve fields; allow manual retry |
| Abort timeout | `timeout` | Preserve same `clientReportId`; allow manual retry |
| Network offline | `offline` | Preserve fields; allow manual retry |
| Other | `unexpected` | Safe generic message and no evidence in logs |

`clientReportId` is created when the dialog opens and remains unchanged across failures and retries. Opening a new report session creates a new UUID.

## 15. Request Sequence

### 15.1 Successful report

```text
User          Surface/Button      Dialog/Builder       Main IPC          Backend
 | click report     |                  |                  |                 |
 |----------------->| open(snapshot)   |                  |                 |
 |                  |----------------->|                  |                 |
 | choose + submit  |                  |                  |                 |
 |------------------------------------>| build previews   |                 |
 |                  |                  | invoke request   |                 |
 |                  |                  |----------------->| validate        |
 |                  |                  |                  | POST            |
 |                  |                  |                  |---------------->|
 |                  |                  |                  | air_...         |
 |                  |                  |<-----------------|                 |
 | success/reference|<-----------------|                  |                 |
```

### 15.2 Ambiguous timeout and retry

```text
first POST(clientReportId=A) -> backend commits -> response is lost
dialog shows timeout and retains all state
user selects Try again
second POST(clientReportId=A) -> backend returns original report, duplicate=true
dialog shows the original air_... reference
```

No automatic retry occurs for POST after a timeout.

## 16. Localization

Add one top-level namespace to every language file:

```text
aiContentReport.action
aiContentReport.reported
aiContentReport.title
aiContentReport.description
aiContentReport.previewLabel
aiContentReport.imageSelectionLabel
aiContentReport.commentLabel
aiContentReport.commentHint
aiContentReport.transmissionNotice
aiContentReport.privacyLink
aiContentReport.cancel
aiContentReport.submit
aiContentReport.preparing
aiContentReport.submitting
aiContentReport.success
aiContentReport.copyReference
aiContentReport.imageUnavailable
aiContentReport.tooManyImages
aiContentReport.errors.*
aiContentReport.categories.*.label
aiContentReport.categories.*.description
```

Requirements:

- use `useI18n()` in both components;
- provide English fallback for every rendered string;
- do not translate wire enum values;
- format the success message with a named `reportId` parameter;
- verify long German/French labels and CJK input at Surface Laptop widths.

## 17. Accessibility

1. Button uses visible text on primary surfaces and `aria-label` on compact surfaces.
2. Dialog has a programmatic title and description.
3. Initial focus moves to the dialog title or first category, not Submit.
4. Category controls use a real radio group with one label per option.
5. Image selection uses checkboxes with descriptive alt text and selection state.
6. Comment counter is announced politely, not on every keystroke as an interrupt.
7. Validation and network errors use an `aria-live="polite"` region.
8. Success reference is keyboard-selectable and Copy reference has an accessible name.
9. Escape closes only when not submitting; focus returns to the invoking report button.
10. All controls meet existing Vuetify focus and contrast requirements at 100, 125, and 150 percent display scaling.

## 18. Security and Privacy

### 18.1 Renderer output handling

- render preview text with interpolation or `textContent`, never `v-html`;
- never execute artifact HTML in the report dialog;
- never render submitted URLs as active links;
- do not include raw source URLs in the request;
- cap work before canvas allocation by checking image metadata when available;
- release object URLs and canvas buffers when the dialog closes.

XSS, or cross-site scripting, occurs when untrusted text is treated as executable HTML. The report dialog treats all AI output as hostile text.

### 18.2 IPC handling

- strict schema rejects unknown keys;
- IPC input excludes app version/platform and the main process adds them;
- handler remains outside the AI entitlement wrapper;
- no database or filesystem path lookup from message IDs;
- no evidence in normal logs or Zod error values;
- validation messages name fields but never echo rejected content.

### 18.3 Network handling

- HTTPS is required outside local development;
- bearer tokens remain in the main process;
- install ID is sent only as a header and never exposed in UI;
- abort after 20 seconds;
- response body parsing is bounded;
- do not follow any evidence URL because none is sent.

### 18.4 Analytics

Allowed client events:

```text
ai_content_report_opened      surface, contentType, appVersion
ai_content_report_submitted   surface, category, contentType, appVersion, duplicate
ai_content_report_failed      surface, appVersion, safeErrorCode
```

Never include evidence, comment, report ID, message/conversation/artifact ID, image hashes, model prompts, or raw model output.

## 19. Performance and Resource Limits

| Operation | Target/limit |
| --- | --- |
| Dialog open before image work | Under 100 ms on target Surface Laptop |
| Text snapshot | Under 20 ms for allowed input |
| Image processing | One image at a time to cap peak memory |
| Image count | Three maximum |
| Image dimensions | 1,024 px maximum per side |
| Decoded image bytes | 1 MiB each, 3 MiB total |
| Encoded request body | Under backend 5 MiB limit |
| HTTP timeout | 20 seconds |
| Automatic retries | Zero |

Image processing must yield to the UI between images so the dialog remains responsive. Do not use a child process because the worker would need evidence data and the project forbids worker network submission.

## 20. Testing Strategy

### 20.1 Schema tests

- accept every enum value and a minimal valid request;
- reject unknown keys at every object level;
- reject invalid UUIDs, times, platform, locale, dimensions, MIME, and hashes;
- enforce Unicode code-point limits;
- reject more than three images;
- enforce evidence/content-type relationships;
- reject estimated decoded total above 3 MiB.

### 20.2 Evidence-builder tests

- short text remains unchanged;
- long text preserves start/end and stays within 32,000 code points;
- surrogate pairs and emoji count correctly;
- no descriptor field outside the allowlist reaches the wire request;
- email-template snapshot ignores later editor mutations;
- artifact output remains plain text.

### 20.3 Image tests

- scale landscape, portrait, and square images correctly;
- preserve transparency when PNG is required;
- compress until within 1 MiB;
- reject SVG and forbidden schemes;
- handle a tainted canvas as evidence unavailable;
- compute deterministic SHA-256 from final bytes;
- revoke temporary object URLs.

### 20.4 IPC tests

- channel is present in preload invoke allowlist;
- handler uses `registerValidatedHandler`;
- invalid input never calls the HTTP client;
- main process supplies app version/platform and strict IPC input rejects renderer attempts to add them;
- hosted AI disabled does not block submission;
- worker environment cannot register/use the handler;
- backend success returns typed data;
- timeout and HTTP statuses map to stable error codes;
- JSON, authorization, and install headers survive normal requests and token-refresh retries;
- logs do not contain sample evidence strings.

### 20.5 Component tests

- report action appears only for completed assistant output;
- keyboard opens the dialog and focus is trapped/restored;
- category is required;
- comment counter and limit work with emoji;
- submit disabled while preparing/submitting;
- failure preserves input and same client ID;
- success shows/copies reference and changes action to Reported;
- escaped preview cannot execute HTML;
- image deselection works.

### 20.6 Surface integration tests

Test each P0 surface with a fixture containing a unique marker and assert that only that marker appears in the outgoing request. Include fixtures with prompts, reasoning, tool calls, attachments, and sibling messages, then assert those values are absent.

### 20.7 Manual certification test

On the Windows Store package running on a Microsoft Surface Laptop or equivalent:

1. generate a Chat V2 text response;
2. submit a misinformation report;
3. record the `air_...` reference;
4. generate/report an image if image generation is accessible;
5. verify keyboard-only and screen-reader paths;
6. repeat with hosted AI disabled against a historical response;
7. confirm the backend admin queue contains and actions the report.

## 21. Implementation Order

### Phase 1: Contract and transport

1. Add shared types and IPC schema.
2. Add channel constant and preload allowlist entry.
3. Add typed HTTP status support.
4. Add `AIContentReportClient` and main-process handler.
5. Add transport/schema tests.

### Phase 2: Shared UI and evidence

1. Implement text builder and image preview pipeline.
2. Implement dialog state machine and button.
3. Add all six language namespaces.
4. Add component/evidence/accessibility tests.

### Phase 3: P0 surfaces

1. Chat V2 text/images.
2. Plan approval/history.
3. Artifact card/workspace.
4. Legacy chat if accessible.
5. Knowledge chat if accessible.
6. Email-template generator if accessible.

No accessible P0 surface may ship without the shared report action.

### Phase 4: P1 audit and certification

1. Integrate keyword sets and automatic replies.
2. Audit all user-visible AI output.
3. Disable any unintegrated generative surface in the Store build.
4. run end-to-end staging and packaged-client certification tests;
5. prepare Store metadata, screenshots, privacy update, and reviewer instructions.

## 22. Deployment and Compatibility

1. Deploy and validate the backend before releasing the desktop package.
2. The backend supports `schemaVersion=1` before any client sends it.
3. Release desktop behind a build-time/runtime safety-reporting availability check only if the check cannot hide the action silently. If backend is down, the action remains visible and shows service unavailable.
4. Older clients remain unaffected because the new endpoint is additive.
5. If rollback is required, disable new desktop distribution but keep the backend endpoint and stored reports available for already-released clients.

## 23. Design Decisions and Trade-offs

### 23.1 Shared UI versus per-surface dialogs

Chosen: one shared button/dialog/evidence pipeline with thin surface adapters.

Trade-off: adapters must translate different source shapes into one descriptor. Benefit: consent, limits, accessibility, localization, and wire behavior cannot drift by surface.

### 23.2 Renderer image processing versus main-process fetching

Chosen: renderer re-encodes images already displayed.

Trade-off: remote CORS failures can prevent image attachment. Benefit: the main process never fetches user-controlled URLs or reads local paths, and the request contains only bounded bytes.

### 23.3 No offline queue

Chosen: preserve dialog state and allow manual retry.

Trade-off: users cannot submit while fully offline. Benefit: v1 avoids storing sensitive report evidence locally and avoids background duplicate-delivery complexity.

### 23.4 Backend source of truth

Chosen: no desktop report database.

Trade-off: Reported state is session-local. Benefit: retention, review status, and deletion stay centralized and auditable.

## 24. Requirement Traceability

| PRD area | Technical sections |
| --- | --- |
| Shared report action/dialog | 8, 10 |
| Evidence limits and privacy | 7, 9, 18 |
| Typed IPC and no AI gate | 4, 7, 12 |
| Backend submission and retries | 13, 14, 15 |
| Localization/accessibility | 16, 17 |
| Analytics/security | 18 |
| Surface coverage | 3.3, 10, 21 |
| Certification | 20.7, 21, 22 |

## 25. Definition of Done

The desktop implementation is done when:

1. every accessible P0 AI-output surface exposes the report action;
2. the dialog sends only the selected bounded output and explicit comment;
3. text/image limits match the backend contract;
4. IPC uses strict Zod validation and `registerValidatedHandler`;
5. reporting works without hosted-AI entitlement and without consuming credits;
6. authenticated and anonymous submissions both work;
7. ambiguous retries reuse the client report ID and return one backend report;
8. all six languages and keyboard/screen-reader behavior pass review;
9. logs and analytics contain no report evidence;
10. unit, component, IPC, integration, and packaged Windows tests pass; and
11. a Store certification report is visible and actioned in the backend queue.
