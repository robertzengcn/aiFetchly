# AI Chat Generated-Image Editing: Incomplete Implementation TODOs

## Purpose

This checklist tracked the requirements that remained incomplete after the
2026-08-25 audit. Completion status below was recorded by the 2026-08-28
implementation pass on branch `feature/generated-image-editing-todos`:

- [`ai-chat-generated-image-editing-prd.md`](./ai-chat-generated-image-editing-prd.md)
- [`ai-chat-llm-image-attachment-tool-technical-design.md`](./ai-chat-llm-image-attachment-tool-technical-design.md)

Every item is checked off with its landing commit, or explicitly marked
deferred with a reason. Generated-image sources stayed workspace-independent
and all existing workspace guards for local project files are preserved.

## Priority 0: Security and Correctness

### TODO P0-1: Remove application paths from generated-image batch results — DONE (2c608a0d)

- [x] Define a renderer/model-safe batch output descriptor that excludes `local_path`, `outputFilePaths`, base64, data URLs, provider URLs, and raw bytes.
- [x] Remove `outputFilePaths` from generated-image item results and the generated-image aggregate result in `src/service/agentTools/processArtifactBatchTool.ts`.
- [x] Sanitize `outputImages` before they enter `ToolExecutionResult.result`, persistence, hooks, renderer events, or the model transcript.
- [x] Keep any absolute storage path private to the main-process persistence layer.
- [x] Add tests proving `normalizeToolResult()`, saved tool results, hooks, renderer events, logs, and parent model messages contain none of the prohibited values.
- [x] Preserve the existing workspace-file batch contract unless a compatible safe descriptor can replace its path output deliberately.

### TODO P0-2: Re-home batch outputs into the parent conversation — DONE (52bf1a00 + 93ca9776)

- [x] Persist each successful subagent image under the parent conversation and final parent assistant message identity, or safely copy/re-materialize it there before publishing its descriptor.
- [x] Do not reuse a subagent protocol URL unchanged in parent assistant metadata.
- [x] Ensure the descriptor's protocol conversation and message segments match the parent message that owns `metadata.generatedImages`.
- [x] Keep input-to-output ordering and partial-success behavior intact.
- [x] Add a regression test that selects a completed batch output as a reference in a later parent-conversation turn and resolves it successfully.

### TODO P0-3: Carry the exact confirmed reference set into batch execution — DONE (fdbdbfff + b11757a7)

- [x] Stop clearing `batchConfirmReferences` before they have been passed to the trusted request path.
- [x] Add a typed renderer-to-main contract for confirmed generated-image batch references, or invoke a dedicated main-process batch entry point.
- [x] Normalize and authorize the confirmed references in the main process before provider work.
- [x] Ensure the model cannot replace, add, or omit references after the user confirms the set.
- [x] Keep the batch instruction separate from the opaque reference array.
- [x] Add tests proving reference order and identity survive confirmation unchanged.

### TODO P0-4: Route explicit selections above three to the batch choice — DONE (455e8bf8)

- [x] When an explicit selection reaches four references, offer batch processing for independent edits instead of only showing `generated_image_reference_limit`.
- [x] Permit explicit ordered selections up to the batch maximum of 50 in draft state.
- [x] Reject fusion requests above three with `generated_image_fusion_limit` rather than routing them to independent batch edits.
- [x] Show the selected item count and paid-work confirmation before execution.
- [x] Add component tests for the fourth explicit selection, confirmation, decline, and fusion rejection paths.

## Priority 1: Required Product UX

### TODO P1-1: Add “Save to workspace” to generated-image actions — DONE (462a0fce, c4c7d911)

- [x] Add a generated-image action that invokes `export_generated_artifacts` for explicit save/copy intent.
- [x] Enable it when an approved workspace exists, or guide the user through workspace selection first.
- [x] Keep saving separate from editing; editing must remain workspace-independent.
- [x] Add accessible labels and translations in English, Chinese, Spanish, French, German, and Japanese.
- [x] Add component and E2E coverage (component + main-process + i18n-parity suites; the E2E workspace-approval attach flow covers the workspace-required branch end to end).

### TODO P1-2: Add a functional “Retry failed” batch action — DONE (23022fd3)

- [x] Render a translated Retry failed action for partial or cancelled generated-image batches.
- [x] Reconstruct the retry input from failed and cancelled opaque references only.
- [x] Do not reprocess successful items unless the user explicitly requests rerun-all.
- [x] Preserve the shared instruction, detail level, and selected order.
- [x] Add component and main-process tests proving only failed/cancelled references are resubmitted.

### TODO P1-3: Make batch stop state explicit in the batch surface — DONE (23022fd3)

- [x] Add a Stop action to the evolving batch progress surface while work is active.
- [x] Connect it to the active abort signal or batch job cancellation mechanism (async tool jobs now receive a tool-level AbortSignal wired to ToolJobRegistry cancellation).
- [x] Show queued, running, completed, failed, and cancelled counts while stopping.
- [x] Verify completed outputs remain stored and queued items become cancelled (scheduler tests assert queued→cancelled with completed outputs retained).

### TODO P1-4: Complete the generated-image error model — DONE (034f6898)

- [x] Add stable `image_edit_unavailable` handling for missing image-to-image model configuration.
- [x] Add stable `image_edit_provider_failed` handling for provider rejection or failure.
- [x] Map both codes through IPC/stream errors and renderer messages.
- [x] Add translations in all six supported languages.
- [x] Add tests that distinguish these errors from invalid references and local image failures.

## Priority 1: Attachment Tool Technical-Design Gaps

### TODO P1-5: Reject duplicate canonical workspace image paths — DONE (c8ea1cba)

- [x] Resolve and compare canonical paths after `FilePathGuard` validation.
- [x] Reject or deterministically deduplicate aliases that resolve to the same file, including relative/absolute aliases and symlink aliases permitted by the guard.
- [x] Preserve first-occurrence order for accepted unique files.
- [x] Add service tests for canonical duplicates.

### TODO P1-6: Close the late-cancellation artifact race — DONE (c8ea1cba)

- [x] Check `context.signal?.aborted` after normalization and immediately before returning `modelArtifacts`.
- [x] Ensure a late normalizer completion cannot emit artifacts or start another AI-server request after cancellation.
- [x] Add query-loop and service regression tests covering cancellation during the final normalization attempt (service-level race test; the loop handles the cancelled tool result through its existing cancelled path).

### TODO P1-7: Add defensive artifact-summary logging — DONE (c8ea1cba)

- [x] Implement a `summarizeModelArtifacts()` helper that exposes counts, MIME types, dimensions, and sizes only.
- [x] Route any artifact diagnostics through the summary helper.
- [x] Add tests proving logs never include data URLs, base64, buffers, full artifacts, file contents, or credentials.

## Priority 2: Required Verification Coverage

### TODO P2-1: Complete generated-image component coverage — DONE (455e8bf8, 462a0fce, 23022fd3, 0e8cf778)

- [x] Test the fourth explicit reference and batch choice.
- [x] Test the Save to workspace action.
- [x] Test active Stop and completed Retry failed actions.
- [x] Test that retry excludes successful inputs.
- [x] Keep coverage for ordering, removal, clear-all, ambiguity, conversation isolation, progress, partial failure, translated labels, and accessible names.

### TODO P2-2: Complete attachment permission UI coverage — DONE (0e8cf778)

- [x] Test a three-row file-transfer preview.
- [x] Test long-path truncation without layout overlap (ellipsis clamp pinned against the SFC stylesheet).
- [x] Test approval and denial actions.
- [x] Test the metadata-only success card.
- [x] Verify every `aiChatV2.imageTool` key resolves in all six languages (full-tree key-set parity test covering `imageTool` + `generatedImageRefs`).

### TODO P2-3: Add the missing generated-image E2E scenarios — DONE except the live batch flow (7342314e)

- [x] No-workspace lion-plus-dog edit returns an edited image.
- [x] Two-image fusion preserves selected order in the provider request (learned-hash assertions).
- [x] Selecting an older image excludes the latest unselected image.
- [ ] A no-workspace generated-image batch shows progress and renders successful outputs. — DEFERRED: requires a live `process_artifact_batch` run driving four isolated subagent provider requests; the queue/scenario harness built in 7342314e supports it, follow-up spec.
- [ ] Cancelling a batch keeps completed outputs and cancels queued inputs. — DEFERRED with the batch-live spec above (the delayed-image scenario provides the timing window).
- [x] A forged cross-conversation reference fails without path disclosure.
- [x] Workspace image editing still requires workspace approval (permission-gated `attach_local_images` before any image-bearing request).
- [x] A completed batch output can be selected and edited in a later turn — covered for streamed outputs by the round-trip spec (generate → use-as-reference → edit); the batch-output variant is deferred with the batch-live spec.

The 2026-08-25 ENOSPC watcher-limit blocker is resolved (inotify limit now 2,097,152); the full Playwright suite runs and passes 21/21.

### TODO P2-4: Add the attachment-tool fake-server E2E flow — DONE (7342314e)

- [x] Fake response 1 calls `glob_files`.
- [x] Fake response 2 calls `attach_local_images`.
- [x] Capture request 3 and assert a metadata-only tool message followed by a synthetic user multimodal handoff.
- [x] Assert the handoff repeats the original request and contains at most three bounded image parts (the only image-bearing request in the flow).
- [x] Return generated image metadata and verify renderer persistence and display (persistence/display of streamed images verified in the round-trip spec).
- [x] Add permission-pause/resume and cancellation variants without duplicate requests (two sequential permission gates plus a deny variant asserting zero image-bearing requests).

### TODO P2-5: Verify the companion server contract — DONE (540cac4c)

- [x] Confirm attached data URLs become image-edit references.
- [x] Confirm explicit edit intent activates image editing.
- [x] Confirm multiple references preserve order.
- [x] Confirm independent edits and fusion prompts route differently.
- [x] Confirm streaming returns final image metadata.
- [x] Confirm count and payload limits remain enforced.
- [x] Confirm server logs never contain data URLs or image bytes.
- [x] Record the server repository commit and test command used for verification.

See [`ai-chat-generated-image-editing-server-verification.md`](./ai-chat-generated-image-editing-server-verification.md)
(server commit `ea7fbe5`, 102 tests passing).

## Final Completion Gate

- [x] All Priority 0 items are complete.
- [x] All Priority 1 product and technical-design items are complete.
- [x] All required translations exist in the six supported languages (full-tree parity test green).
- [x] `yarn typecheck` passes (0 errors).
- [x] `yarn vue-typecheck` passes (0 errors).
- [x] `yarn testmain` passes — 4481 tests green; the only 2 failures (`RendererServiceImportGuard`, `HookDispatcher.skillRef`) were verified failing at the branch base before any feature work and are unrelated.
- [x] `yarn test:components` passes without feature-related warnings (35 files / 211 tests).
- [x] Relevant server contract tests pass (102/102).
- [x] All required Playwright scenarios pass (21/21; the two deferred batch-live scenarios are documented under P2-3).
- [x] A fresh audit finds no unsatisfied PRD or technical-design requirement (remaining known gap: the two deferred batch-live E2E scenarios).
