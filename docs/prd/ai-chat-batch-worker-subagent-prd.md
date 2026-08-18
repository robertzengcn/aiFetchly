# AI Chat Concurrent Artifact Batch Processing - Desktop App Product Requirements Document

## Document Information

- **Version**: 2.0
- **Status**: Implemented
- **Created**: 2026-08-06
- **Revised**: 2026-08-10
- **Owner**: Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Primary Components**: AiChatV2, `process_artifact_batch`, `agent-batch-worker`, `export_generated_artifacts`
- **Related Documents**:
  - `docs/prd/ai-chat-llm-image-attachment-tool-prd.md`
  - `docs/prd/ai-chat-llm-image-attachment-tool-technical-design.md`
  - `docs/openai-compatible-chat-v2-prd.md`

## Executive Summary

Users need to apply one operation to every matching artifact in an approved workspace, for example: "make the background of every image white." The original design delegated groups of three images to separate `run_subagent` calls because the desktop attachment limit is three images per request.

Production evidence invalidated a key assumption in that design: the configured image-edit provider can accept multiple input attachments for context or analysis, but an edit request returns only one generated artifact. A three-input worker therefore completed with one output and lost the required one-input/one-result correspondence. The main model also started workers sequentially and later attempted to copy app-managed results with `shell_execute cp`; the shell safety policy correctly rejected access to the generated-artifact store under the Electron user-data directory.

Version 2 replaces model-managed three-file batching with one deterministic coordinator tool, `process_artifact_batch`. The main agent calls it once with all exact workspace paths and one instruction. The coordinator runs one isolated `agent-batch-worker` request per input, with bounded concurrency of up to three requests. This preserves provider request cardinality while avoiding sequential execution. It returns ordered per-input results, failures, generated-image metadata, and persisted output paths.

Generated artifacts remain in AiFetchly-managed storage for chat rendering. If the user wants persistent copies in the workspace, the agent calls the generic `export_generated_artifacts` tool. That tool performs validated application-level copies and never delegates file movement to a shell command.

## Architecture Correction and Preserved History

### Version 1 assumption

The first design made the following reasonable but incorrect inference:

1. `attach_local_images` accepts up to three images.
2. The server has a three-image request cap.
3. Therefore, one edit request with three attachments would return three edited artifacts.

It proposed splitting N files into groups of three and invoking `run_subagent` once per group. The intended benefits remain valid: keep server caps, isolate work, reuse `AgentRuntime`, preserve generated artifacts, and avoid image bytes in persisted tool-result JSON.

### Production evidence

The observed chat trace on 2026-08-10 showed:

- `glob_files` correctly discovered the workspace images.
- The main agent invoked `agent-batch-worker` with three files.
- Each worker completed with the business summary "Generated 1 image."
- The main agent issued worker calls serially rather than concurrently.
- After generation, the model attempted `shell_execute` with `cp` from `~/.config/aiFetchly/ai-chat-generated-images/...`.
- The shell safety layer returned `permission_code: "CRITICAL_PATH"`, as designed.

The failure was therefore not sub-agent discovery. It was a mismatch between attachment capacity and edit-output cardinality, followed by use of the wrong primitive for artifact export.

### Corrected invariant

For the current `image_edit` processor:

> One input file is processed by one isolated provider request. Multiple inputs are parallelized by the desktop coordinator, never combined into one edit request.

The three-image attachment limit remains useful for multi-image analysis. It must not be interpreted as a promise of three independent edited outputs.

## Problem Statement

The product must reliably process every selected workspace artifact while meeting five constraints:

1. The current provider may return only one generated result per edit request.
2. The main model cannot be trusted to schedule multiple tool calls concurrently or maintain exact input/output mappings across them.
3. Provider calls must be bounded to control cost, rate pressure, and resource use.
4. Generated artifacts live in protected application storage and must not be copied through unrestricted shell commands.
5. One failure must not discard successful results from other inputs.

## Goals

1. Process 1-50 workspace files in one tool invocation.
2. Run one isolated provider operation per input for image edits.
3. Execute up to three item operations concurrently, configurable from one to three.
4. Preserve stable, ordered input-to-output mappings, including one-to-many outputs if a future provider supports them.
5. Reuse `AgentRuntime`, `AIChatQueryLoop`, `agent-batch-worker`, and generated-image storage.
6. Collect generated images through the existing chat artifact path so successful results render automatically.
7. Report completed, failed, and cancelled items independently.
8. Use one outer permission decision for the exact batch of files sent to the AI server.
9. Export generated artifacts safely into the approved workspace without `shell_execute`.
10. Keep names and contracts generic enough to support future artifact kinds and processors.

## Non-Goals

1. Do not raise the server or desktop image attachment limits.
2. Do not add a server-side batch endpoint.
3. Do not promise that multiple edit attachments yield multiple edited outputs.
4. Do not allow nested batch orchestration inside `agent-batch-worker`.
5. Do not place generated image bytes in persisted `AgentResult` or normal tool-result JSON.
6. Do not allow artifact export to arbitrary absolute paths or outside the approved workspace.
7. Do not weaken the shell safety policy for `~/.config`, Electron user data, or other critical paths.
8. Do not require one worker process per file. These are bounded concurrent async agent runs within the existing runtime, not new operating-system child processes.
9. Version 2 supports the `image_edit` processor. Other processors require an explicit implementation and allowlist update.

## User Experience

### Primary flow

1. User: "Make the background of every image in this workspace white."
2. Main agent calls `glob_files` and identifies the exact candidate image paths.
3. Main agent calls `process_artifact_batch` once with all paths, the shared instruction, processor `image_edit`, and optional concurrency/detail settings.
4. The user approves one permission preview listing the files that will be sent to the configured AI server.
5. The coordinator starts up to three isolated one-file agent runs and starts the next item whenever a slot is free.
6. Each successful item returns its generated artifacts and app-managed local paths.
7. The chat renders all collected generated images and reports an aggregate result plus per-file failures.
8. If the user asked to save results in the workspace, the agent calls `export_generated_artifacts` with the returned artifact URLs and workspace-relative destinations.

### Example outcome

For nine input images with concurrency three, the system performs nine provider edit requests in three scheduling waves. This is materially faster than nine sequential workers while preserving the one-input-per-request invariant.

### Partial failure UX

- If seven of nine items succeed, the batch status is `partial`; all seven outputs remain available.
- Every item includes its input path, status, duration, output paths/images, task ID when available, and an error or storage warning when applicable.
- A retry should pass only failed input paths to a new `process_artifact_batch` call.
- Cancellation marks unstarted items cancelled and propagates the abort signal to active agent runs.

### Export UX

- Chat rendering does not require export. Generated artifacts remain addressable through `aifetchly-generated-image://` URLs.
- Export requires a separate permission because it writes into the workspace.
- Default destination: `generated-artifacts/<source filename>`.
- Default collision behavior: rename, for example `image-1.png`, without overwriting existing work.
- The user or agent may explicitly choose `fail` or `overwrite`.

## Tool Contract: `process_artifact_batch`

### Purpose

Coordinate a bounded concurrent operation across exact workspace files while keeping one isolated agent/provider request per item.

### Input

```json
{
  "files": ["images/a.jpg", "images/b.jpg", "images/c.jpg"],
  "instruction": "replace the background with solid white",
  "processor": "image_edit",
  "concurrency": 3,
  "detail": "auto"
}
```

### Validation

- `files`: 1-50 non-empty paths; duplicates are removed while preserving order.
- `instruction`: required non-empty string.
- `processor`: currently only `image_edit`.
- `concurrency`: integer 1-3; default 3.
- `detail`: `auto`, `low`, or `high`; default `auto`.
- An approved conversation workspace is required.

### Output

```json
{
  "status": "completed",
  "processor": "image_edit",
  "requestedCount": 3,
  "completedCount": 3,
  "failedCount": 0,
  "cancelledCount": 0,
  "concurrency": 3,
  "items": [
    {
      "input": "images/a.jpg",
      "status": "completed",
      "agentTaskId": "agt-...",
      "outputFilePaths": ["/app-managed/path/image-1.png"],
      "outputImages": [{ "type": "image", "delivery": "local_file" }],
      "durationMs": 42000
    }
  ],
  "outputFilePaths": ["/app-managed/path/image-1.png"],
  "outputImages": [{ "type": "image", "delivery": "local_file" }]
}
```

`items` is the source of truth for input/output correspondence. The flattened output arrays support existing chat artifact harvesting and backward-compatible summaries.

### Execution semantics

1. Resolve and freeze the approved workspace root for the operation.
2. Create at most `min(concurrency, fileCount)` async runners.
3. Assign each runner the next unclaimed input index.
4. Run `agent-batch-worker` with exactly that file and instruction.
5. Override its attachment call so it can attach only the coordinator-approved exact path; model path substitution is not accepted.
6. Store each result at its original index.
7. Flatten successful output paths and images after all runners settle.
8. Return `completed`, `partial`, `failed`, or `cancelled` from aggregate counts.

## Agent Definition: `agent-batch-worker`

`agent-batch-worker` remains a generic specialist, but its unit of work is now exactly one artifact.

| Field          | Value                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `id`           | `agent-batch-worker`                                                                               |
| `name`         | Batch Worker                                                                                       |
| `description`  | Processes one artifact according to one instruction; multi-file jobs use `process_artifact_batch`. |
| `mode`         | `specialist`                                                                                       |
| `allowedTools` | File inspection plus `attach_local_images`; no `run_subagent`                                      |
| `maxRuntimeMs` | 240000                                                                                             |
| `source`       | `built-in`                                                                                         |
| `status`       | `active`                                                                                           |

### Worker rules

1. Read exactly one file path and one instruction from the task packet.
2. Use `attach_local_images` for that exact file.
3. Do not create or schedule additional workers.
4. Do not batch multiple edit inputs.
5. Return structured status and errors; generated artifact metadata is captured by `AgentRuntime` even if the provider supplies little or no useful text.

Direct `run_subagent` remains supported for a single specialized file task. Its `taskPacket.files` schema is capped at one. Multi-file work must use `process_artifact_batch`.

## Tool Contract: `export_generated_artifacts`

### Purpose

Safely materialize AiFetchly-generated artifacts inside the approved workspace. The name is intentionally not image-specific so future generated audio, documents, archives, or other artifact protocols can use the same export abstraction.

### Current source support

Version 2 accepts `aifetchly-generated-image://` URLs. Supporting another artifact type requires adding its trusted protocol resolver and ownership validation; it does not require renaming the tool.

### Input

```json
{
  "artifacts": [
    {
      "artifactUrl": "aifetchly-generated-image://local/user/conversation/message/image-1.png",
      "destination": "edited/a-white.png"
    }
  ],
  "collisionPolicy": "rename"
}
```

### Validation and safety

1. Accept 1-50 artifact entries.
2. Resolve sources only through a registered app-managed protocol resolver.
3. Verify every source is contained in the current user's generated-artifact root.
4. Require a regular, non-symlink source file.
5. Require workspace-relative destinations; reject absolute paths and traversal.
6. Validate the destination using `FilePathGuard`.
7. Resolve the deepest existing destination ancestor before directory creation and reject symlink escapes.
8. Revalidate containment after creating destination directories.
9. Copy with exclusive creation unless `overwrite` is explicitly selected.
10. Return per-item mappings and failures; never invoke a shell.

### Output

The result includes aggregate counts, collision policy, and ordered items with `artifactUrl`, requested destination, actual destination, status, rename flag, and error when applicable.

## Functional Requirements

### FR-1: Preserve generated artifacts from agent runs

- `AgentRuntime` captures generated images returned by `AIChatQueryLoop`.
- Generated files are persisted in AiFetchly-managed storage.
- `AgentResult` carries `outputFilePaths`, `outputImages`, and storage warnings without embedding image bytes in ordinary persisted JSON.
- Missing or malformed worker text must not hide successfully generated artifacts.

### FR-2: Coordinate bounded concurrent item runs

- One `process_artifact_batch` call accepts all exact paths.
- Image editing performs one isolated agent/provider request per input.
- The default and maximum concurrency is three.
- Results remain ordered by input regardless of completion order.
- A failed item does not stop other runners.

### FR-3: Enforce tool selection

- Tool catalog and contextual loading expose `process_artifact_batch` for multi-file transformation intent.
- `attach_local_images` instructs the model to attach exactly one edit input or use the batch tool for two or more edits. Multi-image analysis may still use up to three attachments.
- `run_subagent` instructs the model that its batch-worker task packet contains exactly one file.
- If generated images exist and the model proposes shell-based copying, `AIChatQueryLoop` returns a deterministic tool error steering it to `export_generated_artifacts` without executing the shell tool.

### FR-4: Render complete and partial output sets

- `process_artifact_batch.outputImages` flows through the existing `AIChatQueryLoop` artifact collector.
- Successful generated artifacts appear in assistant response metadata and render through the existing generated-image UI.
- Partial success preserves every successful image and reports failed inputs.

### FR-5: Cancellation and observability

- The outer abort signal propagates into active `AgentRuntime` calls.
- Unstarted inputs are marked cancelled.
- Every item records duration and, where available, `agentTaskId` and storage warning.
- Aggregate status distinguishes completed, partial, failed, and cancelled.

### FR-6: Safe generic export

- Workspace export is implemented by `export_generated_artifacts`, not `shell_execute`.
- Export is limited to artifacts owned by the current AiFetchly user.
- Destination containment remains valid across symlinks and newly created directories.
- Collision behavior is explicit and observable.

### FR-7: Permissions and internationalization

- Batch processing displays one permission preview for the exact input list and configured AI destination.
- Artifact export displays a distinct permission preview for copying generated artifacts into the approved workspace.
- Export permission strings exist in English, Chinese, Spanish, French, German, and Japanese.

## Data Flow

```text
User request
    |
    v
Main Agent --glob_files--> exact workspace paths
    |
    v
process_artifact_batch(files, instruction, concurrency <= 3)
    |
    +--> runner 1 --> agent-batch-worker(file A) --> provider request A --> outputs A
    +--> runner 2 --> agent-batch-worker(file B) --> provider request B --> outputs B
    +--> runner 3 --> agent-batch-worker(file C) --> provider request C --> outputs C
    |        runners claim remaining files as slots become available
    v
ordered per-input result + flattened generated artifacts
    |
    +--> existing chat artifact collector --> renderer
    |
    `--> export_generated_artifacts (only when workspace copies are requested)
              |
              `--> validated application copy into approved workspace
```

## Implementation Map

| File                                                     | Responsibility                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/service/agentTools/processArtifactBatchTool.ts`     | Argument validation, permission preview, bounded scheduler, exact-path worker execution, aggregate results |
| `src/service/AgentDefinitionRegistry.ts`                 | Single-artifact `agent-batch-worker` definition                                                            |
| `src/service/AgentRuntime.ts`                            | Abort propagation and generated-artifact capture                                                           |
| `src/entityTypes/agentTypes.ts`                          | Agent output path/image/storage-warning contracts and one-file task packet                                 |
| `src/service/agentTools/runSubagentTool.ts`              | Single-file worker schema and guidance                                                                     |
| `src/config/skillsRegistry.ts`                           | Registers tools and distinguishes single edit from multi-file processing                                   |
| `src/service/ToolLoadPolicyService.ts`                   | Contextually promotes batch processing and generic export tools                                            |
| `src/service/ToolCatalogService.ts`                      | Search aliases and recovery hints for both tools                                                           |
| `src/service/AIChatQueryLoop.ts`                         | Harvests output images and blocks shell transfer of app-managed artifacts                                  |
| `src/service/agentTools/exportGeneratedArtifactsTool.ts` | Owned-source resolution and safe workspace export                                                          |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts`                  | Export permission translations                                                                             |

## What Does Not Change

- `CHAT_IMAGE_LIMITS.maxImagesPerRequest` remains three.
- `attach_local_images` retains its existing attachment cap and preparation pipeline.
- Server request and output limits remain unchanged.
- Generated artifact storage remains under application management.
- The shell safety policy continues to classify the app configuration/generated-image root as critical.
- Existing non-image sub-agents remain supported.

## Alternatives Considered

### Raise provider/server limits — rejected

This weakens cost and abuse guardrails, requires coordinated API changes, and still does not guarantee one output per attached input.

### Three images per worker — superseded

This was the original Version 1 choice. It minimizes request count only if the provider guarantees independent outputs for each attachment. Production showed one output, so it cannot meet completeness or mapping requirements.

### One model-scheduled worker call per file — rejected

Correct cardinality but poor latency: tool calls in the main reasoning loop are commonly emitted and executed sequentially. It also asks the model to manage scheduling, polling, mappings, and retry state.

### One operating-system worker per file — rejected

Process startup and resource overhead are unnecessary. The work is remote/API-bound and fits bounded async concurrency within the existing agent runtime.

### Server-side auto-batching — deferred

It could centralize provider scheduling but changes API lifecycle, cancellation, and capacity semantics. Desktop coordination solves the current requirement without a server change.

### Allow shell `cp` from generated storage — rejected

It would weaken a correct critical-path control and expose path parsing, quoting, ownership, traversal, and symlink risks. A typed application tool has a narrower authority boundary and auditable item mappings.

## Acceptance Criteria

1. A request for two or more image edits selects `process_artifact_batch`, not repeated direct attachments or a multi-file batch-worker task packet.
2. For N inputs, the coordinator starts N isolated item runs and never exceeds the requested concurrency or three active runs.
3. Each item run attaches only its coordinator-approved input path.
4. N successful single-output edits return N completed input mappings and N rendered generated artifacts.
5. Completion order does not change result order.
6. One failure produces `partial` when another item succeeds and preserves successful artifacts.
7. Cancellation reaches active agent runs and marks remaining items cancelled.
8. A batch can contain at most 50 unique inputs.
9. Generated-artifact shell copy attempts are not executed and direct the model to `export_generated_artifacts`.
10. Export rejects unowned sources, absolute/traversal destinations, source symlinks, and destination symlink escapes.
11. Rename collision mode preserves the existing file; overwrite occurs only when explicitly requested and permitted.
12. No image bytes are persisted in normal tool-result history.
13. All new user-facing export permission strings exist in all six supported languages.
14. Existing single-image editing and multi-image analysis continue to work.

## Testing Strategy

### Automated tests

- `processArtifactBatchTool.test.ts`
  - argument limits and defaults
  - bounded concurrency
  - stable input ordering
  - exact one-file worker calls
  - partial failures and cancellation
  - flattened output paths/images
- `exportGeneratedArtifactsTool.test.ts`
  - owned protocol source export
  - rename, fail, and overwrite behavior
  - rejection of other-user sources
  - rejection of absolute/traversal destinations
  - rejection of nested symlink escapes
  - fail-closed behavior without an approved workspace
  - permission/schema contract
- `AIChatQueryLoop.imageArtifacts.test.ts`
  - artifact handoff and renderer-safe events
  - deterministic block of shell copying after generated output
- `AgentRuntime.test.ts`, `runSubagentTool.test.ts`, and registry/policy tests
  - artifact propagation
  - abort propagation
  - one-file task packet contract
  - tool discovery and contextual promotion

### Manual end-to-end validation

1. Use an approved workspace containing at least six visually distinct images.
2. Ask to change every background to white.
3. Confirm one batch permission prompt and no more than three concurrent requests.
4. Verify every input has a corresponding result or explicit error.
5. Verify successful outputs render in chat.
6. Ask to export them to a relative workspace folder.
7. Confirm files exist there and no `shell_execute cp` call occurs.
8. Repeat with an existing destination filename and verify rename behavior.
9. Cancel a running batch and verify active/unstarted item status.

## Rollout and Monitoring

1. Ship the coordinator and export tools together so generated results never require shell fallback.
2. Log aggregate requested/completed/failed/cancelled counts and per-item duration without logging image bytes.
3. Monitor provider latency, partial-result rate, cancellation rate, and storage warnings.
4. If rate limits increase, lower default concurrency through the tool contract while retaining the one-input invariant.
5. Add future processors only after documenting their input/output cardinality and safe artifact protocol.

## Resolved Questions

1. **How many files per worker request?** Exactly one for `image_edit`.
2. **How is batch latency controlled?** A deterministic coordinator with default/max concurrency three.
3. **Who owns scheduling?** Application code, not the main model.
4. **Where are outputs stored?** AiFetchly-generated artifact storage, with paths and metadata returned by `AgentRuntime`.
5. **How are workspace copies created?** `export_generated_artifacts` performs validated application-level copies.
6. **Why is the export tool generic?** The authority is "export a trusted app-managed artifact," independent of the artifact media type.
7. **Does the three-image limit remain?** Yes, for attachment/analysis compatibility; it is not used as edit batch cardinality.

## Future Work

- Add trusted protocol resolvers for generated audio, documents, and archives.
- Add processor registrations with explicit cardinality and concurrency policies.
- Surface live per-item progress in the renderer without persisting binary data.
- Add provider-aware adaptive concurrency and backoff.
- Add targeted retry controls in the UI for failed items.
