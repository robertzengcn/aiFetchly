# AI Chat Generated-Image Editing Without a Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit chat-generated images in follow-up turns with no approved workspace, via an opaque `(messageId, imageIndex)` reference channel resolved and authorized entirely in the Electron main process.

**Architecture:** Renderer emits typed `use-generated-image` / `edit-generated-image` events; conversation-scoped selection rides the existing stream request as `generatedImageReferences`. The main process resolves references from authoritative assistant-message metadata (`metadata.generatedImages`), verifies user/conversation/path ownership, prepares a transient data URL through a shared image pipeline, and injects it only into the current model turn. 4–50 independent edits reuse the batch coordinator with a discriminated source union and just-in-time preparation feeding trusted `initialImageArtifacts` to an isolated worker agent.

**Tech Stack:** TypeScript 5.x, Electron (main + renderer), Vue 3 + Vuetify + Pinia, TypeORM/better-sqlite3, Vitest (+ @vue/test-utils), existing `AIImageNormalizer`/`AIImageSignature`/fd-pinned read pipeline.

**Specs:** `docs/prd/ai-chat-generated-image-editing-prd.md`, `docs/prd/ai-chat-generated-image-editing-technical-design.md`

## Global Constraints

- NEVER use `any`; explicit return types on all functions; `unknown` in catch blocks.
- Database access ONLY via Model → Module layers; IPC handlers never touch repositories; workers never touch the database.
- Every new/modified AI IPC entry point gates on AI enable FIRST (`canUseChat()` in `src/main-process/communication/ai-chat-v2-ipc.ts:279`).
- Auto-commit after each completed task: conventional commits (`feat:`, `fix:`, `test:`, `refactor:`), stage only intended files.
- UI changes ship with component tests in the same commit; `yarn test:components` is a hard gate.
- All user-facing strings translated in ALL six files: `src/views/lang/{en,zh,es,fr,de,ja}.ts` under section key `aiChatV2.generatedImageRefs.*`.
- Direct combined image limit = uploaded images + generated references ≤ 3. Batch = 1–50 unique references, concurrency ≤ 3.
- Limits come from `src/config/chatImageLimits.ts` (`CHAT_IMAGE_LIMITS`: maxImagesPerRequest 3, targetPreparedImageBytes ~1.5 MiB, maxLongEdge 1568, targetTotalDataUrlChars 6_000_000, MAX_INPUT_DIMENSION 16_384, MAX_INPUT_PIXELS 64_000_000). Add `maxGeneratedSourceBytes: 20 * 1024 * 1024` there (aligns `AIChatGeneratedImageStorageService` 20 MiB policy).
- Forbidden everywhere (logs, persistence, tool results, renderer): absolute paths of generated sources, base64/data URLs, provider signed URLs, raw metadata JSON, image bytes. Logs carry counts/codes/sizes/durations only.
- No protocol URL (`aifetchly-generated-image://`) ever reaches the AI server; outbound parts are `data:image/png|jpeg;base64,...`.
- Workspace tools (`attach_local_images`, `export_generated_artifacts`, workspace `process_artifact_batch`) keep current behavior and permission checks unchanged.
- No DB migration. Existing `metadata.generatedImages` rows stay valid.
- Test commands: `yarn testmain` (vitest main), `yarn test:components` (component gate), `yarn vue-check` for Vue types, `npx tsc --noEmit -p tsconfig.json` where applicable.

## Verified Codebase Anchors (implementers: trust these, verify by reading before editing)

| Symbol | Location |
|---|---|
| `CHAT_IMAGE_LIMITS`, `MAX_INPUT_DIMENSION`, `MAX_INPUT_PIXELS` | `src/config/chatImageLimits.ts:13-38` |
| Protocol constants, `buildGeneratedImageProtocolUrl`, `resolveGeneratedImageProtocolPath` | `src/service/AIChatGeneratedImageProtocol.ts:3-77` |
| Private `sanitizePathPart` (to be moved) | `src/service/AIChatGeneratedImageStorageService.ts:171-173` |
| `AIChatGeneratedImageStorageService.storeImages`, 20 MiB cap | `src/service/AIChatGeneratedImageStorageService.ts:42-115, L15` |
| `<generated_images>` annotation incl. `local_path` | `src/service/AIChatGeneratedImageContextService.ts:26-109` |
| fd-pinned `openForRead`, normalizer port, signature pipeline, error mapping | `src/service/AIImageAttachmentToolService.ts:75-100, 227-364, 576-593`; default deps factory `createDefaultAIImageAttachmentToolDeps` L632-658 |
| `detectImageSignature` | `src/service/AIImageSignature.ts:40-42` |
| `AIImageNormalizer`, `NormalizedImage`, `NormalizeOptions` | `src/service/AIImageNormalizer.ts:53-101` |
| Engine deps `AIChatQueryEngineDeps`, `submitMessage` flow, `prepareAttachmentContent` | `src/service/AIChatQueryEngine.ts:248-275, 598-1056, 369-451`; currentUserContentParts built L669-695; persist L755-766 |
| Error chunk emission `{type:"error",conversationId,messageId?,errorMessage}` | `src/service/AIChatQueryEngine.ts:1650-1656, 1872-1888`; IPC adapter `createEventSink` error mapping `src/main-process/communication/ai-chat-v2-ipc.ts:529-536` |
| `canUseChat()` gate first in handleStream | `src/main-process/communication/ai-chat-v2-ipc.ts:279-285, 759-804` |
| `validateStreamRequest` | same file L546-633; upload normalization L682-756 |
| `AIChatMessageModel.getMessageByMessageId` (composite query goes next to it) | `src/model/AIChatMessage.model.ts:56` |
| `AIChatModule.getMessageByMessageId` | `src/modules/AIChatModule.ts:103` |
| `AIChatV2Module` (BaseModule pattern, v2- helpers) | `src/modules/AIChatV2Module.ts` |
| Entity fields (`messageId`,`conversationId`,`role`,`metadata` JSON,`messageType`) | `src/entity/AIChatMessage.entity.ts` |
| Context assembler current-turn replacement | `src/service/AIChatContextAssembler.ts:47-49, 338-349` |
| Batch tool parseArgs/execute/scheduler/aggregation/deps | `src/service/agentTools/processArtifactBatchTool.ts:69-127, 238-257, 259-333, 334-367, 54-67`; schema L371-435 |
| AgentRuntime `runSync`, prompt build, image persistence | `src/service/AgentRuntime.ts:127-166, 526-551`; `AgentPromptBuilder.build` `src/service/AgentPromptBuilder.ts:21-71` |
| Batch worker definition + prompt | `src/service/AgentDefinitionRegistry.ts:52-90, 124-145` |
| Generated-image export-to-edit prompt row to remove | `src/service/BuiltInToolCapabilitiesPromptSection.ts:50` |
| Promotion rule routing generated-edit followups to export/attach | `src/service/ToolLoadPolicyService.ts:372-381` (regex L198-199) |
| Message renderable generated images + open button | `src/views/components/aiChatV2/AiChatV2Message.vue:144-177, 320, 367-388, 486-493`; emits L331-343 |
| Messages forwarding emits | `src/views/components/aiChatV2/AiChatV2Messages.vue:96-104, 21-27` |
| Chat root state/send | `src/views/components/aiChatV2/AiChatV2.vue:957-959, 2825-2847, 3417-3426, 3705-3719` |
| Composer props/emits/send-enable/onAccepted | `src/views/components/aiChatV2/AiChatV2Composer.vue:292-359, 223-233, 1001-1019` |
| Frontend stream API | `src/views/api/aiChatV2.ts:170-175` |
| Lang section | `src/views/lang/en.ts:2315` (`aiChatV2`) |
| Tool-result image harvest | `src/service/toolResultImageHarvest.ts:15-47` |

---

# Phase 1 — Contracts and Secure Resolver

### Task 1: Types, shared path sanitizer, strict protocol identity parser

**Files:**
- Create: `src/entityTypes/generatedImageReferenceTypes.ts`
- Modify: `src/entityTypes/aiChatV2Types.ts`
- Modify: `src/config/chatImageLimits.ts` (add `maxGeneratedSourceBytes`)
- Modify: `src/service/AIChatGeneratedImageProtocol.ts` (add exports)
- Modify: `src/service/AIChatGeneratedImageStorageService.ts:171-173` (delegate to shared sanitizer)
- Test: `test/vitest/main/service/AIChatGeneratedImageProtocol.test.ts`

**Interfaces (produces; later tasks consume exactly these):**

```typescript
// aiChatV2Types.ts additions
export interface ChatV2GeneratedImageReference {
  readonly messageId: string;
  readonly imageIndex: number;
}
export interface ChatV2GeneratedImageReferenceMetadata {
  readonly messageId: string;
  readonly imageIndex: number;
  readonly fileName?: string;
  readonly protocolUrl?: string;
}
// ChatV2StreamRequest gains: readonly generatedImageReferences?: ChatV2GeneratedImageReference[];
// ChatV2MessageMetadata gains: readonly generatedImageReferences?: readonly ChatV2GeneratedImageReferenceMetadata[];
// ChatV2StreamChunk gains: readonly errorCode?: string;

// generatedImageReferenceTypes.ts
export type GeneratedImageReferenceErrorCode =
  | "generated_image_reference_invalid" | "generated_image_not_owned" | "generated_image_missing"
  | "generated_image_outside_store" | "generated_image_symlink_rejected" | "generated_image_unsupported_type"
  | "generated_image_too_large" | "generated_image_dimension_limit" | "generated_image_reference_limit"
  | "generated_image_ambiguous" | "generated_image_fusion_limit"
  | "generated_image_batch_partial" | "generated_image_batch_cancelled";

export class GeneratedImageReferenceError extends Error {
  constructor(readonly code: GeneratedImageReferenceErrorCode, message?: string) { super(message ?? code); this.name = "GeneratedImageReferenceError"; }
}

import type { ChatV2GeneratedImageReference } from "@/entityTypes/aiChatV2Types";
import type { ImageDetail } from "@/entityTypes/aiImageAttachmentToolTypes";

export interface AuthorizedGeneratedImageSource {
  readonly reference: ChatV2GeneratedImageReference;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly protocolUrl: string;
  readonly fileName: string;
  readonly absolutePath: string; // main-process private
}
export interface PreparedGeneratedImageArtifact {
  readonly reference: ChatV2GeneratedImageReference;
  readonly fileName: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly preparedSizeBytes: number;
  readonly dataUrl: string; // transient model-only
  readonly detail: "auto" | "low" | "high";
}
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
export interface GeneratedImageProtocolIdentity {
  readonly normalizedUser: string;
  readonly conversationPathPart: string;
  readonly messagePathPart: string;
  readonly fileName: string;
  readonly candidatePath: string;
}

// AIChatGeneratedImageProtocol.ts new exports
export function sanitizeGeneratedImagePathPart(value: string): string;   // moved logic verbatim: replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,160) || "unknown"
export function parseGeneratedImageProtocolIdentity(requestUrl: string, userDataPath: string): GeneratedImageProtocolIdentity | null;
```

- [ ] **Step 1: Write failing tests** in `test/vitest/main/service/AIChatGeneratedImageProtocol.test.ts` (pure functions, no mocks):
  - `sanitizeGeneratedImagePathPart("a/b\\c") === "a_b_c"`; empty → `"unknown"`; >160 chars truncated; unicode replaced.
  - Storage service uses shared function: construct `new AIChatGeneratedImageStorageService(fetchStub, "/tmp/u", "u@x.com")` pattern from existing `AIChatGeneratedImageStorageService.test.ts` and assert produced dir names still sanitize identically (regression).
  - `parseGeneratedImageProtocolIdentity`: valid URL built via `buildGeneratedImageProtocolUrl({userEmail:"U@X.com", conversationId:"v2-abc", messageId:"assistant-1", fileName:"image-1.png"})` with userDataPath `/tmp/u` returns `{ normalizedUser:"u@x.com", conversationPathPart:"v2-abc", messagePathPart:"assistant-1", fileName:"image-1.png", candidatePath: path.resolve(getGeneratedImageUserRoot("/tmp/u","u@x.com"),"v2-abc","assistant-1","image-1.png") }`.
  - Rejects: wrong scheme (`https://local/...`), wrong host (`aifetchly-generated-image://remote/...`), 3 or 5 segments, empty segment, `%2F`/`%5C` encoded separator (decoded value contains `/` or `\`), dot segments (`.`/`..` anywhere), query (`?x=1`) or fragment (`#f`), malformed percent (`%ZZ`, lone `%`), segment failing `sanitizeGeneratedImagePathPart` round-trip comparison for conversation/message/file.
- [ ] **Step 2:** Run `yarn vitest run test/vitest/main/service/AIChatGeneratedImageProtocol.test.ts` → FAIL (exports missing).
- [ ] **Step 3:** Implement. Strict parser algorithm (do NOT use `new URL()` — it normalizes percent encoding and dots): 
  1. Require prefix `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}://${AI_CHAT_GENERATED_IMAGE_HOST}/`; reject if URL contains `?` or `#`.
  2. Split remainder on `/`; require exactly 4 raw segments, none empty.
  3. Per segment: `decodeURIComponent` inside try/catch (catch → null); reject decoded containing `/`, `\`, NUL; reject `.` or `..`.
  4. Segment[0] must equal `normalizeGeneratedImageUserEmail(decoded)`; segments[1],[2],[3] must each equal `sanitizeGeneratedImagePathPart(decoded)` (round-trip equality kills traversal tricks).
  5. `candidatePath = path.resolve(getGeneratedImageUserRoot(userDataPath, normalizedUser), conversationPathPart, messagePathPart, fileName)`. Return identity or null.
- [ ] **Step 4:** Re-run test → PASS. Run storage-service regression test too.
- [ ] **Step 5:** Commit: `feat: add generated-image reference types, shared path sanitizer, strict protocol identity parser`

### Task 2: Composite message lookup (Model → Module)

**Files:**
- Modify: `src/model/AIChatMessage.model.ts` (after `getMessageByMessageId` L56)
- Modify: `src/modules/AIChatModule.ts` (after L103)
- Modify: `src/modules/AIChatV2Module.ts`
- Test: `test/vitest/main/model/AIChatMessage.model.test.ts`

**Interfaces:**
```typescript
// Model
async getMessageByConversationAndMessageId(conversationId: string, messageId: string): Promise<AIChatMessageEntity | null>
// SQL predicate includes BOTH fields in the WHERE clause (no post-fetch check).
// Module passthrough on AIChatModule with same signature.
// AIChatV2Module
async getGeneratedImageSourceMessage(conversationId: string, messageId: string): Promise<AIChatMessageEntity | null>
```
`getGeneratedImageSourceMessage` requires: conversationId starts with `v2-`, entity.role === "assistant", entity.messageType === MessageType.MESSAGE, metadata parses as object with `source === "chat-v2"` (cast via unknown record check). Returns entity or null; never touches filesystem.

- [ ] **Step 1: Failing test** `test/vitest/main/model/AIChatMessage.model.test.ts`: instantiate `new AIChatMessageModel()` (BaseDb falls back to temp test db when no path passed — verified pattern in `src/model/Basedb.ts`); save two messages sharing `messageId: "m-1"` in conversations `c-a` and `c-b` via `repository.save` or model.saveMessage; assert composite returns the `c-b` row for ("c-b","m-1"), null for ("c-zz","m-1"), null for ("c-a","other").
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement all three methods. Module method wraps model call after `await this.ensureConnection()`.
- [ ] **Step 4:** Run test → PASS. Also run existing `yarn vitest run test/vitest/main/modules` if such suite exists (search first).
- [ ] **Step 5:** Commit: `feat: add composite conversation+message lookup and V2 generated-image source message accessor`

### Task 3: Shared image preparation service

**Files:**
- Create: `src/service/GeneratedImagePreparationService.ts`
- Test: `test/vitest/main/service/GeneratedImagePreparationService.test.ts`

**Interfaces:**
```typescript
import type { ImageNormalizerPort, OpenedReadFile } from "@/service/AIImageAttachmentToolService";
import type { SupportedImageMimeType } from "@/entityTypes/aiImageAttachmentToolTypes";

export interface PreparedModelImage {
  readonly mimeType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly preparedSizeBytes: number;
  readonly dataUrl: string;
}
export interface GeneratedImagePreparationDeps {
  readonly normalizer: ImageNormalizerPort;
}
export class GeneratedImagePreparationService {
  constructor(deps?: GeneratedImagePreparationDeps); // default: new AIImageNormalizer(new ElectronNativeImageCodec())
  prepare(source: Buffer, detectedMimeType: SupportedImageMimeType, detail: "auto"|"low"|"high", signal?: AbortSignal): Promise<PreparedModelImage>;
  static errorCodeForNormalizationError(err: unknown): GeneratedImageReferenceErrorCode; // maps ImageNormalizationError.code:
  // unsupported/format → generated_image_unsupported_type; dimensions/pixels → generated_image_dimension_limit;
  // payload/too_large → generated_image_too_large; cancelled → cancelled (rethrow AbortError); else generated_image_unsupported_type
}
```
`prepare` builds `NormalizeOptions` purely from `CHAT_IMAGE_LIMITS` (`targetPreparedImageBytes`, `maxLongEdge`, `initialJpegQuality`, `minJpegQuality`, `minLongEdge`, `maxEncodingAttempts`, `signal`) and delegates to `normalizer.normalize(source, detectedMimeType, opts)`. It performs NO file IO and NO authorization — callers pin/read bytes themselves. Dimension/pixel ceilings are enforced upstream by the caller against `MAX_INPUT_DIMENSION`/`MAX_INPUT_PIXELS` using decoded metadata from the signature step where available, otherwise surfaced as normalization errors mapped by `errorCodeForNormalizationError`.

- [ ] **Step 1: Failing test**: fake `ImageNormalizerPort` returning canned `NormalizedImage`; assert options passed through match CHAT_IMAGE_LIMITS values, result shape mapped correctly, signal forwarded; `errorCodeForNormalizationError` table-driven over codes incl. non-Error input.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat: add shared generated-image preparation service over existing normalizer pipeline`

### Task 4: GeneratedImageReferenceService (secure resolver)

**Files:**
- Create: `src/service/GeneratedImageReferenceService.ts`
- Test: `test/vitest/main/service/GeneratedImageReferenceService.test.ts`

**Interfaces (consumes Tasks 1–3; produces for Task 6/17):**
```typescript
export interface GeneratedImageReferenceServiceDeps {
  readonly getSourceMessage: (conversationId: string, messageId: string) => Promise<AIChatMessageEntity | null>;
  readonly getCurrentUserEmail: () => string;
  readonly getUserDataPath: () => string;
  readonly realpath: typeof import("node:fs/promises").realpath;
  readonly openForRead: (absolutePath: string) => Promise<OpenedReadFile>;
  readonly prepareImage: (source: Buffer, detectedMimeType: SupportedImageMimeType, detail: "auto"|"low"|"high", signal?: AbortSignal) => Promise<PreparedModelImage>;
}
export class GeneratedImageReferenceService {
  constructor(deps?: Partial<GeneratedImageReferenceServiceDeps>); // defaults wire AIChatV2Module, Token email, app.getPath("userData"),
                                                                   // fs.promises.realpath, createDefaultAIImageAttachmentToolDeps(...).openForRead,
                                                                   // new GeneratedImagePreparationService().prepare
  resolveGeneratedImages(input: ResolveGeneratedImagesInput): Promise<ResolveGeneratedImagesResult>;
  authorizeOnly(input: { conversationId: string; references: readonly ChatV2GeneratedImageReference[] }): Promise<readonly AuthorizedGeneratedImageSource[]>; // batch fast-path (Task 17)
}
```

Resolution algorithm per unique reference, in order (dedupe key `${messageId}:${imageIndex}`, first wins):
1. If `signal?.aborted` → throw `GeneratedImageReferenceError("generated_image_reference_invalid","cancelled")` wrapped as abort (rethrow original AbortError if present).
2. `getSourceMessage(conversationId, messageId)`; null → `generated_image_missing`.
3. Entity role !== "assistant" or messageType !== MESSAGE → `generated_image_not_owned` (do not reveal existence details beyond generic denial semantics used here).
4. Parse `entity.metadata` (string) via `JSON.parse` guarded; find `generatedImages` array entry at `imageIndex`; absent/malformed/index out of range → `generated_image_reference_invalid`.
5. Read only `descriptor.url` and `descriptor.file_name`; url must start `aifetchly-generated-image://local/` else `generated_image_reference_invalid`.
6. `parseGeneratedImageProtocolIdentity(url, getUserDataPath())` null → `generated_image_reference_invalid` (covers percent/traversal/dot-segment).
7. `identity.normalizedUser !== normalizeGeneratedImageUserEmail(getCurrentUserEmail())` OR `identity.conversationPathPart !== sanitizeGeneratedImagePathPart(conversationId)` OR `identity.messagePathPart !== sanitizeGeneratedImagePathPart(messageId)` → `generated_image_not_owned`.
8. Lexical containment: `const rel = path.relative(userRoot, candidate)`; rel starts ".." or absolute → `generated_image_outside_store` (log code only).
9. Realpath both parent-dir-resolved candidate and `getGeneratedImageUserRoot(userData,email)` (root realpath failure → `generated_image_missing`); re-verify containment → else `generated_image_outside_store`.
10. `openForRead(realResolved)`; `opened.stats` must be regular file (reject symlink via `stats.isSymbolicLink()` pre-check on lstat of real path AND nlink/anomaly, directory, other) → `generated_image_symlink_rejected`.
11. Raw size ≤ `CHAT_IMAGE_LIMITS.maxGeneratedSourceBytes` (20 MiB) else `generated_image_too_large`; `buffer = await opened.read()` then `opened.close()` in finally (read from pinned fd only).
12. `detectImageSignature(buffer)`; null → `generated_image_unsupported_type`; signature mimeType must be in allowed set; expected-vs-detected mismatch vs extension-derived expectation → `generated_image_signature_mismatch` maps to `generated_image_unsupported_type`.
13. `prepareImage(buffer, detected, detail, signal)`; map errors via `GeneratedImagePreparationService.errorCodeForNormalizationError`.
14. Accumulate artifact + safe metadata `{ messageId, imageIndex, fileName: descriptor.file_name ?? identity.fileName, protocolUrl: url }`; totals.
15. After loop enforce `totalDataUrlChars <= CHAT_IMAGE_LIMITS.targetTotalDataUrlChars` else throw `generated_image_too_large` (combined). Caller enforces count ≤ 3.
Never include `absolutePath`, `dataUrl`, or paths in any thrown Error message; messages contain codes/indices only.

- [ ] **Step 1: Write failing tests** covering every case listed in design §20.1 (valid current-user ref end-to-end with temp-dir fixture: create real tiny PNG bytes (1×1 PNG constant buffer) under temp userRoot layout, fake deps: getSourceMessage returns entity whose metadata JSON contains descriptor with real protocol URL built by `buildGeneratedImageProtocolUrl`, realpath = fs.realpath, openForRead = fd-pinned impl copied pattern from `createDefaultAIImageAttachmentToolDeps`, prepareImage = fake returning fixed PreparedModelImage): valid; message absent; wrong conversation (getSourceMessage scoped so composite lookup misses); non-assistant role; malformed metadata JSON; index out of range; wrong protocol scheme/host; wrong user segment; wrong conversation/message segment; encoded separator `%2F` URL; symlinked file (real temp symlink); directory instead of file; realpath escape (fake realpath returning path outside root); invalid signature (random bytes named .png); oversize (fake stats.size > 20MiB); cancellation (pre-aborted controller); duplicate refs collapse preserving order; error messages never contain temp paths or data URLs (assert on all thrown).
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement per algorithm above.
- [ ] **Step 4:** Run full file → PASS.
- [ ] **Step 5:** Commit: `feat: implement secure generated-image reference resolver with injectable deps`

---

# Phase 2 — Direct Request Integration

### Task 5: IPC validation, normalization, count limits, error transport

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts`
- Test: extend `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`

**Interfaces:**
```typescript
export function normalizeGeneratedImageReferences(input: unknown, maxItems: number): { ok: true; references: ChatV2GeneratedImageReference[] } | { ok: false; reason: string };
```
Rules: input must be undefined (→ ok, []) or array; each item object with `messageId` trimmed string 1..200 chars, `imageIndex` integer 0..49; dedupe `${messageId}:${imageIndex}` first-wins; length > maxItems → not-ok (`generated_image_reference_limit` when maxItems===3 and overflow, else shape error); ANY malformed item → typed not-ok (never silent-drop). Extra properties ignored. Never accept `url`/`localPath`/`conversationId`/`userEmail`.

handleStream changes (AFTER existing `canUseChat()` gate, keeping order):
1. Normalize `req.generatedImageReferences` (maxItems = `CHAT_IMAGE_LIMITS.maxImagesPerRequest`); failure → terminal error chunk `{ eventType:"error", conversationId:"", errorMessage: <safe msg>, errorCode }`.
2. Count combined images: `uploadedImageCount + references.length > 3` → terminal error chunk errorCode `generated_image_reference_limit`.
3. Attach normalized array onto the processed request sent to engine.
`validateStreamRequest()`: treat presence of references as valid even with blank text (engine supplies neutral instruction downstream — Task 6 keeps existing "message required unless files" rule extended to `|| references.length > 0`).
Error transport: extend adapter error payload (L529-536) and engine-side error chunks with optional `errorCode` passthrough (renderer-safe string).

- [ ] **Step 1: Extend ipc tests** (follow existing hoisted-mock harness): gate still runs before parsing (assert resolver untouched when disabled); malformed ref item yields single error chunk with errorCode; dedupe preserves order (send dupes, spy engine receives deduped); 2 uploads + 2 refs rejected with `generated_image_reference_limit`; valid payload forwards references.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `yarn vitest run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts` → PASS.
- [ ] **Step 5:** Commit: `feat: validate opaque generated-image references at the chat v2 IPC boundary`

### Task 6: Query engine integration

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts`, `src/service/AIChatQueryEngineFactory.ts`
- Test: extend `test/vitest/main/service/AIChatQueryEngine.test.ts`

**Changes:**
1. `AIChatQueryEngineDeps` gains `generatedImageReferenceResolver?: Pick<GeneratedImageReferenceService,"resolveGeneratedImages">`; factory passes a default instance.
2. In `submitMessage()` AFTER final conversation ID known and BEFORE persisting the user message (insert between upload staging block ending L~696 and save at L755): if `request.generatedImageReferences?.length`:
   - `detail = "auto"`;
   - call resolver; catch `GeneratedImageReferenceError` → emit terminal error chunk `{type:"error", conversationId, errorMessage:<localized-neutral English string per code>, errorCode: err.code}` and return BEFORE any user-message persistence (design §10.2);
   - enforce `uploadedImageCount + artifacts.length <= CHAT_IMAGE_LIMITS.maxImagesPerRequest` → else emit error chunk `generated_image_reference_limit`, return;
   - enforce `totalDataUrlChars <= targetTotalDataUrlChars` → else `generated_image_too_large`;
   - merge content parts exactly per design §10.3: uploaded image parts first, then generated artifact parts `{ type:"image_url", image_url:{ url: artifact.dataUrl, detail: artifact.detail } }`; text part first overall; blank text ⇒ `modelUserMessage = "Describe the selected image."` fallback instruction;
   - persist user message with metadata gaining `generatedImageReferences: <resolver metadata>` (merge into existing metadata construction; do NOT route through attachment module; no dataUrl/local_path persisted).
3. Cancellation cleanup: clear staged reference artifacts in the existing active-turn teardown path.

- [ ] **Step 1: Extend engine tests** (existing harness mocks modules + fake loop + fake contextAssembler): inject fake resolver; assert (a) resolution happens before saveUserMessage (order spy), (b) assembler receives currentUserContentParts = [text, ...uploaded, ...generated] with dataUrls only in memory, (c) saved metadata contains reference display metadata and NO base64 substring, (d) resolver rejection emits errorCode chunk and skips persistence, (e) combined-count violation rejects without loop invocation, (f) blank text gets neutral instruction.
- [ ] **Step 2:** Run → FAIL. 
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run engine suite → PASS.
- [ ] **Step 5:** Commit: `feat: resolve generated-image references into current-turn multimodal content in query engine`

### Task 7: Remove local paths from history annotations

**Files:**
- Modify: `src/service/AIChatGeneratedImageContextService.ts`
- Test: extend `test/vitest/main/service/AIChatGeneratedImageContextService.test.ts`

**Changes:** `GeneratedImageContextImage` drops `local_path` (keep parsing tolerant — ignore unknown fields). `buildGeneratedImagesAnnotation` emits compact semantic marker per design TD-9:
```
<generated_images>
  [1] message=assistant-123 image=0 file=image-1.png
</generated_images>
```
(one line per image; index is 1-based display; omit file when absent; cap descriptors per message at 10). Keep idempotency via marker check. No callers change signature-wise (`AIChatContextAssembler.ts:338-342` unaffected).

- [ ] **Step 1:** Extend tests: annotation output contains no `local_path`, no absolute path substrings, no `aifetchly-generated-image://` URLs; includes message/image/file triplets; idempotent double-augment; cap enforced; parse ignores legacy local_path rows without crash.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS + grep guard: `grep -rn "local_path" src/service/AIChatGeneratedImageContextService.ts` → no matches.
- [ ] **Step 5:** Commit: `refactor: replace local-path generated-image annotations with compact semantic markers`

### Task 8: Prompt and tool-routing corrections

**Files:**
- Modify: `src/service/BuiltInToolCapabilitiesPromptSection.ts:49-50`
- Modify: `src/service/ToolLoadPolicyService.ts:372-381`
- Modify: `src/config/skillsRegistry.ts` (attach_local_images description L160-174: remove "for image EDITING use directly" phrasing that implies generated-image editing; scope wording to workspace images)
- Test: `test/vitest/main/service/generatedImagePromptRouting.test.ts`

**Changes:**
1. Replace capability-table row L50 with: editing/analyzing a chat-generated image needs NO tool and NO workspace — the image arrives attached to the current turn when the user selects it; instruct the model to answer/edit directly; retain export row only for explicit save-to-project intent (`export_generated_artifacts`).
2. Delete/adjust promotion rule L372-381 so generated-image edit followups no longer force-promote `export_generated_artifacts`/`attach_local_images`; keep `hasBatchImageEditIntent` behavior for workspace files intact; keep regexes but stop gating on `hasRecentGeneratedImages` for promotion.
3. skillsRegistry attach_local_images description: prepend "Workspace files only." clarifier; drop generated-image mention.
- [ ] **Step 1:** Failing test asserting prompt text no longer contains `export_generated_artifacts` adjacent to generated-image-edit guidance and DOES contain direct-attachment sentence; ToolLoadPolicy unit: message with recent generated images + "make it brighter" does NOT promote attach/export tools (returns baseline), while workspace-file phrasing still promotes attach_local_images.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Run related suites: `yarn vitest run test/vitest/main/service` (spot regressions in ToolLoadPolicy tests; update stale expectations to NEW correct behavior, don't delete).
- [ ] **Step 4:** Commit: `fix: stop routing generated-image edits through export+workspace attach tools`

---

# Phase 3 — Renderer Selection and Inference

### Task 9: Message-level actions (Use as reference / Edit)

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2Message.vue`
- Modify: six lang files (keys below)
- Test: `test/vitest/main/components/AiChatV2Message.generatedImages.test.ts`

**Component contract:**
```typescript
// RenderableGeneratedImage gains: readonly imageIndex: number; readonly messageId: string (= props.message.id)
// New emits:
(e: "use-generated-image", reference: ChatV2GeneratedImageReference): void;
(e: "edit-generated-image", reference: ChatV2GeneratedImageReference): void;
```
UI: action row per generated image (only when src resolved): `Use as reference` toggle-button, `Edit` button, keep Open button/link. Edit emits sole reference; Use toggles handled by parent (parent owns selection state; child just emits — parent decides add/remove). Buttons need `aria-label` from translations; visible numbering badge showing `imageIndex+1`. Never emit localPath.

Lang keys added under `aiChatV2.generatedImageRefs`: `useAsReference`, `edit`, `remove`, `clearAll`, `moveUp`, `moveDown`, `referenceTrayTitle`, `limitReached`, `batchOffer`, `batchConfirmTitle`, `batchConfirmBody`, `send`, plus error labels `errors.generated_image_reference_invalid|not_owned|missing|outside_store|symlink_rejected|unsupported_type|too_large|dimension_limit|reference_limit|ambiguous|fusion_limit|batch_partial|batch_cancelled` (en copy from PRD §19 user-facing column).

- [ ] **Step 1:** Component test first: mount with message containing two generatedImages (protocol-src descriptors per existing test fixtures); assert buttons render with i18n labels; clicking Use emits `use-generated-image` with `{messageId: message.id, imageIndex: 0|1}` exact object; Edit emits same shape; no `localPath` property in emitted payload (assert keys); disabled state when no resolvable src; accessible names present.
- [ ] **Step 2:** FAIL → implement SFC changes + en translations → component test PASS.
- [ ] **Step 3:** Add zh/es/fr/de/ja translations for the same keys (accurate translations; consistent structure).
- [ ] **Step 4:** `yarn test:components` PASS; `yarn vue-check` PASS.
- [ ] **Step 5:** Commit (include all six lang files): `feat: add use-as-reference and edit actions to generated chat images`

### Task 10: Event forwarding through AiChatV2Messages

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2Messages.vue`
- Test: `test/vitest/main/components/AiChatV2Messages.generatedImages.test.ts`

Add both events to emits and forward from inner message handlers verbatim (pattern: existing `@open-artifact` forwarding L21-27).

- [ ] **Step 1:** Test: mount Messages with one message; trigger inner emit; assert outer emit received identical reference objects for both event names.
- [ ] **Step 2:** FAIL → implement → PASS (`yarn test:components`).
- [ ] **Step 3:** Commit: `feat: forward generated-image selection events through message list`

### Task 11: Composer reference tray

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2Composer.vue`
- Test: `test/vitest/main/components/AiChatV2Composer.generatedImageReferences.test.ts`

**Component contract:**
```typescript
// New props:
selectedGeneratedImages?: readonly GeneratedImageReferenceView[];
generatedImageReferenceLimit?: number; // default 3
// New type (define locally in composer or shared util file):
interface GeneratedImageReferenceView { reference: ChatV2GeneratedImageReference; thumbUrl?: string; fileName?: string; }
// New emits:
(e: "remove-generated-image", reference: ChatV2GeneratedImageReference): void;
(e: "clear-generated-images"): void;
(e: "reorder-generated-images", references: ChatV2GeneratedImageReference[]): void;
```
Tray: numbered chips/thumbnails above input (distinct visual group from file uploads, icon `mdi-image-multiple-outline`), order badge `index+1`, per-chip remove button, Clear-all action, move-up/move-down buttons per chip (keyboard accessible, aria-labels). Send enablement: `(draft.trim() || selectedFiles.length || selectedGeneratedImages.length)`. `onSend` includes nothing extra in payload — parent reads its own selection state; but composer must NOT clear references itself in onAccepted (parent clears; composer only clears draft/files as today). When `selectedGeneratedImages.length >= limit`, show inline notice `limitReached` (non-blocking).

thumbUrl: parent supplies `aifetchly-generated-image://...` protocolUrl from resolver metadata when known, else placeholder icon (renderer MUST NOT read file bytes).

- [ ] **Step 1:** Component tests: renders tray with ordered numbered items; remove emits exact reference; clear emits; reorder emits full reordered array; send enabled with refs-only; disabled when streaming; limit notice appears at limit; distinguishable from file chips.
- [ ] **Step 2:** FAIL → implement + en translations → PASS.
- [ ] **Step 3:** Remaining five lang files.
- [ ] **Step 4:** `yarn test:components` + `yarn vue-check` PASS.
- [ ] **Step 5:** Commit: `feat: add generated-image reference tray to chat composer`

### Task 12: Deterministic inference utility

**Files:**
- Create: `src/views/components/aiChatV2/generatedImageReferenceInference.ts`
- Test: `test/vitest/main/service/generatedImageReferenceInference.test.ts`

**Contract:**
```typescript
export type GeneratedImageInferenceResult =
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly references: readonly ChatV2GeneratedImageReference[] }
  | { readonly kind: "ambiguous"; readonly candidates: readonly GeneratedImageReferenceView[] }
  | { readonly kind: "batch_confirmation"; readonly references: readonly ChatV2GeneratedImageReference[] };
export function inferGeneratedImageReferences(input: {
  text: string;
  messages: ReadonlyArray<Pick<ChatV2MessageView, "id" | "role" | "metadata">>;
  explicitSelection: readonly ChatV2GeneratedImageReference[];
  directLimit?: number; // default 3
}): GeneratedImageInferenceResult;
```
Rules (deterministic, conservative):
1. explicitSelection.length > 0 → `resolved(explicitSelection)`.
2. Latest generation group = generatedImages of the most recent assistant message having ≥1; candidates = its indices in display order.
3. Singular-reference phrase detected (per-language tables below): group size 1 → `resolved([group0])`; size >1 → `ambiguous(candidates)`.
4. Numbered phrases (`image 2`, `第2张`, `画像2`…) → collect valid indices in mentioned order (clamp to group; invalid ignored); 1..directLimit → resolved; >directLimit → batch_confirmation.
5. Both/all phrases: bounded group ≤ directLimit → resolved(group); > directLimit → batch_confirmation.
6. Fusion verbs (combine/merge/blend…) with candidate count > directLimit → return `{kind:"none"}` and let UI raise fusion-limit error separately via exported helper `isFusionWording(text): boolean` consumed by AiChatV2 (Task 13) to show `generated_image_fusion_limit` toast while preserving selection.
7. No generated images or no matching phrasing → none.
Phrase tables (exported const for tests): singular `{en:/\b(the|this|that)\s+(image|picture|photo|pic)\b|\bit\b/i, zh:/这[张个]图[像片]?|这张照片/, es:/\b(la|esta|esa)\s+(imagen|foto)\b/, fr:/\b(l'|cette)\s*(image|photo)/, de:/\b(das|dieses)\s+(Bild|Foto)\b/, ja:/この画像|その画像/}`; numbered `{en:/image\s*#?\s*(\d+)/gi, zh:/第\s*(\d+)\s*[张個张张图像片图片]/g…, es/fr/de similar /imagen\s*(\d+)/gi …, ja:/(\d+)\s*番目の画像|画像\s*(\d+)/g}`; pluralAll `{en:/\b(both|all of them|all)\b/i, zh:/全部|都|两张都|三张都/, es:/\b(todas|ambas)\b/, fr:/\b(toutes?|les deux)\b/, de:/\b(alle|beide)\b/, ja:/全部|すべて|両方/}`; fusion `{en:/\b(combine|merge|blend|fuse)\b/i, zh:/融合|合并|合成/, es:/\b(combinar|fusionar)\b/, fr:/\b(combiner|fusionner)\b/, de:/\b(kombinieren|verschmelzen)\b/, ja:/組み合わせ|融合|合成/}`. All six languages MUST have entries in all four tables (tests iterate).

- [ ] **Step 1:** Tests per design §20.1 inference list: explicit wins over conflicting text; singular+one image resolves; singular+three ambiguous with candidate ids; numbered picks order `[2,0]` for "image 3 then image 1"; both/all bounded; 6-image all → batch_confirmation; every language table matches at least one fixture string (parametrized over langs); no-images → none; fusion wording exported helper true across langs.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat: deterministic generated-image reference inference utility`

### Task 13: Conversation-scoped selection, wiring, ambiguity & batch confirmation UX

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue`
- Test: `test/vitest/main/components/AiChatV2.generatedImageEditing.test.ts`

**State & behavior in AiChatV2.vue:**
```typescript
interface GeneratedImageDraftState { readonly references: ChatV2GeneratedImageReference[] }
const generatedImageDrafts = ref(new Map<string, GeneratedImageDraftState>());
const DRAFT_KEY_PENDING = "__pending_conversation__";
function draftKeyFor(id: string | null): string { return id ?? DRAFT_KEY_PENDING; }
```
- Handlers: `onUseGeneratedImage(ref)` toggles membership in active draft (add if absent, remove if present, cap 50); `onEditGeneratedImage(ref)` replaces selection with `[ref]` and focuses composer (expose composer focus via existing template ref or prop `focusSignal` counter).
- On conversation switch (`onSelectConversation`) and new-conversation (`onNewConversation`): save nothing (map already keyed), swap active key, pass restored selection to composer; clearing/deleting a conversation deletes its draft entry.
- Send path (`onSend`): compute `explicit = draft.references`; if empty run `inferGeneratedImageReferences` over current messages+text; on `ambiguous` → set `ambiguityCandidates` ref rendered as a thumbnail chooser dialog above composer; abort send (restore draft, do NOT call API); on `resolved` merge (explicit already covers); on `batch_confirmation` → show confirm dialog (uses `batchConfirm*` translations); confirmed → proceed WITHOUT attaching refs >3 (model acts via markers + instruction) — append nothing silently: send proceeds with plain text; declined → abort.
- Build streamRequest: when effective refs 1..3 → `streamRequest.generatedImageReferences = refs`; when text blank and refs>0 → `message = "Describe the selected image."`.
- Fusion guard: if `isFusionWording(text)` and effective refs > 3 → error toast `generatedImageRefs.errors.generated_image_fusion_limit`, keep selection, abort.
- onError during stream: keep selection (do not clear drafts); onAccepted (success accept) clears draft for that conversation.
- Render error toasts mapping `chunk.errorCode` (when it starts `generated_image_`) through `t('aiChatV2.generatedImageRefs.errors.' + code)` with fallback.
- Pass to composer: `:selected-generated-images`, `:generated-image-reference-limit="3"`; wire tray events to draft mutations.

- [ ] **Step 1:** Component tests (follow `AiChatV2.workspace.test.ts` harness incl. child stubs): selecting via message event updates tray; switching conversation isolates selections (select in A, switch to B, tray empty, switch back → restored); Edit replaces selection; send includes `generatedImageReferences` on the mocked stream invoke payload (assert via window.api.send/invoke mock capture) and clears draft after accept; failed preflight (simulate inference ambiguity) shows chooser and does NOT invoke stream; batch confirmation dialog gates send; fusion>3 shows error and retains tray; errorCode from error chunk surfaces translated message.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** `yarn test:components && yarn vue-check` PASS.
- [ ] **Step 4:** Commit: `feat: conversation-scoped generated-image selection with deterministic inference and ambiguity UX`

### Task 14: E2E scenario (critical flow)

**Files:**
- Create: `test/e2e/specs/ai-chat-generated-image-editing.test.ts`

Author Playwright Electron spec following existing specs' bootstrap pattern (read one existing spec first): steps — start conversation (no workspace), generate image (stubbed server fixture if the harness provides one; otherwise mark `test.fixme` with TODO note referencing manual verification), request "add a dog beside the lion", assert no `workspace_required` tool card text appears and a second image renders; select-two-ordering assertion; conversation-switch isolation. Run only if infra available: `yarn test:e2e` (document result; do not block phase completion on live-server availability, but the spec must compile/be collected).

- [ ] Step 1: Study existing e2e spec + fixtures; write spec. Step 2: `yarn build:e2e` compiles; run suite if environment supports, else record skip rationale in PR notes. Step 3: Commit: `test: add e2e scenario for workspace-less generated-image editing`

---

# Phase 4 — Generated-Image Batch Subagents

### Task 15: Discriminated batch source + generated branch authorization

**Files:**
- Modify: `src/service/agentTools/processArtifactBatchTool.ts`, `src/entityTypes/agentTypes.ts` (if result identities live there; prefer local types in tool file)
- Test: extend `test/vitest/main/service/processArtifactBatchTool.test.ts`

**Contracts:**
```typescript
export type ArtifactBatchSource =
  | { readonly kind: "workspace_files"; readonly files: readonly string[] }
  | { readonly kind: "generated_images"; readonly references: readonly ChatV2GeneratedImageReference[] };

export type ArtifactBatchInputIdentity =
  | { readonly kind: "workspace_file"; readonly path: string }
  | { readonly kind: "generated_image"; readonly reference: ChatV2GeneratedImageReference };

// ArtifactBatchItemResult gains: input: ArtifactBatchInputIdentity; errorCode?: GeneratedImageReferenceErrorCode
// ProcessArtifactBatchInput schema adds optional generatedImageReferences (array of {messageId,imageIndex}, max 50)
```
Parsing: exactly one of `files`/`generatedImageReferences` present (both or neither → arg error); refs normalized with same rules as IPC (reuse a shared pure helper — extract `normalizeGeneratedImageReferences` into `src/service/generatedImageReferenceNormalize.ts` and have IPC import it too; update Task 5 accordingly). Execute branches: `workspace_files` keeps existing resolveWorkspace requirement verbatim; `generated_images` calls `deps.authorizeReferences(conversationId, refs)` (new dep, default = `GeneratedImageReferenceService.authorizeOnly`) once up-front; per-ref failure → item `{status:"failed", errorCode}` WITHOUT workspace check and without preparing bytes; never fabricates a workspace. Schema description updated; `requiresConfirmation: true` retained (paid-op gate). Permission preview branches: workspace → existing preview; generated → preview listing count + safe labels (`message=<id> image=<n>`), destination "AI server", NO paths (adapt to actual `PermissionPreview` type found in skillsRegistry/SkillDefinition definitions).

- [ ] **Step 1:** Tests: mutual exclusivity errors; workspace branch unchanged (still `workspace_required` without workspace); generated branch succeeds with NO workspace (resolveWorkspace returns null yet batch completes via stubbed runAgent); per-item authorization failure yields ordered failed item with errorCode, siblings continue; 51 refs rejected; duplicates collapsed; result identities shaped correctly; preview contains no path-like strings for generated branch.
- [ ] **Step 2:** FAIL → implement (extract shared normalizer first) → PASS.
- [ ] **Step 3:** Commit: `feat: support generated-image sources in process_artifact_batch without workspace`

### Task 16: Trusted initialImageArtifacts on agent runtime

**Files:**
- Modify: `src/entityTypes/agentTypes.ts` (`RunAgentRequest.initialImageArtifacts?: readonly AgentInitialImageArtifact[]`)
- Modify: `src/service/AgentPromptBuilder.ts`, `src/service/AgentRuntime.ts`
- Create: `src/service/AgentDefinitionRegistry.ts` addition — new built-in definition `agent-generated-image-editor` (allowedTools: [], mode "specialist", maxToolCalls 2, maxRuntimeMs 240000, systemPrompt: source-neutral per design §13.3, same BATCH_WORKER_OUTPUT_SCHEMA)
- Test: extend `test/vitest/main/service/AgentRuntime.test.ts` + new small registry test

```typescript
export interface AgentInitialImageArtifact {
  readonly sourceId: string;            // `${messageId}:${imageIndex}`
  readonly fileName: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly dataUrl: string;
  readonly detail: "auto" | "low" | "high";
}
```
Rules: artifacts accepted ONLY via in-process `runSync` request (never parsed from tool args/taskPacket JSON — document in type comment); NOT written into persisted AgentTask (strip before `taskModule.createTask` — persist packet only); NOT copied into AgentResult; not exposed to hooks. PromptBuilder.build gains optional `initialImageArtifacts` param: when present, first user message becomes multimodal content parts `[{type:"text",text:<json packet>},{type:"image_url",image_url:{url:dataUrl,detail}}…]` (worker receives exactly one). Runtime forwards `request.initialImageArtifacts` into builder and nowhere else.

- [ ] **Step 1:** Tests: runSync with artifact → fake loop captures first message containing image part with exact dataUrl and text part containing packet JSON; created task snapshot contains NO `dataUrl`/base64 substring; AgentResult lacks it; zero-artifact path byte-identical to old behavior; registry exposes `agent-generated-image-editor` retrievable via getActiveById mock seam.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Commit: `feat: trusted transient initial image artifacts for isolated batch worker agents`

### Task 17: Just-in-time preparation scheduler + retry-failed + progress counts

**Files:**
- Modify: `src/service/agentTools/processArtifactBatchTool.ts` (scheduler refactor), `src/service/AgentDefinitionRegistry.ts` (BATCH_WORKER_PROMPT source-neutral wording retained for workspace branch; generated branch routes to new agent)
- Test: extend `test/vitest/main/service/processArtifactBatchTool.test.ts`

Scheduler: generalize existing shared-index runner loop — items are `{identity, source}`; workspace items resolve path eagerly (current behavior); generated items hold authorized `AuthorizedGeneratedImageSource` only; inside each slot, JUST BEFORE `runAgent`, generated branch calls injected `prepareReference(source)` dep (default wraps resolver's prepare-once flow: authorizeOnly already done, so dep signature `prepare: (authorized) => Promise<PreparedGeneratedImageArtifact>` implemented by a small coordinator helper using GeneratedImageReferenceService internals — expose `prepareAuthorized(sources, detail, signal)` on the service returning prepared artifacts per source). Concurrency slots = min(concurrency, count) ≤ 3; release artifact variable after each `runSync` (let go out of scope); results filled into preallocated array by original index; cancellation marks queued cancelled and aborts actives via context.signal (existing). Default `runAgent` impl branches: generated → `runtime.runSync({agentId:"agent-generated-image-editor", prompt, taskPacket:{files:[],instruction}, initialImageArtifacts:[artifact], parentConversationId, model, executionMode:"foreground"}, {signal})` with NO executeTool intercept; workspace → existing path unchanged. Progress: emit evolving progress via existing tool-progress mechanism if available in SkillExecutionContext (inspect; if absent, include running counts in returned summary string — keep scope minimal). Retry-failed: documented in tool description — "call again passing only failed/cancelled generatedImageReferences"; result already carries identities to enable it.

- [ ] **Step 1:** Tests: 20 refs with concurrency 3 → runAgent called 20×, max 3 in flight (track inflight high-water mark in stub), results ordered by input regardless of completion order; JIT: prepare called lazily (first three before first runAgent completes, remaining staggered); failure isolation (item 5 throws → others complete, aggregate `partial`); cancel mid-run → queued become cancelled with errorCode `generated_image_batch_cancelled`, completed kept; generated branch never calls resolveWorkspace; no dataUrl appears in any returned result JSON (deep-stringify scan).
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Full main suites: `yarn testmain`.
- [ ] **Step 4:** Commit: `feat: just-in-time generated-image preparation with bounded subagent scheduling and retry-failed mapping`

### Task 18: Batch result surfacing + final integration hardening

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2Message.vue` (render batch aggregate counts from tool result metadata when toolName==="process_artifact_batch": `N of M completed · concurrency c` + expandable per-item failures using errorCode translations; no bytes)
- Modify: six lang files (`progressSummary` key)
- Test: extend `AiChatV2Message.generatedImages.test.ts` (or new `AiChatV2Message.batchProgress.test.ts`)

- [ ] **Step 1:** Component test: message with toolResult containing ArtifactBatchResult-shaped JSON renders summary line + per-item failed rows with translated codes; no base64/path leakage asserted.
- [ ] **Step 2:** Implement + all six translations.
- [ ] **Step 3:** Gates: `yarn test:components`, `yarn testmain`, `yarn vue-check` all PASS.
- [ ] **Step 4:** Commit: `feat: surface batch progress and partial-failure details for generated-image batches`

---

# Final Verification (Definition of Done mapping)

- [ ] `yarn testmain` green (resolver, protocol, engine, ipc, context, batch, runtime suites).
- [ ] `yarn test:components` green (all new/extended component tests).
- [ ] `yarn vue-check` green.
- [ ] Grep guards: no `aifetchly-generated-image://` inside outbound content-part construction; no `local_path` in `AIChatGeneratedImageContextService.ts`; no `dataUrl` persisted in engine metadata writes.
- [ ] Manual smoke (dev app, optional): generate lion → "add a dog beside the lion" → edited image, zero workspace cards.
- [ ] Server repo (`/home/robertzeng/project/aifetchserver`): confirm existing integration tests cover one-image edit / ordering / max-3 (verification only; desktop plan makes no server changes).

## Self-Review Notes (already applied)

- Spec coverage: TD-1…TD-10 map to Tasks 1(TD-1,3,10 types), 4(TD-2,3), 3/4(TD-4), 6(TD-5,6), 15-17(TD-7,8), 7(TD-9), 1(TD-10). PRD FR-1..FR-14 covered across Tasks 9/11/12/13 (FR-1,8), 4/5/6 (FR-2,3,13,14), 6/14 (FR-4), 15/17 (FR-5,12,6), 16/6 (FR-7 persistence of outputs remains existing storage path), 8 (FR-10), 5 (FR-11), 9/11 (FR-1). i18n + component-test mandates embedded per renderer task.
- Type consistency: `ChatV2GeneratedImageReference` defined once (Task 1) and imported everywhere; `normalizeGeneratedImageReferences` shared helper introduced in Task 15 extraction with IPC (Task 5) importing it — implementers of Task 5 should place the function in `src/service/generatedImageReferenceNormalize.ts` from the start to avoid churn.
- Known intentional simplifications (within spec latitude): batch confirmation sends plain text relying on markers + tool authorization rather than a new batch IPC; batch progress uses existing tool-progress/result rendering rather than a new event channel; E2E may be environment-gated.
