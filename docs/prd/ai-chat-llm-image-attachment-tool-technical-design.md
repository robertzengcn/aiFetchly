# AI Chat LLM Image Attachment Tool - Desktop Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-03
- **Related PRD**: `docs/prd/ai-chat-llm-image-attachment-tool-prd.md`
- **Companion Server Design**: `aifetchserver/doc/ai-chat-llm-image-attachment-server-technical-design.md`
- **Primary Runtime**: Electron main process and AiChatV2 query loop
- **Tool Name**: `attach_local_images`

## 1. Purpose

This document defines how AiFetchly will let the chat model attach one to three local workspace images to the active AI turn. It converts the product requirements into concrete TypeScript contracts, services, algorithms, security boundaries, query-loop changes, UI behavior, tests, and implementation order.

The central design constraint is that prepared image bytes must reach the next AI server request without entering the ordinary tool-result path. Tool results are persisted, passed through hooks, displayed in the renderer, and serialized for the model. Image bytes require a separate transient channel.

## 2. Current System

### 2.1 User-Selected Attachments

The existing renderer path is:

```text
AiChatV2.vue
  -> buildUploadedAttachments(File[])
  -> ChatV2StreamRequest.uploadedFiles
  -> ai-chat-v2-ipc.ts validation
  -> AIChatQueryEngine.prepareAttachmentContent()
  -> OpenAI image_url content parts
  -> AIChatQueryLoop
  -> POST /v1/chat/completions
```

Images are downscaled in the renderer by `imageScaleUtil.ts`. The current constants are:

```ts
IMAGE_MAX_LONG_EDGE = 1568;
IMAGE_JPEG_QUALITY = 0.82;
```

The main process accepts PNG, JPEG, WebP, and GIF, enforces a 5 MiB decoded per-file limit, and tracks up to 10 MiB of combined base64 characters. The server is stricter on image count and therefore remains capable of returning HTTP 422 when the UI submits too many images.

### 2.2 Tool Execution

The current tool flow is:

```text
AIChatQueryLoop
  -> AIChatQueryLoopDeps.executeTool()
  -> SkillExecutor.execute()
  -> SkillDefinition.execute()
  -> ToolExecutionResult
  -> normalizeToolResult()
  -> tool_result event and persistence
  -> role=tool transcript message
  -> next model round
```

`SkillDefinition.execute()` returns `SkillExecutionResult`:

```ts
export interface SkillExecutionResult {
  readonly success: boolean;
  readonly result: Record<string, unknown>;
}
```

`SkillExecutor` wraps this into `ToolExecutionResult`. Post-tool hooks receive `result.result`, and the query loop serializes `result.result` into the model transcript. This structure has no safe place for binary artifacts today.

### 2.3 Workspace Enforcement

`WorkspaceResolver` returns an approved workspace for a conversation. `FilePathGuard` performs:

- malformed path rejection,
- normalization,
- realpath resolution,
- workspace containment,
- deny-list checks.

The new tool must require an approved workspace. It must not use the legacy default-root fallback currently available to generic file tools.

## 3. Technology Decisions

### TD1: Implement A Built-In Main-Process Skill

`attach_local_images` will be registered in `SkillRegistry` with:

```ts
tier: "main"
permissionCategory: "filesystem"
requiresConfirmation: true
source: "built-in"
  timeoutClass: "fast"
```

The renderer cannot safely resolve arbitrary paths or access Electron filesystem APIs. The server cannot read desktop paths. The main process is the correct execution boundary.

### TD2: Keep Binary Data Outside `result`

Add an optional `modelArtifacts` field to both skill result layers. It is a sibling of `result`, never a child:

```ts
export interface SkillExecutionResult {
  readonly success: boolean;
  readonly result: Record<string, unknown>;
  readonly modelArtifacts?: readonly ModelArtifact[];
}

export interface ToolExecutionResult {
  tool_call_id: string;
  tool_name: string;
  success: boolean;
  result: Record<string, unknown>;
  execution_time_ms: number;
  readonly modelArtifacts?: readonly ModelArtifact[];
  // existing timeout metadata remains unchanged
}
```

`SkillExecutor` passes the artifacts through only after hooks finish:

```ts
const result: ToolExecutionResult = {
  tool_call_id: toolCallId,
  tool_name: name,
  success: execResult.success,
  result: execResult.result,
  execution_time_ms: Date.now() - startTime,
  ...(execResult.modelArtifacts
    ? { modelArtifacts: execResult.modelArtifacts }
    : {}),
};
```

Pre-tool and post-tool hooks continue receiving metadata-only arguments and results. This avoids accidental payload exposure and prevents hook mutation of data URLs.

### TD3: Use A Synthetic User Multimodal Handoff

The next request will contain:

1. the assistant tool-call message,
2. a metadata-only tool-result message,
3. a model-only user message with the original request and image content parts.

Using a user message avoids relying on provider support for images in `role: "tool"` content. Repeating the original request is required because the AI server's current edit-intent logic reads the latest user message.

### TD4: Use Electron `nativeImage` Through An Adapter

Renderer canvas utilities cannot run in the main process. Production normalization will use Electron `nativeImage` behind an injected codec interface. This avoids a new native image dependency and matches the Electron runtime already shipped by the app.

The first release behavior is:

- PNG input remains PNG while it fits the target.
- JPEG, WebP, and GIF input become JPEG.
- GIF uses the first decoded frame.
- Oversized PNG is resized repeatedly; if transparency cannot fit within the budget, the file is rejected instead of silently flattening unless product later approves flattening.

### TD5: Enforce Three Images Against The Complete Request

The tool schema limits one call to three paths, but the query loop also counts existing `image_url` parts in the outgoing transcript. The effective tool capacity is:

```text
remaining = 3 - existingImagePartCount
```

If `paths.length > remaining`, execution fails before reading files.

### TD6: Keep The First Release Inline

Images remain `data:image/...;base64,...` content parts. No new desktop upload API, server upload handle, or object-storage dependency is introduced.

## 4. Target Architecture

```text
Model calls attach_local_images
        |
        v
AIChatQueryLoop.executeTool
        |
        v
SkillExecutor
  - schema validation
  - permission check
  - metadata-only hooks
        |
        v
AIImageAttachmentToolService
  - resolve approved workspace
  - calculate remaining image capacity
  - FilePathGuard validation
  - open and stat regular files
  - signature validation
  - nativeImage decode and normalization
  - metadata result + transient artifacts
        |
        v
AIChatQueryLoop
  - persist/emit metadata only
  - append safe role=tool message
  - append transient role=user image handoff
  - stream next round
        |
        v
AI server
```

## 5. Proposed Files

### 5.1 New Files

```text
src/entityTypes/aiImageAttachmentToolTypes.ts
src/service/AIImageAttachmentToolService.ts
src/service/AIImageNormalizer.ts
test/modules/AIImageAttachmentToolService.test.ts
test/modules/AIImageNormalizer.test.ts
test/modules/AIChatQueryLoop.imageArtifacts.test.ts
```

### 5.2 Modified Files

```text
src/api/aiChatApi.ts
src/entityTypes/skillTypes.ts
src/config/skillsRegistry.ts
src/service/SkillExecutor.ts
src/service/AIChatQueryLoop.ts
src/service/AIChatQueryEngine.ts
src/service/ToolTimeoutPolicy.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

`ToolExecutionService.ts` should not require a schema change because it receives metadata-only payloads. Tests must prove that this remains true.

## 6. Type Design

### 6.1 Shared Model Artifact Union

Define an extensible discriminated union:

```ts
export type ModelArtifact = ImageModelArtifact;

export interface ImageModelArtifact {
  readonly kind: "image";
  readonly fileName: string;
  readonly relativePath: string;
  readonly mimeType: SupportedImageMimeType;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly detail: ImageDetail;
  readonly dataUrl: string;
}

export type SupportedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export type PreparedImageMimeType = "image/png" | "image/jpeg";
export type ImageDetail = "auto" | "low" | "high";
```

Although the tool accepts four input formats, normalized artifacts will normally be PNG or JPEG. Keeping the artifact MIME union aligned with the public API allows a future codec to preserve WebP without changing the transport type.

### 6.2 Tool Arguments

```ts
export interface AttachLocalImagesArgs {
  readonly paths: readonly string[];
  readonly detail?: ImageDetail;
}
```

Runtime validation remains mandatory because tool arguments originate from the model.

### 6.3 Persistable Metadata

```ts
export interface AttachedImageMetadata {
  readonly file_name: string;
  readonly relative_path: string;
  readonly mime_type: PreparedImageMimeType;
  readonly prepared_size_bytes: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly detail: ImageDetail;
}

export interface AttachLocalImagesResult {
  readonly success: boolean;
  readonly attached_count: number;
  readonly attachments: readonly AttachedImageMetadata[];
  readonly summary: string;
  readonly code?: AttachLocalImagesErrorCode;
  readonly error?: string;
}
```

### 6.4 Constants

Create a single desktop configuration module or export constants from the tool types file:

```ts
export const CHAT_IMAGE_LIMITS = Object.freeze({
  maxImagesPerRequest: 3,
  maxRawFileBytes: 5 * 1024 * 1024,
  targetPreparedImageBytes: Math.floor(1.5 * 1024 * 1024),
  maxLongEdge: 1568,
  initialJpegQuality: 82,
  minJpegQuality: 60,
  minLongEdge: 768,
  maxEncodingAttempts: 6,
  targetTotalDataUrlChars: 6_000_000,
});
```

The renderer attachment path should import the shared count and total-target values where runtime boundaries allow. If bundling constraints prevent sharing a main-process module, move pure constants into `src/config/chatImageLimits.ts`.

## 7. Tool Registration

Add a built-in definition to `skillsRegistry.ts`:

```ts
{
  name: "attach_local_images",
  description:
    "Attach one to three exact local image files from the approved workspace " +
    "to the current AI request. Use glob_files first when paths are unknown. " +
    "This transfers prepared image content to the configured AI server.",
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      },
      detail: {
        type: "string",
        enum: ["auto", "low", "high"],
        default: "auto",
      },
    },
    required: ["paths"],
    additionalProperties: false,
  },
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "filesystem",
  source: "built-in",
  timeoutClass: "fast",
  execute: async (args, context) =>
    AIImageAttachmentToolService.execute(args, context),
}
```

The tool remains compatible with deferred tool catalog discovery. Search keywords should include image, photo, attach, upload, edit, reference, and vision through the normal catalog description index.

## 8. Permission Design

### 8.1 Existing Constraint

The permission system has one category per skill. `filesystem` correctly treats the local read as sensitive, but the generic prompt does not describe the subsequent server transfer.

### 8.2 Generic Permission Preview Extension

Add an optional preview builder to `SkillDefinition`:

```ts
export interface PermissionPreview {
  readonly kind: "file_transfer";
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly items: readonly string[];
  readonly destinationLabel: string;
}

export interface SkillDefinition {
  // existing fields
  readonly buildPermissionPreview?: (
    args: Record<string, unknown>
  ) => PermissionPreview | undefined;
}
```

When permission is required, `SkillExecutor` adds the metadata-only preview:

```ts
permissionPreview: skill.buildPermissionPreview?.(resolvedArgs)
```

The preview contains unvalidated requested paths for display only. It is never treated as proof of workspace containment. The execution service validates paths again after approval.

### 8.3 Approval Modes

- `ask_for_approval`: show the transfer preview and wait.
- `approve_for_me`: follow existing approval policy.
- `full_access`: execute without the prompt as currently defined by the product.

The tool description and preview must clearly state that prepared content is sent to the configured AI server. A future security change may introduce a separate data-transfer permission category without changing the tool contract.

## 9. `AIImageAttachmentToolService`

### 9.1 Dependencies

Use constructor injection for testability:

```ts
export interface AIImageAttachmentToolDeps {
  readonly workspaceResolver: WorkspaceResolver;
  readonly createPathGuard: (roots: readonly string[]) => FilePathGuard;
  readonly normalizer: AIImageNormalizer;
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly lstat: (path: string) => Promise<Stats>;
}
```

Production defaults use Node filesystem promises and the Electron image codec.

### 9.2 Execute Signature

```ts
async execute(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<SkillExecutionResult>
```

`SkillExecutionContext` currently does not expose existing image count. Add an optional field:

```ts
readonly currentRequestImageCount?: number;
```

`AIChatQueryLoop` computes this immediately before tool execution and supplies it. This avoids giving the tool direct access to mutable transcript state.

### 9.3 Algorithm

```text
1. Parse args with explicit type guards.
2. Reject zero paths, more than three paths, duplicates, or invalid detail.
3. Calculate remaining request capacity.
4. Reject when requested paths exceed remaining capacity.
5. Resolve approved workspace for conversationId.
6. Fail closed if resolver returns null or throws.
7. Create FilePathGuard with only the approved workspace root.
8. Validate every path before reading any file.
9. lstat each canonical path and require a regular non-symlink file.
10. Enforce raw size from stat.
11. Read each file with cancellation checks between files.
12. Re-check byte length against the raw limit.
13. Detect signature and require an allowed image type.
14. Normalize through AIImageNormalizer.
15. Build the data URL and measure its exact character length.
16. Accumulate total request target.
17. If any image fails, reject the entire tool call and release artifacts.
18. Return safe metadata plus transient artifacts.
```

Atomic failure is intentional. Partial attachment would make the model believe it received a complete requested set when it did not.

### 9.4 Fail-Closed Workspace Behavior

Unlike `ToolExecutor.executeFileTool`, this tool must not fall back to default roots when `WorkspaceResolver` fails. The service returns:

```json
{
  "success": false,
  "code": "workspace_required",
  "error": "An approved workspace is required before local images can be attached."
}
```

### 9.5 File Signature Detection

Implement a pure helper using leading bytes:

```text
PNG:  89 50 4E 47 0D 0A 1A 0A
JPEG: FF D8 FF
GIF:  GIF87a or GIF89a
WebP: RIFF....WEBP
```

The detected MIME type, not the extension, drives decoding. Extension mismatch returns `image_signature_mismatch` rather than silently accepting renamed files.

## 10. Image Normalization

### 10.1 Codec Interface

```ts
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  resize(width: number, height: number): DecodedImage;
  toPng(): Buffer;
  toJpeg(quality: number): Buffer;
}

export interface ImageCodec {
  decode(buffer: Buffer): DecodedImage;
}
```

`ElectronNativeImageCodec` wraps `nativeImage.createFromBuffer()`, `isEmpty()`, `getSize()`, `resize()`, `toPNG()`, and `toJPEG()`.

### 10.2 Dimension Safety

Before encoding:

```ts
const MAX_INPUT_DIMENSION = 16_384;
const MAX_INPUT_PIXELS = 64_000_000;
```

Reject empty images, zero dimensions, a dimension above the maximum, or a pixel count above the maximum. These are desktop protections against excessive decode or resize work. The server independently validates its own limits.

### 10.3 Initial Resize

Use the existing `computeScaledDimensions()` algorithm after moving the pure helper to a runtime-neutral module:

```ts
scale = min(1, 1568 / max(width, height))
outputWidth = max(1, round(width * scale))
outputHeight = max(1, round(height * scale))
```

### 10.4 JPEG Encoding Loop

```text
quality = 82
longEdge = min(originalLongEdge, 1568)

repeat up to 6 attempts:
  resize to longEdge
  encode JPEG at quality
  if bytes <= 1.5 MiB: success
  if quality > 60: quality -= 8
  else: longEdge = floor(longEdge * 0.85), quality = 76
  if longEdge < 768: fail
```

The exact output is deterministic for a given Electron version and input. Tests assert bounds, not byte-for-byte encoder output.

### 10.5 PNG Encoding Loop

```text
longEdge = min(originalLongEdge, 1568)

repeat up to 6 attempts:
  resize to longEdge
  encode PNG
  if bytes <= 1.5 MiB: success
  longEdge = floor(longEdge * 0.82)
  if longEdge < 768: fail
```

Do not convert an alpha PNG to JPEG in the first release. A non-alpha PNG may be encoded as JPEG if this policy is explicitly implemented and tested.

### 10.6 Total Payload Target

After each image:

```ts
const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
totalDataUrlChars += dataUrl.length;
```

Reject the whole tool call if the accumulated tool artifact size plus existing request image characters exceeds 6,000,000.

`SkillExecutionContext` should therefore also expose:

```ts
readonly currentRequestImageDataUrlChars?: number;
```

## 11. Query Loop Integration

### 11.1 Count Existing Images

Add pure helpers:

```ts
export function countImageContentParts(
  messages: readonly OpenAIChatMessage[]
): number;

export function countImageDataUrlChars(
  messages: readonly OpenAIChatMessage[]
): number;
```

Only `image_url.url` values count. Metadata-only historical attachment rows do not.

### 11.2 Execute Tool Context

Immediately before `deps.executeTool()`:

```ts
const executionContext: SkillExecutionContext = {
  conversationId: input.conversationId,
  toolCallId: callId,
  args: effectiveArguments,
  signal: input.abortController.signal,
  currentRequestImageCount: countImageContentParts(messages),
  currentRequestImageDataUrlChars: countImageDataUrlChars(messages),
};
```

### 11.3 Persist And Emit Safe Result

Existing logic remains metadata-only:

```ts
const toolPayload = normalizeToolResult(toolResult);
const toolContent = serializeToolResultContent(toolPayload);
```

`normalizeToolResult()` intentionally ignores `modelArtifacts`. Add a comment and a regression test so a future object spread does not change this boundary.

### 11.4 Build Handoff Message

```ts
export function buildImageArtifactHandoffMessage(input: {
  readonly artifacts: readonly ImageModelArtifact[];
  readonly originalUserRequest: string;
  readonly toolCallId: string;
}): OpenAIChatMessage {
  const text =
    `[AIFETCHLY_IMAGE_HANDOFF_V1]\n` +
    `The desktop attached ${input.artifacts.length} local image(s).\n` +
    `Original user request:\n${input.originalUserRequest}`;

  return {
    role: "user",
    content: [
      { type: "text", text },
      ...input.artifacts.map((artifact) => ({
        type: "image_url" as const,
        image_url: {
          url: artifact.dataUrl,
          detail: artifact.detail,
        },
      })),
    ],
  };
}
```

`originalUserRequest` comes from `input.request.message`, not from tool arguments, filenames, or hook output. If the request contains attachment-enrichment blocks, use the model-facing original request appropriate to the active turn without copying unrelated staged document paths into the handoff.

### 11.5 Append Order

```ts
messages.push({
  role: "tool",
  tool_call_id: call.id,
  content: toolContent,
});

if (toolResult.success && toolResult.modelArtifacts?.length) {
  messages.push(buildImageArtifactHandoffMessage(...));
}
```

No handoff is appended for failed, permission-deferred, cancelled, empty, or malformed artifact results.

### 11.6 Multiple Attachment Calls

The loop permits another attachment call only when capacity remains. A second call sees the first handoff images in `messages` and calculates the reduced capacity. This gives correct cumulative enforcement without mutable global counters.

### 11.7 Lifecycle And Cleanup

Artifacts live in the in-memory `messages` array until the turn completes. On completion, cancellation, terminal error, or loop exhaustion:

- clear references to active artifacts,
- clear pending permission state containing execution contexts,
- do not cache data URLs in deferred tool catalog state,
- do not include artifacts in recovery telemetry.

JavaScript strings cannot be reliably zeroed. The design limits lifetime and prevents durable copies instead.

## 12. Persistence

### 12.1 Tool Result

Persist only `AttachLocalImagesResult`. `ToolExecutionService.saveToolResult()` must never receive the full `ToolExecutionResult` object.

### 12.2 Attachment History

The first implementation should persist metadata with the tool-result row and not duplicate bytes into `AIChatAttachmentModule`. The original local file remains the source, while the tool card preserves the audit summary.

If durable previews become required, add them later through `AIChatAttachmentModule` and its Model layer. Do not add database access to the query loop or IPC handler.

### 12.3 Conversation Rehydration

Tool-selected data URLs are not reconstructed when loading history. Follow-up turns that need the images must call `attach_local_images` again. The tool card remains visible as historical metadata.

This is an explicit first-release trade-off that prevents database growth and unintended long-lived copies.

## 13. Renderer Integration

### 13.1 `AiChatV2.vue`

No filesystem or normalization code is added. The component continues to:

- render generic tool events,
- show permission prompts,
- render final assistant images,
- display stream errors.

### 13.2 Permission Preview

Extend `AiChatV2Message.vue` or the existing approval component to render `PermissionPreview.kind === "file_transfer"`:

- localized title,
- localized transfer description,
- up to three relative/requested paths,
- configured server label without credentials.

Use stable rows and ellipsis so long paths do not resize the card.

### 13.3 Tool Result Card

Render metadata from `attachments` as compact rows. Do not create image previews from local paths because renderer path access is restricted and could expose a file the user did not approve for rendering.

### 13.4 i18n Keys

Suggested namespace:

```text
aiChatV2.imageTool.name
aiChatV2.imageTool.permissionTitle
aiChatV2.imageTool.permissionDescription
aiChatV2.imageTool.validating
aiChatV2.imageTool.reading
aiChatV2.imageTool.normalizing
aiChatV2.imageTool.ready
aiChatV2.imageTool.attachedCount
aiChatV2.imageTool.errors.workspaceRequired
aiChatV2.imageTool.errors.outsideWorkspace
aiChatV2.imageTool.errors.unsupportedType
aiChatV2.imageTool.errors.tooMany
aiChatV2.imageTool.errors.payloadTooLarge
aiChatV2.imageTool.errors.processingFailed
```

Add the same keys to all six language files.

## 14. Error Mapping

Use stable tool codes and user-safe messages:

| Code | Source | Retryable |
|---|---|---|
| `workspace_required` | Workspace resolver | No, user action required |
| `invalid_arguments` | Argument parser | Model may retry |
| `image_limit_reached` | Query capacity | No in current request |
| `path_outside_workspace` | FilePathGuard | No |
| `path_not_found` | Filesystem | Maybe after rediscovery |
| `path_is_directory` | Filesystem | Model may choose another path |
| `image_file_too_large` | Raw stat/read | No without another file |
| `unsupported_image_type` | Signature detector | No |
| `image_signature_mismatch` | Extension/signature | No |
| `image_dimensions_too_large` | Decoder guard | No |
| `image_payload_too_large` | Normalizer/budget | Maybe with fewer images |
| `image_processing_failed` | Codec | Maybe with another file |
| `permission_denied` | Permission system | No |
| `cancelled` | Abort signal | User-controlled |

Never return raw Electron decoder errors, absolute paths outside display policy, or stack traces to the model.

## 15. Cancellation And Timeout

### 15.1 Abort Checks

Check `context.signal?.aborted`:

- before workspace resolution,
- before every file,
- after every filesystem read,
- between encoding attempts,
- before returning artifacts.

### 15.2 Timeout Policy

Add an explicit timeout rule for `attach_local_images`, initially 30 seconds. It should not run as an asynchronous job because the next chat round directly requires the artifacts.

### 15.3 Late Completion

The query loop already checks active turn identity. Add a test proving that a late normalizer completion after cancellation neither emits artifacts nor starts another HTTP request.

## 16. Logging And Diagnostics

Allowed local log fields:

- tool-call ID,
- requested count,
- attached count,
- total raw bytes,
- total prepared bytes,
- total data-URL characters,
- normalized MIME types,
- duration,
- result code.

Disallowed fields:

- data URLs,
- base64,
- buffers,
- full artifact objects,
- file contents,
- remote server credentials.

Create a defensive helper:

```ts
export function summarizeModelArtifacts(
  artifacts: readonly ModelArtifact[]
): Record<string, unknown>;
```

Logging code receives only the summary.

## 17. Testing Design

### 17.1 Service Tests

`test/modules/AIImageAttachmentToolService.test.ts`:

- requires approved workspace,
- rejects resolver failure rather than falling back,
- accepts valid relative and absolute-contained paths,
- rejects traversal and symlink escape,
- applies deny list,
- rejects directory and non-regular file,
- rejects more paths than remaining capacity,
- rejects duplicate canonical paths,
- rejects raw file above 5 MiB,
- validates signatures,
- returns atomic failure,
- passes abort signal,
- returns metadata and artifacts separately.

### 17.2 Normalizer Tests

`test/modules/AIImageNormalizer.test.ts` with an injected fake codec:

- never upscales,
- caps the long edge,
- reduces JPEG quality in bounded steps,
- reduces dimensions after reaching minimum quality,
- preserves alpha PNG behavior,
- fails after maximum attempts,
- rejects unsafe dimensions and pixel counts,
- calculates exact base64/data-URL length,
- handles abort between attempts.

### 17.3 Query Loop Tests

`test/modules/AIChatQueryLoop.imageArtifacts.test.ts`:

- forwards current image count and characters to tool context,
- serializes metadata only,
- emits no data URL in `tool_result`,
- appends tool result before handoff,
- repeats the original request in handoff text,
- attaches correct content parts and detail,
- supports two calls within total capacity,
- rejects or surfaces capacity failure,
- does not append artifacts on permission pause,
- appends artifacts after permission resume,
- does not duplicate on recovery,
- cleans up on completion and cancellation.

### 17.4 Persistence And Hook Tests

- Post-tool hooks receive no `modelArtifacts`.
- `normalizeToolResult()` output contains no `data:image/`.
- `ToolExecutionService` saved output contains no `data:image/`.
- Renderer event JSON contains no `data:image/`.
- Audit logs contain artifact summaries only.

### 17.5 UI Tests

- Transfer preview renders three stable rows.
- Long paths truncate without overlap.
- Approval and denial actions work.
- Metadata-only success card renders.
- Each supported language resolves all keys.

### 17.6 End-To-End Test

Use a fake AI server:

1. First response calls `glob_files`.
2. Second response calls `attach_local_images`.
3. Capture the third request.
4. Assert one metadata-only tool message.
5. Assert one synthetic user message with original request and image parts.
6. Assert no more than three image parts and target size.
7. Return a completion with `images` and verify renderer handling.

## 18. Implementation Order

1. Add shared types and limits.
2. Extend result contracts with transient artifacts.
3. Add regression tests proving artifacts do not enter persistence, hooks, logs, or renderer events.
4. Add generic permission preview support and translations.
5. Implement image signature detection.
6. Implement the injected normalizer and Electron codec.
7. Implement `AIImageAttachmentToolService` with fail-closed workspace checks.
8. Register the tool and timeout policy.
9. Add query-loop count, size, and handoff helpers.
10. Integrate handoff after metadata-only tool results.
11. Add UI metadata and permission rendering.
12. Run unit, main-process, Vue type, and end-to-end tests.
13. Enable behind a feature flag until the companion server contract is deployed.

## 19. Verification Commands

```bash
yarn vue-check
yarn testmain
yarn test test/modules/AIImageAttachmentToolService.test.ts
yarn test test/modules/AIImageNormalizer.test.ts
yarn test test/modules/AIChatQueryLoop.imageArtifacts.test.ts
```

Use the repository's actual Mocha or Vitest runner for each final test location if command routing differs.

## 20. Risks And Mitigations

### Risk: Artifact Leakage Through A Future Refactor

Mitigation: artifacts are siblings of persisted `result`, serializers use allowlisted fields, and regression tests scan every persistence and IPC boundary for `data:image/`.

### Risk: Server Rejects Combined Conversation Images

Mitigation: count and size the complete transcript immediately before execution and again before every request round.

### Risk: Edit Intent Is Lost

Mitigation: repeat the original user request in the synthetic user handoff. Never use a generic continuation marker alone.

### Risk: Electron Encoder Output Varies

Mitigation: enforce bounds and attempt counts rather than exact bytes; server validation remains authoritative.

### Risk: Workspace Changes During Read

Mitigation: canonicalize, reject symlink targets, require regular files, validate stat/read sizes, and keep the read window short.

### Risk: Large In-Memory Strings

Mitigation: maximum three artifacts, per-image targets, total target, bounded lifetime, and no durable copies.

## 21. Definition Of Done

1. The built-in tool accepts one to three exact workspace paths.
2. Permission UI describes local read and AI-server transfer.
3. Workspace resolution fails closed.
4. Signature, size, dimension, and normalization checks pass.
5. Prepared data remains in `modelArtifacts`, outside persistable `result`.
6. The query loop adds a metadata-only tool response and multimodal user handoff.
7. Handoff text repeats the original user request.
8. Complete-request count and size stay within desktop targets.
9. Cancellation and permission resume work without duplication.
10. All translations and tests pass.
