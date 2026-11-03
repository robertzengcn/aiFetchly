# `reviewed` flag for create_email_reply_draft — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an explicit human confirmation in chat (`reviewed: true` on the tool / `humanReviewed` on the UI IPC) unblock drafting and confirmed sending of messages classified `needs_human_review` (or an `unknown` that never refined), without touching machine-safety blocks.

**Architecture:** The `reviewed` flag threads from the tool/IPC schemas into `EmailReplyDraftGenerationService.createDraft`, which passes `humanConfirmed` to the orchestrator's pre-draft policy gate. The policy evaluator `evaluateAutoReplyPolicy` exempts only `needs_human_review`/`unknown` when `humanConfirmed`, and `classificationForConfirmedSend` additionally strips `needs_human_review` so the approval + pre-send gates accept a review-classified message whose draft the human confirmed.

**Tech Stack:** TypeScript 5, zod (v4), TypeORM/SQLite modules, vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-email-reply-reviewed-flag-design.md`

## Global Constraints

- NEVER use `any`; explicit types/interfaces everywhere (repo rule).
- All functions have explicit return types; `unknown` for catch blocks.
- Commit per unit of work with conventional-commit messages (`feat: ...`, `test: ...`); never commit broken code.
- Do NOT run `yarn package` / `yarn make` locally (forbidden; environment-degrading).
- Vitest main suite runs via `yarn testmain`; single file: `npx vitest --config vite.main.config.mjs run <path>` (from repo root). Type gate: `yarn tsc-result`.
- `canSendAutomatically` stays `false` on every path (Phase-1 MVP; unattended auto-send unchanged).
- Stored message classification is never rewritten by tools; the exemption is evaluation-time only.

## Review Focus

1. **LLM may set `reviewed` without a real human ask.** Blast radius must stay classification-family only: bounce/auto_reply/unsubscribe senders, no-reply recipients, blocked patterns, limits, and the duplicate guard still refuse. Pinned by Task 1 evaluator tests (bounce/auto_reply/unsubscribe with `humanConfirmed`) and Task 2 no-reply test.
2. **Unattended scheduled loops can invoke `create_email_reply_draft`** (it is in `SCHEDULED_LOOP_HIGH_IMPACT_TOOLS`). Worst case is a draft — never a send (send needs `send_email_reply`, a separate high-impact opt-in). Pinned by Task 4: skill registry description + prompt row explicitly restrict `reviewed` to "user already reviewed and asked".
3. **Keyword-sensitive bodies with `reviewed`** must draft as review-flagged (status `needs_human_review` → `requiresHumanReview` decision), never a silently clean draft. Pinned by Task 1 test.
4. **Classifier failure at runtime (stored stays `unknown`) + `reviewed`** must proceed to draft, not the `classification_unknown` refusal. Pinned by Task 3 test.
5. **Already-replied / in-flight messages** must still refuse with `reviewed` — the FR-029 duplicate guard (`evaluateMessageLevelState`) runs before the classification checks in both stages and must not change. Pinned by the existing `EmailReplyPreDraftPolicy`/`EmailReplyDraftGeneration` guard tests they must not regress (run the full file, not just new tests).

---

### Task 1: Policy evaluator — `humanConfirmed` exemption + confirmed-send strip

**Files:**
- Modify: `src/service/emailReply/EmailAutoReplyPolicyService.ts` (input interface ~line 13; check 2 at ~144-147; `classificationForConfirmedSend` 60-65; its doc comment 52-59; `BLOCKED_CLASSIFICATIONS` doc comment 35-43)
- Test: `test/vitest/main/EmailAutoReplyPolicyService.test.ts`

**Interfaces:**
- Produces: `EmailAutoReplyPolicyInput.humanConfirmed?: boolean` (Task 2/3 rely on it); `classificationForConfirmedSend(classification: string | null | undefined): string | null` — unchanged signature, `needs_human_review` now also returns `null`.

- [ ] **Step 1: Write the failing tests** (append a new `describe` to the existing file; reuse its `fakeMessage`/`fakeRule`/`emptyCounts` helpers)

```ts
describe("humanConfirmed exemption (reviewed flag — create_email_reply_draft)", () => {
  it("exempts a 'needs_human_review' classification when humanConfirmed, returns a draftable decision", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage(),
      classification: "needs_human_review",
      confidence: 0.5,
      rule: null,
      sendCounts: emptyCounts,
      humanConfirmed: true,
    });
    expect(d.status).not.toBe("blocked");
    expect(d.canSendAutomatically).toBe(false);
  });

  it("still hard-blocks bounce / auto_reply / unsubscribe classifications even when humanConfirmed", () => {
    for (const classification of ["bounce", "auto_reply", "unsubscribe"] as const) {
      const d = evaluateAutoReplyPolicy({
        message: fakeMessage(),
        classification,
        confidence: 0.95,
        rule: null,
        sendCounts: emptyCounts,
        humanConfirmed: true,
      });
      expect(d.status).toBe("blocked");
    }
  });

  it("keeps the automated no-reply recipient block when humanConfirmed", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({ fromAddress: "no-reply@example.com" }),
      classification: "needs_human_review",
      confidence: 0.5,
      rule: null,
      sendCounts: emptyCounts,
      humanConfirmed: true,
    });
    expect(d.status).toBe("blocked");
  });

  it("flag-adjacent: sensitive keywords with humanConfirmed yield review status (allowed, review, no auto-send)", () => {
    const d = evaluateAutoReplyPolicy({
      message: fakeMessage({ bodyText: "Please refund my payment." }),
      classification: null,
      confidence: null,
      rule: null,
      sendCounts: emptyCounts,
      humanConfirmed: true,
    });
    expect(d.status).toBe("needs_human_review");
    expect(d.canSendAutomatically).toBe(false);
  });
});

describe("classificationForConfirmedSend strips needs_human_review", () => {
  it("returns null for unknown and needs_human_review (human-confirmed paths); keeps hard classes", () => {
    expect(classificationForConfirmedSend("unknown")).toBe(null);
    expect(classificationForConfirmedSend("needs_human_review")).toBe(null);
    expect(classificationForConfirmedSend("bounce")).toBe("bounce");
    expect(classificationForConfirmedSend("auto_reply")).toBe("auto_reply");
    expect(classificationForConfirmedSend("unsubscribe")).toBe("unsubscribe");
    expect(classificationForConfirmedSend("interested")).toBe("interested");
    expect(classificationForConfirmedSend(null)).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/EmailAutoReplyPolicyService.test.ts`
Expected: FAIL — new `humanConfirmed` property rejected/blocked status returned; `needs_human_review` not stripped.

- [ ] **Step 3: Implement in `EmailAutoReplyPolicyService.ts`**

1. Add to `EmailAutoReplyPolicyInput`: `readonly humanConfirmed?: boolean;` with a doc line: "True when a human explicitly asked for this reply draft in conversation (`reviewed` on the AI tool / `humanReviewed` on the UI IPC). Exempts ONLY the classification-family blocks that mean 'unsure or sensitive' — never machine-safety blocks."
2. In `evaluateAutoReplyPolicy`, destructure `humanConfirmed` and change the classification hard block to:

```ts
const humanReviewClassExempt =
  humanConfirmed === true &&
  (classification === "needs_human_review" || classification === "unknown");
if (
  classification &&
  BLOCKED_CLASSIFICATIONS.has(classification) &&
  !humanReviewClassExempt
) {
  return blocked(`Classification '${classification}' must not be auto-replied`);
}
```

3. Extend `classificationForConfirmedSend`: return `null` for `"needs_human_review"` as well as `"unknown"`/null, updating its doc comment — rationale: for a review-classified message a confirmed send IS the human review completing; bounce/auto_reply/unsubscribe are returned unchanged and still block (machine-safety, not human-review-able).
4. Update the `BLOCKED_CLASSIFICATIONS` doc comment to note the confirmed exemption paths (existing `unknown` note + new `needs_human_review` note pointing at this helper).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/EmailAutoReplyPolicyService.test.ts`
Expected: PASS — file green including the pre-existing tests (same-file regression check).

- [ ] **Step 5: Commit**

```bash
git add src/service/emailReply/EmailAutoReplyPolicyService.ts test/vitest/main/EmailAutoReplyPolicyService.test.ts
git commit -m "feat: humanConfirmed exemption for review-classified messages in reply policy evaluator"
```

---

### Task 2: Orchestrator — thread `humanConfirmed` into the pre-draft gate

**Files:**
- Modify: `src/service/emailReply/EmailReplyPolicyOrchestrator.ts` (`evaluate` input ~75-80; pre-draft dispatch ~100-102; `evaluatePreDraft` 285-323)
- Test: `test/vitest/main/modules/EmailReplyPreDraftPolicy.test.ts`

**Interfaces:**
- Consumes: `EmailAutoReplyPolicyInput.humanConfirmed` (Task 1).
- Produces: `EmailReplyPolicyOrchestrator.evaluate(input: { stage; messageId; draftId?; revisionId?; humanConfirmed?: boolean })` (Task 3 relies on it).

- [ ] **Step 1: Write the failing tests** (append to `EmailReplyPreDraftPolicy.test.ts`; reuse its `seedMessage` helper; `classificationConfidence` override lands via `seedMessage`'s existing path)

```ts
describe("humanConfirmed pre-draft exemption (reviewed flag)", () => {
  it("allows a needs_human_review-classified message at pre_draft when humanConfirmed", async () => {
    const id = await seedMessage({
      classification: "needs_human_review",
      classificationConfidence: 0.5,
    });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
      humanConfirmed: true,
    });
    expect(decision.allowed).toBe(true);
  });

  it("still refuses needs_human_review at pre_draft without humanConfirmed (unchanged)", async () => {
    const id = await seedMessage({ classification: "needs_human_review" });
    const decision = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("sensitive_topic");
  });

  it("still refuses unsubscribe and no-reply senders at pre_draft even when humanConfirmed", async () => {
    const unsub = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: await seedMessage({ classification: "unsubscribe" }),
      humanConfirmed: true,
    });
    expect(unsub.allowed).toBe(false);
    const noReply = await orchestrator.evaluate({
      stage: "pre_draft",
      messageId: await seedMessage({
        fromAddress: "no-reply@mailer.example.com",
      }),
      humanConfirmed: true,
    });
    expect(noReply.allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/modules/EmailReplyPreDraftPolicy.test.ts`
Expected: PASS/FAIL mix — the exempt test fails (allowed=false today) and the parameter may be a TS type error.

- [ ] **Step 3: Implement in `EmailReplyPolicyOrchestrator.ts`**

1. `evaluate(input: {...; humanConfirmed?: boolean})` — add the optional field with a doc comment pointing at the spec.
2. `evaluatePreDraft(message, humanConfirmed)` — extend the signature (default `false`) and pass `humanConfirmed` through to `evaluateAutoReplyPolicy` in the decisions call (~307-317). Pre-send evaluation is unchanged (Task 1's `classificationForConfirmedSend` covers it).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/modules/EmailReplyPreDraftPolicy.test.ts`
Expected: PASS — whole file green.

- [ ] **Step 5: Commit**

```bash
git add src/service/emailReply/EmailReplyPolicyOrchestrator.ts test/vitest/main/modules/EmailReplyPreDraftPolicy.test.ts
git commit -m "feat: thread humanConfirmed through the pre-draft policy gate"
```

---

### Task 3: Generation service — `humanReviewed` input + gate threading + classifier-failure bypass

**Files:**
- Modify: `src/service/emailReply/EmailReplyDraftGenerationService.ts` (`CreateDraftInput` 87-93; pre-draft evaluate call ~727-730; 2a-bis refusal block ~1395-1421; post-refinement re-gate call ~1428-1431)
- Test: `test/vitest/main/EmailReplyDraftGeneration.test.ts`

**Interfaces:**
- Consumes: orchestrator `humanConfirmed` (Task 2).
- Produces: `CreateDraftInput.humanReviewed?: boolean` (Task 4 maps tool `reviewed` → this).

- [ ] **Step 1: Write the failing tests** (append a new `describe` next to "createDraft refines a stored deterministic-unknown classification (FR-007 §10.1)". First HOIST the block-scoped helpers `seedSyncedMessage`, `seedDraft`, and `messageModule`/`draftModule` consts to module scope so both describe blocks can use them — references inside the FR-007 block keep compiling unchanged)

```ts
describe("createDraft honors humanReviewed (reviewed flag)", () => {
  it("refuses a stored needs_human_review message without the flag (unchanged)", async () => {
    const messageId = await seedSyncedMessage({
      classification: "needs_human_review",
      classificationConfidence: 0.5,
    });
    // Also persist review provenance like the sync/model path does:
    await messageModule.updateClassificationProvenance(messageId, "review", "model-constrained-v1");
    const { factory, requests } = fakeApiFactory([]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId, useKnowledgeLibrary: false });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("sensitive_topic");
    expect(requests).toHaveLength(0); // no AI work at the gate
  });

  it("drafts a stored needs_human_review message when humanReviewed=true (generation call only)", async () => {
    const messageId = await seedSyncedMessage({
      classification: "needs_human_review",
      classificationConfidence: 0.5,
    });
    await messageModule.updateClassificationProvenance(messageId, "review", "model-constrained-v1");
    const { factory, requests } = fakeApiFactory([completionResponse(validReplyJson)]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({
      messageId,
      useKnowledgeLibrary: false,
      humanReviewed: true,
    });
    expect(result.success).toBe(true);
    expect(requests).toHaveLength(1); // generation only — no classification call
  });

  it("keeps machine classifications hard-blocked even with humanReviewed", async () => {
    const messageId = await seedSyncedMessage({ classification: "unsubscribe", classificationConfidence: 0.95 });
    const { factory, requests } = fakeApiFactory([]);
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId, useKnowledgeLibrary: false, humanReviewed: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("unsubscribe");
    expect(requests).toHaveLength(0);
  });

  it("proceeds to draft when the classifier call fails and humanReviewed=true", async () => {
    // Reality check: classifyMessage catches classifier errors itself and
    // routes to review -> needs_human_review (persisted, source review). With
    // humanConfirmed the post-refinement re-gate exempts it -> generation runs.
    const messageId = await seedSyncedMessage({ classification: "unknown", classificationConfidence: 0.5 });
    let call = 0;
    const requestsSnapshot: OpenAIChatCompletionRequest[] = [];
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        call += 1;
        if (call === 1) throw new Error("classifier down"); // classification call
        requestsSnapshot.push(req);
        return completionResponse(validReplyJson); // generation call
      },
    });
    const svc = buildService({ apiFactory: factory });
    const result = await svc.createDraft({ messageId, useKnowledgeLibrary: false, humanReviewed: true });
    expect(result.success).toBe(true);
    expect(requestsSnapshot).toHaveLength(1); // generation only
  });
});
```

(The shared `fakeApiFactory` only returns canned responses in order and throws when exhausted, so the throwing-then-succeeding factory above must be written locally for this test. `AiChatApiFactory`, `OpenAIChatCompletionRequest`, and `completionResponse` are already imported in this file.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/EmailReplyDraftGeneration.test.ts`
Expected: FAIL — new tests (type error on `humanReviewed` / wrong outcomes).

- [ ] **Step 3: Implement in `EmailReplyDraftGenerationService.ts`**

1. `CreateDraftInput`: add `humanReviewed?: boolean;` with a doc line (mirrors the spec: "user reviewed the message and asked for the reply").
2. Pre-draft gate call (~727-730): `evaluate({ stage: "pre_draft", messageId: message.id, humanConfirmed: input.humanReviewed === true })`.
3. Post-refinement re-gate call (~1428-1431): same `humanConfirmed` value.
4. 2a-bis still-undecided refusal (~1395-1421): skip the typed `classification_unknown` refusal when `input.humanReviewed === true` (the human's request resolves the uncertainty for a reviewed draft); the post-refinement re-gate with a stored `unknown` still allows (it feeds null).
5. Do NOT change: duplicate guard, reservation, keyword checks, generation validation loop.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/EmailReplyDraftGeneration.test.ts`
Expected: PASS — whole file green (note in README of the run: this file is large; ~90s).

- [ ] **Step 5: Commit**

```bash
git add src/service/emailReply/EmailReplyDraftGenerationService.ts test/vitest/main/EmailReplyDraftGeneration.test.ts
git commit -m "feat: humanReviewed input unblocks drafting of review-classified messages"
```

---

### Task 4: Tool + IPC schemas, skill registry, prompt guidance

**Files:**
- Modify: `src/entityTypes/emailReceiveAiTypes.ts` (`createEmailReplyDraftSchema` 71-77)
- Modify: `src/schemas/ipc/emailReply.ts` (`emailReplyDraftCreateInputSchema` 45-53)
- Modify: `src/config/skillsRegistry.ts` (`create_email_reply_draft` entry 2491-2544: description 2492-2503, parameters 2504-2532)
- Modify: `src/service/EmailReceiveAiTools.ts` (`createEmailReplyDraft` arg→input mapping 379-385)
- Modify: `src/service/BuiltInToolCapabilitiesPromptSection.ts` (row for reply tools, line 54)
- Test: `test/vitest/main/EmailReceiveAiTools.test.ts`

**Interfaces:**
- Consumes: `CreateDraftInput.humanReviewed` (Task 3).
- Produces: tool parameter `reviewed?: boolean`; IPC field `humanReviewed?: boolean` (flows straight into `createDraft(input)` via the `EMAIL_REPLY_DRAFT_CREATE` handler at `src/main-process/communication/emailReceive-ipc.ts:344-359`).

- [ ] **Step 1: Write the failing tests** (in `EmailReceiveAiTools.test.ts`, near the existing `create_email_reply_draft` confirms/draft tests)

```ts
it("create_email_reply_draft accepts reviewed=true in its schema and registry", () => {
  const parsed = createEmailReplyDraftSchema.parse({
    message_id: 3,
    reviewed: true,
  });
  expect(parsed.reviewed).toBe(true);
  const skill = SkillRegistry.getSkill("create_email_reply_draft");
  expect(skill!.parameters.properties.reviewed).toBeTruthy();
  // Usage restriction is stated where the model can read it.
  expect(skill!.description).toMatch(/reviewed/i);
});

it("IPC draft-create schema accepts humanReviewed", () => {
  const parsed = emailReplyDraftCreateInputSchema.parse({
    messageId: 3,
    humanReviewed: true,
  });
  expect(parsed.humanReviewed).toBe(true);
});
```

(Import the IPC schema from `@/schemas/ipc/emailReply` and zod schemas from `@/entityTypes/emailReceiveAiTypes` — add imports; `SkillRegistry` is already imported in that file.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/EmailReceiveAiTools.test.ts`
Expected: FAIL — `reviewed`/`humanReviewed` undefined, registry lacks the parameter.

- [ ] **Step 3: Implement**

1. `createEmailReplyDraftSchema`: add `reviewed: z.coerce.boolean().optional()` (doc comment: only when the user reviewed and explicitly asked).
2. `emailReplyDraftCreateInputSchema`: add `humanReviewed: z.boolean().optional()`.
3. `createEmailReplyDraft` mapping (~379-385): add `humanReviewed: input.reviewed === true`.
4. `skillsRegistry.ts`: add `reviewed` parameter to the tool's `parameters` (`type: "boolean"`, description: "Set true ONLY when the user has already reviewed this message and explicitly asked you to draft the reply; messages classified as needing human review or unknown then allow human-assisted drafting. Do not use it to mass-reply or for scheduled bulk requests."), and extend the tool description with one sentence on the same rule.
5. `EmailReceiveAiTools.ts` doc comment on the map: same one-line rationale.
6. Prompt row (line 54): append to the reply-tools row: "Pass \`reviewed=true\` to \`create_email_reply_draft\` only when the user already reviewed the message and asked you to reply — then needs_human_review/unknown classifications still draft (automated/no-reply senders still refuse).".

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/EmailReceiveAiTools.test.ts test/vitest/main/service/BuiltInToolCapabilitiesPromptSection.test.ts`
Expected: PASS both (second file only asserts tool names — row edit must not break it).

- [ ] **Step 5: Type-check + commit**

Run: `yarn tsc-result` — Expected: no new errors from these changes.

```bash
git add src/entityTypes/emailReceiveAiTypes.ts src/schemas/ipc/emailReply.ts src/config/skillsRegistry.ts src/service/EmailReceiveAiTools.ts src/service/BuiltInToolCapabilitiesPromptSection.ts test/vitest/main/EmailReceiveAiTools.test.ts
git commit -m "feat: reviewed parameter on create_email_reply_draft with prompt/registry guidance"
```

---

### Task 5: Confirmed-send proof — approval + pre-send accept review-classified messages

**Files:**
- Test: `test/vitest/main/modules/EmailReplyHumanReviewApproval.test.ts` (approve-level, follows its `seedFlaggedDraft` pattern with classification `needs_human_review`)
- Test: `test/vitest/main/modules/EmailReplyPreSendPolicy.test.ts` — create it only if no existing pre-send decision test file matches; otherwise extend `test/vitest/main/modules/EmailReplyApprovalValidation.test.ts` (which already drives `evaluate({stage:"pre_send"})` at ~214)

**Interfaces:**
- Consumes: Task 1's `classificationForConfirmedSend` strip (behavior emerges from Task 1; this task is the integration proof).

- [ ] **Step 1: Write the failing tests**

1. Approval (in `EmailReplyHumanReviewApproval.test.ts`, new describe): seed a draft + revision whose message has `classification: "needs_human_review"` (confidence 0.8, `classificationSource` review via `updateClassificationProvenance`) → `new EmailReplyApprovalService().approveDraft({ draftId, approvedByType: "user" })` RESOLVES (no reject). Companion test: same seed with `classification: "bounce"` still REJECTS `/Cannot approve/i`.
2. Pre-send (mirror the `EmailReplyApprovalValidation` pattern): with an approved revision + active approval token, `new EmailReplyPolicyOrchestrator().evaluate({ stage: "pre_send", messageId, draftId, revisionId })` for the `needs_human_review` message returns `allowed === true` (code `sensitive_topic` allowed only when body keywords persist; assert `allowed` only). Same seed `bounce` → `allowed === false` with code `bounce`.

- [ ] **Step 2: Run to verify state**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/modules/EmailReplyHumanReviewApproval.test.ts test/vitest/main/modules/EmailReplyApprovalValidation.test.ts`
Expected: the needs_human_review-approve tests PASS because Task 1 shipped the strip; if any FAILS, that is a regression to fix in Task 1's code, not by re-implementing here.

- [ ] **Step 3: Commit**

```bash
git add test/vitest/main/modules/EmailReplyHumanReviewApproval.test.ts test/vitest/main/modules/EmailReplyApprovalValidation.test.ts
git commit -m "test: confirmed-send accepts needs_human_review after explicit human approval"
```

---

### Task 6: Full-suite verification + design-doc status flip

**Files:**
- Modify: `docs/superpowers/specs/2026-10-29-email-reply-reviewed-flag-design.md` (Status line)

- [ ] **Step 1: Run the whole vitest main suite**

Run: `yarn testmain`
Expected: PASS (known unrelated flakes documented in `docs/prd/ai-email-reply-validation-and-duplicate-guard-todo.md` line 154 may flake; re-run individually if so).

- [ ] **Step 2: Lint + type gates**

Run: `yarn tsc-result` — Expected: clean.

- [ ] **Step 3: Flip the spec status**

Change `Status: Approved approach (A) — awaiting doc approval` → `Status: Implemented (see docs/superpowers/plans/2026-10-29-email-reply-reviewed-flag.md)`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-29-email-reply-reviewed-flag-design.md
git commit -m "docs: mark reviewed-flag design implemented"
```
