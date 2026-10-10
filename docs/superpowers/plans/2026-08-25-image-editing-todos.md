# Generated-Image Editing — Incomplete-TODOs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Complete every remaining item in `docs/prd/ai-chat-generated-image-editing-incomplete-todos.md` (P0-1..P0-4, P1-1..P1-7, P2-1..P2-5) on top of the merged feature.

**Worktree:** `.worktrees/generated-image-editing-todos` on `feature/generated-image-editing-todos` (base `a218dea3`). All work happens there.

**Specs:** the TODO file itself is the requirement source; PRD/design docs provide context.

## Global Constraints
(Same as previous plan: no `any`; explicit return types; Model/Module-only DB access; workers DB-free; commit per task; UI changes ship tests + all-six translations; forbidden in logs/results/persistence: absolute generated paths, base64/data URLs, provider signed URLs, raw metadata.)

## Verified Anchors (trust these)

| Topic | Location |
|---|---|
| Subagent storage ids `agent-v2-*` / `agent-assistant-agt-*` | `src/service/AgentRuntime.ts:142-143,368,541-556` |
| `persistAgentImages` (filter + outputFilePaths from local_path) | `src/service/persistAgentImages.ts:45-97` |
| Descriptor writer incl. `local_path` | `src/service/AIChatGeneratedImageStorageService.ts:102-117`; early-return for protocol URLs :70-75 |
| `normalizeToolResult` spread sink | `src/service/AIChatQueryLoop.ts:585-593`; sinks: event L1837-1845, transcript L1873-1877, hooks L2550+, engine persistence L1948-1965 |
| Harvest → parent storage | `AIChatQueryLoop.ts:1787-1792,1996-1999` → `AIChatQueryEngine.storeGeneratedImages:1995-2019` |
| Batch item/aggregate shapes with `outputFilePaths` | `processArtifactBatchTool.ts:74-97`; populate L694-712; summarize L428-467 |
| Async tool context has NO signal | `AIChatQueryLoop.ts:2226-2249`; foreground uses timeout token :2575-2586 |
| `ToolJobRegistry.cancel` + handlers | `src/service/ToolJobRegistry.ts:232-260`; registry.cancel called on abort poll :2346-2351 |
| Renderer confirm loses refs | `AiChatV2.vue:1346-1362` (clears), preflight L3759-3836, dead `batchConfirmReferences` L1311, bypass flag L4029-4035 |
| Draft cap 50 / limit 3 constants | `AiChatV2.vue:1197-1203` |
| No direct skill-execute IPC exists; `aiChatV2.artifactExport` lang section unconsumed | explore report §6 |
| `userSafeError` mapping | `src/service/AIChatErrorMapper.ts:195-262`; sentinels `AIChatErrorSentinels.ts` |
| Attach `processOne` + cancel checks | `AIImageAttachmentToolService.ts:370-379`; cancels at L242-246,297-301,462-465; success return L359-363; parseArgs L152-217 |
| Approval card component/testids | `src/views/components/aiChat/SkillApprovalCard.vue` (testids ai-chat-permission-*) |
| E2E harness: single-shot toolCallConfig, `/__e2e/tool-call`, request capture | `test/e2e/fixtures/fakeOpenAiServer.ts:112-184`, `scenarios/openAiProtocol.ts:20-107` |
| Server companion: pytest, chat-image test files listed | `/home/robertzeng/project/aifetchserver` |

---

### Task 1 (P0-1): Safe generated-image batch output descriptors

**Files:** modify `src/service/persistAgentImages.ts` (add `slimPersistedImage`/exported sanitizer), `src/service/agentTools/processArtifactBatchTool.ts`, test `test/vitest/main/service/processArtifactBatchTool.test.ts`.

**Contract:**
```ts
// persistAgentImages.ts
export interface SlimmedOutputImage { url?: string; file_name?: string; mime_type?: string; width?: number|null; height?: number|null; delivery?: string; }
export function slimOutputImage(image: OpenAIChatImage): SlimmedOutputImage; // drops local_path, b64_json, original_url, metadata, expires_at
```
- Generated-branch items: `outputFilePaths` omitted entirely; `outputImages` mapped through slimOutputImage.
- Aggregate flatten mirrors items (generated contributions slim; workspace contributions keep legacy shape).
- Workspace branch contract unchanged (paths retained deliberately).
- Keep raw paths only inside main-process persistence layer (AgentRuntime internals may keep them for logging-free internal use; nothing crossing tool-result boundary).
**Tests:** deep-stringify entire execute() return for a generated batch → no `local_path`, no `outputFilePaths`, no `/tmp`, no `data:image/`, no base64 fixture; workspace branch still returns paths; normalizeToolResult spread of the sanitized payload contains none of the prohibited values (new small test near AIChatQueryLoop harness or reuse tool test).

### Task 2 (P0-2): Re-home batch outputs into parent conversation

**Files:** modify `src/service/AIChatGeneratedImageStorageService.ts` (+interface), `src/service/AIChatQueryEngine.ts` (storeGeneratedImages), test `test/vitest/main/service/AIChatGeneratedImageStorageService.test.ts` + engine test.

**Contract:**
```ts
// storage service
async rehomeImages(input: { images: OpenAIChatImage[]; targetConversationId: string; targetMessageId: string }): Promise<OpenAIChatImage[]>
// for each descriptor whose parsed protocol identity (parseGeneratedImageProtocolIdentity) has
// conversationPathPart !== sanitize(targetConversationId) || messagePathPart !== sanitize(targetMessageId):
//   copy file old->new dir (fs.copyFile; fall back to descriptor unchanged if source missing),
//   return rewritten descriptor via buildGeneratedImageProtocolUrl + local_path updated; matching ones pass through untouched.
```
- Engine `storeGeneratedImages`: call rehomeImages with final parent conversation + assistant message id BEFORE writing metadata.generatedImages (covers harvested batch outputs AND direct completions idempotently).
- Ordering/partial behavior unchanged.
**Tests:** storage test — seed temp file layout under agent-like conv/msg dirs, rehome to parent ids → file copied, new URL parses with parent segments, source intact (copy not move); engine test — completed turn with mixed own+agent-URL images persists ALL under parent identity; authorizeOnly resolves a rehomed output in a later turn (regression per TODO).

### Task 3 (P0-3): Confirmed reference-set staging channel

**Files:** create `src/service/ConfirmedBatchReferenceRegistry.ts`; modify `src/entityTypes/aiChatV2Types.ts` (`ChatV2StreamRequest.confirmedGeneratedImageBatch?: { readonly references: ChatV2GeneratedImageReference[] }`), `ai-chat-v2-ipc.ts`, `processArtifactBatchTool.ts` (deps + execute), `AiChatV2.vue`, `views/api/aiChatV2.ts` passthrough; tests ipc + tool + component.

**Design (module-level registry keyed by conversationId — trusted main-process state):**
```ts
export class ConfirmedBatchReferenceRegistry {
  stage(conversationId: string, references: readonly ChatV2GeneratedImageReference[]): void;
  consume(conversationId: string): readonly ChatV2GeneratedImageReference[] | null; // atomically reads+clears
  clear(conversationId: string): void;
}
export function getConfirmedBatchReferenceRegistry(): ConfirmedBatchReferenceRegistry; // singleton
```
- IPC: normalize `req.confirmedGeneratedImageBatch.references` with shared normalizer maxItems 50 → registry.stage(conversationId, refs); strip field from request reaching engine; clear staged set in handleStop for that conversation.
- Batch tool: new dep `consumeConfirmedReferences?: (conversationId: string) => readonly ChatV2GeneratedImageReference[] | null` default = registry singleton; at generated-branch start: staged = consume(); if staged → use staged set INSTEAD of model-supplied `generatedImageReferences` (ignore model array entirely, log code-only note); if none staged → existing behavior (model-derived, normalized+authorized).
- Renderer: `confirmGeneratedImageBatch()` keeps `pendingGeneratedImageSend` refs; sends with `request.confirmedGeneratedImageBatch = { references }`; delete dead `batchConfirmReferences` ref entirely; decline clears pending (existing).
- Instruction separation preserved: instruction remains the user text; registry carries refs only.
**Tests:** ipc test — valid staged refs forwarded to registry (spy), malformed rejected before staging, stop clears; tool test — staged set wins over conflicting model args (order+identity preserved verbatim); no staged set falls back; consume clears (second execute gets null); component test — confirming dialog produces captured invoke payload containing confirmedGeneratedImageBatch equal to selection order.

### Task 4 (P0-4): Explicit selections above three route to batch choice

**Files:** modify `AiChatV2.vue` preflight/send, composer notice text handling; tests extend `AiChatV2.generatedImageEditing.test.ts`.
**Behavior:** explicit selection 4..50 (non-fusion) on send → open EXISTING batch-confirm dialog showing selected count; confirm → staged-channel send (Task 3); decline clears. Fusion wording >3 → fusion-limit toast (unchanged). 1..3 direct (unchanged). Tray permits up to 50 (cap already 50); limitReached notice becomes informational at ≥3.
**Tests:** fourth explicit selection + send → dialog visible, no stream call; confirm → payload has confirmedGeneratedImageBatch length 4 in order; decline → nothing sent, tray kept; fusion>3 → fusion toast, no dialog; paid-work confirmation visible (count text present).

### Task 5 (P1-1): Save-to-workspace action

**Files:** new IPC channel in `channellist.ts` + `src/main-process/communication/generatedImageExportIpc.ts` (register alongside others in background/ipc registration — follow existing registration file pattern), reuse export logic: inspect `exportGeneratedArtifactsTool.ts` for its inner export service/deps to call directly (workspace resolve via same resolver seam; if none extracted, extract minimal `exportGeneratedArtifactFile({sourceProtocolUrl, workspaceRoot})` helper INTO the tool module and have both tool + IPC use it); modify `AiChatV2Message.vue` (button), `AiChatV2Messages.vue` + `AiChatV2.vue` (forward/handle), lang ×6 (label `saveToWorkspace` under generatedImageRefs; reuse existing `artifactExport.*` strings for outcomes where possible).
**Behavior:** button always visible on generated images; click emits `save-generated-image(reference)`; parent invokes IPC `{conversationId, reference}`; handler authorizes via GeneratedImageReferenceService.authorizeOnly(1 ref) + resolves approved workspace: none → `{status:"workspace_required"}` and renderer surfaces existing request-workspace flow (emit existing event chain) keeping a pending export retried after workspace ready; success → `{status:"exported", fileName}` and renderer shows translated toast + file-op chip appears next turn via existing metadata path (write toolResult-style metadata through a lightweight assistant metadata append OR rely on existing chip extraction from a persisted tool result — implementer inspects `fileOperationMetadata.extractArtifactExportOperations` and persists a compatible tool_result row via AIChatV2Module.saveToolResultMessage with messageType TOOL_RESULT metadata {toolName:"export_generated_artifacts", toolResult:{items:[{status:"exported",destination}]}} so history chips work).
**Tests:** component — button renders with accessible label; click emits reference (exact object); workspace_required path shows guidance; success shows toast; main-process test — handler authorizes (forge fails safely), exports file into temp workspace root, persists chip-compatible row, AI-gate first (canUseChat) on the new channel.

### Task 6 (P1-2 + P1-3): Retry-failed + Stop on batch surface

**Files:** `AiChatV2Message.vue` (buttons on batch card), `AiChatV2.vue` (handlers; retry composes staged send reusing Task 3; stop delegates to existing onStop for active conversation), `AIChatQueryLoop.ts` (pass real signal into async tool contexts + register cancel), `ToolJobRegistry` usage in tool (register onCancel), batch result gains `instruction?: string` (safe echo ≤500 chars) for retry reuse; tests component + tool.
**Retry contract:** button rendered when aggregate status ∈ partial|failed|cancelled; collects refs from items with status failed|cancelled (input.kind generated_image only); preserves order; sends via confirmedGeneratedImageBatch staged channel + `instruction` from result; successful items never included (assert). Rerun-all NOT built (explicitly out of scope unless trivial).
**Stop contract:** `executeAsyncTool` gains `signal` from the turn's AbortController (thread `input.abortController.signal` — implementer locates the async execute call site and adds context.signal; verify no other async tool regresses); batch tool registers `job.onCancel(...)` via context-exposed registry handle OR tool-level AbortController wired to context.signal so registry.cancel aborts in-flight items; queued items become cancelled with existing errorCode; completed outputs remain.
**Tests:** loop-level test that async context now carries aborted-signal propagation; tool test — cancelling controller mid-run marks queued cancelled & stops launches; component — Stop button visible while streaming batch card, click calls stop; Retry button on partial card triggers exactly the failed refs payload.

### Task 7 (P1-4): Complete provider error codes

**Files:** `src/service/AIChatErrorSentinels.ts` (+2 sentinel consts), `AIChatErrorMapper.ts` (userSafeError branches + errorCode return — extend to return `{message,errorCode}` or map separately; implementer picks minimal-invasive consistent with existing chunk errorCode plumbing from prior feature), `AIChatQueryEngine.ts` error emission attaches errorCode for these, renderer `displayStreamErrorMessage` maps codes `image_edit_unavailable|image_edit_provider_failed` to new lang keys; lang ×6; tests mapper unit + engine emission + renderer translation.
**Mapping rules:** server/transport signals containing "image_edit_unavailable"/"no image-to-image"/"edit model unavailable" (case-insensitive) → unavailable; provider rejection patterns ("image generation failed", edit-capable-model 5xx after retries, "provider" + "image") → provider_failed; everything else unchanged.

### Task 8 (P1-5 + P1-6 + P1-7): Attachment tool hardening

**Files:** `AIImageAttachmentToolService.ts`; tests extend `test/vitest/main/service/AIImageAttachmentToolService.test.ts`.
- **P1-5 canonical dedupe:** after guard.validate in the step loop (where resolvedPath first available): `realpath(resolved)` vs seen-set (first wins; subsequent aliases skipped, counted, noted in summary string). Symlink/relative aliases covered via realpath. Guard failures still reject.
- **P1-6 late-cancel race:** immediately before assembling successful return: `if (context.signal?.aborted) return cancelled result` (also after EACH normalization attempt). Test: fake normalizer resolves after abort flips → execute returns `{success:false, code:"cancelled"}`, modelArtifacts absent.
- **P1-7 summarizeModelArtifacts:** exported pure helper returning `{count, mimeTypes: string[], maxWidth, maxHeight, totalPreparedBytes}`; wire into the tool's summary/log sites; test asserts output contains no dataUrl/base64/buffer keys.

### Task 9 (P2-1 + P2-2): Component + permission-UI coverage top-up

Most cases land inside Tasks 4–8 tests. This task adds what remains:
- SkillApprovalCard file_transfer preview tests (new `SkillApprovalCard.permissionPreview.test.ts`): three-row preview renders; long-path truncation style asserted (CSS class present + ellipsis style); approve-once/deny/always emits; metadata-only success card (attachLocalImagesAttachments rendering in AiChatV2Message) shows names without paths/base64.
- Six-language key-resolution test (new utility-style vitest iterating all six lang modules): every `aiChatV2.imageTool.*` and `aiChatV2.generatedImageRefs.*` key referenced in components resolves (walk en tree; assert same key sets across locales).
Run gate: yarn test:components.

### Task 10 (P2-3 + P2-4): E2E scenario completion

**Files:** `test/e2e/scenarios/openAiProtocol.ts` + `aiChatScenarios.ts` + `fakeOpenAiServer.ts` (extend toolCallConfig to a QUEUE consumed per continuation request; add image-emitting scenario producing final assistant delta with `images` array matching OpenAIStreamAccumulator expectations), new/extended specs in `test/e2e/specs/`.
- P2-3 scenarios: lion-plus-dog round-trip (enable the existing fixme), older-image selection excludes latest, forged cross-conversation reference → generic error without path disclosure, batch progress + partial outputs render, cancel keeps completed (best-effort), workspace edit still requires approval (permission prompt appears for attach_local_images path).
- P2-4 attachment flow: scripted queue [glob_files → attach_local_images] on seeded workspace files; capture third request asserting (a) preceding metadata-only tool message, (b) synthetic user multimodal handoff repeats original ask with ≤3 bounded image parts; permission-pause/resume variant; cancellation variant asserting no duplicate provider requests.
- Attempt `yarn test:e2e` limited to affected specs; if ENOSPC watcher limit blocks Vite startup, attempt mitigation within sandbox (env `WATCHPACK_POLLING`? vite config override flag documented) else record blocker verbatim in report + mark skipped-with-reason; specs must compile/typecheck regardless.

### Task 11 (P2-5): Companion server contract verification

Run in `/home/robertzeng/project/aifetchserver`: `git rev-parse HEAD`; `pytest tests/unit/test_chat_image_input.py tests/unit/test_chat_image_orchestrator.py tests/unit/test_chat_image_handoff_intent.py tests/unit/test_edit_image_orchestrator.py tests/unit/test_openai_compatible_edit_image.py tests/integration/test_chat_image_handoff.py` (adjust to available runner; venv if present). Record commit + command + pass/fail in new doc `docs/prd/ai-chat-generated-image-editing-server-verification.md`. If environment cannot run pytest, record exact blocker output. No server code changes unless a desktop-contract failure is proven (then stop and report).

### Task 12: Final gate + TODO checkbox closure

- Update TODO file marking completed checkboxes (leave genuinely-not-done items unchecked with one-line reason referencing reports).
- Gates: `yarn typecheck` (script name? verify package.json — earlier evidence shows tsc hooks; use repo scripts), vue-typecheck equivalent, `yarn testmain` (AIFETCHLY_SKIP_TSC=1 acceptable if env broken — document), `yarn test:components`.
- Final whole-branch review (separate dispatch after Task 12 prep).

## Execution notes
- Sequential dispatches, review after each (scoped re-review on findings), ledger at `.superpowers/sdd/2026-08-25-image-editing-todos/progress.md`.
- Tasks 1→2→3 are dependency-ordered; 4 depends on 3; 6 depends on 3; rest independent-ish (keep sequential anyway).
