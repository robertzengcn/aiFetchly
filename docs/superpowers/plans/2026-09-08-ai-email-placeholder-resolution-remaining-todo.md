# Remaining TODO: AI Email Placeholder Resolution

**Date:** 2026-09-08

**Worktree:** `.claude/worktrees/ai-email-placeholder-resolution`

**Branch:** `worktree-ai-email-placeholder-resolution` @ `acb50607`

**Status:** Open — core send-path architecture is in place; the items below are still incomplete against the PRD and technical design.

**Sources:**

- PRD: `docs/superpowers/specs/2026-09-03-ai-email-placeholder-resolution-prd.md`
- Design: `docs/superpowers/specs/2026-09-04-ai-email-placeholder-resolution-technical-design.md`
- Prior remaining-todo (stale COMPLETE header): `docs/superpowers/plans/2026-09-07-ai-email-placeholder-resolution-remaining-todo.md`

**How to read this file:** every item is still open. “Why incomplete” is the gap against the spec, verified against source on 2026-09-08. It is not a restatement of work that already landed.

This file **supersedes** the 2026-09-07 remaining-todo for tracking. That file’s header claims all 34 TODOs closed; its checkboxes and several “Why incomplete” sections no longer match the code. Do not use it as the live backlog.

---

## Verdict

Phases 1–4 of the selected design are largely implemented:

- Pure `EmailVariableResolver` (canonical parse, markdown-aware legacy detection, no empty substitution on the resolver path)
- `EmailSendPreflightModule` as the main-process enforcement point
- Async `SkillDefinition.preflight` before the permission prompt
- SHA-256 fingerprint + `EMAIL_PREFLIGHT_STALE` on resume
- Immutable `render_plan_json` / `preflight_fingerprint` on the task
- Worker render from snapshot + `assertResolved()`, no identity DB access
- Identity profile phone/website + settings form + six-language strings
- E2E spec `test/e2e/specs/aiEmailPlaceholderResolution.test.ts`

For **AI-started** `start_email_send_task` (no `outboundAuthorization`), unresolved content cannot create a task or reach SMTP.

The PRD and technical design are **not fully closed** until the P0/P1 items below land.

---

## P0 — Spec requirements still failing

### TODO-001 — Inject `EmailOutboundPromptPolicy` into Chat V2 (FR-004, FR-005, design §18)

- [ ] Call `buildEmailOutboundPromptPolicySection()` from `AIChatContextAssembler` when outbound email tools are in the loaded set
- [ ] Keep the section off the always-injected prompt budget when those tools are not loaded
- [ ] Distinguish verified literals vs supported `{$variable}` vs missing values the user must supply
- [ ] Keep `start_email_send_task` description as a short enforcement summary; put the detailed rules in the system-prompt section
- [ ] Cover FR-005 wording: use only verified values or canonical variables; never invent identity, contact, pricing, quantity, legal, certification, or delivery information; never send `[Your Name]`, `[Your Email]`, `[Your Phone]`, `[X]`, `{{variable}}`, or `TBD`; if a required value is missing, do not call the send tool — ask the user

**Why incomplete:** `src/service/EmailOutboundPromptPolicy.ts` exists and exports `buildEmailOutboundPromptPolicySection()`, but it has **no call sites**. `AIChatContextAssembler` only injects `buildBuiltInToolCapabilitiesSection()`, whose outbound row does not mention canonical variables or “never invent.” `get_email_service_config` does attach allowlisted identity fields (FR-004 partial). The tool description has a shorter ENFORCEMENT summary, which design §18.4 says is not a substitute for the dedicated prompt section.

**Evidence:**

- `src/service/EmailOutboundPromptPolicy.ts` — function defined, never imported elsewhere
- `src/service/AIChatContextAssembler.ts` — no `EmailOutboundPromptPolicy` import
- `src/service/BuiltInToolCapabilitiesPromptSection.ts` — capability table row only

---

### TODO-002 — Fix block-banner error code for legacy placeholders (FR-015, FR-017, AC-003 UI)

- [ ] Change `EmailPreflightBlockBanner.vue` `BLOCK_CODES` from `LEGACY_PLACEHOLDERS_FOUND` to `LEGACY_EMAIL_PLACEHOLDERS` (design §9.4)
- [ ] Show the blocking summary (exact markers + affected fields) for that code
- [ ] Keep the “Edit sender identity” shortcut available when the block is sender-field related
- [ ] Add a component test that mounts a `LEGACY_EMAIL_PLACEHOLDERS` tool result and asserts the banner is visible

**Why incomplete:** Preflight and `toToolResult()` return `LEGACY_EMAIL_PLACEHOLDERS`. The banner allowlist still contains `LEGACY_PLACEHOLDERS_FOUND`. A send with `[Your Name]` / `[X]` is still **blocked** (main-process fail-closed), but the user-facing banner and edit-identity action do **not** appear. Component tests only mount `UNRESOLVED_EMAIL_VARIABLES` and `EMAIL_PREFLIGHT_STALE`.

**Evidence:**

- `src/modules/EmailSendPreflightModule.ts` — failure code `LEGACY_EMAIL_PLACEHOLDERS`
- `src/views/components/aiChatV2/EmailPreflightBlockBanner.vue` — `BLOCK_CODES` includes `LEGACY_PLACEHOLDERS_FOUND`
- `test/vitest/main/components/EmailPreflightBlockBanner.test.ts` — no legacy-code case

---

### TODO-003 — Replace empty-string substitution in `convertVariableInTemplate` (FR-010, design §10.1 / §10.6 / §31.11)

- [ ] Move or wrap `src/views/utils/emailFun.ts` so it uses `EmailVariableResolver` instead of replacing missing `Url` / `Description` with `""`
- [ ] Keep a thin renderer wrapper only if the template-preview UI still needs that function
- [ ] On the **legacy** worker path (no `render_plan_json`), fail the recipient / skip SMTP instead of sending empty substitutions
- [ ] Add a worker test: missing `{$url}` / `{$description}` must not call SMTP

**Why incomplete:** The AI render-plan path is safe (`validate` + `render` throw; `assertResolved` before SMTP). The technical design still required replacing `convertVariableInTemplate()`. That function still does `data.Url?data.Url:""` and the same for `Description`. `src/childprocess/emailSend.ts` still imports and calls it when there is no render plan. PRD Goal 1 is scoped to AI-initiated tasks (those now snapshot); design §10.1 / §31.11 apply to the shared helper as well.

**Evidence:**

- `src/views/utils/emailFun.ts` — empty-string fallbacks still present
- `src/childprocess/emailSend.ts` — `convertVariableInTemplate(previewData)` on the legacy path

---

### TODO-004 — Add `phone` and `website` to identity SQL bootstrap (FR-002)

- [ ] Add nullable `phone VARCHAR(50)` and `website VARCHAR(2048)` to `src/sql/scraperdb/email_reply_identity_profile.sql`
- [ ] Confirm `yarn init` / fresh SQLite bootstrap creates the columns without relying only on TypeORM `synchronize: true`

**Why incomplete:** `EmailReplyIdentityProfile.entity.ts` has the columns. IPC, Zod, model, and module persist them. The CREATE TABLE in `email_reply_identity_profile.sql` still lists only the original identity fields. A database created from SQL init will not have `phone` / `website` until synchronize alters the table.

**Evidence:**

- `src/entity/EmailReplyIdentityProfile.entity.ts` — `phone`, `website` columns
- `src/sql/scraperdb/email_reply_identity_profile.sql` — columns absent

---

## P1 — Tests and evaluation still missing vs design §26 / PRD §18 and §20 Phase 3

### TODO-005 — Recipient-set stale confirmation test (AC-009, design §15.3)

- [ ] Add a preflight Module test: change the recipient list between first and second preflight with the same `expectedConfirmationState`
- [ ] Assert `EMAIL_PREFLIGHT_STALE` and that no task is created

**Why incomplete:** Profile-edit and template-edit stale cases exist in `test/vitest/main/EmailSendPreflightModule.test.ts`. AC-009 also requires re-confirmation when the **recipient set** changes. Fingerprint input includes recipients, so the code path likely already fails closed; it is not proven by a test.

---

### TODO-006 — SkillExecutor stale fingerprint prevents `execute` (design §16.2 / §26.4)

- [ ] Extend `test/vitest/main/service/SkillExecutor.preflight.test.ts` so resume with a mismatched fingerprint returns the stale blocking result and never calls `execute`

**Why incomplete:** Executor tests cover preflight-before-permission, blocking skip of the prompt, and threading `expectedConfirmationState`. Stale rejection is covered on the Module, not at the SkillExecutor boundary the design listed.

---

### TODO-007 — Markdown/HTML false-positive evaluation corpus (PRD §20 Phase 3, design Phase 5)

- [ ] Add a fixed evaluation set of representative emails (valid Markdown links, HTML tags/attributes, multilingual body, legacy markers)
- [ ] Measure false-positive rate against the PRD target (below 1%)
- [ ] Expand the legacy allowlist only from observed misses, not from a broader `[text]` rule

**Why incomplete:** `EmailVariableResolver.test.ts` has unit cases for `[label](url)`, images, `<p>` vs `<YOUR_NAME>`, and residual helpers. There is no fixed corpus / eval suite as specified in rollout Phase 3.

---

### TODO-008 — 10,000-recipient preflight performance measure (design §24.3 / Phase 5)

- [ ] Measure preflight duration at 10,000 recipients after database retrieval (or document that first release only **rejects** above 10,000 and that NFR-001 applies at 1,000)
- [ ] Keep the existing reject-over-10,000 guard

**Why incomplete:** NFR-001 (1,000 recipients under 1 second) is tested. Design Phase 5 also asked to measure 10,000. Current coverage is only `rejects more than 10,000 recipients`.

---

## Out of scope / not a remaining product gap

Do **not** treat these as open TODOs for the first release. They match the design’s known constraints:

| Observation | Why it is not a remaining task |
| --- | --- |
| `{$company_name}` and `{$description}` always resolve to `null` | `EmailItem` has no structured company/description field. Design §32: templates that reference unavailable values stay blocked. |
| `{$campaign_name}` always `null` | Design §19.1: do not add arbitrary variables; only persist campaign name if product input already has it. |
| `{$send_time}` frozen at confirmation, not at SMTP send | Design §8.2 / §15.3. PRD table 7.2 said “actual send time”; the selected design wins. |
| Blocked preflight skips the confirmation card instead of disabling Allow | Design §16.2: return the blocking tool result before the permission prompt. |
| Intent-aware `outboundAuthorization` skips bulk `EmailSendPreflightModule` | Claim path re-checks `hasUnresolvedMarkers` on the frozen draft. Separate delivery design; not an unguarded bypass of leftover markers. |

---

## Suggested order

1. **TODO-002** — one-line code fix + component test; user-visible block state is wrong today
2. **TODO-001** — wire the existing policy function into Chat V2
3. **TODO-003** — stop empty-string substitution on the shared helper / legacy worker path
4. **TODO-004** — SQL bootstrap columns
5. **TODO-005, TODO-006** — close AC-009 / §26.4 test holes
6. **TODO-007, TODO-008** — Phase 3 evaluation; not required to keep AI send fail-closed

---

## Verification after close

```bash
cd .claude/worktrees/ai-email-placeholder-resolution

# Targeted
AIFETCHLY_SKIP_TSC=1 yarn vitest-puppeteer test/vitest/utilitycode/EmailVariableResolver.test.ts
AIFETCHLY_SKIP_TSC=1 yarn testmain test/vitest/main/EmailSendPreflightModule.test.ts
AIFETCHLY_SKIP_TSC=1 yarn testmain test/vitest/main/service/SkillExecutor.preflight.test.ts
AIFETCHLY_SKIP_TSC=1 yarn test:components -- test/vitest/main/components/EmailPreflightBlockBanner.test.ts

# Gates from design §30
yarn test:components
yarn testmain
yarn test
yarn typecheck
yarn vue-typecheck
yarn test:e2e
```
