# AI Chat Automatic Titles and Manual Renaming — PRD

Status: Proposed; implementation has not started.
Date: 2026-10-28
Scope: AiFetchly workspace AI chat, including interactive messages drained from its pending-message queue.
Companion: [Technical design](ai-chat-automatic-titles-technical-design.md).

## 1. Product decision

Give each new chat a recognizable title after its first meaningful completed exchange. Generate the title with a lightweight model using a small, bounded excerpt of the conversation. Let the user rename any chat from either the header or sidebar, and preserve that name until the user changes it again.

A smaller model generally reduces cost per token; it does not inherently reduce the number of tokens processed. This feature controls both cost and usage through a dedicated lightweight model, bounded input/output, and at most one automatic generation attempt per new conversation lifecycle.

The decisions below translate the preceding product discussion into implementation defaults. They are proposed requirements, not descriptions of already delivered behavior. In particular, v1 uses **no automatic retry after model dispatch**. This is the most conservative version of the previously discussed limited retry policy.

## 2. Current behavior and gaps

Code inspected on 2026-10-28 establishes the following baseline:

| Existing capability | Gap addressed by this proposal |
| --- | --- |
| Message persistence passes user content as `generatedTitle`; the conversation model fills an empty title from it. | This is a message excerpt, not a model-generated summary of the user's goal. |
| `AIChatConversationEntity` stores `title` and `titleIsUserSet`. | There is no durable distinction between a provisional excerpt and a completed AI title, nor a title-generation lifecycle. |
| The workspace header has a Rename action, and the center surface calls the rename IPC API. | Sidebar discovery, validation feedback, error recovery, and synchronization need a shared design. |
| Rename persists a user-set flag. | Read/modify/save projection writers can still race with other writes; the flag alone is not an atomic guarantee. |
| Hosted requests recognize the `small` alias. | The current desktop client can retry a failed alias request using the default model. |
| Custom-provider requests map the small alias to their configured default model. | That model is not necessarily lightweight or inexpensive. |

See the technical design's source map for the corresponding implementation files. Existing rename behavior must be extended rather than duplicated.

## 3. Problem and desired outcome

Users accumulate chats about lead research, outreach, email drafting, file analysis, and automation. A long first-message excerpt or generic label makes it difficult to find the right conversation later. Requiring a name before chatting adds friction, while changing names repeatedly makes previously recognizable conversations hard to locate.

The desired experience is: start chatting immediately, receive a useful stable title automatically, and edit it whenever the user's own naming convention is more useful.

Example:

> User: “Can you find dentists in Sydney and help me prepare an outreach email?”
>
> Generated title: “Sydney Dentist Outreach”
>
> Optional user rename: “Sydney Dentists — November Campaign”

The generated title describes intent. It must not claim that leads were collected or emails were sent merely because the user requested those actions.

## 4. Goals and non-goals

### Goals

1. Make chats recognizable without requiring manual naming.
2. Bound the extra model usage and prevent fallback to a more expensive model.
3. Keep the chat response, next message, and navigation responsive while naming runs.
4. Give users permanent control over names they enter.
5. Keep header, sidebar, search, and reopened conversations consistent.
6. Respect provider configuration, local-only operation, and AI availability.
7. Deliver complete UI translations and tests for English, Chinese, Spanish, French, German, and Japanese.

### Non-goals for v1

- Continuously renaming a chat as its topic changes.
- A “Regenerate title” action or automatic retry after a provider request.
- Sending entire histories, tools, attachments, memories, or reasoning for naming.
- Automatically naming old conversations in a background batch.
- Naming standalone scheduled tasks, autonomous goal runs, or subagent conversations. Interactive queue-drained turns are included.
- Selecting a lightweight model by guessing from its name or assuming a local model is small.
- Installing/downloading a model or configuring a different provider automatically.
- Renaming workspace folders, files, reports, plans, or individual messages.

## 5. User stories

| ID | Story | Observable outcome |
| --- | --- | --- |
| US-01 | As a user starting a chat, I want a useful title without extra steps. | A provisional excerpt becomes a concise topic title after an eligible exchange. |
| US-02 | As a user organizing campaigns, I want to choose my own name. | Rename works from header and sidebar and survives later messages and restarts. |
| US-03 | As a cost-conscious user, I want naming to use few resources. | One bounded request uses only the lightweight model; failures keep the excerpt. |
| US-04 | As a local-provider user, I want my conversation to stay with my configured endpoint. | Naming never changes provider or uses hosted AI as a fallback. |
| US-05 | As a multilingual user, I want recognizable names in my language. | The title follows the substantive user request's language. |
| US-06 | As a keyboard or touch user, I want an accessible rename action. | Controls work without hover, retain focus, and expose useful labels. |

## 6. Functional requirements

### FR-01 — Placeholder and provisional title

- An empty chat displays the localized “New chat” label. Do not store the translated placeholder as a permanent title.
- After the first user message is durably saved, show a normalized, bounded excerpt immediately.
- For a greeting-only opening, the next substantive request may replace that greeting excerpt before generation starts.
- Excerpts are plain text, with whitespace collapsed and obvious credential values removed using the same bounded sanitization used for title input.
- Both excerpt and AI title are editable. A user can name an empty chat once its conversation record exists.

### FR-02 — Generation trigger and eligibility

- Trigger from successful **durable completion**, not from receiving a partial stream or mounting a Vue component.
- Require an interactive user message and its associated completed assistant response. Include the interactive queued-message path.
- Exclude cancelled, interrupted, failed, permission-only, tool-only, scheduled-only, and empty responses.
- Skip greetings and acknowledgments such as “Hi”, “Thanks”, and “好的”. Eligibility must not require another model call.
- Examine at most the first three completed interactive exchanges. If none has a substantive request, retain the excerpt and stop automatic evaluation for that lifecycle.
- Attachment-only messages without a meaningful typed request retain the fallback title; do not open or summarize attachments just to name a chat.
- Once the generation attempt has been consumed, later exchanges do not automatically initiate another attempt.

### FR-03 — Lightweight model routing

- Hosted mode uses the existing hosted small-model route with a new strict no-model-fallback policy.
- If the hosted small model is unavailable or unsupported, keep the excerpt. Do not retry with the main chat model or an unspecified server default.
- Custom-provider mode requires an explicitly configured title model at the **same endpoint**. Do not silently use `defaultModel`.
- A local/custom title model can be the same as the chat model if the user explicitly selects it. The UI must not claim verified savings for such a selection.
- No public vendor/model name or current price is hard-coded in this PRD. Hosted deployment configuration chooses its small model; custom users choose from their own provider.
- Missing configuration keeps the excerpt and does not block normal chat.

### FR-04 — Usage budget and frequency

| Budget | v1 default |
| --- | --- |
| Automatic model dispatches | At most 1 per conversation lifecycle |
| Input target | Approximately 500–1,000 total tokens, including instructions |
| Input with a supported tokenizer | Hard maximum of 1,024 input tokens |
| Input without a supported tokenizer | Bounded serialized input, at most 4,096 UTF-8 bytes; report token counts as estimates |
| Output allocation | Maximum 64 completion tokens using the adapter's supported parameter |
| Visible AI title | Prefer 4–8 words or equivalent short phrase; maximum 80 Unicode code points and within the 200 UTF-16-unit storage limit |
| Request deadline | 10 seconds, including response body consumption |
| Automatic retry after dispatch | None |
| Concurrent title requests | 1 per application process; foreground chat takes priority |

The byte fallback is a size bound, not a universal guarantee of 1,024 tokens. Providers must enforce a supported output cap; unsupported or noncompliant adapters are not eligible for automatic naming. Do not advertise a fixed percentage of savings without measurements.

### FR-05 — Title quality

- Capture the user's main goal, topic, and useful distinguishing details such as industry, location, or artifact type.
- Prefer a noun phrase; avoid filler such as “A conversation about”.
- Match the substantive user request's language, including when the UI language differs.
- For mixed-language requests, use the dominant language of that request; the UI locale is only a tie-breaker.
- Do not include quotes around the title, explanations, Markdown, raw URLs, email addresses, tokens, or full local paths.
- Do not invent entities or turn a requested activity into a claim of completed work.
- If there is insufficient topic information, the model may return an empty string; retain the excerpt without retrying.
- Validate output before saving. A malformed response must never replace the excerpt.

### FR-06 — Rename interactions

- Keep the existing header overflow action and add Rename to each sidebar conversation's actions menu.
- Sidebar actions target that row's conversation, even if a different chat is selected.
- Use one shared rename dialog with a prefilled field, visible character counter, Save and Cancel.
- Trim surrounding whitespace and normalize line breaks to spaces. Reject an empty/whitespace-only name and reject values over 200 UTF-16 code units. Do not silently truncate a manual name.
- Enter saves unless an input-method composition is active; Escape cancels. Save is disabled while saving or invalid.
- Show inline errors and preserve the typed name on failure. A missing conversation is reported as unavailable, not as successful renaming.
- Persist before showing success. After success, update header/sidebar/search without a page reload.
- Renaming is local metadata work: it does not invoke AI, require a working network, or consume AI credits.

### FR-07 — Manual ownership and concurrent updates

- Saving any valid manual name, including the current visible name, locks ownership to the user.
- A late model response must never overwrite a manual rename.
- A message projection update, read-marker update, old summary event, or bootstrap response must not restore an older title.
- When two manual saves succeed, the database commit order determines the final name; revision ordering makes every renderer converge to it.
- Rename does not mark a chat unread, change its message count, or move it to the top of a recency-sorted list.

### FR-08 — Settings and user control

Add a small “Chat titles” section to AI Provider settings:

| Setting | Default and behavior |
| --- | --- |
| Automatically name new chats | Enabled; disables all new automatic dispatches when turned off |
| Hosted title model | Informational: uses the service's lightweight model; no separate model picker in v1 |
| Custom-provider title model | Empty by default; explicit model ID or model-picker selection required |

Explain that naming uses a short excerpt and may incur a small amount of provider usage. For custom mode, say “Uses your configured provider”; the existing `local` mode can point to a remote endpoint and must not be described as necessarily offline.

The title-model setting is bound to provider identity. Changing endpoint/preset clears it unless explicitly saved again with the new provider. Switching provider mode never transfers conversation excerpts to the newly selected endpoint for an already queued title job.

Disabling automatic titles cancels pending/in-flight work best effort and prevents late output from being applied. It does not delete existing titles. Re-enabling applies to future eligible completions; it does not launch a batch or retry consumed attempts.

### FR-09 — Persistence and lifecycle

- Save titles locally using the existing Model/Module architecture.
- Preserve manual names and existing legacy titles during upgrades. Do not infer that an old excerpt needs a paid AI call.
- On restart, retain saved titles; an interrupted dispatched attempt falls back permanently for that lifecycle.
- Opening history, changing chats, searching, or restarting must never itself trigger model usage.
- Duplicating a conversation copies its visible title and preserves manual ownership where applicable. The duplicate does not automatically spend tokens to rename copied history.
- Clearing messages retains a manual name. For nonmanual names, clear the title and start a new lifecycle; the next meaningful exchange can consume one new attempt.
- Deleting a conversation cancels outstanding work; a late result must not recreate the conversation.

### FR-10 — Error behavior

| Condition | User experience |
| --- | --- |
| AI unavailable, feature off, or title model missing | Excerpt stays visible; chat continues |
| Timeout, rate limit, network error, or provider rejection | Excerpt stays visible; no automatic retry or chat error banner |
| Invalid or empty model output | Excerpt stays visible |
| Provider settings change during a request | Discard the late result; retain excerpt |
| Rename fails to persist | Keep dialog text, show actionable error, allow retry |
| Chat deleted during rename | Explain that the chat is no longer available |
| Push update missed | Next bootstrap/load restores authoritative saved title |

Model/provider errors belong in bounded diagnostics, not in a modal interrupting chat. Manual save errors must remain visible because the user explicitly requested the operation.

## 7. UX details and accessibility

1. Empty chat: localized placeholder, ordinary header action available after persistence.
2. First send: provisional excerpt appears immediately; no blocking naming spinner.
3. Completed exchange: title updates once if generation succeeds.
4. Sidebar menu: keyboard focus or touch exposes actions; the menu button is a sibling of the navigation button, never a nested button.
5. Rename dialog: accessible label, focus on/select existing name, associated error message, character limit hint, focus return to the invoking control.
6. A title update does not steal focus, close menus, change selected chat, or reset transcript scroll.
7. Render all title strings as text. Use visual ellipsis in narrow rows and expose the full saved name through an accessible label/tooltip.
8. Verify at 1,366 × 768 and 200% scaling, and with long translated labels.

All new labels, hints, validation errors, settings descriptions, and accessibility text must have keys in `src/views/lang/{en,zh,es,fr,de,ja}.ts` and use the repository's English fallback pattern. User-entered and model-generated titles are content; changing the UI locale must not translate them again.

## 8. Privacy and trust boundaries

- Use only bounded visible text from the selected exchange. Exclude system/developer messages, reasoning, tool payloads, attachments, expanded mentions, retrieved documents, memories, and credentials.
- Treat conversation text as untrusted data, including requests to ignore instructions or leak hidden information.
- Use no tools, browsing, retrieval, or file access during title generation.
- Heuristic credential removal is defense in depth, not a claim that arbitrary user text can be perfectly de-identified. Excerpt transmission remains limited to the already selected provider.
- Do not log prompt/response/title text through feature diagnostics or generic debug request logging for title requests. Collect metadata only.
- Generated names appear in navigation and may be visible on a shared screen; prefer general descriptions over incidental personal/contact details.

## 9. Acceptance criteria and traceability

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| AC-01 | FR-01/02 | A substantive first exchange replaces its excerpt with a useful title; the assistant response is displayed before naming completes. |
| AC-02 | FR-02 | A greeting followed by a task waits for the task; three greeting-only exchanges make zero model calls. |
| AC-03 | FR-02/04 | Duplicate terminal notifications, queued interactive turns, navigation, and restart cannot cause a second dispatch for the same lifecycle. |
| AC-04 | FR-03 | Hosted small-model failure produces one request and no default-model request. |
| AC-05 | FR-03/08 | Custom mode uses the explicitly selected title model at the original endpoint; absent selection makes zero calls. |
| AC-06 | FR-04 | Tests capture request budgets, input truncation, output cap, body deadline, and concurrency limit. |
| AC-07 | FR-05 | Titles follow request language, remain short, and describe intent without unsupported completion claims. |
| AC-08 | FR-06 | Header and sidebar rename support Save, Cancel, Enter, Escape, composition input, validation, and recoverable save failure. |
| AC-09 | FR-07 | Manual rename wins against delayed generation, concurrent projection/read-marker writes, and stale renderer events. |
| AC-10 | FR-07 | Title updates leave activity ordering, unread indicators, run state, and message counts unchanged. |
| AC-11 | FR-08/09 | Off/settings-change/delete/clear invalidates old work; neither restart nor upgrade triggers a naming batch. |
| AC-12 | FR-09 | Legacy, duplicate, cleared, and reopened chats follow the specified title ownership rules. |
| AC-13 | FR-06/10 | Manual rename works offline and with hosted AI disabled; failed saves are never displayed as successful. |
| AC-14 | §7/8 | All six UI languages, keyboard/touch navigation, escaping, input privacy, and metadata-only logs pass tests. |
| AC-15 | FR-02 | Scheduled/autonomous/subagent, failed, cancelled, tool-only, and attachment-only paths make zero title calls. |
| AC-16 | FR-10 | Every provider error leaves a usable fallback and never changes the completed chat turn to failed. |

## 10. Evaluation and release targets

Build a fixed set of at least 60 fixtures: 10 per supported language. Cover lead research, email drafting, file analysis, multi-intent requests, vague/greeting openings, mixed-language input, sensitive strings, misleading instructions, and long text. Include explicit expected properties rather than requiring one exact title.

For eligible substantive fixtures, human review scores topic accuracy (0–2), specificity (0–2), and readability (0–2). A passing title scores at least 5/6, matches the requested language, and violates no privacy/format rule. Target at least 90% pass overall and 80% per language, with zero observed credential leaks or fabricated completion claims in the fixture set. These are release targets, not measured results or universal guarantees.

Operational targets:

- Zero model calls for manual renaming and excluded conversations.
- Zero duplicate application dispatches within one lifecycle in deterministic tests.
- At least 95% of successful requests complete within 5 seconds in the declared test environment; all requests respect the 10-second client deadline. Slow local deployments may retain excerpts more often.
- No awaiting a title request on the foreground completion/queue-drain path.
- Report actual provider token usage when available; mark unavailable usage as unknown and estimates as estimates.
- Track successful generation, fallback reasons, dispatch count, duration, and late-result rejection without content logging. Do not add external analytics transmission in this feature.

## 11. Delivery plan

| Stage | Deliverable | Exit condition |
| --- | --- | --- |
| 1 | Persistence, ownership, revisions, and upgrade handling | Real SQLite concurrency/lifecycle tests pass |
| 2 | Strict provider routing and bounded request builder | No-model-fallback, context/output budgets, abort and privacy tests pass |
| 3 | Background generation and lifecycle wiring | Interactive and queue paths pass deduplication and restart tests |
| 4 | Shared rename UX, sidebar entry, settings, translations | Component suite and accessibility cases pass |
| 5 | E2E, multilingual evaluation, staged enablement | All acceptance criteria have recorded evidence |

Ship behind an internal feature flag first. Roll out to new conversations only. If generation is disabled for rollback, preserve saved names and keep manual rename functional. Local packaged-delivery checks are forbidden by `AGENTS.md`; any required packaged validation is an operator/CI gate.

## 12. Dependencies and bounded uncertainties

- Hosted `small` routing is documented by the desktop client; the server implementation is outside the inspected desktop code. Verify the deployed capability and no-fallback contract in integration tests before enabling hosted naming.
- Custom-provider output-limit compatibility and title quality must be evaluated with each supported adapter. Do not promise support for arbitrary reasoning-only models under a 64-token budget.
- The deterministic substantive-message heuristic cannot perfectly understand every language. Prefer a missed automatic title over another classifier request; manual rename remains the universal fallback.
- Release-specific model choice, prices, and measured latency are deployment data, not settled by this document.

## 13. Related documents

- [Technical design](ai-chat-automatic-titles-technical-design.md)
- [Workspace UI redesign PRD](ai-chat-workspace-ui-redesign-prd.md)
- [Local AI provider PRD](local-ai-provider-chat-prd.md)
- [Workspace generator streaming design](ai-chat-workspace-generator-streaming-technical-design.md)
