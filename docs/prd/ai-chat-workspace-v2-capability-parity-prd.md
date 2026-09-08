# AI Chat Workspace and Chat V2 Capability Parity Product Requirements Document

## Document Information

| Field                     | Value                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document version          | v1.0                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Status                    | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Created                   | 2026-09-08                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Owner                     | AiFetchly Product, Desktop, AI Platform, Safety, and Quality Engineering                                                                                                                                                                                                                                                                                                                                                                          |
| Product areas             | Default AI chat workspace, Chat V2, message queue, plans, tools, outbound email, generated images, reporting, voice, workspace trust, and memory                                                                                                                                                                                                                                                                                                  |
| Target platforms          | Windows, macOS, and Linux desktop builds supported by AiFetchly                                                                                                                                                                                                                                                                                                                                                                                   |
| Primary user surface      | `/aiworkspace`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Rollback surface          | Classic Chat V2 while the workspace migration flag remains available                                                                                                                                                                                                                                                                                                                                                                              |
| Parent PRD                | [`AI Chat-First Application Shell and Composer Refinement PRD`](./ai-chat-first-application-shell-prd.md)                                                                                                                                                                                                                                                                                                                                         |
| Related PRDs              | [`AI Chat Workspace UI Redesign PRD`](./ai-chat-workspace-ui-redesign-prd.md), [`AI Chat Conversation Reporting PRD`](./ai-chat-conversation-reporting-prd.md), [`AI Outbound Email Intent-Aware Delivery PRD`](./ai-outbound-email-intent-aware-delivery-prd.md)                                                                                                                                                                                 |
| Related technical designs | [`AI Chat-First Application Shell and Composer Refinement Technical Design`](./ai-chat-first-application-shell-technical-design.md), [`AI Chat Workspace UI Redesign Technical Design`](./ai-chat-workspace-ui-redesign-technical-design.md), [`AI Chat Message Queue Technical Design`](../ai-chat-message-queue-technical-design.md), [`AI Chat Conversation Reporting Technical Design`](./ai-chat-conversation-reporting-technical-design.md) |

## 1. Executive Summary

AiFetchly already sends users to `/aiworkspace` by default, but that surface does not yet provide all capabilities available in Chat V2. The two surfaces share the main AI query engine, so several backend behaviors already work in both. However, many user-facing workflows remain implemented only inside `AiChatV2.vue`. The workspace can therefore display a conversation while omitting or breaking the actions needed to finish it.

This PRD makes the AI Chat Workspace the complete default chat experience. It requires parity for message submission, slash commands, goals, scheduled loops, durable same-conversation queuing, steering, plan decisions, permission decisions, outbound-email review, generated-image editing, content reporting, voice, workspace trust, workspace memory, retry, and recovery.

Parity does not mean copying the Chat V2 layout. The workspace retains its sidebar, bounded transcript, run strip, semantic execution groups, and inspector. Capabilities must appear in the workspace-native hierarchy. Shared behavior must move out of the monolithic Chat V2 parent into typed reusable orchestration so the two surfaces cannot drift again.

The migration is complete only when the workspace passes the same functional, safety, accessibility, localization, and Electron end-to-end journeys as Chat V2. Until those gates pass, Chat V2 remains a rollback surface and must not lose working behavior.

## 2. Authority and Relationship to Existing Documents

### 2.1 Authority

This document is authoritative for:

1. The capability set required before the AI Chat Workspace can replace Chat V2 as the primary supported chat surface.
2. The user-visible behavior of those capabilities in the workspace.
3. Shared ownership boundaries between Chat V2, the workspace renderer, and main-process chat services.
4. Parity acceptance tests and rollout gates.
5. The order in which capability gaps must be closed.

### 2.2 Parent documents that remain authoritative

This PRD does not replace the detailed safety rules, schemas, or backend behavior defined by the related feature PRDs and technical designs. In particular:

- The message-queue documents remain authoritative for FIFO ordering, steering boundaries, pause rules, restart recovery, and pending-message persistence.
- The outbound-email documents remain authoritative for intent detection, frozen drafts, preflight, exact-draft authorization, delivery claims, and ambiguous delivery outcomes.
- The conversation-reporting documents remain authoritative for evidence selection, privacy, payload limits, and entitlement independence.
- The voice documents remain authoritative for runtime installation, model readiness, recording, transcription, and speech playback.
- The workspace redesign documents remain authoritative for one trusted renderer, bounded history, semantic execution rows, inspector ownership, and background conversation behavior.

### 2.3 Superseded assumptions

The following assumptions are no longer acceptable:

1. Reusing `AiChatV2Composer.vue` alone provides Chat V2 feature parity.
2. Sharing `AIChatQueryEngine` automatically makes all renderer workflows available.
3. A text-only semantic tool receipt is sufficient for actions such as permission approval or outbound-email review.
4. The workspace coordinator may reject every second same-conversation message while the default composer appears to accept normal chat input.
5. A slash-command suggestion is complete when the selected text is sent to the model instead of the command dispatcher.
6. A plan decision is complete when the decision record changes but the required execution or revision turn is not started.
7. Chat V2 can remain the permanent owner of reusable workspace, voice, reporting, image, and submission state.

## 3. Current Implementation Baseline

### 3.1 Default route

The root route redirects to `/aiworkspace`. Users therefore encounter the workspace gaps during the primary application journey, not an optional preview.

### 3.2 Capabilities already shared or substantially available

The workspace currently provides or inherits:

- Conversation selection, bounded history, unread state, and background run summaries.
- Main-process run ownership and cross-conversation execution scheduling.
- Basic AI query execution through `AIChatQueryEngine`.
- Mode, model, and tool-approval selection.
- Ordinary image and document attachments within current IPC limits.
- Assistant text, reasoning, plan metadata, tool lifecycle projection, and artifact reopening.
- Provider retry, context compaction, and much of the query engine's error mapping.
- Backend outbound-email intent resolution and send gating when the shared engine path is used.
- Goal, scheduled-loop, recovery, and usage events when they are emitted by an existing run.
- Plan decision and plan-question presentation at a basic level.

### 3.3 Verified capability gaps

| Capability                 | Chat V2 behavior                                                                     | Current workspace behavior                                                           | User impact                                                         | Priority |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------- |
| Composer acceptance        | Receives the full composer options object and clears the draft only after acceptance | Accepts only text and files; ignores `pastedContents`, `fromVoice`, and `onAccepted` | Drafts and pasted context can be mishandled                         | P0       |
| Same-conversation queue    | Normal messages can queue during a running turn                                      | Composer is busy and coordinator rejects another run                                 | Follow-up messages are blocked or rejected                          | P0       |
| Steering                   | A queued message can redirect an active turn at safe boundaries                      | No workspace steering action                                                         | Users cannot correct expensive or unsafe work in progress           | P0       |
| Slash and loop commands    | Parent routes slash, goal, and loop commands before model submission                 | Workspace submits raw command text as a normal AI message                            | Suggestions can lead to the wrong behavior                          | P0       |
| Tool permission            | Grant once, grant persistently, or deny through an actionable card                   | Semantic result shows informational permission text                                  | A run can wait without a way to continue                            | P0       |
| Plan decisions             | Validates the returned state and starts execution or revision follow-up              | Calls the decision API but ignores the result and does not continue                  | Approved plans may not execute; failed decisions look successful    | P0       |
| Outbound email             | Tool result opens batch review, approval, send, and delivery progress                | Tool result is collapsed into a generic semantic receipt                             | Safety-gated email cannot be reviewed or sent from the default chat | P0       |
| Generated images           | Select, edit, infer references, confirm batch, save, retry, and stop                 | Some images render, but actions and request fields are not wired                     | Image editing workflows stop at display                             | P1       |
| Reporting                  | Per-output and conversation-level reporting with capability checks                   | Message report events are unhandled; no conversation report entry                    | Safety reporting is missing from the default chat                   | P1       |
| Voice                      | Recording, transcription, setup, playback, spoken-response policy, and errors        | Only a few composer events route to settings or cancellation                         | Microphone and spoken responses are incomplete or absent            | P1       |
| Workspace trust and memory | Select or change workspace, review trust, inspect and edit memory                    | Inspector displays a limited summary without the full actions                        | Filesystem tools lack discoverable setup and trust recovery         | P1       |
| Retry and recovery detail  | Shows retry attempt and recovery layer information                                   | Run strip shows a reduced recovering state                                           | Users cannot tell whether work is retrying, waiting, or stuck       | P1       |

## 4. Problem Statement

The default workspace presents a newer information architecture but a smaller effective product. Users can start ordinary conversations, yet several actions disappear exactly when they are needed: a tool asks for permission, a plan is approved, an email draft needs review, an image needs editing, or a second message should queue behind active work.

The code has two sources of drift:

1. `AiChatV2.vue` owns many unrelated workflows in one large component, including command routing, voice, generated-image selection, reporting, plan continuation, workspace trust, memory, and pending-message presentation.
2. The workspace introduced a separate run coordinator and semantic transcript projection without integrating every Chat V2 action contract.

Copying the missing code into the workspace would solve today's visible gaps but create two implementations that diverge after the next feature. The product needs both immediate parity and a shared ownership model that keeps parity.

## 5. Users and Jobs to Be Done

### 5.1 Marketing operator

The operator needs to send a follow-up while long work continues, redirect a mistaken task, review outbound email before delivery, and move between conversations without losing progress.

### 5.2 Workspace automation user

The user needs to bind a trusted filesystem workspace, understand what access is requested, grant or deny it deliberately, and manage reusable workspace memory.

### 5.3 Plan and goal user

The user needs to create a plan, answer questions, approve or revise it, and see execution begin without typing an undocumented follow-up message.

### 5.4 Generated-media user

The user needs to select an earlier generated image, request an edit, process several images, keep successful batch results, retry failures, stop remaining work, and save output to a trusted workspace.

### 5.5 Voice user

The user needs microphone input and spoken responses to work in the default chat, including actionable setup states when the local runtime or model is missing.

### 5.6 Safety-conscious user

The user needs to report one AI output or a selected set of conversation outputs without exposing unrelated prompts, files, reasoning, or tool data.

### 5.7 Keyboard and assistive-technology user

The user needs every action, state, dialog, queue item, decision, and error to be reachable and understandable without hover, pointer input, or color alone.

## 6. Goals

1. Make `/aiworkspace` functionally complete for every supported interactive Chat V2 workflow.
2. Preserve the workspace-native sidebar, transcript, run strip, execution grouping, and inspector.
3. Establish one shared implementation of capability orchestration wherever both surfaces need the same behavior.
4. Preserve durable run ownership when the renderer reloads, switches routes, or changes conversations.
5. Preserve all tool, outbound-email, workspace, reporting, and AI-entitlement safety boundaries.
6. Support same-conversation message queuing and steering without weakening cross-conversation scheduling.
7. Prevent rejected submissions from clearing user drafts.
8. Keep background conversations active and accurately represented in the sidebar.
9. Provide complete keyboard, screen-reader, responsive, and six-language behavior.
10. Keep Chat V2 usable as a rollback surface until workspace acceptance gates pass.

## 7. Non-Goals

This initiative does not include:

1. Making the workspace visually identical to Chat V2.
2. Rendering raw Chat V2 tool-call and tool-result cards in place of workspace execution groups.
3. Replacing `AIChatQueryEngine`, Vue, Pinia, Electron, TypeORM, or the existing Model/Module architecture.
4. Adding new outbound-email authorization semantics.
5. Adding new AI-content report categories or increasing report payload limits.
6. Adding a new speech engine.
7. Changing generated-image ownership, trusted storage, size, type, or dimension rules.
8. Allowing worker processes to access the database.
9. Moving database operations into renderer code or IPC handlers.
10. Removing Chat V2 before parity, rollout, and rollback gates pass.
11. Combining the workspace's global execution scheduler and the same-conversation pending queue into one unbounded queue.
12. Fetching or mounting every message in large conversation histories.

## 8. Product Principles

1. **The default surface must be the complete surface.** A feature is not shipped for chat until it works in `/aiworkspace`.
2. **One behavior, multiple presentations.** Shared orchestration owns rules; each surface may present them differently.
3. **Actions stay with the state that requires them.** Permission, email review, plan approval, and recovery must never be reduced to informational text.
4. **Accept before clearing.** User-authored text, attachments, pasted blocks, and generated-image selections remain until the main process accepts the submission.
5. **Persist before claiming success.** Queue, run, plan, authorization, and delivery transitions follow their existing durable contracts.
6. **Safety controls remain deterministic.** Models may propose actions but trusted application code grants permissions, authorizes email, validates image ownership, and builds report payloads.
7. **Background work remains background work.** Switching conversations or routes changes presentation, not execution ownership.
8. **No silent capability loss.** Missing runtime, permission, workspace, or provider state produces an actionable explanation.
9. **Semantic projection is extensible.** Specialized outputs receive specialized workspace surfaces instead of falling back to generic summaries.
10. **Parity is enforced by tests.** Default-route Electron journeys are release gates, not optional coverage.

## 9. Definitions

| Term                   | Definition                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Chat V2                | The classic interactive chat surface rooted at `AiChatV2.vue`, retained temporarily as a rollback and behavior reference.                |
| AI Chat Workspace      | The default `/aiworkspace` surface with sidebar, selected transcript, run strip, composer, and inspector.                                |
| Capability parity      | Equivalent user outcome and safety behavior across surfaces, not identical layout or component structure.                                |
| Pending message        | A durable, accepted user message waiting to dispatch, steer, pause, resume, cancel, or complete.                                         |
| Steering               | Applying an accepted user correction to an active turn at a defined safe boundary without also dispatching it as a duplicate later turn. |
| Run envelope           | The durable workspace record that tracks owner, resource class, run status, timing, and terminal outcome.                                |
| Semantic result        | A workspace-native projection of a tool outcome into an artifact, file, image, permission, email, error, summary, or structured surface. |
| Conversation workspace | The filesystem root and trust context bound to one conversation.                                                                         |
| Reportable output      | A completed AI-generated output eligible under the AI-content-reporting contract.                                                        |

## 10. Fixed Product and Architecture Decisions

1. `/` continues to resolve to `/aiworkspace`.
2. Chat V2 remains available only as a migration rollback until removal is separately approved.
3. `AiChatV2Composer.vue` remains the shared message-entry component unless a later technical design replaces it for both surfaces together.
4. The workspace retains its semantic transcript. Tool messages must not revert to duplicate generic call/result cards.
5. Shared behavior must be extracted from `AiChatV2.vue` into typed composables, stores, or renderer-safe controllers. It must not be copied wholesale into `AiChatWorkspaceShell.vue`.
6. The workspace coordinator remains the main-process owner of workspace run envelopes and cross-conversation resource scheduling.
7. The durable pending-message service remains the authority for same-conversation FIFO order, steering, pause, resume, cancellation, and restart recovery.
8. A technical design must define one mapping between pending-message identity and workspace run identity. The same user message must never exist as two independently dispatchable jobs.
9. Main-process AI handlers check AI enablement before parsing requests or doing AI work. Reporting remains governed by its existing entitlement-independent safety contract.
10. IPC handlers validate and sanitize communication but delegate database work to Modules and Models.
11. Worker processes continue to send results to the main process and never access SQLite directly.
12. Specialized result types such as permission, outbound email, and generated-image batches extend the workspace semantic projection.
13. All new or changed user-facing text is translated in English, Chinese, Spanish, French, German, and Japanese.
14. Every renderer change includes component tests; critical multi-step flows include Electron E2E coverage.

## 11. Target Capability Architecture

### 11.1 Renderer ownership

```text
AiChatWorkspace center surface         Chat V2 rollback surface
               │                                  │
               ├──────── shared orchestration ────┤
               │  submission / commands / plans  │
               │  queue / permissions / images   │
               │  reporting / voice / workspace  │
               ▼                                  ▼
          typed renderer API and preload allowlist
                              │
                              ▼
                 main-process chat coordination
             pending FIFO + steering per conversation
             run scheduling across conversations
                              │
                              ▼
                    AIChatQueryEngine and tools
```

### 11.2 Required shared orchestration boundaries

Names may change in technical design, but ownership must be equivalent to:

| Shared boundary                      | Responsibility                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Submission orchestration             | Full composer payload, acceptance callback, optimistic presentation, errors, command interception, and ordinary-message dispatch  |
| Command orchestration                | Plugin and built-in slash commands, `/goal`, `/loop`, loop controls, expanded prompts, and scheduled-loop approval                |
| Pending-message orchestration        | List, subscribe, create, steer, cancel, resume, park, restore, and reconcile pending presentation                                 |
| Plan action orchestration            | Answer, approve, reject, request changes, validate returned state, update presentation, and start the correct continuation        |
| Permission orchestration             | Present the request, grant once, grant persistently, deny, resume, and surface failure                                            |
| Generated-image orchestration        | Conversation-scoped selection, inference, ambiguity, confirmation, trusted staging, save, retry, stop, and error mapping          |
| Reporting orchestration              | Capabilities, eligible-item selection, single-output reports, conversation reports, submission state, and report references       |
| Voice orchestration                  | Settings, runtime and model readiness, installation, recording, transcription, playback, cancellation, and spoken-response policy |
| Conversation-workspace orchestration | Binding, approval, trust card, watcher lifecycle, workspace memory, and refresh of scoped commands and mentions                   |

### 11.3 Queue responsibility model

The target contains two bounded scheduling concerns:

1. **Within one conversation:** accepted messages preserve FIFO order, may steer the current turn, pause after cancellation or failure, and recover after restart.
2. **Across conversations:** runnable heads compete for bounded general, browser, CPU, or artifact capacity while conversation leases prevent conflicting execution.

The implementation must compose these concerns. It must not:

- reject an ordinary follow-up merely because a run is active;
- create a workspace run that can dispatch independently of its pending message;
- let both the pending queue and workspace scheduler call the query engine for the same message;
- lose a queued message when the renderer changes route or reloads; or
- auto-run recovered pending work after restart without the existing explicit recovery rule.

## 12. Functional Requirements

### 12.1 Submission and composer contract

- **FR-SUB-001**: The workspace send handler must accept the complete shared composer payload: text, files, voice origin, pasted-content map, and acceptance callback.
- **FR-SUB-002**: The composer clears text, files, pasted state, and transient suggestions only after the submission is accepted for command execution or durable queueing.
- **FR-SUB-003**: A validation, entitlement, queue-limit, or IPC failure before acceptance leaves the complete draft available for retry.
- **FR-SUB-004**: Ordinary pasted-content placeholders and their cached bodies must reach the same engine request behavior as Chat V2.
- **FR-SUB-005**: Attachment normalization, MIME allowlists, count limits, and byte limits remain identical across chat surfaces.
- **FR-SUB-006**: Optimistic user messages must reconcile with the durable message by stable request identity without duplicates.
- **FR-SUB-007**: Switching conversations during submission must not attach the message or error to the wrong conversation.
- **FR-SUB-008**: The composer remains usable for ordinary follow-up text while an active turn is running.
- **FR-SUB-009**: Command-like inputs remain disabled or rejected with a clear explanation when their contract forbids concurrent execution.

### 12.2 Slash commands, goals, and scheduled loops

- **FR-CMD-001**: Inputs beginning with `/` must pass through the shared command router before ordinary AI submission.
- **FR-CMD-002**: Plugin, user, and workspace-scoped commands must resolve through the existing command registry and scope rules.
- **FR-CMD-003**: A command that expands to a prompt submits the expanded prompt exactly once and does not recursively dispatch it as another command.
- **FR-CMD-004**: Command failure renders a local, safe error exchange and preserves retryable input where appropriate.
- **FR-CMD-005**: `/goal` creates or replaces the goal for the selected conversation and starts the goal-bound turn.
- **FR-CMD-006**: Goal-loop start, stop, and status behaviors match Chat V2.
- **FR-CMD-007**: Scheduled-loop creation requires the existing up-front tool-policy approval before persistence.
- **FR-CMD-008**: Scheduled-loop pause, resume, stop, and status controls act on the selected conversation only.
- **FR-CMD-009**: Slash suggestions and command execution must use the same selected conversation and workspace scope.

### 12.3 Durable queue and steering

- **FR-QUE-001**: Every accepted ordinary message becomes a durable pending record before it is considered queued or sent.
- **FR-QUE-002**: Pending messages dispatch in FIFO order within one conversation unless a valid steering operation consumes one.
- **FR-QUE-003**: A pending bubble shows queued, steering, paused, dispatching, failed, and recoverable states using text and iconography.
- **FR-QUE-004**: Eligible text-only pending messages expose a steering action while the current turn is at a steerable stage.
- **FR-QUE-005**: Attachment-bearing messages may queue but must not steer when the existing steering contract forbids it.
- **FR-QUE-006**: Accepted steering applies at most once and never later dispatches as a duplicate normal turn.
- **FR-QUE-007**: Superseded tool calls receive the required synthetic results so provider protocol remains valid.
- **FR-QUE-008**: Stopping an active turn pauses remaining messages until the user explicitly resumes.
- **FR-QUE-009**: Exhausted provider failure pauses rather than blindly draining the next queued message.
- **FR-QUE-010**: Different conversations may drain independently subject to global scheduler limits.
- **FR-QUE-011**: Restarted applications show recoverable pending rows without automatically contacting the provider.
- **FR-QUE-012**: Users can cancel a pending item without cancelling unrelated active or pending work.
- **FR-QUE-013**: Queue and run state remain reconstructable after route changes, conversation changes, and renderer reloads.
- **FR-QUE-014**: Queue limits produce a localized explanation and retain the unaccepted draft.

### 12.4 Plans and questions

- **FR-PLN-001**: The workspace renders at most one current plan decision surface and one appropriate receipt for a plan lifecycle.
- **FR-PLN-002**: Plan questions preserve single-select, multi-select, custom response, validation, retry, and accessibility behavior.
- **FR-PLN-003**: Approve, reject, and request-changes actions remain disabled while their decision request is in flight.
- **FR-PLN-004**: A plan action is treated as successful only when its IPC returns the expected updated plan state.
- **FR-PLN-005**: A null, stale-version, validation, or persistence response leaves the decision surface actionable and shows a safe retry error.
- **FR-PLN-006**: Successful approval changes the mode to chat where required and starts the standard plan-execution continuation turn.
- **FR-PLN-007**: Successful rejection or change request starts the appropriate revision continuation only after the decision persists.
- **FR-PLN-008**: A continuation uses the durable queue and cannot run twice after renderer retry or event replay.
- **FR-PLN-009**: The full plan document remains in Activity while the transcript uses the compact workspace decision or receipt surface.

### 12.5 Tool permission decisions

- **FR-PER-001**: A tool permission request renders an actionable decision surface, not only an informational semantic label.
- **FR-PER-002**: The surface identifies the tool, permission category, bounded preview, shell preview when applicable, and trusted workspace context.
- **FR-PER-003**: Users can grant once, grant persistently when allowed, or deny.
- **FR-PER-004**: Grant and deny actions use the existing trusted permission IPC and never expose raw permission tokens to the DOM or logs.
- **FR-PER-005**: A successful grant resumes the exact paused tool continuation once.
- **FR-PER-006**: Denial produces the existing safe tool result and lets the AI explain or recover.
- **FR-PER-007**: Failure leaves the decision available and announces the error.
- **FR-PER-008**: Inactive conversations show only bounded permission attention in the sidebar. Selecting the conversation reveals the full decision.

### 12.6 Outbound-email review and delivery

- **FR-OUT-001**: The workspace semantic projection recognizes outbound-email draft and delivery metadata as a dedicated result kind.
- **FR-OUT-002**: Draft-ready batches render recipient count, mode, batch status, reason code, sent count, and a Review action.
- **FR-OUT-003**: Review opens the existing outbound-email review dialog over the workspace without replacing or duplicating the transcript.
- **FR-OUT-004**: Send remains disabled until the exact frozen draft revision has a valid trusted authorization.
- **FR-OUT-005**: Approval reruns preflight and keeps the raw authorization token in renderer memory only.
- **FR-OUT-006**: Send claims an idempotent attempt through trusted application code. A repeated click or renderer retry cannot create a duplicate delivery.
- **FR-OUT-007**: Progress and terminal outcomes render for sent, failed, partial, cancelled, and delivery-unknown states.
- **FR-OUT-008**: Delivery-unknown is never described as success and never automatically retried contrary to the outbound reliability contract.
- **FR-OUT-009**: Closing the dialog after a successful send does not discard the persistent transcript receipt.
- **FR-OUT-010**: Models cannot bypass review, authorization, preflight, or delivery claims by selecting a different chat surface.

### 12.7 Generated-image workflows

- **FR-IMG-001**: Generated images render with Open, Use as reference, Edit, and Save to workspace actions when allowed.
- **FR-IMG-002**: Selected references are scoped to the conversation and shown in the shared composer tray.
- **FR-IMG-003**: Users can remove, clear, and reorder selected references.
- **FR-IMG-004**: The request contract carries generated-image references and the trusted confirmed-batch channel required by the current engine.
- **FR-IMG-005**: Reference inference remains deterministic and may use explicit selection, recent context, or unambiguous wording only under existing rules.
- **FR-IMG-006**: Ambiguous requests open a chooser and do not submit until the user selects or cancels.
- **FR-IMG-007**: Fusion remains limited to the existing direct-reference maximum.
- **FR-IMG-008**: Explicit independent selections above the direct maximum open batch confirmation rather than silently truncating.
- **FR-IMG-009**: Confirmed batch references retain user-selected order and travel through the trusted staging contract.
- **FR-IMG-010**: Batch progress shows requested, completed, failed, concurrency, and terminal state.
- **FR-IMG-011**: Partial success keeps successful outputs and offers retry only for eligible failed references.
- **FR-IMG-012**: Stop preserves completed outputs and cancels remaining work according to the existing tool contract.
- **FR-IMG-013**: Save to workspace requires a valid trusted workspace and never writes outside it.
- **FR-IMG-014**: Stable generated-image error codes map to localized, actionable messages.
- **FR-IMG-015**: Conversation switching cannot replay or submit another conversation's staged image references.

### 12.8 AI-content reporting

- **FR-RPT-001**: Every eligible assistant output in the workspace exposes the existing per-output report action.
- **FR-RPT-002**: The workspace handles the report event and opens the real single-output report dialog.
- **FR-RPT-003**: The conversation header exposes a persistent Report conversation action.
- **FR-RPT-004**: Conversation reporting remains independent of hosted-AI enablement and AI credits.
- **FR-RPT-005**: Capability checks fail closed while keeping the action visible with a reason.
- **FR-RPT-006**: Eligible-item, selection, related-user-context, image, truncation, consent, payload, and report-reference behavior matches the conversation-reporting PRD.
- **FR-RPT-007**: Tool calls, tool results, reasoning, hidden prompts, permission data, attachments, workspace paths, and unrelated messages remain excluded.
- **FR-RPT-008**: The dialog closes or resets safely when the selected conversation changes.
- **FR-RPT-009**: Successfully reported output IDs remain visibly marked for the current renderer session.

### 12.9 Voice input and spoken responses

- **FR-VOI-001**: The workspace consumes one shared voice orchestration implementation also used by Chat V2.
- **FR-VOI-002**: The composer receives settings, input readiness, runtime readiness, model readiness, maximum duration, auto-send, install progress, and error props.
- **FR-VOI-003**: Microphone states distinguish ready, recording, transcribing, busy, setup required, permission denied, and error.
- **FR-VOI-004**: Missing runtime or models expose the existing deliberate install or settings path instead of hiding the control.
- **FR-VOI-005**: Transcription merges with existing typed text according to the current composer contract.
- **FR-VOI-006**: Starting recording stops active speech playback without cancelling the text run.
- **FR-VOI-007**: Spoken-response preferences and policies remain directly accessible in the workspace chat.
- **FR-VOI-008**: Speech playback follows only the selected conversation and the configured typed-versus-voice response policy.
- **FR-VOI-009**: Switching conversations, stopping a run, starting recording, or disabling speech cancels inappropriate playback.
- **FR-VOI-010**: Voice failure never discards typed text, attachments, pasted data, or selected generated images.

### 12.10 Conversation workspace, trust, watcher, and memory

- **FR-WSP-001**: The selected conversation exposes its bound workspace and approval state near the conversation context.
- **FR-WSP-002**: Users can choose, change, or remove a workspace through the existing canonical validation flow.
- **FR-WSP-003**: Filesystem-dependent actions show the required-workspace setup surface when no usable workspace exists.
- **FR-WSP-004**: Untrusted workspace instructions show the existing trust review card with accept and dismiss actions.
- **FR-WSP-005**: Workspace trust remains scoped to the canonical workspace identity and never broadens from renderer-provided paths.
- **FR-WSP-006**: Workspace changes refresh slash-command scope, at-mention scope, memory count, watcher state, and trust presentation.
- **FR-WSP-007**: The Context inspector offers the existing workspace-memory entry point and current count when supported.
- **FR-WSP-008**: Memory list, edit, delete, portable-storage state, conflict review, and diagnostics reuse their existing contracts.
- **FR-WSP-009**: Watch lifecycle follows the selected conversation without losing background run ownership.
- **FR-WSP-010**: Workspace paths and file content are not logged through analytics, report events, or general error messages.

### 12.11 Retry, recovery, context, and errors

- **FR-REC-001**: The run strip shows the high-level state while transcript or Activity exposes actionable retry and recovery detail.
- **FR-REC-002**: Retry presentation includes attempt, maximum attempts, and bounded delay information when available.
- **FR-REC-003**: Recovery presentation includes the current recovery layer, reason, attempt, and safe message when available.
- **FR-REC-004**: Terminal provider, context-window, generated-image, permission, queue, and outbound-email errors use their stable mapped messages.
- **FR-REC-005**: Context usage uses the selected model's known context window and the newest authoritative usage update.
- **FR-REC-006**: Automatic compaction and emergency compaction remain engine-owned and surface completion or failure consistently.
- **FR-REC-007**: An error from an inactive conversation updates only its bounded sidebar attention state.
- **FR-REC-008**: Selecting that conversation reconstructs the detailed state from durable history and live runtime data.

### 12.12 Conversation switching and lifecycle

- **FR-LIF-001**: Changing selection does not cancel a previous conversation's run, queue, goal, scheduled loop, or voice job except where voice playback is intentionally selected-conversation-only.
- **FR-LIF-002**: Detail events apply only to the selected conversation and matching generation/run identity.
- **FR-LIF-003**: Summary events for inactive conversations contain no private transcript or tool payload.
- **FR-LIF-004**: A selected conversation can reconstruct pending, running, waiting, terminal, plan, permission, and reportable-output presentation after reload.
- **FR-LIF-005**: Clear and delete remain unavailable while active execution could re-persist content.
- **FR-LIF-006**: New chat creates one stable conversation identity used consistently by workspace binding, commands, queue records, runs, messages, plans, and generated images.

## 13. Workspace Presentation Requirements

### 13.1 Center hierarchy

The workspace chat center presents:

```text
Conversation header
Workspace/trust summary when relevant
Run strip
Transcript
  user and assistant messages
  grouped execution rows
  specialized permission/email/image surfaces
  plan decision/question/receipt surfaces
  pending-message bubbles
Composer
  textarea, attachments, generated-image tray, voice, send/stop
  mode, model, approval, context, and spoken-response controls
```

### 13.2 Semantic result extensions

The semantic projection must support at least:

| Result kind           | Workspace presentation                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| Artifact              | Compact receipt with reopen action into Artifacts inspector                 |
| Files                 | File-change receipt with Activity details                                   |
| Images                | Image thumbnails and generated-image actions, not only an image-count label |
| Generated-image batch | Progress, partial failures, retry failed, and stop                          |
| Permission            | Actionable grant/deny surface                                               |
| Outbound email        | Batch status, Review action, dialog, and delivery progress                  |
| Error                 | Safe error summary with retry or recovery action when supported             |
| Summary               | Bounded human-readable result                                               |
| Structured fallback   | Safe bounded details in Activity                                            |

### 13.3 No duplicate presentation

- A tool call and result sharing a stable `toolCallId` remain one evolving execution row.
- A specialized result replaces the generic result body but does not remove the execution identity or Activity detail.
- A plan appears in only one lifecycle-appropriate transcript surface.
- A pending message disappears or becomes a durable user message when dispatch commits. It must not render both.
- Header, run strip, transcript, and inspector may summarize the same run only at their assigned level of detail.

## 14. Security and Privacy Requirements

1. All workspace AI handlers enforce the existing AI enablement check before request parsing or AI work.
2. Reporting handlers remain accessible under the reporting PRD's entitlement-independent safety rule.
3. Renderer inputs pass strict Zod schemas. Unknown keys fail rather than silently entering trusted execution.
4. IPC responses and errors expose no credentials, authorization tokens, decrypted settings, provider bodies, workspace secrets, or raw database errors.
5. Database reads and writes occur through Model and Module layers.
6. Worker and utility processes never access the database directly.
7. Outbound email requires trusted application authorization over the exact frozen draft.
8. Generated-image references must belong to the conversation and trusted generated-image store.
9. Workspace path access uses canonical main-process validation and existing trust scope.
10. Tool permission grants use existing typed permission categories and bounded previews.
11. Report payload construction is deterministic and excludes hidden or unrelated data.
12. Analytics and logs contain bounded identifiers and state labels only. They never contain prompts, transcripts, email bodies, recipients, image data, file content, raw paths, voice audio, or credentials.
13. Generated HTML artifacts remain in the existing sandboxed preview boundary.
14. Background summary events contain no private detail payload.

## 15. Accessibility Requirements

- **A11Y-001**: Every action has an accessible name and visible or programmatically associated state.
- **A11Y-002**: Queue state, run state, permission state, email state, plan state, and recovery state do not rely on color alone.
- **A11Y-003**: Keyboard users can send, stop, queue, steer, cancel, resume, approve, deny, review, report, edit images, manage workspace state, and operate voice controls.
- **A11Y-004**: Focus moves into a newly opened decision dialog or card and returns to the invoking control on close.
- **A11Y-005**: New permission, user-question, outbound-review, and terminal-error states are announced once without stealing focus from inactive conversations.
- **A11Y-006**: Dialogs trap focus, support Escape where cancellation is safe, and prevent accidental outside dismissal when it would strand a pending decision.
- **A11Y-007**: Touch targets meet the repository's existing minimum sizing rules.
- **A11Y-008**: Reduced-motion preferences disable nonessential queue, retry, progress, and speaking animation.
- **A11Y-009**: The workspace remains usable at 200% scaling and narrow supported widths without hiding the primary action.
- **A11Y-010**: Reasoning remains excluded from screen-reader output when the user has disabled reasoning display.

## 16. Localization Requirements

1. All added or changed user-facing text uses translation keys with an English fallback.
2. Keys exist with the same structure in `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`.
3. Existing `aiChatV2`, `aiConversationReport`, outbound-email, workspace-memory, and voice keys should be reused when the meaning is identical.
4. Workspace-specific keys are added only when placement or meaning differs.
5. Variable interpolation supports plural counts for queued items, recipients, images, attempts, and selected report items.
6. Status labels remain short enough for narrow layout and provide longer accessible descriptions where needed.
7. Translation parity tests cover every affected namespace.

## 17. User Journeys

### 17.1 Queue a follow-up and steer active work

1. The user sends message A.
2. While A is running, the composer remains available for ordinary text.
3. The user sends message B. The workspace shows B as queued.
4. If A reaches a safe steering stage, B offers Steer.
5. The user chooses Steer.
6. B is consumed into A exactly once. Superseded tools receive synthetic results.
7. B never starts later as a duplicate turn.

### 17.2 Stop active work without losing the queue

1. A is running and B is queued.
2. The user chooses Stop.
3. A becomes cancelled and B becomes queue-paused.
4. No provider request for B starts automatically.
5. The user resumes B or cancels it.

### 17.3 Approve and execute a plan

1. The assistant submits a plan.
2. The transcript shows one plan decision card.
3. The user approves.
4. The application persists and returns the approved state.
5. The card becomes a receipt and mode returns to chat where required.
6. A single queued continuation tells the assistant to execute the approved plan.
7. If approval fails, the card stays actionable and execution does not start.

### 17.4 Grant a tool permission

1. A tool pauses for permission.
2. The run strip and sidebar show bounded attention.
3. The selected transcript shows tool, permission category, preview, and workspace context.
4. The user grants once, grants persistently when offered, or denies.
5. The exact continuation resumes once, or the denial result returns to the model.

### 17.5 Review and send outbound email

1. The assistant prepares a frozen outbound-email batch.
2. The execution result shows a batch card with Review.
3. Review displays recipients, subjects, bodies, warnings, and preflight state.
4. The user approves the exact draft.
5. Send becomes available and creates one delivery claim.
6. Progress and the final outcome remain visible in the transcript.
7. Ambiguous delivery appears as Delivery Unknown and is not auto-retried.

### 17.6 Edit generated images

1. The user selects Use as reference on an earlier generated image.
2. The image appears in the composer tray.
3. The user requests an edit.
4. An ambiguous match opens the chooser; too many independent images open batch confirmation.
5. The engine receives validated conversation-owned references.
6. Results show thumbnails, progress, failures, retry, stop, and save actions.

### 17.7 Report a conversation concern

1. The user chooses Report conversation in the workspace header.
2. The dialog lists eligible completed AI outputs only.
3. The user selects up to the existing limit and optionally includes explicitly previewed related user messages.
4. The dialog shows the exact transmission set and consent copy.
5. Submission returns one stable report reference.
6. The dialog remains usable if AI generation is disabled, subject to reporting capability availability.

### 17.8 Use voice in the default chat

1. The user chooses the microphone.
2. If runtime and model are ready, recording starts and stops active speech.
3. Transcription merges with any typed draft.
4. The user reviews or auto-sends according to settings.
5. The assistant response is spoken only when the configured policy applies.
6. Any voice failure leaves text chat and draft state usable.

### 17.9 Bind and trust a workspace

1. A filesystem-dependent task has no usable workspace.
2. The workspace setup surface explains the requirement.
3. The user selects a directory through the trusted picker.
4. Main-process validation binds its canonical identity.
5. If instructions require trust review, the user accepts or dismisses them.
6. Scoped commands, mentions, watcher state, and memory refresh.

## 18. Failure-State Requirements

| Failure                                      | Required behavior                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AI entitlement denied                        | Reject before AI work, retain draft, show plan or account guidance where available                               |
| Reporting capability unavailable             | Keep report action visible but disabled with reason; do not use AI entitlement as the reporting gate             |
| Queue full                                   | Retain the unaccepted draft and show the localized queue-limit message                                           |
| Pending persistence failure                  | Do not display the message as accepted or clear its draft                                                        |
| Provider failure                             | Apply existing retries; when exhausted, pause later queued work and show safe error                              |
| Renderer reload                              | Reconstruct selection, pending rows, live runtime, and durable messages without duplicating execution            |
| Permission decision failure                  | Keep the decision actionable and do not assume permission was granted                                            |
| Plan decision returns null or stale state    | Keep the card and do not start a continuation                                                                    |
| Outbound authorization expires or mismatches | Disable send, rerun review/preflight, and never reuse the token for changed content                              |
| SMTP outcome ambiguous                       | Persist and display delivery unknown; no automatic retry                                                         |
| Generated image missing or unowned           | Reject with stable localized error and keep other valid selections                                               |
| Workspace path unavailable                   | Preserve conversation, disable unsafe filesystem actions, offer change-workspace flow                            |
| Voice runtime or model missing               | Keep text chat available and show install/settings action                                                        |
| Microphone permission denied                 | Preserve the draft and show retry guidance                                                                       |
| Conversation switched during dialog          | Close or rebind only according to the feature contract; never act on the newly selected conversation by accident |

## 19. Performance and Resource Requirements

1. The workspace continues to mount at most the bounded selected-conversation message window.
2. Inactive conversations receive summary events only and do not mount transcript components.
3. Token presentation remains batched rather than causing one Vue update per token.
4. Pending-message and run-summary subscriptions are singleton or reference-counted per renderer and are removed on teardown.
5. Opening reporting, outbound review, workspace memory, or generated-image dialogs does not preload unrelated conversation history.
6. Generated-image thumbnails continue to use lazy loading and existing bounded metadata.
7. Queue recovery and sidebar bootstrap avoid one full-history query per conversation.
8. Voice models and runtimes are not repeatedly checked or installed on every route change.
9. The workspace coordinator and pending queue keep bounded in-memory identity caches.
10. Performance telemetry contains counts and timings only, never user content.

## 20. Observability Requirements

Allowed metrics include:

- accepted, rejected, queued, dispatched, steered, cancelled, paused, resumed, and recovered message counts;
- enqueue-to-dispatch and pending-database transaction duration;
- run status transitions by owner and resource class;
- permission decision outcome by category without preview content;
- plan decision outcome and continuation dispatch outcome;
- outbound review opened, approved, claimed, and terminal outcome counts;
- generated-image chooser, batch confirmation, retry, stop, and stable error-code counts;
- reporting dialog opened, submitted, failed, and capability-unavailable counts;
- voice capability, recording, transcription, playback, install, and error state counts; and
- parity fallback activation and workspace-to-Chat-V2 rollback count.

Metrics must not contain prompts, assistant content, report evidence, tool arguments, recipient addresses, email bodies, filenames, workspace paths, image data, voice audio, tokens, or credentials.

## 21. Rollout Plan

### Phase 0: Characterization and contract lock

- Add workspace characterization tests for the full composer event payload.
- Add tests proving current command, queue, permission, plan, email, image, report, voice, and workspace gaps.
- Define the pending-message-to-run identity and state mapping in technical design.
- Freeze new surface-specific orchestration in `AiChatV2.vue` unless accompanied by workspace parity.

Exit gate: tests describe every requirement group and the technical design resolves queue/run ownership.

### Phase 1: Submission, commands, plans, and permissions

- Extract shared submission and command routing.
- Preserve `onAccepted`, pasted content, voice origin, and attachment behavior.
- Route slash, goal, and scheduled-loop commands correctly.
- Extract plan action continuation behavior.
- Add actionable workspace permission decisions.

Exit gate: ordinary, command, plan, question, and permission journeys pass component and main-process tests.

### Phase 2: Queue and steering

- Integrate durable same-conversation pending messages with workspace run envelopes and global scheduling.
- Add pending bubbles and steer, cancel, and resume actions.
- Reconstruct pending state after selection and restart.
- Run all eight existing queue/steering Electron E2E scenarios against the default route.

Exit gate: all queue/steering E2E scenarios pass without routing to Chat V2.

### Phase 3: Safety-critical specialized results

- Add outbound-email semantic result and review flow.
- Add generated-image semantic result, selection, request fields, batch actions, and save flow.
- Add per-output and conversation-level reporting.

Exit gate: outbound-email, generated-image, and reporting component plus Electron E2E suites pass on `/aiworkspace`.

### Phase 4: Voice, workspace trust, memory, and recovery detail

- Extract shared voice and conversation-workspace orchestration.
- Wire full composer voice state and spoken-response controls.
- Add workspace chooser, required state, trust review, watcher refresh, and memory management.
- Expose retry and recovery details in the workspace hierarchy.

Exit gate: voice, workspace, trust, memory, retry, and recovery parity tests pass in all supported responsive layouts.

### Phase 5: Default-only soak and cleanup decision

- Keep `/aiworkspace` default and collect bounded parity/fallback telemetry.
- Exercise upgrade, restart, multi-window if supported, offline, AI-disabled, and expired-subscription states.
- Confirm no high-severity parity defect remains through the agreed soak period.
- Decide separately whether to remove, retain, or reduce Chat V2.

Exit gate: product, safety, accessibility, QA, and desktop owners approve removal of the rollback dependency.

## 22. Testing Strategy

### 22.1 Component tests

Add or extend tests under `test/vitest/main/components/` for:

- workspace composer payload acceptance and draft retention;
- pending-message rendering and actions;
- slash, goal, and loop routing;
- plan decision success, null response, failure, and continuation;
- permission grant-once, persistent grant, deny, and retry;
- outbound batch card, review dialog, progress, and outcome;
- generated-image actions, tray, chooser, confirmation, retry, stop, and errors;
- per-output and conversation reporting;
- voice readiness, setup, recording, transcription, playback, and failure;
- workspace binding, trust, memory, and watcher state;
- semantic projection deduplication; and
- responsive and keyboard behavior.

The hard component gate is `yarn test:components`.

### 22.2 Main-process and module tests

Cover:

- typed workspace request schemas and malformed inputs;
- AI enablement as the first AI handler check;
- pending identity to run identity mapping;
- FIFO, steering, pause, recovery, and cancellation transitions;
- coordinator scheduling and conversation leases;
- plan continuation idempotency;
- permission continuation identity;
- outbound authorization and delivery claims;
- generated-image ownership and trusted staging;
- reporting capability independence; and
- restart reconciliation.

### 22.3 Electron E2E tests

The default `/aiworkspace` route must pass:

1. The eight existing queue and steering scenarios.
2. Outbound-email draft, review, approval, send, and delivery-unknown behavior.
3. Generated-image edit, round trip, live batch, partial failure, retry, stop, and save.
4. Conversation reporting with capability available, unavailable, AI disabled, and selection limits.
5. Plan approve-to-execute and failed-decision no-execute behavior.
6. Permission grant and deny continuation behavior.
7. Slash, goal, scheduled-loop approval, and loop controls.
8. Voice ready, missing runtime, missing model, permission denial, transcription, and spoken response.
9. Workspace selection, trust review, memory, and scoped slash/mention refresh.
10. Conversation switching while two conversations execute independently.

The hard E2E gate is `yarn test:e2e` in a deterministic loopback-only environment.

### 22.4 Static and localization gates

- `yarn typecheck`
- `yarn vue-typecheck`
- `yarn test:components`
- Existing main-process and utility Vitest suites affected by the change
- Translation-key parity across all six languages
- No new `any` types or implicit return types
- No direct database access in IPC or workers

## 23. Acceptance Criteria

### Submission and commands

1. Given a valid ordinary draft, when the main process accepts it, then the composer clears exactly once.
2. Given a rejected submission, when the error returns, then text, attachments, pasted blocks, and selected images remain.
3. Given `/review` or another registered command, when sent, then the command dispatcher handles it rather than the model receiving the raw command.
4. Given a scheduled-loop command, when sent, then the approval dialog appears before persistence.

### Queue and lifecycle

5. Given A is running, when B is sent, then B appears as a durable queued item and A is not interrupted.
6. Given B is eligible to steer, when Steer is selected, then B modifies A once and never dispatches later.
7. Given A is stopped, when B remains queued, then B pauses until explicit resume.
8. Given the application restarts with pending work, when chat opens, then pending work is visible but no provider request starts automatically.
9. Given conversations A and B both have runnable work, when capacity exists, then they progress independently without event leakage.

### Decisions and specialized results

10. Given a tool awaits permission, when the conversation is selected, then grant and deny actions are available.
11. Given a plan approval returns null, when the request ends, then no execution continuation starts.
12. Given a plan is approved successfully, when the state persists, then exactly one execution continuation starts.
13. Given an outbound draft is ready, when its result renders, then Review is visible and Send remains disabled before approval.
14. Given exact-draft approval and Send, when the user clicks twice or retries the renderer request, then only one delivery claim exists.
15. Given SMTP acceptance is unknown, when delivery terminates, then the workspace shows Delivery Unknown and does not auto-retry.

### Images, reporting, voice, and workspace

16. Given a generated image, when Use as reference is selected, then the correct conversation-scoped reference appears in the composer.
17. Given an ambiguous image-edit request, when sent, then no request starts until the user chooses an image.
18. Given a partially failed image batch, when complete, then successes remain and only failed eligible items can retry.
19. Given an eligible AI output, when Report is selected, then the single-output dialog opens with only allowed evidence.
20. Given AI generation is disabled but reporting capability is available, when Report conversation is selected, then reporting remains usable.
21. Given voice is configured, when the workspace opens, then microphone and spoken-response controls are discoverable.
22. Given voice setup fails, when the user continues typing, then text chat and draft state remain usable.
23. Given no workspace is bound, when a filesystem tool is requested, then the workspace setup flow appears before execution.
24. Given workspace instructions are untrusted, when detected, then the trust review appears and no trust is inferred from a raw renderer path.

### Quality

25. Given any supported language, when the workspace renders a new capability state, then no translation key is missing.
26. Given keyboard-only use, when completing every decision journey, then all controls are reachable and focus returns predictably.
27. Given 200% scaling or narrow layout, when a decision is required, then the primary action remains visible without horizontal page scrolling.
28. Given a conversation is inactive, when private detail events occur, then only bounded summary state reaches its sidebar row.

## 24. Success Metrics

The migration is successful when:

1. All defined parity acceptance tests pass on `/aiworkspace`.
2. The existing queue/steering, outbound-email, generated-image, and reporting E2E suites no longer require a Chat V2 route or dock toggle.
3. No P0 workflow requires users to switch to Chat V2.
4. Accepted ordinary messages are not lost or duplicated across queue, renderer reload, or conversation switching tests.
5. No outbound email sends without exact-draft authorization.
6. No permission or plan waiting state lacks an actionable selected-conversation surface.
7. Translation parity passes for all six languages.
8. Accessibility review finds no blocker for keyboard or screen-reader completion of critical journeys.
9. Workspace fallback usage reaches the agreed removal threshold during soak.
10. No high-severity security, privacy, data-loss, or duplicate-execution defect remains open.

## 25. Risks and Mitigations

| Risk                                                 | Impact                                 | Mitigation                                                                            |
| ---------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Two queue systems dispatch the same message          | Duplicate AI work, tools, or email     | One identity mapping, one dispatch authority, idempotent tests, durable state machine |
| Copying Chat V2 orchestration into workspace         | Future parity drift                    | Extract shared composables/controllers before wiring workspace presentation           |
| Semantic grouping hides required actions             | Runs stall or safety review disappears | Dedicated permission, outbound-email, and image result kinds                          |
| Plan event replay starts duplicate continuation      | Duplicate tool execution               | Persist decision first and use stable continuation idempotency identity               |
| Renderer switch applies events to wrong chat         | Privacy leak or corrupt UI             | Conversation, generation, run, pending, and message identity checks                   |
| Workspace paths cross trust scope                    | Unauthorized filesystem access         | Canonical main-process validation and existing grant service                          |
| Reporting reuses visible transcript indiscriminately | Unrelated private data leaves device   | Deterministic eligibility and evidence builder from reporting contract                |
| Voice extraction changes Chat V2 behavior            | Rollback surface regresses             | Characterization tests before extraction and shared contract tests afterward          |
| Large parent component remains source of truth       | New features continue to drift         | Contribution rule: shared interactive capability cannot ship on one chat surface only |
| Removing Chat V2 too early                           | Users lose a working fallback          | Default-only soak and separate cleanup decision                                       |

## 26. Open Technical Questions

These questions must be resolved in the technical design without changing the user outcomes in this PRD:

1. At what transition is a workspace run envelope created for a pending message: acceptance, global scheduling, or dispatch?
2. Which stable field maps `pendingMessageId`, `clientRequestId`, `runId`, user `messageId`, and assistant `messageId`?
3. How does the workspace event router expose pending lifecycle events without leaking content to inactive conversations?
4. Which current Chat V2 states move into Pinia stores versus renderer-safe composables?
5. How are specialized semantic result payloads normalized so history and live events produce the same view?
6. How does plan continuation claim idempotency across renderer reload and repeated decision response?
7. Which dialogs belong to the chat center versus the shared application overlay host?
8. What bounded telemetry threshold authorizes removal of the Chat V2 rollback surface?

## 27. Traceability to Current Code and Tests

| Area                            | Current implementation or evidence                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default route                   | `src/views/router/index.ts`                                                                                                                         |
| Workspace composition           | `src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue`                                                                                     |
| Workspace transcript            | `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue`                                                                                |
| Selected conversation           | `src/views/store/selectedConversation.ts`                                                                                                           |
| Workspace coordinator           | `src/service/AIChatCoordinator.ts`                                                                                                                  |
| Workspace IPC                   | `src/main-process/communication/ai-chat-workspace-ipc.ts`                                                                                           |
| Workspace schemas               | `src/schemas/ipc/aiChatWorkspace.ts`                                                                                                                |
| Chat V2 orchestration reference | `src/views/components/aiChatV2/AiChatV2.vue`                                                                                                        |
| Shared composer                 | `src/views/components/aiChatV2/AiChatV2Composer.vue`                                                                                                |
| Chat V2 message actions         | `src/views/components/aiChatV2/AiChatV2Message.vue`                                                                                                 |
| Pending-message UI              | `src/views/components/aiChatV2/AiChatV2PendingMessage.vue`                                                                                          |
| Workspace semantic projection   | `src/views/components/aiChatWorkspace/toolExecutionProjection.ts`, `SemanticToolResult.vue`                                                         |
| Queue acceptance suite          | `test/e2e/specs/aiChatQueueSteering.test.ts`                                                                                                        |
| Outbound-email acceptance suite | `test/e2e/specs/outbound-email-review.test.ts`                                                                                                      |
| Generated-image suites          | `test/e2e/specs/ai-chat-generated-image-editing.test.ts`, `ai-chat-generated-image-roundtrip.test.ts`, `ai-chat-generated-image-batch-live.test.ts` |
| Reporting suite                 | `test/e2e/specs/conversationReport.spec.ts`                                                                                                         |
| Workspace transcript tests      | `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`                                                                                     |
| Voice tests                     | `test/vitest/main/components/AiChatV2Composer.voice.test.ts`, `AiChatV2.voiceResponse.test.ts`                                                      |
| Workspace and trust tests       | `test/vitest/main/components/AiChatV2.workspace.test.ts`, `AiChatV2.workspaceTrust.test.ts`, `WorkspaceTrustCard.test.ts`                           |

## 28. Definition of Done

This initiative is complete only when all conditions are true:

1. Every P0 and P1 capability in the baseline matrix has an implemented workspace-native surface.
2. Shared orchestration has replaced duplicate feature logic for submission, commands, plans, permissions, generated images, reporting, voice, and conversation workspace behavior where applicable.
3. The pending-message and workspace-run state machines have one documented identity and dispatch model.
4. All acceptance criteria in this PRD have automated coverage or an explicitly approved manual certification step.
5. `yarn typecheck`, `yarn vue-typecheck`, `yarn test:components`, affected main-process suites, and `yarn test:e2e` pass.
6. English, Chinese, Spanish, French, German, and Japanese translation parity passes.
7. Security review confirms AI gating, permission, workspace trust, outbound-email authorization, reporting privacy, generated-image ownership, IPC validation, and database boundaries.
8. Accessibility review confirms keyboard, screen reader, focus, scaling, touch, and reduced-motion requirements.
9. No critical flow requires navigation to Chat V2.
10. The default-route soak completes without an open high-severity parity defect.
11. Product, safety, desktop, and QA owners approve the capability-parity release.
12. Removal of Chat V2, if desired, is handled by a separate cleanup decision after rollback criteria are satisfied.
