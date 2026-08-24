# AI Chat Generated-Image Editing Without a Workspace Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-24
- **Owner**: AiFetchly Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Primary areas**: AI Chat V2, generated-image storage, multimodal requests, image editing, batch subagents
- **Related desktop documents**:
  - [`ai-chat-llm-image-attachment-tool-prd.md`](./ai-chat-llm-image-attachment-tool-prd.md)
  - [`ai-chat-batch-worker-subagent-prd.md`](./ai-chat-batch-worker-subagent-prd.md)
  - [`ai-chat-v2-attachment-upload-prd.md`](../ai-chat-v2-attachment-upload-prd.md)
  - [`openai-compatible-chat-v2-prd.md`](../openai-compatible-chat-v2-prd.md)
- **Related server document**:
  - `/home/robertzeng/project/aifetchserver/docs/chat-image-generation-prd.md`
- **Existing implementation areas to preserve or evolve**:
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/AiChatV2Composer.vue`
  - `src/views/components/aiChatV2/AiChatV2Message.vue`
  - `src/entityTypes/aiChatV2Types.ts`
  - `src/main-process/communication/ai-chat-v2-ipc.ts`
  - `src/service/AIChatQueryEngine.ts`
  - `src/service/AIChatGeneratedImageStorageService.ts`
  - `src/service/AIChatGeneratedImageProtocol.ts`
  - `src/service/AIChatGeneratedImageContextService.ts`
  - `src/service/agentTools/processArtifactBatchTool.ts`
  - `src/service/AgentRuntime.ts`

## 1. Executive Summary

AiFetchly can generate images through AI Chat V2 and persist the returned provider artifacts under Electron's application-managed user-data directory. It cannot reliably edit those images in a later chat turn when the conversation has no approved workspace.

The current follow-up workflow exposes a textual `aifetchly-generated-image://` reference to the chat model and instructs the model to call `export_generated_artifacts`, followed by `attach_local_images`. Both tools are intentionally workspace-bound. A user who only wants to chat, generate an image, and edit it receives `workspace_required` instead of an edited image.

This PRD introduces a workspace-independent generated-image reference channel. The renderer sends opaque message and image identifiers. The main process verifies ownership, resolves the application-managed image, prepares a bounded transient image payload, and includes it as an OpenAI-style `image_url` content part in the current request. The AI server then uses its existing image-edit path.

The product will support one or several selected generated images. Direct requests will accept up to three references, matching the current desktop and server inbound image limit. Larger independent jobs will reuse the existing bounded batch coordinator and `agent-batch-worker` isolation model without copying image bytes into the parent chat context. The main conversation receives only progress, summaries, and durable generated-image descriptors.

An approved workspace remains mandatory for reading or writing project files. It is not required for images that AiFetchly generated, stored, and already associates with the authenticated user and conversation.

## 2. Background and Current State

### 2.1 Image generation already works

The existing image-generation flow is:

1. The user asks for an image in AI Chat V2.
2. The desktop calls the OpenAI-compatible chat endpoint.
3. The AI server executes its internal image-generation tool.
4. The server returns normalized image artifacts in `choices[0].message.images` or the equivalent streaming completion metadata.
5. `AIChatGeneratedImageStorageService` immediately downloads or decodes each artifact.
6. The desktop stores the bytes beneath the current user's generated-image root.
7. The assistant message persists lightweight `metadata.generatedImages` descriptors.
8. The renderer displays the image through the `aifetchly-generated-image://` protocol.

This protects the user from temporary provider URLs and keeps generated image bytes out of the AI server's durable storage.

### 2.2 User-selected image editing already works

When the user selects an image in the composer, the renderer downscales and encodes it. The main process validates the attachment and `AIChatQueryEngine` sends a multimodal user message:

```json
[
  {
    "type": "text",
    "text": "Add a dog beside the lion."
  },
  {
    "type": "image_url",
    "image_url": {
      "url": "data:image/png;base64,...",
      "detail": "auto"
    }
  }
]
```

The server detects an attached image plus explicit edit intent and runs its server-owned image-edit capability. This path does not require a desktop workspace.

### 2.3 Editing a previously generated image takes the wrong route

Generated image descriptors are stored in assistant message metadata, not in normal message content. The desktop currently appends a model-only `<generated_images>` text block containing the protocol URL, file name, and local path. The built-in tool capability prompt then tells the model to:

1. Call `export_generated_artifacts` to copy the image into an approved workspace.
2. Call `attach_local_images` with the new workspace path.
3. Continue to the server image edit.

This route fails when the user has not selected a workspace. The observed failure sequence is:

```text
User: Please add a dog into the image.
Model: attach_local_images(application-managed local path)
Tool: workspace_required
Model: export_generated_artifacts(protocol URL)
Tool: workspace_required
Model: apologizes instead of editing the image
```

The workspace checks are correct. The routing decision is wrong.

### 2.4 Existing batch processing is workspace-bound

`process_artifact_batch` accepts workspace file paths and runs one isolated `agent-batch-worker` operation per input with concurrency from one to three. It intentionally requires an approved workspace because its inputs are user project files.

The scheduler, ordered result mapping, partial-success behavior, cancellation, and generated-artifact harvesting are reusable. Its workspace-file authorization contract must not be reused unchanged for application-managed generated images.

### 2.5 Effective image limits

The current effective limit for one outgoing multimodal chat request is three images:

- Desktop `CHAT_IMAGE_LIMITS.maxImagesPerRequest`: 3.
- AI server `chat_max_images_per_request`: hard maximum 3 for the current release.
- AI server `image_edit_max_outputs`: default 3, maximum 4.
- AI generation schema `MAX_IMAGE_REFERENCE_COUNT`: 10, but the public chat request boundary remains the lower effective limit of 3.

The product must not present the schema-level reference limit of ten as a supported direct-chat limit while the public request boundary is three.

## 3. Problem Statement

Users treat a generated image as part of the conversation. After asking AiFetchly to create a lion image, they naturally say "add a dog into the image." They do not expect to create or approve a filesystem workspace before AiFetchly can edit its own output.

The product must solve four related problems:

1. **Workspace coupling**: Chat-generated images incorrectly depend on workspace export and attachment tools.
2. **Reference ambiguity**: A conversation can contain several generated images, and the product must preserve single-image and multi-image intent without guessing incorrectly.
3. **Context growth**: Image bytes and long local-path annotations must not accumulate in the parent conversation or be resent on every turn.
4. **Batch scale**: Large independent image jobs should use isolated subagent requests so the parent model does not carry every image and intermediate result.

## 4. Product Principles

1. **Generated images are conversation artifacts, not workspace files.** They use a separate authorization path.
2. **Opaque references cross the renderer boundary.** The renderer sends message identity and image position, never an absolute source path.
3. **The main process is the trust boundary.** It resolves, validates, prepares, and transiently attaches generated images.
4. **Selection is explicit when intent is ambiguous.** The product may infer only low-risk, obvious references.
5. **Multi-image capability is preserved.** The UX and request contract support ordered arrays, not a single image slot.
6. **Direct interaction stays fast.** One to three references use the normal chat edit path.
7. **Large independent work is isolated.** Batch jobs run bounded subagent operations and return compact parent results.
8. **Image bytes are transient.** They never appear in ordinary message text, persisted tool results, logs, or parent subagent summaries.
9. **Security boundaries do not collapse.** This feature does not weaken workspace containment or permit arbitrary local file reads.
10. **The current AI server contract is reused.** The desktop sends validated `data:image/...` content parts rather than introducing provider-specific desktop APIs.

## 5. Product Decisions

The following decisions are requirements:

1. Editing a chat-generated image will not require an approved workspace.
2. Editing a workspace image will continue to require an approved workspace.
3. The generated-image request contract will accept an ordered array of references.
4. A reference will identify an existing assistant message and image index. It will not contain `local_path`.
5. The main process will re-read authoritative message metadata before resolving a reference.
6. Direct editing will support one to three generated-image references per request.
7. Four or more independent edits will route through bounded batch execution.
8. Multi-reference fusion will remain limited to the direct request limit. The product will not pretend that fifty reference images can be fused in one provider request.
9. Explicit composer selection will override automatic reference inference.
10. Base64 or data URLs will exist only in the transient model request.
11. Previous generated-image bytes will not be resent on later turns unless the user selects or clearly references them again.
12. Batch subagents will receive exact approved generated-image inputs from the main process. They will not query the database or accept arbitrary paths.
13. Parent chat tool results will contain descriptors, counts, mappings, and errors, never image bytes.
14. Existing generated-image tool prompt instructions that force `export_generated_artifacts -> attach_local_images` will be removed for chat-generated image editing.
15. `export_generated_artifacts` will remain available when the user explicitly asks to save a generated image into an approved workspace.

## 6. Goals

1. Let a user generate and edit an image entirely within chat without selecting a workspace.
2. Support ordered selection of one to three generated images for direct editing or fusion.
3. Support larger independent edit jobs using bounded subagent execution.
4. Preserve exact input-to-output mappings for batch jobs.
5. Keep the parent chat context small regardless of how many generated images exist in history.
6. Reuse the server's existing image generation, image editing, streaming, cost tracking, and normalized artifact response paths.
7. Reuse the desktop's generated-image storage and rendering paths.
8. Provide deterministic, user-visible handling for ambiguous references, missing files, invalid images, partial failures, and cancellation.
9. Maintain user, conversation, path-containment, MIME, image-signature, dimension, pixel-count, and payload-size checks.
10. Preserve all existing workspace image capabilities.

## 7. Non-Goals

1. Do not make application-managed generated-image storage a general filesystem workspace.
2. Do not allow the renderer, chat model, or subagent to supply an absolute generated-image path.
3. Do not let the remote AI server fetch `aifetchly-generated-image://` URLs.
4. Do not upload every image in conversation history on each turn.
5. Do not persist base64 image data in chat message content or tool-result JSON.
6. Do not add server-side durable generated-image storage.
7. Do not add layers, masks, canvas editing, or non-destructive image project files.
8. Do not guarantee one output per input for fusion requests.
9. Do not weaken `attach_local_images`, `export_generated_artifacts`, `FilePathGuard`, or workspace approval policies.
10. Do not let child or utility processes access TypeORM repositories directly.
11. Do not run unbounded provider requests for large batches.
12. Do not silently select an image when several plausible singular references exist.

## 8. User Stories

### 8.1 Edit the latest generated image

As a chat user, after generating one image, I can say "add a dog into the image" and receive an edited image without selecting a workspace.

### 8.2 Explicitly choose an older image

As a chat user, I can select an older generated image, see it in the composer reference tray, and send an edit that applies to that image rather than the most recent one.

### 8.3 Edit several images independently

As a chat user, I can select several generated images and ask to apply the same change to each. For up to three images, the direct server behavior may edit each independently. For larger selections, AiFetchly runs a bounded batch and returns every successful result.

### 8.4 Combine several images

As a chat user, I can select up to three images in a defined order and ask AiFetchly to combine them, for example "put image 1 on the left and image 2 on the right."

### 8.5 Retry partial batch failures

As a chat user, when eighteen of twenty images succeed, I keep those results and can retry only the two failed references.

### 8.6 Continue chatting without image context growth

As a chat user, I can generate many images over a long conversation without every old image being added to every subsequent request.

## 9. User Experience Requirements

### 9.1 Generated-image actions

Every rendered generated image will expose actions appropriate to its state:

- **Use as reference**: add or remove the image from the composer reference tray.
- **Edit**: add the image as the sole initial reference and focus the composer.
- **Open**: retain the existing local-file open behavior.
- **Save to workspace**: available only when a workspace exists or after the user chooses one; this remains an export action, not an edit prerequisite.

The action labels and tooltips must be translated into English, Chinese, Spanish, French, German, and Japanese.

### 9.2 Composer reference tray

The composer will show selected generated images as ordered thumbnails or chips above the text input.

Required behavior:

1. The tray displays selection order as `1`, `2`, `3`, and so on.
2. Each item can be removed independently.
3. The user can clear all references.
4. The tray distinguishes generated-image references from newly uploaded files.
5. The send button remains available when the message contains text or selected references.
6. A direct request stops accepting references after three and offers batch processing for independent edits.
7. Reordering must be supported when order changes the requested composition.
8. Switching conversations clears unsent generated-image references or restores them only from conversation-scoped draft state. References must never leak across conversations.

### 9.3 Automatic reference inference

AiFetchly may infer references only under these rules:

1. Explicit composer selections always win.
2. If the latest generation turn contains exactly one image and the user clearly refers to editing "the image," "this image," "it," or equivalent translated phrasing, attach that image.
3. If the user says "both," "all three," or names image numbers and the latest relevant generation group contains no more than three images, attach the requested images in display order.
4. If the user clearly requests the same independent edit for more than three generated images, offer or start the batch path according to the active tool-approval mode.
5. If singular wording could refer to several images, do not guess. Show a reference-selection prompt tied to the candidate thumbnails.
6. If plural wording does not identify a bounded set, show a confirmation such as "Use these 6 images?" before starting a paid batch.
7. Automatic inference must be implemented as deterministic desktop logic. It must not depend on the chat model discovering local paths.

### 9.4 Direct-edit progress

For one to three references, the existing chat streaming UI remains in use. The user sees normal generation progress followed by the returned image artifacts.

### 9.5 Batch progress

For four or more independent inputs, the conversation displays one evolving batch execution surface:

- queued, running, completed, failed, and cancelled counts;
- `N of M completed` progress;
- bounded concurrency value;
- optional estimated remaining work without promising an exact completion time;
- per-item failure details in an expandable section;
- a stop action;
- a retry-failed action after completion;
- generated results rendered as they become durably available or at batch completion, depending on the existing event model.

The UI must not create one full chat message or one large tool card per internal subagent round.

## 10. Routing Rules

| User intent | References | Execution path | Expected output |
|---|---:|---|---|
| Edit the latest generated image | 1 | Direct multimodal chat request | One or more edited variants |
| Edit selected generated images independently | 2-3 | Direct multimodal edit | Up to configured server output cap |
| Combine selected generated images | 2-3 | Direct multi-reference edit | Usually one composed image |
| Apply the same edit to many generated images | 4-50 | Batch coordinator plus isolated subagents | Ordered per-input results |
| Apply different instructions to many images | Any | Separate explicit tasks or a future per-item instruction contract | Per-task results |
| Analyze generated images without modifying them | 1-3 | Direct multimodal chat analysis | Text answer |
| Edit a workspace image | 1 | `attach_local_images` | Edited image |
| Edit many workspace images independently | 2-50 | Existing `process_artifact_batch` workspace path | Ordered per-file results |
| Save a generated image into a project | Any bounded export set | `export_generated_artifacts` | Workspace files |

The direct path is selected by reference count and intent, not by whether a workspace exists.

## 11. Architecture Overview

### 11.1 Direct generated-image edit

```text
Renderer
  Generated image selection: messageId + imageIndex
        |
        v
AI Chat V2 IPC
  Shape and count validation, AI-enable gate
        |
        v
AIChatQueryEngine
  GeneratedImageReferenceService
    -> Module/Model reads authoritative message metadata
    -> validates user + conversation + assistant message + index
    -> resolves sanctioned protocol beneath current-user root
    -> validates regular file, containment, MIME, signature, size, dimensions
    -> prepares transient image bytes
        |
        v
OpenAI-compatible user content
  text + 1..3 image_url data parts
        |
        v
AI server image-edit orchestrator
        |
        v
Generated image response
        |
        v
AIChatGeneratedImageStorageService
  durable local files + lightweight message metadata
```

### 11.2 Batch generated-image edit

```text
Parent chat
  instruction + 4..50 opaque references
        |
        v
Artifact batch coordinator
  validates the whole requested set once
  resolves each generated reference in the main process
        |
        +--> isolated worker 1: one transient image + instruction
        +--> isolated worker 2: one transient image + instruction
        +--> isolated worker 3: one transient image + instruction
               bounded concurrency; next item starts when a slot frees
        |
        v
Ordered aggregate
  statuses + generated-image descriptors + compact errors
        |
        v
Parent chat
  one progress surface + rendered durable outputs
```

### 11.3 Why the parent context stays small

The parent model receives only:

- the user's instruction;
- opaque selection metadata or a compact batch tool call;
- aggregate progress and final summaries;
- generated-image descriptors needed for rendering.

The parent model does not receive:

- source image base64;
- generated output base64;
- provider response bodies;
- per-worker tool transcripts;
- absolute application storage paths;
- one textual result per internal provider round.

Image input tokens and provider cost still exist. Subagents isolate that cost from the parent context; they do not eliminate it.

## 12. Request and Data Contracts

### 12.1 Generated-image reference

```typescript
export interface ChatV2GeneratedImageReference {
  messageId: string;
  imageIndex: number;
}
```

Constraints:

- `messageId`: required non-empty identifier of a persisted message in the active conversation.
- `imageIndex`: integer greater than or equal to zero.
- The current conversation ID comes from the trusted request context, not from each reference.
- The renderer does not send a path, protocol URL, MIME type, or user identity.
- Reference order is meaningful and must be preserved.

### 12.2 Stream request extension

```typescript
export interface ChatV2StreamRequest {
  // Existing fields omitted.
  generatedImageReferences?: ChatV2GeneratedImageReference[];
}
```

Direct request validation:

- Maximum three references.
- Duplicate `(messageId, imageIndex)` pairs are removed while preserving first occurrence.
- Invalid references fail the request before any AI server call.
- Uploaded images and generated-image references share the same combined image count and payload limits.

### 12.3 Persisted user-message metadata

The user message may persist lightweight display metadata:

```typescript
export interface ChatV2GeneratedImageReferenceMetadata {
  messageId: string;
  imageIndex: number;
  fileName?: string;
  protocolUrl?: string;
}
```

`protocolUrl` is optional and must be a sanctioned local generated-image URL. The metadata must not include `local_path`, base64, a data URL, or a provider signed URL.

### 12.4 Batch tool extension

The existing batch coordinator will preserve its workspace `files` input and add a mutually exclusive generated-image source:

```typescript
interface ProcessArtifactBatchInput {
  files?: string[];
  generatedImageReferences?: ChatV2GeneratedImageReference[];
  instruction: string;
  processor?: "image_edit";
  concurrency?: 1 | 2 | 3;
  detail?: "auto" | "low" | "high";
}
```

Rules:

1. Exactly one of `files` or `generatedImageReferences` is supplied.
2. `files` preserves the existing approved-workspace requirement.
3. `generatedImageReferences` requires no workspace and uses current-user plus current-conversation authorization.
4. Generated-image batches accept 1-50 unique references, although direct chat routes one to three without the batch coordinator.
5. One generated-image reference is processed by one isolated provider request for independent batch edits.
6. The batch contract does not support fusion across more than the direct image limit.

### 12.5 Batch result

```typescript
interface GeneratedImageBatchResult {
  status: "completed" | "partial" | "failed" | "cancelled";
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  concurrency: number;
  items: Array<{
    reference: ChatV2GeneratedImageReference;
    status: "completed" | "failed" | "cancelled";
    agentTaskId?: string;
    outputImages: ChatV2GeneratedImage[];
    errorCode?: string;
    error?: string;
    durationMs: number;
  }>;
  outputImages?: ChatV2GeneratedImage[];
}
```

`items` is authoritative for input-to-output mapping. `outputImages` is a flattened convenience list for the existing artifact-harvesting path.

## 13. Generated-Image Resolution Requirements

The main process will introduce a service dedicated to resolving generated-image references. It may use Models and Modules for metadata access and filesystem services for byte access.

For every reference, the service must:

1. Load the referenced message through the Module/Model architecture.
2. Confirm the message belongs to the active conversation.
3. Confirm the message role is `assistant`.
4. Parse `metadata.generatedImages` defensively.
5. Confirm `imageIndex` exists.
6. Require a URL using the `aifetchly-generated-image://local/` protocol.
7. Confirm the URL's normalized user segment matches the current authenticated user.
8. Confirm the URL's conversation segment matches the active conversation after the same sanitization used during storage.
9. Resolve the URL beneath the generated-image root.
10. Confirm the resolved path remains beneath the current user's generated-image root.
11. Reject symlinks and non-regular files.
12. Enforce raw and prepared size limits.
13. Detect MIME from trusted bytes or image decoding, not only the extension or stored metadata.
14. Verify MIME and decoded image signature agree.
15. Enforce dimension and pixel-count limits before expensive processing.
16. Prepare an optimized transient representation using the shared image normalization policy.
17. Return bytes only to the in-memory request-building path.
18. Clear references to large buffers after request construction and never log them.

The service must return stable error codes rather than leaking filesystem details.

## 14. Direct Request Behavior

### 14.1 Building the model-facing message

`AIChatQueryEngine` will merge new uploads and generated references into one current-turn content array:

```typescript
currentUserContentParts = [
  { type: "text", text: modelUserMessage },
  ...uploadedImageParts,
  ...generatedReferenceParts,
];
```

The engine must count all parts together. Two uploaded images plus two generated references exceeds the direct limit of three and must be rejected or routed to a supported batch flow when the operation is independent.

### 14.2 Persistence

- The selected-reference metadata may be stored with the user message for UI reconstruction.
- Generated source bytes are not duplicated into the attachment database.
- Data URLs are not stored in user message content or metadata.
- Existing generated image files remain the durable source.
- New edited outputs use the existing generated-image storage service and assistant `metadata.generatedImages` path.

### 14.3 Server interaction

The desktop continues using `/v1/chat/completions`.

The server sees real `image_url` content parts and can:

- run direct image editing for explicit edit intent;
- edit several attachments independently, up to its configured output cap;
- use multi-reference generation for fusion prompts;
- answer visual questions when the prompt requests analysis instead of modification.

The desktop must not send its local protocol URL to the server as an image reference because the remote server cannot resolve it.

### 14.4 Streaming

The existing server behavior for image editing through streaming chat remains authoritative. The desktop continues consuming normal stream events and final image metadata. This feature does not create a second provider stream.

## 15. Batch Subagent Behavior

### 15.1 When batch execution is required

Batch execution is required when:

- more than three generated images need the same independent edit;
- the user explicitly requests processing of a large selected set;
- direct request byte or context estimates exceed safe limits but each item is independently processable.

Batch execution is not used merely because a subagent exists. One-image interactive editing should not pay subagent startup and tool-catalog overhead.

### 15.2 Unit of work

For the current `image_edit` processor, one batch item equals one generated source image plus one shared instruction. Each item performs one isolated server request.

This preserves the existing batch invariant:

> One independent edit input is processed by one isolated provider request.

If a future provider guarantees one-to-many output behavior, the item result already supports an array of output images.

### 15.3 Supplying the image to a subagent

The coordinator must not pretend the application-generated directory is a workspace. Instead, it will pass an ephemeral, exact-input artifact to the subagent runtime after main-process authorization.

Acceptable implementation shapes include:

- an `initialImageArtifacts` field on the subagent runtime request; or
- a subagent-only attachment capability restricted to an exact coordinator-approved artifact handle.

In either case:

- the subagent receives no arbitrary filesystem root;
- the subagent cannot substitute another path;
- the worker never reads the database;
- image bytes remain transient and model-only;
- the parent chat never receives the bytes.

### 15.4 Concurrency

- Default concurrency: 3.
- Maximum concurrency: 3.
- Minimum concurrency: 1.
- The coordinator starts the next queued item when a slot becomes available.
- Provider throttling may reduce effective concurrency without changing result order.
- Results remain ordered by the user's selected-reference order, not completion time.

### 15.5 Partial success

- Failure of one item does not cancel successful siblings.
- Successful output images remain stored and rendered.
- Aggregate status is `partial` when at least one item succeeds and at least one fails or is cancelled.
- Retry uses only failed or cancelled references unless the user explicitly chooses to rerun all.

### 15.6 Cancellation

- Stopping the batch aborts active requests where supported.
- Unstarted items become `cancelled`.
- Completed outputs remain available.
- Cancellation must not delete already persisted source or output images.

## 16. Context and Payload Budget

### 16.1 Conversation history

Conversation history stores only lightweight generated-image descriptors. It never stores or injects historical base64 image content by default.

The current `<generated_images>` annotation must be changed so it does not accumulate absolute local paths. Once explicit reference handling exists, the model does not need a local path to edit a generated image.

Allowed model-history information is limited to compact semantic references when needed, for example:

```text
<generated_images>
  [1] message=assistant-123 image=0 file=image-1.png
</generated_images>
```

The annotation may be omitted entirely if deterministic desktop inference and explicit selection cover the product flow.

### 16.2 Current direct request

Only the selected one to three images are included. The desktop applies the existing normalization targets:

- maximum prepared long edge: 1568 pixels;
- target prepared image size: approximately 1.5 MiB;
- maximum raw input file size: 5 MiB for the attachment preparation policy;
- combined client target: 6,000,000 data-URL characters;
- maximum direct image count: 3.

Application-generated originals may be stored up to the existing generated-image storage limit, but they must be normalized to the smaller outbound limits before being sent back to the AI server.

### 16.3 Batch requests

Each worker receives one source image for independent editing. The parent context contains no image payload. A batch of fifty images therefore creates up to fifty bounded child requests, not one fifty-image request and not fifty images in the parent model context.

### 16.4 Cost visibility

Subagent isolation saves parent context but does not remove provider usage. Batch UX must show the number of requested items before execution and use existing approval and cost controls where available.

## 17. Security and Privacy Requirements

### 17.1 Authorization boundary

Generated-image authorization is based on all of:

- current authenticated user;
- active conversation;
- authoritative assistant message;
- generated image index;
- sanctioned application protocol;
- containment beneath the current user's generated-image root.

Possession of a protocol URL or guessed message ID alone is not authorization.

### 17.2 Renderer trust

The renderer may request a reference but cannot choose the resolved path. The main process treats renderer values as untrusted and revalidates the complete association.

### 17.3 Filesystem safety

- Reject path traversal after URL decoding.
- Reject absolute path input from IPC.
- Reject symlink sources.
- Reject directories and special files.
- Reject files outside the current user's generated-image root.
- Reject generated artifacts from another user or conversation.
- Re-check containment after resolution.

### 17.4 Image safety

- Enforce allowed MIME types.
- Validate decoded signature against MIME.
- Enforce dimension and pixel-count limits.
- Enforce individual and combined byte limits.
- Bound decoding and normalization work.
- Return safe error codes without echoing image bytes.

### 17.5 Data handling

- Never log base64, data URLs, signed provider URLs, or raw image bytes.
- Never persist transient prepared image content in normal chat or tool tables.
- Never include image bytes in `AgentResult`, batch results, analytics, crash reports, or renderer tool cards.
- Continue redacting generated artifacts in AI server logs and audits.

### 17.6 Worker process rules

Workers and subagents do not access the database. The main process resolves source metadata and passes an exact transient artifact. Workers send results back through typed runtime events, and the main process performs all persistence through Modules and Models.

## 18. Functional Requirements

### FR-1: Select generated images

- Users can add and remove generated-image references from the composer.
- Selection order is visible and preserved.
- Selection state is scoped to one conversation.
- Explicit selection overrides automatic inference.

### FR-2: Resolve generated-image references

- The main process resolves every reference from authoritative persisted metadata.
- Resolution requires current-user and active-conversation ownership.
- Invalid references fail before any provider call.
- IPC handlers do not access repositories directly.

### FR-3: Edit without a workspace

- One to three valid generated-image references can be edited with no workspace.
- The outgoing request contains real `data:image/...` content parts.
- No export or workspace attachment tool is required.

### FR-4: Preserve multi-reference editing

- Direct requests accept ordered arrays of up to three references.
- Independent multi-image edits and fusion prompts remain distinguishable by user instruction.
- Reference order remains available to the server.

### FR-5: Route large independent jobs to batch execution

- Four to fifty generated-image references use the batch coordinator for independent edits.
- The coordinator runs one isolated provider request per input.
- Concurrency is bounded from one to three.
- Result order matches input order.

### FR-6: Isolate parent context

- Source and output image bytes never enter parent message content or tool-result JSON.
- Per-worker transcripts are not copied into the parent conversation.
- The parent receives aggregate progress, mappings, compact errors, and durable descriptors.

### FR-7: Persist edited outputs

- Provider URLs and data URLs are persisted immediately through `AIChatGeneratedImageStorageService`.
- Assistant message metadata contains durable local descriptors.
- Provider-temporary references are not treated as durable conversation state.

### FR-8: Handle ambiguity

- Deterministic inference covers only obvious references.
- Ambiguous singular references produce a thumbnail selection prompt.
- Large plural selections receive confirmation before paid batch work unless the active approval policy explicitly permits it.

### FR-9: Preserve workspace workflows

- `attach_local_images` continues to require an approved workspace.
- Workspace-file `process_artifact_batch` continues to require an approved workspace.
- `export_generated_artifacts` continues to require an approved workspace destination.
- No existing filesystem guard is weakened.

### FR-10: Remove incorrect tool routing

- The capability prompt no longer tells the model to export a chat-generated image merely to edit it.
- Tool load policy no longer promotes export plus workspace attachment for this case.
- Export remains discoverable for explicit save, copy, or workspace materialization intent.

### FR-11: Enforce AI enablement

- Any new or modified AI IPC entry point checks `Token` and `USER_AI_ENABLED` before parsing request data or starting work.
- Disabled AI returns the standard `{ status: false, msg, data: null }` behavior where the IPC contract uses response envelopes.

### FR-12: Support cancellation and partial failure

- Direct and batch requests respect the active abort signal.
- Batch successes survive sibling failures.
- Retry-failed does not reprocess successful items by default.

### FR-13: Keep context bounded

- Historical image bytes are not resent automatically.
- Historical generated-image annotations contain no absolute local paths.
- Current direct requests include only selected or deterministically inferred references.

### FR-14: Present actionable errors

- Errors use stable codes and localized messages.
- Missing local files, stale references, oversized selection, invalid image data, unavailable edit model, and provider failure remain distinguishable.

## 19. Error Model

| Code | Meaning | User-facing action |
|---|---|---|
| `generated_image_reference_invalid` | Message or index is malformed or does not resolve | Select the image again |
| `generated_image_not_owned` | User or conversation ownership check failed | Do not reveal source details; ask the user to select an image in this conversation |
| `generated_image_missing` | Durable local file no longer exists | Regenerate the image or choose another reference |
| `generated_image_outside_store` | Protocol resolution escaped the trusted root | Reject and record a security diagnostic |
| `generated_image_symlink_rejected` | Source is a symlink or non-regular file | Choose another generated artifact |
| `generated_image_unsupported_type` | MIME or signature is unsupported | Choose PNG, JPEG, WebP, or another supported type |
| `generated_image_too_large` | Source or prepared payload exceeds limits | Allow normalization or choose fewer images |
| `generated_image_dimension_limit` | Decoded dimensions or pixels exceed limits | Resize or regenerate at a smaller size |
| `generated_image_reference_limit` | Direct request exceeds three combined images | Use batch processing for independent edits |
| `generated_image_ambiguous` | Several images could match a singular reference | Select the intended thumbnail |
| `image_edit_unavailable` | No image-to-image model is configured | Configure an edit-capable model |
| `image_edit_provider_failed` | Provider rejected or failed the operation | Retry or inspect provider configuration |
| `generated_image_batch_partial` | Some batch items failed | Keep successes and retry failed items |
| `generated_image_batch_cancelled` | User stopped the job | Keep completed outputs or resume remaining items |

Errors must not contain absolute source paths, base64, signed URLs, or other users' identifiers.

## 20. Observability

Allowed structured telemetry and logs:

- conversation-scoped hashed identifier where existing policy permits;
- reference count;
- source kind: `generated_image` or `workspace_file`;
- direct or batch route;
- independent or fusion intent classification;
- prepared MIME, dimensions, and byte count;
- batch requested, completed, failed, and cancelled counts;
- concurrency;
- duration;
- provider and model identifiers already permitted by server policy;
- stable error code;
- output image count.

Forbidden telemetry and logs:

- raw message metadata;
- absolute application storage paths;
- base64 or data URLs;
- provider signed URLs;
- image bytes;
- user email embedded in generated-image protocol URLs;
- full subagent transcripts.

## 21. Performance and Reliability Requirements

1. Selecting or deselecting an image must not read or encode its full bytes in the renderer.
2. Main-process resolution happens only when the request is accepted for sending.
3. Preparation work is abortable where the decoder and encoder permit cancellation.
4. Direct requests contain at most three combined image inputs.
5. Batch concurrency never exceeds three.
6. Batch item completion order does not change result order.
7. One item failure does not stop unrelated items.
8. Renderer state stores only thumbnails already available through the local protocol and opaque identifiers.
9. Long conversations do not repeatedly parse or attach every historical image.
10. Completed generated output is persisted before temporary provider URLs expire.

## 22. Accessibility and Internationalization

All new user-facing text must be translated in:

- English (`en.ts`)
- Chinese (`zh.ts`)
- Spanish (`es.ts`)
- French (`fr.ts`)
- German (`de.ts`)
- Japanese (`ja.ts`)

Accessibility requirements:

1. Generated-image selection controls have descriptive accessible names.
2. Selection order is not communicated by color alone.
3. The reference tray supports keyboard navigation, removal, and reordering.
4. Batch progress is exposed through an appropriate live region without announcing every low-level event.
5. Error messages identify the affected image by visible order or file name, not only by an internal ID.
6. Thumbnails retain useful alternative text derived from safe conversation context or a neutral generated-image label.

## 23. Test Requirements

### 23.1 Unit tests

Add or update tests for:

- generated reference shape normalization;
- duplicate removal with stable order;
- message, role, conversation, user, and image-index ownership checks;
- protocol URL parsing and traversal rejection;
- current-user root containment;
- symlink and non-regular-file rejection;
- MIME and signature validation;
- size, dimension, pixel, and combined-payload limits;
- merging uploaded and generated reference parts;
- no duplicate byte persistence for source references;
- direct versus batch routing;
- singular, plural, explicit-selection, and ambiguous inference;
- batch input ordering, concurrency, cancellation, and partial failure;
- parent tool result excludes bytes;
- generated output harvesting and persistence;
- removal of incorrect export/attach tool promotion.

### 23.2 Component tests

Because this feature changes renderer behavior, component tests are mandatory:

- generated image renders **Use as reference** and **Edit** actions;
- selecting an image adds it to the composer tray;
- selecting several images preserves order;
- removing and clearing references works;
- the fourth reference triggers the batch choice instead of silently disappearing;
- switching conversations cannot leak selected references;
- ambiguous inference displays candidate selection;
- batch progress and partial failure render correctly;
- all controls expose translated labels and accessible names.

Run:

```bash
yarn test:components
```

### 23.3 Main-process tests

Cover the IPC and query-engine boundary:

- AI enablement runs before request parsing;
- untrusted renderer paths are not accepted;
- references are resolved through Module/Model services;
- current-turn `image_url` parts contain only selected references;
- generated source bytes are absent from saved content and metadata;
- direct requests enforce the combined count limit;
- generated-image batch input does not require a workspace;
- workspace-file batch input still requires a workspace;
- workers receive exact approved artifacts and cannot substitute paths.

### 23.4 Server contract tests

Keep or extend server tests proving:

- request attachments become image-edit references;
- explicit "add ... to the image" intent activates editing when an attachment exists;
- multiple references preserve order;
- independent multi-image edits and fusion requests route correctly;
- streaming returns final image metadata;
- inbound image count and payload limits remain enforced;
- data URL values never appear in logs.

### 23.5 End-to-end tests

Critical Playwright scenarios:

1. Start a chat with no workspace, generate a lion image, say "add a dog into the image," and receive an edited image.
2. Generate two images, select both, request a fusion, and verify selected order reaches the request.
3. Generate several images, select one older image, and verify the latest unselected image is not sent.
4. Start a generated-image batch with no workspace, observe progress, and verify all successful outputs render.
5. Cancel a batch and verify completed outputs remain while queued items become cancelled.
6. Attempt a forged cross-conversation reference and verify rejection without path disclosure.
7. Confirm workspace image editing still prompts for or requires workspace approval.

Run the relevant suites with:

```bash
yarn testmain
yarn test:components
yarn test:e2e
```

## 24. Rollout and Migration

### Phase 1: Trusted direct references

1. Add reference types and IPC normalization.
2. Add authoritative reference resolution in the main process through Module/Model access.
3. Add direct one-to-three multimodal request construction.
4. Add generated-image selection UI and composer tray.
5. Remove generated-edit dependence on workspace export and attachment tools.
6. Ship regression tests for the original no-workspace failure.

### Phase 2: Deterministic natural-language inference

1. Add latest-single-image inference.
2. Add plural and numbered-reference inference for groups up to three.
3. Add ambiguous reference selection UI.
4. Measure inference corrections and keep the rule set conservative.

### Phase 3: Generated-image batch sources

1. Generalize the batch coordinator's source model while preserving its existing `files` contract.
2. Add generated-image reference authorization and transient worker input.
3. Add batch UX, cancellation, retry-failed, and partial success.
4. Confirm no workspace is required for generated-image sources.
5. Confirm workspace remains required for project-file sources.

### Phase 4: Context cleanup

1. Remove absolute local paths from generated-image model annotations.
2. Remove obsolete generated-edit tool promotion.
3. Compact or omit annotations that no longer support a user-visible workflow.
4. Verify old conversations with existing metadata remain renderable and editable.

### Backward compatibility

- Existing assistant `metadata.generatedImages` descriptors remain readable.
- Existing `aifetchly-generated-image://` URLs remain renderable.
- Existing workspace `files` batch requests remain valid.
- Existing user-upload attachment behavior remains valid.
- Old messages with generated-image annotations require no database migration; request assembly can stop emitting unsafe or obsolete fields.

## 25. Acceptance Criteria

### Core editing

1. A user can generate an image and edit it in a later message without selecting a workspace.
2. The original lion-plus-dog reproduction completes with an edited image and no `workspace_required` tool result.
3. The outgoing edit request contains an image data part derived from the selected generated artifact.
4. The desktop never sends `aifetchly-generated-image://` as a remote image input.

### Multi-image behavior

5. Users can explicitly select and order one to three generated references.
6. Direct multi-reference requests preserve order.
7. Independent and fusion instructions remain supported.
8. A fourth independent reference routes to batch behavior or an explicit batch choice.
9. Large batches retain ordered input-to-output mappings and partial successes.

### Context behavior

10. A conversation containing fifty generated images sends none of their bytes on an unrelated text turn.
11. A direct edit sends only the selected one to three source images.
12. A batch parent conversation stores no source or output base64.
13. Historical annotations contain no absolute generated-image paths after the new path is enabled.

### Security

14. Forged message IDs, image indexes, users, conversations, paths, and protocol URLs are rejected before provider work.
15. Symlink and traversal attempts are rejected.
16. Workspace guards remain unchanged for workspace files and exports.
17. Workers do not access the database directly.
18. Logs, persisted tool results, and crash payloads contain no image bytes or data URLs.

### Quality

19. All affected UI text exists in all six supported languages.
20. Component tests cover selection, ordering, limits, ambiguity, progress, and errors.
21. Main-process tests cover authorization, payload construction, routing, and isolation.
22. Server contract tests prove reference-image editing still works.
23. Existing workspace image and batch tests remain green.

## 26. Risks and Trade-offs

### 26.1 Automatic inference can select the wrong image

Conservative inference reduces friction for the common single-image case but cannot safely interpret every pronoun in a long image-heavy conversation. Explicit selection wins, and ambiguity produces a visual choice.

### 26.2 Main-process preparation adds CPU and memory work

Reading and normalizing images in the main process increases transient resource use. Strict count, pixel, byte, and concurrency limits bound this work. Heavy normalization may later move to an Electron utility process, but that process still must not access the database directly.

### 26.3 Subagents save parent context, not provider cost

Batch isolation keeps the parent transcript small, but every independent image still requires an image-model operation. The UI must communicate batch size and preserve approval controls.

### 26.4 Direct multi-image output cardinality varies

Attaching three images does not universally guarantee three outputs. Independent batch semantics require one request per input when exact one-to-one mapping matters.

### 26.5 Generalizing the existing batch coordinator increases contract complexity

A source union avoids duplicating scheduling, cancellation, and aggregation logic, but it requires clear mutual exclusivity and source-specific authorization. Tests must prove that generated-image authorization never becomes a path around workspace policy.

## 27. Alternatives Considered

### 27.1 Require every chat to choose a workspace

Rejected. Image generation and editing are valid chat-only workflows. A project directory should not be a prerequisite for modifying an application-owned conversation artifact.

### 27.2 Weaken `attach_local_images` to allow the Electron user-data directory

Rejected. That turns a workspace-scoped file-transfer tool into a broader local-file reader and weakens a valuable security boundary.

### 27.3 Automatically export generated images into a hidden workspace

Rejected. It obscures authorization, duplicates files, complicates cleanup, and still models an application artifact as a project file.

### 27.4 Send local protocol URLs directly to the server

Rejected. The remote server cannot resolve the desktop-only protocol, and accepting arbitrary remote fetch targets would create security and availability problems.

### 27.5 Attach every historical generated image on every turn

Rejected. It causes request growth, image-token cost, payload failures, ambiguity, and poor latency.

### 27.6 Route every edit through a subagent

Rejected. Subagents are useful for isolation and large batches, but they add latency and execution overhead to the common one-image conversational edit.

### 27.7 Add a new provider-specific desktop image API

Rejected. Provider routing, credentials, capability selection, fallbacks, cost tracking, and normalized responses belong in the AI server.

## 28. Proposed Implementation Surface

The exact names may change during technical design, but responsibility should remain in these areas:

| Area | Required change |
|---|---|
| `AiChatV2Message.vue` | Emit generated-image reference selection and edit actions |
| `AiChatV2Messages.vue` | Forward image reference events with message identity and image index |
| `AiChatV2Composer.vue` | Render ordered reference tray, limits, removal, and batch choice |
| `AiChatV2.vue` | Own conversation-scoped selection and include opaque references in send requests |
| `aiChatV2Types.ts` | Add reference, metadata, request, and batch source types |
| `ai-chat-v2-ipc.ts` | Check AI enablement first and normalize bounded reference shapes |
| `AIChatV2Module` plus Model layer | Retrieve authoritative message metadata by conversation and message identity |
| New generated-reference service | Authorize, resolve, validate, normalize, and transiently prepare generated images |
| `AIChatQueryEngine.ts` | Merge generated reference parts into only the current multimodal user turn |
| `AIChatGeneratedImageContextService.ts` | Remove local paths and retire edit routing through textual annotations |
| `BuiltInToolCapabilitiesPromptSection.ts` | Stop instructing export-before-edit for chat-generated images |
| `ToolLoadPolicyService.ts` | Stop promoting workspace export/attachment for generated-image edits |
| `processArtifactBatchTool.ts` | Add mutually exclusive generated-image sources while preserving workspace files |
| `AgentRuntime.ts` | Accept exact transient image artifacts for isolated batch workers without parent-context bytes |
| Language files | Add all new labels, prompts, progress, and errors in six languages |
| Vitest and Playwright suites | Add UI, main-process, security, routing, batch, and regression coverage |

## 29. Success Metrics

After rollout, measure:

- percentage of generated-image edit requests completed without a workspace;
- `workspace_required` errors following generated-image turns, target near zero;
- generated-image edit success rate;
- ambiguous-reference prompt rate and correction rate;
- direct versus batch routing distribution;
- batch completed, partial, failed, and cancelled rates;
- average and p95 direct edit latency;
- average and p95 batch item latency;
- average selected reference count;
- rejected oversized or invalid image count;
- parent chat context size before and after batch execution;
- provider usage per batch item;
- missing-local-generated-image rate.

Metrics must follow the redaction rules in this PRD.

## 30. Glossary

- **Application-managed generated image**: An image AiFetchly downloaded or decoded from an AI server response and stored beneath Electron user data.
- **Generated-image reference**: An opaque `(messageId, imageIndex)` pair used to identify an existing generated artifact without exposing its local path.
- **Direct edit**: One chat request containing text and one to three selected image inputs.
- **Independent edit**: The same modification applied separately to each source image, with input-to-output correspondence.
- **Fusion edit**: A request that combines several reference images into one composition or coordinated result.
- **Batch coordinator**: Desktop service that schedules bounded isolated operations and aggregates ordered results.
- **Subagent**: An isolated agent runtime used for one bounded item of batch work so intermediate context does not enter the parent conversation.
- **Transient image payload**: Prepared image bytes or data URL held only long enough to create one AI request and never persisted in ordinary chat data.
- **Workspace image**: A user project image located beneath an approved conversation workspace and governed by workspace file permissions.
- **Parent context**: The main chat model transcript, excluding isolated subagent transcripts and transient image bytes.
