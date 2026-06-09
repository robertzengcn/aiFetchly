# AI Chat Message Queue - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview

`AiChatBox.vue` currently treats an in-flight AI response as a fully blocking state. While the AI server is streaming a response, the input is disabled and the user cannot submit another message until the current response completes or is stopped.

This feature adds a local message queue to the AI chat experience. When the AI server is still handling the latest user message and the user enters another message, the app should queue that message locally instead of discarding it or forcing the user to wait. After the current AI response finishes, the app should automatically send the next queued message. The UI should also show the queue clearly so the user understands which messages are waiting and in what order they will be sent.

### 1.2 Objectives

- Allow the user to continue typing and submitting messages while an AI response is still streaming.
- Queue additional messages locally in first-in, first-out order.
- Automatically send the next queued message when the current AI response finishes.
- Show queued messages in the UI so the user can see pending work.
- Preserve the existing streaming behavior, tool-call rendering, and conversation history model.
- Avoid sending multiple chat requests concurrently for the same conversation unless the backend explicitly supports it.

### 1.3 Non-Goals

- Do not add parallel AI generation for one conversation.
- Do not change remote AI server protocol in this phase.
- Do not redesign the full AI chat UI.
- Do not persist queued messages across app restarts in this phase.
- Do not move queue ownership to the server in this phase.

## 2. Problem Statement

The current AI chat flow is optimized for a single request at a time. This is safe for the stream lifecycle, but it creates poor interaction quality when the user thinks faster than the model responds.

Current behavior problems:

- The input area is disabled during `isLoading`, so the user cannot type naturally while the assistant is answering.
- `sendMessage()` rejects new sends while `isLoading` is true, so there is no safe way to stage a follow-up request.
- The send button becomes a stop button during streaming, which prevents a clean "send this next" action.
- The user has no visibility into follow-up intent after the current response starts.

Desired behavior:

1. The user sends Message A.
2. The AI starts streaming the response to Message A.
3. Before Message A finishes, the user types and submits Message B.
4. The app stores Message B in a local queue and shows it in the UI.
5. When Message A finishes, the app automatically sends Message B.
6. If the user submits Message C while Message A or Message B is still active, Message C is placed after Message B.

## 3. User Experience Requirements

### 3.1 Input Behavior

While an AI response is streaming:

- The text input remains editable.
- The user can type a new message normally.
- The user can attach supported files to a queued message, subject to existing file constraints.
- Pressing Enter should submit the new message into the queue instead of blocking.

Recommended behavior:

- Keep the current message input independent from the active stream state.
- Continue to block only actions that are unsafe, such as starting a second concurrent stream directly.

### 3.2 Send and Stop Controls

The current control model overloads one button for two roles:

- send new message
- stop current generation

That becomes ambiguous once queueing is introduced.

Required behavior:

- The user must still be able to stop the active stream.
- The user must also be able to submit a new queued message while a stream is active.

Recommended UI:

- Keep a normal send action available at all times when the draft is valid.
- Show a separate stop action while a stream is active.

If the existing single-button pattern must be retained temporarily, the queue submission path must still remain accessible through Enter key submission. However, this is a compromise and not the preferred final UX.

### 3.3 Queue Visibility

The UI must show queued messages separately from normal chat history.

Recommended placement:

- Above the chat input area.

Recommended presentation:

- A compact panel titled `Queued Messages`.
- Total queued count.
- One row per queued item.
- Short preview text.
- Attachment indicator if files are included.
- Waiting order number.

Why separate from chat history:

- A queued message has not yet been sent to the server.
- Rendering it as a normal user bubble in the transcript would imply the backend already received it.
- The transcript should remain a record of sent messages, not drafts waiting for dispatch.

### 3.4 Queue Item Actions

Required item actions:

- Remove a queued item before it is sent.

Recommended optional actions:

- Clear all queued items.
- Edit queued item before sending, if implemented later.
- Reorder queued items, if implemented later.

This phase should only require removal. Reordering and editing add UX and state complexity and are not necessary for a first implementation.

### 3.5 Automatic Dispatch Feedback

When the active stream completes and a queued message begins sending:

- The queued item should disappear from the queue panel.
- That message should then appear in the normal transcript as a user message.
- Normal assistant placeholder and stream lifecycle should begin.

Recommended microcopy:

- `1 queued`
- `Sending next queued message...`

These strings must be added to all supported language files.

## 4. Functional Requirements

### 4.1 Queue Data Model

Add a local queue structure in `AiChatBox.vue` state.

Recommended interface:

```typescript
interface QueuedChatMessage {
  id: string;
  content: string;
  uploadedFiles: UploadedFilePayload[];
  attachments: LLMImageAttachmentPayload[];
  createdAt: Date;
}
```

Required properties:

- `id`: stable local identifier for rendering and item removal
- `content`: final user message text that will be sent
- `uploadedFiles`: local payload for persistence and request reuse
- `attachments`: image attachment payloads for model input reuse
- `createdAt`: used for ordering and future UX diagnostics

### 4.2 Queue Ordering

Queue ordering must be FIFO.

Rules:

- First queued message is sent first.
- New queued messages are appended at the tail.
- Removing one message must not disturb the order of the remaining items.

### 4.3 Submission Logic

When the user submits a message:

- If there is no active stream, send immediately through the current `sendMessage()` flow.
- If there is an active stream, enqueue the message instead of calling `sendMessage()` immediately.

This requires changing current logic in two places:

- `handleSendMessage()` must decide between immediate send and queueing.
- `sendMessage()` must no longer be silently called in a state where it can drop the message because `isLoading` is already true.

### 4.4 Queue Processing

When the current stream completes successfully:

- If queue length is `0`, return to idle.
- If queue length is `> 0`, dequeue the first item and send it automatically.

When the current stream ends with error:

- The queue should remain intact.
- The app should not silently discard queued items.

Recommended behavior after error:

- Stop automatic dispatch.
- Show the error normally.
- Allow the user to manually continue by resubmitting or retrying.

Alternative behavior:

- Automatically continue to the next queued item even if the previous message failed.

Recommendation:

- Do not auto-continue after stream failure in phase one.

Reason:

- A backend failure may indicate network or server instability.
- Automatically draining the queue during failure can create repeated errors and poor user control.

### 4.5 Stop Behavior

When the user clicks stop during an active stream:

- Stop only the current in-flight request.
- Do not clear queued messages automatically.

After stop:

- The queue remains visible.
- The user can decide whether to send the next queued item or remove queued items.

Recommended phase-one rule:

- Stopping the current stream should not automatically dispatch the next queued item.

This avoids ambiguity about whether "stop" means "cancel everything" or "skip to next".

### 4.6 Conversation Boundaries

Queued items belong to the current conversation context in the chat box.

Required behavior when switching to another conversation:

- Clear the local queue for safety, or
- block conversation switching while queue is non-empty, or
- move the queue with the conversation identity

Recommendation:

- Clear the queue when switching conversations or starting a new conversation, and show a confirmation if queue is non-empty.

Reason:

- The current queue is local component state and is tightly coupled to the active draft and current stream.
- Carrying unsent queued items into another conversation is high risk and confusing.

### 4.7 Attachments

Queued messages must preserve attachment payloads exactly as prepared at queue time.

Rules:

- File validation must still happen before queue insert.
- Attachment size limits and count limits remain unchanged.
- The queue stores the finalized payload objects, not raw `File` references only.

Reason:

- The message may wait in the queue after the user clears the draft UI.
- Deferred processing must not rely on transient UI state that can change before dispatch.

## 5. Technical Design

### 5.1 Existing Frontend Context

The current implementation in `src/views/components/aiChat/AiChatBox.vue` already has:

- local draft state via `inputMessage`
- active stream state via `isLoading`
- upload preparation in `handleSendMessage()`
- actual stream dispatch in `sendMessage()`
- stream completion and error cleanup in the stream callbacks

This feature should be implemented inside the same component first because:

- the queue behavior is tightly coupled to local draft UX
- the component already owns stream lifecycle state
- there is no evidence yet that queue state must be shared outside the chat box

### 5.2 Required State Additions

Recommended additional state:

```typescript
const messageQueue = ref<QueuedChatMessage[]>([]);
const isQueueProcessing = ref(false);
```

`isQueueProcessing` is optional but recommended if the implementation needs protection against double-dispatch during stream completion races.

Additional computed helpers:

```typescript
const queuedMessageCount = computed(() => messageQueue.value.length);
const hasQueuedMessages = computed(() => messageQueue.value.length > 0);
```

### 5.3 Recommended Refactor

Split the current submission path into three layers:

1. Draft normalization and attachment preparation
2. Queue-or-send decision
3. Actual stream dispatch

Recommended helper functions:

```typescript
async function buildOutgoingMessage(): Promise<QueuedChatMessage | null>
function enqueueMessage(message: QueuedChatMessage): void
async function processNextQueuedMessage(): Promise<void>
async function dispatchPreparedMessage(message: QueuedChatMessage): Promise<void>
```

Why this refactor is recommended:

- `handleSendMessage()` is currently doing payload preparation plus dispatch.
- Queueing requires a reusable prepared payload structure.
- Reusing one prepared-message shape avoids duplicating attachment conversion logic.

### 5.4 Dispatch Rules

Recommended control flow:

```text
User submits draft
-> validate input and files
-> build prepared queued message object
-> clear draft UI state
-> if isLoading === true
     -> enqueue prepared message
     -> render queue panel
   else
     -> dispatch prepared message immediately
```

Recommended completion flow:

```text
Active stream completes successfully
-> reset active stream indicators
-> if queue not empty
     -> dequeue first item
     -> dispatch it
```

Recommended stop flow:

```text
User stops active stream
-> stopStreamingChat()
-> keep queue unchanged
-> do not auto-dispatch next item
```

### 5.5 Transcript Integrity

Only sent messages should enter `messages`.

Rules:

- Queue insert does not push a `ChatMessage` into transcript.
- Dequeue plus actual dispatch pushes the user message into transcript.
- Assistant placeholder appears only when actual dispatch begins.

This keeps the transcript semantically correct and avoids false history.

### 5.6 Error Handling

Queue-related failure cases:

- attachment preparation fails
- stream request fails before first token
- stream request fails mid-stream
- conversation changes while queue exists

Required handling:

- Show existing `streamError` for active request failures.
- Do not lose queued items on active request failure.
- Allow the user to remove queued items manually.

Recommended queue failure policy:

- If dispatch of a queued item fails before the request starts, return it to the front of the queue or keep it visible as failed.
- If this is too much complexity for phase one, stop processing and show error without deleting the item until dispatch has clearly started.

### 5.7 Conversation Start and Pending IDs

The current implementation relies on `StreamState.PENDING` and `conversation_start` to assign the final conversation ID.

Queue behavior must respect this:

- Prepared queued items do not need their own final conversation ID in advance.
- When dequeued, they use the current active `conversationId` or pending flow exactly as immediate sends do.

This avoids overengineering queue items with stale conversation bindings.

## 6. UI Requirements

### 6.1 Queue Panel Layout

Add a new panel near the input area.

Recommended layout:

- Title: `Queued Messages`
- Count badge
- Scrollable list when many items exist
- Remove icon per row

Recommended row content:

- order number
- truncated text preview
- attachment count or file icon when applicable
- timestamp optional

### 6.2 Empty and Non-Empty States

When queue is empty:

- Do not render the panel, or
- render a collapsed empty state

Recommendation:

- Hide the panel when there are no queued messages.

When queue is non-empty:

- Render the panel immediately after queue insertion.
- Keep it visible while items remain.

### 6.3 Styling Direction

The queue panel should match the current Vuetify-based restrained chat UI.

Requirements:

- visually distinct from transcript bubbles
- compact and scannable
- no large card stack feeling
- no ambiguity with sent messages

Recommended style:

- bordered light panel above input
- small typography
- one-line or two-line preview rows
- subtle count chip

## 7. Internationalization Requirements

Any new user-facing text must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Likely new keys:

- queue title
- queued count
- remove queued message
- clear queued messages
- queued while assistant responding
- sending next queued message

## 8. Acceptance Criteria

### 8.1 Core Queue Flow

- User sends Message A.
- While Message A is streaming, user can still type in the input.
- User submits Message B.
- Message B appears in the queue panel, not in transcript history.
- When Message A completes successfully, Message B is sent automatically.
- Message B then appears in transcript as a user message.

### 8.2 Multiple Queued Messages

- User sends Message A.
- While Message A is streaming, user submits Message B and Message C.
- Queue shows B first, C second.
- After A completes, B sends first.
- After B completes, C sends next.

### 8.3 Stop Flow

- User sends Message A.
- While A is streaming, user queues Message B.
- User clicks stop.
- Current response stops.
- Message B remains visible in queue.
- Message B is not auto-sent immediately after stop in phase one.

### 8.4 Error Flow

- User sends Message A.
- While A is streaming, user queues Message B.
- A fails with stream error.
- Queue still contains Message B.
- User can remove B or trigger the next send path manually.

### 8.5 Conversation Reset

- If the user starts a new conversation while queued items exist, the system must not silently send old queued items into the new conversation.

## 9. Implementation Notes

### 9.1 Recommended Incremental Build Order

1. Refactor draft preparation out of `handleSendMessage()`.
2. Add queue state and enqueue/dequeue helpers.
3. Re-enable input during active stream.
4. Add queue panel UI and removal action.
5. Trigger queue processing from stream completion callback.
6. Handle stop, error, and conversation reset edge cases.
7. Add i18n strings.

### 9.2 Risks

- Race conditions between stream completion and next queued dispatch.
- Confusion between queued local items and sent transcript messages.
- Attachment payload drift if queue stores transient state incorrectly.
- Unclear semantics around stop and auto-continue behavior.

### 9.3 Mitigations

- Keep one dispatch path only.
- Use prepared immutable queue items.
- Keep queue separate from transcript state.
- Disable automatic post-error queue draining in phase one.
- Clear or confirm queue on conversation reset.

## 10. Recommendation

The recommended first implementation is:

- local FIFO queue in `AiChatBox.vue`
- queue panel above input
- editable input during active streaming
- separate queued-item rendering outside transcript
- automatic next-message dispatch only after successful completion
- queued items preserved after stop or error

This is the lowest-risk version that materially improves usability without changing the backend contract or the existing stream event model.
