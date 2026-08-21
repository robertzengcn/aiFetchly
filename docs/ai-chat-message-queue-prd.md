# AI Chat Message Queue and Steering PRD

## Document Information

- **Version:** 2.0
- **Status:** Proposed
- **Created:** 2026-08-21
- **Owner:** aiFetchly Core Team
- **Product area:** AI Chat V2
- **Supersedes:** AI Chat Message Queue PRD version 1.x, which targeted the retired `AiChatBox.vue` architecture and did not include steering or durable queues
- **Related systems:** AI Chat V2, `AIChatQueryEngine`, `AIChatQueryLoop`, tool execution, Plan Mode, conversation persistence, Electron IPC, Vue 3 renderer
- **Related documents:**
  - [AI Chat Query Engine PRD](./ai-chat-query-engine-prd.md)
  - [AI Chat Query Engine Technical Design](./ai-chat-query-engine-technical-design.md)
  - [Marketing Automation Subagent System PRD](./marketing-subagent-system-prd.md)
  - [OpenAI-Compatible Chat V2 PRD](./openai-compatible-chat-v2-prd.md)

---

## 1. Executive Summary

AI Chat V2 currently prevents a user from sending another ordinary message while the active conversation is generating a response. The guard protects the single-turn model/tool loop, but it forces users to wait even when they already know their next instruction or recognize that the assistant is heading in the wrong direction.

This feature keeps the composer usable while AI work is active. A message submitted during an active turn appears immediately in the conversation as a durable queued user message. The message is not sent to the model yet. A small **Steer** action appears next to the queued message, allowing the user to promote that specific message from a normal follow-up into an instruction for the active turn.

The default remains safe and predictable:

- Sending while idle starts a normal turn immediately.
- Sending while busy queues the message in first-in, first-out order.
- A queued message starts automatically after the current turn completes successfully.
- Clicking **Steer** applies that message at the next safe execution boundary.
- Steering never interrupts a tool halfway through, grants permission, or bypasses policy.
- A steered message is removed from the normal queue so it cannot be delivered twice.

The Electron main process owns queue state, steering delivery, persistence, and dispatch. The renderer presents state and sends intent. The remote AI server remains an OpenAI-compatible stateless model gateway and requires no change for this release.

---

## 2. Problem Statement

### 2.1 Current behavior

AI Chat V2 supports long-running model/tool work, concurrent turns in different conversations, Plan Mode questions, permission pauses, recovery, cancellation, and background tools. Within one conversation, however, the active turn blocks normal submission:

- `AiChatV2.vue` rejects ordinary sends while `chatIsRunning` is true.
- `AiChatV2Composer.vue` changes its primary action from Send to Stop.
- A user cannot stage the next message in the conversation.
- A user who notices a wrong direction can only wait or stop the whole turn.
- Stop discards the remaining work instead of preserving completed tool results and changing only future work.
- There is no durable record of an instruction the user attempted to send during active work.

### 2.2 User pain

The current interaction creates four recurring failures:

1. **Lost momentum:** Users must hold the next thought outside the application until the assistant finishes.
2. **Overcorrection:** Stop is the only immediate control, even when the user wants to preserve completed work.
3. **Wasted tool work:** The assistant may begin additional obsolete tools before the user can redirect it.
4. **Unclear delivery:** Users cannot tell whether a follow-up was received, queued, applied, or rejected.

### 2.3 Desired behavior

```text
User sends Message A
  -> AI starts working on A
  -> user sends Message B
  -> B appears immediately as Queued
     -> no action: B sends normally after A completes
     -> user clicks Steer: B changes the active turn at its next safe boundary
```

The product must make the distinction between **next message** and **change current direction** explicit. Merely typing while the assistant works must not silently steer it.

---

## 3. Product Goals

### 3.1 Primary goals

1. Keep the AI Chat V2 composer usable during active work.
2. Persist messages submitted while a conversation is busy.
3. Display queued messages in the conversation at the position where the user submitted them.
4. Dispatch ordinary queued messages in FIFO order without concurrent turns in the same conversation.
5. Let a user explicitly steer one queued text message into the active turn.
6. Apply steering at predictable safe boundaries without killing completed work.
7. Prevent unstarted obsolete tool calls from executing after steering is accepted.
8. Provide visible queued, steering, applied, paused, sent, cancelled, and failed states.
9. Preserve conversation isolation so background work in other conversations continues normally.
10. Maintain a durable, auditable history across conversation switching and app restart.

### 3.2 Secondary goals

- Establish a reusable runtime-control pattern that can later support specialist `AgentRuntime` tasks.
- Make race outcomes observable rather than silently dropping or duplicating messages.
- Preserve current tool permission, workspace trust, Plan Mode, memory, and recovery behavior.

### 3.3 Success criteria

The release is successful when:

- A user can submit at least one message while the active conversation is streaming.
- The queued bubble appears within 200 ms of local acceptance under normal desktop load.
- Every accepted queued message reaches exactly one terminal outcome: sent, applied as steering, cancelled, or failed.
- A message promoted to steering is never sent later as a duplicate normal turn.
- When steering arrives between tool calls, no subsequent unstarted tool call from the superseded model response executes.
- Queue state survives conversation switching and app restart.
- No new server endpoint or hosted-provider-specific behavior is required.
- Component and E2E test suites cover the critical queue and steering flows.

---

## 4. Non-Goals

The first release will not:

1. Run two model/tool turns concurrently in the same conversation.
2. Interrupt a currently executing tool merely because steering was queued.
3. Guarantee immediate injection into an already-open provider token stream.
4. Support steering messages containing file or image attachments.
5. Support steering slash commands, scheduled-loop commands, or other local command workflows.
6. Let steering expand tool allowlists, approve permissions, change workspace trust, or bypass Plan Mode policy.
7. Reorder queued messages through drag and drop.
8. Merge queue ownership into the remote AI server.
9. Move the chat runtime to a worker or child process.
10. Resume an interrupted model/tool turn after the application process exits.
11. Add freeform steering to specialist agents in the same milestone. The control abstraction should allow it later, but this PRD ships main-chat steering first.

---

## 5. Product Principles

### 5.1 Queue by default, steer by choice

A follow-up submitted during active work is a normal next message unless the user explicitly clicks **Steer**. This protects users from accidental changes to active work.

### 5.2 Never acknowledge what the runtime cannot deliver

The UI must distinguish local acceptance, queued delivery, steering acceptance, steering application, and terminal failure. “Steered” means the runtime consumed the instruction, not merely that the renderer emitted an IPC request.

### 5.3 Preserve completed work

Steering changes future execution. It does not retroactively erase completed tools or pretend they did not run.

### 5.4 Do not begin obsolete side effects

Once steering is available at a safe boundary, the runtime must not start remaining tool calls from the superseded model decision.

### 5.5 Local runtime state is authoritative

AiFetchly owns conversations, tools, policies, queues, and steering. The AI server processes one OpenAI-compatible completion request at a time and does not own the agent run.

### 5.6 Durable intent, ephemeral execution

User intent must survive reloads. The active model/tool execution does not need to survive a process exit in v1. Startup reconciliation must convert abandoned transient states into understandable queued or failed states.

---

## 6. Target Users and Use Cases

### 6.1 Primary users

- Users running long research, scraping, enrichment, artifact, or analysis tasks in AI Chat V2.
- Users who think of follow-up instructions before a response finishes.
- Users who need to correct scope without discarding completed work.
- Users switching among conversations while background work continues.

### 6.2 Core use cases

#### UC-1: Queue the next question

The assistant is generating a report. The user submits “Now turn this into an email.” The message appears as queued and sends automatically after the report finishes.

#### UC-2: Redirect remaining research

The assistant finishes one search tool and is preparing additional searches. The user queues “Focus only on European customers,” then clicks **Steer**. The runtime preserves the finished search, skips unstarted searches, and asks the model to continue with the new constraint.

#### UC-3: Queue multiple follow-ups

The user submits messages B, C, and D while A is running. They remain ordered. After A succeeds, B starts. C and D remain queued.

#### UC-4: Steer a later queued message

B and C are queued. The user steers C. C is removed from normal FIFO delivery and applied to the active turn. B remains queued and is sent after the active turn completes unless the user removes it.

#### UC-5: Stop while messages are queued

The user stops the active response. Queued messages remain visible but automatic dispatch pauses. The user can send the next queued message, edit/remove queued work in a later phase, or clear it.

#### UC-6: Switch conversations

Conversation A is running with queued messages. The user opens Conversation B and starts work. Conversation A retains its independent runtime and queue.

#### UC-7: Application restart

The application closes with queued messages. On restart, those messages reappear. Messages that had not been applied remain queued and do not silently disappear.

---

## 7. User Experience

### 7.1 Composer behavior

The composer remains editable while the active conversation is running.

| Conversation state | Submit behavior |
| --- | --- |
| Idle, no queued messages | Send immediately |
| Idle, queued messages exist | Append to queue, then dispatch the oldest eligible message |
| Running | Persist and show as queued |
| Awaiting tool permission | Persist and show as queued; do not offer Steer |
| Awaiting Plan Mode answer | Dedicated answer UI remains authoritative; ordinary submissions queue but do not answer the question |
| Active turn stopped or failed | Persist new message and keep queue paused until the user explicitly resumes/sends next |

The current Stop control remains separate from Send. The user must be able to submit a queued message and stop active work without one action replacing the other.

### 7.2 Queued message presentation

Queued messages appear as user bubbles in the normal conversation flow because the user has committed the message, but they are visually distinct from sent transcript rows.

Recommended presentation:

```text
┌────────────────────────────────────────────────────┐
│ Focus only on European customers.                  │
│                                                    │
│ 🕘 Queued                                  [Steer] │
└────────────────────────────────────────────────────┘
```

Required visual distinctions:

- Muted or dashed bubble treatment.
- Queue status with icon and localized text.
- Small **Steer** button after the status, aligned with existing message actions.
- Stable position while status changes.
- No assistant typing placeholder is created for a merely queued message.

### 7.3 Steer button

The Steer action is shown only when all conditions are true:

- The pending message status is `queued`.
- The same conversation has an active `running` turn.
- The message contains text that can be delivered to the model.
- The message does not contain queued attachments.
- The message is not a slash/local command.

Button requirements:

- Visible text on layouts with enough room; icon plus tooltip is acceptable on narrow layouts.
- Recommended icon: `mdi-directions-fork` or `mdi-arrow-decision`.
- Accessible name: “Steer active response with this message.”
- Disabled-state tooltip must explain why steering is unavailable.
- Clicking once disables repeat clicks while the claim is pending.

### 7.4 Status presentation

| Status | User-facing label | Meaning |
| --- | --- | --- |
| `queued` | Queued | Waiting for normal FIFO delivery |
| `steering` | Steering… | Claimed for the active turn but not yet consumed |
| `applied` | Applied | Consumed by the active runtime |
| `dispatching` | Sending… | Claimed as the next normal turn |
| `sent` | Sent | Persisted into normal chat history and submitted |
| `paused` | Queue paused | Waiting for explicit user action after stop/error |
| `cancelled` | Removed | User cancelled the queued message |
| `failed` | Couldn’t send | Terminal delivery failure with retry affordance |

For applied steering, optionally include its safe boundary:

- “Applied before next tool”
- “Applied after current tool”
- “Applied before final response”

### 7.5 Multiple queued messages

- Messages display in creation order.
- Automatic dispatch always claims the oldest eligible queued message.
- Steering can claim any queued text-only message.
- Steering message C does not delete earlier message B.
- After C is applied, B remains queued and is clearly visible.
- The product must not silently combine or reorder user bubbles.

### 7.6 Completion behavior

After a successful active turn:

1. If steering was applied, finish the revised active turn first.
2. Claim the oldest normal queued message.
3. Change it to `dispatching`.
4. Promote it into a normal persisted user message.
5. Start the next assistant turn.

Only one automatic dispatch may be active for a conversation.

### 7.7 Error and stop behavior

When the active turn fails or is stopped:

- Do not automatically dispatch the next queued message.
- Preserve the queue.
- Mark the queue paused.
- Show a clear **Send next** or equivalent recovery action.
- Allow individual queued messages to be removed.
- Do not interpret Stop as Clear Queue.

### 7.8 Attachments

Queued messages may retain supported attachments for later normal delivery, subject to existing count, size, type, workspace, and processing limits.

For v1:

- Attachment validation occurs before queue acceptance.
- Attachment payload or stable staged references must survive draft clearing and app restart.
- The Steer button is disabled for messages with attachments.
- The disabled tooltip states: “Messages with attachments will send after the current response.”
- Removing a queued message cleans up any pending attachment storage that is not referenced elsewhere.

### 7.9 Conversation switching

Queues are scoped by `conversationId` and survive conversation switching.

- Switching conversations does not clear queued messages.
- A background conversation can continue its active stream and queue dispatch.
- Conversation summaries should expose a queued count or indicator.
- A new conversation receives an independent queue.

### 7.10 Restart recovery

On application startup or user database switch:

- Persisted `queued` messages remain queued.
- Abandoned `dispatching` messages are reconciled using their idempotency key and transcript state.
- Abandoned `steering` messages that were never applied return to `queued` with a recovery reason.
- A message already persisted as an applied steering transcript row must not be queued again.
- The product may require the user to manually resume a recovered queue; it must not unexpectedly start AI work immediately on application launch.

---

## 8. Functional Requirements

### 8.1 Queue creation and ownership

**FR-1:** The Electron main process must own the authoritative queue for each conversation.

**FR-2:** The renderer must not decide that a message was successfully queued until the main process returns a durable receipt.

**FR-3:** Every pending message must have a stable `pendingMessageId` and client-generated idempotency key.

**FR-4:** Queue records must be scoped to the active user database and one `conversationId`.

**FR-5:** The same idempotency key must not create more than one pending or sent message.

### 8.2 Queue ordering and claiming

**FR-6:** Normal delivery must be FIFO by monotonic sequence, with database ID as the final stable tie-breaker.

**FR-7:** Claiming a message for steering or normal dispatch must be conditional on its current claimable status.

**FR-8:** Exactly one claimant may transition a message out of `queued`.

**FR-9:** A failed conditional claim must return the record’s latest state instead of reporting generic success.

### 8.3 Automatic dispatch

**FR-10:** A successful terminal turn must schedule a queue-drain check for its conversation.

**FR-11:** The drain must start no more than one next turn for that conversation.

**FR-12:** Automatic dispatch must not occur after cancellation, error, unresolved permission, or unresolved Plan Mode question.

**FR-13:** If the conversation is idle and a new message arrives behind existing queued work, the oldest queued message must dispatch first.

**FR-14:** A dispatch failure before remote AI work must leave the message recoverable and visible.

### 8.4 Steering acceptance

**FR-15:** Steering may be requested only for a queued message belonging to the same conversation as the active turn.

**FR-16:** Steering acceptance must atomically remove the message from normal queue eligibility.

**FR-17:** If the active turn finishes before steering is claimed, the system must fall back to normal queue dispatch or return the actual terminal state. It must not lose the message.

**FR-18:** Multiple steering messages accepted before a boundary must retain chronological ordering.

**FR-19:** Steering must be represented to the model as user-originated guidance below system, workspace, policy, and permission instructions.

### 8.5 Safe-boundary delivery

The runtime must check for steering at these boundaries:

1. Before starting a model request.
2. After a model response has completed and before executing its tool calls.
3. Before each individual tool call.
4. After each tool result and before the next tool call.
5. Before treating a model response as the terminal answer.

**FR-20:** The currently executing foreground or asynchronous tool may finish before steering is applied.

**FR-21:** Once steering is available at a boundary, the runtime must not start any remaining unstarted tool call from the superseded model response.

**FR-22:** Every skipped OpenAI tool call must receive a synthetic matching tool result so the next request preserves protocol validity.

Required synthetic result shape:

```json
{
  "success": false,
  "skipped": true,
  "reason": "superseded_by_user_steering"
}
```

**FR-23:** Completed tool results remain in model context and persisted audit history.

**FR-24:** After applying steering, the loop must begin another model round using the updated transcript.

**FR-25:** Steering rounds count toward the existing bounded tool/model round budget. A clear controlled error must be returned if the budget is exhausted.

### 8.6 Model streaming semantics

**FR-26:** V1 steering does not inject content into an already-open HTTP completion request.

**FR-27:** If steering is accepted during provider token streaming, it remains `steering` until that model request reaches a boundary.

**FR-28:** The current provider stream must not be aborted solely because steering was accepted in v1.

**FR-29:** If visible assistant content has already streamed before steering applies, the UI must preserve it and show a localized “Direction updated” marker before revised continuation content.

**FR-30:** The final persisted assistant result must preserve the visible content order and steering marker without duplicating token deltas.

### 8.7 Tool and policy safety

**FR-31:** Steering cannot grant tool permission or satisfy a pending permission card.

**FR-32:** Steering cannot answer a structured Plan Mode `AskUserQuestion`; that flow remains separate.

**FR-33:** Steering cannot change the advertised tool catalog except through the model’s next normal tool selection.

**FR-34:** Existing `SkillExecutor`, `AgentToolPolicyService`, workspace trust, Plan Mode policy, and approval-mode checks remain authoritative.

**FR-35:** Tool arguments generated before steering must not be reused for skipped tool calls after steering.

### 8.8 Cancellation prerequisite

**FR-36:** Before release, cancellation of an async `ToolJobRegistry` job must propagate an abort signal to the actual underlying tool execution.

**FR-37:** `run_subagent` must pass its execution context signal into `AgentRuntime` so a cancelled outer job cannot continue consuming model or tool resources invisibly.

**FR-38:** The existing Agent Task List cancel action must not claim success until it is wired to a real main-process cancellation path.

This prerequisite is shared infrastructure. Steering normally waits for a tool boundary, but Stop and queue recovery must not rely on cancellation that only changes a registry label.

### 8.9 Persistence and history

**FR-39:** Queued messages must not enter `AIChatContextAssembler` history until they are dispatched or applied as steering.

**FR-40:** Pending records must remain queryable independently from normal `ai_chat_messages` rows.

**FR-41:** Applying steering must create a durable normal user transcript record with steering metadata before or atomically with marking the pending record applied.

**FR-42:** Normal dispatch must promote a pending record into a durable user transcript row exactly once.

**FR-43:** Conversation history responses must include enough pending-message data for the renderer to reconstruct queued bubbles after reload.

**FR-44:** Clearing a conversation must cancel or delete its pending messages and release their pending attachment storage.

**FR-45:** Clearing all chat history or switching user databases must clear runtime bindings without crossing user boundaries.

### 8.10 Events and receipts

The main process must expose structured lifecycle events:

```typescript
type PendingMessageEventType =
  | "queued"
  | "steering"
  | "steering_applied"
  | "dispatching"
  | "sent"
  | "paused"
  | "cancelled"
  | "failed";
```

**FR-46:** Events must contain `conversationId`, `pendingMessageId`, status, and timestamp.

**FR-47:** Steering-applied events must include the boundary and active assistant message ID.

**FR-48:** Events must not contain attachment bytes, provider credentials, hidden reasoning, or unsanitized tool results.

---

## 9. State Model

### 9.1 Pending message states

```text
                         ┌───────────────┐
               ┌────────►  dispatching  ├────────► sent
               │         └───────┬───────┘
               │                 │
created ───► queued              └──────────────► failed
               │
               ├────────► steering ─────────────► applied
               │              │
               │              └────────────────► queued (restart recovery only)
               │
               ├────────► paused ───────────────► queued
               │
               └───────────────────────────────► cancelled
```

### 9.2 Terminal states

- `sent`
- `applied`
- `cancelled`
- `failed`, when failure is explicitly terminal rather than retryable

### 9.3 Invariants

1. A pending message is either eligible for normal dispatch or claimed for steering, never both.
2. A pending message produces at most one normal `ai_chat_messages` user row.
3. A steering instruction is applied to at most one active assistant turn.
4. At most one normal turn runs per conversation.
5. Queues in different conversations may progress independently.
6. A terminal pending record cannot return to a non-terminal state except through an explicit user retry that creates a new attempt/record.

---

## 10. Proposed Product Data Contract

The technical design may refine storage details, but the product requires the following logical shape:

```typescript
type AIChatPendingMessageStatus =
  | "queued"
  | "steering"
  | "applied"
  | "dispatching"
  | "sent"
  | "paused"
  | "cancelled"
  | "failed";

interface AIChatPendingMessageView {
  pendingMessageId: string;
  conversationId: string;
  clientRequestId: string;
  sequence: number;
  content: string;
  status: AIChatPendingMessageStatus;
  createdAt: string;
  updatedAt: string;
  attachmentMetadata?: ChatV2AttachmentMetadata[];
  canSteer: boolean;
  steeringBoundary?:
    | "before_model"
    | "after_model"
    | "before_tool"
    | "after_tool"
    | "before_complete";
  activeAssistantMessageId?: string;
  sentMessageId?: string;
  failureReason?: string;
  recoveryReason?: string;
}
```

Recommended persistence boundary:

- New `AIChatPendingMessageEntity` for status, ordering, idempotency, and lifecycle metadata.
- Pending attachment storage through a dedicated entity or stable staged-file reference owned by Model/Module layers.
- Normal `AIChatMessageEntity` remains the source of truth only for messages actually delivered to the model.

The pending entity must be registered in the existing TypeORM configuration. IPC handlers must never obtain its repository directly.

---

## 11. Runtime Architecture Requirements

### 11.1 Current path

```text
AiChatV2.vue
  -> views/api/aiChatV2.ts
  -> preload channel allowlist
  -> ai-chat-v2-ipc.ts
  -> AIChatQueryEngine
  -> AIChatQueryLoop
  -> AiChatApi / OpenAI-compatible provider
  -> SkillExecutor / ToolJobRegistry
```

### 11.2 Target path

```text
Renderer submission
  -> AI-gated validated IPC
  -> AIChatPendingMessageModule
     -> AIChatPendingMessageModel -> SQLite
  -> AIChatTurnQueueService
     -> AIChatQueryEngine active-turn control
        -> steering mailbox
        -> AIChatQueryLoop safe-boundary drain
  -> pending-message lifecycle event
  -> renderer bubble update
```

### 11.3 Runtime control

`AIChatQueryEngine` should extend its existing per-conversation active-turn entry with a steering mailbox or a reusable runtime-control object.

Logical contract:

```typescript
interface SteeringMailbox {
  enqueue(message: AIChatSteeringInstruction): SteeringReceipt;
  drain(boundary: AIChatSafeBoundary): AIChatSteeringInstruction[];
  hasPending(): boolean;
  close(): void;
}
```

The query loop receives the mailbox through `AIChatQueryLoopInput`. It does not query TypeORM or IPC directly.

### 11.4 Applying more than one steering message

If multiple messages are accepted before one safe boundary:

- Preserve their chronological order.
- Persist each as an individual user-authored transcript record.
- Present them to the model as a clearly delimited ordered steering block or equivalent consecutive user messages.
- Mark each pending record applied only after it is added to the loop transcript.
- Do not let one malformed message prevent other valid messages from receiving a terminal outcome.

### 11.5 Server boundary

No aiFetch server change is required.

The server’s `/v1/chat/completions` contract already accepts the full OpenAI-compatible message transcript for each model request. After steering is applied locally, the next ordinary request contains the updated transcript.

The server must continue to:

- Stream one completion response.
- Forward tool-call deltas.
- Stop upstream work when the client disconnects where supported.
- Remain unaware of local `conversationId`, pending message IDs, and steering state.

A server steering API is deferred unless agent execution itself moves to the server. A future cloud runtime would require durable run ownership and cross-worker coordination, such as Redis-backed control messages, rather than an in-process endpoint.

---

## 12. IPC Requirements

Recommended channel surface:

| Channel | Direction | Purpose |
| --- | --- | --- |
| `ai-chat-v2:pending-message-create` | invoke | Persist a message for immediate or queued delivery |
| `ai-chat-v2:pending-message-list` | invoke | Load pending messages for a conversation |
| `ai-chat-v2:pending-message-steer` | invoke | Atomically promote one queued message to steering |
| `ai-chat-v2:pending-message-cancel` | invoke | Remove/cancel one queued message |
| `ai-chat-v2:pending-message-send-next` | invoke | Resume a paused queue explicitly |
| `ai-chat-v2:pending-message-event` | main -> renderer | Broadcast lifecycle changes |

Requirements:

- Every AI-related handler must use the project’s AI-enabled gate before work.
- Inputs must use strict Zod schemas with bounded string and array sizes.
- Handlers call Modules/Services, never TypeORM repositories.
- Renderer-provided status, sequence, timestamps, and ownership fields are untrusted.
- Responses use sanitized DTOs and do not expose local attachment storage paths unless already sanctioned by existing attachment contracts.
- Preload send/invoke/receive allowlists must include only the new named channels.

---

## 13. Security and Trust Requirements

### 13.1 Policy precedence

Model-facing instruction priority remains:

1. Application safety and system policy.
2. Workspace trust and approved workspace instructions.
3. Tool permission and Plan Mode policy.
4. Current user request and user steering.
5. Tool output and retrieved external content.

Steering is user-originated content. It is not a system message and cannot override higher layers.

### 13.2 Prompt-injection handling

- External tool content cannot enqueue steering.
- Only authenticated renderer IPC associated with the current local user may create or steer pending messages.
- A tool result containing text such as “click Steer” has no runtime authority.
- Steering content follows the same content and attachment validation rules as normal user messages.

### 13.3 Conversation ownership

- A pending message must belong to an existing or newly resolved V2 conversation in the active user database.
- Steering must verify that the active runtime and pending message share the same conversation ID.
- A renderer must not steer a task merely by guessing another pending message ID.

### 13.4 Resource limits

The technical design must define bounded defaults for:

- Maximum queued messages per conversation.
- Maximum queued text characters per message.
- Maximum total queued attachment bytes.
- Maximum steering messages consumed at one boundary.
- Maximum queue age before warning or cleanup.

Recommended starting values:

- 20 non-terminal queued messages per conversation.
- Existing normal chat text limit, or 32,000 characters if no stricter limit exists.
- Existing attachment limits with an additional cumulative queue cap.
- 10 steering messages per boundary.
- No silent age-based deletion; surface stale messages to the user.

---

## 14. Internationalization, Accessibility, and Visual Requirements

### 14.1 Internationalization

All new user-facing strings must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Required concepts include:

- Queued
- Steer
- Steering…
- Applied
- Applied after current tool
- Direction updated
- Queue paused
- Send next
- Remove queued message
- Attachment steering unavailable
- Message could not be queued/sent/steered

Every Vue usage must include the project’s English fallback pattern.

### 14.2 Accessibility

- Status must not rely only on color.
- Steer and remove actions require accessible names and keyboard focus.
- Screen readers must receive polite status announcements for queued, steering, applied, and failed transitions.
- Focus remains in the composer after queue submission.
- Clicking Steer must not move focus unexpectedly into the message list.
- Reduced-motion preferences must disable nonessential transition animations.

### 14.3 Responsive layout

- The queued status and Steer action must work at the chat dock’s narrowest supported width.
- Long queued content uses the same wrapping/truncation behavior as ordinary user messages.
- The status/action row must not overlap attachment previews or message timestamps.

---

## 15. Observability and Analytics

No user message content, attachment bytes, hidden reasoning, or tool arguments may be included in analytics.

Recommended local counters/events:

- `chat_pending_message_queued`
- `chat_pending_message_dispatched`
- `chat_pending_message_cancelled`
- `chat_steering_requested`
- `chat_steering_applied`
- `chat_steering_race_fallback`
- `chat_steering_rejected`
- `chat_tool_call_skipped_by_steering`
- `chat_queue_recovered_after_restart`

Useful dimensions:

- Provider kind: hosted/local.
- Conversation mode: chat/plan.
- Safe boundary type.
- Queue depth bucket.
- Time from queued to sent.
- Time from steering requested to applied.
- Rejection reason code.

Logs should include stable IDs and state transitions, not message text.

---

## 16. Edge Cases and Required Behavior

| Scenario | Required result |
| --- | --- |
| User double-clicks Send | Idempotency key produces one pending message |
| User double-clicks Steer | One conditional claim succeeds; later request returns latest state |
| Active turn finishes during steer click | Message falls back to next normal dispatch or reports already dispatching/sent |
| Steer accepted before first model request | Instruction is included before request starts |
| Steer accepted during token stream | Wait until request completes, then apply before terminal completion/next action |
| Steer accepted during tool A | Tool A completes; remaining unstarted calls are skipped |
| Tool A ignores cancellation | Steering waits for its boundary; Stop must still return UI control and cancellation gap is logged |
| Provider returns multiple tool calls | Each skipped call receives a matching synthetic result |
| Permission card is open | New messages queue; Steer is unavailable until runtime is running |
| Plan question is open | Dedicated answer flow remains authoritative; ordinary message queues |
| User steers message C while B is queued | C applies; B remains queued |
| Current turn fails | Queue pauses; no automatic drain |
| User stops current turn | Queue remains and pauses |
| User clears conversation | Pending messages and pending attachment storage are removed |
| User switches conversations | Each conversation retains independent queue/runtime state |
| App restarts with queued messages | Queue restores without automatic surprise execution |
| App restarts with steering state | Reconcile against transcript; unapplied item returns to queued |
| AI becomes disabled while queue exists | Keep local records, block dispatch/steering, show plan/availability error |
| Local provider has no tool support | Queue and text steering still work between plain completion requests |
| Queued attachment file becomes unreadable | Mark failed with actionable retry/remove state |
| Maximum queue depth reached | Reject new queue insert without clearing the draft |

---

## 17. Testing Requirements

### 17.1 Model and Module tests

Test:

- Create/list pending messages by conversation.
- Monotonic FIFO ordering.
- Idempotent insert by `clientRequestId`.
- Conditional `queued -> steering` claim.
- Conditional `queued -> dispatching` claim.
- Competing steer/dispatch claims.
- Applied/sent transcript linkage.
- Cancel and clear-conversation cleanup.
- Restart reconciliation.
- Active user database isolation.

### 17.2 Query loop tests

Test:

- Steering before the first model request.
- Steering after model completion but before tool execution.
- Steering after tool A and before tool B.
- Multiple steering messages retain order.
- Remaining tool calls receive synthetic skipped results.
- Completed tool A result remains in next model context.
- Steering before a terminal answer forces/permits the required continuation.
- Steering does not bypass permission or Plan Mode policy.
- Round limit behavior under repeated steering.
- Cancellation remains distinct from steering.

### 17.3 IPC tests

Test:

- AI-enabled check happens before processing.
- Invalid or oversized payloads are rejected.
- Conversation mismatch is rejected.
- Unknown and terminal pending message IDs return stable result codes.
- IPC handlers call Modules/Services and never repositories.
- Lifecycle event payloads are sanitized.

### 17.4 Vue component tests

Required component coverage under `test/vitest/main/components/`:

- Composer remains editable and can submit while streaming.
- Queued bubble renders in the correct position.
- Steer button visibility and disabled rules.
- Clicking Steer changes queued to steering without duplicate clicks.
- Applied, paused, failed, and sent states render correctly.
- Attachment messages show disabled steering explanation.
- Conversation switching restores the right queue.
- Keyboard and accessible-name behavior.
- All new UI text comes from i18n keys with fallbacks.

### 17.5 Electron E2E tests

Extend the fake OpenAI server scenarios and add critical flows:

1. **Queue after delayed stream:** Message B queues during A and sends after A completes.
2. **Steer between tools:** Provider requests tools A and B; A is delayed; user steers; B is never executed; next request contains A’s result, B’s skipped result, and steering.
3. **Stop preserves queue:** Stop A; B remains queued and does not auto-send.
4. **Error pauses queue:** A fails; B remains visible and unsent.
5. **No duplicate delivery:** Race steering with completion and assert one server request contains B as either steering or next turn, never both.
6. **Conversation isolation:** Queue/steer in A while B streams independently.
7. **Persistence:** Relaunch with the same database and restore queued messages.

Run gates:

```bash
yarn testmain
yarn test:components
yarn test:e2e
yarn vue-check
```

---

## 18. Rollout Plan

### Phase 0: Cancellation correctness

- Propagate `ToolJobRegistry` cancellation into underlying tool signals.
- Pass the signal through `run_subagent` to `AgentRuntime`.
- Wire real Agent Task cancellation or remove misleading controls until wired.

### Phase 1: Durable queue

- Add pending message persistence, Module/Model APIs, IPC, preload channels, renderer merge, FIFO dispatch, pause/recovery, and tests.
- Keep Steer hidden behind a disabled product flag if necessary.

### Phase 2: Steering control plane

- Add per-conversation steering mailboxes.
- Add safe-boundary checks and skipped tool results.
- Add steering lifecycle events and transcript metadata.
- Enable text-only Steer action.

### Phase 3: UX hardening

- Add remove, send-next, recovery, queue count, accessibility, translations, and E2E race coverage.
- Measure steering latency and rejection reasons.

### Phase 4: Future extensions

- Edit/reorder queued messages.
- Optional provider-round preemption.
- Attachment-aware steering after safe staging is proven.
- Reuse runtime control for specialist `AgentRuntime` tasks.
- Cloud-owned agent steering only if execution moves to the server.

### Feature controls

Recommended local controls:

- Queue can ship first behind a setting or product flag.
- Steering can have an independent kill switch.
- Disabling steering must leave queued normal dispatch intact.
- Disabling the entire feature must not orphan persisted pending messages; they remain recoverable or manually removable.

---

## 19. Acceptance Criteria

### Queue

- [ ] The composer accepts a valid message while the active conversation is running.
- [ ] The main process persists it before the UI shows a durable queued state.
- [ ] The queued bubble remains after conversation switching and reload.
- [ ] Queued messages dispatch FIFO after successful completion.
- [ ] Stop and error pause rather than drain the queue.
- [ ] Exactly one turn runs per conversation.
- [ ] Different conversations remain independent.

### Steering

- [ ] Every eligible queued text message shows a small Steer action.
- [ ] Clicking Steer atomically removes the message from normal dispatch eligibility.
- [ ] The UI distinguishes requested steering from applied steering.
- [ ] Steering applies at the next defined safe boundary.
- [ ] The current tool can finish, but remaining unstarted tool calls are skipped.
- [ ] Skipped calls receive protocol-valid synthetic tool results.
- [ ] Applied steering appears in durable conversation history.
- [ ] A steering/completion race cannot duplicate or lose the message.

### Safety and quality

- [ ] AI feature IPC gating runs before work.
- [ ] IPC contains no direct database access.
- [ ] Tool permissions, Plan Mode, and workspace trust remain authoritative.
- [ ] Async cancellation reaches actual underlying work.
- [ ] Attachments queue normally but cannot steer in v1.
- [ ] All six languages contain the new keys.
- [ ] Component and E2E critical-flow tests pass.
- [ ] No remote AI server change is required.

---

## 20. Risks and Mitigations

| Risk | User impact | Mitigation |
| --- | --- | --- |
| Steer/dispatch race duplicates a message | Model responds twice or performs duplicate tools | Conditional state claims plus idempotency keys and transcript linkage |
| Queue stored only in renderer | Messages vanish on switch/reload/crash | Main-process ownership and SQLite persistence |
| Queued rows enter model history early | Model acts on messages before their turn | Dedicated pending entity excluded from context assembler |
| Steering interrupts a side-effect tool | Partial or corrupt external action | Wait for current tool boundary by default |
| Remaining tool calls run after steer | Wasted or unwanted actions | Mailbox check before each tool and synthetic skipped results |
| Stop reports success while nested agent continues | Hidden cost and side effects | Complete abort-signal propagation before release |
| Too many queued messages create surprise automation | Long unattended chain of turns | Queue cap, visible count, pause after stop/error, kill switch |
| Attachments expire before dispatch | Queued message fails later | Durable staging/reference validation and explicit failed state |
| Old visible tokens conflict with revised direction | Confusing mixed response | Direction-updated marker and ordered final persistence |
| Server-specific implementation breaks local providers | Feature behaves differently by provider | Keep control entirely in Electron and use standard completion requests |

---

## 21. Dependencies

- Existing per-conversation `AIChatQueryEngine.activeTurns` ownership.
- Existing `AIChatQueryLoop` sequential model/tool rounds.
- Existing `AIChatV2Module` and `AIChatModule` persistence patterns.
- Existing validated, AI-gated IPC registration helpers.
- Existing conversation runtime-status polling and broadcasts.
- Existing attachment validation and staging services.
- Correct abort propagation through `ToolJobRegistry`, `SkillExecutionContext`, and `AgentRuntime`.
- UI test infrastructure using Vitest and Vue Test Utils.
- Electron E2E fake OpenAI provider scenarios.

---

## 22. Open Questions for Technical Design

The following decisions should be locked before implementation planning:

1. Should queued attachment bytes live in a new SQLite child table or use durable staged files with database references?
2. Should “Direction updated” split one assistant bubble into visual segments or create a local-only marker row between segments?
3. What exact normal chat text and cumulative queued attachment limits already exist and should be reused?
4. Should recovered queues require one explicit “Resume queue” action per conversation or a global startup preference?
5. Should applied steering messages remain visually labeled forever in history or only during the active session?
6. Should message removal be a terminal retained audit row or a hard delete before delivery?
7. Which existing conversation update broadcaster should carry pending-message state to background conversation views?

None of these questions changes the core product contract: queue by default, steer explicitly, apply at safe boundaries, persist intent, and never duplicate delivery.

---

## 23. Recommended Next Artifact

Create `docs/ai-chat-message-queue-technical-design.md` after this PRD is approved. It should specify:

- TypeORM entity and migration shape.
- Module/Model state-transition queries.
- Runtime-control and mailbox interfaces.
- Exact `AIChatQueryLoop` checkpoint changes.
- Event and IPC schemas.
- Renderer merge strategy for pending and persisted messages.
- Attachment staging choice.
- Restart reconciliation algorithm.
- Test fixtures and implementation phases.
