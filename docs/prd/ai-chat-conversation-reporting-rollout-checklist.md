# Conversation Reporting — Rollout Checklist

Reference: `docs/prd/ai-chat-conversation-reporting-prd.md` §24, technical design `docs/prd/ai-chat-conversation-reporting-technical-design.md` §25.5.

## Pre-merge

- [ ] `yarn testmain`, `yarn test:components`, `npx tsc --noEmit`, `yarn vue-check` all green
- [ ] `npx eslint` clean on all touched files (zero errors; only pre-existing `v-html` / `vue/require-default-prop` warnings unrelated to this feature)
- [ ] Capability endpoint fail-closes to `enabled:false` on network error (verified by service test `aiContentReportService.test.ts`)
- [ ] Reporting works when `USER_AI_ENABLED !== "true"` (handler uses `registerValidatedHandler`, NOT `registerAiValidatedHandler` — never checks `USER_AI_ENABLED` for this flow; PRD FR-4.4)
- [ ] No report content (items, comment, text, images, message/conversation ids, model) appears in logs — metadata-only (service logs reference only report id / error codes)
- [ ] `formatZodValidationError` does not echo rejected values (regression test `registerValidatedHandlerMalformed.test.ts` + `zodErrorsNoLeak.test.ts` green)

## Smoke (manual, per surface: AiChatV2, AiChatBox, Knowledge)

- [ ] "Report conversation" button visible in header; disabled (not hidden) when backend down / capability `enabled:false`
- [ ] Opening the dialog lists only visible completed AI outputs (not user/system/tool/streaming rows)
- [ ] Selecting 1–10 AI outputs enables submit; empty selection is blocked with a clear error
- [ ] Related-user toggle is OFF by default each open; enabling it adds the directly-related user message
- [ ] Submitting returns a report reference; the reported message(s) are marked "Reported"
- [ ] Switching conversations while the dialog is open closes/invalidates it (snapshot is frozen at open time)
- [ ] Long outputs show the truncation notice; submit still succeeds
- [ ] Network failure shows a retryable error with the entered details preserved

## Privacy review

- [ ] Only allowlisted primitive values cross the renderer→main boundary (no metadata objects, URLs, paths, reasoning, attachments, tool data)
- [ ] Strict schemas reject unknown keys at every level (schema tests `aiConversationReportSchema.test.ts` green)
- [ ] Image previews: ≤3 per report, ≤1024px, ≤1MiB; forbidden MIME types rejected by the encoder
- [ ] Immutable snapshots frozen in development builds (`Object.freeze`) — tampering is visible
