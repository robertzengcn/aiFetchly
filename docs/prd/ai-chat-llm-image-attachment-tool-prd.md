# AI Chat LLM Image Attachment Tool - Desktop App Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-03
- **Owner**: Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Primary Component**: AiChatV2
- **Companion Document**: `aifetchserver/doc/ai-chat-llm-image-attachment-server-prd.md`
- **Related Documents**:
  - `docs/ai-chat-v2-attachment-upload-prd.md`
  - `docs/ai-chat-v2-attachment-upload-technical-design.md`
  - `docs/openai-compatible-chat-v2-prd.md`
  - `docs/ai-chat-tool-approval-modes-prd.md`

## Executive Summary

AiChatV2 currently lets a user select images through the composer and send those images to the AI server. The language model cannot independently select images that already exist in the conversation's approved workspace. This prevents workflows such as finding product images in a folder, attaching a small subset, and asking the AI server to analyze or edit them.

The desktop app will add an LLM-callable built-in tool named `attach_local_images`. The tool accepts up to three exact local image paths, validates that every path is inside the approved conversation workspace, prepares compact image data, and makes the images available to the next AI request round. The model can use `glob_files` before this tool to discover candidate files.

The first release will continue using inline `data:image/...;base64,...` content because the AI server already accepts this contract. It will not add a standalone upload endpoint or durable server-side image storage. The desktop will keep image bytes outside persisted tool-result JSON and outside logs. Only safe metadata such as file name, MIME type, size, and content hash may be persisted with the tool result.

The feature is deliberately limited to three images and a client target of six million combined data-URL characters. These limits sit below the AI server's hard limits and leave room for message history, tool definitions, and JSON framing.

## Background

### Existing User-Selected Image Flow

The current AiChatV2 flow already provides the following behavior:

1. The renderer accepts supported image files from the composer.
2. The renderer downscales images to a maximum long edge of 1568 pixels.
3. The renderer base64-encodes the prepared bytes.
4. The main process validates MIME type, declared size, decoded size, and total image payload size.
5. `AIChatQueryEngine` converts images into OpenAI-style `image_url` content parts.
6. The AI server chooses image analysis, image editing, or image generation behavior.
7. Generated images are downloaded and displayed through the existing response path.

This path begins with a user action in `AiChatV2.vue`. It cannot be initiated by an LLM tool call.

### Existing Tool Flow

AiChatV2 already supports multiple model-to-tool-to-model rounds:

1. The desktop sends the conversation and available tool definitions.
2. The model returns a tool call.
3. `AIChatQueryLoop` executes the tool through `SkillExecutor` or `ToolExecutor`.
4. The desktop persists a safe tool result and emits tool events to the renderer.
5. The desktop appends the tool result to the in-memory model transcript.
6. The next chat-completion round continues with the updated transcript.

The new tool must use this existing loop. It must not introduce a renderer-to-server shortcut or a second chat runtime.

## Problem Statement

Users expect the assistant to operate on local marketing assets after they grant access to a workspace. Today the assistant can discover image filenames with `glob_files`, but `file_read` returns only binary metadata for images and cannot attach the image to the AI request. The model therefore knows that an image exists but cannot make the AI server inspect or edit it.

Naively placing base64 image bytes inside a normal JSON tool result is unacceptable because the application persists tool results, displays them in tool cards, and resends them as textual context. This would produce large database rows, noisy UI, higher token use, accidental logging exposure, and request failures.

The product needs a bounded, permission-aware image attachment tool with a distinct transient artifact channel.

## Goals

1. Let the LLM attach local workspace images to the active AiChatV2 turn.
2. Support up to three images in one AI server request.
3. Reuse the AI server's existing OpenAI-compatible multimodal and image-editing contract.
4. Keep base64 image data out of persisted and renderer-visible tool-result JSON.
5. Require clear user consent before local image bytes are sent to the configured AI server.
6. Apply the same validation and normalization policy to user-selected and LLM-selected images.
7. Preserve streaming, cancellation, permission prompts, retry behavior, and generated-image rendering.
8. Support a reliable small-batch workflow without introducing a server upload service.
9. Provide complete translations for every new user-facing string.

## Non-Goals

1. Do not support more than three images in one chat request.
2. Do not implement a durable image upload API on the AI server.
3. Do not implement server-side object storage or signed upload URLs.
4. Do not let the model access files outside the approved conversation workspace.
5. Do not accept URLs, inline base64, shell expressions, or glob patterns as tool arguments.
6. Do not let the renderer execute filesystem or network operations directly.
7. Do not place image bytes in tool-call audit records, normal application logs, or UI events.
8. Do not promise independent one-output-per-input batch editing in this release.
9. Do not support SVG, TIFF, RAW camera formats, video, or animated output preservation.

## Product Terminology

### Attach

Prepare a local image and include it as model-visible input in the next AI request round. The tool is called `attach_local_images`, not `upload_images`, because the first release does not create a durable server-side upload resource.

### Reference Image

An image provided to the AI server to guide analysis, editing, or generation.

### Transient Model Artifact

Binary or encoded content used only to construct an in-memory AI request. It is excluded from normal tool-result persistence, logs, renderer events, and tool-card JSON.

### Small Batch

One request containing one to three images. Multiple images may act as references for one model operation. This does not imply one independent output for every input.

## Users And Use Cases

### Primary User

A marketer or operator who has opened an approved local workspace containing product photos, campaign graphics, screenshots, or social assets.

### UC1: Find And Edit A Product Image

1. The user asks: "Find the front-view product photo and make the background white."
2. The model calls `glob_files` to identify candidates.
3. The model calls `attach_local_images` with the selected path.
4. The app asks for approval and identifies the file that will be sent.
5. The app prepares the image and continues the AI request.
6. The AI server edits the attached image.
7. AiChatV2 displays and saves the generated result through the existing flow.

### UC2: Compare Three Images

1. The user asks the assistant to compare three banner variants.
2. The model discovers and attaches the three exact paths.
3. The server analyzes the images or delegates to its image Q&A tool.
4. The user receives a text comparison.

### UC3: Multi-Reference Creative Generation

1. The user asks the assistant to combine visual characteristics from up to three local references.
2. The model attaches the references.
3. The server routes the request to a provider supporting multiple references.
4. Generated image artifacts return through `message.images`.

### UC4: Folder Contains More Than Three Images

1. The model discovers more than three candidates.
2. The model selects the three most relevant files or asks the user which files to use.
3. The tool rejects any call containing more than three paths.
4. The assistant must not silently attach an arbitrary subset after validation fails.

### UC5: Image Outside Approved Workspace

1. The model calls the tool with an absolute path outside the approved workspace.
2. The tool resolves the canonical path.
3. The tool returns a safe failure without reading the file.
4. No image bytes leave the device.

## Product Principles

### The Desktop Owns Local File Access

Only the desktop app can resolve and read local paths. The AI server must never receive a local filesystem path or attempt to read one.

### Consent Covers The Transfer

The approval prompt must state that selected local images will be sent to the configured AI server. A generic "read file" prompt is insufficient because this operation transfers data off-device.

### Metadata And Payload Have Different Lifetimes

File names, sizes, hashes, and status may be persisted. Encoded image bytes remain transient in the query loop and are redacted from diagnostics.

### Limits Are Enforced At Every Boundary

The model-facing schema, skill executor, query-loop handoff, IPC boundary, and server all enforce compatible limits. UI validation alone is not a security boundary.

### Existing Chat Behavior Remains Stable

Text-only turns, user-selected attachments, document attachments, plan mode, tool approval modes, and local-provider capability checks must continue to behave as they do today.

## User Experience Requirements

### Tool Call Card

The existing tool-call card should show:

- Tool display name: "Attach local images"
- Number of requested images
- Relative workspace paths, truncated safely when necessary
- Approval state
- Preparation progress
- Final attached count or error summary

The card must never display base64, data URLs, raw bytes, authentication information, or an unrestricted absolute path outside the approved workspace presentation.

### Approval Prompt

In `ask_for_approval` mode, the prompt must communicate:

- which images will be read,
- that prepared copies will be sent to the configured AI service,
- the maximum number of images,
- that approval applies to this tool call.

`approve_for_me` and `full_access` behavior must follow the existing approval policy. The security review must decide whether outbound image transfer can ever be auto-approved based only on an existing filesystem grant.

### Progress

For calls that take longer than 500 milliseconds, emit bounded progress states:

- `validating`
- `reading`
- `normalizing`
- `ready`

Progress events contain counts and filenames only. They do not contain bytes.

### Failure Presentation

Failures should use the current tool-result UI. The user should see one concise cause and, where safe, the affected relative path. Multiple per-file failures may be summarized in a compact list.

### Internationalization

All new strings must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

## Tool Contract

### Tool Name

`attach_local_images`

### Tool Description

Attach one to three local image files from the approved conversation workspace to the current AI request. Use `glob_files` first when paths are unknown. This tool transfers prepared image content to the configured AI server after permission is granted.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "paths": {
      "type": "array",
      "description": "Exact image paths relative to the approved workspace, or absolute paths inside it.",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "minItems": 1,
      "maxItems": 3,
      "uniqueItems": true
    },
    "detail": {
      "type": "string",
      "enum": ["auto", "low", "high"],
      "default": "auto"
    }
  },
  "required": ["paths"],
  "additionalProperties": false
}
```

### Persistable Tool Result

```json
{
  "success": true,
  "attached_count": 2,
  "attachments": [
    {
      "file_name": "product-front.jpg",
      "relative_path": "products/product-front.jpg",
      "mime_type": "image/jpeg",
      "prepared_size_bytes": 842311,
      "sha256": "hex-encoded-content-hash",
      "detail": "auto"
    }
  ],
  "summary": "Prepared 2 images for the next AI request."
}
```

The persistable result must not include `contentBase64`, `dataUrl`, buffers, original absolute paths outside the display policy, or image dimensions that have not been validated.

### Transient Artifact Contract

The internal execution result must support a non-persisted field separate from `result`:

```typescript
export interface ImageModelArtifact {
  readonly kind: "image";
  readonly fileName: string;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  readonly sizeBytes: number;
  readonly dataUrl: string;
  readonly detail: "auto" | "low" | "high";
  readonly sha256: string;
}

export interface ToolExecutionResult {
  readonly success: boolean;
  readonly execution_time_ms: number;
  readonly result: Record<string, unknown>;
  readonly modelArtifacts?: readonly ImageModelArtifact[];
}
```

`modelArtifacts` is consumed by `AIChatQueryLoop`. It must be removed before:

- `ToolExecutionService` persistence,
- renderer IPC events,
- hook output serialization,
- normal logging,
- analytics payloads,
- error reports.

## Model Transcript Contract

After successful execution, the desktop app adds two model-facing messages in order:

1. A normal `role: "tool"` message containing only the safe JSON result.
2. A transient `role: "user"` multimodal handoff message containing the prepared images.

Example:

```json
[
  {
    "role": "tool",
    "tool_call_id": "call_attach_123",
    "content": "{\"success\":true,\"attached_count\":2,...}"
  },
  {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "The desktop attached 2 local images requested by tool call call_attach_123. Continue the user's current request using these images."
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "data:image/jpeg;base64,...",
          "detail": "auto"
        }
      }
    ]
  }
]
```

The synthetic user message is model-only. It is not rendered as a new user-authored bubble and is not persisted as ordinary conversation text. This structure avoids relying on provider support for image parts inside `role: "tool"` messages.

The text part must not include untrusted instructions derived from filenames or image metadata. Filenames remain in the preceding JSON tool result.

## Image Limits

### Required Limits

| Limit | Desktop Value | Reason |
|---|---:|---|
| Images per AI request | 3 | Matches server `MAX_IMAGES_PER_REQUEST` |
| Raw local file size | 5 MiB | Matches existing attachment input policy |
| Prepared image target | 1.5 MiB | Keeps three-image requests below the server ceiling |
| Maximum long edge | 1568 px | Matches existing renderer normalization |
| JPEG initial quality | 0.82 | Matches existing renderer normalization |
| Client total data-URL target | 6,000,000 characters | Leaves transport and history headroom |
| Server total data-URL hard limit | 10,000,000 characters | Server-enforced final boundary |

### Count Semantics

The three-image limit applies to the complete outgoing request, not only to one tool call. If the request transcript already contains current-turn image content, `attach_local_images` may attach only the remaining capacity.

Examples:

- Zero existing images: tool may attach three.
- One current-turn user-selected image: tool may attach two.
- Three existing images: tool returns `image_limit_reached` without reading additional files.

Historical images that the context assembler represents only as metadata do not count. Any historical image included as an actual `image_url` content part does count.

### Size Semantics

Base64 adds approximately one third to the binary size. The implementation must calculate the actual final data-URL character length instead of estimating from raw file bytes.

When an image exceeds the prepared target:

1. Resize to the standard long-edge limit.
2. Encode using the standard format and quality policy.
3. If still oversized, reduce dimensions or JPEG quality in bounded steps.
4. Preserve alpha only when the result remains within the target.
5. Reject the file if it cannot fit without falling below the minimum acceptable dimensions.

The implementation must define a bounded number of encoding attempts to prevent excessive CPU usage.

## Functional Requirements

### FR1: Built-In Tool Registration

Register `attach_local_images` as a built-in main-process skill.

Acceptance criteria:

- The tool appears in the normal tool catalog.
- The schema uses `maxItems: 3` and `uniqueItems: true`.
- The tool is unavailable when no conversation workspace is approved.
- The tool follows local-provider tool capability restrictions.
- The tool is available in chat mode and subject to plan-mode policy.

### FR2: Exact Path Inputs

The tool accepts exact paths only.

Acceptance criteria:

- Relative paths resolve against the approved workspace root.
- Absolute paths are accepted only when inside the approved workspace.
- Glob patterns, directory paths, URLs, and data URLs are rejected.
- Duplicate canonical paths are rejected or deduplicated deterministically before file reads.
- The model description directs discovery to `glob_files`.

### FR3: Workspace Containment

Every requested file must remain inside the approved workspace after canonical path resolution.

Acceptance criteria:

- Resolve symlinks before containment checks.
- Reject path traversal.
- Reject files whose parent or target changes during validation and read.
- Do not fall back to process working directory when workspace state is missing.
- Return relative paths in user-visible results.

### FR4: File Validation

Validate each candidate before preparing any outbound request.

Acceptance criteria:

- Allowed types are PNG, JPEG, WebP, and GIF.
- Extension and detected file signature must agree with an allowed type.
- SVG, HTML, PDF, TIFF, RAW, and arbitrary binary files are rejected.
- Empty files and files larger than 5 MiB are rejected.
- Excessive dimensions or decompression-bomb indicators are rejected.
- A failure identifies the affected relative path without leaking unrelated filesystem details.

### FR5: Image Normalization

Prepare images using a main-process-compatible normalizer.

Acceptance criteria:

- Long edge is at most 1568 pixels.
- Images are never upscaled.
- JPEG output begins at quality 0.82.
- PNG transparency is preserved when it fits the target.
- Animated GIF behavior is documented; the first release may use the first frame.
- Final byte size and data-URL character length are measured after encoding.
- Normalization is abortable between encoding attempts.

### FR6: Permission And Approval

The tool must pass through the existing skill permission system.

Acceptance criteria:

- Default mode asks before reading and transferring image content.
- The approval UI lists all requested relative paths.
- The prompt states that image content will be sent to the configured AI server.
- Denial reads no image bytes and continues the model loop with a structured failure.
- Permission-resume execution produces the same result as initially approved execution.

### FR7: Transient Artifact Isolation

Image payloads must remain outside the persistable tool result.

Acceptance criteria:

- Tool-result database rows contain metadata only.
- Renderer tool events contain metadata only.
- Hooks receive metadata by default and cannot accidentally log artifact bytes.
- Application logs include counts and sizes but not data URLs.
- Serialization helpers cannot include `modelArtifacts` through object spreading.
- Unit tests search serialized results for the base64 prefix and fail if it appears.

### FR8: Query Loop Handoff

`AIChatQueryLoop` must add prepared images to the next request round.

Acceptance criteria:

- The safe tool result is appended first.
- A model-only multimodal handoff message follows it.
- The next round sees all successfully prepared images.
- The handoff message is removed when the turn ends or is cancelled.
- Retry behavior reuses the prepared artifacts without reading files again when safe.
- Recovery logic never duplicates image parts in the same request.

### FR9: Combined Request Limits

The query loop must enforce image limits against the complete outgoing request.

Acceptance criteria:

- No outgoing request contains more than three image parts.
- No outgoing request exceeds the six-million-character client target due to tool images.
- If existing image parts consume capacity, the tool fails before preparing excess images.
- A server-side 422 remains handled as a final defensive error rather than normal control flow.

### FR10: Local Persistence

The app should retain enough local information to explain the tool operation after restart.

Acceptance criteria:

- Persist attachment metadata through Model and Module layers only.
- IPC handlers perform no direct TypeORM access.
- Persisting original or prepared bytes is optional for the first release and must follow existing `AIChatAttachmentModule` policy if enabled.
- The persisted tool card remains useful if the original file is later moved.
- Clearing a conversation clears any app-owned attachment copies associated with it.

### FR11: Streaming And Cancellation

The feature must preserve the existing streaming lifecycle.

Acceptance criteria:

- The user can stop during validation or normalization.
- Cancellation prevents the next AI request.
- No late tool result resumes a cancelled conversation.
- Image-edit responses continue to arrive through normal SSE completion events.
- Generated images continue to use the existing local-save and rendering path.

### FR12: Error Contract

The tool returns structured, model-readable errors.

Required error codes:

- `workspace_required`
- `path_outside_workspace`
- `path_not_found`
- `path_is_directory`
- `unsupported_image_type`
- `image_signature_mismatch`
- `image_file_too_large`
- `image_dimensions_too_large`
- `image_limit_reached`
- `image_payload_too_large`
- `image_processing_failed`
- `permission_denied`
- `cancelled`

Every failure result includes `success: false`, `code`, `error`, and safe per-file details when applicable.

### FR13: Internationalization

Every new user-facing label, status, confirmation, and error must be translated into all six supported languages.

Acceptance criteria:

- Translation keys have the same structure in every language file.
- English fallback text is present where required by existing component patterns.
- Tool result codes remain stable English identifiers and are mapped to localized UI text.

## Architecture

### Required Data Flow

```text
User request
    |
    v
AIChatQueryLoop sends tools
    |
    v
LLM calls glob_files
    |
    v
LLM calls attach_local_images(paths[1..3])
    |
    v
SkillExecutor applies approval policy
    |
    v
AIImageAttachmentToolService
    |-- resolve workspace and canonical paths
    |-- validate image signatures and sizes
    |-- normalize images
    |-- build safe metadata result
    `-- build transient model artifacts
    |
    v
AIChatQueryLoop
    |-- persists/emits metadata-only tool result
    |-- appends model-only multimodal handoff
    `-- starts next chat-completion round
    |
    v
AI server validates <= 3 images and routes analysis/editing
    |
    v
AiChatV2 renders text and generated images
```

### Expected Desktop Files

New files are expected to include:

- `src/service/AIImageAttachmentToolService.ts`
- `src/entityTypes/aiImageAttachmentToolTypes.ts`
- Focused tests under `test/modules/`

Existing files likely to change:

- `src/config/skillsRegistry.ts`
- `src/entityTypes/skillTypes.ts`
- `src/api/aiChatApi.ts`
- `src/service/SkillExecutor.ts`
- `src/service/AIChatQueryLoop.ts`
- `src/service/ToolExecutionService.ts`
- `src/service/ToolSchemaSanitizer.ts`
- `src/service/ToolTimeoutPolicy.ts`
- `src/views/components/aiChatV2/AiChatV2Message.vue`
- `src/views/lang/{en,zh,es,fr,de,ja}.ts`

`AiChatV2.vue` should require little or no tool-specific logic. It may need only shared error or progress wiring if existing generic rendering is insufficient.

### Database Architecture

If tool attachment metadata or bytes are stored:

1. Model classes perform TypeORM operations.
2. Module classes apply conversation-level business rules.
3. Main-process services call Modules.
4. IPC handlers remain communication-only.
5. Worker processes never access the database.

## Security And Privacy Requirements

### Local Filesystem

- Require an approved workspace.
- Resolve and compare canonical paths.
- Reject symlink escapes and path traversal.
- Read regular files only.
- Avoid time-of-check/time-of-use gaps where practical.
- Limit total CPU time and memory used for decoding.

### Outbound Data

- Obtain permission before preparing the outbound transfer.
- Send images only to the AI base URL already configured by the application.
- Do not accept a destination URL from tool arguments.
- Do not include local absolute paths in the AI request.
- Do not include unrelated file metadata.

### Logging And Persistence

- Redact `data:image/` values from all diagnostic paths.
- Never log artifact objects through generic JSON logging.
- Never persist artifact payloads as tool results.
- Record only counts, prepared sizes, MIME types, hashes, durations, and outcome codes.

### Model Safety

- Tool descriptions must not instruct the model to attach arbitrary secrets.
- Workspace approval is not permission to scan or upload every file.
- Exact-path calls and a three-image cap limit unintended bulk transfer.
- The app must not infer file selection from image contents before approval.

## Performance Requirements

1. Validation of three normal files should begin within 100 milliseconds after approval.
2. Preparation should emit progress if it exceeds 500 milliseconds.
3. Peak in-memory image payload should remain bounded to the current batch plus encoding overhead.
4. Encoded artifacts should be released after turn completion, cancellation, or terminal error.
5. A retry should reuse a valid prepared artifact rather than repeat expensive decoding, unless the source changed.
6. The tool timeout policy must allow bounded image normalization without inheriting an unlimited filesystem timeout.

## Observability

Record metadata-only events for:

- tool requested,
- approval granted or denied,
- validation completed,
- normalization completed,
- handoff request started,
- server validation failure,
- server edit completed,
- cancellation.

Recommended fields:

- conversation ID or hashed correlation ID,
- tool-call ID,
- requested count,
- attached count,
- total prepared bytes,
- total data-URL characters,
- MIME types,
- duration,
- result code.

Do not record filenames in remote telemetry unless the existing telemetry privacy policy explicitly permits them.

## Testing Requirements

### Unit Tests

- Tool schema accepts one to three unique paths.
- Tool schema rejects zero or four paths.
- Workspace-relative and valid absolute paths resolve correctly.
- Traversal and symlink escape attempts fail.
- Unsupported types and signature mismatches fail.
- File and dimension limits fail before request construction.
- Normalization respects dimension and payload targets.
- Transient artifacts never appear in serialized tool results.
- Existing request image parts reduce remaining capacity.
- Cancellation stops preparation and continuation.

### Query Loop Tests

- Successful tool execution appends safe tool JSON followed by a transient multimodal handoff.
- The next round contains the expected number of image parts.
- Tool events sent to the renderer contain no base64.
- Tool-result persistence contains no base64.
- Recovery does not duplicate images.
- Permission pause and resume preserve the artifact contract.
- Server 422 errors surface through the existing chat error path.

### Integration Tests

- `glob_files` followed by `attach_local_images` followed by image Q&A succeeds.
- One-image edit produces a generated image in AiChatV2.
- Three-reference request stays below the client target and reaches the server.
- Four-image request is rejected locally without an HTTP call.
- User-selected and tool-selected images cannot exceed three in combination.
- Stop-stream during preparation sends no continuation request.

### UI Tests

- Approval prompt lists requested files and transfer intent.
- Tool card displays count, filenames, progress, and final result.
- Long paths do not overflow the card.
- All new UI text renders in each supported language.
- Base64 text never appears in the DOM.

## Rollout Plan

### Phase 1: Internal Artifact Contract

- Add typed transient model artifacts.
- Prove persistence, hooks, logging, and renderer events exclude payloads.
- Add serialization regression tests.

### Phase 2: Tool Service

- Register `attach_local_images`.
- Implement workspace validation and image preparation.
- Add permission copy and translations.

### Phase 3: Query Loop Integration

- Add metadata-only tool result.
- Add model-only multimodal handoff.
- Enforce combined request count and size.

### Phase 4: Server Contract Verification

- Run the companion server tests.
- Verify image analysis and image-edit routes for tool-selected inputs.
- Verify structured errors and redaction.

### Phase 5: Controlled Release

- Gate with a desktop feature flag if required.
- Measure rejection rate, average payload size, and preparation duration.
- Remove the flag only after server compatibility is confirmed in production-like deployment.

## Acceptance Criteria

The feature is complete when:

1. The model can discover image paths with `glob_files` and attach up to three exact files.
2. The user receives a clear approval prompt before image content is sent.
3. Every file is verified to be inside the approved workspace.
4. The complete outgoing request contains at most three images.
5. The desktop targets at most six million combined data-URL characters.
6. The AI server can analyze or edit the tool-selected images.
7. Base64 data never appears in persisted tool results, renderer tool events, logs, or telemetry.
8. Stop, retry, permission resume, and generated-image rendering continue to work.
9. Tests cover security boundaries, count limits, size limits, transcript construction, and redaction.
10. All user-facing strings are translated into all supported languages.

## Future Work

### True Batch Editing

Independent editing of more than three source images should use an asynchronous job contract rather than repeated chat turns. A future tool could submit a manifest, process each input independently, emit progress, and return an input-to-output mapping.

### Server-Side Upload Handles

If inline payloads remain too expensive, a later release may introduce authenticated, short-lived server upload handles. That design requires server storage, expiry, ownership checks, quota controls, deletion behavior, and a new threat model. It is intentionally excluded from this release.

### Content Hash Deduplication

The desktop may reuse already prepared content within the same active turn when the canonical path, modification time, size, and hash still match.

## Open Questions

1. Should `approve_for_me` auto-approve outbound image transfer, or should the first transfer per workspace always require confirmation?
2. Should prepared copies be stored through `AIChatAttachmentModule` for durable history previews, or should only metadata be retained for tool-selected images?
3. What minimum dimensions are acceptable when repeated compression is required to meet the payload target?
4. Should animated GIF input use the first frame or be rejected explicitly?
5. Should plan mode allow `attach_local_images`, or should it remain blocked until an approved plan enters execution?

