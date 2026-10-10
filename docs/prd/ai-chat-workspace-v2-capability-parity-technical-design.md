# AI Chat Workspace and Chat V2 Capability Parity - Technical Design

## Document Information

| Field                | Value                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Status               | Proposed                                                                                               |
| Version              | 1.0                                                                                                    |
| Date                 | 2026-09-08                                                                                             |
| Owner                | AiFetchly Engineering                                                                                  |
| Product requirements | [AI Chat Workspace and Chat V2 Capability Parity PRD](./ai-chat-workspace-v2-capability-parity-prd.md) |
| Target application   | AiFetchly Electron application                                                                         |
| Primary stack        | TypeScript 5, Electron, Vue 3, Pinia, Vuetify, TypeORM, SQLite                                         |
| Primary route        | `/aiworkspace`                                                                                         |

## 1. Purpose

This document turns the capability-parity PRD into an implementation design for the default AI Chat Workspace. It defines ownership, typed contracts, state machines, persistence, event routing, renderer composition, migration order, testing, rollout, and rollback.

The design preserves two systems that already solve different problems:

1. `AIChatPendingMessageModule` and `AIChatTurnQueueService` own durable user intent, same-conversation FIFO order, steering, pause, resume, cancellation, and restart recovery.
2. `AIChatRunModule`, `AIChatCoordinator`, and `AIChatExecutionScheduler` own durable execution envelopes, cross-conversation admission, resource capacity, runtime summaries, and selected-conversation detail routing.

They must become one pipeline. A message must never be independently dispatchable by both systems.

## 2. Scope

### 2.1 In scope

- Full composer acceptance semantics, including pasted content and voice origin.
- Shared slash-command, goal, and scheduled-loop routing.
- Durable queue integration with the workspace scheduler and run envelope.
- Workspace-native pending, steering, plan, permission, outbound-email, generated-image, reporting, voice, workspace trust, memory, retry, and recovery behavior.
- Shared renderer orchestration extracted from `AiChatV2.vue`.
- Strict IPC validation and Model/Module database boundaries.
- Six-language UI coverage, accessibility, observability, migration, tests, rollout, and rollback.

### 2.2 Out of scope

- Visual duplication of Chat V2.
- Replacing `AIChatQueryEngine` or its provider protocol.
- Combining all resource scheduling and pending-message persistence into one table.
- New outbound-email authorization semantics, report categories, image ownership rules, or speech engines.
- Worker-process database access.
- Immediate deletion of Chat V2.

## 3. Existing-System Findings

### 3.1 Workspace path today

```text
AiChatWorkspaceShell.vue
  -> selectedConversation.sendMessage()
  -> aiChatWorkspace.startChatRun()
  -> ai-chat-workspace-ipc.ts
  -> AIChatCoordinator.startRun()
  -> AIChatRunModule.createRun()
  -> AIChatExecutionScheduler.submit()
  -> AIChatQueryEngine.submitMessage()
```

`AIChatCoordinator.startRun()` rejects a second live run for the same conversation. `selectedConversation.isBusy` passes a busy state to the shared composer, so the workspace cannot accept ordinary follow-ups while a turn runs.

The workspace send handler currently receives text and files but drops the composer's `pastedContents`, `fromVoice`, and `onAccepted` values. It also creates a renderer-only optimistic message before the main process accepts the request.

### 3.2 Chat V2 path today

```text
AiChatV2Composer.vue
  -> AiChatV2.vue command and capability orchestration
  -> AI_CHAT_V2_PENDING_CREATE
  -> AIChatTurnQueueService.submit()
  -> AIChatPendingMessageModule.createPendingMessage()
  -> SQLite pending row
  -> claim oldest row
  -> promote user message transaction
  -> AIChatQueryEngine.submitPersistedUserMessage()
```

This path closes idle-versus-running races by persisting every ordinary send before dispatch. It supports FIFO delivery, explicit steering, per-conversation holds, restart recovery, deterministic user and assistant message identifiers, and atomic transcript promotion.

### 3.3 Presentation gap

`AiChatWorkspaceTranscript.vue` correctly groups tool calls and results into semantic execution rows. Its current semantic result kinds cover summary, artifact, files, images, permission, error, and structured results. Permission is informational, and outbound-email and generated-image batch actions are not first-class results.

Chat V2 currently owns action-heavy behavior in `AiChatV2.vue`, `AiChatV2Messages.vue`, and `AiChatV2Message.vue`. Directly copying that behavior into `AiChatWorkspaceShell.vue` would create a second monolith and future drift.

## 4. Architectural Decisions

### AD-001: Pending intent is the submission source of truth

Every accepted ordinary prompt first becomes an `AIChatPendingMessageEntity`. This is true when the conversation is idle and when it is active. The renderer clears the composer only after that durable receipt returns.

Commands that do not create an AI turn may return a command receipt instead. Commands that expand into an AI prompt re-enter ordinary submission exactly once with a derived idempotency key.

### AD-002: Create the run envelope at global scheduling claim

A pending row does not receive a run envelope at initial acceptance. The queue service creates the run envelope after it claims the FIFO head for dispatch and before it submits that work to the global scheduler.

Reasons:

- A pending message consumed as steering never becomes a separate run.
- Paused and cancelled pending rows do not pollute run history.
- The run table describes execution attempts, while the pending table describes user intent.
- Restart recovery can show accepted intent without contacting the provider or inventing a runnable run.

The durable transition is:

```text
pending queued
  -> pending dispatching, claimToken assigned
  -> run queued, sourceId = pendingMessageId
  -> global scheduler admission
  -> user message promoted and run running
  -> provider execution
  -> run terminal
  -> pending sent or paused/failed as defined below
```

If run creation fails, the claim returns to `queued` or `failed` with a stable code. If scheduler admission cannot proceed because of a conversation lease race, the run stays queued and is requeued with its original enqueue time.

### AD-003: `AIChatRunEntity.sourceId` links interactive runs to pending rows

No new identity column is required for the first implementation. The existing `sourceId` column must be widened from 64 to 100 characters so it can safely hold every valid `pendingMessageId`. Interactive run envelopes set:

```text
owner    = "interactive"
sourceId = pendingMessageId
```

The application enforces one non-terminal interactive run for one `sourceId`. A database index should be added only if SQLite migration policy supports a partial unique index. Otherwise, `AIChatRunModel.createInteractiveRunForPending()` performs an idempotent lookup and insert inside one transaction.

Identity mapping:

| Identity             | Creation                       | Lifetime                            | Link                                                   |
| -------------------- | ------------------------------ | ----------------------------------- | ------------------------------------------------------ |
| `clientRequestId`    | Renderer before submit         | One user submission or continuation | Unique pending idempotency key                         |
| `pendingMessageId`   | Pending module                 | Accepted intent lifecycle           | `AIChatRunEntity.sourceId`                             |
| `userMessageId`      | Pending module at acceptance   | Delivered transcript row            | `user-pending-<pendingMessageId>`                      |
| `runId`              | Run module at scheduling claim | One execution attempt               | Run with `sourceId = pendingMessageId`                 |
| `assistantMessageId` | Queue dispatcher               | One model response                  | `assistant-pending-<pendingMessageId>` and run linkage |

### AD-004: The queue owns per-conversation order; the scheduler owns global capacity

`AIChatTurnQueueService` selects only the oldest eligible pending row for a conversation. It then asks a new run-dispatch bridge to create and schedule the run. `AIChatExecutionScheduler` never queries pending rows and never changes FIFO order.

Only one component may call `submitPersistedUserMessage()` for queue-backed workspace turns: the run-dispatch bridge after scheduler admission.

### AD-005: Pinia stores durable cross-component UI state

Pinia stores hold state that must survive component remounts or serve multiple workspace regions:

- selected conversation snapshot and generation;
- pending-message views by conversation;
- active run and summary state;
- selected generated-image references by conversation;
- workspace binding, trust summary, watcher summary, and memory count;
- session-only reported output IDs;
- overlay descriptors keyed to conversation and source identity.

Renderer-safe composables hold process-local behavior and resources:

- composer submission and command routing;
- plan decisions and continuation;
- permission actions;
- generated-image inference and batch preparation;
- report payload preparation;
- voice recording, transcription, and playback;
- workspace selection and trust flows.

Media streams, timers, `AbortController` instances, callback closures, raw authorization tokens, and raw permission tokens must not enter Pinia persistence or Vue-rendered state.

### AD-006: History and live events share pure projection functions

Specialized semantic results are normalized from `ChatV2MessageView` and live metadata through pure functions. Components receive stable view models, not raw tool payloads. The same projector must produce the same identity and actions after reload.

### AD-007: Plan continuation uses a deterministic client request id

The continuation id is derived from the persisted plan transition:

```text
plan-cont-<first 48 hexadecimal characters of
SHA-256(planId + ":" + version + ":" + decision)>
```

Approval, rejection, and change-request handlers first verify the returned durable plan state. They then submit the continuation through the pending queue. The unique `clientRequestId` makes repeated responses, renderer reloads, and replayed events idempotent.

### AD-008: Dialogs use a shared application overlay host

Dialogs that can outlive one transcript row or require security-sensitive state mount in one shared overlay host below the workspace shell:

- outbound-email review;
- generated-image chooser and batch confirmation;
- single-output and conversation report dialogs;
- workspace chooser, trust review, and memory manager;
- voice setup and settings.

Compact actions and status cards remain next to their source row. The overlay descriptor includes `conversationId` and source identity. Selection changes close or safely reset conversation-bound overlays.

### AD-009: Chat V2 removal requires a bounded soak gate

Removal requires all of the following for a rolling 14-day default-route soak:

- at least 500 accepted workspace submissions across internal or staged users;
- workspace submission acceptance rate at least 99.5 percent, excluding deliberate validation and entitlement rejection;
- no open severity-1 or severity-2 parity defect;
- zero confirmed duplicate delivery, duplicate plan continuation, cross-conversation event, or authorization-bypass incident;
- queue recovery success at least 99 percent for exercised restart cases;
- product, safety, desktop, and QA sign-off.

Low sample volume extends the soak. It never weakens the incident gates.

## 5. Target Architecture

```text
Renderer
  AiChatWorkspaceShell
    Shared composer
    useChatSubmission
    useChatCommands
    usePlanActions
    useToolPermissionActions
    useGeneratedImageWorkflow
    useContentReporting
    useChatVoice
    useConversationWorkspace
    Shared overlay host
    Workspace semantic transcript
            |
            | strict IPC
            v
Main process
  AI gate and Zod validation
  AIChatSubmissionService
    command disposition OR pending queue receipt
  AIChatTurnQueueService
    AIChatPendingMessageModule -> Model -> SQLite
    AIChatWorkspaceRunDispatchBridge
      AIChatRunModule -> Model -> SQLite
      AIChatExecutionScheduler
      AIChatConversationTurnCoordinator lease
      AIChatQueryEngine.submitPersistedUserMessage
  AIChatWorkspaceEventRouter
    summary events to all registered renderers
    detail events to selected conversation only
```

### 5.1 Ownership table

| Concern                             | Owner                                  |
| ----------------------------------- | -------------------------------------- |
| Transport validation                | Zod IPC schemas and handler wrapper    |
| AI enable check                     | IPC handler before parsing or AI work  |
| Command classification              | `AIChatCommandRouter`                  |
| Durable accepted intent             | `AIChatPendingMessageModule` and Model |
| Same-conversation FIFO and steering | `AIChatTurnQueueService`               |
| Run lifecycle                       | `AIChatRunModule` and Model            |
| Global resource admission           | `AIChatExecutionScheduler`             |
| Conversation mutual exclusion       | `AIChatConversationTurnCoordinator`    |
| Provider and tool loop              | `AIChatQueryEngine`                    |
| Summary/detail privacy routing      | `AIChatWorkspaceEventRouter`           |
| Selected transcript state           | `selectedConversation` Pinia store     |
| Capability UI state                 | Focused Pinia stores and composables   |
| Semantic result normalization       | Pure renderer projectors               |
| Overlay lifecycle                   | `AiChatOverlayHost.vue`                |

## 6. Submission Contract

### 6.1 Renderer input

```typescript
export interface ChatComposerSubmission {
  readonly text: string;
  readonly files: readonly File[];
  readonly fromVoice: boolean;
  readonly pastedContents?: Readonly<Record<string, string>>;
  readonly onAccepted: () => void;
}

export type ChatSubmissionDisposition =
  | "command_completed"
  | "command_prompt_queued"
  | "queued"
  | "paused"
  | "dispatch_scheduled";

export interface ChatSubmissionReceipt {
  readonly conversationId: string;
  readonly clientRequestId: string;
  readonly disposition: ChatSubmissionDisposition;
  readonly pendingMessageId?: string;
  readonly acceptedAt: string;
}
```

`useChatSubmission.submit()` captures the selected `conversationId` and generation before asynchronous preparation. It calls `onAccepted()` only after a valid receipt for that same conversation returns. A stale selection may update the captured conversation's store, but it must not clear or mutate the newly selected conversation.

### 6.2 Main-process request

The workspace should stop maintaining a narrower `StartWorkspaceRunRequest`. It should reuse the bounded `ChatV2StreamRequest` fields already accepted by `aiChatPendingCreateInputSchema`:

- message and conversation identity;
- model, temperature, maximum tokens, and system prompt;
- mode, reasoning, and tool approval mode;
- normalized uploaded files;
- pasted contents;
- direct generated-image references;
- trusted confirmed generated-image batch.

Workspace IPC may expose workspace-named channels, but both surfaces must call one `AIChatSubmissionService` and one schema family.

### 6.3 Acceptance rules

1. Check `USER_AI_ENABLED` before parsing AI submission input.
2. Validate strict schemas and byte/count limits.
3. Resolve command disposition before ordinary queue submission.
4. Prepare pasted content, mentions, attachments, and model-facing text once.
5. Persist pending intent and attachments.
6. Return a durable receipt.
7. Clear renderer draft through `onAccepted()`.

Validation, entitlement, queue-limit, file-normalization, and IPC failures return a stable code and safe localized message. They do not invoke `onAccepted()`.

## 7. Command Routing

Create a renderer-safe `useChatCommands` facade over extracted command parsers and typed main-process APIs. It returns a disposition rather than directly mutating Chat V2 component state.

```typescript
export type ChatCommandDisposition =
  | { readonly kind: "not_command" }
  | { readonly kind: "completed"; readonly localExchangeId: string }
  | {
      readonly kind: "submit_prompt";
      readonly expandedPrompt: string;
      readonly continuationKey: string;
    }
  | {
      readonly kind: "rejected";
      readonly code: string;
      readonly message: string;
    };
```

Routing order:

1. Detect leading slash.
2. Parse built-in goal and scheduled-loop commands.
3. Resolve plugin, user, and workspace-scoped commands through the current registry.
4. Execute local-only commands or call their trusted IPC.
5. For prompt expansion, submit once with `clientRequestId = command:<originalRequestId>:<continuationKey>`.
6. Render local success or failure exchanges through a shared local-message helper.

Commands that change execution ownership remain blocked while their contract forbids concurrency. Ordinary text remains queueable.

## 8. Queue, Run, and Dispatch State Machines

### 8.1 Pending-message state machine

```text
                  +---------- steer accepted ----------+
                  |                                    v
accepted -> queued -> steering -> applied
              |          |
              |          +-- race lost --> queued
              |
              +-> dispatching -> sent
              |        |
              |        +-- pre-turn failure --> failed
              |
              +-> paused -> queued
              |
              +-> cancelled
```

Terminal pending states are `applied`, `sent`, `cancelled`, and unrecoverable `failed`. Recoverable failures remain visible with a resume or retry action.

### 8.2 Run state machine

```text
queued -> running -> completed
   |         |  \-> failed
   |         |  \-> cancelled
   |         |  \-> interrupted
   |         +-> awaiting_permission -> running
   |         +-> awaiting_user -> running
   +-> cancelled
   +-> interrupted
```

Run terminal states are immutable. `revision` compare-and-set protects transitions.

### 8.3 Dispatch bridge

Introduce `AIChatWorkspaceRunDispatchBridge` with a narrow interface:

```typescript
export interface QueueDispatchCandidate {
  readonly pendingMessageId: string;
  readonly conversationId: string;
  readonly claimToken: string;
  readonly resourceClass: ChatRunResourceClass;
}

export interface WorkspaceRunDispatchBridge {
  schedule(candidate: QueueDispatchCandidate): Promise<{
    readonly runId: string;
    readonly status: "queued" | "running";
  }>;
  cancelPendingRun(pendingMessageId: string): Promise<boolean>;
}
```

The bridge:

1. Idempotently loads or creates an interactive run with `sourceId` equal to `pendingMessageId`.
2. Registers runtime payload reconstructed from the pending row.
3. Submits the run to the global scheduler.
4. On admission, acquires the conversation lease.
5. Atomically promotes the claimed pending row to a user message.
6. Transitions the run to `running`.
7. Calls `submitPersistedUserMessage()` with deterministic message IDs.
8. Persists the run terminal state before sending terminal detail or summary events.
9. Notifies the queue service to continue, pause, or expose failure.

### 8.4 Terminal mapping

| Engine outcome             | Run outcome           | Queue action                                          |
| -------------------------- | --------------------- | ----------------------------------------------------- |
| Completed                  | `completed`           | Pending is `sent`; drain next head                    |
| User stop                  | `cancelled`           | Pause remaining queued rows                           |
| Exhausted provider failure | `failed`              | Pause remaining queued rows                           |
| Permission wait            | `awaiting_permission` | Keep current run; do not drain                        |
| User question wait         | `awaiting_user`       | Keep current run; do not drain                        |
| Process restart            | `interrupted`         | Recover pending rows to paused; do not auto-run       |
| Pre-promotion failure      | No provider call      | Release or fail pending claim; terminalize run safely |

### 8.5 Steering

Steering remains a queue operation, not a run operation. `reserveSteering`, conditional database claim, mailbox commit, and atomic user-row promotion remain the three-phase protocol. A steering-consumed pending row never gets a run envelope.

Attachments and confirmed image batches are not steerable in the first parity release. The UI derives eligibility from the pending view, not from filename or message text.

### 8.6 Restart reconciliation order

Startup performs these steps without provider calls:

1. Mark abandoned non-terminal run envelopes `interrupted`.
2. Recover `dispatching` and `steering` pending rows using existing transcript evidence.
3. Move unresolved pending work to `paused` with a recovery reason.
4. Rebuild workspace sidebar summaries.
5. Broadcast bounded recovery counts after a renderer registers.
6. Require explicit Resume before any recovered prompt runs.

## 9. Event Routing and Privacy

### 9.1 Event classes

The workspace uses three event classes:

| Class                | Audience                                     | Content policy                                                                      |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Conversation summary | All registered workspace renderers           | Status, attention, unread, timestamps, run id, bounded reason only                  |
| Selected detail      | Renderer subscribed to selected conversation | Full stream and actionable state for matching generation and run                    |
| Pending lifecycle    | Store for its conversation                   | Identity, status, safe preview, action eligibility; full content only when selected |

### 9.2 Pending summary event

```typescript
export interface PendingMessageSummaryEvent {
  readonly conversationId: string;
  readonly pendingMessageId: string;
  readonly status: AIChatPendingMessageStatus;
  readonly queueDepth: number;
  readonly attention: "none" | "recovery" | "failure";
  readonly updatedAt: string;
}
```

Inactive conversations receive this summary only. They do not receive prompt text, pasted contents, attachment names, tool previews, workspace paths, or failure bodies.

When selected, the renderer obtains `AIChatPendingMessageView[]` through the selection snapshot or pending-list call. Detail application requires matching `conversationId`, current selection generation, and, where present, `runId`.

### 9.3 Reconstruction

`SelectConversationResponse` expands to include:

```typescript
export interface SelectedConversationCapabilitySnapshot {
  readonly pendingMessages: readonly AIChatPendingMessageView[];
  readonly runtimeStatus: ConversationRuntimeStatus;
  readonly activeRunId: string | null;
  readonly workspace: ConversationWorkspaceSummary | null;
  readonly plan: AIChatPlanStateView | null;
  readonly permissionRequests: readonly ToolPermissionDecisionView[];
}
```

Persisted history remains authoritative for delivered content. Live runtime overlays only nonterminal state.

## 10. Renderer Architecture

### 10.1 Shell composition

`AiChatWorkspaceShell.vue` becomes a composition root. It selects stores, instantiates composables, binds events, and lays out workspace-native components. It must not implement domain algorithms.

Recommended additions:

| File                                                         | Responsibility                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/views/composables/aiChat/useChatSubmission.ts`          | Full composer contract, captured selection, acceptance callback |
| `useChatCommands.ts`                                         | Slash, goal, and scheduled-loop routing                         |
| `usePlanActions.ts`                                          | Decision validation and idempotent continuation                 |
| `useToolPermissionActions.ts`                                | Grant once, persistent grant, and deny                          |
| `useGeneratedImageWorkflow.ts`                               | Selection, inference, chooser, batch staging, save, retry, stop |
| `useContentReporting.ts`                                     | Per-output and conversation report lifecycle                    |
| `useChatVoice.ts`                                            | Recording, transcription, playback, setup, policy               |
| `useConversationWorkspace.ts`                                | Binding, trust, watcher, memory refresh                         |
| `src/views/store/chatPendingMessages.ts`                     | Pending views keyed by conversation                             |
| `src/views/store/chatGeneratedImageSelection.ts`             | Conversation-scoped image references                            |
| `src/views/store/chatCapabilityOverlay.ts`                   | Safe overlay descriptors, no raw tokens                         |
| `src/views/components/aiChatWorkspace/AiChatOverlayHost.vue` | Shared dialogs                                                  |

### 10.2 Shared versus workspace-native components

Reuse existing components when their behavior and visual contract are surface-neutral:

- `AiChatV2Composer.vue`;
- mode, model, tool-approval, and context selectors;
- plan question controls;
- outbound-email batch and review components;
- report dialogs;
- workspace trust and memory dialogs;
- voice settings surfaces.

Keep workspace-native components where information architecture differs:

- workspace transcript;
- execution group and row;
- run strip;
- activity and artifact inspector;
- pending-message row styled for the workspace timeline;
- semantic result wrapper.

### 10.3 Busy semantics

Split the current single `isBusy` concept:

```typescript
export interface ComposerAvailability {
  readonly canSubmitOrdinaryText: boolean;
  readonly canSubmitCommand: boolean;
  readonly canChangeMode: boolean;
  readonly canChangeModel: boolean;
  readonly canStopActiveRun: boolean;
  readonly reasonCode?: string;
}
```

An active run does not disable ordinary text submission. It may disable mode, model, or commands whose semantics cannot be queued safely. The composer shows Send for queueable input and exposes Stop as a separate active-run action.

## 11. Semantic Result Model

### 11.1 Normalized kinds

Extend `SemanticOutputKind` to include:

```typescript
export type SemanticOutputKind =
  | "summary"
  | "artifact"
  | "files"
  | "images"
  | "generated_image_batch"
  | "permission"
  | "outbound_email"
  | "error"
  | "structured";
```

### 11.2 Stable view identity

Every projected result uses:

```typescript
export interface SemanticResultIdentity {
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly toolCallId: string | null;
  readonly kind: SemanticOutputKind;
}
```

The projector must be pure and deterministic. Live progress may update fields for the same identity but must not produce a second card.

### 11.3 Action descriptors

Projectors expose capabilities, not callbacks:

```typescript
export interface SemanticResultAction {
  readonly type:
    | "grant_permission_once"
    | "grant_permission_persistent"
    | "deny_permission"
    | "review_outbound_email"
    | "open_generated_image"
    | "use_generated_image"
    | "edit_generated_image"
    | "save_generated_image"
    | "retry_generated_image_batch"
    | "stop_generated_image_batch"
    | "report_output";
  readonly enabled: boolean;
  readonly reasonCode?: string;
}
```

The component emits identity plus action type. A composable resolves the trusted operation. Raw tokens never appear in an action descriptor.

## 12. Capability Designs

### 12.1 Plans and questions

- Keep one latest plan lifecycle surface in the transcript and the full document in Activity.
- Disable decision controls while an IPC call is in flight.
- Verify plan id, version, and expected returned state before success UI.
- Submit deterministic continuation only after persistence.
- Keep decision controls actionable after stale version, null response, validation failure, or persistence failure.
- Use the queue for continuation so a running turn cannot cause duplicate direct submission.

### 12.2 Tool permissions

- Project permission metadata into an actionable `ToolPermissionDecisionView`.
- Display tool, category, bounded preview, shell preview when allowed, and canonical workspace context.
- Call existing trusted permission IPC for grant once, persistent grant, or deny.
- Keep raw permission continuation tokens in the main process.
- Resume the exact paused tool once after a successful grant.
- On failure, keep the card and announce the safe error.
- Inactive conversations receive only `attention = permission`.

### 12.3 Outbound email

- Recognize `draft_outbound_email_batch` and delivery metadata as `outbound_email`.
- Reuse `OutboundEmailBatchCard` and `OutboundEmailReviewDialog` inside the overlay host.
- Preserve frozen revision, preflight, exact-content authorization, one-time claim, and `delivery_unknown` semantics.
- Keep authorization tokens in composable closure memory only.
- Reconstruct the persistent transcript receipt from durable tool-result metadata after dialog closure or reload.
- Never route this action through general tool approval alone.

### 12.4 Generated images

- Store opaque `{ messageId, imageIndex }` references by conversation.
- Clear or switch selection when conversation identity changes.
- Reuse deterministic explicit, recent-context, and unambiguous-text inference.
- Open a chooser on ambiguity.
- Enforce the direct reference maximum and use trusted confirmed-batch staging above it.
- Preserve selected order.
- Project batch progress and terminal results under one stable tool-call identity.
- Retry only eligible failed generated-image references.
- Stop remaining work without deleting completed output.
- Resolve Save through the trusted canonical workspace path flow.

### 12.5 Reporting

- Use `buildChatV2Descriptor` or a surface-neutral renamed equivalent for per-output eligibility.
- Keep report action visible when capability checks fail, with a safe reason.
- Open the real report dialog through the overlay host.
- Conversation reporting uses the existing snapshot, eligibility, selection, consent, truncation, and payload builders.
- Exclude tool calls/results, reasoning, prompts, permission data, attachments, paths, and unrelated messages.
- Keep reported IDs in a session-only Set keyed by conversation and output id.
- Reporting IPC remains independent from hosted-AI enablement and credits.

### 12.6 Voice

- Move recorder, transcription, runtime/model readiness, install progress, settings, and playback policy into `useChatVoice`.
- Pass all current voice props to the shared composer.
- Starting recording stops speech playback but does not cancel an AI run.
- Auto-send uses the same submission path and acceptance callback as typed text.
- Playback follows the selected conversation and response policy.
- Selection change, Stop, new recording, or speech disablement cancels inappropriate playback.
- Voice errors never clear composer content or image references.

### 12.7 Workspace trust, watcher, and memory

- Expose the bound workspace and trust summary near conversation context.
- Use existing main-process canonical path validation for choose, change, and remove.
- Refresh command scope, mention scope, trust state, watcher state, and memory count after a binding change.
- Mount trust review and memory management in the overlay host.
- Keep watcher selection lifecycle separate from background execution ownership.
- Never log workspace paths or file content in general analytics or reports.

### 12.8 Retry, recovery, and context

- Keep high-level status in `AiChatRunStrip`.
- Put attempt, maximum, bounded delay, recovery layer, reason, and safe details in the transcript or Activity.
- Use stable error-code-to-i18n mapping.
- Prefer the newest authoritative usage update and selected model context window.
- Keep compaction engine-owned; expose its completion or failure through normal event projection.

## 13. Persistence Changes

### 13.1 Run model API

Add an idempotent method through Model and Module layers:

```typescript
export interface CreateInteractiveRunForPendingInput {
  readonly conversationId: string;
  readonly pendingMessageId: string;
  readonly resourceClass: ChatRunResourceClass;
}

createInteractiveRunForPending(
  input: CreateInteractiveRunForPendingInput
): Promise<AIChatRunEntity>;
```

The Model queries `owner = interactive AND sourceId = pendingMessageId`. It validates conversation identity on reuse. It never creates a second non-terminal run for the same pending message.

### 13.2 Pending model changes

Do not move database logic into the coordinator or IPC handler. Add Module/Model methods for any needed transitions, such as:

- claim oldest for workspace scheduling;
- release scheduling claim;
- link or validate a run source identity if required for diagnostics;
- pause after terminal failure or cancellation;
- list selected-conversation views in one bounded query.

Do not store raw pasted cache bodies, permission tokens, outbound authorization tokens, or generated-image bytes in the run entity.

### 13.3 Transactions and ordering

The critical ordering rules are:

1. Pending persistence precedes acceptance receipt.
2. Pending claim precedes run creation.
3. Run creation precedes global scheduler submission.
4. User transcript promotion precedes provider submission.
5. Run terminal persistence precedes terminal detail and summary events.
6. Plan decision persistence precedes continuation submission.
7. Email authorization claim precedes SMTP work.

## 14. IPC and Security

### 14.1 Handler template

Every AI submission or AI action handler follows this order:

```text
Token + USER_AI_ENABLED gate
  -> strict schema parse
  -> sanitize and normalize
  -> call service/module
  -> map stable error code
  -> return renderer-safe DTO
```

Reporting handlers keep their existing entitlement-independent contract. Permission, email, workspace, image, and reporting handlers retain their domain-specific security checks.

### 14.2 Required contract work

- Replace the narrow workspace start-run schema with the shared submission schema or a schema composed from the same source.
- Add workspace-safe pending list, steer, cancel, and resume APIs, or route both surfaces through neutral channel names during migration.
- Add pending lifecycle summary/detail event schemas.
- Add strict action schemas for semantic result events.
- Keep channel allowlists synchronized in `channellist.ts` and `preload.ts`.
- Parse every renderer payload as `unknown`.

### 14.3 Data minimization

- Summary events contain no prompt or tool bodies.
- Error summaries are bounded and scrubbed.
- Raw permission and outbound authorization tokens stay out of DOM, Pinia, logs, and analytics.
- Renderer-provided paths are never authority for filesystem access.
- Generated-image references are opaque identities validated against conversation ownership.
- Report builders use explicit allowlists.

## 15. Failure Handling

| Failure                | Required behavior                                                     |
| ---------------------- | --------------------------------------------------------------------- |
| Submission validation  | Keep draft, focus invalid control, show localized error               |
| AI disabled            | Reject before parsing or AI work; keep draft                          |
| Queue limit            | Keep draft and explain limit                                          |
| Pending persistence    | No acceptance callback; no optimistic durable claim                   |
| Run creation           | Release or fail pending claim; no provider call                       |
| Scheduler/lease race   | Preserve run id and enqueue time; retry admission                     |
| User promotion         | Fail or pause pending; terminalize run; no provider call              |
| Provider exhaustion    | Fail run and pause remaining queue                                    |
| Stop                   | Cancel active run and pause remaining queue                           |
| Permission action IPC  | Keep actionable card and announce error                               |
| Plan stale version     | Keep plan card, reload state, do not continue                         |
| Email delivery unknown | Show unknown, do not describe success or auto-retry                   |
| Image partial batch    | Keep successes, offer eligible failed references                      |
| Voice runtime failure  | Keep all draft state and open setup path                              |
| Selection race         | Apply result only to captured conversation and generation             |
| Renderer reload        | Reconstruct from history, pending rows, run state, and domain records |

## 16. Accessibility and Localization

### 16.1 Accessibility

- All queue, permission, plan, email, image, report, voice, trust, and recovery actions support keyboard activation.
- Status uses text and iconography, never color alone.
- New actionable or terminal state is announced once in the selected conversation.
- Inactive-conversation updates do not steal focus or announce private content.
- Dialog focus is trapped, restored to the source action, and reset on selection change.
- Touch targets remain at least 44 by 44 CSS pixels where practical.
- Layout works at 200 percent zoom and narrow workspace width.
- Motion respects reduced-motion settings.

### 16.2 Localization

Every new user-facing key is added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Stable error and status codes map to translation keys in one shared utility. Dynamic values use named interpolation. Components keep the required English fallback.

## 17. Performance and Resource Controls

- Keep the selected transcript bounded at 200 mounted messages and page older history.
- Batch token updates through the existing workspace stream presenter.
- Do not rebuild the full sidebar on each pending or run event.
- Pending summary events update one conversation projection.
- Preserve scheduler capacities: general 1 to 3, browser 1, CPU 2, artifact batch 3.
- Preserve scheduler aging and original enqueue timestamps across requeue.
- Project semantic results with memoized computed inputs and stable identities.
- Lazily mount heavy dialogs and voice setup components.
- Revoke object URLs and stop media tracks on teardown.

## 18. Observability

### 18.1 Counters

- `ai_chat_workspace_submission_accepted_total{disposition}`
- `ai_chat_workspace_submission_rejected_total{code}`
- `ai_chat_pending_created_total`
- `ai_chat_pending_scheduled_total`
- `ai_chat_pending_steered_total`
- `ai_chat_pending_paused_total{reason}`
- `ai_chat_run_created_total{owner,resource_class}`
- `ai_chat_run_terminal_total{status,error_code}`
- `ai_chat_workspace_action_total{capability,action,outcome}`
- `ai_chat_workspace_projection_fallback_total{tool_name}`
- `ai_chat_workspace_cross_conversation_event_rejected_total`

### 18.2 Timings

- submit click to durable acceptance;
- acceptance to scheduling claim;
- scheduling claim to run admission;
- run admission to provider start;
- steering click to safe boundary;
- permission decision to resumed execution;
- plan decision to continuation acceptance;
- selection request to reconstructed transcript;
- renderer event receipt to projected UI state.

### 18.3 Logging rules

Logs may contain stable identities, state names, counts, durations, and bounded error codes. They must not contain prompt text, pasted bodies, attachment content, workspace paths, raw permission tokens, outbound authorization tokens, report payloads, or generated-image bytes.

## 19. Migration Plan

### Phase 0: Characterize and lock contracts

1. Add characterization tests around Chat V2 submission, command, plan, permission, image, report, voice, and workspace workflows.
2. Add workspace tests that demonstrate each current gap.
3. Define neutral shared types and semantic action descriptors.
4. Add telemetry without changing user behavior.

Exit: tests document current behavior and strict types compile.

### Phase 1: Shared renderer orchestration

1. Extract submission, command, plan, and permission composables from Chat V2.
2. Make Chat V2 consume the extracted implementations first.
3. Add the shared overlay host.
4. Integrate the workspace shell.

Exit: both surfaces pass existing Chat V2 tests for these capabilities.

### Phase 2: Queue and run composition

1. Add idempotent run creation by pending source id.
2. Add `AIChatWorkspaceRunDispatchBridge`.
3. Route workspace ordinary sends through the pending service.
4. Add workspace pending rows and actions.
5. Remove direct workspace calls to `AIChatCoordinator.startRun()` for ordinary prompts.
6. Keep coordinator support for non-queue owners and transition it toward the bridge.

Exit: queue/steering E2E scenarios pass through `/aiworkspace`.

### Phase 3: Specialized results and safety flows

1. Add permission action projection.
2. Add outbound-email projection and overlay.
3. Add generated-image actions, chooser, batch, retry, stop, and save.
4. Add per-output and conversation reporting.

Exit: safety-critical E2E suites pass from the default route.

### Phase 4: Voice, workspace, memory, and recovery

1. Integrate shared voice orchestration.
2. Integrate workspace binding, trust, watcher, and memory management.
3. Add retry and recovery detail.
4. Complete accessibility and six-language coverage.

Exit: component, integration, accessibility, and localization gates pass.

### Phase 5: Soak and cleanup decision

1. Keep Chat V2 available as rollback.
2. Run the 14-day bounded soak.
3. Review telemetry and incidents against AD-009.
4. Decide removal in a separate change.

## 20. File-Level Implementation Plan

### 20.1 Main process and shared types

| File                                                      | Planned change                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/entityTypes/aiChatWorkspaceTypes.ts`                 | Add submission receipts, pending summaries, capability snapshot, semantic action contracts |
| `src/schemas/ipc/aiChatWorkspace.ts`                      | Compose full submission and pending action schemas                                         |
| `src/entity/AIChatRun.entity.ts`                          | Widen `sourceId` to 100 characters; document and enforce pending identity mapping          |
| `src/model/AIChatRun.model.ts`                            | Idempotent lookup/create by pending source id                                              |
| `src/modules/AIChatRunModule.ts`                          | Expose run creation business method                                                        |
| `src/service/AIChatTurnQueueService.ts`                   | Delegate claimed heads to run-dispatch bridge                                              |
| `src/service/AIChatCoordinator.ts`                        | Share run execution path; stop direct ordinary workspace submission                        |
| `src/service/AIChatWorkspaceRunDispatchBridge.ts`         | Compose pending claims, runs, scheduler, lease, and engine                                 |
| `src/service/AIChatWorkspaceEventRouter.ts`               | Route pending summaries and selected details                                               |
| `src/main-process/communication/ai-chat-workspace-ipc.ts` | Gate, validate, and call shared services only                                              |
| `src/config/channellist.ts`                               | Add or neutralize pending and action channels                                              |
| `src/preload.ts`                                          | Maintain invoke/send/receive allowlists                                                    |

### 20.2 Renderer

| File                                                                     | Planned change                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue`          | Become composition root and bind full composer/actions                    |
| `src/views/store/selectedConversation.ts`                                | Reconstruct pending and capability snapshot; remove direct start-run path |
| `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue`     | Render pending rows and emit semantic actions                             |
| `src/views/components/aiChatWorkspace/toolExecutionProjection.ts`        | Normalize permission, outbound email, and image batches                   |
| `src/views/components/aiChatWorkspace/SemanticToolResult.vue`            | Render specialized workspace-native result surfaces                       |
| `src/views/components/aiChatWorkspace/AiChatOverlayHost.vue`             | Host shared dialogs safely                                                |
| `src/views/components/aiChatWorkspace/AiChatWorkspacePendingMessage.vue` | Workspace pending lifecycle and actions                                   |
| `src/views/composables/aiChat/*`                                         | Shared capability orchestration                                           |
| `src/views/store/chatPendingMessages.ts`                                 | Conversation-keyed pending state                                          |
| `src/views/store/chatGeneratedImageSelection.ts`                         | Conversation-keyed image selection                                        |
| `src/views/api/aiChatWorkspace.ts`                                       | Full typed submission and pending APIs                                    |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts`                                  | Complete new UI translations                                              |

## 21. Verification Strategy

### 21.1 Unit and module tests

- Run creation is idempotent by pending source identity.
- Pending claim and run creation failure cannot duplicate or lose intent.
- FIFO heads alone enter global scheduling.
- Steering-consumed rows never create run envelopes.
- Scheduler requeue preserves identity, owner, class, and age.
- Restart recovery performs no provider call.
- Terminal persistence precedes routed terminal events.
- Plan continuation id is deterministic.
- Semantic projectors produce equal view identity from live and history inputs.
- Summary redaction excludes all private fields.

### 21.2 Component tests

Add or extend tests under `test/vitest/main/components/` for:

- full composer acceptance and draft retention;
- workspace pending statuses, Steer, Cancel, and Resume;
- command routing and local errors;
- plan decision retry and continuation;
- actionable permission decisions;
- outbound-email card and review overlay;
- generated-image selection, chooser, batch progress, retry, stop, and save;
- output and conversation reporting;
- voice readiness, recording, transcription, and playback policy;
- workspace trust and memory actions;
- retry and recovery detail;
- selection-race and overlay-reset behavior;
- keyboard, focus, announcements, and localized labels.

### 21.3 Main-process integration tests

- AI gate runs before schema parse and service construction.
- Workspace and Chat V2 submission channels call one service.
- Pending attachment bytes promote without moving or duplicating data.
- Run and pending terminal mapping remains consistent on every engine outcome.
- Permission and email actions resume or claim exactly once.
- Generated-image references fail closed on conversation mismatch.
- Report endpoints remain available independently of AI credits.

### 21.4 Electron E2E release gates

Run critical flows from `/`, verifying it resolves to `/aiworkspace`:

1. Queue two follow-ups, steer one, and deliver the other once.
2. Stop active work, reload, and explicitly resume paused work.
3. Approve, revise, and answer a plan without duplicate continuation.
4. Grant once, persistently grant, and deny a tool permission.
5. Review and send outbound email with duplicate-click protection and delivery-unknown handling.
6. Select, edit, batch, retry, stop, and save generated images.
7. Report one output and a selected conversation subset.
8. Record, transcribe, auto-send, and play a voice response.
9. Bind, trust, change, and remove a workspace; manage memory.
10. Switch conversations during active work and verify no cross-application.

### 21.5 Required commands

```bash
yarn typecheck
yarn vue-typecheck
yarn test:components
yarn testmain
yarn test:e2e
```

Use the repository's actual script aliases if `package.json` differs. UI changes and their component tests commit together.

## 22. Requirement Traceability

| PRD group       | Design sections | Primary verification                             |
| --------------- | --------------- | ------------------------------------------------ |
| FR-SUB-001..009 | 6, 10.3, 14     | Composer and IPC component/integration tests     |
| FR-CMD-001..009 | 7, 10           | Slash, goal, and scheduled-loop tests            |
| FR-QUE-001..014 | 4.1..4.4, 8, 13 | Queue service tests and queue/steering E2E       |
| FR-PLN-001..009 | 4.7, 12.1       | Plan component and idempotency tests             |
| FR-PER-001..008 | 11, 12.2, 14    | Permission component and continuation tests      |
| FR-OUT-001..010 | 11, 12.3        | Outbound-email component and E2E suites          |
| FR-IMG-001..015 | 11, 12.4        | Generated-image component and E2E suites         |
| FR-RPT-001..009 | 12.5, 14.3      | Reporting component, utility, and E2E suites     |
| FR-VOI-001..010 | 12.6            | Composer voice and response E2E tests            |
| FR-WSP-001..010 | 12.7, 14.3      | Workspace trust, watcher, and memory tests       |
| FR-REC-001..008 | 8.6, 12.8, 15   | Recovery unit, component, and restart E2E tests  |
| FR-LIF-001..006 | 9, 10, 15       | Selection race and background-run E2E tests      |
| A11Y-001..010   | 16.1            | Component accessibility and manual certification |

## 23. Rollout and Rollback

### 23.1 Feature flags

Use independently controllable flags for:

- shared renderer orchestration;
- workspace pending queue;
- workspace specialized results;
- workspace voice and memory parity;
- Chat V2 visibility.

Flags choose presentation or dispatch adapters. They must not change authorization rules, database ownership, or persisted identity formats.

### 23.2 Rollback

If workspace presentation regresses, route users to Chat V2 while leaving shared main-process queue and run persistence intact. Do not roll back by deleting pending rows or run records. A rollback build must understand all newly persisted states even if it does not expose every new workspace control.

### 23.3 Compatibility

- New event consumers ignore unknown fields.
- Main-process schemas remain strict for renderer input.
- Existing terminal statuses retain meaning.
- Database additions are additive until Chat V2 removal is separately approved.
- Startup reconciliation tolerates rows created by the prior release.

## 24. Risks and Mitigations

| Risk                                           | Mitigation                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Two dispatch authorities execute one message   | One bridge owns queue-backed engine submission; source-id idempotency |
| Renderer clears rejected drafts                | Acceptance callback only after durable or command receipt             |
| Run and pending states diverge                 | Explicit terminal mapping and integration invariants                  |
| Shared composables become another monolith     | One capability per composable with typed ports                        |
| Specialized live and history views differ      | Pure deterministic projectors and identity tests                      |
| Security tokens leak into reactive state       | Keep tokens in main process or closure memory; DTO allowlists         |
| Selection races apply private data incorrectly | Conversation, generation, run, and source identity checks             |
| Queue recovery unexpectedly contacts provider  | Recovery API contains no dispatch call; explicit Resume gate          |
| Chat V2 removal happens with weak evidence     | Fixed 14-day, volume, reliability, incident, and sign-off gate        |

## 25. Implementation Invariants

The implementation is invalid if any invariant fails:

1. One accepted ordinary send creates at most one pending row.
2. One pending row creates at most one active interactive run.
3. A steering-consumed row creates no independent run.
4. Provider submission occurs only after durable user-message promotion.
5. Terminal UI events follow durable run transition.
6. Inactive-conversation events contain no transcript or tool bodies.
7. A plan transition creates at most one continuation pending row.
8. Permission and outbound authorization tokens never enter persisted renderer state.
9. Renderer paths never authorize filesystem access.
10. Worker processes never access SQLite.
11. Ordinary follow-up text remains acceptable while a turn runs.
12. Rejected submission never clears draft state.

## 26. Definition of Done

Implementation is complete when:

1. The default workspace passes every PRD acceptance criterion.
2. All ordinary submissions use the durable pending queue.
3. Pending identity and run identity follow AD-002 and AD-003.
4. Shared orchestration replaces capability logic copied from Chat V2.
5. Workspace semantic results support every required actionable result.
6. Main-process AI handlers gate first, validate strictly, and delegate database work through Modules and Models.
7. All six language files contain every new key.
8. Component, main-process, module, integration, and critical Electron E2E tests pass.
9. Security and accessibility reviews pass.
10. Chat V2 remains available until the bounded removal gate passes and a separate cleanup decision is approved.

## 27. Related Documentation

- [AI Chat Workspace and Chat V2 Capability Parity PRD](./ai-chat-workspace-v2-capability-parity-prd.md)
- [AI Chat Message Queue and Steering Technical Design](../ai-chat-message-queue-technical-design.md)
- [AI Chat Message Queue and Steering PRD](../ai-chat-message-queue-prd.md)
- [Generated-Image Editing Technical Design](./ai-chat-generated-image-editing-technical-design.md)
- [Intent-Aware AI Outbound Email Delivery Technical Design](./ai-outbound-email-intent-aware-delivery-technical-design.md)
