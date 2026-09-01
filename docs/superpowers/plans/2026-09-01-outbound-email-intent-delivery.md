# Intent-Aware Outbound Email Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive a delivery decision (`send_now` / `review_first` / `draft_only`) from trusted user-authored conversation state and enforce it before any AI outbound email campaign can start, so the LLM can never self-authorize a send.

**Architecture:** A deterministic intent resolver runs in the main process on the current user turn (never on tool args, retrieved content, or assistant text). Drafts become immutable per-recipient revisions bound to a canonical SHA-256 batch hash. A separate authorization record (request-scoped, expiring, one-time) is the only thing that lets the authoritative delivery service atomically claim a send attempt and hand exact envelopes to a worker. Workers never touch the DB and never mutate content. This mirrors the proven inbound `emailReply` reliability subsystem (approval envelope hashing, one-time tokens, atomic claim, idempotency keys, `delivery_unknown` handling).

**Tech Stack:** TypeScript 5.x, Electron (main + utility process), TypeORM + better-sqlite3, Zod v4 (`zod/v4`), Vitest, Vue 3 + Vuetify + Pinia, Playwright (E2E).

**Reference docs (read these first):**
- PRD: `docs/prd/ai-outbound-email-intent-aware-delivery-prd.md`
- Tech design: `docs/prd/ai-outbound-email-intent-aware-delivery-technical-design.md` (authoritative for §6 types, §7 entities, §8 state machines, §9 resolver, §11 hashing, §12 preflight, §13 authorization, §14 tool policy, §15 delivery, §16 worker, §17 IPC, §20 error contract, §21 recovery)

**Proven reference implementation to mirror (do NOT reinvent):**
- `src/service/emailReply/EmailReplyRevisionHasher.ts` — canonical SHA-256 envelope hashing, idempotency keys, one-time token gen/hash. Reuse its exported helpers where signatures fit; copy the *pattern* for batch hashing.
- `src/service/emailReply/EmailReplyApprovalService.ts` — exact-content approval.
- `src/service/emailReply/EmailReplyDeliveryService.ts` — idempotent atomic-claim delivery orchestration (SMTP outside the DB transaction).
- `src/entity/EmailReplyApproval.entity.ts`, `src/model/EmailReplyApproval.model.ts`, `src/modules/EmailReplyApprovalModule.ts` — exact entity/model/module trio pattern.
- `src/schemas/entity/emailReplyApproval.ts` — Zod write-boundary schema pattern (`lazySchema`).
- `src/model/_workerBoundaryGuard.ts` — `rejectDatabaseAccessFromWorker(...)` called in every Model constructor.

---

## Mandatory project rules (apply to EVERY task)

1. **No `any`.** Use proper types or `unknown`. All functions have explicit return types.
2. **Zod v4** (`import { z } from "zod/v4"`) at every boundary: tool args, IPC payloads, persisted write schemas. Derive types with `z.infer`.
3. **Three-layer DB architecture.** IPC handlers → Modules (`src/modules/`, extend `BaseModule`) → Models (`src/model/`, extend `BaseDb`). NEVER TypeORM repositories in IPC handlers. NEVER DB access from worker processes (every Model constructor calls `rejectDatabaseAccessFromWorker`).
4. **AI-enable check first** in any AI-serving IPC handler: `Token` + `USER_AI_ENABLED` from `@/config/usersetting`; return `{ status:false, msg, data:null }` immediately if not enabled.
5. **Worker files** live in `src/childprocess/`; registered in `forge.config.js`. Workers communicate results to main via IPC messages only.
6. **i18n**: any user-facing UI text added to ALL of `src/views/lang/{en,zh,es,fr,de,ja}.ts`.
7. **UI changes require UI tests** in `test/vitest/main/components/`; `yarn test:components` must pass.
8. **Auto-commit after each completed function/logical unit** with conventional-commit messages. NEVER `--no-verify`. If the pre-commit hook (eslint / tsc gate) fails, fix the reported errors and re-commit.
9. **Immutability**: never mutate input objects; return new copies.

## Test commands (use exactly)

- Main-process unit tests: `yarn testmain` (runs `tsc --noEmit` gate first). For a tight inner loop on one file: `AIFETCHLY_SKIP_TSC=1 npx vitest run <file> --config vite.main.config.mjs` — but ALWAYS run the full gated `yarn testmain` before committing a phase.
- Component tests: `yarn test:components`
- E2E: `yarn test:e2e` (Linux: `xvfb-run -a yarn playwright test`)
- Type check: `yarn tsc` / `npx tsc --noEmit`

## Test placement

- Main-process services/models/modules: `test/vitest/main/`
- Utility/pure functions (hasher, resolver dictionaries): `test/vitest/utilitycode/`
- Vue components: `test/vitest/main/components/`
- E2E: `test/e2e/specs/`

---

# PHASE 1 — Intent decision and hard tool gate

**Exit criteria:** review/negation requests cannot reach the send implementation; generic approval modes cannot authorize outbound delivery; intent decisions survive restart.

### Task 1.1: Domain types + Zod schemas

**Files:**
- Create: `src/entityTypes/outboundEmailDeliveryTypes.ts`
- Test: `test/vitest/utilitycode/outboundEmailDeliveryTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/vitest/utilitycode/outboundEmailDeliveryTypes.test.ts
import { describe, it, expect } from "vitest";
import {
  outboundEmailDeliveryModeSchema,
  outboundEmailIntentEvidenceSchema,
  authorizedOutboundEnvelopeSchema,
  authorizedEmailWorkerPayloadV2Schema,
} from "@/entityTypes/outboundEmailDeliveryTypes";

describe("outboundEmailDeliveryTypes schemas", () => {
  it("accepts the three delivery modes and rejects others", () => {
    expect(outboundEmailDeliveryModeSchema.parse("send_now")).toBe("send_now");
    expect(outboundEmailDeliveryModeSchema.parse("review_first")).toBe("review_first");
    expect(outboundEmailDeliveryModeSchema.parse("draft_only")).toBe("draft_only");
    expect(() => outboundEmailDeliveryModeSchema.parse("auto_send")).toThrow();
  });

  it("validates evidence offsets are non-negative and ordered", () => {
    const ok = outboundEmailIntentEvidenceSchema.safeParse({
      start: 0, end: 4, normalizedPhrase: "send", category: "send",
    });
    expect(ok.success).toBe(true);
    const bad = outboundEmailIntentEvidenceSchema.safeParse({
      start: 5, end: 2, normalizedPhrase: "x", category: "send",
    });
    expect(bad.success).toBe(false);
  });

  it("validates an authorized envelope requires a 64-char hash", () => {
    const base = {
      draftId: 1, revisionId: 2, revisionNumber: 1,
      recipientAddress: "a@b.com", emailServiceId: 3,
      senderAddress: "s@b.com", subject: "Hi", bodyText: "Body",
      bodyHtml: null, envelopeHash: "x".repeat(64),
    };
    expect(authorizedOutboundEnvelopeSchema.safeParse(base).success).toBe(true);
    expect(authorizedOutboundEnvelopeSchema.safeParse({ ...base, envelopeHash: "short" }).success).toBe(false);
  });

  it("validates the v2 worker payload discriminated shape", () => {
    const payload = {
      version: 2 as const, mode: "authorized_envelopes" as const,
      batchId: 1, sendAttemptId: 2, batchHash: "h".repeat(64),
      envelopes: [], emailServices: [],
    };
    expect(authorizedEmailWorkerPayloadV2Schema.safeParse(payload).success).toBe(true);
    expect(authorizedEmailWorkerPayloadV2Schema.safeParse({ ...payload, version: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 npx vitest run test/vitest/utilitycode/outboundEmailDeliveryTypes.test.ts --config vite.utilityCode.config.mjs`
Expected: FAIL — module `@/entityTypes/outboundEmailDeliveryTypes` not found.

- [ ] **Step 3: Implement the types + schemas**

Create `src/entityTypes/outboundEmailDeliveryTypes.ts`. Copy the enum/type definitions verbatim from tech design §6 (DeliveryMode, IntentReasonCode, BatchStatus, DraftStatus, AuthorizationType, SendAttemptStatus, RecipientOutcomeStatus) and §6.1–6.4 (IntentDecision, IntentEvidence, AuthorizedOutboundEnvelope, AuthorizedEmailWorkerPayloadV2, EmailWorkerPayload, AuthorizedEmailWorkerEvent). Add a Zod schema for each boundary type. Import `EmailServiceEntitydata` from `@/entityTypes/emailmarketingType` for the payload's `emailServices`. Example of the pattern to follow for each enum:

```typescript
import { z } from "zod/v4";
import type { EmailServiceEntitydata } from "@/entityTypes/emailmarketingType";

export const outboundEmailDeliveryModeSchema = z.enum([
  "send_now", "review_first", "draft_only",
]);
export type OutboundEmailDeliveryMode = z.infer<typeof outboundEmailDeliveryModeSchema>;

export const outboundEmailIntentReasonCodeSchema = z.enum([
  "explicit_send_instruction", "explicit_review_instruction",
  "explicit_do_not_send", "conflicting_instruction",
  "ambiguous_instruction", "contextual_affirmation", "resolver_failure",
]);
export type OutboundEmailIntentReasonCode = z.infer<typeof outboundEmailIntentReasonCodeSchema>;

// ... batch/draft/authorization/attempt/outcome status enums per §6 ...

export const outboundEmailIntentEvidenceSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  normalizedPhrase: z.string(),
  category: z.enum(["send", "review", "negation", "affirmation"]),
}).refine((e) => e.end >= e.start, { message: "end must be >= start" });
export type OutboundEmailIntentEvidence = z.infer<typeof outboundEmailIntentEvidenceSchema>;

export interface OutboundEmailIntentDecision {
  id: number; conversationId: string; sourceUserMessageId: string;
  mode: OutboundEmailDeliveryMode; reasonCode: OutboundEmailIntentReasonCode;
  confidence: number; evidence: OutboundEmailIntentEvidence[];
  resolverVersion: string; sourceTextHash: string; createdAt: string;
}

export const authorizedOutboundEnvelopeSchema = z.object({
  draftId: z.number().int(), revisionId: z.number().int(), revisionNumber: z.number().int(),
  recipientAddress: z.string().max(320), emailServiceId: z.number().int(),
  senderAddress: z.string().max(320), subject: z.string().max(500),
  bodyText: z.string(), bodyHtml: z.string().nullable(),
  envelopeHash: z.string().length(64),
});
export type AuthorizedOutboundEnvelope = z.infer<typeof authorizedOutboundEnvelopeSchema>;

export const authorizedEmailWorkerPayloadV2Schema = z.object({
  version: z.literal(2), mode: z.literal("authorized_envelopes"),
  batchId: z.number().int(), sendAttemptId: z.number().int(),
  batchHash: z.string().length(64),
  envelopes: z.array(authorizedOutboundEnvelopeSchema),
  emailServices: z.array(z.unknown()), // narrowed to EmailServiceEntitydata at the worker boundary
});
export type AuthorizedEmailWorkerPayloadV2 = Omit<
  z.infer<typeof authorizedEmailWorkerPayloadV2Schema>, "emailServices"
> & { emailServices: EmailServiceEntitydata[] };

// AuthorizedEmailWorkerEvent discriminated union per §6.4 (submitted / failed / worker-complete).
```

- [ ] **Step 4: Run to verify it passes** — same command; Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/entityTypes/outboundEmailDeliveryTypes.ts test/vitest/utilitycode/outboundEmailDeliveryTypes.test.ts
git commit -m "feat: add outbound email delivery domain types and zod schemas"
```

---

### Task 1.2: Intent entity + write schema + model + module

**Files:**
- Create: `src/entity/OutboundEmailIntent.entity.ts`
- Create: `src/schemas/entity/outboundEmailIntent.ts`
- Create: `src/model/OutboundEmailIntent.model.ts`
- Create: `src/modules/OutboundEmailIntentModule.ts`
- Modify: `src/config/SqliteDb.ts` (register entity in the `entities: [...]` array near line 541, and add the import)
- Test: `test/vitest/main/OutboundEmailIntent.model.test.ts`

Mirror the trio pattern exactly from `EmailReplyApproval.entity.ts` / `.model.ts` / `EmailReplyApprovalModule.ts` and schema from `emailReplyApproval.ts`. Entity columns per tech design §7.1. Entity extends `AuditableEntity`; table name `outbound_email_intent`; unique index `(conversationId, sourceUserMessageId)`; index `(mode, createdAt)`.

- [ ] **Step 1: Write the failing model test** — create/read/findBySource round-trip against a temp DB (follow the existing pattern in `test/vitest/main/DependencyAudit.model.test.ts` for temp-DB setup). Assert the unique `(conversationId, sourceUserMessageId)` constraint rejects a duplicate.
- [ ] **Step 2: Run to verify it fails** (entity/model do not exist).
- [ ] **Step 3: Implement entity** (`@Entity("outbound_email_intent")`, `@Index(["conversationId","sourceUserMessageId"],{unique:true})`, `@Index(["mode","createdAt"])`; columns: `conversationId` varchar(100), `sourceUserMessageId` varchar(100), `mode` varchar(30), `reasonCode` varchar(50), `confidence` real, `evidenceJson` text, `sourceTextHash` varchar(64), `resolverVersion` varchar(50), `previousAssistantMessageId` varchar(100) nullable).
- [ ] **Step 4: Implement write schema** `outboundEmailIntentWriteSchema` via `lazySchema`, validating every writable column (mode/reasonCode via the §1.1 enums, `confidence` `z.number().min(0).max(1)`, `evidenceJson` string).
- [ ] **Step 5: Implement model** extending `BaseDb`, calling `rejectDatabaseAccessFromWorker("OutboundEmailIntentModel")`, with `create`, `read`, `findBySource(conversationId, sourceUserMessageId)`. Use `parseAndStrip(entity, outboundEmailIntentWriteSchema())` in `create`.
- [ ] **Step 6: Implement module** extending `BaseModule` with try/catch + `ensureConnection()` wrappers delegating to the model.
- [ ] **Step 7: Register entity** in `src/config/SqliteDb.ts` (add import + array entry).
- [ ] **Step 8: Run test → PASS**, then `yarn testmain` to confirm the tsc gate passes.
- [ ] **Step 9: Commit** — `feat: add outbound email intent entity, model, and module`.

---

### Task 1.3: Deterministic intent resolver

**Files:**
- Create: `src/service/outboundEmail/OutboundEmailIntentResolver.ts`
- Create: `src/service/outboundEmail/outboundIntentPhrases.ts` (versioned phrase dictionaries for en/zh/es/fr/de/ja)
- Create: `src/service/outboundEmail/outboundReliabilityVersions.ts`
- Test: `test/vitest/utilitycode/outboundEmailIntentResolver.test.ts`

Implement tech design §9.2 stages 1–7 (deterministic only; the semantic fallback §9.3 is a separate later task and defaults to `draft_only` when inconclusive). Precedence (AD-002): negation/review > explicit send > draft-only. Export `OUTBOUND_RESOLVER_VERSION` from the versions file.

- [ ] **Step 1: Write failing tests** covering: explicit send ("send these emails now"), review ("let me review before sending"), negation ("don't send yet"), conflict (send + review → review wins), ambiguous (no phrases → draft_only), and one phrase per supported language. Assert `mode`, `reasonCode`, and that `evidence` offsets map back into the source text.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `outboundReliabilityVersions.ts`** (`OUTBOUND_RESOLVER_VERSION`, `OUTBOUND_POLICY_VERSION`, `OUTBOUND_VALIDATOR_VERSION`, `OUTBOUND_SEND_RECOVERY_THRESHOLD_MS = 2*60*1000`).
- [ ] **Step 4: Implement `outboundIntentPhrases.ts`** — export `NEGATION_PHRASES`, `REVIEW_PHRASES`, `SEND_PHRASES`, `AFFIRMATION_PHRASES`, each a `Record<Lang, string[]>`.
- [ ] **Step 5: Implement `OutboundEmailIntentResolver.resolve(input: ResolveOutboundEmailIntentInput): OutboundEmailIntentDecision`** (pure, no DB) — NFKC normalize, whitespace/punctuation normalize (keeping an offset map), detect negation → review → send → affirmation, apply precedence, return decision with evidence spans and `sourceTextHash` (SHA-256 of canonical user text).
- [ ] **Step 6: Run → PASS.**
- [ ] **Step 7: Commit** — `feat: add deterministic outbound email intent resolver`.

---

### Task 1.4: Trusted context fields (engine + loop input + skill context)

**Files:**
- Modify: `src/service/AIChatQueryEvents.ts` (`AIChatQueryLoopInput` — add `sourceUserMessageId?: string; intentDecisionId?: number | null;`)
- Modify: `src/entityTypes/skillTypes.ts` (`SkillExecutionContext` — add `sourceUserMessageId?: string; intentDecisionId?: number | null;`; `SkillDefinition` — add `confirmationPolicy?: ToolConfirmationPolicy;` and export `type ToolConfirmationPolicy = "standard_permission" | "request_scoped_action";`)
- Modify: `src/service/AIChatQueryEngine.ts` (after `savedUser.messageId` ~line 714–718, run the resolver, persist via `OutboundEmailIntentModule`, thread `sourceUserMessageId`/`intentDecisionId` into `loopInput` ~line 910)
- Test: `test/vitest/main/OutboundEmailIntentEngineWiring.test.ts`

- [ ] **Step 1: Write failing test** asserting `AIChatQueryLoopInput` carries the two new fields and that the engine populates them (mock the resolver/module).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add the type fields** to `skillTypes.ts` and `AIChatQueryEvents.ts`.
- [ ] **Step 4: Wire the engine** — call resolver with `conversationId`, `sourceUserMessageId: savedUser.messageId`, `userAuthoredText` (the pre-enrichment request message), `previousAssistantMessageId/Text`; persist; set the two fields on `loopInput`. Wrap in try/catch — a resolver failure must not break chat (default `draft_only`, `reasonCode: "resolver_failure"`).
- [ ] **Step 5: Run → PASS**, then `yarn testmain`.
- [ ] **Step 6: Commit** — `feat: thread trusted intent context through chat engine and skill context`.

---

### Task 1.5: Tool gate + generic approval-policy update

**Files:**
- Create: `src/service/outboundEmail/OutboundEmailToolGate.ts`
- Modify: `src/service/AIChatToolApprovalPolicyService.ts` (never auto-approve `request_scoped_action` tools solely due to `approve_for_me`/`full_access`)
- Modify: `src/config/skillsRegistry.ts` (`start_email_send_task` — add `confirmationPolicy: "request_scoped_action"`)
- Modify: `src/service/AIChatQueryLoop.ts` (evaluate the gate alongside the plan-mode gate ~line 1755, before `prepareToolCall`)
- Test: `test/vitest/main/OutboundEmailToolGate.test.ts`, `test/vitest/main/AIChatToolApprovalPolicyService.test.ts` (extend)

- [ ] **Step 1: Write failing tests** — (a) `evaluateToolApproval` returns `autoApprove:false` for a `request_scoped_action` tool even in `full_access`; (b) `OutboundEmailToolGate.evaluate(...)` returns the §14.2 union (`draft_required`/`review_required`/`authorization_missing`/... vs `allowed:true`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `OutboundEmailToolGate`** returning the exact `OutboundEmailToolGateResult` union from §14.2. For Phase 1 there is no authorization yet, so the gate returns `allowed:false` with `draft_required`/`review_required`/`authorization_missing` based on the intent decision; `allowed:true` is only reachable once Phase 3 authorization exists (gate reads it via the delivery module).
- [ ] **Step 4: Update `evaluateToolApproval`** — resolve the skill's `confirmationPolicy`; if `"request_scoped_action"`, return `autoApprove:false` with reason `"Request-scoped action requires explicit authorization"` before the mode-based auto-approve branches.
- [ ] **Step 5: Set `confirmationPolicy: "request_scoped_action"`** on `start_email_send_task`.
- [ ] **Step 6: Integrate the gate into the loop** next to `checkPlanModeToolPolicy`; on a non-allowed result, emit a blocked tool result (stable `code`) and `continue` without executing.
- [ ] **Step 7: Run → PASS**, then `yarn testmain`.
- [ ] **Step 8: Commit** — `feat: enforce outbound email tool gate and request-scoped approval policy`.

---

# PHASE 2 — Durable drafts, revisions, preflight, hashing

**Exit criteria:** every recipient has a final immutable envelope; no authorization exists before complete-batch preflight passes.

### Task 2.1: Batch, draft, revision, audit entities + schemas + models + modules

**Files (create):** entities `OutboundEmailDraftBatch.entity.ts`, `OutboundEmailDraft.entity.ts`, `OutboundEmailDraftRevision.entity.ts`, `OutboundEmailAuditLog.entity.ts`; matching `src/schemas/entity/outboundEmail*.ts`; models `OutboundEmailDraft.model.ts` (batch+draft+revision), `OutboundEmailAuditLog` folded into a delivery model later; modules `OutboundEmailDraftModule.ts`. Register all in `SqliteDb.ts`.
**Test:** `test/vitest/main/OutboundEmailDraft.model.test.ts`

Column definitions: copy verbatim from tech design §7.2 (batch), §7.3 (draft), §7.4 (revision, append-only), §7.8 (audit). Follow the Task 1.2 trio pattern. Revisions are append-only (no update method that mutates content; edits insert a new revision and bump the draft's `currentRevisionId`/`revisionNumber` in one transaction).

- [ ] Step 1: failing model test (create batch → add drafts → add revisions → recompute batch hash pointer; assert revision immutability and unique `(draftId, revisionNumber)`).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3–7: implement entities, schemas, models (with `rejectDatabaseAccessFromWorker`), modules, register entities.
- [ ] Step 8: Run → PASS + `yarn testmain`.
- [ ] Step 9: Commit — `feat: add outbound draft batch, draft, revision, and audit persistence`.

### Task 2.2: Envelope + batch hasher

**Files:** Create `src/service/outboundEmail/OutboundEmailEnvelopeHasher.ts`. **Test:** `test/vitest/utilitycode/outboundEmailEnvelopeHasher.test.ts`

Implement §11 exactly: `CanonicalOutboundEnvelopeV1`, address lowercasing for hash, newline→`\n`, `null` HTML, fixed field order, schema version, no timestamps/IDs in the envelope hash. Batch hash = `SHA256("outbound-batch:v1\n" + sorted envelope hashes)` sorted by `(recipientAddress, draftId)`. Reuse `normalizeLineEndings`-style helpers; you may import `normalizeEmailAddressForHash` from `EmailReplyRevisionHasher` if the semantics match, else implement per §11 (trimmed lowercase whole-address).

- [ ] Step 1: failing test (determinism, newline normalization, null-vs-empty HTML, address case, batch sort order).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS.
- [ ] Step 5: Commit — `feat: add canonical outbound envelope and batch hashing`.

### Task 2.3: Preflight service

**Files:** Create `src/service/outboundEmail/OutboundEmailPreflightService.ts`. **Test:** `test/vitest/main/OutboundEmailPreflight.test.ts`

Implement §12 checks (1–14) returning `OutboundEmailPreflightResult { passed, batchHash, policyVersion, validationVersion, findings }`. All-or-nothing. Enforce limits §10.2 (100 recipients, 50k chars text/HTML, 5 MiB payload → `batch_limit_exceeded`).

- [ ] Step 1: failing tests (empty batch, invalid address, missing revision, hash mismatch, oversize → blocking findings; happy path → `passed:true` + `batchHash`).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS + `yarn testmain`.
- [ ] Step 5: Commit — `feat: add complete-batch outbound preflight service`.

### Task 2.4: Draft generation service + `draft_outbound_email_batch` tool

**Files:** Create `src/service/outboundEmail/OutboundEmailDraftService.ts`; modify `src/config/skillsRegistry.ts` (add tool); modify `src/service/EmailMarketingAiTools.ts` (compatibility routing). **Test:** `test/vitest/main/OutboundEmailDraftService.test.ts`

Implement §10: recipient materialization (canonicalize, dedupe, one draft per recipient), immutable revision creation (§10.4), personalization evidence (§10.3). The tool reads `conversationId`/`sourceUserMessageId`/`intentDecisionId` from `SkillExecutionContext` (never from args). Check `USER_AI_ENABLED` first.

- [ ] Step 1: failing tests (materialize+dedupe, revision immutability, evidence present, AI-disabled → `ai_disabled`).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS + `yarn testmain`.
- [ ] Step 5: Commit — `feat: add outbound draft generation service and draft tool`.

---

# PHASE 3 — Authorization and idempotent delivery

**Exit criteria:** explicit send-now produces one attempt without review; reviewed drafts require exact-content approval; duplicate requests cannot duplicate SMTP submission.

### Task 3.1: Authorization, send-attempt, outcome entities + models + modules

**Files (create):** `OutboundEmailAuthorization.entity.ts`, `OutboundEmailSendAttempt.entity.ts`, `OutboundEmailDeliveryOutcome.entity.ts`; schemas; `OutboundEmailAuthorization.model.ts`, `OutboundEmailDelivery.model.ts` (attempt+outcome); `OutboundEmailDeliveryModule.ts`. Register in `SqliteDb.ts`. **Test:** `test/vitest/main/OutboundEmailAuthorization.model.test.ts`

Columns per §7.5 (authorization), §7.6 (attempt, unique `idempotencyKey`), §7.7 (outcome, unique `(sendAttemptId, draftId)`). Authorization TTLs: direct 15 min, review 30 min; one active per batch.

- [ ] Step 1: failing test (unique idempotency key; unique `(sendAttemptId,draftId)`; one-active-authorization rule).
- [ ] Step 2: FAIL → Step 3–6: implement → Step 7: PASS + `yarn testmain`.
- [ ] Step 8: Commit — `feat: add outbound authorization, send attempt, and delivery outcome persistence`.

### Task 3.2: Authorization service

**Files:** Create `src/service/outboundEmail/OutboundEmailAuthorizationService.ts`. **Test:** `test/vitest/main/OutboundEmailAuthorizationService.test.ts`

Implement §13.1 (direct-send conditions) and §13.2 (review approval with 256-bit token, store SHA-256 only — reuse `generateApprovalToken`/`hashApprovalToken` from `EmailReplyRevisionHasher`). Implement invalidation §13.3.

- [ ] Step 1: failing tests (direct requires `send_now`+matching source message+preflight pass; review approval returns raw token once, stores hash; edit invalidates).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS + `yarn testmain`.
- [ ] Step 5: Commit — `feat: add outbound authorization service`.

### Task 3.3: Delivery service (claim transaction + worker prep)

**Files:** Create `src/service/outboundEmail/OutboundEmailDeliveryService.ts`; modify `src/modules/buckEmailTaskModule.ts` (narrow adapter). **Test:** `test/vitest/main/OutboundEmailDeliveryService.test.ts`

Implement §15.1 claim transaction (steps 1–11) and §15.2 worker prep. Idempotency key format §7.6: `outbound-email:v1:<batchId>:<authorizationId>:<batchHash>`. SMTP outside the transaction. Mirror `EmailReplyDeliveryService`. Inject a sender factory for tests.

- [ ] Step 1: failing tests (claim success; duplicate idempotency key → `already_processed`; hash mismatch → throw; worker-start failure → `worker_start_failed`, batch `failed`).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS + `yarn testmain`.
- [ ] Step 5: Commit — `feat: add authoritative outbound delivery service with idempotent claim`.

### Task 3.4: Versioned worker payload + authorized worker path

**Files:** Modify `src/taskCode.ts` (add `sendAuthorizedEmails` message); modify `src/childprocess/emailSend.ts` (add `sendAuthorizedEnvelopes`). **Test:** `test/vitest/taskCode/authorizedEmailSend.test.ts`

Implement §16: validate payload with `authorizedEmailWorkerPayloadV2Schema`, recompute hashes before sending (`worker_payload_hash_mismatch` on mismatch), exact per-envelope service/subject/body, NO `convertVariableInTemplate`, NO random selection, typed events §6.4, concurrency 5, zero credentials after. Worker does no DB access.

- [ ] Step 1: failing tests (hash mismatch stops before SMTP; exact envelope used; per-envelope typed events; no random selection).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS + `yarn testmain`.
- [ ] Step 5: Commit — `feat: add authorized exact-envelope worker send path`.

---

# PHASE 4 — Review UI and localization

**Exit criteria:** users can inspect/edit/approve all drafts; edits invalidate approval; direct-send status is visible without review friction.

### Task 4.1: IPC channels + renderer API

**Files:** Modify `src/config/channellist.ts` (add §17 channels); create `src/main-process/communication/outboundEmailDelivery-ipc.ts`; create `src/views/api/outboundEmailDelivery.ts`; register preload. **Test:** `test/vitest/main/outboundEmailDelivery-ipc.test.ts`

Channels per §17 table. Handlers: AI-enable check first, Zod-validate input, verify conversation/batch ownership, call modules/services (never repositories), return stable error codes (§20). Never send raw tokens or SMTP credentials to the renderer.

- [ ] Step 1: failing IPC tests (each channel happy path + validation failure + ownership failure + AI-disabled).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS + `yarn testmain`.
- [ ] Step 5: Commit — `feat: add outbound email delivery IPC channels and renderer API`.

### Task 4.2: Review UI components + localization

**Files:** Create review dialog/draft editor/batch card/progress components under `src/views/`; modify all 6 lang files. **Test:** `test/vitest/main/components/OutboundEmailReview*.test.ts`; E2E `test/e2e/specs/outbound-email-review.test.ts`

Behavior per §18. Editing creates a new revision and invalidates approval. Send disabled while blocking findings exist. All text via `t()` with English fallback, added to en/zh/es/fr/de/ja.

- [ ] Step 1: failing component tests (render list, edit→invalidate, send disabled on findings, progress display).
- [ ] Step 2: FAIL → Step 3: implement components + translations → Step 4: `yarn test:components` PASS.
- [ ] Step 5: E2E for the critical review→approve→send flow.
- [ ] Step 6: Commit — `feat: add outbound email review UI with full localization`.

---

# PHASE 5 — Recovery, telemetry, legacy retirement

**Exit criteria:** restart and worker-failure behavior is conservative and auditable; no AI outbound path bypasses the authoritative delivery service.

### Task 5.1: Recovery service + startup reconciliation

**Files:** Create `src/service/outboundEmail/OutboundEmailRecoveryService.ts`; wire into app startup after DB ready. **Test:** `test/vitest/main/OutboundEmailRecovery.test.ts`

Implement §21 rules 1–6 (expire authorizations, conservative attempt recovery, `delivery_unknown` for uncertain recipients, recompute batch status, never create new attempts, audit every transition).

- [ ] Step 1: failing tests (expired auth → expired; dead-worker sending → `delivery_unknown`; no new attempt created).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS + `yarn testmain`.
- [ ] Step 5: Commit — `feat: add outbound email recovery and startup reconciliation`.

### Task 5.2: Telemetry + legacy retirement

**Files:** add metrics per §23.1; deprecate/gate the legacy AI send path in `EmailMarketingAiTools.ts` so all AI outbound sends route through the delivery service. **Test:** regression + intent evaluation corpus test (`test/vitest/main/OutboundEmailIntentCorpus.test.ts`) asserting zero false direct sends on the deny/review corpus.

- [ ] Step 1: failing corpus test (deny/review phrases never yield `send_now`).
- [ ] Step 2: FAIL → Step 3: implement → Step 4: PASS.
- [ ] Step 5: Commit — `feat: add outbound telemetry and retire legacy AI send path`.

---

## Self-Review Notes

- **Spec coverage:** Phases 1–5 map to tech design §28 and DoD §30. FR traceability §31 is covered: FR-001/002/003 (Phase 1), FR-005–009 (Phase 2), FR-004/010–017 (Phase 3), FR-019/020 (Phase 4), FR-021/022/023 + legacy (Phase 5).
- **Placeholders:** Entity column sets, state machines, error codes, and limits are copied from the tech design section cited in each task; the resolver phrase dictionaries and the full preflight check bodies are the only intentionally-iterated code and each has a concrete failing test first.
- **Type consistency:** `OutboundEmailIntentDecision`, `AuthorizedOutboundEnvelope`, `AuthorizedEmailWorkerPayloadV2`, `AuthorizedEmailWorkerEvent`, `OutboundEmailToolGateResult`, and `OutboundEmailPreflightResult` are defined once (Task 1.1 / §14.2 / §12) and referenced by name in later tasks.
