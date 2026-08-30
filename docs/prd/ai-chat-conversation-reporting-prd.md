# AiFetchly AI Chat Conversation Reporting - Product Requirements Document

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Proposed |
| Created | 2026-08-30 |
| Owner | AiFetchly product, privacy, safety, desktop, and backend engineering |
| Product areas | AI Chat V2, legacy AI chat, knowledge chat, AI-content reporting, settings/privacy, Microsoft Store certification |
| Target platforms | Windows Store build first; Windows and macOS desktop behavior must remain consistent |
| Parent PRD | `docs/prd/ai-content-reporting-prd.md` |
| Parent technical design | `docs/prd/ai-content-reporting-technical-design.md` |
| Primary desktop paths | `src/views/components/aiChatV2/`, `src/views/components/aiChat/AiChatBox.vue`, `src/views/pages/knowledge/ChatInterface.vue`, `src/views/components/aiContentReport/`, `src/entityTypes/aiContentReportTypes.ts`, `src/schemas/ipc/aiContentReport.ts` |

## 1. Summary

AiFetchly already supports reporting one AI-generated output from the action attached to that output. This is the most precise and privacy-preserving path, but it is not always easy to discover and it is inefficient when a concern spans several AI responses in the same conversation.

AiFetchly will add an always-available **Report conversation** action to each supported AI chat header. The action opens a localized selection flow where the user chooses one or more completed AI responses to report. Only selected AI responses are included by default. The user may explicitly opt in to include the user messages directly associated with those selected responses. The app shows the exact message set and transmission notice before submission.

The header action supplements, and never replaces, the existing per-output **Report AI output** action. It does not automatically upload the entire conversation. It does not include reasoning, tool arguments, tool logs, permission prompts, attachments, workspace files, hidden system messages, or unrelated conversation history.

The feature uses the existing AI-content-reporting service and backend review queue through a versioned multi-output request. It remains a safety function: it works when hosted AI is disabled or a subscription expires, does not consume AI credits, and does not call an AI model.

## 2. Problem

### 2.1 Per-output reporting can be difficult to discover

The existing action is attached to individual AI messages. On some chat surfaces, message actions appear only on hover. A user or Store reviewer may not find the control, particularly on touch devices, at high display scaling, or when using a keyboard or screen reader.

### 2.2 Some concerns span multiple AI responses

A single response may be harmless in isolation while a sequence of responses demonstrates repeated harassment, escalating dangerous advice, coordinated deception, or disclosure of personal information. Reporting each output separately fragments the evidence and creates duplicate review work.

### 2.3 Sending an entire transcript by default creates avoidable privacy risk

Chat conversations can contain customer information, passwords, pasted documents, business plans, personal data, and unrelated questions. A one-click full-transcript upload would conflict with the current product promise that reports contain bounded, user-selected evidence.

### 2.4 The existing request contract represents one output

`CreateAIContentReportRequest` schema version 1 contains one `output` and one optional `messageId`. The renderer boundary rejects unknown keys to prevent accidental inclusion of prompts and neighboring messages. Multi-output reporting therefore needs an explicit versioned contract and cannot be implemented by concatenating the current reactive conversation into one string.

## 3. Goals

1. Make conversation-level reporting discoverable from every supported AI chat header.
2. Preserve the existing per-output reporting action for fast and precise reports.
3. Let users report one or more completed AI responses in a single submission.
4. Include only the evidence the user can inspect and has selected or explicitly opted in to send.
5. Keep unrelated user messages and conversation history out of the report.
6. Preserve message order and identifiers so a reviewer can understand the selected sequence.
7. Keep the payload bounded, validated, retryable, and compatible with the existing report review queue.
8. Return one stable `air_...` reference for the multi-output report.
9. Support keyboard, screen reader, touch, 1,366 x 768 displays, and 200% Windows scaling.
10. Provide complete translations for English, Chinese, Spanish, French, German, and Japanese.
11. Keep reporting available independently of AI entitlement and model availability.
12. Add certification steps that demonstrate both the message-level and header-level reporting paths.

## 4. Non-Goals

1. Do not replace or hide the per-output **Report AI output** action.
2. Do not submit a report immediately when the header action is selected.
3. Do not select or send every conversation message by default.
4. Do not support an unbounded full-transcript upload in v1.
5. Do not include system messages, developer instructions, reasoning, chain-of-thought, tool calls, tool arguments, tool results, execution logs, permission prompts, hidden metadata, or internal recovery events.
6. Do not include attachment contents, pasted-file contents, workspace files, browser content, email inbox data, cookies, tokens, credentials, or local file paths.
7. Do not ask an AI model to summarize, classify, redact, or rewrite the report evidence.
8. Do not infer user consent from opening the dialog, selecting a category, or previously accepting a privacy policy.
9. Do not create a general support ticket, conversation export, or legal data-export feature.
10. Do not store report drafts or submitted reports in desktop SQLite.
11. Do not add an automatic offline queue in v1.
12. Do not promise an individual response or remediation outcome to the reporter.

## 5. Relationship to Existing AI-Content Reporting

This PRD extends the parent AI-content-reporting PRD; it does not replace it.

| Existing decision | Conversation-reporting extension |
| --- | --- |
| Reports identify a specific AI output. | A report may identify multiple explicitly selected AI outputs from one conversation. |
| Prompts and neighboring messages are excluded. | They remain excluded by default. A user may explicitly include only the directly related user messages defined in section 10. |
| Schema version 1 contains one output. | Schema version 2 adds an ordered `items` collection and a declared report scope. Schema version 1 remains valid. |
| Per-output action appears beside generated content. | The per-output action remains; the header adds a secondary discovery and multi-selection path. |
| One report returns one reference. | One multi-output submission returns one reference and appears as one review-queue item. |

Before implementation begins, the parent PRD and backend PRD must be updated to reference the explicit opt-in exception for related user messages. No existing client may begin sending prompts under schema version 1.

## 6. Users and Stakeholders

| User or stakeholder | Need |
| --- | --- |
| AiFetchly user | Find reporting quickly and select the specific sequence that demonstrates the concern. |
| Privacy-conscious user | Understand exactly which messages will leave the device and keep unrelated messages private. |
| Keyboard, touch, or screen-reader user | Reach the header action and complete message selection without hover or pointer-only controls. |
| Microsoft Store reviewer | Find a visible reporting entry without hidden navigation and submit a test report successfully. |
| Safety reviewer | Receive an ordered, bounded set of AI outputs with enough optional context to triage the concern. |
| Support operations | Use one stable report reference instead of correlating several separate reports manually. |
| Desktop engineering | Reuse the existing dialog, IPC, error handling, authentication, and localization patterns. |
| Backend engineering | Ingest a versioned multi-item payload without breaking existing schema-version-1 clients. |
| Privacy and legal owners | Approve consent wording, data minimization, retention, and access rules before release. |

## 7. Product Principles

1. **Selection before transmission.** The header action opens a selection flow; it never submits immediately.
2. **AI outputs by default.** Completed AI responses are eligible and initially unselected. User-authored messages require separate explicit consent.
3. **Related context, not the entire history.** Optional user context is limited to messages directly associated with selected AI responses.
4. **Visible evidence set.** The user can review every message that will be sent.
5. **One report, one concern.** Selected outputs must belong to one conversation and one submission category.
6. **Per-output reporting remains primary for isolated content.** The header path is for discovery and multi-output concerns.
7. **No model in the safety path.** Selection, filtering, truncation, and submission are deterministic local operations.
8. **Version contracts instead of weakening boundaries.** Multi-output support uses schema version 2; version 1 remains strict.
9. **Operational truth over decorative controls.** Release requires a live backend queue and a verified reviewer workflow.

## 8. Scope

### 8.1 P0 chat surfaces

| Surface | Header placement | Eligible AI outputs |
| --- | --- | --- |
| AI Chat V2 | Visible flag icon plus **Report conversation** in the chat header action group | Completed assistant text, generated images, plans, and reportable artifact summaries in the active conversation |
| Legacy AI chat | Visible header action, independent of hover-only message actions | Completed assistant text and supported generated-image messages |
| Knowledge chat | Visible action in the conversation header | Completed AI answers shown to the user |

### 8.2 Out of scope for this PRD

- Email-template editors, keyword generators, standalone artifacts, and automatic replies continue to use per-output reporting.
- A global application-level **Report AI content** page is not required.
- Cross-conversation selection is not supported.
- Deleted or unloaded messages are not fetched solely to build a report without informing the user.

## 9. Entry-Point Design

### 9.1 Header action

The chat header displays a flag icon and the visible label **Report conversation** on desktop widths that can accommodate text. At compact widths, an icon-only action is allowed only when it has:

- the accessible name **Report this conversation**;
- a localized tooltip;
- a minimum 44 x 44 CSS-pixel touch target; and
- a stable position in the header action group rather than an overflow menu.

The action remains available when:

- the conversation contains at least one completed reportable AI output;
- hosted AI is disabled;
- the subscription expired;
- the current model is unavailable;
- the conversation is historical; or
- generation is currently idle after an error.

The action is disabled, with a localized reason, only when no reportable AI output is present. It must not disappear merely because AI generation is disabled.

### 9.2 Per-output action

The existing **Report AI output** action remains visible beside or beneath every eligible AI output. It opens the current single-output dialog and continues to use schema version 1.

Legacy hover-only message actions must not be the only way to discover reporting. Header reporting must be permanently visible, and per-output reporting should also become keyboard- and touch-discoverable.

## 10. Reportable Conversation Evidence

### 10.1 Eligible AI items

An item is eligible when all conditions are true:

1. It belongs to the active conversation.
2. It is visible to the user in conversation history.
3. It represents completed AI-generated content.
4. It contains reportable text, generated-image evidence, a plan snapshot, or a bounded artifact summary.
5. It is not a typing indicator, raw tool event, permission prompt, error placeholder, system message, or empty message.

### 10.2 Selection rules

- The dialog lists eligible AI items in chronological order.
- No item is selected when the header flow first opens.
- The user must select at least one and may select at most 10 AI items.
- **Select all AI responses** is allowed only when there are 10 or fewer eligible items.
- When more than 10 eligible items exist, the user selects items manually and sees the limit before reaching it.
- Selection state is local to the open dialog and is discarded on cancel.
- Images inside a selected AI item follow the existing image-selection behavior and count toward the report-wide image limit.

### 10.3 Optional related user context

The dialog provides an unchecked option:

> **Include my related messages for context**

When enabled, the app includes only the user message that directly preceded each selected AI output in the same request-response sequence. Duplicate user messages are included once. The app does not include earlier unrelated prompts, later user messages, hidden messages, or the entire transcript.

The UI expands the evidence preview to show the exact related user messages that will be added. User messages use a distinct visual style and include the badge **Your message - will be sent**.

If a related user message contains attachments, mentions, pasted blocks, or file references:

- include only the visible plain text typed by the user;
- exclude attachment bytes and extracted contents;
- replace attachment and pasted-block bodies with a localized omission marker;
- exclude local paths and workspace-root data; and
- tell the user that attachments and files are not included.

Enabling this option constitutes consent only for the displayed related messages in the current submission. It is not remembered for later reports.

### 10.4 Evidence limits

| Limit | Requirement |
| --- | --- |
| Selected AI items | Maximum 10 |
| Included related user items | Maximum 10, one directly related user message per selected AI item |
| Total ordered items | Maximum 20 |
| Text per item | Maximum 8,000 Unicode characters |
| Aggregate text | Maximum 32,000 Unicode characters after deterministic truncation |
| Generated images | Maximum 3 across the entire report |
| Image preview size | Existing limit: 1,024 px longest edge and 1 MiB decoded per image |
| Optional explanation | Maximum 2,000 Unicode characters |

Truncation preserves the beginning and end of each affected item, marks the item as truncated, and preserves chronological order. The UI warns the user before submission when any selected evidence will be truncated.

## 11. User Journeys

### 11.1 Report several AI responses

1. User opens a conversation containing completed AI responses.
2. User selects **Report conversation** in the header.
3. A selection dialog lists eligible AI responses with timestamps and short escaped previews.
4. User selects the responses that demonstrate the concern.
5. User chooses a category and may enter an explanation.
6. The dialog states that only the selected AI responses and explanation will be sent.
7. User selects **Submit report**.
8. App displays **Report submitted. Reference: `air_...`** and offers **Copy reference**.
9. Selected messages show **Reported** for the remainder of the session; the header remains available for a different concern.

### 11.2 Include related user messages

1. User selects one or more AI responses.
2. User enables **Include my related messages for context**.
3. The dialog reveals the exact directly preceding user messages that will be included.
4. User reviews the expanded evidence set and the stronger consent notice.
5. User submits or disables the option before submission.

### 11.3 Cancel without sending

1. User opens the header reporting flow and changes selections.
2. User selects **Cancel**, presses Escape, or closes the dialog.
3. App sends nothing and discards selection, category, note, and consent state.
4. Focus returns to the header action.

### 11.4 Submission failure

1. Submission fails due to network, authentication, validation, payload size, rate limiting, disabled service, or server error.
2. The dialog stays open and preserves selections, optional user-context consent, category, and explanation.
3. App shows a localized safe error and **Try again**.
4. Manual retry uses the same `clientReportId` so the backend can return the original report instead of creating a duplicate.

### 11.5 Conversation changes while the dialog is open

1. A new message arrives, a message is deleted, or the active conversation changes.
2. The report continues to use immutable snapshots captured when the dialog opened.
3. If the active conversation changes, the dialog closes without submitting and announces that the report was cancelled because the conversation changed.
4. If an originally selected snapshot becomes unavailable before construction, the item is marked unavailable and the user must review the remaining evidence before submitting.

## 12. Functional Requirements

### FR-1 Header entry

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | Add a visible **Report conversation** action to each P0 chat header. | P0 |
| FR-1.2 | Keep the action independent of AI entitlement, subscription, and model availability. | P0 |
| FR-1.3 | Disable with an explanation when no eligible AI output exists; do not silently hide it after the user has opened a conversation. | P0 |
| FR-1.4 | Provide visible text on normal desktop widths and a labeled 44 x 44 icon target on compact widths. | P0 |
| FR-1.5 | Keep existing per-output report controls. | P0 |

### FR-2 Selection dialog

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | Title the flow **Report conversation**. | P0 |
| FR-2.2 | List eligible AI outputs chronologically with role, timestamp, content type, escaped preview, and selected state. | P0 |
| FR-2.3 | Require 1 to 10 selected AI outputs. | P0 |
| FR-2.4 | Never render selected content with `v-html`. | P0 |
| FR-2.5 | Support selecting generated images within selected outputs while enforcing three images across the report. | P0 |
| FR-2.6 | Require one existing report category and allow a 2,000-character explanation. | P0 |
| FR-2.7 | Keep selection and form state after a retryable failure. | P0 |
| FR-2.8 | Send nothing when the user closes or cancels the dialog. | P0 |
| FR-2.9 | Virtualize or incrementally render long eligible-message lists so opening remains responsive. | P1 |

### FR-3 Optional user context

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | Keep **Include my related messages for context** off by default on every open. | P0 |
| FR-3.2 | Include only the directly preceding user message associated with each selected AI item. | P0 |
| FR-3.3 | Show every included user message in the final evidence preview. | P0 |
| FR-3.4 | Exclude attachment contents, pasted-block contents, resolved file contents, local paths, mentions metadata, and hidden fields. | P0 |
| FR-3.5 | Change the transmission notice when user context is enabled. | P0 |
| FR-3.6 | Never remember the user-context choice across dialogs or sessions. | P0 |

### FR-4 Snapshot and construction

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Capture immutable snapshots when the header flow opens. | P0 |
| FR-4.2 | Preserve chronological order and stable message identifiers. | P0 |
| FR-4.3 | Enforce the limits in section 10.4 in both renderer construction and main-process validation. | P0 |
| FR-4.4 | Apply deterministic truncation and mark every truncated item. | P0 |
| FR-4.5 | Re-encode images through the existing bounded preview encoder. | P0 |
| FR-4.6 | Never send URLs, file paths, reactive objects, or unrestricted message metadata as evidence. | P0 |

### FR-5 Submission and confirmation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | Submit through a validated main-process IPC handler and the existing authenticated HTTP path. | P0 |
| FR-5.2 | Do not use the AI-entitlement wrapper and do not consume credits. | P0 |
| FR-5.3 | Disable duplicate submission while a request is in flight. | P0 |
| FR-5.4 | Reuse one `clientReportId` for manual retries of the same open report. | P0 |
| FR-5.5 | Display the exact backend `reportId` and provide **Copy reference**. | P0 |
| FR-5.6 | Mark selected AI outputs as **Reported** for the current session after success. | P1 |
| FR-5.7 | Keep the header action enabled after success so a different concern can be reported. | P0 |

## 13. UX Copy

English is the source language. Equivalent keys and accurate translations are required in all six language files.

| Intent | English source |
| --- | --- |
| Header action | Report conversation |
| Header accessible label | Report this conversation |
| Disabled tooltip | There are no completed AI responses to report. |
| Dialog title | Report conversation |
| Selection instruction | Select the AI responses you want AiFetchly to review. |
| Selection count | {selected} of {maximum} responses selected |
| Include context option | Include my related messages for context |
| Default consent | The selected AI responses and your description will be sent to AiFetchly for review. Your messages, other conversation content, files, and AI reasoning will not be included. |
| Context consent | The selected AI responses, the related messages shown above, and your description will be sent to AiFetchly for review. Other messages, files, attachments, and AI reasoning will not be included. |
| Attachment omission | Attachment and file contents are not included. |
| Truncation warning | Some selected messages are too long and will be shortened before submission. |
| Selection required | Select at least one AI response. |
| Selection limit | You can report up to 10 AI responses at once. |
| Conversation changed | The report was cancelled because the active conversation changed. |
| Submit | Submit report |
| Success | Report submitted. Reference: {reportId} |

## 14. Accessibility Requirements

1. Keyboard users can reach the header action without hovering.
2. Opening moves focus to the dialog heading or selection instruction; closing returns focus to the header action.
3. Each item uses a real checkbox with an accessible name containing output type and position.
4. Selected state, disabled state, validation errors, limit warnings, truncation warnings, submission status, and success are exposed to assistive technology.
5. The dialog supports logical tab order, Escape-to-close when not submitting, and no keyboard traps.
6. Message previews remain readable at 200% zoom and do not force horizontal scrolling.
7. The Submit and Cancel actions remain visible at 1,366 x 768 and 200% Windows scaling.
8. Touch targets are at least 44 x 44 CSS pixels.
9. Color is never the sole indication of AI versus user messages, selection, error, or sent state.
10. The evidence list announces when optional user context adds messages.

## 15. Privacy and Security Requirements

1. The default payload contains only selected AI items and the optional explanation.
2. Related user messages require a separate unchecked opt-in and visible preview.
3. The renderer builds evidence from an allowlisted snapshot type, not the full conversation object.
4. Main-process validation rejects unknown fields and message roles other than `assistant` and explicitly consented `user`.
5. Each user item must include `consentSource: "related_user_context_toggle"` in schema version 2.
6. System, developer, tool, reasoning, attachment, and hidden metadata fields are not representable in the accepted schema.
7. Report content never appears in renderer logs, main logs, analytics, crash reports, or error messages.
8. Logs may contain only `clientReportId`, backend `reportId`, surface, report scope, selected AI item count, included user item count, category, app version, HTTP result, and duration.
9. The report flow must not read new files, fetch attachment contents, resolve pasted blocks, or retrieve hidden conversation history.
10. Image evidence uses the existing preview encoder and never sends local paths or signed URLs.
11. The backend applies the same access, retention, audit, and operator-action rules as single-output reports.
12. Privacy-policy text must describe optional related-user-message transmission before the feature is enabled.
13. Feature rollout must remain disabled until privacy and backend owners approve the final consent copy and data contract.

## 16. Versioned Data Contract

### 16.1 Compatibility

- Per-output reporting continues to send schema version 1.
- Header multi-output reporting sends schema version 2.
- The existing endpoint remains `POST /api/ai/content-reports` unless the backend technical design establishes a migration reason.
- Backend version dispatch must reject unsupported versions with a safe validation error.
- Schema version 2 is additive at the endpoint level but is a separate strict schema, not a relaxed version-1 schema.

### 16.2 Proposed schema version 2

```typescript
type AIConversationReportScope =
  | "selected_ai_outputs"
  | "selected_ai_outputs_with_related_user_context";

interface AIConversationReportItem {
  itemId: string;                 // stable client item ID, max 128
  messageId: string;              // source message ID, max 128
  role: "assistant" | "user";
  contentType: AIContentType;
  text?: string;                  // max 8,000 chars per item
  textTruncated?: boolean;
  imagePreviews?: AIContentReportImagePreview[];
  generatedAt?: string;           // RFC3339
  model?: string;                 // assistant items only, max 128
  consentSource?: "related_user_context_toggle"; // required for user items
}

interface CreateAIConversationReportRequest {
  schemaVersion: 2;
  clientReportId: string;
  surface: "chat_v2" | "legacy_chat" | "knowledge_chat";
  reportScope: AIConversationReportScope;
  category: AIContentReportCategory;
  comment?: string;               // max 2,000 chars
  items: AIConversationReportItem[]; // 1-20 ordered items
  context: {
    conversationId: string;
    selectedAIItemCount: number;  // 1-10
    includedUserItemCount: number;// 0-10
    aggregateTextTruncated?: boolean;
    appVersion: string;
    platform: "win32" | "darwin" | "linux";
    locale: string;
    installId?: string;
  };
}
```

### 16.3 Cross-field validation

1. The renderer snapshot builder accepts messages only from the active conversation identified by `context.conversationId`; the main process accepts one bounded conversation identifier and never resolves arbitrary renderer-supplied paths or message sources.
2. At least one item has role `assistant`.
3. Assistant-item count is 1 to 10.
4. User-item count is 0 to 10.
5. User items must use `contentType: "text"` and are rejected when `reportScope` is `selected_ai_outputs`.
6. Every user item requires `consentSource` and must be the directly related predecessor of a selected assistant item.
7. `selectedAIItemCount` and `includedUserItemCount` equal the actual item counts.
8. Items are chronologically ordered and message IDs are unique.
9. Aggregate text is no more than 32,000 characters.
10. Image previews total no more than three across all items.
11. Unknown keys are rejected at every object level.
12. The response remains the existing `CreateAIContentReportResponse` with one `air_...` identifier.

## 17. Analytics and Diagnostics

Allowed metadata-only events:

| Event | Allowed properties |
| --- | --- |
| `ai_conversation_report_opened` | surface, eligible AI item count bucket, appVersion |
| `ai_conversation_report_scope_changed` | surface, user context enabled boolean |
| `ai_conversation_report_submitted` | surface, selected AI count bucket, included user count bucket, category, appVersion, duration bucket |
| `ai_conversation_report_failed` | surface, selected AI count bucket, safe error code, appVersion |

Analytics must not contain message text, comments, images, conversation or message identifiers, report identifiers, model names, prompts, or precise timestamps. Count buckets are `1`, `2-3`, `4-6`, and `7-10`.

## 18. Performance Requirements

1. Opening the dialog for a conversation with 500 stored messages completes within 300 ms on the Store certification reference device, excluding lazy image decoding.
2. Initial rendering processes metadata and bounded text previews only; it does not decode every generated image.
3. Image encoding starts only for selected images at submission time.
4. Selection changes complete within one animation frame for the visible list.
5. Request construction must not duplicate unbounded conversation objects in memory.
6. The UI remains responsive while encoding images and shows per-submit progress or an indeterminate loading state.

## 19. Error Handling

The feature reuses the existing safe error codes and localized retry behavior. It adds client-side errors for:

| Condition | User behavior |
| --- | --- |
| No AI item selected | Keep dialog open and focus the selection error. |
| More than 10 AI items selected | Prevent the extra selection and announce the limit. |
| Related user message unavailable | Exclude it, update the preview, and require the user to review before submission. |
| Aggregate text requires truncation | Show warning and permit submission after the user sees the warning. |
| More than three images selected | Prevent the extra image selection and announce the report-wide limit. |
| Active conversation changed | Close without sending and announce cancellation. |
| Snapshot no longer matches visible conversation | Do not silently refresh; ask the user to reopen the report flow. |
| Backend does not support schema version 2 | Show service-unavailable copy; do not fall back to concatenating messages into schema version 1. |

## 20. Testing Requirements

### 20.1 Unit tests

- Version-2 schema accepts valid selected-AI-only and opted-in-related-context requests.
- Schema rejects zero assistant items, too many items, unsupported roles, unknown keys, duplicate message IDs, invalid counts, invalid ordering, missing user consent source, user items under the default scope, excess aggregate text, and more than three images.
- Snapshot builder includes only eligible visible completed AI outputs.
- Related-context builder includes only directly preceding user messages.
- Builder removes attachments, pasted blocks, mentions metadata, tool data, reasoning, paths, and hidden fields.
- Truncation is deterministic, preserves beginning and end, preserves order, and marks affected items.
- Schema-version-1 tests remain unchanged and passing.

### 20.2 Component tests

- Header action is visible without hover on each P0 chat surface.
- Header action is disabled with a reason when there are no eligible AI outputs.
- Dialog lists only eligible AI outputs and begins with no selection.
- User can select 1 to 10 items and cannot exceed the limit.
- User-context option begins off on every open.
- Enabling context displays the exact related user messages and changes consent copy.
- Cancel sends nothing and resets all selections and consent.
- Failure preserves selection, consent, category, and explanation.
- Success displays the exact report reference.
- Focus enters the dialog, follows logical order, and returns to the header action.
- Dialog works at 1,366 x 768 and 200% scaling.

### 20.3 IPC and service tests

- Handler uses the non-AI validated wrapper and works when `USER_AI_ENABLED` is false.
- Validation occurs before HTTP submission.
- Unsupported schema versions fail safely.
- Service sends ordered items without unapproved conversation fields.
- Manual retry reuses `clientReportId` and duplicate backend response is success.
- Logs and analytics contain metadata only.
- No desktop database access is introduced.
- Version-1 per-output reporting remains compatible.

### 20.4 End-to-end tests

1. Generate at least three assistant responses.
2. Open **Report conversation** from the header without hovering over a message.
3. Select two AI responses and submit without user context.
4. Verify the stub backend receives exactly the two selected assistant items.
5. Repeat with related-user-context enabled and verify only the two directly related user messages are added.
6. Verify attachments, pasted contents, reasoning, tool events, and unselected history are absent.
7. Simulate a network failure, retry, and verify one backend report reference.
8. Repeat with hosted AI disabled and a historical conversation.
9. Run the flow using keyboard only and with each supported locale.

### 20.5 Store certification test

1. Install the exact Store package on the reference Windows environment.
2. Sign in with the certification account.
3. Open AI Assistant and create a conversation with at least two completed AI responses.
4. Select **Report conversation** from the always-visible header action.
5. Select both AI responses.
6. Leave related user context disabled.
7. Choose **Other**, enter **Microsoft certification multi-output test**, and submit.
8. Record the `air_...` reference.
9. Confirm the admin queue contains one report with exactly two ordered assistant items and no user messages.
10. Repeat with related user context enabled and verify the displayed user messages match the backend evidence.

## 21. Rollout Plan

### Phase 0: Contract and privacy approval

1. Update the parent desktop PRD and companion backend PRD with schema version 2.
2. Approve English consent copy and privacy-policy changes.
3. Implement backend version dispatch, validation, storage, and admin rendering behind a disabled capability.

### Phase 1: AI Chat V2

1. Add the header action and selection dialog.
2. Add deterministic snapshot and related-context builders.
3. Add schema version 2, service support, translations, component tests, and end-to-end tests.
4. Enable only when the backend advertises schema-version-2 support.

### Phase 2: Legacy and knowledge chat

1. Add the same header action and shared selection flow.
2. Remove report discoverability dependence on hover-only controls.
3. Complete parity, accessibility, and localization testing.

### Phase 3: Store evidence and controlled release

1. Publish privacy-policy changes.
2. Execute certification tests against the production-like queue.
3. Capture screenshots of header action, selection, consent, and success states.
4. Enable for the Store build after backend, privacy, and safety sign-off.

## 22. Success Metrics

| Metric | Target |
| --- | --- |
| Store reviewer locates reporting from the chat header | 100% without hover or external instructions |
| Header report submissions containing only user-selected AI items by default | 100% |
| Reports containing unrelated user messages | 0 |
| User messages transmitted without the related-context toggle | 0 |
| Reports containing reasoning, tool data, attachments, paths, or hidden messages | 0 |
| Valid submissions returning a stable reference when backend is healthy | At least 99% |
| Version-1 per-output report regression rate | 0 known regressions |
| Supported locales with complete conversation-reporting keys | 6 of 6 |
| Keyboard-only completion rate in accessibility test | 100% |
| Report dialog open time on certification device | At most 300 ms for 500-message history |

## 23. Acceptance Criteria

The feature is ready only when all conditions are true:

1. Every P0 chat surface has an always-discoverable header action.
2. Per-output reporting remains available and functional.
3. Header flow sends no data before explicit Submit.
4. Default scope includes only explicitly selected AI outputs.
5. Related user messages require a fresh unchecked opt-in and are all visible before submission.
6. Unrelated messages, system content, reasoning, tools, attachments, files, paths, and hidden metadata cannot enter the payload.
7. Selection, item, text, image, and comment limits are enforced in renderer and main process.
8. Schema version 2 is supported by the live backend and does not weaken version 1.
9. Success displays a stable `air_...` reference and retry is idempotent, meaning repeating the same request does not create a second report.
10. Reporting works when hosted AI is disabled and consumes no AI credits.
11. All six languages, component tests, IPC tests, end-to-end tests, accessibility tests, and Store certification tests pass.
12. Privacy policy, backend retention, admin review UI, and Store certification notes are updated.

## 24. Release Checklist

- [ ] Parent desktop PRD references this extension.
- [ ] Backend PRD defines schema version 2 ingestion, storage, and review.
- [ ] Privacy and legal approve the optional related-message consent.
- [ ] Public privacy policy is published before feature enablement.
- [ ] Backend advertises schema-version-2 capability.
- [ ] AI Chat V2 header action and dialog complete.
- [ ] Legacy and knowledge-chat header actions complete or inaccessible in the Store build.
- [ ] Per-output action regression tests pass.
- [ ] Six language files contain matching keys.
- [ ] Keyboard, screen-reader, touch, 1,366 x 768, and 200% scaling tests pass.
- [ ] Payload exclusion tests cover reasoning, tools, attachments, pasted content, mentions, and paths.
- [ ] Production-like backend queue receives and renders ordered multi-item evidence.
- [ ] Metadata-only logging and analytics verified.
- [ ] Certification screenshots and instructions updated.
- [ ] Test reports reviewed and operator actions recorded.

## 25. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Header action suggests that the entire transcript will be sent | Selection screen begins with nothing selected and states that only selected AI responses are sent. |
| Users accidentally include private prompts | Related-user-context option is off by default, shows exact messages, changes consent copy, and is never remembered. |
| Multi-output payload becomes too large | Cap item counts, per-item text, aggregate text, and total image previews; warn before deterministic truncation. |
| Renderer forwards hidden conversation fields | Build strict allowlisted snapshots and reject unknown keys at the main-process boundary. |
| Reviewers lose the sequence | Preserve chronological order, message identifiers, roles, timestamps, and truncation markers. |
| Backend version mismatch | Capability-gate the feature and never fall back to concatenating messages into schema version 1. |
| Header control crowds compact layouts | Use a labeled icon with tooltip and 44 x 44 target at compact widths; keep a stable header position. |
| Existing per-output reporting regresses | Keep schema version 1 and its UI path unchanged; run both suites in CI. |
| Legacy hover-only UI remains undiscoverable | Provide the permanent header entry and update message-action focus/touch behavior. |
| Optional context creates new retention obligations | Apply the same restricted review access and retention policy, update public disclosure, and require privacy sign-off. |

## 26. Final Product Decision

AiFetchly will add an always-discoverable **Report conversation** action to supported AI chat headers. The action will open a multi-selection flow rather than upload the entire transcript. Users will select 1 to 10 completed AI responses. Related user messages will remain excluded unless the user enables a fresh, unchecked option and reviews the exact related messages that will be sent.

The existing per-output **Report AI output** action will remain the primary path for isolated content. Header reports will use a strict schema-version-2 contract, preserve schema-version-1 compatibility, return one stable report reference, remain independent of AI entitlement, and ship only after backend, privacy, accessibility, localization, and Store-certification requirements are complete.
