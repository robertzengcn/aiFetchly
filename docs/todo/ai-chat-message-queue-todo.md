# AI Chat Message Queue TODO

Source PRDs/design:
- `docs/ai-chat-message-queue-prd.md`
- `docs/ai-chat-message-queue-technical-design.md`

Audit date: 2026-08-31 (updated 2026-09-02)
Branch: `worktree-ai-chat-message-queue`

## Current Status

The durable message queue, steering control plane, cancellation propagation, IPC surface, renderer UI, i18n, feature flags, and unit/component test coverage are **implemented and passing** (fresh run this audit):

- Model + Module tests: **26 passed**
- Queue service + Steering loop + IPC tests: **28 passed**
- Component (`AiChatV2PendingMessage`) tests: **7 passed**
- `tsc --noEmit`: **0 errors**

The remaining work below covers the items in the PRD §15/§17.5 and technical design §19.2/§21.6/§22(Phase 3) that are **not yet present** in the worktree.

## TODO

### 1. Electron E2E coverage for queue / steering critical flows — SPECS WRITTEN, RUN BLOCKED (2026-09-02)

**Severity: High**

- [x] `test/e2e/specs/aiChatQueueSteering.test.ts` implements all 8 §21.6 scenarios; the fake OpenAI server gained a multi-tool-call config with pre-emit delay; the E2E env pins the runtime-catalog URL to loopback (network guard). Two real product fixes fell out: the composer textarea is no longer disabled while streaming (PRD §7.1).
- [ ] **Running the specs is blocked**: fresh launches now auto-redirect to the redesigned `#/aiworkspace` default landing (dev commit `57944b87`), whose chat surface has its own send path predating this feature — the legacy dock surface the specs (and this feature's renderer integration) target is only reachable before the redirect, and sends on the workspace surface do not reach the provider. Follow-ups:
  1. Route the workspace chat surface's send path through the pending-message queue (it currently bypasses `AiChatV2.vue`'s queue integration), or expose a deterministic way for E2E to select the legacy surface (e.g. a state-manifest landing-route override).
  2. Then re-run `yarn test:e2e` and debug the 8 specs against a stable surface.

Original audit note: no specs existed in `test/e2e/specs/` (zero matches for `queue|steer|pending`).
- [ ] The technical design §21.6 defines 8 explicit scenarios that must run under `yarn test:e2e` (design §21.7 lists `yarn test:e2e` as a hard verification gate; §22 Phase 1/2 use the "between-tools E2E" as an exit gate; PRD §17.5 requires equivalent coverage):
  1. Queue B behind delayed A and verify automatic B dispatch after A completes.
  2. Steer between tool A and tool B; verify B never executes and receives a synthetic result.
  3. Race Steer with A completion; verify the message is steering or the next turn, never both.
  4. Stop A; verify B remains paused until explicit Resume.
  5. Force provider error; verify queue stays paused.
  6. Switch between conversations while both have independent work.
  7. Relaunch with queued rows; verify no automatic provider request and explicit recovery works.
  8. Queue an attachment; verify it dispatches normally and cannot steer.

**Reason not done:** unit/component/IPC coverage was implemented, but no Electron E2E specs were written for these flows. E2E requires the packaged/launched app (Playwright `_electron` launch), a stubbed/fake provider to control A/B/latency/errors, and cross-process timing assertions — a distinct testing layer that was not part of the completed unit test work. This is the largest outstanding item and a stated exit gate in the design (§21.7, §22 Phase 1/2).

---

### 2. Observability counters — DONE (2026-09-02)

- [x] `src/service/AIChatQueueCounters.ts` implements all nine §19.2 keys (including labeled `steering_rejected{reason}` and `queue_recovered{state}`) plus §19.3 timing aggregates (enqueue→dispatch, steer-click→boundary, drain duration, pending DB transaction). Wired into the queue service, the steering promoter, and the loop's skipped-tool emitter; 5 unit tests. No message content is ever recorded.

**Severity: Low**

- [ ] None of the counters from technical design §19.2 are implemented:
  - `ai_chat_pending_created_total`
  - `ai_chat_pending_dispatched_total`
  - `ai_chat_pending_paused_total`
  - `ai_chat_pending_failed_total`
  - `ai_chat_steering_requested_total`
  - `ai_chat_steering_applied_total`
  - `ai_chat_steering_rejected_total{reason}`
  - `ai_chat_steering_skipped_tools_total`
  - `ai_chat_queue_recovered_total{state}`

- [ ] No queue enqueue-to-dispatch / steer-click-to-boundary / drain / pending-DB-transaction **timings** (design §19.3) are emitted.

**Reason not done:** these are grouped under technical design §22 Phase 3 "hardening — add counters, timings, pruning, and failure UX". The PRD lists them as recommended. Existing counters (e.g. `ToolCatalogCounters`) exist in the codebase and could be reused, but no queue/steering metric keys were added yet.

---

### 3. Pasted-content 256k character cap — DONE (2026-09-02)

- [x] `AI_CHAT_PENDING_PASTED_CONTENT_MAX_CHARS = 256_000` enforced in `AIChatPendingMessageModule.createPendingMessage` (defense-in-depth behind the stricter 100k IPC schema cap); test added (commit `5f1ff27f`).

**Severity: Low**

- [ ] Technical design §8.3 defines `AI_CHAT_PENDING_PASTED_CONTENT_MAX_CHARS` (256k cap on pasted text that gets persisted as queued content).
- [ ] Confirmed absent: no `PASTED_CONTENT` / 256k enforcement anywhere in `src/`.
- [ ] The primary 32k content cap (`AI_CHAT_PENDING_CONTENT_MAX_CHARS`, module constant) **is** implemented; only the secondary pasted-content-specific cap is missing.

**Reason not done:** the 32k general content limit (design's primary safeguard) was implemented; the separate 256k pasted-content cap was not. Lower risk because pasted text flows through the same 32k limit, but the dedicated cap required by §8.3 is still absent.

---

## Verification Commands (per design §21.7)

```bash
yarn testmain
yarn test:components
yarn test:e2e        # blocked until TODO #1 is implemented
yarn vue-check
```
