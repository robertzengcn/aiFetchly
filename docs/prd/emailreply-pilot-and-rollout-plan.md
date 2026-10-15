# Email-Reply Validation — Pilot and Rollout Plan (T12 / FR-039)

**Status:** Operator-run plan. **No fabricated numeric results.** Per the technical
design §12 (`ai-email-reply-validation-and-duplicate-guard-technical-design.md`
L585–590): *"Release requires old-schema upgrade/reinitialization tests and an IMAP
pilot with verified Sent discovery and hosted JSON support/fallback. Compare
first-pass validation, correction/truncation rates, unknown reasons, detection
p95, and duplicate/guard conflicts against a captured baseline. No fabricated
numeric target. Disable guarded automation for unavailable mailbox detection;
never fall back to unsafe automatic sending. Keep local duplicate protections
active during rollback."*

This document specifies the activities, baselines, thresholds, and rollback
controls. The numeric baselines themselves are captured at pilot time against
live IMAP/hosted providers — they are NOT asserted by this checkout's test code,
which has no live mailbox access by design.

## Landed vs. executed (G04 status marker — do not collapse these)

These two tracks are DISTINCT and must never be conflated in requirement
claims:

- **Code/plan landed (this branch):** the detection/probe limits, unknown-not-
  negative cache rule, telemetry counters, generation JSON-compat fallback +
  capability clamp + remembered routes, bounded awaited stages, kill switch,
  upgrade validation, audit mirroring, and THIS plan document (including the
  G04 procedure correction in §4.1) are implemented and acceptance-verified by
  test code. Phase 2 CODE is complete on this branch.
- **Pilot executed (external, operator-run):** NO pilot of §4 has been
  executed as of 2026-10-15. No provider/capability results, no first-pass/
  correction/truncation/fallback rates, no unknown reasons, no detection p95,
  no cache/guard-conflict counts, and no release signoff (FR-026/FR-039)
  exist. The §5 baseline table is intentionally EMPTY. Until an operator runs
  §4 against live mailboxes/providers and fills §5, **FR-039 remains Partial
  (acceptance pending)** and FR-026 remains Partial (hosted end-to-end
  evidence pending), and guarded automation must stay OFF for every mailbox.

Any execution record added to §5 must state who ran it, when, against which
providers, and cite the raw telemetry — never a reconstructed or assumed
number.

## Scope

- **In-scope (already implemented + acceptance-verified in code):** the
  operational limits (§1), the unknown-not-negative rule (§2), and the
  measurement counters (§3). These are landed on this branch and proven by the
  T12a/T12b/T12c telemetry + metric-coverage tests; they are NOT pilot activities.
- **Operator-run (this plan):** the hosted + local provider compatibility pilots
  (§4), unknown-rate baseline capture (§5), rollout thresholds (§6), and rollback
  controls (§7).

## 1. Operational limits — acceptance-verified (T05, FR-039 L272)

All five limits are enforced inside `EmailReplyDetectionService`
(`src/service/emailReceive/EmailReplyDetectionService.ts`). They are
DETERMINISTIC code paths with adversarial test coverage; no pilot is required to
"verify" them, only to observe their effect on live mailboxes.

| Limit | Constant | Location | Enforcement |
|---|---|---|---|
| 15-second total detection budget (incl. queue wait) | `PROBE_DEADLINE_MS = 15_000` | L96 | `startGenerationDeadline({ budgetMs: PROBE_DEADLINE_MS })` started before the queue; `raceProbeAgainstDeadline` (L557–578) races the probe against `deadline.remainingMs()` via `Promise.race`; the late-resolving side is discarded, caller receives `probe_timeout`. |
| At most 5 Sent folders searched | `MAX_SENT_FOLDERS = 5` | L99 | `const boundedFolders = folders.slice(0, MAX_SENT_FOLDERS)` (L890); the rest are never opened. |
| At most 200 candidate header fetches total | `MAX_CANDIDATE_FETCHES = 200` | L102 | `fetchesRemaining` decremented per candidate (L932); exhausted mid-batch or pre-batch → `{ kind: "limit_exceeded" }` (L904/L930) → `unknown` code `probe_limit_exceeded` (L796). |
| One active probe per mailbox + single-flight sharing | `mailboxInFlight: Map<emailServiceId, Promise>` | L469, L536–548 | A second probe for the same mailbox `await`s the prior promise (L470–476) — the work is shared, not duplicated. The lock is released only by the lock holder (sentinel compare L545). |
| Queue-wait time included in deadline accounting | deadline started before queue | L467–468 | The deadline is started before `runProbeUnderMailboxLock`; the post-queue `deadline.expired()` re-check (L479–486) returns `probe_timeout` if the wait consumed the budget — no connection is opened. |

**Acceptance verification:** `test/vitest/main/modules/EmailReplyDetectionCache.test.ts`
(single-flight joins live probe; second-mailbox probe doesn't block first;
deadline → `probe_timeout` + late result discarded; config change invalidates
negative) and `test/vitest/main/modules/EmailReplyDetectionAdversarial.test.ts`
(>200 candidates → `probe_limit_exceeded`; 15s deadline → `probe_timeout`).
Passing on this branch.

## 2. Exhausted/partial probe budgets return unknown, not negative (FR-039 L273)

The cache rule (L525–532) only caches `replied` or `not_replied` — **every
`unknown` outcome is deliberately not cached**, so the next caller re-probes
rather than reusing an inconclusive result:

- `probe_timeout` (deadline exhausted, incl. queue-wait exhaustion L485/L567)
- `probe_limit_exceeded` (>200 candidates without a settled match, L796)
- `probe_failed` (search returned `false`, threw, or any required source was
  incomplete, L799/L807)
- `sent_folder_unavailable` (zero Sent folders discovered, L792)
- `ambiguous_match` (References-only or unrecognized sender, L788)
- `identity_conflict` (account context changed during I/O, persisted hash
  mismatch)
- `unsupported_protocol` / `receive_unavailable` / `missing_message_id` (pre-probe
  short-circuits — never open a connection, never construct IMAP from POP3)

A negative is persisted ONLY when ALL required sources completed (the
`flagSideComplete && sentResult.allFoldersComplete` fence at L806). A partial
probe never produces a cacheable negative.

**Queued-wait + cancellation in deadline accounting:** the deadline is started
before the queue (`runProbeUnderMailboxLock` L458–465); the post-queue
`deadline.expired()` re-check (L479–486) accounts for queue wait; a probe that
resolves after the deadline is discarded by `Promise.race` in
`raceProbeAgainstDeadline` (L572) — its eventual resolution does NOT write to
the cache (the cache write at L525–532 only runs for the *raced* result, which
is `probe_timeout` when the deadline wins).

**Acceptance verification:** `EmailReplyDetectionAdversarial.test.ts` (the §12
matrix: `false` search return → unknown not negative; auth/permission error →
unknown not negative; missing/inaccessible Sent folder → `sent_folder_unavailable`
not negative; config change during I/O → negative not stored). Passing.

## 3. Measurements (FR-039 L274) — landed, no private content

All counters emit through `EmailReplyMetrics.ts`
(`src/service/emailReply/EmailReplyMetrics.ts`): `incrementReplyMetric(name,
labels)` writes to an in-process `counters` Map keyed by
`name{sorted,label=pairs}` and emits `email_reply_<name>_total` via the logger;
`observeReplyDurationMs` / `timedReplyStage` emit `email_reply_<stage>_duration_ms`.
`sanitizeLabels` bounds every string to 60 chars; the §25 cardinality rule is
enforced — **labels are low-cardinality enum-ish codes/stages/Ids only, never
bodies, addresses, subjects, message ids, raw error text, or credentials.**

| Counter | Labels | Emission sites |
|---|---|---|
| `detection_cache` | `hit` (true/false), `kind` (persisted_positive/persisted_negative/positive/negative/miss/inflight), `expired` (true) | `EmailReplyDetectionService` L278/289/380/389/400/407/416 |
| `detection_outcome` | `state` (replied/not_replied/unknown), `reason` (probe_timeout/...), `stage` (queue_wait/pre_draft/pre_send), `code` (policy code) | L480–484 (queue_wait timeout); generation/delivery `not_replied`/`unknown`/`replied` sites |
| `detection_duration_ms` | `state` (probe), `failed` (true on throw) | `timedReplyStage("detection", ..., { state: "probe" })` L501–513 |
| `detection_persist_failure` | `kind` (positive/negative) | persistPositive/persistNegative catch sites L1008/L1029 |
| `reservation_outcome` | `outcome` (acquired/reusable/blocked), `code` (the typed `EmailReplyPolicyCode` for blocked) | `EmailReplyDraftGenerationService` L457–462 |
| `audit_failure` | `stage` (reuse/pre_draft/pre_send) | generation L494/L622/L976/L1631/L1699; delivery L438/L653/L699 |
| `generation_outcome` / `validation_code` / `correction_attempt` / `hint_fallback` / `truncation_detected` / `guard_conflict` / `deadline_exceeded` | low-cardinality codes (T09) | `EmailReplyDraftGenerationService` |

**Acceptance verification (metric coverage, T12c):**
`test/vitest/main/modules/EmailReplyDetectionCache.test.ts` (+4 tests: cold
miss → `detection_cache{hit=false,kind=miss}`; persisted sticky-positive →
`detection_cache{hit=true,kind=persisted_positive}` with zero probes; persisted
negative → `detection_cache{hit=true,kind=persisted_negative}` with zero probes;
probe path emits `email_reply_detection_duration_ms` carrying only
`state:"probe"` — no message id/address/body);
`test/vitest/main/EmailReplyDraftGeneration.test.ts` (+1 test for
`audit_failure{stage=pre_draft}`, +metric assertion on the existing B09 reuse
test for `audit_failure{stage=reuse}`);
`test/vitest/main/modules/EmailReplyDeliveryFakeSmtp.test.ts` (+1 test for
`audit_failure{stage=pre_send}`). 131/131 pass across the three suites; tsc
clean.

## 4. Provider compatibility pilots (operator-run)

Per design §12, the pilot requires live IMAP and hosted-provider access that
this checkout's test code cannot fabricate. The following activities are
operator-run against real mailboxes and a real hosted provider endpoint.

### 4.1 Local provider (IMAP) compatibility pilot

**Goal:** verify Sent-folder discovery, header search, exact-token matching, and
flag refresh against real IMAP providers (Gmail / Outlook / Yahoo / a generic
Dovecot or similar).

**Procedure (operator) — corrected by G04.** The previous revision sent the
original **from** the configured mailbox and had the third party reply into
it. That reply lands in the configured Inbox, is **authored by the third
party**, and references a Message-ID the app never stored as an inbound row —
it can never prove configured-sender Sent discovery. The detector's
matching rule (`classifyCandidate` in `EmailReplyDetectionService.ts`) settles
a direct match only when a **Sent-folder** candidate is authored by the
**configured sending identity** (`candidateSenderMatches`) AND carries the
**stored inbound original's** RFC Message-ID in `In-Reply-To`/`References`.
The pilot must therefore run the conversation in the opposite direction:

1. Configure one test mailbox per provider family in the app's Email Service
   settings (IMAP account, real credentials — never committed). Record the
   configured sending identity the app resolves (`readIdentity().fromAddress`)
   — every reply below MUST be sent from exactly this address, or the §7.2
   sender check rejects the candidate as `ambiguous_match`.
2. From a third-party mailbox you control, send a fresh original message **to
   the configured mailbox**. Wait for the app to sync it and record the
   stored received-row ID (the app's inbox list; this is the `message_id`
   `check_email_replied` accepts — a stored row ID, not an RFC header).
   Verify the synced row carries an RFC Message-ID: a missing one
   short-circuits detection to `missing_message_id` (unknown), which is a
   sync/parse finding, not a detection result.
3. Reply to that original from the configured mailbox's OWN webmail/client
   (NOT through the app), so a direct reply is saved in the configured
   mailbox's Sent folder with `In-Reply-To` = the original's Message-ID and
   `From` = the configured identity. Use a FRESH original for every scenario
   below — a settled positive is sticky (`replyDetectedAt`), so re-running
   detection on the same row returns the cached positive, not a new probe.
4. Run detection against the STORED inbound row (`check_email_replied` with
   the stored row ID, or trigger draft generation on it) and confirm:
   - Sent-folder discovery resolves the `\Sent` special-use folder (or the
     §7.2 fallback name for providers that omit special-use).
   - The reply is detected as `replied` with `source: "sent_search"` and
     `matched_message_id` carrying the REPLY's RFC Message-ID (never the
     original's).
   - Source recording: the probe checks the `\Answered` flag on the stored
     inbox original BEFORE the Sent search, so a client that set the flag
     settles `source: "mailbox_flag"` first — also a valid positive, but it
     does not exercise Sent discovery. To prove the `sent_search` axis
     specifically, clear the `\Answered` flag on the stored original (an IMAP
     client/tool, where the provider permits) or use a reply path that does
     not set it, then re-probe a fresh conversation. Record which source each
     provider family actually settled — do not claim `sent_search` coverage
     from a `mailbox_flag` result.
5. Repeat with an ancestor-only `References` reply (the original's token
   appears only in `References`, not `In-Reply-To`) and confirm
   `ambiguous_match` (unknown — never a false positive).
6. Repeat with a reply from an unrecognized alias of the configured account
   (a `From` address that differs from the configured identity) and confirm
   `ambiguous_match` — unconfigured aliases must not count as direct.
7. Repeat against a provider that hides Sent behind a non-standard name with
   no special-use and no §7.2 fallback match, and confirm
   `sent_folder_unavailable` (unknown, not negative) — and that guarded
   automation is disabled for that mailbox per §12.

**Pass criteria:** no false positives (an unanswered message is never reported
`replied`); no false negatives from a partial search (an incomplete search
reports `unknown`, not `not_replied`); the 15s deadline is not exceeded on a
healthy mailbox; the 200-candidate cap is not hit on a normal conversation.
The `replied` result must also satisfy the direction check above: it settles
only when the configured identity's OWN reply in the configured Sent folder
matches the stored inbound original — a third-party reply arriving in the
configured Inbox must never settle it.

**Telemetry to capture:** `detection_outcome{state}`, `detection_duration_ms`
p95, `detection_cache{hit,kind}` distribution, `detection_persist_failure{kind}`
(should be zero).

### 4.2 Hosted provider (JSON-mode) compatibility pilot

**Goal:** per design §13 L599–600, remote hosted JSON-mode forwarding/error
capability is an integration dependency not established by this checkout.
Resolve by capability testing before rollout.

**Procedure (operator):**
1. Configure the hosted AI provider endpoint per the user's plan. If the
   hosted provider serves the SAME generation path as a local/OpenAI-
   compatible provider (the app resolves the model per mailbox), run the
   local JSON provider as Pilot B's baseline arm and the hosted endpoint as
   the compatibility arm — the FR-026 question is whether the bounded
   `response_format` hint survives the hosted route.
2. Trigger draft generation on a replied original message (so detection returns
   `replied` BEFORE the model is called) and confirm the model is NOT called
   (no API request logged) — the §8.1 short-circuit.
3. Trigger draft generation on a `not_replied` original and confirm the hosted
   provider:
   - Accepts the bounded `response_format: { type: "json_object" }` hint OR
     returns a detectable unsupported-parameter signal (B06 fallback path).
   - Returns JSON that passes server-side Zod validation, or a correction round
     is triggered (T09 `validation_code` / `correction_attempt` counters
     increment).
   - The `model`/`finish_reason`/`usage` completion metadata is persisted on the
     draft/revision with honest `unavailable` flags when the provider omits them
     (never the `openai-compatible` literal).
4. Confirm the per-call 120s generation cap and 5-min aggregate deadline (T09/B13)
   are not exceeded on a healthy request.
5. Confirm a hosted provider that returns no JSON after the correction budget
     fails closed (`generation_outcome{outcome:"failed"}`) — no partial draft
     is committed.

**Pass criteria:** no silent passthrough of malformed model output; the
transport-error expiry (T09/B13) marks the attempt `delivery_unknown` (never
`sent`) when the hosted connection drops mid-stream; the kill switch (§7)
disables NEW draft generation at the IPC/tool boundary without removing local
duplicate protection.

**Telemetry to capture:** `generation_outcome`, `validation_code`,
`correction_attempt`, `hint_fallback`, `truncation_detected`,
`deadline_exceeded`, `reservation_outcome{outcome,code}`.

## 5. Unknown-rate baselines (operator-captured at pilot time)

The design explicitly forbids fabricating numeric targets. The baselines are
captured during the §4 pilots and recorded here as a table (to be filled at
pilot time — left blank intentionally, NOT to be guessed):

> **G04 marker (2026-10-15): still EMPTY — no pilot has been executed.** Every
> cell below is unfilled pending an operator run of §4 against live
> providers. Do not read the in-code test constants (15s / 5 folders / 200
> candidates) or any branch test result as baseline data; they are limits,
> not observations. Guarded automation stays OFF until this table carries a
> signed-off operator capture per §6.

| Metric | Pilot A (local IMAP) | Pilot B (hosted JSON) | Rollout threshold (§6) |
|---|---|---|---|
| `detection_outcome{state="unknown"}` rate | _captured_ | _captured_ | gate threshold below |
| `detection_outcome{state="replied"}` false-positive rate | _captured_ | n/a | 0 (hard zero — no false positive is acceptable) |
| `detection_duration_ms` p95 | _captured_ | n/a | < 15s (the enforced budget; p95 at the budget = investigate) |
| `detection_cache` hit rate | _captured_ | n/a | no fixed threshold (informational) |
| `generation_outcome{outcome="failed"}` rate | _captured_ | _captured_ | investigate any sustained increase |
| `audit_failure{stage=*}` count | _captured_ | _captured_ | 0 expected; any non-zero is a page (the work was stopped) |
| `reservation_outcome{outcome="blocked",code=already_replied}` count | _captured_ | _captured_ | confirms duplicate protection is firing |

The **unknown-rate** is the primary safety baseline: it is the fraction of
detection invocations that resolve to `state="unknown"` over the pilot window.
A high unknown-rate means guarded automation is correctly DISABLED for those
mailboxes (per §12: "Disable guarded automation for unavailable mailbox
detection; never fall back to unsafe automatic sending") — it is NOT a defect
to drive down by relaxing detection.

## 6. Rollout thresholds

Automation is enabled per mailbox only when the captured baselines satisfy:

1. **Zero false positives:** no `replied` detection on an actually-unanswered
   message across the pilot. A single false positive DISQUALIFIES the mailbox
   from automation until the cause is identified and the detector version bumped
   (the `REPLY_DETECTOR_VERSION` constant invalidates all cached negatives on
   the next probe).
2. **Unknown-rate is bounded and explained:** every `unknown` outcome in the
   pilot window maps to a known `reason` code (`probe_timeout` /
   `sent_folder_unavailable` / `ambiguous_match` / `probe_limit_exceeded` /
   `probe_failed` / `identity_conflict` / `unsupported_protocol` /
   `receive_unavailable` / `missing_message_id`). A mailbox whose unknown-rate
   is dominated by `sent_folder_unavailable` or `unsupported_protocol` is NOT
   automated — it stays in operator-driven mode.
3. **Detection p95 < 15s:** if p95 is at the budget, the mailbox is too slow
   for automation; investigate provider latency or folder structure before
   enabling.
4. **No audit failures:** `audit_failure{stage=*}` must be zero. A non-zero
   count means work was stopped without an audit row — investigate the
   persistence path before enabling.
5. **Duplicate denials are firing:** a non-zero `reservation_outcome{outcome=
   "blocked"}` count on the canonical-duplicate fixtures confirms the §5.3
   local protection is active. Zero blocked counts on a mailbox with known
   duplicates = investigate before enabling.

A mailbox that fails any threshold stays in operator-driven mode (the
`check_email_replied` tool and the audit UI remain available); guarded
automation is not enabled for it.

## 7. Rollback controls

### 7.1 Emergency kill switch

`EMAIL_REPLY_KILL_SWITCH_FLAG` (`src/config/featureFlags.ts` L40,
`isEmailReplyKillSwitchOn()` L42–50) is the emergency stop. When ON (Token
value `"true"`), draft generation and new send claims are refused immediately
at the IPC/tool boundary. Message viewing, audit reads, send-attempt detail,
and delivery reconciliation stay available so operators can diagnose and
recover. DEFAULTS OFF (normal operation); fail-closed on a Token store error
for drafting/sending (a broken store must not silently enable the feature).

**Scope:** the kill switch disables NEW work only. Per the T11 §5.3 proof
(`test/vitest/main/modules/EmailReplyRollbackProtection.test.ts` +
`EmailReplyPopulatedUpgrade.integration.test.ts`), the cluster-evidence
blocking paths — `acquireReservation`, `claimApprovedRevisionForSend` sibling
check, and `shouldPromoteReplyStatusFromProvider` — contain ZERO feature-flag
reads. They run under the default-flag state. Rolling back the feature by
setting the kill switch ON cannot remove the mandatory local duplicate
protection.

### 7.2 Forward-fix-only rollback contract (design §5 / L265–267)

Rollback must NOT run an older synchronized schema against new guard data and
resume automated replies. The contract on a failed pilot or production incident
is:
1. Set `EMAIL_REPLY_KILL_SWITCH_FLAG = "true"` (disable NEW draft generation +
   send claims).
2. Preserve the database — never destructive. `validateReplyUpgrade`
   (`src/service/emailReply/EmailReplyUpgradeValidation.ts`) is read-only by
   construction (SELECT/PRAGMA only); it never mutates, repairs, drops, or
   backfills. A failed validation reports the failure and the operator disables
   the workflow.
3. Investigate the root cause; bump `REPLY_DETECTOR_VERSION` if the detector
   logic was at fault (this invalidates all cached negatives on the next probe
   — no stale negative survives a detector change).
4. Re-run the §4 pilot against the fixed build before re-enabling automation.

### 7.3 What rollback does NOT remove

- The historical `replyStatus='sent'` rows (sticky local protection via
  `shouldPromoteReplyStatusFromProvider` — a cleared flag or any non-sent
  incoming status NEVER downgrades an existing `sent`).
- The `acquireReservation` reconcile-first + canonical-cluster sibling check
  (a conflicting cluster blocks `reply_state_conflict` regardless of flag
  state).
- The `claimApprovedRevisionForSend` sibling refusal (a second send claim is
  refused with `precondition_failed` BEFORE any write, regardless of flag
  state).
- The 9 mailbox-evidence columns and the `email_reply_guard` table (schema is
  additive; rolling back the feature flag does not drop columns).

This is the §5.3 invariant: **rollout disabling cannot remove the mandatory
local duplicate protection**, proven under default-flag state by the T11
rollback-protection suite.

## 8. Out of scope and honesty

- This document does NOT assert numeric pilot results. The baselines are
  captured at pilot time. **As of 2026-10-15 no §4 pilot has been executed** —
  see the "Landed vs. executed" section at the top of this document. Phase 2
  is NOT complete: code is landed, pilot/release acceptance (FR-026/FR-039)
  is pending external evidence.
- The G04-corrected §4.1 procedure exists because the ORIGINAL procedure was
  invalid: it sent the original from the configured mailbox and had the third
  party reply into it, so any `replied` result it produced would have been
  matched against a message the app never stored as an inbound row, authored
  by the wrong party. Running the old procedure would have proven nothing
  about configured-sender Sent discovery (and could not have produced a false
  positive only because it could not produce a true positive either). Pilots
  run before the correction (if any) are INVALID and must be re-run.
- This document does NOT replace the §12 adversarial test matrix — that matrix
  is code-level and passing on this branch (`EmailReplyDetectionAdversarial.test.ts`).
- The hosted JSON-mode provider capability (§4.2) is an external integration
  dependency; if capability testing reveals the hosted provider cannot return
  validated JSON, automation stays off for hosted-provider users until a
  fallback is designed (the current B06 unsupported-parameter fallback handles
  the `response_format` hint case only).
- Per §13 L601–602: "Provider/client coverage and the remaining external-send
  race are documented limits; the design does not promise complete detection or
  distributed exactly-once." This plan does not change that scope.
- During any rollback (§7) the local duplicate protections stay active
  unconditionally (§7.3), and a mailbox whose detection is unavailable
  (unknown outcomes) stays in operator-driven mode — guarded automation is
  never enabled for it, and unavailable automated workflows are blocked, not
  retried.
