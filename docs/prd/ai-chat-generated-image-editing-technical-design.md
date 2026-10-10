# AI Chat Generated-Image Editing Without a Workspace Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-24
- **Owner**: AiFetchly Desktop Engineering
- **Related PRD**: [`ai-chat-generated-image-editing-prd.md`](./ai-chat-generated-image-editing-prd.md)
- **Related desktop designs**:
  - [`ai-chat-llm-image-attachment-tool-technical-design.md`](./ai-chat-llm-image-attachment-tool-technical-design.md)
  - [`ai-chat-v2-attachment-upload-technical-design.md`](../ai-chat-v2-attachment-upload-technical-design.md)
- **Related server contract**: `/home/robertzeng/project/aifetchserver/docs/chat-image-generation-prd.md`
- **Primary runtime**: Electron renderer and main process, with the existing OpenAI-compatible AI server

## 1. Purpose

This document turns the generated-image editing PRD into an implementation plan. It defines the desktop contracts, trust boundary, request assembly, UI state, batch subagent handoff, context controls, error model, rollout order, and verification work needed to edit AiFetchly-generated images without an approved workspace.

The key rule is:

> A chat-generated image is an application-owned conversation artifact. It is not a workspace file.

The renderer sends an opaque reference consisting of a message ID and image index. The Electron main process resolves that reference from authoritative message metadata, verifies the user and conversation association, normalizes the file into a transient data URL, and places it only in the current model request. Workspace tools and their permission checks remain unchanged.

## 2. Current Failure and Root Cause

The current generated-image follow-up path is:

```text
assistant metadata.generatedImages
  -> AIChatGeneratedImageContextService appends protocol URL and local path
  -> model calls attach_local_images
  -> WorkspaceResolver finds no approved workspace
  -> workspace_required
  -> model calls export_generated_artifacts
  -> workspace_required
  -> no edit is produced
```

`attach_local_images` and `export_generated_artifacts` are behaving correctly. They operate on project files and intentionally require a workspace. Removing those checks would turn the generated-image directory into an arbitrary local-file escape path.

The missing feature is a first-class generated-image reference channel between the renderer and the main process.

## 3. Existing Capabilities to Reuse

### 3.1 Desktop

The desktop already provides:

- `AIChatGeneratedImageStorageService`, which saves returned artifacts beneath Electron user data and persists lightweight descriptors;
- `AIChatGeneratedImageProtocol`, which builds and resolves `aifetchly-generated-image://local/...` URLs;
- `AIImageSignature`, `AIImageNormalizer`, and `ElectronNativeImageCodec`, which validate and prepare local images;
- `AIChatQueryEngine.prepareAttachmentContent()`, which builds OpenAI-style multimodal content;
- `AIChatContextAssembler`, which replaces the current persisted user row with current-turn content parts;
- `process_artifact_batch`, which already supplies ordered bounded concurrency, partial success, cancellation, and isolated `agent-batch-worker` runs;
- `AgentRuntime` output harvesting and generated-image persistence;
- generated-image rendering in `AiChatV2Message.vue`.

### 3.2 AI server

The server already provides the required edit contract:

- `/v1/chat/completions` accepts `image_url` content parts;
- inbound images must be `data:image/...;base64,...` URLs;
- `chat_image_input.py` validates count, encoded size, decoded size, signature, dimensions, and pixel count;
- `edit_image_orchestrator.py` detects edit intent and invokes the internal `aifetch_edit_image` capability;
- one attachment or a fusion request produces one multi-reference edit call;
- several independent attachments produce one edit operation per attachment in request order;
- output count is bounded by `image_edit_max_outputs` and the response artifact cap;
- the server returns generated artifacts but does not durably store their bytes.

No new server endpoint is required for the first release. The desktop must send real data URLs instead of local protocol URLs.

## 4. Architecture Decisions

### TD-1: Add an opaque generated-image reference to the stream request

The renderer may identify an image but may not identify a path.

```typescript
export interface ChatV2GeneratedImageReference {
  readonly messageId: string;
  readonly imageIndex: number;
}

export interface ChatV2StreamRequest {
  // Existing fields omitted.
  generatedImageReferences?: ChatV2GeneratedImageReference[];
}
```

Reference order is meaningful. It is used for display numbering, fusion prompts, server attachment order, and batch result mapping.

### TD-2: Resolve references only in the Electron main process

The renderer is not authoritative for paths, ownership, MIME, dimensions, or stored metadata. `GeneratedImageReferenceService` will resolve all of these in the main process.

The service uses a Module to read message metadata. It does not use TypeORM directly. The IPC handler remains a validation and delegation layer.

### TD-3: Keep generated-image authorization separate from workspace authorization

Generated-image authorization requires all of:

1. current authenticated user;
2. active conversation;
3. an authoritative assistant message in that conversation;
4. a valid image index in `metadata.generatedImages`;
5. a sanctioned generated-image protocol URL;
6. a path beneath the current user's generated-image root;
7. a regular, non-symlink image that passes size and decode checks.

An approved workspace is not part of this decision. Workspace files continue through `WorkspaceResolver` and `FilePathGuard`.

### TD-4: Reuse a shared main-process image preparation pipeline

Generated originals can be larger than the outbound chat limits. The resolver must not directly base64-encode an arbitrary stored original.

Extract the reusable validation and normalization work currently used by `AIImageAttachmentToolService` into a shared service. Both workspace attachment and generated-reference resolution should use the same:

- MIME allowlist;
- signature validation;
- decode checks;
- dimension and pixel limits;
- 1568-pixel long-edge target;
- approximately 1.5 MiB prepared target;
- data-URL construction;
- stable safe error mapping.

The source authorization step remains different for each caller.

### TD-5: Attach bytes only to the current model turn

The prepared data URLs are stored only in `currentUserContentParts`. They are not written to:

- message content;
- message metadata;
- attachment database rows;
- tool arguments or results;
- hooks;
- logs;
- compact summaries;
- parent subagent results.

### TD-6: Direct requests handle at most three combined images

The direct count is:

```text
uploaded image count + generated reference count <= 3
```

Documents do not consume an image slot. Duplicate generated references are removed while retaining the first position.

One to three selected references use the normal chat path. Four to fifty independently edited references use the batch path. A request to fuse more than three images is rejected because batch isolation cannot preserve cross-image fusion semantics.

### TD-7: Generalize the batch coordinator with a discriminated source

`process_artifact_batch` will support exactly one source kind:

```typescript
type ArtifactBatchSource =
  | {
      readonly kind: "workspace_files";
      readonly files: readonly string[];
    }
  | {
      readonly kind: "generated_images";
      readonly references: readonly ChatV2GeneratedImageReference[];
    };
```

The existing workspace branch keeps its approval requirement. The generated-image branch uses the reference resolver and never creates a fake workspace.

### TD-8: Give each batch subagent one exact transient image

The coordinator authorizes the full reference set, then prepares one item only when a concurrency slot is ready. `AgentRuntime` receives an exact transient artifact, not a local path and not a database lookup capability.

This maintains three useful bounds:

- at most three provider operations execute at once;
- at most three source image payloads need to be live at once;
- the parent model receives no source image bytes or worker transcript.

### TD-9: Remove local paths from model history

`AIChatGeneratedImageContextService` must stop appending `local_path`. The recommended first release is a compact semantic marker:

```text
<generated_images>
  [1] message=assistant-123 image=0 file=image-1.png
</generated_images>
```

This marker helps natural-language reasoning but grants no access. Explicit selection and deterministic inference, not model tool discovery, perform the attachment.

### TD-10: Keep the first release backward compatible

No database migration is required. Existing assistant `metadata.generatedImages` rows remain valid. Existing uploaded attachments, workspace tools, and exported artifacts retain their current behavior.

## 5. Target Component Topology

```text
Renderer
  AiChatV2Message
    emits use-generated-image(messageId, imageIndex)
        |
  AiChatV2Messages
    forwards typed event
        |
  AiChatV2
    owns conversation-scoped ordered selection
    runs deterministic reference inference
        |
  AiChatV2Composer
    renders ordered reference tray
    emits references with send event
        |
        v
Electron IPC: ai-chat-v2-ipc.ts
  AI-enable gate first
  parse and normalize opaque references
  validate direct combined count
        |
        v
AIChatQueryEngine
  GeneratedImageReferenceService
    AIChatV2Module -> AIChatModule -> AIChatMessageModel
    AIChatGeneratedImageProtocol
    GeneratedImagePreparationService
        |
  merges text + uploaded image parts + generated image parts
        |
        v
AIChatContextAssembler
  history without historical image bytes
  current user turn with selected image parts only
        |
        v
AI server /v1/chat/completions
  chat image validation
  edit orchestration or visual analysis
        |
        v
AIChatGeneratedImageStorageService
  local durable output + metadata.generatedImages
```

## 6. Data Contracts

### 6.1 Renderer and IPC reference

Add to `src/entityTypes/aiChatV2Types.ts`:

```typescript
export interface ChatV2GeneratedImageReference {
  readonly messageId: string;
  readonly imageIndex: number;
}
```

Validation rules:

- `messageId` is trimmed, non-empty, and no longer than 200 characters;
- `imageIndex` is an integer from 0 through 49 at the shape boundary;
- direct requests contain no more than three unique references;
- batch requests contain 1 through 50 unique references;
- uniqueness key is `${messageId}:${imageIndex}`;
- first occurrence wins so order remains deterministic;
- extra properties have no authority and are discarded;
- a reference never accepts `url`, `localPath`, `conversationId`, or `userEmail` from the renderer.

### 6.2 Display metadata on the user message

Add to `ChatV2MessageMetadata`:

```typescript
export interface ChatV2GeneratedImageReferenceMetadata {
  readonly messageId: string;
  readonly imageIndex: number;
  readonly fileName?: string;
  readonly protocolUrl?: string;
}

export interface ChatV2MessageMetadata {
  // Existing fields omitted.
  generatedImageReferences?: readonly ChatV2GeneratedImageReferenceMetadata[];
}
```

The resolver returns the safe display metadata after authorization. The query engine persists that returned metadata, not renderer-provided labels. `protocolUrl` is optional and must use the local generated-image protocol. `local_path`, data URLs, base64, and provider URLs are forbidden.

### 6.3 Authorized source descriptor

Create `src/entityTypes/generatedImageReferenceTypes.ts`:

```typescript
export interface AuthorizedGeneratedImageSource {
  readonly reference: ChatV2GeneratedImageReference;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly protocolUrl: string;
  readonly fileName: string;
  readonly absolutePath: string;
}

export interface PreparedGeneratedImageArtifact {
  readonly reference: ChatV2GeneratedImageReference;
  readonly fileName: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly preparedSizeBytes: number;
  readonly dataUrl: string;
  readonly detail: "auto" | "low" | "high";
}
```

`absolutePath` is private main-process state. `dataUrl` is transient model-only state. Neither type crosses the renderer IPC response boundary.

### 6.4 Resolution result

```typescript
export interface ResolveGeneratedImagesInput {
  readonly conversationId: string;
  readonly references: readonly ChatV2GeneratedImageReference[];
  readonly detail: "auto" | "low" | "high";
  readonly signal?: AbortSignal;
}

export interface ResolveGeneratedImagesResult {
  readonly artifacts: readonly PreparedGeneratedImageArtifact[];
  readonly metadata: readonly ChatV2GeneratedImageReferenceMetadata[];
  readonly totalPreparedBytes: number;
  readonly totalDataUrlChars: number;
}
```

The result preserves requested order. Any invalid direct reference fails the entire direct request before a provider call. Batch authorization reports per-item failures so valid siblings can continue.

### 6.5 Batch input

Keep the public tool schema backward compatible:

```typescript
interface ProcessArtifactBatchInput {
  readonly files?: readonly string[];
  readonly generatedImageReferences?: readonly ChatV2GeneratedImageReference[];
  readonly instruction: string;
  readonly processor?: "image_edit";
  readonly concurrency?: 1 | 2 | 3;
  readonly detail?: "auto" | "low" | "high";
}
```

Runtime parsing converts this into a discriminated union. Exactly one of `files` and `generatedImageReferences` must be present. JSON Schema should use `oneOf` if supported by the tool schema consumer; runtime validation remains authoritative regardless.

### 6.6 Batch result

```typescript
export type ArtifactBatchInputIdentity =
  | { readonly kind: "workspace_file"; readonly path: string }
  | {
      readonly kind: "generated_image";
      readonly reference: ChatV2GeneratedImageReference;
    };

export interface ArtifactBatchItemResult {
  readonly input: ArtifactBatchInputIdentity;
  readonly status: "completed" | "failed" | "cancelled";
  readonly agentTaskId?: string;
  readonly outputImages: readonly ChatV2GeneratedImage[];
  readonly errorCode?: GeneratedImageReferenceErrorCode;
  readonly error?: string;
  readonly durationMs: number;
}
```

For compatibility, workspace results may retain `outputFilePaths`. Generated-image results must not return source paths. The flattened `outputImages` list remains available for existing artifact harvesting.

## 7. Model and Module Changes

### 7.1 Composite message lookup

Add a composite query to `AIChatMessageModel`:

```typescript
async getMessageByConversationAndMessageId(
  conversationId: string,
  messageId: string
): Promise<AIChatMessageEntity | null>
```

The SQL predicate must include both fields. Looking up by globally supplied `messageId` and checking the conversation only after retrieval is weaker and can reveal whether a guessed message exists.

Expose it through `AIChatModule`, then add a focused `AIChatV2Module.getGeneratedImageSourceMessage()` method that also requires:

- a `v2-` conversation ID;
- role `assistant`;
- `MessageType.MESSAGE`;
- metadata source compatible with Chat V2.

The Module returns the entity or `null`. It does not resolve filesystem paths or prepare bytes.

### 7.2 Database migration

No schema change is needed. Both generated output descriptors and selected source descriptors live in the existing JSON metadata column.

## 8. GeneratedImageReferenceService

Create `src/service/GeneratedImageReferenceService.ts`.

### 8.1 Dependencies

```typescript
export interface GeneratedImageReferenceServiceDeps {
  readonly getSourceMessage: (
    conversationId: string,
    messageId: string
  ) => Promise<AIChatMessageEntity | null>;
  readonly getCurrentUserEmail: () => string;
  readonly getUserDataPath: () => string;
  readonly realpath: typeof import("node:fs/promises").realpath;
  readonly openForRead: (absolutePath: string) => Promise<OpenedReadFile>;
  readonly prepareImage: (
    source: Buffer,
    detectedMimeType: SupportedImageMimeType,
    detail: ImageDetail,
    signal?: AbortSignal
  ) => Promise<PreparedModelImage>;
}
```

Dependencies are injectable so authorization, traversal, symlink, malformed metadata, and cancellation tests do not require Electron or a live database.

### 8.2 Resolution algorithm

For each unique reference, in order:

1. Abort if the signal is cancelled.
2. Query by `(conversationId, messageId)` through `AIChatV2Module`.
3. Require an assistant message row with `MessageType.MESSAGE`.
4. Parse `metadata` as unknown JSON and require a non-empty `generatedImages` array.
5. Require `imageIndex` to exist.
6. Read only the descriptor URL and safe name fields.
7. Require `aifetchly-generated-image://local/`.
8. Parse exactly four decoded URL segments: normalized user, sanitized conversation, sanitized message, file name.
9. Compare the user segment with `normalizeGeneratedImageUserEmail(currentUserEmail)`.
10. Compare the conversation and message segments with the same path-part sanitizer used by storage.
11. Resolve the candidate beneath `getGeneratedImageUserRoot()`.
12. Verify lexical containment.
13. Resolve the parent directory and file using `realpath()` and verify containment beneath the real current-user root.
14. Open the resolved path through the same pinned-file-descriptor abstraction used by `AIImageAttachmentToolService`.
15. Use `fstat()` from that descriptor and require a regular file. Reject symlink anomalies, directories, and special files.
16. Enforce the source-specific raw byte limit, then read from the same descriptor. This prevents a path swap between validation and read from changing the bytes being processed.
17. Detect the image signature from the pinned bytes and require it to agree with the expected supported format.
18. Prepare the image through the shared normalizer.
19. Accumulate prepared bytes and data-URL characters.
20. Enforce combined direct limits.
21. Return safe metadata plus transient artifacts.

### 8.3 Shared path sanitizer

`AIChatGeneratedImageStorageService` currently owns a private `sanitizePathPart()`. Move the logic into `AIChatGeneratedImageProtocol.ts` as:

```typescript
export function sanitizeGeneratedImagePathPart(value: string): string;
```

Storage, URL construction checks, and reference resolution must call the same function. This avoids authorization failures caused by subtly different normalization rules.

### 8.4 Protocol hardening

Keep the existing renderer protocol resolver for display, but add a stricter generated-reference function:

```typescript
export interface GeneratedImageProtocolIdentity {
  readonly normalizedUser: string;
  readonly conversationPathPart: string;
  readonly messagePathPart: string;
  readonly fileName: string;
  readonly candidatePath: string;
}

export function parseGeneratedImageProtocolIdentity(
  requestUrl: string,
  userDataPath: string
): GeneratedImageProtocolIdentity | null;
```

The parser must catch malformed percent encoding. It must reject encoded separators, empty segments, dot segments, query parameters, fragments, and unexpected hosts or schemes.

### 8.5 File and image validation

The shared preparation service enforces the current desktop and server-compatible limits:

| Limit                           |         Initial value | Enforcement point                       |
| ------------------------------- | --------------------: | --------------------------------------- |
| Direct combined image count     |                     3 | IPC and query engine                    |
| Stored generated source maximum |                20 MiB | Existing storage policy                 |
| Workspace source maximum        |                 5 MiB | Existing workspace attachment policy    |
| Generated source maximum        |                20 MiB | Existing generated-image storage policy |
| Prepared long edge              |               1568 px | Normalizer                              |
| Prepared target                 | approximately 1.5 MiB | Normalizer                              |
| Combined data-URL characters    |             6,000,000 | Resolver and query engine               |
| Allowed inbound formats         |  PNG, JPEG, WebP, GIF | Signature and decoder                   |
| Outbound formats                |           PNG or JPEG | Normalizer                              |

The shared preparation service accepts a source-specific raw limit. Workspace files keep the current 5 MiB ceiling. Application-generated sources may use the existing 20 MiB storage ceiling because they are immediately normalized to the approximately 1.5 MiB outbound target before transport. Dimension and pixel limits still apply before expensive work. The main-process limits should be exported from one runtime-neutral configuration module and aligned with `CHAT_IMAGE_LIMITS`. The server remains the final validation boundary.

## 9. IPC Changes

Update `src/main-process/communication/ai-chat-v2-ipc.ts`.

### 9.1 AI enable gate

`handleStream()` already calls `canUseChat()` before parsing the request. Preserve this ordering. Any new batch IPC entry point must use the same first operation.

### 9.2 Shape normalization

Add:

```typescript
function normalizeGeneratedImageReferences(
  input: unknown,
  maxItems: number
): ChatV2GeneratedImageReference[];
```

Unlike uploaded-file normalization, malformed supplied references must produce a typed validation error instead of silently disappearing. Silent dropping could edit fewer images than the user selected.

### 9.3 Request validation

`validateStreamRequest()` should treat generated references as valid current-turn input, but image editing still needs a usable instruction. Recommended behavior:

- text or uploaded files or generated references can make the composer sendable;
- when references are sent with blank text, the renderer supplies a localized-neutral model instruction such as `Describe the selected image.` rather than making the main process invent user intent;
- combined uploaded image and generated reference count may not exceed three;
- a direct request with more than three references returns `generated_image_reference_limit` before `AIChatQueryEngine.submitMessage()`.

### 9.4 Error transport

Current streaming errors carry a user-facing string. Extend the stream error event with an optional stable `errorCode` while preserving the string for older renderers.

```typescript
interface ChatV2ErrorEvent {
  readonly eventType: "error";
  readonly conversationId: string;
  readonly errorMessage: string;
  readonly errorCode?: GeneratedImageReferenceErrorCode;
}
```

## 10. Query Engine Changes

### 10.1 Dependency injection

Add `GeneratedImageReferenceService` to `AIChatQueryEngineDeps` and its factory. Tests should inject a fake resolver.

### 10.2 Preparation order

Inside `submitMessage()` after the final conversation ID is known:

1. stage uploaded documents;
2. prepare uploaded attachment display metadata and image parts;
3. resolve generated-image references against the final conversation ID;
4. enforce combined count and combined payload size;
5. expand pasted text and `@` mentions into the text part;
6. persist the user message with safe attachment and reference metadata;
7. assemble history with only current-turn image parts;
8. call the existing query loop.

Resolution must happen before saving a normal user turn. A rejected reference should not leave a misleading persisted message saying an edit was requested when no provider call could start.

### 10.3 Content merge

Refactor attachment preparation so image parts are explicitly merged:

```typescript
const imageParts = [
  ...uploadedImageParts,
  ...generatedReferenceArtifacts.map((artifact) => ({
    type: "image_url" as const,
    image_url: { url: artifact.dataUrl, detail: artifact.detail },
  })),
];

const currentUserContentParts =
  imageParts.length > 0
    ? [{ type: "text" as const, text: modelUserMessage }, ...imageParts]
    : undefined;
```

Order is uploaded images first, followed by generated references in selected order. If product wants a single combined ordering across both source kinds later, replace this with an ordered composer attachment union. The first release only promises ordering among generated references.

### 10.4 Persistence

Persist:

- ordinary user display text;
- existing uploaded attachment metadata;
- authorized generated reference metadata;
- mention and pasted-block metadata.

Do not call `AIChatAttachmentModule` for generated sources. That would duplicate existing bytes and would store the normalized transport copy.

### 10.5 Cleanup

After the request is built, allow prepared buffers and strings to leave scope. Do not retain resolver results in long-lived engine maps. Cancellation should clear pending references along with other active turn state.

## 11. Context Assembly and Context-Window Control

### 11.1 History rule

Historical assistant rows contain text and compact descriptors only. They never contain image bytes. Historical user rows show selected reference metadata in the renderer but their data URLs are not reconstructed into later model requests.

### 11.2 Current-turn replacement

`AIChatContextAssembler` already excludes the current persisted user row and appends `currentUserContentParts`. Preserve this behavior. It guarantees each selected image appears once in the outgoing transcript.

### 11.3 Generated-image annotation

Change `AIChatGeneratedImageContextService`:

- remove `local_path` from its public parsed type;
- do not emit protocol URLs as actionable tool inputs;
- include only message ID, zero-based image index, and optional file name;
- cap descriptors per message;
- keep the function idempotent;
- allow the marker to be disabled after inference coverage is proven.

The context cost then grows with short descriptors, not image bytes or long absolute paths. Normal compaction can summarize old text as it does today.

### 11.4 Why many chat images do not overflow context

An image in history is only metadata. A selected image is included only in the current direct request. Therefore a chat may contain many generated images without resending them all.

Subagents further isolate large independent jobs:

```text
Parent request: instruction + references + aggregate status
Child request 1: instruction + image 1
Child request 2: instruction + image 2
Child request 3: instruction + image 3
...
```

This saves parent context. It does not save image input processing or provider cost because every child request still sends one image.

## 12. Renderer Design

### 12.1 Message image actions

`AiChatV2Message.vue` currently renders each generated image as an open link or button. Evolve the computed image model to retain `imageIndex`, then add:

- **Use as reference** toggle;
- **Edit** action, which replaces current selection with this image and focuses the composer;
- existing **Open** action;
- **Save to workspace**, which remains workspace-dependent.

Emit only:

```typescript
(event: "use-generated-image", reference: ChatV2GeneratedImageReference): void
(event: "edit-generated-image", reference: ChatV2GeneratedImageReference): void
```

`message.messageId` and the generated-image array position create the reference. Do not emit `localPath`.

### 12.2 Event forwarding

`AiChatV2Messages.vue` forwards both events to `AiChatV2.vue`. This component remains stateless about selection.

### 12.3 Conversation-scoped draft state

`AiChatV2.vue` owns:

```typescript
interface GeneratedImageDraftState {
  readonly references: ChatV2GeneratedImageReference[];
}

const generatedImageDrafts = new Map<string, GeneratedImageDraftState>();
```

For a new conversation, use an internal draft key that is replaced when the real `v2-` ID arrives. On conversation switch, save the active selection and restore only the target conversation's selection. Clearing or deleting a conversation clears its draft references.

### 12.4 Composer reference tray

Add props to `AiChatV2Composer.vue`:

```typescript
selectedGeneratedImages: readonly GeneratedImageReferenceView[];
generatedImageReferenceLimit: number;
```

Add events:

```typescript
(event: "remove-generated-image", reference: ChatV2GeneratedImageReference): void
(event: "clear-generated-images"): void
(event: "reorder-generated-images", references: ChatV2GeneratedImageReference[]): void
```

The tray renders numbered thumbnails. The send button considers text, uploaded files, pasted content, and generated references. Successful send clears the references through the existing `onAccepted` callback. Failed preflight validation keeps them selected.

### 12.5 Ambiguity and automatic inference

Create a pure renderer utility, `generatedImageReferenceInference.ts`. It receives the current text, message history, and explicit selection, and returns:

```typescript
type GeneratedImageInferenceResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "resolved";
      readonly references: readonly ChatV2GeneratedImageReference[];
    }
  | {
      readonly kind: "ambiguous";
      readonly candidates: readonly GeneratedImageReferenceView[];
    }
  | {
      readonly kind: "batch_confirmation";
      readonly references: readonly ChatV2GeneratedImageReference[];
    };
```

Rules are deterministic:

1. Explicit selection wins.
2. Singular edit wording resolves only when the latest relevant generation group has exactly one image.
3. Numbered wording resolves valid display indices in order.
4. `both`, `all`, and translated equivalents resolve only a clearly bounded latest group.
5. Singular wording with several candidates returns `ambiguous`.
6. More than three independent targets returns `batch_confirmation`.

Phrase tables must cover all six supported languages. The main process still authorizes every inferred reference.

### 12.6 Multi-image semantics

Do not replace the array contract with a single `selectedImage`. That would lose fusion and independent edit support.

- One selected image: direct edit or analysis.
- Two or three selected images: direct independent edit or fusion according to instruction.
- Four to fifty selected images: batch only when each input can be processed independently.
- More than three images for fusion: show an unsupported-limit error and preserve selection.

## 13. Batch Subagent Design

### 13.1 Scheduling core

Refactor `ArtifactBatchProcessingService` into source-specific authorization plus a shared scheduler:

```text
parse arguments
  -> workspace source: resolve workspace once
  -> generated source: authorize descriptors once
  -> create ordered result array
  -> launch min(concurrency, item count) runners
  -> each runner prepares one item just in time
  -> run one isolated agent
  -> persist returned output through existing AgentRuntime path
  -> release source artifact
  -> fill the original result index
```

The scheduler retains existing status aggregation and cancellation behavior.

### 13.2 Agent runtime input

Add a typed, runtime-only field:

```typescript
export interface AgentInitialImageArtifact {
  readonly sourceId: string;
  readonly fileName: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly dataUrl: string;
  readonly detail: ImageDetail;
}

export interface AgentRunInput {
  // Existing fields omitted.
  readonly initialImageArtifacts?: readonly AgentInitialImageArtifact[];
}
```

Constraints:

- accepted only from in-process trusted coordinator calls;
- never accepted from JSON tool arguments or renderer IPC;
- `agent-batch-worker` accepts exactly one initial image artifact;
- not serialized into `AgentTask` persistence;
- not copied into `AgentResult`;
- not exposed to hooks;
- consumed when constructing the worker's first multimodal user message.

### 13.3 Agent definition

The batch worker prompt becomes source-neutral:

```text
Process exactly one supplied image according to the instruction.
Use the image already attached to the initial task message.
Do not search for another file and do not request a workspace.
Return the produced generated-image artifact and a compact status only.
```

For workspace batches, the existing `attach_local_images` tool path can remain during migration. A later cleanup may also prepare workspace sources before the agent starts, but that is not required for this feature.

### 13.4 Permission behavior

Workspace batch:

- permission category remains `filesystem`;
- preview lists exact project paths;
- approved workspace remains mandatory.

Generated-image batch:

- no filesystem workspace permission is requested;
- user confirmation is still required for a paid batch unless current approval mode permits it;
- preview shows safe labels and count, never application paths;
- destination remains the configured AI server.

If the current permission framework cannot represent a non-filesystem paid operation cleanly, add a dedicated `ai_media_batch` category instead of marking generated images as workspace files.

### 13.5 Memory and cleanup

Authorize metadata for the full set first, but prepare data URLs just in time inside each runner. Set large local variables to leave scope after `runSync()` completes. Concurrency three prevents a fifty-image batch from holding fifty normalized payloads in memory.

### 13.6 Output persistence

`AgentRuntime` already stores returned `outputImages` through its generated-image storage dependency. Keep that path. The parent result contains the durable protocol descriptors returned after storage, not provider data URLs.

### 13.7 Progress and retry

Emit one evolving tool-progress record with:

- `expectedCount`;
- `partialCount`;
- queued, running, completed, failed, and cancelled counts;
- current phase;
- safe per-item IDs.

Retry constructs a new batch from failed and cancelled reference identities only. It must not resubmit successful items by default.

## 14. Prompt and Tool-Routing Changes

Update `BuiltInToolCapabilitiesPromptSection.ts`, `skillsRegistry.ts`, `ToolLoadPolicyService.ts`, `runSubagentTool.ts`, and `AgentDefinitionRegistry.ts` so they distinguish:

- chat-generated images already selected by the desktop;
- workspace images that require `attach_local_images`;
- explicit export of generated images to a workspace;
- large independent generated-image batches.

Remove instructions that say a generated image must be exported and then attached merely to edit it. Retain export guidance only for user requests such as save, copy, materialize, or add to project.

The main model does not need a new direct-edit tool. The selected generated images are already present in its current multimodal user turn, and the server owns edit orchestration.

## 15. Server Contract and Compatibility

### 15.1 Outgoing request

The desktop sends:

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Add a dog beside the lion." },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,<transient>",
            "detail": "auto"
          }
        }
      ]
    }
  ]
}
```

No `aifetchly-generated-image://` URL reaches the server.

### 15.2 Effective limits

The public chat boundary is three images even though the deeper generation schema permits up to ten references. Desktop routing must use the lower effective limit.

`image_edit_max_outputs` controls returned independent edits, not accepted reference count. Do not conflate these settings.

### 15.3 First-release server changes

No functional server change is required if current integration tests confirm:

- one attached image plus explicit edit intent produces an edit;
- two or three attachments preserve order;
- independent wording edits attachments separately;
- fusion wording makes one multi-reference call;
- streaming returns image artifacts to the desktop;
- invalid and excessive inputs return stable errors without logging data URLs.

If a mismatch is found, fix it in the existing orchestrator and boundary validator rather than adding a desktop provider call.

## 16. Error Model

Create a stable union:

```typescript
export type GeneratedImageReferenceErrorCode =
  | "generated_image_reference_invalid"
  | "generated_image_not_owned"
  | "generated_image_missing"
  | "generated_image_outside_store"
  | "generated_image_symlink_rejected"
  | "generated_image_unsupported_type"
  | "generated_image_too_large"
  | "generated_image_dimension_limit"
  | "generated_image_reference_limit"
  | "generated_image_ambiguous"
  | "generated_image_fusion_limit"
  | "generated_image_batch_partial"
  | "generated_image_batch_cancelled";
```

Error messages must not reveal another user's identity, whether a guessed message exists, or an absolute path.

| Code                                | Main-process behavior                         | Renderer behavior                        |
| ----------------------------------- | --------------------------------------------- | ---------------------------------------- |
| `generated_image_reference_invalid` | Reject malformed or missing metadata          | Keep tray and ask user to select again   |
| `generated_image_not_owned`         | Return generic denial and security diagnostic | Do not expose source details             |
| `generated_image_missing`           | No provider call                              | Offer regenerate or choose another image |
| `generated_image_outside_store`     | Reject and log code only                      | Generic unavailable message              |
| `generated_image_symlink_rejected`  | Reject before read                            | Generic unavailable message              |
| `generated_image_unsupported_type`  | Reject before provider call                   | Ask for supported image                  |
| `generated_image_too_large`         | Normalize if possible, otherwise reject       | Suggest fewer or smaller images          |
| `generated_image_dimension_limit`   | Reject unsafe decode                          | Suggest regenerate smaller               |
| `generated_image_reference_limit`   | Reject direct request                         | Offer independent batch                  |
| `generated_image_ambiguous`         | No provider call                              | Show candidate selector                  |
| `generated_image_fusion_limit`      | No batch fallback                             | Ask user to reduce to three              |

Add translations for every new label and error in `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts` when implementation begins.

## 17. Security and Privacy

### 17.1 Threats and controls

| Threat                                      | Control                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Renderer supplies arbitrary path            | Contract accepts only message ID and image index                                           |
| Guessed message ID accesses another chat    | Composite conversation and message query                                                   |
| Protocol URL belongs to another user        | Compare normalized current-user segment                                                    |
| Traversal through encoded URL               | Strict segment parser plus lexical and realpath containment                                |
| Symlink or path swap escapes generated root | Realpath containment plus a pinned file descriptor, `fstat`, and read from that descriptor |
| Renamed non-image file                      | Byte signature plus decoder validation                                                     |
| Image decompression abuse                   | Dimension and pixel ceilings before full normalization                                     |
| Payload leaks through logs                  | Log counts, codes, sizes, and correlation IDs only                                         |
| Payload persists in chat or tools           | Separate transient artifact types and metadata-only results                                |
| Worker reads database                       | Main process resolves metadata before runtime invocation                                   |
| Batch causes memory spike                   | Just-in-time preparation and concurrency maximum three                                     |
| Server-side remote fetch abuse              | Send inline data URLs only; server rejects remote references                               |

### 17.2 Logging policy

Allowed fields:

- conversation correlation hash or existing safe ID policy;
- reference count;
- message count;
- image index;
- MIME;
- width and height;
- prepared byte count;
- duration;
- stable error code;
- batch counts and concurrency.

Forbidden fields:

- absolute paths;
- protocol URLs when they reveal identity segments;
- provider signed URLs;
- data URLs;
- base64;
- raw metadata JSON;
- image bytes.

### 17.3 Child and utility process rule

No worker code may instantiate `AIChatMessageModel`, `AIChatModule`, or TypeORM repositories. The main process performs all database reads and output persistence. The worker receives an exact transient artifact and returns typed result events.

## 18. Performance and Resource Budget

### 18.1 Direct turn

- Resolve no more than three message references.
- Read and normalize no more than three images.
- Enforce the combined data-URL budget before starting the server request.
- Do not cache data URLs across turns.
- Reuse the normal context estimate for text; image billing is provider-specific and should be displayed separately when available.

### 18.2 Batch

- Maximum 50 items.
- Default and maximum concurrency 3.
- One independent provider request per item.
- Ordered result array preallocated to input count.
- Completed output persists before the worker slot is reused.
- Cancellation stops queued work immediately and aborts active requests where supported.

### 18.3 Context impact

Parent context remains approximately proportional to text plus compact descriptors. Child context is proportional to one instruction and one image. Moving work to subagents prevents parent context exhaustion, but total provider usage grows linearly with batch size.

## 19. Detailed Sequences

### 19.1 Edit the only latest image

```text
User types "add a dog into the image"
  -> inference finds one image in latest generation group
  -> renderer submits {messageId, imageIndex: 0}
  -> IPC validates shape and count
  -> query engine resolves the final conversation
  -> reference service authorizes metadata and file
  -> normalizer creates transient data URL
  -> query engine assembles text + image part
  -> server edits image
  -> desktop stores returned image
  -> assistant metadata contains durable generated image
  -> renderer displays edited output
```

No workspace resolver or workspace tool runs.

### 19.2 Ambiguous singular reference

```text
Latest generation group contains three images
User types "make the image brighter"
  -> inference returns ambiguous with three candidates
  -> renderer shows candidate thumbnails
  -> no IPC request and no provider cost
  -> user selects one
  -> normal direct sequence runs
```

### 19.3 Three-image fusion

```text
User selects images 1, 2, 3 in order
User asks to combine them
  -> renderer sends ordered array
  -> resolver preserves order
  -> query engine sends three ordered image parts
  -> server fusion classifier selects one multi-reference edit call
  -> one composed result is stored and rendered
```

### 19.4 Twenty-image independent edit

```text
User confirms 20 selected references + shared instruction
  -> coordinator authorizes descriptors
  -> three runners prepare references 1, 2, 3
  -> three isolated subagents send one image each
  -> each output is stored and mapped to its source
  -> next queued item starts when a slot frees
  -> parent sees one progress surface
  -> final parent result contains counts, mappings, errors, durable descriptors
```

## 20. Testing Strategy

### 20.1 Unit tests

Add:

- `test/vitest/main/service/GeneratedImageReferenceService.test.ts`

  - valid current-user reference;
  - message absent;
  - wrong conversation;
  - non-assistant message;
  - malformed metadata;
  - missing index;
  - wrong protocol, host, user, conversation, or message segment;
  - malformed percent encoding;
  - traversal and encoded separator;
  - symlink and non-regular file;
  - realpath escape;
  - invalid signature;
  - oversize, dimensions, pixel count, and cancellation;
  - order and duplicate behavior;
  - no data URL in thrown errors.

- `test/vitest/main/service/generatedImageReferenceInference.test.ts`
  - explicit selection wins;
  - singular one-image inference;
  - ambiguous singular case;
  - numbered order;
  - plural bounded selection;
  - six-language phrase coverage;
  - direct versus batch result;
  - fusion over three rejected.

Extend:

- `AIChatGeneratedImageContextService.test.ts` to prove local paths are absent;
- `AIChatGeneratedImageProtocol` tests for identity parsing and containment;
- `AIChatQueryEngine.test.ts` for content merge, persistence, no duplication, and pre-provider failure;
- `ai-chat-v2-ipc.test.ts` for AI gate ordering, malformed references, deduplication, and combined count;
- `processArtifactBatchTool.test.ts` for mutually exclusive sources, no-workspace generated branch, concurrency, order, partial success, cancellation, and no byte leakage;
- `AgentRuntime` tests for exactly one transient initial image and no persistence of its data URL;
- `AIChatContextAssembler.test.ts` for current-turn-only image parts.

### 20.2 Component tests

Add or extend tests in `test/vitest/main/components/`:

- `AiChatV2Message.generatedImages.test.ts` for Use as reference, Edit, Open, disabled states, and opaque emitted values;
- `AiChatV2Messages.generatedImages.test.ts` for event forwarding;
- `AiChatV2Composer.generatedImageReferences.test.ts` for tray display, order, removal, clearing, send enablement, and limit state;
- `AiChatV2.generatedImageEditing.test.ts` for conversation-scoped selection, send payload, inference, ambiguity, batch confirmation, and selection retention on error.

All six translation files are part of the UI change. Run `yarn test:components` as the required UI gate.

### 20.3 Server integration tests

In `aifetchserver`, verify existing tests or add coverage for:

- one-image edit via chat completions;
- two independent edits;
- two-image fusion;
- ordered attachments;
- maximum three images;
- invalid data URL and signature;
- streamed image artifacts;
- data URL redaction in logs and audit metadata.

### 20.4 End-to-end scenarios

Add a Playwright Electron scenario for:

1. start a conversation with no workspace;
2. generate a lion image;
3. select or infer the generated image;
4. request `add a dog beside the lion`;
5. assert no `workspace_required` tool card occurs;
6. assert a new durable generated image renders;
7. reload history and open the result;
8. select multiple images and verify ordering;
9. verify ambiguity prompts rather than guessing;
10. verify switching conversations does not leak draft selections.

## 21. Observability

Add counters and timings through the existing logging or metrics abstraction:

- `generated_image_reference.resolve.started`;
- `generated_image_reference.resolve.completed`;
- `generated_image_reference.resolve.failed` by safe code;
- `generated_image_reference.prepare.duration_ms`;
- `generated_image_reference.prepared_bytes` histogram;
- `generated_image_edit.direct.count`;
- `generated_image_edit.batch.requested`;
- `generated_image_edit.batch.completed`;
- `generated_image_edit.batch.partial`;
- `generated_image_edit.batch.cancelled`;
- occurrences of `workspace_required` immediately after a generated-image turn.

The rollout target is near-zero `workspace_required` failures for generated-image edits while workspace-file denials remain unchanged.

## 22. Implementation Plan

### Phase 1: Contracts and secure resolver

1. Add reference, metadata, error, and transient artifact types.
2. Add composite Model and Module lookup.
3. Export the shared path sanitizer and strict protocol identity parser.
4. Extract shared image preparation from the workspace attachment service.
5. Implement `GeneratedImageReferenceService` and unit tests.

Exit condition: an authorized generated image becomes a bounded transient artifact with no renderer path input and no workspace.

### Phase 2: Direct request integration

1. Extend stream request validation and normalization.
2. Inject the resolver into `AIChatQueryEngine`.
3. Merge uploaded and generated image parts under one limit.
4. Persist safe reference metadata only.
5. Remove local paths from generated-image history annotations.
6. Update prompt and tool-routing guidance.
7. Add IPC, engine, context, and regression tests.

Exit condition: the lion-plus-dog reproduction succeeds without any workspace tool call.

### Phase 3: Renderer selection and inference

1. Add generated-image actions and typed events.
2. Add conversation-scoped ordered draft state.
3. Add the composer tray and reordering.
4. Add deterministic inference and ambiguity selection.
5. Add all translations and component tests.
6. Add the critical Playwright flow.

Exit condition: users can explicitly select old or multiple images and ambiguous language never silently chooses among several candidates.

### Phase 4: Generated-image batch subagents

1. Generalize batch source parsing.
2. Add generated-image batch permission preview.
3. Add trusted `initialImageArtifacts` to `AgentRuntime`.
4. Prepare one image just in time per runner.
5. Preserve ordered mappings, partial results, cancellation, and retry-failed.
6. Add progress UI and tests.

Exit condition: 4 through 50 independent edits run with concurrency at most three and no source bytes in parent context or tool results.

### Phase 5: Rollout and cleanup

1. Ship direct editing before batch editing.
2. Monitor resolver failures and unexpected workspace tool calls.
3. Enable inference after explicit selection proves stable.
4. Enable generated-image batch after cost confirmation UX is verified.
5. Remove obsolete generated-image export-to-attach prompt text.

## 23. Proposed File Changes

### New desktop files

```text
src/entityTypes/generatedImageReferenceTypes.ts
src/service/GeneratedImageReferenceService.ts
src/service/GeneratedImagePreparationService.ts
src/views/components/aiChatV2/generatedImageReferenceInference.ts
test/vitest/main/service/GeneratedImageReferenceService.test.ts
test/vitest/main/service/generatedImageReferenceInference.test.ts
test/vitest/main/components/AiChatV2Message.generatedImages.test.ts
test/vitest/main/components/AiChatV2Composer.generatedImageReferences.test.ts
test/vitest/main/components/AiChatV2.generatedImageEditing.test.ts
```

### Modified desktop files

```text
src/entityTypes/aiChatV2Types.ts
src/entityTypes/agentTypes.ts
src/model/AIChatMessage.model.ts
src/modules/AIChatModule.ts
src/modules/AIChatV2Module.ts
src/main-process/communication/ai-chat-v2-ipc.ts
src/service/AIChatQueryEngine.ts
src/service/AIChatQueryEngineFactory.ts
src/service/AIChatGeneratedImageProtocol.ts
src/service/AIChatGeneratedImageStorageService.ts
src/service/AIChatGeneratedImageContextService.ts
src/service/AIImageAttachmentToolService.ts
src/service/AgentRuntime.ts
src/service/AgentDefinitionRegistry.ts
src/service/BuiltInToolCapabilitiesPromptSection.ts
src/service/ToolLoadPolicyService.ts
src/service/agentTools/processArtifactBatchTool.ts
src/service/agentTools/runSubagentTool.ts
src/config/skillsRegistry.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Messages.vue
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/components/aiChatV2/AiChatV2Composer.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Server source changes are conditional on integration-test findings, not assumed.

## 24. Backward Compatibility and Rollback

- Existing `metadata.generatedImages` descriptors remain readable.
- No database migration or backfill is needed.
- Old conversations can select images as long as the local protocol file still exists.
- Provider-only URLs that failed local persistence are not eligible for later local editing; the UI should mark them unavailable or require regeneration.
- Uploaded files retain their existing request and persistence path.
- Workspace image tools retain current permissions.
- Batch workspace arguments remain accepted.

Use separate runtime feature switches for:

- direct generated-image references;
- deterministic inference;
- generated-image batch processing.

Rollback disables the new routing and UI without deleting stored images or metadata. Do not restore the known-broken automatic export-to-attach path as a fallback for users without a workspace.

## 25. Definition of Done

The implementation is complete when:

1. A user with no workspace can generate a lion and edit it to add a dog.
2. The request uses an authorized transient image part and produces no workspace tool call.
3. The renderer never sends an absolute generated-image path.
4. One to three selected images preserve order and support independent or fusion intent.
5. Ambiguous singular references require user selection.
6. Four to fifty independent edits use bounded isolated subagents.
7. Parent chat context and tool results contain no image bytes or worker transcripts.
8. Historical generated-image annotations contain no absolute paths.
9. Workspace image tools remain workspace-bound.
10. Security, module, IPC, component, and end-to-end tests pass.
11. All new user-visible strings exist in all six supported language files.
12. Server integration tests confirm the existing direct edit contract.

## 26. Final Engineering Position

Do not fix this by weakening workspace approval and do not solve ambiguity by reducing the feature to one selected image. Implement an ordered opaque-reference channel owned by the desktop main process.

Direct requests are the right path for one to three related images. Bounded subagents are the right path for many independent edits because they isolate image payloads and transcripts from the parent conversation. They protect context size, not provider cost. This separation keeps the user experience simple while preserving the security boundary between application-owned chat artifacts and user-owned workspace files.
