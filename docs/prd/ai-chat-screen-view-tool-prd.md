# AI Chat Screen View Tool - Desktop App Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-04
- **Owner**: Desktop Engineering
- **Product**: AiFetchly Electron desktop application
- **Primary Component**: AiChatV2
- **Companion Document**: None. This feature reuses the existing OpenAI-compatible `image_url` multimodal contract and adds no new server endpoint, so no companion server PRD is required.
- **Related Documents**:
  - `docs/prd/ai-chat-llm-image-attachment-tool-prd.md` — established the transient `modelArtifacts` image channel that this tool reuses.
  - `docs/prd/ai-chat-llm-image-attachment-tool-technical-design.md`
  - `docs/openai-compatible-chat-v2-prd.md`
  - `docs/ai-chat-tool-approval-modes-prd.md`

## Executive Summary

AiChatV2's assistant can read workspace files and attach workspace images, but it cannot see anything that exists only on the user's display: a live application window, an error dialog, a web page, a spreadsheet, or another application. Today the only workaround is for the user to manually take a screenshot, save it into the approved workspace, and ask the assistant to call `attach_local_images`. That friction defeats the natural request "just look at my screen."

The desktop app will add an LLM-callable built-in tool named `view_screen`. The tool captures a single on-demand screenshot of a screen or application window that the **user explicitly chooses**, and delivers that screenshot to the model as a vision image on the next AI request round. The feature deliberately reuses the proven `attach_local_images` pipeline — the main-process `AIImageNormalizer`, the transient `modelArtifacts` channel, the model-only multimodal handoff message, and the shared per-request image budget — so no new transport contract, server endpoint, or persistence path is introduced.

The first release is intentionally narrow:

- **On-demand snapshot.** One screenshot per tool call. No streaming, no periodic capture, no background loop.
- **User-chosen source.** Each call, the user approves and then picks the exact screen or window via the operating system's native screen picker. The tool never auto-selects a source.
- **Per-call consent.** Approval is required on every call and is never persisted as a standing grant.
- **Image-only.** The screenshot is delivered as a vision image. There is no OCR text fallback in this release.
- **Privacy by default.** Only the single chosen frame is ever materialized. Screenshot bytes are transient — never persisted, logged, emitted to the renderer, or included in telemetry. Window titles and application names are not persisted.

Because screen capture can expose passwords, authentication codes, messages, and unrelated applications, the screen-specific consent and privacy model is the central concern of this document, not the image plumbing.

## Background

### Existing Image-To-Model Flow

The `attach_local_images` tool already solved the hard transport problem. Its established path is:

1. The tool resolves and validates image sources inside the approved workspace.
2. `AIImageNormalizer` decodes, resizes, and re-encodes each image to a bounded payload.
3. The tool returns a safe metadata `result` plus a transient `modelArtifacts` array of prepared `ImageModelArtifact` objects.
4. `AIChatQueryLoop` (and the permission-resume path in `AIChatQueryEngine`) appends a model-only `role: "user"` multimodal handoff message carrying the images as `image_url` parts.
5. The next chat-completion round sees the images and the configured AI server performs vision analysis.

`view_screen` reuses steps 2 through 5 unchanged. It differs from `attach_local_images` only in step 1: the image bytes come from a user-chosen screen capture instead of a workspace file.

### Existing Media Capture In The Renderer

The renderer already accesses `navigator.mediaDevices` — `BrowserVoiceRecorder` uses `getUserMedia` for voice input. `getDisplayMedia` is the screen-capture analog and is the capture primitive this feature uses. There is no existing `desktopCapturer` or display-capture usage elsewhere in the application; screen capture is a new capability that this tool introduces under a strict consent model.

### Existing Tool Flow

AiChatV2 already supports multiple model-to-tool-to-model rounds, tool approval modes, plan-mode policy, streaming, cancellation, and retry. The new tool must participate in this loop and must not introduce a second chat runtime or a renderer-to-server shortcut.

## Problem Statement

The assistant can reason about files but is blind to anything not stored as a file: live windows, dialogs, pages, and visible data. Users resort to manual screenshot-and-save workflows that are slow and error-prone.

Naive "let the model see the screen" is unacceptable without guardrails. Unattended capture would expose credentials, authentication codes, private messages, and unrelated applications, and would send that content off-device to the configured AI server. A screenshot is also large and would bloat persisted tool results, logs, and token usage if placed in a normal JSON tool result.

The product needs a bounded, consent-first, single-snapshot tool that reuses the proven transient-image pipeline and adds a screen-specific threat model: explicit per-call consent, user-chosen source, transient bytes, and no persistence of identifying metadata.

## Goals

1. Let the LLM capture one screenshot of the user's display on demand and receive it as a vision image.
2. Require explicit per-call user consent, with the user choosing the exact capture source each call.
3. Reuse the existing `AIImageNormalizer`, transient `modelArtifacts` channel, and model-only multimodal handoff — no new transport contract.
4. Share the existing per-request image budget (three images, six million data-URL characters) with `attach_local_images` and user-selected attachments.
5. Keep screenshot bytes transient: out of persisted tool results, logs, renderer events, hooks, and telemetry.
6. Handle operating-system screen-capture permission (notably macOS Screen Recording), OS-picker cancellation, and user denial gracefully.
7. Degrade clearly when the configured model or server cannot process images.
8. Preserve streaming, cancellation, approval modes, retry behavior, and plan-mode policy.
9. Provide complete translations for every new user-facing string.

## Non-Goals

1. Do not implement live or streaming video capture.
2. Do not implement periodic or background auto-snapshots.
3. Do not implement an OCR text fallback. This release is image-only.
4. Do not implement a crop, redact, or blur overlay (deferred to a later release).
5. Do not persist a standing screen-capture permission grant. Every call requires explicit approval.
6. Do not capture without an explicit user gesture each call.
7. Do not persist window titles, application names, or pixel data.
8. Do not capture audio.
9. Do not perform remote control or input injection. This tool is view-only.
10. Do not add a new server endpoint, server-side storage, or signed upload handles.

## Product Terminology

### View

Produce one still screenshot for model vision input. The tool is named `view_screen`, not `capture_screen` or `record_screen`, to convey "look once" rather than continuous recording.

### Capture Source

The single screen or application window the user selects in the operating system picker. The tool and renderer never choose the source on the user's behalf.

### Screen Recording Permission

The operating-system-level consent (notably macOS "Screen Recording" under System Settings → Privacy & Security) that governs capture of other applications. Absent this permission, captures of other apps return empty or black frames.

### Transient Model Artifact

Binary or encoded content used only to construct an in-memory AI request. It is excluded from normal tool-result persistence, logs, renderer events, and tool-card JSON. This contract is identical to the one defined by `attach_local_images`.

### Vision-Capable Model

A configured model or AI server that accepts OpenAI-style `image_url` content parts. A model that does not is handled gracefully rather than silently failing.

## Users And Use Cases

### Primary User

A marketer or operator using AiFetchly who wants the assistant to see something currently visible on their display.

### UC1: Look At An In-App Error

1. The user asks: "There's an error showing in the app — look at it and tell me how to fix it."
2. The model calls `view_screen` with a short reason.
3. The app shows the approval prompt. The user approves.
4. The OS picker appears. The user selects the AiFetchly window.
5. The app captures one frame, prepares it, and continues the AI request.
6. The model reads the visible error text and suggests a fix.

### UC2: See A Web Page The User Has Open

1. The user asks the assistant to review a page they are viewing in their browser.
2. The model calls `view_screen`.
3. The user approves and selects the browser window in the OS picker.
4. The model analyzes the visible layout and content.

### UC3: Inspect Visible Spreadsheet Data

1. The user asks the assistant to check a value or layout in a spreadsheet.
2. The user approves and selects the spreadsheet window.
3. The model reasons about the visible data and responds.

### UC4: User Denies Approval

1. The model calls `view_screen`.
2. The user clicks Cancel on the approval prompt.
3. The tool returns `permission_denied` without capturing anything.
4. The model continues the loop and may ask the user to describe the screen instead.

### UC5: User Cancels The OS Picker

1. The user approves, but cancels the operating system picker without choosing a source.
2. The tool returns `os_picker_cancelled`.
3. No frame is captured.

### UC6: macOS Screen Recording Not Granted

1. On macOS, the user has not granted Screen Recording permission.
2. The resulting frame is empty or black, or the stream errors.
3. The tool detects this and returns `screen_recording_blocked` with guidance to grant permission in System Settings.
4. No usable image is sent to the model.

### UC7: Non-Vision Model Configured

1. The user has configured a model or server that does not accept image input.
2. The tool returns `model_not_vision_capable` (when detectable before request) or the server's image rejection surfaces as a clear chat error.
3. The model is informed and may ask the user to switch models or describe the screen.

### UC8: Image Budget Already Full

1. The current turn already carries three image parts.
2. The tool returns `image_limit_reached` without capturing.
3. The model is told why and may proceed differently.

## Product Principles

### Consent Is The Source Of Truth

The approval card plus the operating system picker together constitute explicit, per-call, user-chosen-source consent. There is no silent capture and no persistent grant.

### View, Don't Record

Exactly one still frame is produced per call and is torn down immediately. No stream is retained, replayed, or persisted.

### Privacy By Default

Only the chosen source's single frame is ever materialized. Window titles and application names are not persisted. Bytes are transient under the existing `modelArtifacts` invariant.

### Reuse The Proven Pipeline

The same normalizer, the same budget, and the same transient-artifact isolation as `attach_local_images`. No new transport, persistence, or server contract.

### Fail Safe

Any denial, cancellation, missing permission, or capability gap returns a structured error and captures nothing. The model loop continues.

### Existing Chat Behavior Remains Stable

Text-only turns, user-selected attachments, `attach_local_images`, document attachments, plan mode, tool approval modes, and local-provider capability checks must continue to behave as they do today.

## User Experience Requirements

### Tool Call Card

The existing tool-call card should show:

- Tool display name: "View screen"
- The model's stated reason for wanting to view the screen
- Capture state: awaiting approval, picking source, capturing, preparing, ready, or failed
- A generic source label ("your screen" or "a window you selected")
- Prepared dimensions, MIME type, and timestamp
- Final outcome or concise error

The card must never display pixel data, data URLs, raw bytes, specific window titles, application names, or authentication information.

### Approval Prompt

In `ask_for_approval` mode, the prompt must communicate:

- that a screenshot of a user-chosen screen or window will be captured,
- that the screenshot will be sent to the configured AI server,
- the model's reason for the request,
- that approval applies to this one tool call only.

Clicking **Allow** triggers the operating system picker, so consent and source selection form a single logical moment. `approve_for_me` and `full_access` behavior must follow the existing approval policy, subject to the security decision in Open Question 1.

### Progress

For calls that take longer than 500 milliseconds after the source is chosen, emit bounded progress states:

- `awaiting_approval`
- `picking_source`
- `capturing`
- `preparing`
- `ready`

Progress events contain status and counts only. They do not contain bytes.

### Failure Presentation

Failures should use the current tool-result UI. The user should see one concise cause mapped from the error code to localized text. No stack traces or byte dumps are shown.

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

`view_screen`

### Tool Description

Capture a single screenshot of a screen or application window that the user explicitly chooses, so you can see what is currently visible on the user's display. Use when the user asks you to look at, see, check, or review something on screen — an error, a page, a window, or visible data. The user must approve the capture and pick the exact source each call; you cannot choose the source. The screenshot is sent to the configured AI server and returned as a vision image on the next request. Do not use this tool for files that already exist (use `attach_local_images`), and do not use it when the user can simply describe the content.

### Input Schema

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "description": "One short sentence explaining why you need to see the screen. Shown to the user in the approval prompt."
    },
    "detail": {
      "type": "string",
      "enum": ["auto", "low", "high"],
      "default": "auto",
      "description": "Vision detail level forwarded to the model."
    }
  },
  "additionalProperties": false
}
```

No parameter is strictly required. `reason` is strongly encouraged for trust; when absent, the approval prompt falls back to a generic message. The tool does not accept a source selector, a region, a window identifier, or a destination URL — source selection always belongs to the user.

### Persistable Tool Result

```json
{
  "success": true,
  "source_kind": "window",
  "mime_type": "image/jpeg",
  "width": 1568,
  "height": 882,
  "prepared_size_bytes": 246013,
  "sha256": "hex-encoded-content-hash",
  "detail": "auto",
  "captured_at": "2026-08-04T12:00:00.000Z",
  "summary": "Captured a screenshot of the window you selected."
}
```

The persistable result must not include `dataUrl`, `contentBase64`, buffers, the original window title, the application name, process information, or the display's physical bounds beyond the prepared image dimensions.

### Transient Artifact Contract

The tool reuses the existing `ImageModelArtifact` type and the existing `ToolExecutionResult` shape defined by `attach_local_images`. A screen capture produces one `ImageModelArtifact` with `kind: "image"`.

`modelArtifacts` is consumed by `AIChatQueryLoop`. It must be removed before:

- `ToolExecutionService` persistence,
- renderer IPC events,
- hook output serialization,
- normal logging,
- analytics payloads,
- error reports.

## Model Transcript Contract

After successful execution, the desktop app adds two model-facing messages in order, identical in shape to `attach_local_images`:

1. A normal `role: "tool"` message containing only the safe JSON result.
2. A transient `role: "user"` multimodal handoff message containing the screenshot.

Example:

```json
[
  {
    "role": "tool",
    "tool_call_id": "call_view_screen_123",
    "content": "{\"success\":true,\"source_kind\":\"window\",...}"
  },
  {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "[AIFETCHLY_IMAGE_HANDOFF_V1]\nThe desktop attached a screenshot of the screen/window the user selected.\nOriginal user request:\nThere's an error showing in the app — look at it and tell me how to fix it."
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

The synthetic user message is model-only. It is not rendered as a new user-authored bubble and is not persisted as ordinary conversation text. The text part repeats the original user request so server-side intent detection continues to work after the synthetic message becomes the latest user message. It must not include untrusted instructions derived from window titles or captured content.

## Capture And Image Limits

### Required Limits

The image limits are shared with `attach_local_images` and user-selected attachments:

| Limit | Desktop Value | Reason |
|---|---:|---|
| Images per AI request | 3 | Shared budget across all image sources |
| Prepared image target | 1.5 MiB | Keeps requests below the server ceiling |
| Maximum long edge | 1568 px | Matches existing normalization |
| JPEG initial quality | 0.82 | Matches existing normalization |
| Client total data-URL target | 6,000,000 characters | Leaves transport and history headroom |
| Server total data-URL hard limit | 10,000,000 characters | Server-enforced final boundary |

Capture-specific limits:

| Limit | Desktop Value | Reason |
|---|---:|---|
| Frames per tool call | exactly 1 | On-demand snapshot, not a stream |
| Streams retained after capture | 0 | Tracks stopped immediately after the frame is grabbed |
| Sources captured per call | exactly 1, user-chosen | No multi-monitor or multi-window capture |

### Count Semantics

A `view_screen` capture counts as one image against the three-image-per-request budget, combined with any current-turn user-selected images and any `attach_local_images` attachments.

- Zero existing images: the capture may proceed.
- Three existing images: the tool returns `image_limit_reached` without capturing.
- Historical images represented only as metadata do not count; any historical image included as an actual `image_url` part does count.

### Size Semantics

Screen captures are frequently large (high-DPI displays, maximized windows). The normalizer's downscale loop is therefore critical: it must measure the actual final data-URL character length, resize to the long-edge limit, reduce dimensions or JPEG quality in bounded steps, and reject only if the result cannot meet the target without falling below the minimum acceptable dimensions. Because the user selects a single source in the OS picker, full multi-monitor captures are not a concern.

## Functional Requirements

### FR1: Built-In Tool Registration

Register `view_screen` as a built-in main-process skill.

Acceptance criteria:

- The tool appears in the normal tool catalog.
- The tool declares a new `permissionCategory: "screen"`.
- The tool is subject to plan-mode policy and local-provider tool capability restrictions.
- The tool follows the existing approval-mode policy, subject to Open Question 1.
- The input schema matches the Tool Contract and rejects unknown properties.

### FR2: Per-Call Consent

The tool must require explicit user approval on every call.

Acceptance criteria:

- `requiresConfirmation` is true.
- Approval is never persisted as a standing grant.
- Denial captures no frame and returns `permission_denied`.
- The model loop continues with a structured failure after denial.

### FR3: User-Chosen Source

The capture source is always chosen by the user.

Acceptance criteria:

- Clicking **Allow** on the approval card triggers the operating system picker via `getDisplayMedia`.
- The tool and renderer never auto-select a source.
- Only the single chosen source's frame is materialized.
- Cancelling the OS picker returns `os_picker_cancelled` with no capture.

### FR4: Single-Frame Capture And Teardown

Exactly one frame is captured per call and the stream is torn down immediately.

Acceptance criteria:

- One frame is drawn from the stream to a canvas.
- All media tracks are stopped immediately after the frame is grabbed.
- No stream, track, or captured buffer is retained after handoff.
- Capturing twice in one call is impossible by construction.

### FR5: Renderer-To-Main Frame Handoff

The captured frame is delivered to the main process for normalization.

Acceptance criteria:

- The renderer ships the single frame's bytes to the main process via a dedicated IPC channel.
- The IPC payload is transient and is not persisted, logged, or emitted to other listeners.
- The main process correlates the frame to the originating tool call.

### FR6: Main-Process Display-Media Handler

The main process must permit display capture as Electron requires.

Acceptance criteria:

- The application registers the required `session.setDisplayMediaRequestHandler` so that renderer `getDisplayMedia` requests are satisfied.
- The handler is configured to present the operating system / Electron screen picker to the user.
- The exact handler wiring and whether the picker is the native OS picker or Electron's `desktopCapturer`-backed picker is settled in the technical design.

### FR7: Preload Whitelist

Any new IPC channel used by this feature must be registered.

Acceptance criteria:

- New channels are added to the `validChannels` list in `src/preload.ts`.
- A renderer call on an unregistered channel is rejected rather than silently no-oping.

### FR8: Normalization And Shared Budget

The captured frame is normalized through the existing normalizer and counts against the shared image budget.

Acceptance criteria:

- `AIImageNormalizer` prepares the frame using the same long-edge, quality, and payload policy as `attach_local_images`.
- Final byte size and data-URL character length are measured after encoding.
- The capture consumes one of the three per-request image slots.
- The capture fails with `image_limit_reached` before capturing if the budget is already full.
- Normalization is abortable between encoding attempts.

### FR9: Transient Artifact Isolation

Screenshot payloads must remain outside the persistable tool result.

Acceptance criteria:

- Tool-result database rows contain metadata only.
- Renderer tool events contain metadata only.
- Hooks receive metadata by default and cannot accidentally log artifact bytes.
- Application logs include counts and sizes but not data URLs.
- Serialization helpers cannot include `modelArtifacts` through object spreading.
- Unit tests search serialized results for the base64 prefix and fail if it appears.

### FR10: Query Loop Handoff

`AIChatQueryLoop` (and the permission-resume path in `AIChatQueryEngine`) must add the screenshot to the next request round.

Acceptance criteria:

- The safe tool result is appended first.
- A model-only multimodal handoff message follows it.
- The next round sees the screenshot as an `image_url` part.
- The handoff message is removed when the turn ends or is cancelled.
- Recovery logic never duplicates image parts in the same request.

### FR11: Vision-Capability Handling

The feature must behave gracefully when the configured model cannot process images.

Acceptance criteria:

- When the configured model or server is known to lack image support, the tool returns `model_not_vision_capable` without capturing.
- When capability cannot be determined up front, a server-side image rejection surfaces as a clear, localized chat error rather than a raw failure.
- The selection of the detection mechanism is settled in the technical design (see Open Question 4).

### FR12: Operating-System Permission Handling

Screen-capture permission denial must be detected and guided.

Acceptance criteria:

- On macOS, an empty, black, or erroring frame is detected as a Screen Recording permission denial.
- The tool returns `screen_recording_blocked` with guidance to grant permission under System Settings → Privacy & Security → Screen Recording.
- No usable image is sent to the model in this case.
- The detection heuristic is documented and tested with representative inputs.

### FR13: Error Contract

The tool returns structured, model-readable errors.

Required error codes:

- `os_picker_cancelled`
- `permission_denied`
- `screen_recording_blocked`
- `capture_failed`
- `image_payload_too_large`
- `image_processing_failed`
- `model_not_vision_capable`
- `image_limit_reached`
- `cancelled`

Every failure result includes `success: false`, `code`, `error`, and a safe summary. Codes remain stable English identifiers mapped to localized UI text.

### FR14: Streaming And Cancellation

The feature must preserve the existing streaming lifecycle.

Acceptance criteria:

- The user can stop while awaiting approval, while the picker is open, or during capture and preparation.
- Cancellation prevents the next AI request.
- Aborted capture tears down any in-flight stream and stops all tracks.
- No late tool result resumes a cancelled conversation.

### FR15: Internationalization

Every new user-facing label, status, confirmation, and error must be translated into all six supported languages.

Acceptance criteria:

- Translation keys have the same structure in every language file.
- English fallback text is present where required by existing component patterns.
- Error codes remain stable English identifiers mapped to localized UI text.

### FR16: No Identifying Metadata Persistence

The feature must not persist information that identifies what was on screen.

Acceptance criteria:

- Window titles and application names are never stored, logged, or emitted.
- Only the generic `source_kind` ("screen" or "window"), prepared dimensions, MIME type, size, hash, timestamp, and outcome are persisted.
- Telemetry does not record window titles or application names.

## Architecture

### Required Data Flow

```text
User request ("look at my screen")
    |
    v
AIChatQueryLoop sends tools
    |
    v
LLM calls view_screen(reason, detail)
    |
    v
SkillExecutor applies approval policy
    |
    v
Renderer approval card: "Allow AI to view your screen?" + reason + destination
    |-- user clicks Cancel -> permission_denied (no capture)
    `-- user clicks Allow
        |
        v
Renderer: navigator.mediaDevices.getDisplayMedia()
    |-- OS picker cancelled -> os_picker_cancelled (no capture)
    `-- user picks one source
        |
        v
Renderer: grab exactly one frame to <canvas> -> dataURL -> stop all tracks
    |
    v
Renderer -> main IPC: transient frame bytes (+ toolCallId)
    |
    v
AIScreenCaptureToolService (main)
    |-- detect black/empty frame (macOS) -> screen_recording_blocked
    |-- AIImageNormalizer prepares the frame
    |-- enforce shared image budget
    |-- build safe metadata result
    `-- build transient ImageModelArtifact
    |
    v
AIChatQueryLoop
    |-- persists/emits metadata-only tool result
    |-- appends model-only multimodal handoff
    `-- starts next chat-completion round
    |
    v
AI server receives one image_url part and performs vision analysis
    |
    v
AiChatV2 renders the model's response
```

### Expected Desktop Files

New files are expected to include:

- `src/entityTypes/screenCaptureToolTypes.ts` — pure types and constants.
- `src/service/AIScreenCaptureToolService.ts` — main-process tool executor.
- `src/views/components/aiChatV2/screenCapture/getDisplayFrame.ts` — renderer capture primitive.
- A renderer approval surface for `view_screen` (a new component or a new case in the existing approval card).
- Focused tests under `test/vitest/main/service/` and `test/vitest/utilitycode/`.

Existing files likely to change:

- `src/config/skillsRegistry.ts` — register `view_screen`.
- `src/preload.ts` — whitelist the new IPC channel(s).
- `src/main-process/communication/ai-chat-v2-ipc.ts` — display-media handler registration and the frame-handoff IPC handler.
- `src/service/SkillExecutor.ts` — permission-preview wiring for the screen category.
- `src/views/components/aiChatV2/AiChatV2.vue` — minimal: one new case routing `view_screen` approvals through the renderer capture path. No new toolbar button.
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` — translations.

`AiChatV2.vue` should require little tool-specific logic, consistent with the `attach_local_images` precedent.

### Database Architecture

No new database entity is required for the first release. Tool-result metadata persists through the existing `ToolExecutionService` path and remains metadata-only. If a dedicated capture-audit entity is desired later (see Future Work), it must follow the standard pattern:

1. Model classes perform TypeORM operations.
2. Module classes apply business rules.
3. Main-process services call Modules.
4. IPC handlers remain communication-only.
5. Worker processes never access the database.

## Security And Privacy Requirements

### Screen Capture

- Capture is always per-call and user-initiated; never background.
- The user chooses the exact source each call; the application never auto-captures.
- Only the chosen frame is materialized in the renderer. The application does not enumerate, thumbnail, or persist a catalog of all open windows.
- On macOS, capture of other applications requires Screen Recording permission; denial is detected and the user is guided to grant it.
- The feature is view-only. It performs no input injection or remote control.

### Consent And Outbound Data

- Approval states that the screenshot will be sent to the configured AI server, and shows the destination host without credentials.
- The destination is fixed to the configured AI base URL. The tool accepts no destination URL from its arguments.
- Bytes are transient under the existing `modelArtifacts` invariant.

### Identifying Metadata

- Window titles, application names, and process information are never persisted, logged, emitted, or included in telemetry.
- Only generic `source_kind`, prepared dimensions, MIME type, size, hash, timestamp, and outcome are retained.

### Logging And Persistence

- Redact `data:image/` values from all diagnostic paths.
- Never log artifact objects through generic JSON logging.
- Never persist artifact payloads as tool results.
- Record only counts, prepared sizes, MIME types, hashes, durations, and outcome codes.

### Model Safety

- The tool description forbids using the tool for files and directs the model to `attach_local_images` for that purpose.
- One frame per call limits unintended bulk transfer.
- The tool must not relay instructions discovered in captured content as if they were user instructions.

## Performance Requirements

1. From approval click to frame grabbed should be well under two seconds in the typical case, dominated by the operating system picker and user choice.
2. Preparation should emit progress if it exceeds 500 milliseconds.
3. All media tracks are stopped immediately after the frame is grabbed; no stream lingers.
4. Peak in-memory payload is bounded to the single frame plus encoding overhead.
5. The encoded artifact is released after turn completion, cancellation, or terminal error.
6. The tool timeout policy must account for user-picker wait time (longer than a "fast" tool) without inheriting an unbounded filesystem timeout.
7. Abort cancels an in-flight picker or capture promptly.

## Observability

Record metadata-only events for:

- tool requested,
- approval granted or denied,
- OS picker cancelled,
- source kind chosen,
- capture completed,
- normalization completed,
- handoff request started,
- screen-recording permission blocked,
- model not vision-capable,
- cancellation.

Recommended fields:

- conversation ID or hashed correlation ID,
- tool-call ID,
- source kind,
- prepared bytes,
- total data-URL characters,
- dimensions,
- duration,
- result code.

Do not record window titles, application names, or pixel data in any event.

## Testing Requirements

### Unit Tests

- Tool schema accepts valid input and rejects unknown properties.
- The tool returns `image_limit_reached` when the per-request image budget is already full, without capturing.
- The tool service, given an injected frame provider and normalizer, produces a metadata-only result plus one transient artifact.
- Serialized tool results never contain a base64 prefix.
- Every error code is reachable: `os_picker_cancelled`, `permission_denied`, `screen_recording_blocked`, `capture_failed`, `image_payload_too_large`, `image_processing_failed`, `model_not_vision_capable`, `cancelled`.
- Cancellation aborts an in-flight capture and stops tracks.

### Renderer Capture Tests

- `getDisplayFrame`, with mocked `getDisplayMedia` and canvas, produces exactly one frame dataURL.
- All media tracks are stopped after the frame is grabbed.
- Picker denial and stream-error paths produce the correct error.
- A black/empty frame is classified as `screen_recording_blocked` on macOS.

### Query Loop Tests

- Successful execution appends safe tool JSON followed by a transient multimodal handoff.
- The next round contains exactly one new image part.
- Tool events sent to the renderer contain no base64.
- Tool-result persistence contains no base64.
- Recovery does not duplicate the image part.
- Permission pause and resume preserve the artifact contract.
- Abort during capture sends no continuation request.

### Integration Tests

- `view_screen` appears in the catalog with a valid schema.
- The approval pipeline routes `view_screen` approvals through the renderer capture path.
- A capture shares the budget with `attach_local_images` and user-selected images and cannot exceed three in combination.
- A non-vision model surfaces a clear, localized error.

### UI Tests

- The approval prompt shows the model's reason and the destination.
- The tool card displays state and a generic source label without pixel data.
- Base64 text never appears in the DOM.
- All new UI text renders in each supported language.

### Manual QA Only

The real operating-system picker, the macOS Screen Recording permission prompt, and multi-display layouts cannot be exercised by unit tests. A manual QA checklist must cover:

- Windows, macOS, and Linux capture.
- macOS with and without Screen Recording permission granted.
- Vision-capable and non-vision configured models.
- Picker cancellation and approval denial.
- Stop-stream during capture.

## Rollout Plan

### Phase 1: Type And Contract Reuse

- Add screen-capture types.
- Confirm a captured frame produces an `ImageModelArtifact` isolated identically to `attach_local_images`.
- Add serialization regression tests proving bytes stay transient.

### Phase 2: Capture Primitive And Main Handler

- Implement the renderer `getDisplayFrame` (single-frame grab and teardown).
- Register the main-process display-media handler.
- Whitelist the new IPC channel(s) in the preload.

### Phase 3: Tool Service, Registry, And Approval

- Implement `AIScreenCaptureToolService`.
- Register `view_screen` with the `screen` permission category.
- Wire the renderer approval path so **Allow** triggers the picker.
- Add all translations.

### Phase 4: Loop Integration And Error Mapping

- Wire the query-loop handoff and budget enforcement.
- Map OS-permission, picker, and capability errors to stable codes.

### Phase 5: QA And Controlled Release

- Run the manual QA matrix across platforms and model types.
- Gate with a desktop feature flag if required.
- Remove the flag only after cross-platform confirmation.

## Acceptance Criteria

The feature is complete when:

1. The model can call `view_screen`, the user approves and picks a source, and the model receives the screenshot as a vision image.
2. Approval is required on every call and is never persisted; denial or picker cancellation captures nothing.
3. Screenshot bytes never appear in persisted tool results, renderer events, logs, or telemetry.
4. Window titles and application names are never persisted or emitted.
5. A capture consumes one of the three per-request image slots shared with `attach_local_images`.
6. macOS Screen Recording denial is detected and the user is guided to grant permission.
7. A non-vision configured model produces a clear, localized error.
8. Stop, retry, permission resume, and existing attachment flows continue to work.
9. Tests cover consent, capture, transient isolation, shared budget, and every error code.
10. All user-facing strings are translated into all supported languages.

## Future Work

### Live And Periodic Capture

A later release may support periodic auto-snapshots or a live frame stream for tasks that require the model to monitor a changing screen. These require a background capture loop or streaming-capable model support and a separate threat model.

### OCR Text Fallback

A later release may run OCR on the captured frame and return extracted text, so text-only models can read the screen and vision models receive both pixels and text.

### Crop And Redact Overlay

A later release may add an overlay that lets the user crop the capture or blur sensitive regions (passwords, messages) before the bytes leave the device.

### Capture Audit Entity

A later release may add a Model/Module-backed audit entity recording generic capture metadata for compliance, without ever storing titles or bytes.

### Trusted Source Allowlist

A later release may let the user mark specific windows or applications as trusted to streamline repeated captures, subject to a refreshed threat model.

## Open Questions

1. Should `approve_for_me` or `full_access` ever auto-approve screen capture, or must every capture require explicit approval regardless of mode? Recommendation: screen capture should always require explicit approval.
2. Should the model be allowed to request a source kind (screen versus window), or should source selection always defer entirely to the user's OS-picker choice? Recommendation: always the user's choice.
3. Should a dedicated capture-audit log be persisted for compliance, or is the existing tool-result metadata sufficient?
4. How should vision capability be detected — a maintained list of vision models, a server capability flag, or surfacing the server's image rejection? This is settled in the technical design.
5. Should plan mode allow `view_screen`?
6. What default `detail` is most useful for screen text, which is often small — `auto` or `high`? `high` improves legibility but increases cost.
7. Should the picker be the native operating-system picker or Electron's `desktopCapturer`-backed picker, and how exactly should `setDisplayMediaRequestHandler` be configured? This is settled in the technical design.
