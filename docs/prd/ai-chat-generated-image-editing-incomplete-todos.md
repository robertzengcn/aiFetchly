# AI Chat Generated-Image Editing: Incomplete Implementation TODOs

## Purpose

This checklist tracks the requirements that remain incomplete after auditing:

- [`ai-chat-generated-image-editing-prd.md`](./ai-chat-generated-image-editing-prd.md)
- [`ai-chat-llm-image-attachment-tool-technical-design.md`](./ai-chat-llm-image-attachment-tool-technical-design.md)

Complete and verify every item before treating either document as implemented. Keep generated-image sources workspace-independent while preserving all existing workspace guards for local project files.

## Priority 0: Security and Correctness

### TODO P0-1: Remove application paths from generated-image batch results

- [ ] Define a renderer/model-safe batch output descriptor that excludes `local_path`, `outputFilePaths`, base64, data URLs, provider URLs, and raw bytes.
- [ ] Remove `outputFilePaths` from generated-image item results and the generated-image aggregate result in `src/service/agentTools/processArtifactBatchTool.ts`.
- [ ] Sanitize `outputImages` before they enter `ToolExecutionResult.result`, persistence, hooks, renderer events, or the model transcript.
- [ ] Keep any absolute storage path private to the main-process persistence layer.
- [ ] Add tests proving `normalizeToolResult()`, saved tool results, hooks, renderer events, logs, and parent model messages contain none of the prohibited values.
- [ ] Preserve the existing workspace-file batch contract unless a compatible safe descriptor can replace its path output deliberately.

Acceptance checks:

- A generated-image batch can complete and render all successful images.
- Serialized parent tool results contain mappings, statuses, counts, stable errors, and sanctioned durable descriptors only.
- Searching serialized results for `local_path`, `outputFilePaths`, `data:image/`, base64 fixtures, or absolute generated-image roots returns no matches.

Relevant files:

- `src/service/agentTools/processArtifactBatchTool.ts`
- `src/service/persistAgentImages.ts`
- `src/service/AIChatQueryLoop.ts`
- `src/service/ToolExecutionService.ts`
- `test/vitest/main/service/processArtifactBatchTool.test.ts`
- `test/vitest/main/service/AIChatQueryLoop.imageArtifacts.test.ts`

### TODO P0-2: Re-home batch outputs into the parent conversation

- [ ] Persist each successful subagent image under the parent conversation and final parent assistant message identity, or safely copy/re-materialize it there before publishing its descriptor.
- [ ] Do not reuse a subagent protocol URL unchanged in parent assistant metadata.
- [ ] Ensure the descriptor's protocol conversation and message segments match the parent message that owns `metadata.generatedImages`.
- [ ] Keep input-to-output ordering and partial-success behavior intact.
- [ ] Add a regression test that selects a completed batch output as a reference in a later parent-conversation turn and resolves it successfully.

Acceptance checks:

- Every rendered batch output can be opened and used as a later generated-image reference.
- `GeneratedImageReferenceService` authorizes the output using the active parent conversation and authoritative parent assistant message.
- Agent conversation IDs and agent message IDs do not appear as ownership identities in parent descriptors.

Relevant files:

- `src/service/AgentRuntime.ts`
- `src/service/persistAgentImages.ts`
- `src/service/AIChatGeneratedImageStorageService.ts`
- `src/service/AIChatQueryEngine.ts`
- `src/service/GeneratedImageReferenceService.ts`

### TODO P0-3: Carry the exact confirmed reference set into batch execution

- [ ] Stop clearing `batchConfirmReferences` before they have been passed to the trusted request path.
- [ ] Add a typed renderer-to-main contract for confirmed generated-image batch references, or invoke a dedicated main-process batch entry point.
- [ ] Normalize and authorize the confirmed references in the main process before provider work.
- [ ] Ensure the model cannot replace, add, or omit references after the user confirms the set.
- [ ] Keep the batch instruction separate from the opaque reference array.
- [ ] Add tests proving reference order and identity survive confirmation unchanged.

Acceptance checks:

- Confirming “Use these N images?” starts work for exactly those N references.
- The confirmed set does not depend on the model reconstructing message IDs from annotations.
- Forged or stale confirmed references fail before any provider request.

Relevant files:

- `src/views/components/aiChatV2/AiChatV2.vue`
- `src/entityTypes/aiChatV2Types.ts`
- `src/views/api/aiChatV2.ts`
- `src/main-process/communication/ai-chat-v2-ipc.ts`
- `src/service/agentTools/processArtifactBatchTool.ts`

### TODO P0-4: Route explicit selections above three to the batch choice

- [ ] When an explicit selection reaches four references, offer batch processing for independent edits instead of only showing `generated_image_reference_limit`.
- [ ] Permit explicit ordered selections up to the batch maximum of 50 in draft state.
- [ ] Reject fusion requests above three with `generated_image_fusion_limit` rather than routing them to independent batch edits.
- [ ] Show the selected item count and paid-work confirmation before execution.
- [ ] Add component tests for the fourth explicit selection, confirmation, decline, and fusion rejection paths.

Acceptance checks:

- Four to fifty explicit independent-edit references can enter the batch flow.
- One to three references remain on the direct request path.
- More than three fusion references never start a misleading independent batch.

## Priority 1: Required Product UX

### TODO P1-1: Add “Save to workspace” to generated-image actions

- [ ] Add a generated-image action that invokes `export_generated_artifacts` for explicit save/copy intent.
- [ ] Enable it when an approved workspace exists, or guide the user through workspace selection first.
- [ ] Keep saving separate from editing; editing must remain workspace-independent.
- [ ] Add accessible labels and translations in English, Chinese, Spanish, French, German, and Japanese.
- [ ] Add component and E2E coverage.

Relevant files:

- `src/views/components/aiChatV2/AiChatV2Message.vue`
- `src/views/components/aiChatV2/AiChatV2Messages.vue`
- `src/views/components/aiChatV2/AiChatV2.vue`
- `src/service/agentTools/exportGeneratedArtifactsTool.ts`
- `src/views/lang/{en,zh,es,fr,de,ja}.ts`

### TODO P1-2: Add a functional “Retry failed” batch action

- [ ] Render a translated Retry failed action for partial or cancelled generated-image batches.
- [ ] Reconstruct the retry input from failed and cancelled opaque references only.
- [ ] Do not reprocess successful items unless the user explicitly requests rerun-all.
- [ ] Preserve the shared instruction, detail level, and selected order.
- [ ] Add component and main-process tests proving only failed/cancelled references are resubmitted.

Acceptance checks:

- Successful outputs remain visible while retry runs.
- Retry input excludes every previously successful reference by default.
- Repeated partial retries retain deterministic input-to-output mappings.

### TODO P1-3: Make batch stop state explicit in the batch surface

- [ ] Add a Stop action to the evolving batch progress surface while work is active.
- [ ] Connect it to the active abort signal or batch job cancellation mechanism.
- [ ] Show queued, running, completed, failed, and cancelled counts while stopping.
- [ ] Verify completed outputs remain stored and queued items become cancelled.

### TODO P1-4: Complete the generated-image error model

- [ ] Add stable `image_edit_unavailable` handling for missing image-to-image model configuration.
- [ ] Add stable `image_edit_provider_failed` handling for provider rejection or failure.
- [ ] Map both codes through IPC/stream errors and renderer messages.
- [ ] Add translations in all six supported languages.
- [ ] Add tests that distinguish these errors from invalid references and local image failures.

## Priority 1: Attachment Tool Technical-Design Gaps

### TODO P1-5: Reject duplicate canonical workspace image paths

- [ ] Resolve and compare canonical paths after `FilePathGuard` validation.
- [ ] Reject or deterministically deduplicate aliases that resolve to the same file, including relative/absolute aliases and symlink aliases permitted by the guard.
- [ ] Preserve first-occurrence order for accepted unique files.
- [ ] Add service tests for canonical duplicates.

Relevant file: `src/service/AIImageAttachmentToolService.ts`.

### TODO P1-6: Close the late-cancellation artifact race

- [ ] Check `context.signal?.aborted` after normalization and immediately before returning `modelArtifacts`.
- [ ] Ensure a late normalizer completion cannot emit artifacts or start another AI-server request after cancellation.
- [ ] Add query-loop and service regression tests covering cancellation during the final normalization attempt.

### TODO P1-7: Add defensive artifact-summary logging

- [ ] Implement a `summarizeModelArtifacts()` helper that exposes counts, MIME types, dimensions, and sizes only.
- [ ] Route any artifact diagnostics through the summary helper.
- [ ] Add tests proving logs never include data URLs, base64, buffers, full artifacts, file contents, or credentials.

## Priority 2: Required Verification Coverage

### TODO P2-1: Complete generated-image component coverage

- [ ] Test the fourth explicit reference and batch choice.
- [ ] Test the Save to workspace action.
- [ ] Test active Stop and completed Retry failed actions.
- [ ] Test that retry excludes successful inputs.
- [ ] Keep coverage for ordering, removal, clear-all, ambiguity, conversation isolation, progress, partial failure, translated labels, and accessible names.

Run:

```bash
yarn test:components
```

### TODO P2-2: Complete attachment permission UI coverage

- [ ] Test a three-row file-transfer preview.
- [ ] Test long-path truncation without layout overlap.
- [ ] Test approval and denial actions.
- [ ] Test the metadata-only success card.
- [ ] Verify every `aiChatV2.imageTool` key resolves in all six languages.

### TODO P2-3: Add the missing generated-image E2E scenarios

- [ ] No-workspace lion-plus-dog edit returns an edited image.
- [ ] Two-image fusion preserves selected order in the provider request.
- [ ] Selecting an older image excludes the latest unselected image.
- [ ] A no-workspace generated-image batch shows progress and renders successful outputs.
- [ ] Cancelling a batch keeps completed outputs and cancels queued inputs.
- [ ] A forged cross-conversation reference fails without path disclosure.
- [ ] Workspace image editing still requires workspace approval.
- [ ] A completed batch output can be selected and edited in a later turn.

Run:

```bash
yarn test:e2e test/e2e/specs/ai-chat-generated-image-editing.test.ts
```

Environment note: the 2026-08-25 audit built the Electron E2E artifacts successfully, but Playwright could not start the Vite web server because the host reached its file-watcher limit (`ENOSPC`). Fix or raise the watcher limit before treating E2E verification as complete.

### TODO P2-4: Add the attachment-tool fake-server E2E flow

- [ ] Fake response 1 calls `glob_files`.
- [ ] Fake response 2 calls `attach_local_images`.
- [ ] Capture request 3 and assert a metadata-only tool message followed by a synthetic user multimodal handoff.
- [ ] Assert the handoff repeats the original request and contains at most three bounded image parts.
- [ ] Return generated image metadata and verify renderer persistence and display.
- [ ] Add permission-pause/resume and cancellation variants without duplicate requests.

### TODO P2-5: Verify the companion server contract

- [ ] Confirm attached data URLs become image-edit references.
- [ ] Confirm explicit edit intent activates image editing.
- [ ] Confirm multiple references preserve order.
- [ ] Confirm independent edits and fusion prompts route differently.
- [ ] Confirm streaming returns final image metadata.
- [ ] Confirm count and payload limits remain enforced.
- [ ] Confirm server logs never contain data URLs or image bytes.
- [ ] Record the server repository commit and test command used for verification.

## Final Completion Gate

- [ ] All Priority 0 items are complete.
- [ ] All Priority 1 product and technical-design items are complete.
- [ ] All required translations exist in the six supported languages.
- [ ] `yarn typecheck` passes.
- [ ] `yarn vue-typecheck` passes.
- [ ] `yarn testmain` passes.
- [ ] `yarn test:components` passes without feature-related warnings.
- [ ] Relevant server contract tests pass.
- [ ] All required Playwright scenarios pass.
- [ ] A fresh audit finds no unsatisfied PRD or technical-design requirement.
