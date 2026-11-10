# Post-Merge Review Findings — TODO (filed 2026-10-05)

Source: `/review` over merge `bea3fec4` (test → dev, 63 commits). Codex
adversarial pass (gpt-6-astra) findings, each verified against the merged
tree. All are pre-existing test-branch behaviors the merge surfaced — none
were introduced by the merge resolutions. Decision (user, D1): fix the
mechanical subset now; file the rest here for a dedicated session.

Fixed in this session (see commits):
- **P2-7 orphan uploads** — `rag-ipc.ts` staged-file cleanup on metadata
  rejection + regression test (`ragSaveTempFileOrphanCleanup.test.ts`).
- **Engine threading regression tests** — `outboundSendPreAuthorized`
  pass-through pinned in `AIChatQueryEngine.historySelection.test.ts`.

## Filed findings

### P1-1 — Renderer-manufacturable outbound pre-authorization (design)
`ai-chat-scheduled-loop-ipc.ts:65` accepts `autoApproveTools` /
`allowedTools` from the renderer; `ScheduledAiMessageRunner.ts:359` derives
the trusted `outboundSendPreAuthorized` from them. A compromised renderer can
create a loop with `autoApproveTools: true` +
`allowedTools: ["start_email_send_task"]` without user consent (the creation
UI's type-to-confirm is renderer-side only).
**Fix direction:** bind the send privilege to a main-process-owned consent
record created only through a confirmed interactive flow, not editable task
config. Needs design work.

### P1-2 — Pre-auth overrides explicit "do not send" (resolver-level fix)
`AIChatQueryLoop.ts:3652`: `input.outboundSendPreAuthorized === true` bypasses
`canHonorModelDeclaredSkipReview`, so in a pre-allowlisted scheduled loop a
model-set `skip_review: true` sends even when the intent resolver read the
user's prompt as `explicit_do_not_send` / `conflicting_instruction`.
**IMPORTANT context found while fixing:** this bypass is a documented,
test-pinned trade-off — the resolver misreads scoped dedup negations ("do
not send to already-contacted companies") as global refusals, which
deadlocked unattended loops (see
`AIChatQueryLoopOutboundEmailGate.test.ts:685` and `:720`). A naive guard
re-introduces that deadlock.
**Fix direction:** upstream resolver work — teach the intent resolver to
distinguish exclusion clauses from global send-refusals; then the pre-auth
bypass can be narrowed to only the misread case.

### P2-3 — Knowledge metadata filter matches across fields
`RAGDocument.model.ts:~343`: pattern `%"key":%"value"%` lets `%` consume
intervening JSON, so `customer=Acme` also matches
`{"customer":"Other","category":"Acme"}` — wrong documents fed to searches.
**Fix direction:** parse the JSON per row (or `json_each`) and compare the
extracted property exactly.

### P2-4 — Tags unsearchable after filter rewrite
`RAGDocument.model.ts:~258`: LIKE-matching the serialized tags array breaks
for non-ASCII (JS `.toLowerCase()` vs SQLite ASCII-only `LOWER()`) and for
quote/backslash round-tripping. Verified: `Équipe`, `Acme "Gold"`, `C:\Docs`
return zero matches.
**Fix direction:** same as P2-3 — parse-and-compare instead of LIKE on the
serialized JSON text; normalize consistently.

### P2-5 — Scheduled reply truncated by history-reload race
`AiChatV2.vue:3514` preserves live messages only when
`runtime?.isStreaming`; scheduled streams never set it. Opening a
conversation mid-run can replace accumulated tokens with persisted history;
later tokens recreate only the suffix. Self-heals on the terminal reload.
**Fix direction:** reconcile `liveScheduledAssistant` during hydration the
way interactive streams merge, and reject stale history responses.

### P2-6 — Scheduled errors rendered as success
`AiChatV2.vue:2357`: `done` and `error` share a cleanup branch that discards
`event.errorMessage` and leaves partial text as a normal idle assistant
bubble (no `streamError`, no error metadata).
**Fix direction:** handle `error` explicitly — surface the failure state,
persist a visible error row when nothing was written.

### P2-8 — Email-table pagination desync after tag change
`EmailServiceTable.vue`: `itemsPerPage` ref stays 10 (one-way prop) while
Vuetify paginates by the user's selected size; the tag watcher reloads with
10 rows — page 2 then skips filtered rows 11–25.
**Fix direction:** bind `itemsPerPage` bidirectionally and reuse current
table options for filter reloads.
