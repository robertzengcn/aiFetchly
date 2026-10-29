# send_email_reply assisted idą on inconclusive detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A human-confirmed `send_email_reply` proceeds when the mailbox reply-detection probe is inconclusive (probe-execution unknowns), backed by the local-ledger negative — while positives (`already_replied`) and ambiguity (`ambiguous_match`, `identity_conflict`) still refuse; plus Sent-folder fallback names for CJK servers and bounded probe-failure logging.

**Architecture:** `runPreSendDetection` returns the inconclusive marker for the approved probe codes (audit + metric, then proceed). `sendApprovedReply` threads that marker into `claimApprovedRevisionForSend` (skips the §9.3 freshness precondition; sibling/positive checks inside the claim transaction still run) and into the post-claim gate/fence (skip the excluded-refresh dance; `evaluateFinalSendAdmission` verdict `stale` → proceed, any `refuse` verdict still refuses).

**Tech Stack:** TypeScript 5, TypeORM/SQLite, vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-email-send-inconclusive-detection-assisted-design.md`

## Global Constraints

- NEVER use `any`; explicit types; conventional commits; `yarn tsc-result` clean.
- `replied` / `ambiguous_match` / `identity_conflict` / config-gate unknowns NEVER proceed via the assisted path.
- No negative observation is persisted on an inconclusive probe (evidence honesty — D1a).
- New lifecycle audit action is deliberately NOT mirrored to the auto-reply decision table (mirror maps unmapped actions → null).
- Detect two seams, don't invent: model `ClaimSendInput` (`src/model/EmailReplyDraft.model.ts:1938`), precondition block (`:1009-1090`), module pass-through (`EmailReplyDraftModule.ts:196-201`), `runPreSendDetection` (`EmailReplyDeliveryService.ts:1086-1195`), gate (`:1418-1560` area), fence (`checkClaimOwnershipBeforeSmtp :1250-1363`), FRESHNESS_STALE dance (`sendApprovedReply :700-760`).

## Review Focus

1. Positive never bypassed: `replyDetectedAt` / `replyStatus==="sent"` refusals in the evaluator and the claim sibling check must remain active in assisted mode.
2. Attempt-ownership protection: the gate/fence still refuse a lost claim in assisted mode.
3. No automatic negative fabrication: after an assisted proceed, `replyNegativeCheckAt` stays null; nothing marks the message verified-clean.
4. Non-assisted behavior byte-identical: the freshness dance, gate, and fence keep their existing semantics when `assistedProbe` is null.
5. Probe logging is bounded (sanitizeDetectionError) and never emits credentials/raw headers.

---

### Task 1: Claim fence assisted bypass (model + seam)

**Files:**
- Modify: `src/model/EmailReplyDraft.model.ts` (`ClaimSendInput` :1938-1975; precondition block :1012-1090)
- Test: `test/vitest/main/modules/EmailReplySendClaim.integration.test.ts`

**Interfaces:**
- Produces: `ClaimSendInput.assistedProbe?: { reasonCode: ReplyDetectionUnknownCode; checkedAt: string } | null` (delivery relies on it). Seed messages carry a null `replyNegativeCheckAt` in this task's tests.

- [ ] **Step 1: Write the failing tests** (in `EmailReplySendClaim.integration.test.ts`, following its seed helpers — reuse the D1a fence seed pattern; new `describe("assisted inconclusive claim fence")`)

```ts
it("assistedProbe skips the freshness precondition: null replyNegativeCheckAt still claims (and writes nothing for it)", async () => {
  // Seed approved draft + revision like the sibling tests, seed message rows
  // WITHOUT replyNegativeCheckAt / replyDetectedAt.
  const claim = await draftModel.claimApprovedRevisionForSend({
    ...baseClaimInput,
    assistedProbe: { reasonCode: "probe_failed", checkedAt: new Date().toISOString() },
  });
  expect(claim.status).toBe("claimed");
});

it("assistedProbe does not bypass sticky positives: replyDetectedAt set → already_replied refusal", async () => {
  // seed message with replyDetectedAt + the same assistedProbe input
  const claim = ...;
  expect(claim.status).toBe("precondition_failed");
  expect(claim.code).toBe("already_replied"); // sibling/positive checks still run
});
```

(Follow the seeding shape used by "N01: a staged-but-unconfirmed negative..." test — it already proves the fence refuses when `replyNegativeCheckAt` is null; the first new test flips that to a claim when `assistedProbe` is set.)

- [ ] **Step 2: RED run** — `npx vitest --config vite.main.config.mjs run test/vitest/main/modules/EmailReplySendClaim.integration.test.ts` → new tests FAIL (the claim refuses the two new shapes today).

- [ ] **Step 3: GREEN implementation**
  1. Add `assistedProbe?: { reasonCode: ReplyDetectionUnknownCode; checkedAt: string } | null` to `ClaimSendInput` (import the type from `@/service/emailReceive/EmailReplyDetectionTypes`), with a doc comment: human-confirmed assisted send; replaces ONLY the freshness-window precondition; sibling + positive checks unchanged.
  2. In the claim precondition block, wrap the observation checks (`observedAt === null || !ownerUsable` and `ageMs > FORCED_FRESHNESS_WINDOW_MS`, NOT the missing-seed check) with `if (!input.assistedProbe) { ... }`, plus a comment explaining the three legitimate meanings of a null observation (never ran / persist failed / assisted-inconclusive by design).

- [ ] **Step 4: GREEN run** — same file → PASS (whole file).

- [ ] **Step 5: Commit** `feat: assisted inconclusive bypass for the claim freshness fence`

---

### Task 2: Pre-send detection override (marker + audit)

**Files:**
- Modify: `src/service/emailReply/EmailReplyDeliveryService.ts` (`runPreSendDetection` :1086-1195)
- Modify: `src/entityTypes/emailReceiveTypes.ts` (`EmailReplyAuditAction` :196-210 — add `"detection_inconclusive_proceeded"`)
- Test: `test/vitest/main/modules/EmailReplyDeliveryFakeSmtp.test.ts`

**Interfaces:**
- Produces: `runPreSendDetection(...): Promise<{ reasonCode: ReplyDetectionUnknownCode; checkedAt: string } | null>` — null = clean negative (or assisted-ineligible refusal thrown as before). Task 3 consumes it.

- [ ] **Step 1: RED tests** (in `EmailReplyDeliveryFakeSmtp.test.ts`, following the existing Step-8 detection tests that use `detectionFactory(result)` + `sendApprovedReply`):

```ts
it("sendApprovedReply proceeds on probe_failed with a completed send (assisted)", async () => {
  // detectionFactory(unknown A: probe_failed) → sendApprovedReply succeeds
  // → fake SMTP received; reply_sent outcome attempt row "sent".
});

it("assisted proceed writes a lifecycle audit row with the inconclusive code", async () => {
  // email_reply_audit_log row: action detection_inconclusive_proceeded,
  // metadata .code === "probe_failed", assisted: true; NOT mirrored (no
  // new row in email_auto_reply_audit_log).
});

it("ambiguous_match still refuses with SendPolicyRejection (no assisted bypass)", async () => { ... });
it("replied detection still refuses (already_replied)", async () => { ... });
```

- [ ] **Step 2: RED run.** — expect FAIL on the probe_failed / ambiguous cases.

- [ ] **Step 3: GREEN implementation**
  1. `EmailReplyAuditAction` += `"detection_inconclusive_proceeded"` (doc: lifecycle bookkeeping, deliberately not mirrored).
  2. `runPreSendDetection`: compute `const assisted = result.state === "unknown" && ASSISTED_INCONCLUSIVE_CODES.has(result.reasonCode);` with
     `const ASSISTED_INCONCLUSIVE_CODES = new Set<ReplyDetectionUnknownCode>(["probe_failed","probe_timeout","probe_limit_exceeded","sent_folder_unavailable"])` (module scope, doc comment).
     - assisted → `await this.writeAssistedInconclusiveAudit(...)` (new sibling of `writeDetectionRefusalAudit`: action `detection_inconclusive_proceeded`, same metadata shape + `assisted: true`), `incrementReplyMetric("detection_outcome", { stage: "pre_send", state: "unknown", code: result.reasonCode, assisted: true })`, and RETURN `{ reasonCode: result.reasonCode, checkedAt: result.checkedAt ?? new Date().toISOString() }`.
     - otherwise keep the current refusal path exactly.
  3. Audit-persistence failure on the assisted row → throw SendPolicyRejection with code probe_failed (mirror the refusal-side behavior: a send whose evidence write failed is refused, not silently assisted).
  4. Update `runPreSendDetection` return signature; the two throw-only paths for assisted-ineligible unknowns/replied stay untouched.

- [ ] **Step 4: GREEN run.**

- [ ] **Step 5: Commit** `feat: assisted send proceeds on inconclusive reply-detection probes`

---

### Task 3: Thread the marker through claim + gate + fence

**Files:**
- Modify: `src/service/emailReply/EmailReplyDeliveryService.ts` (`sendApprovedReply` claim input ~:683-700; the FRESHNESS dance :707-760 unchanged for non-assisted; `runPostClaimFreshnessGate` input + body; `checkClaimOwnershipBeforeSmtp` input + body)
- Test: `test/vitest/main/modules/EmailReplyDeliveryFakeSmtp.test.ts` (end-to-end assisted send already covered by Task 2's acceptance; this task adds the fence-semantics assertion)

**Interfaces:**
- Consumes: Task 1 `ClaimSendInput.assistedProbe`, Task 2 marker.
- Produces: gate/fence input `assistedProbe`.

- [ ] **Step 1: RED test** — flag-adjacent: with detection seeded NOT_REPLIED (normal), an aged-out negative + `gateRefreshed` behavior unchanged (existing tests cover; run them). New test: assisted send reaches SMTP with NO second detection call — count `detect` invocations via a factory that counts (5b only → exactly 1 detect call even when the path crosses gate/fence).

- [ ] **Step 2: RED run** (the counting assertion fails today at 2-3 calls... actually with non-assisted not_replied the gate may still admit without refresh; write the count assertion for the ASSISTED flow from Task 2: expecting exactly 1 detect call).

- [ ] **Step 3: GREEN implementation**
  1. `sendApprovedReply`: capture `const assistedProbe = await this.runPreSendDetection(...)`; pass into `claimInput` and into `runPostClaimFreshnessGate`/`checkClaimOwnershipBeforeSmtp` inputs (thread through whatever call sites exist between claim and SMTP — read them at implementation time; both functions live in this file).
  2. `runPostClaimFreshnessGate(input)` gains `assistedProbe`: when present, run `readFinalSendAdmission` + `evaluateFinalAdmission(snapshot, "gate")` ONCE: `admit` → return `{refreshed: false}` (fresh path, normal metric); `stale` → assisted proceed (metric `send_claim` `assisted_freshness_skipped`) → return; `refuse` → `refusePostClaimGate(...)` unchanged. Never enter the excluded refresh when assisted.
  3. Same treatment in `checkClaimOwnershipBeforeSmtp` (fence): assisted → verdict `stale` → proceed (metric `handoff_assisted_stale`); `refuse` → unchanged.
  4. Non-assisted flows: byte-identical (all new branches gated on `input.assistedProbe != null`).

- [ ] **Step 4: GREEN run** (FakeSmtp full file — asserts no regression: existing freshness/gate/fence tests unchanged).

- [ ] **Step 5: Commit** `feat: thread assisted inconclusive marker through claim + post-claim fence`

---

### Task 4: CJK Sent-folder fallbacks + probe failure logging

**Files:**
- Modify: `src/service/emailReceive/ImapEmailReceiveClient.ts` (`SENT_FOLDER_FALLBACK_NAMES` :57-64; catch sites in `searchReplyHeadersFromConnectedClient`, `discoverSentFolders`/`FromConnectedClient`)
- Modify: `src/service/emailReceive/EmailReplyDetectionService.ts` (log at `searchSentForReply` catch sites :1267-1321, `probeMailbox` catch :967-971, `resolveRejectedWrite` unknown path :1651 area)
- Test: `test/vitest/main/modules/ImapProbeExtensions.test.ts`

**Interfaces:**
- Consumes: `log` from `@/modules/Logger`; `sanitizeDetectionError` from the detection service (export exists at :1886).

- [ ] **Step 1: RED test** (in `ImapProbeExtensions.test.ts`, next to the existing fallback tests):

```ts
it("exactly-one CJK fallback: only 已发送 in the listing is accepted (unverified)", () => {
  // folders: [listFolder("已发送")] → discoverSentFolders → [{folder:"已发送", verified:false}]
});
it("two CJK candidates (已发送 + 已发送邮件) stay ambiguous → []", () => { ... });
```

- [ ] **Step 2: RED run.**

- [ ] **Step 3: GREEN implementation**
  1. `SENT_FOLDER_FALLBACK_NAMES` += `"已发送"`, `"已发送邮件"`.
  2. Logging: in each swallow site add `log.warn("reply detection probe step failed", { step, serviceId?, folder?, error: sanitizeDetectionError(err) })`-style bounded lines (compose the message inline; NO credentials/mail ids beyond slice limits; reuse the 240-char sanitizer). Cover: LIST throws, per-folder open/search throw, search === false, failedFetchCount>0 (warn once per folder), probeMailbox catch, resolveRejectedWrite unknown.

- [ ] **Step 4: GREEN run** (`ImapProbeExtensions.test.ts` + full detection suites).

- [ ] **Step 5: Commit** `feat: CJK sent-folder fallback names and bounded probe-failure logging`

---

### Task 5: Tool guidance + full verification + spec status

**Files:**
- Modify: `src/config/skillsRegistry.ts` (`send_email_reply` description) and `src/service/BuiltInToolCapabilitiesPromptSection.ts` (reply-tools row)
- Test: `test/vitest/main/EmailReceiveAiTools.test.ts` (description assertions)
- Modify: spec doc (Status line)

- [ ] **Step 1: RED test** — assert `send_email_reply` description contains /probe/i and /inconclusive/i wording ("verified existing replies still refuse").
- [ ] **Step 2: RED run.**
- [ ] **Step 3: GREEN implementation** — one clause: "If the pre-send mailbox verification is inconclusive (probe_failed/probe_timeout/sent_folder_unavailable), a human-confirmed send still proceeds; a VERIFIED existing reply (already_replied) always refuses."
- [ ] **Step 4: GREEN run** (both guidance test files).
- [ ] **Step 5: Full gates** — `yarn testmain` (note: N04 teardown flake on `AIChatQueryLoop.toolCatalog.test.ts` may exit non-zero with 0 test failures — record honestly), `yarn tsc-result`; flip spec `Status` → `Implemented`; commit `docs + feat: ...`.
