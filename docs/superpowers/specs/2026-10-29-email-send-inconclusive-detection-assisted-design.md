# Design: send_email_reply works when mailbox reply-detection is inconclusive

Date: 2026-10-29
Status: Approach C chosen in conversation — doc for record
Owner: reply pipeline

## Problem (root-caused)

`send_email_reply` refuses every send with `[probe_failed] Reply detection was
inconclusive before send`. Deterministic: every pre-send probe on
`imap.qiye.aliyun.com` returns unknown(probe_failed) (~7s), while ordinary IMAP
reads work and the `\Answered` flag side completes (`answeredFlagCheckedAt` is
persisted). The probe failures are swallowed silently (`catch {}`, no logging),
so the precise wire sub-step (LIST throw vs per-folder open/search failure)
cannot be confirmed from the app. `aliases` covered below.

Deadlock mechanics (why this is more than one gate):

1. `EmailReplyDeliveryService.runPreSendDetection` (5b): `replied` OR
   `unknown` → hard `[probe_failed]` refusal. The local ledger was already
   asserted clean twice before this gate (pre-send policy guard + detect's
   own local-first step), so the refusal only guards "manual reply from
   another client".
2. The inconclusive probe persists NO negative (`replyNegativeCheckAt` stays
   null), so the claim's forced-freshness fence (model, §9.3, fail-closed
   D1a) returns `freshness_stale` → the delivery reruns detection → same
   inconclusive → refusal. Even an override at (1) alone would deadlock again
   at the claim/gate/fence.

## Approach C (chosen)

Three coordinated legs:

### 1. Assisted override at the pre-send gate

In `runPreSendDetection`, an `unknown` outcome in the probe-execution family —
`probe_failed`, `probe_timeout`, `probe_limit_exceeded`,
`sent_folder_unavailable` — REFUSED today → proceeds to the atomic claim when
the send is human-confirmed (every caller of `sendApprovedReply` holds a valid
approval token: UI approval or the tool's request-scoped confirmation). A
lifecycle audit row (`detection_inconclusive_proceeded`, NOT mirrored to the
auto-reply decision table) + metric record the evidence. Hard refusals are
unchanged for: `replied` (positive), `ambiguous_match`, `identity_conflict`,
`reply_in_progress`, `delivery_unknown` (assertion-bearing states), and the
config-gate unknowns (`unsupported_protocol`, `receive_unavailable`,
`missing_message_id`). Rationale mirrors the approved reviewed-flag semantics:
an explicit human confirmation is the human act; classification-family and
assertion-bearing refusals stay.

### 2. Thread the assisted outcome through the send machinery

`sendApprovedReply` carries `assistedProbe: {reasonCode, checkedAt} | null`
into:

- `claimApprovedSend` (model + module + service): the §9.3 freshness
  precondition (null/stale `replyNegativeCheckAt` → `freshness_stale`) is
  SKIPPED when `assistedProbe` is present — the fence's remaining protections
  (sibling check, sticky-positive refusal) still run inside the transaction.
- `runPostClaimFreshnessGate` + `checkClaimOwnershipBeforeSmtp` (gate + fence):
  with `assistedProbe`, the excluded-refresh dance is skipped (a second probe
  on a deterministically-inconclusive mailbox is a guaranteed waste) and
  `evaluateFinalSendAdmission` treats verdict `stale` as
  proceed-to-next-step; all `refuse` verdicts (attempt lost, sticky
  positives on seed/cluster, sent status) still refuse. Ownership and
  positive protection are unchanged; only the "fresh usable negative"
  precondition is replaced, in assisted mode, by the local-ledger negative +
  human confirmation.

### 3. Probe success rate + observability

- `SENT_FOLDER_FALLBACK_NAMES` gains the common Chinese server names
  "已发送" and "已发送邮件" (Aliyun/QQ/NetEase enterprise mailboxes) — the
  exactly-one-match rule keeps the existing verification semantics.
- Each swallowed probe failure branch (`searchSentForReply` LIST throw, the
  per-folder catch, `search === false`, `failedFetchCount > 0`,
  `discoverSentFolders` throw, `probeMailbox` catch) logs a bounded
  `log.warn`/`log.error` (sanitizeDetectionError) so future diagnosis has
  ground truth instead of blind inference.
- Tool guidance: `send_email_reply` description + prompt row add one clause —
  an inconclusive mailbox verification does not block a human-confirmed send;
  a verified existing reply (`already_replied`) always refuses.

## Non-goals

- No change to `check_email_replied`'s three-state contract (unknown is never
  a negative, still surfaced as probe_failed).
- No auto-send machinery gains anything (`canSendAutomatically` still false;
  Phase-1 unattended sends untouched).
- Wire-level IMAP debugging of the Aliyun server is out of scope for this
  change (logging added; the assisted path makes the send work either way).
- No new UI components / i18n label surfaces (audit action is lifecycle-
  bookkeeping, intentionally not mirrored — mirrorRow maps unknown actions to
  null).

## Tests

- Detection-side: `discoverSentFolders` fallbacks match "已发送" (existing
  client-level fake pattern in `EmailReplyDetectionService.test.ts`).
- Delivery-level (FakeSmtp harness, `detectionFactory` stub): probe_failed →
  sends succeed; `ambiguous_match` → still refuses; `replied` → still refuses;
  the assisted audit row exists with the reasonCode.
- Claim fence: `claimApprovedSend` with `assistedProbe` + null
  `replyNegativeCheckAt` returns `claimed` (unit test on the model).
- `evaluateFinalSendAdmission` pure: assisted + `stale` verdict → treated as
  admit by the gate/fence call site (unit test).
- Full `yarn testmain` + tsc gates.
