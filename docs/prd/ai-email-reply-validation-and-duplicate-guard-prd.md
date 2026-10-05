# AI Email Reply Validation and Duplicate Guard — Product Requirements

## Document information

- **Status:** Revised draft; proposed behavior, not an implementation claim.
- **Reviewed:** 2026-10-05 against this repository's current implementation.
- **Owner:** Engineering; product owner reviews availability trade-offs before rollout.
- **Technical design:** [Implementation design](ai-email-reply-validation-and-duplicate-guard-technical-design.md).
- **Related requirements:** [Receive and auto-reply](ai-email-receive-auto-reply-prd.md), [thread-aware reply reliability](ai-email-thread-aware-reply-reliability-prd.md), and [outbound delivery](ai-outbound-email-intent-aware-delivery-prd.md).
- **Requirement numbering:** FR-025–FR-034 retain the earlier document's identifiers. FR-035–FR-039 close review gaps. These identifiers are local to this feature document.

## 1. Purpose and outcome

Make AI reply generation reliable without weakening validation, and prevent the
application from drafting or sending another reply to an inbound message that
has already been answered, is being sent, or has an unresolved delivery outcome.
Detect replies written outside the app using mailbox evidence, with explicit
handling of unavailable or ambiguous evidence.

Success means valid generated replies become reviewable drafts, concurrent
requests cannot create independent sendable drafts for the same inbound message,
and every actionable refusal explains what the operator can do next.

## 2. What the code actually does today

The previous draft identified a prompt/schema mismatch and missing message-level
duplicate guards, but overstated several causes and guarantees.

| Finding | Verified behavior | Product implication |
|---|---|---|
| Prompt contract disagrees with schema | `buildReplySystemMessage` requests `classification`; `generatedEmailReplySchema` requires `intentSuggestion`. | Align the contract at its source. This is a confirmed defect. |
| JSON formatting | `callLlmRaw` does not request JSON mode; request paths copy explicit supported fields. However, `extractJson` already tolerates fences and surrounding prose. | JSON mode is useful, not proof that prose wrapping caused the reported failure. |
| Output budget | Generation uses `max_tokens: 700` while asking for a reply under 400 words. It discards `finish_reason`. | Truncation is plausible; measure it and reject truncated completions explicitly. A larger budget cannot guarantee success across models/languages. |
| Correction loses context | The second call contains the system prompt and validation codes, but drops the original email and retrieved context. | A syntactically repaired answer may no longer answer the email accurately. Preserve context. |
| Manual reply flags already affect state | `EmailReceiveSyncService.toEntity` maps `isAnswered` to `replyStatus = "sent"`; `upsertByProviderUid` promotes existing rows to `sent`. | Observed `\Answered` replies are already represented. Missing provenance and stale observations remain problems. |
| Sync freshness | Sync defaults to unread-only and fetches at most 50 messages. | A read/answered message may never be refreshed by the next ordinary sync. |
| Draft creation | Generation does not inspect message reply state; draft, revision, and message status are persisted separately. | A status check is insufficient against concurrent generation. |
| Sending | `claimApprovedRevisionForSend` protects one draft/revision/approval. Successful finalization updates message `replyStatus` atomically. | Sibling drafts can send independently. `replyStatus` does not represent in-flight or unknown delivery. |

Source locations are listed in the technical design. The reported error does not
establish failure rates or prove every failure has the same cause. Validation
codes and completion telemetry are required to assess the fix.

## 3. Scope and product decisions

### 3.1 Included

- Prompt/schema alignment, provider-compatible JSON hints, context-preserving
  bounded correction, and completion-status checks.
- Duplicate eligibility before generation and immediately before sending,
  including atomic message-level concurrency protection.
- Fresh IMAP flag checks and Sent-folder detection, with a diagnostic
  `check_email_replied` tool using the same service.
- Structured results, safe caching, audit, translated refusals, upgrade handling,
  and tests for the required behavior.

### 3.2 Explicit decisions

1. **Detection is automatic.** Draft/send services enforce it; correctness cannot
   depend on the AI choosing to call a tool first.
2. **Three outcomes:** `replied`, `not_replied`, and `unknown`. `not_replied`
   means no reply was observed in the successfully checked mailbox scope at a
   stated time. It does not prove no external reply exists anywhere.
3. **Fail closed:** known replies, pending sends, unresolved delivery, and
   `unknown` mailbox results stop this automated workflow. Operators can retry
   transient checks, correct settings, reconcile delivery, or reply in their
   mailbox manually. V1 provides no AI-accessible bypass.
4. **Reuse existing drafts.** Return an eligible draft for editing/review instead
   of generating another. Approval remains separate.
5. **Positive evidence is sticky.** A later empty search, cleared flag, or deleted
   Sent copy cannot erase earlier evidence of a reply.
6. **Message scope:** protection is per mailbox/inbound identity, not per
   conversation. A new customer message in an answered thread gets its own checks.

### 3.3 Limits and exclusions

- POP3 has no comparable flag/Sent facility in the current abstraction. Without
  local positive evidence, external detection is `unknown`; this guarded workflow
  is unavailable for that message. Never use POP3 settings to connect via IMAP.
- No provider-specific Gmail/Outlook APIs, full Sent body ingestion, mailbox-wide
  backfill, or new automatic-send authority.
- No guarantee for replies that are not saved/synchronized, lose identifying
  headers, or are sent after the last mailbox check.
- Fresh checks reduce the external manual-send race but cannot eliminate it:
  the app cannot lock webmail, a phone, or SMTP delivery globally.
- Atomic protection is scoped to one app database and configured email service.
  Separate installations or duplicate service configurations sharing a mailbox
  have no shared reservation; cross-installation coordination is out of scope.
- Existing `sent` rows stay protected. Historical app sends and provider-flag
  promotions cannot reliably be distinguished retroactively.

## 4. Users and journeys

| Situation | Required outcome |
|---|---|
| Operator requests a reply to an unanswered IMAP message | Check local state and fresh mailbox evidence, generate valid content, persist one revision-bound draft, and return it for review. |
| User already replied through the app or an observed mailbox signal | Return `already_replied` with safe evidence; no classification/generation call or SMTP submission. |
| User already has an editable draft | Return it with `reused: true`; do not alter content or approval. |
| Two requests draft the same message | One holds the reservation; the other returns `generation_in_progress` or the committed draft. |
| User replies from a phone after AI drafting | Forced detection before send finds the reply and refuses submission. |
| SMTP may have accepted a prior reply | Return `delivery_unknown`; block all siblings until verified reconciliation. |
| Sent folder is unavailable or search times out | Return `reply_state_unknown` with a safe next step, never `replied: false`. |
| Generated content fails twice | Persist no draft; retain `needs_human_review` and sanitized diagnostics. |

## 5. Reply eligibility and state semantics

`replyStatus` is a coarse projection. Draft and send-attempt records remain
authoritative for in-flight and ambiguous delivery states.

| Evidence/state, evaluated in order | Draft action | Send action |
|---|---|---|
| Any local `sent` or persisted external positive evidence | Refuse `already_replied` | Refuse `already_replied` |
| Any draft/attempt `delivery_unknown` | Refuse `delivery_unknown` | Refuse `delivery_unknown` |
| Any draft `sending` or attempt `claimed`/`submitted` | Refuse `reply_in_progress` | Refuse `reply_in_progress`; retain idempotent same-attempt behavior |
| Multiple live drafts or contradictory records | Refuse `reply_state_conflict` | Refuse `reply_state_conflict` |
| One live `draft`/`approved`, or retryable `failed` draft | Return existing after mailbox check | Only this draft, valid approval, forced mailbox check |
| Live generation reservation | Refuse `generation_in_progress` | Refuse `generation_in_progress` |
| No local reply, fresh complete result `not_replied` | Eligible under existing policy | Eligible under existing approval/policy and atomic claim |
| No local reply, result `unknown` | Refuse `reply_state_unknown` | Refuse `reply_state_unknown` |

Discarded drafts do not block regeneration when no sent/in-flight/unknown
attempt exists. Verified non-delivery can reopen the same draft through existing
reconciliation; sending then needs fresh approval. Repair a stale `draft_created`
projection only after checking authoritative records. A missing draft alone does
not prove that no reply sent.

## 6. Functional requirements

### FR-025 — Align generation with the schema

- Prompt names `subject`, `bodyText`, `intentSuggestion`, and `confidence`,
  describes limits/types, and obtains enums from one shared contract. Optional
  review fields remain supported.
- Correction retains the original email, instructions, and bounded retrieved/
  conversation context. Add sanitized validation codes; do not copy invalid raw
  output into corrective instructions.
- Local validation and existing content/policy checks remain mandatory. Model
  confidence or suggested intent cannot override policy.

### FR-026 — JSON with bounded provider compatibility

- Request `response_format: { type: "json_object" }` on supported routes;
  desktop typing and both hosted/local payload builders forward it.
- Capability-confirmed unsupported routes omit the hint. An explicit
  unsupported-parameter rejection may retry once without it per logical attempt.
  Authentication, rate-limit, timeout, network, and generic server failures do
  not trigger this compatibility fallback.
- At most two reply-content validation attempts and four reply-generation
  transport submissions, including compatibility retries. Classification calls
  have a separate bounded budget within the overall generation deadline.
- Ignored hints still require local validation. Verify hosted support end to end
  instead of assuming it from desktop typing.

### FR-027 — Bound output and handle truncation

- Default allowance is 1,500 tokens, subject to actual model context/output
  limits. Keep concise-reply instructions; word count is not a cross-language
  token guarantee.
- `finish_reason = "length"`, refusal/content filtering, empty choices, and
  unexpected tool-call completions cannot create a draft even if JSON parses.
  A missing finish reason may proceed only through all local validation checks
  and is recorded as unavailable metadata.
- Truncation may use the single correction with shortening instructions. Never
  persist or silently repair a truncated answer.

### FR-028 — Guard generation and reuse drafts

- Check authoritative local evidence before classification/retrieval/model calls.
  Positive/in-flight/unknown/conflict decisions follow section 5.
- Return eligible existing drafts with ID and `reused: true`; no additional
  generation, edit, approval, or send occurs.
- Recheck eligibility when content commits. A reply detected during generation
  prevents draft persistence and releases the reservation.

### FR-029 — Shared policy enforcement

- Both `pre_draft` and `pre_send` apply the message-level local rules. Services,
  AI tools, IPC, and background automation cannot bypass them.
- One detection service supplies mailbox evidence. Policy does not independently
  repeat network probes or audit writes. Approval cannot override these denials.

### FR-030 — Persist answered flags and provenance

- Persist IMAP `isAnswered` plus observation time. Legacy rows have no observation
  time; default zero is not a fresh negative check.
- Targeted provider-metadata writes must not overwrite concurrently changed
  reply lifecycle, approvals, caches, or reservations.
- Preserve historical `sent` promotions. Future flags are recorded separately
  from app delivery status; clearing a flag never erases positive evidence.
- Eligibility probes refresh flags regardless of unread state. Bounded unread
  sync is not the freshness mechanism.

### FR-031 — Enforce mailbox evidence before draft and send

- Positive flag evidence blocks generation/send. A clear/absent flag triggers
  Sent detection; it does not establish `not_replied` alone.
- Draft generation/reuse may use a successful negative detection for at most
  60 seconds in the same mailbox configuration.
- Immediately before SMTP, force fresh detection regardless of negative cache.
  Require an observation at most five seconds old when claiming/submitting,
  rechecking if delayed; refuse if bounded refresh cannot establish freshness.
  Recheck local records atomically when claiming the send.

### FR-032 — Detection service and diagnostic tool

- `check_email_replied` accepts the positive integer **stored message row ID**
  `message_id`; resolve mailbox and RFC Message-ID server-side.
- Return `state`, `replied: boolean | null`, source/reason code, nullable check
  time, optional matched reply RFC Message-ID, and cache/coverage metadata.
  `unknown` always uses `replied: null`.
- Resolve Sent folders via special-use metadata before name fallbacks; missing,
  inaccessible, or ambiguous folders yield `unknown`.
- Parse headers and compare exact normalized tokens. `In-Reply-To` identifies
  direct parents; an occurrence anywhere in `References` is thread ancestry,
  not necessarily a reply to this message.
- Verify outbound sender against configured mailbox identity. References-only
  or unverified-sender candidates are `unknown` in V1 unless a verified direct
  reply is also found.
- Missing IDs, POP3, auth failure, partial search, timeout, and exhausted bounds
  return `unknown` with a safe bounded reason.
- Tool does not mutate the mailbox and needs no confirmation; local cache/read
  audit may update. Check AI enable at tool/IPC boundaries before parsing, DB
  work, or network I/O.

### FR-033 — Tool catalog and result compatibility

- Register the tool; create/fetch/get descriptions explain reuse, three-state
  evidence, and server enforcement.
- Summaries expose safe evidence/freshness alongside `replyStatus`. Credentials,
  connection objects, and raw mailbox errors stay in the main process.
- Preserve `success`/`error`; add stable codes, existing draft ID, and safe next
  actions. Never infer state by parsing English error strings.

### FR-034 — Audit and localization

- Each actionable refusal for a resolved message writes exactly one
  `reply_skipped` event per invocation: stage, reason code, request correlation
  ID, and bounded evidence. Layered checks share one audit owner. Disabled,
  invalid, or unresolved-ID requests do not create message audits.
- Reuse is a read/reuse event, not new creation/refusal. Audit persistence failure
  stops generation/send.
- Translate new/changed UI messages in `en`, `zh`, `es`, `fr`, `de`, and `ja`.
  Renderer changes include component tests; approval/recheck/reconciliation
  flows also require E2E coverage.

### FR-035 — Atomic generation reservation

- One persistent reservation per mailbox/inbound identity, acquired before model
  work with a unique owner token, five-minute lease, and atomic claim. Only its
  current owner can commit/release. The complete invocation has a five-minute
  deadline; model calls use at most 120 seconds and cannot exceed remaining time.
- Generate outside DB transactions. Commit draft, initial revision, message
  projection, guard binding, and creation audit together.
- After failure/crash, an expired lease may be reclaimed only without draft/send
  conflict. A late expired generator cannot commit.

### FR-036 — Message-level send protection

- Extend atomic send claim to inspect all related drafts/attempts and claim the
  message guard in the same transaction. Different approved sibling drafts
  cannot both submit SMTP.
- Sent/unknown outcomes keep protection. Confirmed failure before acceptance may
  allow the same draft's approved retry under current reliability rules; failure
  alone never authorizes a new sibling.
- Preserve revision/hash/approval binding, same-attempt idempotency, kill switch,
  recipient checks, and rate limits. SMTP stays outside the DB transaction.

### FR-037 — Safe evidence caching

- Store last complete negative result/time/context/version separately from
  positive evidence. Retain matched reply ID when available.
- Failed/partial probes never set successful-negative freshness. Later negative
  observations never erase positive evidence.
- Config/identity changes invalidate negative cache. Identity conflicts require
  review and cannot silently discard protection.
- Single-flight checks and mailbox concurrency bounds avoid repeated scans.

### FR-038 — Upgrade and legacy consistency

- Preserve statuses, approvals, attempts, IDs, and revision bindings in populated
  DB upgrades. Repeated initialization is safe.
- Resolve legacy siblings lazily: sent/in-flight/unknown blocks; multiple other
  live drafts require review. Never automatically delete/send/select them.
- Existing `sent` rows stay protected. No mailbox-wide backfill; check historical
  messages on use, including read messages.

### FR-039 — Bounds and rollout

- Detection has a 15-second overall deadline, at most five Sent folders and 200
  candidate header fetches per message, and one active probe per mailbox.
  Exceeding a bound yields `unknown`, never a negative.
- Measure validation codes, truncation, correction/fallback counts, duplicate
  denials, unknown reasons, probe latency, cache hits, and guard conflicts. Never
  log bodies, raw model output, or credentials.
- Pilot with working IMAP/Sent access; verify availability impact before broad
  rollout. Unsupported mailboxes remain clearly unavailable to this workflow.
  Disabling features cannot bypass local duplicate checks or restore unsafe
  automated sending.

## 7. Acceptance and verification matrix

| Area / requirements | Scenarios and assertions |
|---|---|
| Contract/correction / 025–027 | Valid first answer persists one draft; old field shape fails; correction retains context; truncated JSON and valid `length` completions persist nothing; two invalid attempts remain human review. |
| Provider routes / 026 | Hosted/local hints forwarded; unsupported rejection retries once; ignored hints validate; 401/429/timeouts do not fall back; attempt cap holds. |
| Local guards / 028–029 | Sent, sending, claimed/submitted, unknown, conflicts, reservations give stated codes with zero LLM calls; reuse preserves content/revision/approval. |
| Flags/sync / 030–031 | Insert/update flags and time; read message probed; legacy zero/null not negative proof; concurrent sync preserves successful send; clearing flag retains positive. |
| Matching / 032 | Exact parent, substring, unrelated ancestor, unverified sender, References-only, missing ID, multiple/localized Sent folders, POP3, inaccessible folder, false search return, deadline/cap. |
| Cache / 037 | Fresh negative saves draft probe; expired/config-changed rechecks; send forces probe; timeout never extends negative freshness; positive sticks; cached match ID retained. |
| Concurrency / 035–036 | At most one draft/revision for concurrent generation; expired owner cannot commit; sibling send race submits SMTP at most once; send completion during generation prevents commit. |
| Uncertain delivery / 036 | Unknown sibling blocks new work; recovery never resubmits; verified non-delivery allows fresh approval; reconciliation races cannot reopen known sent. |
| Tool/audit/UI / 033–034 | Disabled gate precedes parsing/I/O; codes survive wrappers; one refusal event; six languages; reuse and blocked-send component/E2E interactions. |
| Upgrade / 038 | Old-schema DB with sent/draft/approved/unknown/siblings initialized twice; data survives, safe defaults, conflicts refused. |

Release gates: deterministic cases pass; fake IMAP/SMTP integration proves
network boundaries; pilot confirms hosted JSON option is accepted or safely
omitted. Capture first-pass validation rate, unknown-check rate by reason, and
detection p95 against a pre-change baseline. Do not claim numeric improvements
until measured.

## 8. Risks and trade-offs

- Fail-closed checks reduce availability during outages and for POP3. Clear
  codes and retriable checks belong in the release.
- Flag behavior/Sent copies vary by provider and client. Do not claim Gmail or
  Outlook always sets `\Answered` without provider-specific tests.
- Header searches provide candidates. Conservative ambiguity handling may block
  legitimate replies; operator review is safer than replying to the wrong turn.
- Mailbox observations/SMTP cannot form a distributed transaction. The guarantee
  is one application-controlled submission per unresolved reply identity, with
  bounded detection of external replies.
- Atomic guard/persistence work expands beyond the original surgical patch. It
  is required for concurrency guarantees; unrelated refactoring is excluded.

## 9. Protocol references

- [RFC 5322 §3.6.4](https://www.rfc-editor.org/rfc/rfc5322.html#section-3.6.4): `In-Reply-To` identifies parents; `References` carries ancestry.
- [RFC 9051 §2.3.1 and §6.4.4](https://www.rfc-editor.org/rfc/rfc9051.html): flags, mailbox/UIDVALIDITY/UID identity, substring header search.
- [RFC 6154 §2](https://www.rfc-editor.org/rfc/rfc6154.html#section-2): optional, potentially multiple special-use `\Sent` mailboxes.
