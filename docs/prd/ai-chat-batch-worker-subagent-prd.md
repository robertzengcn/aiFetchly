# AI Chat Batch Worker Sub-Agent - Desktop App Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-06
- **Owner**: Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Primary Component**: AiChatV2, AgentRuntime
- **Related Documents**:
  - `docs/prd/ai-chat-llm-image-attachment-tool-prd.md` (the `attach_local_images` tool this builds on)
  - `docs/prd/ai-chat-llm-image-attachment-tool-technical-design.md`
  - `docs/openai-compatible-chat-v2-prd.md`
  - `aifetchserver/aifetchserver/services/edit_image_orchestrator.py` (server-side edit cap)

## Executive Summary

AiChatV2 exposes an LLM-callable `attach_local_images` tool that lets the model attach up to three local workspace images to the active AI request. The AI server edits each attachment independently and returns edited image artifacts. The server's three-image-per-request cap is a hard, reviewed limit; raising it would let one request trigger an unbounded number of provider image-edit calls and would require a coordinated server + desktop schema change.

When a user asks the assistant to edit more than three images (for example, "make the background of every image in this folder white"), the model currently attaches the first three, the server edits them, returns a terminal `finish_reason="stop"` response, and the chat turn ends. The remaining images are never processed. Instructing the model to "continue" within the same turn does not work because the server's edit orchestrator returns a final completion, not a tool result the model can react to.

This document specifies a **generic batch-worker sub-agent** that solves this class of problem without changing the server's three-image cap. The main agent discovers all candidate files with `glob_files`, splits them into batches of three, and spawns one `run_subagent` job per batch using a new built-in `agent-batch-worker` agent definition. Each sub-agent runs as a **separate AI request** with its own three-image budget, calls `attach_local_images` for its batch, and returns the output file paths of the edited results. The main agent polls each job with `check_tool_job_status`, collects all output file paths, and presents them to the user.

The design is deliberately **generic**. The batch worker is not an "image edit" agent; it is a file-batch processor whose allowlist includes the file-handling tools (`glob_files`, `attach_local_images`, `file_read`). When a future batch job type appears (for example, batch audio transcription, batch document conversion, batch thumbnail generation), the only change required is adding the new tool to the worker's allowlist. No new agent definition, no new runtime, no server change.

## Background

### The Three-Image Cap Is Per Request

The AI server enforces `chat_max_images_per_request = 3` (hard-locked at `le=3` in `aifetchserver/aifetchserver/core/config.py`) and `image_edit_max_outputs = 3` (`le=4`). The edit orchestrator (`aifetchserver/aifetchserver/services/edit_image_orchestrator.py`) edits each attachment independently (one provider call per attachment) up to `image_edit_max_outputs`. When the user attaches more than the cap, the orchestrator silently drops the surplus (`to_edit = attachments[:max_outputs]`).

The desktop mirrors this cap in `src/config/chatImageLimits.ts` (`maxImagesPerRequest: 3`) and in the `attach_local_images` tool schema (`maxItems: 3`).

### The Turn Ends After Editing

When the server's `EditImageOrchestrator.maybe_handle_edit_tool_call` detects that the model called the internal `aifetch_edit_image` tool, it runs the edit server-side and returns a **terminal** `ChatCompletion` with `finish_reason="stop"` and the edited images in response metadata. The model never receives a tool result to react to, so it cannot "continue" to the next batch within the same turn. The desktop's `AIChatQueryEngine` then stores the generated images and emits the `complete` event. The conversation is over from the model's perspective.

This is why the prior approach (telling the model in the tool description to "call attach_local_images again with the next batch") did not work: the server short-circuits the tool call into a final response, so there is no next tool round.

### Sub-Agents Are Separate Requests

`run_subagent` (`src/service/agentTools/runSubagentTool.ts`) spawns a specialist agent via `AgentRuntime.runSync` (`src/service/AgentRuntime.ts`). Critically, the sub-agent runtime uses the **same `AIChatQueryLoop`** as the main chat (`src/service/AIChatQueryLoop.ts`). This means:

- A sub-agent can call `attach_local_images` the same way the main agent does.
- The server injects `aifetch_edit_image` and runs the edit orchestrator the same way.
- Each sub-agent is a separate AI request with its own three-image budget, so there is no cap conflict.
- Sub-agents run asynchronously and return a `job_id`; the main agent polls with `check_tool_job_status`.

### The Gap: Sub-Agents Drop Edited Images

Today, `AgentRuntime.runSync` (around line 317 of `src/service/AgentRuntime.ts`) only captures `result.fullContent` (the model's text) when the loop completes. It does **not** capture `result.images` (the edited image artifacts returned by the loop). The `AgentResult` interface (`src/entityTypes/agentTypes.ts`) has no field for output file paths. Consequently, even if a sub-agent successfully edits three images, those edited images are dropped on the floor and never reach the main agent.

This is the single load-bearing fix that enables the entire approach.

## Problem Statement

Users reasonably expect the assistant to apply the same edit to every image in a folder ("make the background white", "add a watermark", "resize to 800x800"). The assistant can discover all candidate files with `glob_files`, but the three-image-per-request cap means only the first three are ever edited. The turn ends after the first batch, and the remaining images are silently ignored.

Manually instructing the model to continue does not work because the server returns a terminal completion after editing, not a tool result. Raising the cap was considered and rejected: it would let one request trigger an unbounded number of provider image-edit calls, require a coordinated server + desktop schema change, and break the per-request cost/abuse guardrail that the cap exists to enforce.

The product needs a way to process an arbitrary number of files in bounded batches, where each batch respects the three-image cap, batches run in parallel, and the main agent collects all output file paths without carrying image bytes through persisted tool-result JSON.

## Goals

1. Let the main agent process more than three images (and, generically, more than three files of any supported type) in a single user request by delegating batches to sub-agents.
2. Preserve the AI server's three-image-per-request cap without any server-side change.
3. Run batches in parallel so that N images complete in ~1x the time of one batch, not Nx sequential.
4. Return output file paths (not image bytes) from each sub-agent to the main agent so the main agent can report results without carrying large data through persisted JSON.
5. Make the batch-worker agent definition generic so that future batch job types (audio, documents, etc.) require only an allowlist addition, not a new agent or runtime.
6. Isolate failures: one bad batch does not fail the whole job; the main agent reports per-batch success/failure.
7. Reuse the existing `run_subagent` + `check_tool_job_status` async job infrastructure without a new execution path.
8. Require clear user consent before local image bytes are sent to the configured AI server (inherited from `attach_local_images`).
9. Provide complete translations for every new user-facing string.

## Non-Goals

1. Do not change the AI server's three-image-per-request cap or the `image_edit_max_outputs` limit.
2. Do not change the `attach_local_images` tool schema (`maxItems: 3`) or the desktop `CHAT_IMAGE_LIMITS.maxImagesPerRequest`.
3. Do not implement a new server-side batch endpoint or a server-side auto-batching loop.
4. Do not make the batch-worker agent image-specific. It must not hardcode image-edit logic, image MIME handling, or background-color keywords.
5. Do not bypass the existing `attach_local_images` permission flow; sub-agent calls to `attach_local_images` must still require user consent.
6. Do not stream sub-agent partial results to the renderer in v1. The main agent polls and reports final results.
7. Do not support nested sub-agents (a batch worker cannot spawn further batch workers).
8. Do not persist image bytes in `AgentResult` or tool-result JSON; only file paths and safe metadata are persisted.

## User Experience

### Primary Flow: Batch Edit a Folder of Images

1. User: "make the background of every image in the assets folder white."
2. The main agent calls `glob_files` to discover all candidate image paths (e.g., 9 images).
3. The main agent splits the 9 paths into 3 batches of 3.
4. The main agent calls `run_subagent` three times, once per batch, with:
   - `agentId: "agent-batch-worker"`
   - `prompt`: "Make the background of each attached image white."
   - `taskPacket`: `{ files: [batch of 3 paths], instruction: "make the background white" }`
5. Each `run_subagent` call returns `{ async: true, job_id }` within ~2 seconds.
6. The main agent tells the user: "I found 9 images and started 3 parallel batch workers. I'll report back as each finishes."
7. The main agent polls each `job_id` with `check_tool_job_status` every 15-30 seconds.
8. As each job completes, the main agent collects its `outputFilePaths` (the edited image file paths on disk).
9. When all jobs are done (or failed), the main agent presents a summary: "Edited 9 images across 3 batches. Results saved to: [paths]. 1 batch failed: [reason]."
10. The edited images are displayed in the chat as generated-image artifacts (same rendering path as today's single-batch edits).

### Failure UX

- If a batch worker fails (e.g., one image is corrupt, or the provider rejects an edit), that job's `status` is `failed` with an `errorMessage`. The main agent reports which batch failed and which succeeded. The user can retry the failed batch by asking the assistant to "retry the failed images."
- If the user cancels (stop button), all pending sub-agent jobs are cancelled via `cancel_tool_job`.

### Permission UX

- The first time a batch worker calls `attach_local_images`, the existing permission prompt fires (per-batch). The user sees: "Batch Worker wants to attach 3 images: [names]. Allow?" This is the same consent flow as today; no new permission category is introduced.
- In v1, each batch prompts separately. A future "allow for this whole request" toggle is a non-goal for v1.

## Tool Contract

### `run_subagent` (existing, no schema change)

The main agent uses the existing `run_subagent` tool. No new parameter is added. The only change is that the returned `result` object now includes `outputFilePaths` (see FR-1 below).

### `check_tool_job_status` (existing, no schema change)

The main agent polls with the existing `check_tool_job_status(job_id)` tool. The returned snapshot's `result` object now includes `outputFilePaths` when the batch worker produced files.

### `attach_local_images` (existing, description update only)

The `attach_local_images` tool schema does not change (`maxItems: 3` stays). Only the `description` field is updated to teach the main agent the batching delegation pattern:

> "HARD LIMIT: 3 images per call. When MORE than 3 files need the same edit, do NOT try to batch manually within one turn — the server ends the turn after editing. Instead, call `run_subagent` with `agentId: 'agent-batch-worker'` once per batch of up to 3 paths, passing the batch paths and the edit instruction in `taskPacket`. Poll each job with `check_tool_job_status`. Each batch worker handles the attach + edit and returns output file paths."

## Agent Definition: `agent-batch-worker`

A new built-in agent registered in `src/service/AgentDefinitionRegistry.ts` `BUILT_INS` array.

| Field | Value |
|---|---|
| `id` | `agent-batch-worker` |
| `name` | "Batch Worker" |
| `description` | "Processes a batch of up to 3 files (images, audio, documents) according to one instruction. Returns output file paths." |
| `version` | 1 |
| `systemPrompt` | (see System Prompt below) |
| `allowedTools` | `["glob_files", "attach_local_images", "file_read"]` |
| `mode` | `"specialist"` |
| `maxToolCalls` | 6 |
| `maxRuntimeMs` | 240000 |
| `maxContinueCalls` | 4 |
| `outputSchema` | (see Output Schema below) |
| `status` | `"active"` |
| `source` | `"built-in"` |
| `health` | `"healthy"` |

### System Prompt

```
You are the Batch Worker specialist.
Your single responsibility is to process a batch of up to 3 files according to the instruction in the task packet.

Rules:
1. Read the file paths and the instruction from the task packet.
2. Call attach_local_images with the given file paths (up to 3).
3. The AI server will edit each image independently and return edited results.
4. Do not ask questions. Do not deviate from the instruction.
5. Do not call run_subagent (nested batch workers are not allowed).
6. Your ENTIRE response MUST be a single raw JSON object matching the output schema — no markdown fences, no prose before or after.
7. If a file fails, set its path in errors with the reason and continue with the others.
8. If attach_local_images returns an error, report it in errors and return a partial result with an empty processedFiles list.
```

### Output Schema

```json
{
  "type": "object",
  "required": ["status", "processedFiles", "summary", "errors"],
  "properties": {
    "status": { "type": "string", "enum": ["completed", "partial", "failed"] },
    "processedFiles": {
      "type": "array",
      "items": { "type": "string" },
      "description": "File paths of successfully processed output files on disk."
    },
    "summary": { "type": "string", "description": "One-sentence summary of what was done." },
    "errors": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": { "file": { "type": "string" }, "reason": { "type": "string" } }
      }
    }
  }
}
```

### Task Packet Shape

The main agent passes a `taskPacket` to `run_subagent`. The batch worker expects:

```json
{
  "files": ["path1.jpg", "path2.jpg", "path3.jpg"],
  "instruction": "make the background white"
}
```

The `AgentPromptBuilder` (`src/service/AgentPromptBuilder.ts`) formats this into the user message the sub-agent sees. The `files` array is capped at 3 by the main agent before spawning.

## Functional Requirements

### FR-1: Plumb edited images through the sub-agent runtime (Phase 1 — the enabler)

**Priority**: P0 (blocks everything else).

1. `AgentRuntime.runSync` (`src/service/AgentRuntime.ts`): when `result.type === "completed"`, capture `result.images` (the `OpenAIChatImage[]` returned by `AIChatQueryLoop.run`).
2. Persist the captured images to disk using the existing `AIChatGeneratedImageStorageService` (or a lighter storage helper if the storage service is too main-chat-coupled). The storage service already produces `local_path` values for generated images.
3. Collect the `local_path` of each persisted image into `outputFilePaths: string[]`.
4. `AgentResult` (`src/entityTypes/agentTypes.ts`): add `outputFilePaths?: string[]` to the interface.
5. Populate `outputFilePaths` on the `AgentResult` returned by `runSync`.
6. `run_subagent` tool (`src/service/agentTools/runSubagentTool.ts`): include `outputFilePaths` in the `result` object returned to the main agent.
7. `check_tool_job_status`: the returned snapshot's `result` must also carry `outputFilePaths` (it reads from the persisted `AgentResult`, so this is automatic once FR-1.4 is done).

**Acceptance criteria**:
- AC-1.1: A sub-agent that calls `attach_local_images` and produces edited images returns those images' file paths in `AgentResult.outputFilePaths`.
- AC-1.2: The edited image bytes are NOT present in `AgentResult` (only file paths).
- AC-1.3: `run_subagent`'s returned `result` object includes `outputFilePaths` when non-empty.
- AC-1.4: `check_tool_job_status`'s returned snapshot includes `outputFilePaths` when the job produced files.
- AC-1.5: Existing sub-agents that do not produce images (e.g., `agent-lead-researcher`) are unaffected — `outputFilePaths` is `undefined`/empty for them.

### FR-2: Register the `agent-batch-worker` agent definition (Phase 2)

**Priority**: P0.

1. Add the `agent-batch-worker` entry to the `BUILT_INS` array in `src/service/AgentDefinitionRegistry.ts` with the fields specified in the "Agent Definition" section above.
2. Verify `AgentToolPolicyService` (`src/service/AgentToolPolicyService.ts`) intersects the allowlist with actually-registered skills at runtime, so `attach_local_images` is exposed to the batch worker.
3. Verify the mandatory infrastructure tools (`check_tool_job_status`, `cancel_tool_job`) are auto-injected by `AgentToolPolicyService` (they do not need to be declared in `allowedTools`).
4. Verify the batch worker appears in the available-agents block shown to the main model (so the main agent can discover `agent-batch-worker` by id).

**Acceptance criteria**:
- AC-2.1: `AgentDefinitionRegistryImpl.getById("agent-batch-worker")` returns the definition.
- AC-2.2: A `run_subagent` call with `agentId: "agent-batch-worker"` resolves and starts a sub-agent.
- AC-2.3: The sub-agent's exposed tool set includes `attach_local_images`, `glob_files`, `file_read`, `check_tool_job_status`, `cancel_tool_job`.
- AC-2.4: The sub-agent's system prompt and output schema match the PRD.
- AC-2.5: The batch worker appears in the available-agents block in the main agent's context.

### FR-3: Teach the main agent the delegation pattern (Phase 3)

**Priority**: P1.

1. Update the `attach_local_images` tool `description` in `src/config/skillsRegistry.ts` to include the delegation guidance quoted in the "Tool Contract" section.
2. Update the `run_subagent` tool `description` to mention batch file processing as a supported use case (without making it image-specific).

**Acceptance criteria**:
- AC-3.1: When the user asks to edit >3 images, the main agent calls `glob_files`, splits paths into batches of 3, and spawns one `run_subagent` per batch with `agentId: "agent-batch-worker"`.
- AC-3.2: The main agent does NOT attempt to call `attach_local_images` more than 3 times in one turn or to call `shell_execute` with Pillow/ImageMagick.
- AC-3.3: The main agent polls each batch job with `check_tool_job_status` until all are completed/failed.
- AC-3.4: The main agent reports a per-batch summary including output file paths and any failures.

### FR-4: Display batch-edited images in the chat

**Priority**: P1.

1. The main agent presents the collected `outputFilePaths` as generated-image artifacts in its final assistant message, using the same rendering path as today's single-batch edits.
2. The renderer (`AiChatV2Message.vue`) renders images from the batch workers' output file paths the same way it renders `metadata.generatedImages`.

**Acceptance criteria**:
- AC-4.1: After all batch jobs complete, the chat shows all edited images (across all batches) as rendered image artifacts.
- AC-4.2: Each image is clickable/downloadable the same way as today's generated images.

### FR-5: Failure isolation and retry

**Priority**: P1.

1. If a batch worker job fails, its `AgentResult.status` is `"failed"` with `errorMessage`; the main agent reports that batch's failure without aborting the other batches.
2. The user can ask the assistant to "retry the failed images"; the main agent spawns a new `run_subagent` job for just the failed batch's paths.

**Acceptance criteria**:
- AC-5.1: A failed batch does not prevent other batches from completing or reporting.
- AC-5.2: The main agent's final summary lists which batches succeeded and which failed with reasons.
- AC-5.3: A retry request spawns a new batch worker for only the previously-failed paths.

### FR-6: Cancellation

**Priority**: P1.

1. When the user clicks stop, the main agent calls `cancel_tool_job(job_id)` for each pending batch worker job.
2. Cancelled jobs return `AgentResult.status === "cancelled"`; the main agent reports which batches were cancelled.

**Acceptance criteria**:
- AC-6.1: Stop button cancels all pending batch worker jobs.
- AC-6.2: The main agent reports cancelled batches distinctly from failed ones.

### FR-7: Internationalization

**Priority**: P1.

1. Any new user-facing string introduced by this feature (e.g., batch progress messages, failure summaries) must be added to all six language files in `src/views/lang/` (en, zh, es, fr, de, ja).
2. English is the fallback; all other languages must have accurate translations.

**Acceptance criteria**:
- AC-7.1: All new user-facing strings exist in `en.ts` and the five other language files.
- AC-7.2: Switching languages shows translated batch messages.

## Architecture

### Data Flow

```
User: "edit all images in folder X"
        |
        v
Main Agent (AIChatQueryLoop)
  1. glob_files("X/*.{jpg,png,webp}")  -> 9 paths
  2. Split into batches: [p1,p2,p3], [p4,p5,p6], [p7,p8,p9]
  3. run_subagent(batch1) -> job_id_1  (async)
     run_subagent(batch2) -> job_id_2  (async)
     run_subagent(batch3) -> job_id_3  (async)
  4. check_tool_job_status(job_id_1) ... (poll loop)
        |
        v  (each sub-agent is a SEPARATE AI request)
Sub-Agent (AgentRuntime.runSync -> AIChatQueryLoop)
  1. attach_local_images([p1,p2,p3])  -> 3 images attached (own 3-image budget)
  2. Server injects aifetch_edit_image, model calls it
  3. Server edits each image independently, returns terminal completion
  4. AIChatQueryLoop.run returns result.images = [3 edited OpenAIChatImage]
  5. AgentRuntime captures result.images, persists to disk -> outputFilePaths
  6. AgentResult { status: "completed", outputFilePaths: [3 paths], output: {...} }
        |
        v
Main Agent (resume polling)
  - check_tool_job_status(job_id_1) -> { outputFilePaths: [3 paths] }
  - ... repeat for job_id_2, job_id_3
  - Collect all outputFilePaths (9 paths total)
  - Present summary + render 9 edited images in chat
```

### Key Files to Change

| Phase | File | Change |
|---|---|---|
| 1 | `src/service/AgentRuntime.ts` | Capture `result.images`, persist to disk, populate `outputFilePaths` |
| 1 | `src/entityTypes/agentTypes.ts` | Add `outputFilePaths?: string[]` to `AgentResult` |
| 1 | `src/service/agentTools/runSubagentTool.ts` | Include `outputFilePaths` in returned `result` |
| 2 | `src/service/AgentDefinitionRegistry.ts` | Add `agent-batch-worker` to `BUILT_INS` |
| 3 | `src/config/skillsRegistry.ts` | Update `attach_local_images` description with delegation guidance |
| 3 | `src/service/agentTools/runSubagentTool.ts` | Update `run_subagent` description (batch use case) |
| 4 | `src/views/components/aiChatV2/AiChatV2Message.vue` | Render batch worker output file paths as images |

### What Does NOT Change

- `src/config/chatImageLimits.ts` — `maxImagesPerRequest: 3` stays.
- `src/service/AIImageAttachmentToolService.ts` — the per-call 3-path cap stays.
- `aifetchserver/aifetchserver/core/config.py` — server caps stay.
- `aifetchserver/aifetchserver/services/edit_image_orchestrator.py` — server edit flow stays.
- `src/service/AIChatImageHandoff.ts` — the image handoff / strip logic stays (still useful for single-turn multi-round efficiency).

## Why This Design Over Alternatives

### Alternative A: Raise the 3-image cap (rejected)

Considered and reverted. Raising `chat_max_images_per_request` and `image_edit_max_outputs` to 10 would let one request trigger 10 provider image-edit API calls with no cost/abuse guardrail. It required a coordinated server + desktop schema change. It broke the per-request guardrail the cap exists to enforce.

### Alternative B: Server-side auto-batching (rejected)

The server could accept >3 images and internally batch them into groups of 3. This changes the public API request lifecycle (a 6-image request takes 2x as long), requires server changes, and doesn't parallelize. Rejected because the sub-agent approach parallelizes on the desktop without any server change.

### Alternative C: Desktop auto-continue within one turn (rejected)

After the first batch's turn ends, the desktop auto-sends a new user message to continue. This requires complex state tracking (which images were discovered, which were processed, what was the original instruction) and produces a confusing multi-message transcript. The sub-agent approach keeps the transcript clean: one user message, one main-agent orchestration, one final summary.

### Chosen: Generic batch-worker sub-agent

- No server change.
- 3-image cap preserved.
- Parallel execution (N images in ~1x time).
- Generic agent definition (future audio/doc batch jobs need only an allowlist addition).
- Failure isolation per batch.
- Reuses existing `run_subagent` + `check_tool_job_status` infrastructure.
- Main agent stays the orchestrator; sub-agents are dumb workers.

## Testing Strategy

### Unit Tests (Vitest, `test/vitest/main/`)

- `AgentRuntime.test.ts`: a sub-agent that produces `result.images` returns `outputFilePaths` populated; a sub-agent that produces no images returns `outputFilePaths` undefined/empty.
- `AgentDefinitionRegistry.test.ts`: `getById("agent-batch-worker")` returns the definition with the correct allowlist and output schema.
- `runSubagentTool.test.ts`: the returned `result` includes `outputFilePaths` when the agent produced files.

### Integration Tests

- A main-agent transcript where the model calls `glob_files` (9 paths) then `run_subagent` x3 with `agent-batch-worker`. Verify the final summary lists 9 output file paths and renders 9 images.
- A failure scenario: one batch worker fails; verify the other two batches' results are still reported.

### TypeScript Type-Check Gate

Per the project's Vitest config, `tsc --noEmit` runs at startup. All new fields (`outputFilePaths`) and the new agent definition must pass type-checking before tests run.

## Open Questions

1. **Storage service reuse**: Can `AIChatGeneratedImageStorageService` be reused from `AgentRuntime` (it may be coupled to main-chat conversation/message IDs), or do we need a lighter storage helper that writes to a batch-output directory? To be resolved in the technical-design doc.
2. **Permission batching**: In v1 each batch prompts for consent separately. Should we add a "allow all batches in this request" toggle in v2? Deferred.
3. **Output file location**: Where on disk do batch-edited images get persisted? Likely the same generated-images directory used by `AIChatGeneratedImageStorageService`, but scoped to the parent conversation. To be resolved in the technical-design doc.

## Milestones

- **M1 (Phase 1)**: Plumb `result.images` through `AgentRuntime` → `AgentResult.outputFilePaths` → `run_subagent` return. Validate with the existing `agent-lead-researcher` (no images) to ensure no regression, then a manual sub-agent image-edit test.
- **M2 (Phase 2)**: Register `agent-batch-worker`. Validate that a single `run_subagent` call with 3 images edits and returns file paths.
- **M3 (Phase 3)**: Update tool descriptions. Validate the end-to-end 9-image flow with 3 parallel batch workers.
- **M4 (Phases 4-7)**: Rendering, failure isolation, cancellation, i18n. Full E2E validation.
