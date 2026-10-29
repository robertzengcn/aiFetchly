# Design: `reviewed` flag for `create_email_reply_draft` (human-confirmed override)

Date: 2026-10-29
Status: Approved approach (A) — awaiting doc approval
Owner: reply pipeline

## Intent and why

`create_email_reply_draft` permanently refuses messages whose stored inbound
classification is `needs_human_review`, even after the mailbox owner reviews the
message in chat and explicitly asks the assistant to reply
("yes, please reply it"). Confirmed live-data root cause:

```
message ids 1 & 2 → classification = needs_human_review,
classificationSource = review, confidence = 0.5 (the `review()` default)
```

`source = review` is the model-refinement catch-all (untrusted/low-confidence
model verdict, schema failure, or disagreement with deterministic rules) — these
messages are **not** actually sensitive content. Today there is no human-override
path at any gate, so such messages are forever undelegable to the assistant.

The user asked for a `reviewed` boolean parameter on the tool that suppresses
this refusal, and the whole flow must complete: draft **and** confirmed send
(`send_email_reply` — approval + pre-send gate both re-check the classification
and would fail identically if only drafting were unblocked).

## Goals

- A human's explicit in-chat confirmation ("yes, please reply it") carried by
  `reviewed: true` unblocks **drafting** and **confirmed sending** for messages
  whose classification is `needs_human_review` (and an `unknown` that never
  refined).
- Machine-safety rules are NEVER overridable by `reviewed: true`: bounce,
  auto_reply, unsubscribe classifications, automated/no-reply recipient
  (`RFC 3834` loop prevention), blocked sender/domain patterns, daily/per-thread
  limits, and the message-level duplicate guard (already replied / in-flight /
  conflicts) all stay exactly as they are.
- The stored message classification is never rewritten by tools — the exemption
  is evaluated at gate time; audit rows keep the evidence.

## Non-goals

- No renderer/UI wiring for the new IPC field in this change (the optional
  `humanReviewed` field is added at the IPC boundary, handler-owned; a UI
  affordance can be a follow-up).
- No auto-reply scheduler changes (`canSendAutomatically` stays hard `false`;
  Phase-1 unattended auto-send is unaffected).
- No `reviewed` flag on `send_email_reply` — its send authorization is the
  approval/tool-confirmation itself; adding a second self-asserted bypass there
  would let one tool call skip review without any human gesture.

## Anti-goals (what would make this a failure)

- `reviewed: true` becoming a blanket bypass that can reply to no-reply /
  bounce / unsubscribe senders.
- Silently regenerating on messages that already have a sent reply.
- Removing the `[sensitive_topic]` refusal when the human did NOT confirm —
  unattended behavior must stay exactly as today when `reviewed` is absent/false.

## Approaches considered

- **A (chosen)** — `reviewed` flag on the draft tool + extend the
  confirmed-send classification exemption. Honors the human gesture explicitly,
  fixes drafting and sending together, keeps machine-safety checks intact.
- **B (rejected)** — flag unblocks drafting only; sends stay blocked. User is
  still stuck at `send_email_reply` ("Cannot approve: Classification
  'needs_human_review' must not be auto-replied").
- **C (rejected)** — no parameter; implicitly treat `source=review`
  classifications like `unknown`. Changes stored-data semantics, is not an
  explicit human act, and leaves deterministic-sensitive messages dead-ended.

## Decided behavior (the parts we commit to)

### 1. Tool + IPC schemas

- `createEmailReplyDraftSchema` (`src/entityTypes/emailReceiveAiTypes.ts`):
  add `reviewed: z.coerce.boolean().optional()`.
- `emailReplyDraftCreateInputSchema` (`src/schemas/ipc/emailReply.ts`): add
  `humanReviewed: z.boolean().optional()` (same semantics, camelCase at the IPC
  boundary).
- `skillsRegistry.ts` `create_email_reply_draft`: declare the `reviewed`
  parameter and update the description — set `reviewed=true` only when the
  USER has already reviewed the message and explicitly asked for the reply in
  the conversation; do not use it to mass-reply.

### 2. Policy evaluator (`EmailAutoReplyPolicyService.ts`)

- `EmailAutoReplyPolicyInput` gains `readonly humanConfirmed?: boolean`.
- In `evaluateAutoReplyPolicy`, the classification hard block (check 2) is
  bypassed **only** for `needs_human_review` (and defensively `unknown`) when
  `humanConfirmed === true`. Bounce / auto_reply / unsubscribe stay hard-blocked.
- Check 3 (sensitive keywords → status `needs_human_review`) is unchanged: it
  already allows drafting with a review flag via `mapLegacyDecision`.
- `canSendAutomatically` stays `false` on every path.

### 3. Confirmed-send exemption (`classificationForConfirmedSend`)

- Extend it to additionally strip `needs_human_review` → `null` (strips
  `unknown` today). Rationale, matching the intent already documented in
  `EmailReplyPolicyOrchestrator.evaluatePreSend` and
  `EmailReplyApprovalService`: a confirmed send (explicit human approval or
  request-scoped tool confirmation) IS the human review completing for a
  review-classified message. Bounce, auto-reply, unsubscribe keep refusing.
- This coherently relaxes all three confirmed consumers:
  `EmailReplyApprovalService.approveDraft`, orchestrator `evaluatePreSend` and
  any future confirmed path. Pre-send `requiresHumanReview` flagging keeps
  writing the audit evidence for sensitive topics.
- `confirmedSendRuleRefusal` (owner allowlist) logic is unchanged and still
  applies to the stored classification string.

### 4. Orchestrator threading

- `EmailReplyPolicyOrchestrator.evaluate()` input gains
  `humanConfirmed?: boolean`; it reaches `evaluatePreDraft` for stage
  `pre_draft` (both the initial gate and the post-refinement re-gate in the
  generation service go through `evaluate()`).
- `evaluatePreDraft(message, humanConfirmed)` keeps the existing
  refinement-pending `unknown → null` handling; with `humanConfirmed`, a stored
  `needs_human_review` is passed through and exempted by the evaluator.
- Pre-send consumers need no new flag — the extended
  `classificationForConfirmedSend` in section 3 covers them.

### 5. Generation service (`EmailReplyDraftGenerationService.createDraft`)

Input gains `humanReviewed?: boolean` (tool maps `reviewed === true` to it; the
UI IPC handler maps `humanReviewed` the same way). Both pre-draft policy
evaluations (2b and the post-refinement 2a-bis re-gate) pass
`humanConfirmed: input.humanReviewed === true`.

- The post-refinement `classification_unknown` refusal (stored value still
  undecided after a failed classifier) is skipped when `humanConfirmed` — the
  human's explicit request resolves that uncertainty for a reviewed draft.
- The refinement classifier call still runs for stored `unknown` (unchanged
  bookkeeping: it records a real classification when it can; refined
  `unsubscribe`/bounce-based verdicts still block).

### 6. Prompt guidance update

- `BuiltInToolCapabilitiesPromptSection.ts` row for the reply tools: mention
  that when the user has reviewed the message and asked for a reply, pass
  `reviewed=true` to `create_email_reply_draft` (needs_human_review / unknown
  classifications then allow human-assisted drafting; automated senders still
  refuse). Keep it brief — same style as the existing row.

## What's left to the builder

- Exact shape of the exemption in `evaluateAutoReplyPolicy` (a filtered set vs.
  an inline condition) — either is fine; keep `BLOCKED_CLASSIFICATIONS` intact
  as the unattended baseline.
- Test fixture choices; follow existing architecture tests
  (`EmailAutoReplyPolicyService.test.ts`, `EmailReplyPolicyOrchestrator.test.ts`,
  `EmailReplyDraftGeneration.test.ts`, `EmailReplyApproval*`,
  `EmailReceiveAiTools.test.ts`) for stub patterns.
- Any doc strings / code comments that must stay consistent with the
  architecture narrative in `docs/prd/*` (update needed code comments only).

## Required tests (per repo rules)

1. Evaluator: `humanConfirmed` exempts `needs_human_review`/`unknown`, keeps
   bounce/auto_reply/unsubscribe, blocked patterns, limits.
2. `classificationForConfirmedSend`: `needs_human_review` → null; others
   unchanged.
3. Orchestrator: pre_draft with `humanConfirmed` allows a review-classified
   message; without it the `[sensitive_topic]` refusal persists.
4. Generation service end-to-end (stubbed): stored `needs_human_review` →
   refuses without the flag; drafts with the flag; classifier-failure + flag
   proceeds; machine classifications refuse even with the flag.
5. Approval + delivery (stubbed): confirmed send of a `needs_human_review`
   message approves/sends with the exemption; bounce/auto_reply/unsubscribe
   still refuse approve and pre-send.
6. Tool/IPC schemas: `reviewed`/`humanReviewed` accepted and threaded; absent →
   same behavior as today.
