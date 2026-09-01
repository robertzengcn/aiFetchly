# AI Chat Conversation Reporting — Open TODO

| Field | Value |
| --- | --- |
| Status | Backend (schema v2 / non-AI-gated IPC / service / fail-closed capabilities) implemented and tested. TODOs 1–8, 10–14 complete; TODO-9 (E2E §20.4 run-through) deferred — see its note. |
| Created | 2026-08-31 |
| Source PRD | `docs/prd/ai-chat-conversation-reporting-prd.md` |
| Technical design | `docs/prd/ai-chat-conversation-reporting-technical-design.md` |
| Rollout checklist | `docs/prd/ai-chat-conversation-reporting-rollout-checklist.md` |
| Audited worktree | `/Users/cengjianze/project/aiFetchly/.claude/worktrees/conversation-reporting` |
| Audited branch | `worktree-conversation-reporting` |
| Audit result | Utility 512 tests (incl. `tsc --noEmit`), components 150, main IPC/service 61 — all green; `vue-typecheck` clean. |

The secure core (Zod v1/v2 boundary schema, `registerValidatedHandler` non-AI-gated IPC, fail-closed capability service with 5-minute TTL, immutable snapshot builders, deterministic truncation, item-list/dialog components, 3 P0 surfaces, six-language i18n parity) is implemented. This file lists **unfinished** work from the PRD audit. Items build on existing code — no architecture is being re-litigated.

Priority:

- **P0** — privacy-critical: without these the dialog can transmit user content the user never saw described, or omit required consent/truncation disclosure
- **P1** — functional gaps in the shipped user flow
- **P2** — polish, analytics, and design-gap items

---

## P0 — privacy-critical

### TODO-1 — Related user messages are never previewed before upload (FR-3.3, Journey 11.2, §10.3)

- **Priority:** P0 (privacy)
- **Why incomplete:** `AIConversationReportItemList.vue` renders only `snapshot.candidates` (AI outputs). When the user enables "Include related user context", the related user messages are uploaded to the backend without ever being shown in the dialog — no distinct style, no "Your message - will be sent" badge, no `aria-live` announce. The `related_message_unavailable` and `attachmentOmitted` i18n keys are defined but never used.
- **Where:** `src/views/components/aiContentReport/AIConversationReportItemList.vue`, `AIConversationReportDialog.vue`; builder `conversationReportSnapshot.ts` already computes `relatedUserItem` / `omittedAttachmentContent`.
- **Done when:** Enabling the context toggle expands the evidence section to show the exact related user messages (styled distinctly, labeled "Your message — will be sent"). Attachment-omission notice shows when media exists in the context. Messages map to i18n in all six languages; component tests cover shown/hidden and opted-in/out states.

### TODO-2 — Truncation warning is not implemented (FR-4.4, §10.4, Journey 11.1 step 7)

- **Priority:** P0
- **Why incomplete:** `conversationReportText.ts` truncates deterministically (8000/item, 32000 aggregate, head-marker-tail) but the UI never warns the user before submission. The `truncationWarning` i18n key is defined but unused; `continueAndSubmit` is used only as the static submit label — there is no warn-then-confirm gate.
- **Where:** `AIConversationReportDialog.vue` submit flow, `conversationReportText.ts`.
- **Done when:** Before submit, the dialog detects truncation in the current snapshot and shows `truncationWarning` with a confirm control ("Continue and submit"). Non-truncated reports submit in one step as today.

### TODO-3 — Consent copy never changes when user context is enabled (FR-3.5, §10.3)

- **Priority:** P0
- **Why incomplete:** The dialog renders only the default consent line (`consentDefault`). Toggling "Include related user context" leaves the transmission notice unchanged, so the specific implications of transmitting user messages are never disclosed. `consentWithUserContext` is defined in all six language files but never referenced.
- **Where:** `AIConversationReportDialog.vue` consent/transmission notice.
- **Done when:** Enabling the context toggle swaps the notice to `consentWithUserContext`; tests assert the toggle drives copy in both states.

---

## P1 — functional gaps in the user flow

### TODO-4 — Report reference is never surfaced; no "Copy reference" (FR-5.5, Journey 11.1 step 8)

- **Priority:** P1
- **Why incomplete:** The conversation dialog has no copy-reference control (only `AIContentReportDialog.vue` implements `copyReference`). Parents close the dialog immediately on `submitted` — `AiChatV2.vue:4882`, `AiChatBox.vue:1011`, knowledge `ChatInterface.vue` — so the returned `air_...` reference is never shown or copied.
- **Where:** `src/views/components/aiContentReport/AIConversationReportDialog.vue`; parents `src/views/components/aiChatV2/AiChatV2.vue`, `src/views/components/aiChat/AiChatBox.vue`, `src/views/pages/knowledge/ChatInterface.vue`.
- **Done when:** On success the conversation dialog shows the report reference with a working "Copy reference" button and stays open until the user dismisses it (matching the single-output dialog); the session marks the conversation Reported. Keyboard and component tests cover the copy control.

### TODO-5 — No select-all, and selection limit is not enforced in the UI (PRD §10.2)

- **Priority:** P1
- **Why incomplete:** `selectAll` i18n key is defined but no select-all control exists ("Select all" is required only when the eligible list ≤ 10). The 1–10 selection limit is enforced only at build/submit time (`selection_limit` error) instead of preventing the extra selection and announcing "of maximum".
- **Where:** `AIConversationReportItemList.vue`, `AIConversationReportDialog.vue`.
- **Done when:** Select-all appears when eligible ≤ 10; checkbox selection prevents exceeding 10 with the required announcement; the list label shows `selectionCount`/total.

### TODO-6 — Generated images are never selectable in the conversation dialog (FR-2.5, §10.2)

- **Priority:** P1
- **Why incomplete:** The dialog always passes `selectedImageIds: new Set<string>()`; `AIConversationReportItemList.vue` offers no per-image checkbox. Generated images from the conversation can therefore never be included in a report even though the v2 schema and `AIContentReportImageEncoder` support up to 3.
- **Where:** `conversationReportRequest.ts`, `AIConversationReportDialog.vue`, `AIConversationReportItemList.vue`.
- **Done when:** Eligible items render per-image checkboxes defaulting to selected (single item selected by default); submission encodes selected images through the existing encoder with the ≤ 3 / 1 MiB / 1024px caps.

### TODO-7 — Header button is not disabled when there is nothing reportable (FR-1.3, §9.1)

- **Priority:** P1
- **Why incomplete:** `conversationReportEnabled` on all three surfaces is computed purely from capability (fail-closed on fetch error). With zero eligible AI outputs the button is still enabled and opens an empty dialog. `noEligibleOutputs` i18n key is defined but unused.
- **Where:** `src/views/components/aiChatV2/AiChatV2.vue`, `src/views/components/aiChat/AiChatBox.vue`, `src/views/pages/knowledge/ChatInterface.vue`.
- **Done when:** Button is enabled only when capability is available *and* at least one eligible AI output exists; otherwise disabled with the tooltip/copy from `noEligibleOutputs`.

### TODO-8 — Dialog is not closed when the active conversation changes (Journey 11.5, §19)

- **Priority:** P1
- **Why incomplete:** No surface watches the conversation ID to cancel/close the reporting dialog. Switching conversation while the dialog is open can send a report built from the previous conversation state (the `conversation_changed` local error exists in the builder but the UI has no guard).
- **Where:** `AiChatV2.vue`, `AiChatBox.vue`, `ChatInterface.vue` (add watcher wiring `conversationReportDialogOpen` to active conversation ID).
- **Done when:** Changing the active conversation closes the dialog without submitting; a component test covers the switch-while-open case.

### TODO-9 — E2E coverage is smoke-only (PRD §20.4)

- **Priority:** P1
- **Status:** Deferred (2026-09-01). The fail-closed smoke spec remains and
  passes; the full §20.4 run-through is deferred.
- **Why deferred:** A submit-to-completion E2E flow requires the FakeOpenAI
  loopback server (or a sibling fake) to serve the content-report
  `capabilities` and `create` endpoints. The content-report service uses the
  authenticated `HttpClient`, whose base is `VITE_LOGIN_URL + "/apis"` — and
  the E2E env explicitly strips `*LOGIN_URL*` (`test/e2e/fixtures/electronApp.ts`
  env-sanitization regex), routing the login base at `localhost:3000`, which
  nothing serves, so capabilities fail-close to `enabled:false`. Routing the
  report path through loopback needs new fake-server routes + an E2E env
  contract change, and the Playwright Electron suite requires `xvfb`/Linux and
  cannot be run or verified on the macOS dev machine. The privacy-critical
  surface (snapshot immutability, bounded-payload encoder, fail-closed gate,
  selection/idempotency) is already covered by the Vitest component + utility
  suites that DO run locally; only the end-to-end Playwright layer is missing.
- **Why incomplete:** `test/e2e/specs/conversationReport.spec.ts` only asserts the button is visible and disabled under the fail-closed network guard. PRD §20.4 specifies a full run-through: open from header on Chat V2, select two items, enable context, submit against a stub backend verifying the bounded payload, retry page keeps dialog state, `clientReportId` idempotency, keyboard-only flow, and locale smoke.
- **Where:** `test/e2e/specs/conversationReport.spec.ts`; a stub response for `AI_CONTENT_REPORT_CREATE`.
- **Done when:** The §20.4 steps above exist as automated Playwright specs and pass; the fail-closed spec remains.

---

## P2 — polish, analytics, and design-gap items

### TODO-10 — Item rows omit timestamps (FR-2.2, §10.1)

- **Priority:** P2
- **Why incomplete:** `AIConversationReportItemList.vue` shows content type + preview but no timestamp column/element. Snapshots do not carry an RFC3339 timestamp per candidate.
- **Done when:** Candidates expose `generatedAt`; the list renders it; test asserts presence.

### TODO-11 — Eligible list is not virtualized (FR-2.9, §10.1)

- **Priority:** P2 (PRD marks virtualization P1)
- **Why incomplete:** All candidates are rendered inside a fixed max-height (280px) scroll container. Very long conversations render every row.
- **Done when:** Long lists are windowed (e.g. reuse an existing virtual-list primitive or cap rendered rows with a documented tradeoff); no further change if a maintained primitive is already present.

### TODO-12 — Server-advertised capability limits are not clamped to desktop maximums (design §15.2)

- **Priority:** P2 (design gap, not a PRD FR)
- **Why incomplete:** `AIContentReportService.getCapabilities()` returns server limits as-is (e.g. a backend advertising `maxItems: 200` lifts desktop v2 caps), and the snapshot builders budget against client constants only. Design §15.2 requires clamping server limits to the desktop hard maximums.
- **Done when:** Service applies `Math.min(server, desktopMax)` per limit; capability tests cover over-advertised backends.

### TODO-13 — Renderer analytics events are not emitted (PRD §19.1, design §19.1)

- **Priority:** P2 (permitted to omit per design)
- **Why incomplete:** No renderer event firing for `ai_conversation_report_opened` / `ai_conversation_report_scope_changed`. Only submit/failure are reported from the main process. Design §19.1 allows omission but the PRD §19.1 lists them as product requirements. Must contain only allowed properties (surface, scope) — no content, ids, or report output.
- **Done when:** The two allowed events fire with only allowed properties; a test proves no content leaks into the payload.

### TODO-14 — Knowledge chat does not regenerate conversation identity on Clear (design §11.3)

- **Priority:** P2
- **Why incomplete:** `ChatInterface.vue` keeps `knowledgeConversationId` minted once per mount; `clearChat` does not regenerate it. Design §11.3 calls for a new id after Clear so a report is never attributed across cleared sessions.
- **Done when:** `clearChat` regenerates `knowledgeConversationId`; the knowledge snapshot uses the new id.

---

## Explicitly out of scope (do not add)

These are PRD non-goals or Phase 2+ and are **not** incomplete v1 work:

- Report-status lookup, server-side admin review, or remote moderation of local chat (backend responsibility)
- Correlation with `ai-content-reporting-external` reports; merging the two dialogs
- Automatic (non-user-triggered) conversation reporting
- Uploading raw reasoning, prompts, the full transcript, or tool results unless the user selects the specific output item
- Offline report queue / local persistence of reports in desktop SQLite

---

## Reference

- PRD: `docs/prd/ai-chat-conversation-reporting-prd.md` §7, §9–§11, §19–§20 (FR-1.3, FR-2.2, FR-2.5, FR-2.9, FR-3.3, FR-3.5, FR-4.4, FR-5.5)
- Tech design: `docs/prd/ai-chat-conversation-reporting-technical-design.md` §9–§19
- Shared UI: `src/views/components/aiContentReport/` (`AIConversationReportButton/Dialog/ItemList.vue`, `conversationReportSnapshot.ts`, `conversationReportRequest.ts`, `conversationReportText.ts`)
- IPC: `src/main-process/communication/ai-content-report-ipc.ts`
- Service: `src/service/AIContentReportService.ts`, `src/service/AIContentReportErrorMapper.ts`
- Schema: `src/schemas/ipc/aiContentReport.ts`, `src/schemas/api/aiContentReport.ts`
- Tests: `test/vitest/utilitycode/` (schema/snapshot/request/text/encoder/i18n-parity), `test/vitest/main/` (ipc/service/malformed-handler/allowlist), `test/vitest/main/components/` (button/dialog/item-list + three surfaces), `test/e2e/specs/conversationReport.spec.ts`