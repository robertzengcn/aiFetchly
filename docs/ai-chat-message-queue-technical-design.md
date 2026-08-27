# AI Chat Message Queue and Steering - Technical Design

## 1. Document Information

- **Status:** Proposed
- **Version:** 1.0
- **Date:** 2026-08-21
- **Target:** AI Chat V2 in the Electron application
- **Product requirements:** [AI Chat Message Queue and Steering PRD](./ai-chat-message-queue-prd.md)
- **Related architecture:**
  - [AI Chat Query Engine Technical Design](./ai-chat-query-engine-technical-design.md)
  - [AI Chat Query Engine PRD](./ai-chat-query-engine-prd.md)
  - [OpenAI-Compatible Chat V2 PRD](./openai-compatible-chat-v2-prd.md)

## 2. Purpose

This document turns the queue and steering PRD into an implementation design for the current AiFetchly codebase.

The design has two product guarantees:

1. A message accepted while AI work is active is durably queued and cannot disappear on conversation switch or application restart.
2. A queued text message becomes steering only after the user explicitly clicks **Steer**, and the running turn consumes it at a safe boundary without starting obsolete tools.

The implementation stays inside the Electron application. The remote AI server remains a stateless OpenAI-compatible completion gateway.

## 3. Scope

### 3.1 Included

- Durable, conversation-scoped pending messages.
- FIFO normal dispatch.
- Explicit text-only steering.
- Safe-boundary checks inside `AIChatQueryLoop`.
- Protocol-valid synthetic results for skipped tool calls.
- Queue pause, resume, cancellation, restart recovery, and clearing.
- Main-process lifecycle broadcasts and renderer reconciliation.
- Reuse of the existing attachment BLOB table for queued attachments.
- Cancellation propagation fixes required for truthful Stop behavior.
- Unit, component, IPC, and Electron end-to-end coverage.

### 3.2 Excluded

- Injecting steering into an open HTTP response stream.
- Aborting a provider request solely to apply steering.
- Interrupting a tool in the middle of an external side effect.
- Steering with attachments in version 1.
- Queue editing or drag-and-drop ordering.
- Server-owned run state or a new server steering endpoint.
- Steering scheduled or goal-loop runs.

## 4. Current System

### 4.1 Current request path

```text
AiChatV2Composer.vue
  -> AiChatV2.vue::onSend()
  -> views/api/aiChatV2.ts::streamChatV2Message()
  -> preload channel allowlist
  -> ai-chat-v2-ipc.ts::handleStream()
  -> AIChatQueryEngine::submitMessage()
  -> AIChatQueryLoop::run()
  -> AiChatApi.openAIChatCompletionStream()
  -> SkillExecutor / ToolJobRegistry
```

The renderer currently refuses ordinary sends when `chatIsRunning` is true. The composer also replaces Send with Stop while streaming. In the main process, `AIChatQueryEngine.activeTurns` owns one active interactive turn per conversation. `AIChatQueryLoop` executes model rounds and tool calls sequentially, which gives steering deterministic safe boundaries.

### 4.2 Current persistence

- Delivered messages live in `ai_chat_messages` through `AIChatMessageModel`, `AIChatModule`, and `AIChatV2Module`.
- Uploaded bytes live in `ai_chat_attachments` through `AIChatAttachmentModel` and `AIChatAttachmentModule`.
- `AIChatContextAssembler` reads delivered history. Pending messages must remain outside this path until dispatch or steering application.
- TypeORM currently uses `synchronize` because `DB_MIGRATIONS` is empty. The new entity must still be registered in `DB_ENTITIES`. If migration cutover occurs before this feature ships, an incremental migration must also be registered.

### 4.3 Current cancellation gap

`ToolJobRegistry` exposes `onCancel`, but `AIChatQueryLoop.executeAsyncTool()` does not register a handler or pass a cancellation signal to `deps.executeTool`. `run_subagent` receives `context.signal` but does not pass it to `AgentRuntime.runSync()`, even though `AgentRuntime` already supports `deps.signal`.

This means a registry job can be labelled `cancelled` while the underlying work continues. Phase 0 fixes this before queue steering is enabled.

## 5. Target Architecture

```text
Renderer
  -> pending-message-create IPC
  -> AIChatTurnQueueService
       -> AIChatPendingMessageModule
            -> AIChatPendingMessageModel -> SQLite
       -> AIChatConversationTurnCoordinator
       -> AIChatQueryEngine
            -> AIChatTurnControl / SteeringMailbox
            -> AIChatQueryLoop safe-boundary checks
       -> AIChatV2EventBroadcaster
  -> pending lifecycle + stream events
  -> renderer merges delivered and pending views
```

### 5.1 Ownership

| Concern | Owner |
| --- | --- |
| Durable pending rows and transitions | `AIChatPendingMessageModel` |
| Business rules, limits, and DTO sanitization | `AIChatPendingMessageModule` |
| Submission routing, dispatch, pause, and recovery | `AIChatTurnQueueService` |
| Active turn and steering reservation | `AIChatQueryEngine` / `AIChatTurnControl` |
| Boundary detection and transcript mutation | `AIChatQueryLoop` |
| Delivered transcript rows | Existing `AIChatV2Module` / `AIChatModule` |
| Pending and stream broadcasts | `AIChatV2EventBroadcaster` |
| Queue display and user actions | AI Chat V2 renderer components |

IPC handlers never access TypeORM repositories. The query loop never imports a Model or Module. It receives a narrow runtime-control interface.

## 6. New Files and Changed Files

### 6.1 New files

| File | Responsibility |
| --- | --- |
| `src/entity/AIChatPendingMessage.entity.ts` | Pending-message table mapping |
| `src/model/AIChatPendingMessage.model.ts` | Atomic state changes and transcript promotion |
| `src/modules/AIChatPendingMessageModule.ts` | Validation, limits, views, and cleanup |
| `src/service/AIChatPendingMessagePreparationService.ts` | Send-time pasted text, mention, attachment, and model-content preparation |
| `src/service/AIChatTurnQueueService.ts` | Submission routing and queue drain |
| `src/service/AIChatTurnControl.ts` | Per-turn steering reservation and mailbox |
| `src/service/AIChatV2EventBroadcaster.ts` | Window-safe pending and interactive stream broadcasts |
| `src/schemas/ipc/aiChatPendingMessage.ts` | Strict Zod request schemas |
| `src/views/components/aiChatV2/AiChatV2PendingMessage.vue` | Pending bubble actions and status |
| `test/vitest/main/modules/AIChatPendingMessageModule.test.ts` | Module/model behavior |
| `test/vitest/main/service/AIChatTurnQueueService.test.ts` | Queue orchestration |
| `test/vitest/main/service/AIChatQueryLoopSteering.test.ts` | Boundary behavior |
| `test/vitest/main/components/AiChatV2PendingMessage.test.ts` | Pending bubble behavior |

### 6.2 Changed files

- `src/config/dbEntities.ts`
- `src/entityTypes/aiChatV2Types.ts`
- `src/entityTypes/skillTypes.ts`
- `src/model/AIChatAttachment.model.ts`
- `src/modules/AIChatAttachmentModule.ts`
- `src/modules/AIChatV2Module.ts`
- `src/service/AIChatQueryEngine.ts`
- `src/service/AIChatQueryLoop.ts`
- `src/service/AIChatQueryEvents.ts`
- `src/service/AIChatConversationTurnCoordinator.ts`
- `src/service/ToolJobRegistry.ts`
- `src/service/agentTools/runSubagentTool.ts`
- `src/main-process/communication/ai-chat-v2-ipc.ts`
- `src/main-process/communication/index.ts`
- `src/config/channellist.ts`
- `src/preload.ts`
- `src/views/api/aiChatV2.ts`
- `src/views/components/aiChatV2/AiChatV2.vue`
- `src/views/components/aiChatV2/AiChatV2Composer.vue`
- `src/views/components/aiChatV2/AiChatV2Messages.vue`
- `src/views/components/aiChatV2/AiChatV2Message.vue`
- `src/views/lang/{en,zh,es,fr,de,ja}.ts`
- related Vitest and Electron E2E specs

## 7. Persistence Design

### 7.1 Pending-message entity

```typescript
export type AIChatPendingMessageStatus =
  | "queued"
  | "steering"
  | "applied"
  | "dispatching"
  | "sent"
  | "paused"
  | "cancelled"
  | "failed";

@Entity("ai_chat_pending_messages")
@Index(["pendingMessageId"], { unique: true })
@Index(["clientRequestId"], { unique: true })
@Index(["conversationId", "status", "id"])
@Index(["status", "updatedAt"])
@Index(["targetAssistantMessageId"])
export class AIChatPendingMessageEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("varchar", { length: 100 })
  pendingMessageId!: string;

  @Column("varchar", { length: 100 })
  clientRequestId!: string;

  @Column("varchar", { length: 100 })
  conversationId!: string;

  @Column("varchar", { length: 100 })
  userMessageId!: string;

  @Column("text")
  content!: string;

  @Column("text")
  modelContent!: string;

  @Column("varchar", { length: 20 })
  status!: AIChatPendingMessageStatus;

  @Column("text", { nullable: true })
  requestOptionsJson?: string;

  @Column("text", { nullable: true })
  attachmentMetadataJson?: string;

  @Column("text", { nullable: true })
  messageMetadataJson?: string;

  @Column("varchar", { length: 100, nullable: true })
  claimToken?: string;

  @Column("varchar", { length: 100, nullable: true })
  targetAssistantMessageId?: string;

  @Column("varchar", { length: 30, nullable: true })
  steeringBoundary?: AIChatSafeBoundary;

  @Column("varchar", { length: 100, nullable: true })
  sentMessageId?: string;

  @Column("varchar", { length: 80, nullable: true })
  failureCode?: string;

  @Column("text", { nullable: true })
  failureMessage?: string;

  @Column("varchar", { length: 80, nullable: true })
  recoveryReason?: string;

  @Column("int", { default: 0 })
  attemptCount!: number;

  @Column("datetime", { nullable: true })
  claimedAt?: Date;

  @Column("datetime", { nullable: true })
  terminalAt?: Date;
}
```

`id` is the monotonic FIFO sequence inside one user database. Ordering is `id ASC`; no `MAX(sequence) + 1` query is used because that creates a race condition, meaning two operations can observe the same old value and choose the same next value.

`content` is the renderer-facing text saved later on the normal user row. `modelContent` is the already-resolved text used in model context. It may include expanded paste bodies, resolved @-mention context, and durable attachment references. Keeping them separate prevents hidden model context from appearing in the user bubble.

### 7.2 Pending-message view

```typescript
interface AIChatPendingMessageView {
  readonly pendingMessageId: string;
  readonly conversationId: string;
  readonly clientRequestId: string;
  readonly sequence: number;
  readonly content: string;
  readonly status: AIChatPendingMessageStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attachmentMetadata?: readonly ChatV2AttachmentMetadata[];
  readonly canSteer: boolean;
  readonly steeringBoundary?: AIChatSafeBoundary;
  readonly activeAssistantMessageId?: string;
  readonly sentMessageId?: string;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly recoveryReason?: string;
}
```

The Module maps `sequence` from the database primary key and computes `canSteer` from trusted status, attachment metadata, and current runtime status. It never returns `modelContent`, request options, staged references, claim tokens, or attachment bytes.

### 7.3 Stored request options

`requestOptionsJson` contains only fields needed to reproduce the turn:

```typescript
interface AIChatPendingRequestOptions {
  readonly mode?: ChatV2Mode;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly systemPrompt?: string;
  readonly showReasoning?: boolean;
  readonly reasoning?: ChatV2StreamRequest["reasoning"];
  readonly toolApprovalMode?: ChatToolApprovalMode;
}
```

It must not contain `conversationId`, `message`, `uploadedFiles`, status, timestamps, or renderer-provided ownership fields.

### 7.4 Send-time preparation

`AIChatPendingMessagePreparationService` extracts the preparation code currently embedded in `AIChatQueryEngine.submitMessage()`.

At pending creation it:

1. normalizes and validates attachments;
2. stages document markdown and creates durable attachment references;
3. builds renderer attachment metadata;
4. resolves pasted-text placeholders;
5. resolves @-mentions against the accepted conversation/workspace;
6. returns `displayContent`, `modelContent`, `ChatV2MessageMetadata`, and image descriptors.

The pending Module stores these outputs before returning the durable receipt. Dispatch does not re-resolve mentions or pasted text, so a queued instruction cannot silently change meaning while it waits.

Image bytes remain in `ai_chat_attachments`. At dispatch, the preparation service rebuilds OpenAI image content parts from those trusted BLOBs and combines them with stored `modelContent`. Attachment steering is disabled, so a steering instruction never needs this image reconstruction path.

File staging is outside the SQLite transaction. If preparation succeeds but pending persistence fails, the service deletes newly staged references best-effort. If staging fails, no pending row or attachment BLOB is accepted.

### 7.5 Idempotency

Idempotency means retrying the same request produces the same durable result instead of a duplicate. The renderer generates `clientRequestId` once when Send is pressed and reuses it if IPC transport retries.

The unique database index is authoritative. On a uniqueness conflict, the Model loads and returns the existing row. It must verify that `conversationId` and a SHA-256 digest of normalized content/options match. A mismatch returns `IDEMPOTENCY_CONFLICT`.

### 7.6 Attachment storage decision

Version 1 reuses `ai_chat_attachments` instead of adding a second BLOB table.

- Enqueue allocates deterministic `userMessageId = user-pending-<pendingMessageId>`.
- Attachment bytes are stored immediately under that message ID.
- The pending row stores bounded display and message metadata only.
- Dispatch uses the same `userMessageId` for the delivered transcript row, so attachment rows do not need to move.
- `AIChatAttachmentModel` gains `getByMessageId()` and `deleteByMessageId()`.
- Dispatch reconstructs `ChatV2UploadedAttachment[]` from trusted BLOB rows.
- Conversation clear already deletes attachment rows by conversation; pending cancellation deletes rows by `userMessageId`.

This avoids duplicate bytes and keeps queued attachment data durable. Attachment steering remains disabled because applying it inside an active transcript would require staging and multimodal context rules at every boundary.

### 7.7 Delivered-message metadata

`ChatV2MessageMetadata` gains:

```typescript
interface ChatV2SteeringMetadata {
  readonly pendingMessageId: string;
  readonly clientRequestId: string;
  readonly targetAssistantMessageId: string;
  readonly boundary: AIChatSafeBoundary;
  readonly appliedAt: string;
}

interface ChatV2DirectionTransition {
  readonly contentOffset: number;
  readonly boundary: AIChatSafeBoundary;
  readonly pendingMessageIds: readonly string[];
  readonly occurredAt: string;
}
```

User rows applied as steering carry `steering`. The final assistant row carries `directionTransitions`. `contentOffset` tells the renderer where to insert a localized “Direction updated” marker without putting localized marker text into model context.

### 7.8 Atomic transcript promotion

The pending Model owns two transaction methods using the shared TypeORM `DataSource`:

```typescript
promoteDispatchToUserMessage(input): Promise<AIChatMessageEntity>;
promoteSteeringToUserMessage(input): Promise<AIChatMessageEntity>;
```

Each method performs one SQLite transaction:

1. Reload the pending row with the expected status and claim token.
2. Insert `AIChatMessageEntity` with the deterministic `userMessageId`, or validate the matching existing row.
3. Update the pending row to `sent` or `applied`.
4. Store transcript linkage, boundary, target assistant ID, and terminal timestamp.

Either both transcript insertion and state transition commit, or neither does.

## 8. State Machine and Model Operations

### 8.1 Allowed transitions

| From | To | Operation |
| --- | --- | --- |
| none | queued | `create()` when queue can run normally |
| none | paused | `create()` when conversation queue is held |
| queued | dispatching | `claimOldestForDispatch()` |
| queued | steering | `claimForSteering()` |
| queued | cancelled | `cancelQueued()` |
| paused | queued | `resumeConversation()` |
| paused | cancelled | `cancelPaused()` |
| dispatching | sent | `promoteDispatchToUserMessage()` |
| dispatching | paused | recoverable pre-turn failure or restart |
| dispatching | failed | terminal validation/staging failure |
| steering | applied | `promoteSteeringToUserMessage()` |
| steering | queued | failed steering reservation before consumption |
| steering | paused | process recovery or active-turn failure |

Terminal `sent`, `applied`, `cancelled`, and `failed` rows never return to a claimable state. Retry creates a new pending row with a new `pendingMessageId` and `clientRequestId`.

### 8.2 Conditional claims

Claims use one SQL update with an expected status:

```sql
UPDATE ai_chat_pending_messages
SET status = 'dispatching', claimToken = ?, claimedAt = CURRENT_TIMESTAMP,
    attemptCount = attemptCount + 1
WHERE id = ? AND status = 'queued';
```

The affected-row count must equal one. If it is zero, the Model reloads the current row and returns a stable conflict result. The same pattern protects `queued -> steering` and all claim-token terminal updates.

### 8.3 Queue limits

Initial constants:

```typescript
const AI_CHAT_PENDING_MAX_PER_CONVERSATION = 20;
const AI_CHAT_PENDING_CONTENT_MAX_CHARS = 32_000;
const AI_CHAT_PENDING_PASTED_CONTENT_MAX_CHARS = 256_000;
```

Attachment count and byte limits reuse the existing three-file and 5 MB-per-file limits. The Module checks limits before writing attachment bytes. A rejected create does not clear the renderer draft.

### 8.4 Retention

- Claimable and paused rows remain until delivered or removed.
- `sent` and `applied` rows remain for audit and recovery linkage.
- Terminal rows older than 30 days may be pruned only when their transcript linkage exists.
- `cancelled` and `failed` attachment bytes are deleted immediately.

## 9. Main-Process Queue Service

### 9.1 Public interface

```typescript
export interface AIChatTurnQueueService {
  submit(input: AIChatPendingCreateInput): Promise<AIChatPendingCreateResult>;
  steer(input: AIChatPendingSteerInput): Promise<AIChatPendingMessageView>;
  cancel(input: AIChatPendingCancelInput): Promise<AIChatPendingMessageView>;
  resumeConversation(conversationId: string): Promise<void>;
  list(conversationId: string): Promise<AIChatPendingMessageView[]>;
  onTurnTerminal(event: AIChatTurnTerminalEvent): Promise<void>;
  recoverOnStartup(): Promise<void>;
  clearConversation(conversationId: string): Promise<void>;
  clearAll(): Promise<void>;
}
```

### 9.2 Submission algorithm

All ordinary renderer sends use the pending-message create path, including sends while idle. This closes the race where the renderer thinks a conversation is idle while the main process has just started a turn.

```text
validate + AI gate
  -> create/reuse conversation ID
  -> prepare display/model content, mentions, pastes, and staged references
  -> persist pending row and attachment bytes
  -> emit queued/paused receipt
  -> if conversation is idle, queue is not held, and this is oldest claimable row:
       schedule drain(conversationId)
  -> return durable receipt
```

The UI may show the pending bubble only after the durable receipt returns. A local optimistic shell is allowed while the invoke is in flight, but it must retain the draft until acceptance.

### 9.3 Drain algorithm

`drainConversation()` is serialized by an in-memory promise chain keyed by conversation ID. It also acquires an interactive lease from `AIChatConversationTurnCoordinator`, so scheduled and interactive turns cannot run together in one conversation.

```text
if queue held or engine status is not idle -> return
claim oldest queued row -> dispatching
acquire interactive conversation lease
promote row to delivered user message using stored display content/metadata
build trusted ChatV2StreamRequest and model content from pending row + attachment BLOBs
start AIChatQueryEngine turn without saving a second user row
await terminal result
release lease
on completed -> schedule one next drain
on cancelled/failed/paused -> pause remaining queue
```

`AIChatQueryEngine` therefore gains a `submitPersistedUserMessage()` entry point. It accepts the already-created `AIChatMessageEntity`, assembles context, and runs the turn. The existing `submitMessage()` can delegate to this internal path for scheduled flows, but it must not insert the user row twice.

### 9.4 Queue hold

The service maintains a durable hold by changing all claimable `queued` rows for the conversation to `paused`.

Holds are created by:

- user Stop;
- turn failure;
- application startup recovery;
- unresolved permission or Plan Mode question;
- AI entitlement becoming unavailable.

`resumeConversation()` changes `paused -> queued` in FIFO order and schedules one drain. It never resumes a permission card or answers a Plan Mode question.

### 9.5 Terminal results

The queue service awaits `submitPersistedUserMessage()`. That engine method returns a narrow terminal classification only after assistant/tool persistence and terminal event emission are complete. The queue service then applies the action below. The engine does not import or call the queue service, avoiding a circular dependency.

| Turn result | Queue action |
| --- | --- |
| `completed` | Drain the next queued message |
| `cancelled` | Pause remaining messages |
| `failed` | Pause remaining messages with a safe failure code |
| `paused_for_permission` | Pause queued messages; keep dedicated permission flow |
| `paused_for_plan_question` | Pause queued messages; keep dedicated answer flow |

The callback is best-effort after the terminal result. Failure to drain is logged and leaves durable rows recoverable.

## 10. Steering Runtime Control

### 10.1 Active-turn state

`ActiveTurnState` becomes:

```typescript
interface ActiveTurnState {
  readonly abortController: AbortController;
  readonly assistantMessageId: string;
  readonly eventSink: AIChatQueryEventSink;
  readonly control: AIChatTurnControl;
}
```

`AIChatTurnControl` has a unique assistant message ID, a lifecycle state, reservations, and a committed mailbox.

```typescript
type AIChatSafeBoundary =
  | "before_model"
  | "after_model"
  | "before_tool"
  | "after_tool"
  | "before_complete";

interface AIChatSteeringInstruction {
  readonly pendingMessageId: string;
  readonly clientRequestId: string;
  readonly displayContent: string;
  readonly modelContent: string;
  readonly createdAt: string;
  readonly targetAssistantMessageId: string;
}

interface AIChatSteeringReservation {
  readonly reservationId: string;
  readonly targetAssistantMessageId: string;
}

interface AIChatTurnControl {
  reserve(pendingMessageId: string): AIChatSteeringReservation | null;
  commit(
    reservation: AIChatSteeringReservation,
    instruction: AIChatSteeringInstruction
  ): boolean;
  cancelReservation(reservationId: string): void;
  consume(boundary: AIChatSafeBoundary): Promise<AIChatSteeringBatch>;
  close(): void;
}
```

### 10.2 Why reservation is two-phase

The active turn can complete while a database claim is awaiting I/O. A direct “check active, update database, enqueue mailbox” flow can leave a row in `steering` after its target turn has disappeared.

The service uses two phases:

1. Synchronously reserve the active turn. A reservation is not visible to the loop.
2. Conditionally update `queued -> steering` with the target assistant ID.
3. Commit the reservation into the mailbox.

If the turn closes before step 3, commit returns false and the service conditionally restores `steering -> queued`. If the database claim fails, the service cancels the reservation. The loop drains committed instructions only.

### 10.3 Steering request algorithm

```text
load pending row and validate conversation/text/no attachments
  -> engine.reserveSteering(conversationId, pendingMessageId)
  -> conditional DB claim queued -> steering with target assistant ID
  -> engine.commitSteering(reservation, sanitized instruction)
  -> emit steering event
```

If no active running turn exists, return `TURN_NOT_STEERABLE` and leave the message queued. `awaiting_permission` and `awaiting_user` are not steerable states.

### 10.4 Applying a batch

At a safe boundary, `consume()` drains every committed instruction in creation order. Before returning instructions to the loop it calls `promoteSteeringToUserMessage()` for each item. That transaction creates the durable user row and marks the pending row `applied`.

If one promotion fails:

- already-applied items remain applied;
- later items remain `steering` and are moved to `paused` by terminal handling;
- the active turn fails with `STEERING_PERSISTENCE_FAILED`;
- no unpersisted steering text is added to model context.

Applied steering is appended as consecutive OpenAI `role: "user"` messages. The persisted content remains `displayContent`. The model-facing `modelContent` is wrapped locally:

```text
[User steering update received while this response was running]
<original user text>
```

The wrapper is not persisted as user content and does not grant system authority.

## 11. Safe Boundaries in `AIChatQueryLoop`

### 11.1 Checkpoint locations

| Boundary | Exact location |
| --- | --- |
| `before_model` | Inside the round loop, immediately before `streamChatCompletion()` |
| `after_model` | After the provider stream closes and tool calls are parsed, before malformed/tool processing |
| `before_tool` | At the start of each valid parsed tool-call iteration, before policy checks or `tool_call` emission |
| `after_tool` | After the tool result has been emitted, flushed, and appended to `messages` |
| `before_complete` | After the round loop decides no calls remain, before returning `completed` |

The current provider stream is allowed to finish. The current tool is allowed to finish. No boundary reads IPC or SQLite directly.

### 11.2 Boundary helper

```typescript
private async applySteeringAtBoundary(input: {
  readonly loopInput: AIChatQueryLoopInput;
  readonly messages: OpenAIChatMessage[];
  readonly boundary: AIChatSafeBoundary;
  readonly unstartedCalls: readonly ParsedToolCall[];
  readonly visibleContentLength: number;
}): Promise<AIChatBoundaryDecision>;
```

The result says whether steering was applied, which calls were skipped, and whether another model round is required.

### 11.3 Skipping unstarted tool calls

Once steering is available, no unstarted call from the superseded model response may execute. The loop must still satisfy the OpenAI tool protocol: every assistant `tool_call_id` needs one matching `tool` message.

For each unstarted call, append and emit:

```typescript
const skippedToolResult = {
  success: false,
  skipped: true,
  reason: "superseded_by_user_steering",
};
```

The serialized tool result includes no tool arguments or hidden policy data. Persist it through the existing `tool_result` event path. Already-completed tool results remain unchanged.

### 11.4 Multiple calls in one assistant message

The assistant tool-call message contains all parsed calls. The loop tracks a `Set<string>` of call IDs that already have results. On steering, it emits synthetic results for every remaining ID exactly once. This includes calls with malformed arguments if their result has not already been emitted.

### 11.5 Continuing after steering

After applying steering:

1. Add the durable steering user messages after all required tool results.
2. Emit one `direction_updated` stream event containing IDs and boundary only.
3. Record the current visible assistant content offset.
4. Continue to the next model round.

Steering consumes the existing `CHAT_V2_MAX_TOOL_ROUNDS` budget. If no next round remains, the boundary helper does not apply the pending items. It returns `STEERING_ROUND_LIMIT`, the turn fails cleanly, and those pending items become paused.

`AIChatQueryEvents.ts` and `aiChatV2Types.ts` add the corresponding event:

```typescript
interface AIChatQueryDirectionUpdatedEvent {
  readonly type: "direction_updated";
  readonly conversationId: string;
  readonly messageId: string;
  readonly boundary: AIChatSafeBoundary;
  readonly pendingMessageIds: readonly string[];
  readonly contentOffset: number;
}
```

The IPC mapper exposes the same fields as a `ChatV2StreamChunk` with `eventType: "direction_updated"`. It does not expose steering content because the pending-message event/history already carries user-visible text.

### 11.6 Visible content and persistence

The loop adds a `visibleContent` accumulator across rounds. Every model round’s text that was emitted to the renderer is appended once. Each applied steering batch records an offset into this accumulator.

The completed result contains:

```typescript
interface AIChatCompletedSteeringData {
  readonly fullContent: string;
  readonly directionTransitions: readonly ChatV2DirectionTransition[];
}
```

`AIChatQueryEngine` persists both fields on the final assistant row. `AiChatV2Message.vue` splits content at the offsets and inserts localized markers. `AIChatContextAssembler` sees only the combined assistant content, never UI marker text.

### 11.7 Retry interaction

The content-level transient retry wrapper must stop retrying the pristine original transcript after steering has been accepted or applied. `RoundContentTracker` gains `steeringObserved`. The retry condition requires both `!tracker.delivered` and `!tracker.steeringObserved`; otherwise a retry could omit or duplicate the steering instruction.

## 12. Query Engine Changes

### 12.1 New entry points

```typescript
submitPersistedUserMessage(input: {
  readonly eventSink: AIChatQueryEventSink;
  readonly request: ChatV2StreamRequest;
  readonly savedUser: AIChatMessageEntity;
}): Promise<AIChatTurnTerminalEvent>;

reserveSteering(
  conversationId: string,
  pendingMessageId: string
): AIChatSteeringReservation | null;

commitSteering(
  conversationId: string,
  reservation: AIChatSteeringReservation,
  instruction: AIChatSteeringInstruction
): boolean;
```

### 12.2 Refactor boundary

Split existing `submitMessage()` into:

1. user-input preparation and persistence;
2. `runPersistedTurn()` for plan resolution, context assembly, tool catalog, active-turn registration, loop execution, and result handling.

Queue dispatch calls part 2. Scheduled turns may continue calling the existing scheduled path. This prevents duplicate user rows and keeps normal history authoritative.

### 12.3 Same-conversation replacement

The current engine aborts a prior active turn when another submission reaches it. The queue design removes this behavior for interactive messages. `runPersistedTurn()` returns `CONVERSATION_BUSY` if an active/pending turn exists. Only explicit Stop may abort it.

This is required because a late queue drain must never replace a newer turn.

### 12.4 Paused permission/question turns

When a turn moves from `activeTurns` to `pendingPermissions` or `pendingPlanQuestions`, its `AIChatTurnControl` closes and any committed but unapplied steering is paused. The UI does not show Steer while either pending map owns the conversation.

## 13. IPC and Preload Contracts

### 13.1 Channels

| Constant | Direction | Transport |
| --- | --- | --- |
| `AI_CHAT_V2_PENDING_CREATE` | renderer -> main | invoke |
| `AI_CHAT_V2_PENDING_LIST` | renderer -> main | invoke |
| `AI_CHAT_V2_PENDING_STEER` | renderer -> main | invoke |
| `AI_CHAT_V2_PENDING_CANCEL` | renderer -> main | invoke |
| `AI_CHAT_V2_PENDING_RESUME` | renderer -> main | invoke |
| `AI_CHAT_V2_PENDING_EVENT` | main -> renderer | receive |
| existing stream chunk/complete | main -> renderer | receive |

All invoke handlers use `registerAiValidatedHandler`, which checks `USER_AI_ENABLED` before parsing or doing work. Stream broadcasts contain no credentials, attachment bytes, system prompts, reasoning hidden from the user, or unsanitized tool results.

### 13.2 Request types

```typescript
interface AIChatPendingCreateInput {
  readonly clientRequestId: string;
  readonly request: ChatV2StreamRequest;
}

interface AIChatPendingSteerInput {
  readonly conversationId: string;
  readonly pendingMessageId: string;
}

interface AIChatPendingCancelInput {
  readonly conversationId: string;
  readonly pendingMessageId: string;
}

interface AIChatPendingResumeInput {
  readonly conversationId: string;
}
```

Zod schemas are strict. IDs are bounded to 100 characters. Conversation IDs must start with `v2-`. Unknown keys are rejected. Request numeric ranges reuse current chat validation.

### 13.3 Create result

```typescript
interface AIChatPendingCreateResult {
  readonly conversationId: string;
  readonly disposition: "queued" | "paused" | "dispatch_scheduled";
  readonly pendingMessage: AIChatPendingMessageView;
}
```

`dispatch_scheduled` means the durable row is eligible and a drain was scheduled. It does not promise that a provider request has already started.

### 13.4 Lifecycle event

```typescript
interface AIChatPendingMessageEvent {
  readonly conversationId: string;
  readonly pendingMessageId: string;
  readonly status: AIChatPendingMessageStatus;
  readonly occurredAt: string;
  readonly pendingMessage?: AIChatPendingMessageView;
  readonly reasonCode?: string;
}
```

Events are refreshable hints. Renderer correctness never depends on receiving every event; history and pending-list IPC reconstruct current state.

## 14. Stream Delivery Refactor

### 14.1 Problem

The existing renderer attaches stream listeners only inside `streamChatV2Message()` immediately before sending a turn. A queued message may start later without a renderer call, so that listener lifetime is insufficient.

### 14.2 Broadcaster

Add `AIChatV2EventBroadcaster`, following the existing conversation-update broadcaster pattern. It registers live `BrowserWindow` instances and emits:

- interactive stream chunks;
- interactive stream terminal events;
- pending-message lifecycle events.

The current `createEventSink(event)` becomes a broadcaster-backed sink. All renderer handlers already filter by conversation ID; broadcasts therefore preserve conversation isolation.

### 14.3 Renderer subscription

`views/api/aiChatV2.ts` exposes mount-lifetime subscriptions:

```typescript
subscribeChatV2Stream(handler: (chunk: ChatV2StreamChunk) => void): () => void;
subscribePendingMessages(
  handler: (event: AIChatPendingMessageEvent) => void
): () => void;
```

`AiChatV2.vue` subscribes once on mount and unsubscribes on unmount. It routes each event into the existing per-conversation runtime map. The Send handler no longer waits on one stream Promise.

## 15. Renderer Design

### 15.1 Composer

- The text area, attachment button, and Send button remain available while `chatIsRunning`.
- Stop becomes a separate adjacent action while active, rather than replacing Send.
- Send emits a `clientRequestId` and clears the draft only after durable acceptance.
- Attachment preparation still happens before IPC submission.
- Slash commands, Plan question answers, permission actions, and scheduled-loop controls keep their dedicated paths.

### 15.2 Pending views

`ChatV2HistoryResponse` gains `pendingMessages`. `AiChatV2.vue` keeps delivered and pending arrays separately. `AiChatV2Messages.vue` merges them by timestamp and stable sequence for display, but only delivered messages are passed to features that calculate model context, tool progress, or persisted token usage.

### 15.3 Pending component

`AiChatV2PendingMessage.vue` renders:

- original content;
- attachment chips;
- localized lifecycle status;
- Steer for eligible queued text messages;
- Remove for queued/paused/failed messages;
- Send next/Resume when paused;
- accessible busy state while an action is in flight.

The Steer button is visible only when:

- status is `queued`;
- conversation runtime status is `running`;
- there are no attachments;
- the active turn is not waiting for permission or a Plan answer.

### 15.4 Reconciliation

Use stable `pendingMessageId` and `clientRequestId` to reconcile:

- local create shell -> durable pending view;
- pending `dispatching` -> delivered user row;
- pending `steering` -> applied steering user row;
- terminal event missed -> state restored by history reload.

When a delivered row has metadata linking a pending ID, the pending bubble is not rendered separately even if a stale list response still contains its terminal audit row.

### 15.5 Direction marker

`AiChatV2Message.vue` renders assistant content segments split at `directionTransitions[].contentOffset`. The marker is presentation-only and translated. Copying the message copies content without marker labels unless product later specifies otherwise.

## 16. Restart and Crash Recovery

### 16.1 Startup reconciliation

Run after the user database connection is ready and before accepting queue dispatch:

1. Load nonterminal pending rows.
2. For `dispatching`, look up `userMessageId`:
   - matching transcript row exists: mark `sent`;
   - no row: mark `paused` with `recovered_dispatch`.
3. For `steering`, look up a user row with matching steering metadata:
   - matching row exists: mark `applied`;
   - no row: mark `paused` with `recovered_steering`.
4. Change existing `queued` rows to `paused` with `recovered_after_restart`.
5. Broadcast a refresh hint.

No provider request starts automatically after restart. The user must click Resume/Send next.

### 16.2 Database switch and sign-out

Before switching databases:

- stop active turns;
- close turn controls;
- clear in-memory drain locks and event associations;
- do not copy pending records between databases.

The next database runs its own recovery. Models continue resolving the path through `Token` and `USERSDBPATH` via `BaseModule`/`BaseDb`.

### 16.3 Clear behavior

Conversation clear performs, through Modules:

1. stop/close active runtime for that conversation;
2. delete pending rows;
3. delete pending/delivered attachment rows by conversation;
4. clear delivered messages, plans, compact state, memory, and artifacts using existing cascade behavior.

Clear-all performs the same operation for every V2 conversation and resets queue-service memory.

## 17. Cancellation Prerequisite

### 17.1 Registry-owned abort signal

Change `ToolJobSpawnHandle`:

```typescript
export interface ToolJobSpawnHandle {
  readonly signal: AbortSignal;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}
```

`ToolJobRegistry.start()` creates one `AbortController` per job. `cancel()` and `shutdown()` call `abortController.abort()` before marking the job cancelled. Queued jobs are removed without running. Late resolve/reject remains ignored for cancelled jobs.

### 17.2 Async tool propagation

`AIChatQueryLoop.executeAsyncTool()` passes `handle.signal` into `deps.executeTool`:

```typescript
await this.deps.executeTool(name, args, {
  ...context,
  signal: handle.signal,
});
```

The outer turn abort calls `registry.cancel(jobId)`, which now reaches the tool.

### 17.3 Subagent propagation

`runSubagentTool.ts` passes the signal to existing runtime dependencies:

```typescript
await runtime.runSync(request, {
  ...getDefaultAgentRuntimeDeps(),
  signal: context.signal,
});
```

Tests assert that Stop aborts the registry signal and the nested `AgentRuntime` controller. Non-cooperative tools may still take time to unwind, but the application no longer reports registry cancellation without requesting real cancellation.

## 18. Security and Trust

- Every new AI IPC invoke checks AI enable before parsing.
- Renderer content, IDs, timestamps, statuses, sequence, and ownership are untrusted.
- The Module validates that pending and active turn conversation IDs match.
- Steering is a user-role message below system, workspace, plan, policy, and permission instructions.
- Steering cannot approve a tool, answer `AskUserQuestion`, change the tool catalog directly, or bypass workspace trust.
- Pending attachment filenames are display metadata, never trusted filesystem paths.
- Broadcasts exclude attachment bytes, credentials, hidden reasoning, raw system prompts, and unsanitized tool results.
- Logs use IDs, status, boundary, counts, and latency. They do not log user content.

## 19. Observability

### 19.1 Structured log fields

- `conversationId`
- `pendingMessageId`
- `clientRequestIdHash`
- `assistantMessageId`
- old/new status
- claim result
- steering boundary
- queued duration
- steering acceptance-to-application duration
- skipped tool count
- recovery reason
- failure code

### 19.2 Counters

- `ai_chat_pending_created_total`
- `ai_chat_pending_dispatched_total`
- `ai_chat_pending_paused_total`
- `ai_chat_pending_failed_total`
- `ai_chat_steering_requested_total`
- `ai_chat_steering_applied_total`
- `ai_chat_steering_rejected_total{reason}`
- `ai_chat_steering_skipped_tools_total`
- `ai_chat_queue_recovered_total{state}`

### 19.3 Timings

- enqueue-to-dispatch;
- steer-click-to-boundary;
- drain duration;
- pending database transaction duration.

Telemetry remains local/aggregated according to existing product policy and never includes message content.

## 20. Internationalization and Accessibility

Add matching keys to `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`:

```text
aiChatV2.queue.queued
aiChatV2.queue.steer
aiChatV2.queue.steering
aiChatV2.queue.applied
aiChatV2.queue.dispatching
aiChatV2.queue.paused
aiChatV2.queue.failed
aiChatV2.queue.remove
aiChatV2.queue.resume
aiChatV2.queue.send_next
aiChatV2.queue.direction_updated
aiChatV2.queue.attachments_not_steerable
aiChatV2.queue.limit_reached
aiChatV2.queue.recovered_after_restart
```

Controls need visible focus, keyboard activation, busy/disabled state, and full accessible names. Status changes use an `aria-live="polite"` region. Color is supplementary; text and icons carry the state.

## 21. Testing Plan

### 21.1 Model and Module

- unique client request creates one row;
- conflicting reuse returns `IDEMPOTENCY_CONFLICT`;
- FIFO uses primary-key order;
- conditional steer/dispatch race has one winner;
- transcript promotion is atomic;
- attachment BLOBs reuse deterministic user message ID;
- cancel deletes pending attachment bytes;
- clear is conversation-scoped;
- restart reconciliation covers every nonterminal state;
- worker process cannot use the Model path;
- queue limits reject without partial writes.

### 21.2 Queue service

- idle submission schedules exactly one dispatch;
- active submission remains queued;
- successful terminal event drains one next row;
- Stop/error/permission/question pauses queue;
- Resume restores FIFO;
- different conversations drain independently;
- interactive coordinator lease blocks a scheduled collision;
- AI disabled preserves rows but blocks dispatch;
- dispatch failure before model call is recoverable.

### 21.3 Query engine and loop

- steering before first model request;
- steering after stream and before tools;
- steering after tool A and before tool B;
- every skipped call gets exactly one matching result;
- tool A result remains in next request;
- multiple steering messages preserve order;
- target assistant mismatch is rejected;
- permission/Plan policy remains authoritative;
- visible content and direction offsets persist correctly;
- transient retry cannot drop applied steering;
- round-limit failure pauses unapplied steering;
- cancellation remains distinct from steering.

### 21.4 IPC

- AI gate runs before schema parsing;
- strict schemas reject extra/oversized fields;
- cross-conversation steer/cancel returns a stable error;
- lifecycle DTOs contain no bytes or secrets;
- preload allowlists expose only named channels;
- handlers call Modules/Services, not repositories.

### 21.5 Vue components

- composer can Send and Stop while active;
- draft clears only after durable acceptance;
- pending status/action matrix renders correctly;
- attachment pending message hides Steer with explanation;
- double-click actions are disabled while awaiting response;
- delivered/applied reconciliation prevents duplicate bubbles;
- direction marker renders at saved offsets;
- switching conversations restores independent queues;
- all translation keys have parity across six languages.

### 21.6 Electron E2E

1. Queue B behind delayed A and verify automatic B dispatch after A completes.
2. Steer between tool A and tool B; verify B never executes and receives a synthetic result.
3. Race Steer with A completion; verify the message is steering or the next turn, never both.
4. Stop A; verify B remains paused until explicit Resume.
5. Force provider error; verify queue stays paused.
6. Switch between conversations while both have independent work.
7. Relaunch with queued rows; verify no automatic provider request and explicit recovery works.
8. Queue an attachment; verify it dispatches normally and cannot steer.

### 21.7 Verification commands

```bash
yarn testmain
yarn test:components
yarn test:e2e
yarn vue-check
```

Run targeted tests during each phase. The full gates run before enabling the feature flag.

## 22. Rollout and Implementation Order

### Phase 0: truthful cancellation

1. Add registry-owned abort signals.
2. Pass signals through async tools and `run_subagent`.
3. Extend cancellation tests.

Exit gate: cancelling a nested subagent requests abort in the actual `AgentRuntime`.

### Phase 1: persistence and queue-only UI

1. Add entity, DB registration, Model, Module, attachment accessors, and tests.
2. Add queue service, IPC schemas/channels, broadcaster, and API subscriptions.
3. Route all ordinary sends through durable create.
4. Add pending bubble, FIFO dispatch, pause/resume, translations, and component/E2E tests.

Exit gate: queue behavior works with steering feature flag off, including restart recovery.

### Phase 2: steering control plane

1. Add turn control and two-phase reservations.
2. Add loop boundaries and synthetic skipped results.
3. Persist steering user rows and direction transitions.
4. Enable text-only Steer UI and tests.

Exit gate: the between-tools E2E proves no obsolete unstarted tool executes.

### Phase 3: hardening

1. Add counters, timings, pruning, and failure UX.
2. Run race, crash, provider-compatibility, and multi-conversation suites.
3. Remove the feature flag only after cancellation and no-duplicate gates pass.

## 23. Feature Flags and Kill Switches

Use separate local settings:

```typescript
AI_CHAT_MESSAGE_QUEUE_ENABLED
AI_CHAT_MESSAGE_STEERING_ENABLED
```

- Steering requires queue enabled.
- Turning steering off leaves normal queued dispatch working.
- Turning queue off blocks new pending creation but still exposes existing rows for resume/remove, preventing orphaned data.
- Flags are checked in the main process; renderer flags control presentation only.

## 24. Failure Codes

| Code | Meaning | User action |
| --- | --- | --- |
| `QUEUE_LIMIT_REACHED` | Too many nonterminal messages | Wait or remove one |
| `IDEMPOTENCY_CONFLICT` | Reused request ID with different content | Retry with a new request ID |
| `PENDING_NOT_FOUND` | Unknown or wrong-database ID | Refresh history |
| `CONVERSATION_MISMATCH` | Pending row and request conversation differ | Refresh; log security warning |
| `TURN_NOT_STEERABLE` | No running active turn | Leave queued |
| `PENDING_NOT_CLAIMABLE` | Another action won | Refresh row state |
| `STEERING_ROUND_LIMIT` | No model round remains | Resume as next normal message |
| `STEERING_PERSISTENCE_FAILED` | Atomic promotion failed | Queue pauses; retry after recovery |
| `ATTACHMENTS_NOT_STEERABLE` | V1 text-only restriction | Leave queued normally |
| `QUEUE_RECOVERED_PAUSED` | Restart recovered unfinished state | Click Resume |
| `AI_FEATURE_DISABLED` | Entitlement unavailable | Enable AI; records remain local |

User-facing strings map from codes in the renderer. Raw database/provider errors are not shown.

## 25. Server Boundary

No change is required in `/home/robertzeng/project/aifetchserver` for version 1.

The server receives one normal `/v1/chat/completions` request per model round. After a safe boundary, the next request contains:

1. prior assistant tool calls;
2. completed or synthetic skipped tool results;
3. user steering messages;
4. the same policy/system context already assembled locally.

The server does not need local conversation IDs, pending IDs, queue state, or a steering endpoint. A server change becomes necessary only if run ownership moves to server workers, at which point steering needs a durable cross-worker control channel rather than an in-process HTTP mutation.

## 26. Design Decisions and Alternatives

### 26.1 Dedicated pending table instead of early chat rows

Chosen because `AIChatContextAssembler` treats normal chat rows as delivered history. Early insertion would require every context, compact, memory, search, and conversation query to filter pending metadata correctly. A separate table makes “not yet delivered” structural.

### 26.2 Persist every send before routing

Chosen because splitting idle send and busy queue paths leaves a timing window where a stale renderer status can replace an active turn. One durable entry path gives one ownership rule and exactly-once linkage.

### 26.3 Reuse attachment BLOB storage

Chosen because the existing attachment table already has conversation/message ownership and clearing behavior. A deterministic future user message ID lets pending and delivered lifecycle share the same bytes without a migration-heavy second table.

### 26.4 Wait for current tool boundary

Chosen because tools may have external side effects and many are not safely reversible. Steering prevents future obsolete work while preserving the real outcome of work already started.

### 26.5 Do not abort provider streaming in V1

Chosen for provider compatibility and simple transcript semantics. The trade-off is steering latency equal to the remaining provider response time. Acceptance-to-boundary timing will show whether later preemption is worth the complexity.

### 26.6 Local control plane instead of server endpoint

Chosen because the Electron main process owns the loop, tools, SQLite, and active-turn map. A server endpoint would not know which local tool boundary is safe and could not prevent a local unstarted tool from executing.

## 27. Acceptance Checklist

- [ ] A busy-conversation send gets a durable receipt and visible queued bubble.
- [ ] Idle and busy sends use the same main-process routing path.
- [ ] FIFO dispatch is atomic and conversation-scoped.
- [ ] Stop, error, permission, and Plan question pause the queue.
- [ ] Restart never auto-runs recovered queued work.
- [ ] Eligible text messages expose Steer; attachments do not.
- [ ] Steering reservation cannot target a completed/replaced turn.
- [ ] The current tool may finish; no remaining unstarted tool executes.
- [ ] Every skipped call has one protocol-valid tool result.
- [ ] Steering is persisted as user content before entering model context.
- [ ] A steered message cannot later dispatch as a normal duplicate.
- [ ] Direction markers survive history reload without polluting model text.
- [ ] Cancellation reaches async tools and nested AgentRuntime work.
- [ ] New AI IPC handlers gate AI enable before parsing.
- [ ] All six language files and required UI tests are updated.
- [ ] No `aifetchserver` source change is required.
