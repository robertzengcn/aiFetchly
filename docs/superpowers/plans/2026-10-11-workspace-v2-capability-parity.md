# AI Chat Workspace Capability Parity — Implementation Plan

> **STATUS (2026-10-11): Tasks 1–14 COMPLETE** — 16 commits on branch
> `workspace-v2-capability-parity` (worktree `.worktrees/workspace-parity`).
>
> Gates: `yarn test:components` 979/979, `tsc --noEmit` 0 errors,
> `vue-tsc --noEmit` 0 errors, `testmain` 6863 passed / 6875 (16 failures
> are pre-existing on base dev — FileToolIntegration / shell-integration /
> ToolExecutor, verified identical on the dev checkout; 1-3 additional
> SqliteDb/SearchModule failures occasionally appear and pass in
> isolation — suite-order DB flakes).
>
> Second batch (capability-parity continuation): T10 FR-HIS history
> drawer + context chips + compaction controls; T11 FR-IMG-005..009
> inference/chooser/batch-confirm (dialogs extracted as shared components,
> V2 rewired); T12 FR-INT-003 trusted navigation; T13 FR-INT-004/005
> reasoning preference + agent-task dialog; T14 FR-REC retry/recovery
> detail. Remaining backlog: the AD-001..004 all-sends pending bridge
> (separate backend migration by design §19), default-route E2E
> certification, soak/accessibility/security reviews (require packaged
> environments and human sign-off).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the P0 (plus high-value P1) capability gaps that keep `/aiworkspace` from being the complete default chat surface: submission-context parity, slash/goal/loop/skill command routing, plan decision continuation, skill-installation cards, managed-browser panels, and report/image action forwarding.

**Architecture:** The workspace center surface (`AiChatCenterSurface.vue`) becomes the composition root that reuses Chat V2's shared components and APIs. New renderer-safe composables under `src/views/composables/aiChatWorkspace/` own command routing; the workspace IPC schema + coordinator are widened (additive fields only) to carry the same submission context the V2 pending-queue path already accepts. No queue-ownership migration in this plan (PRD §3.4 explicitly allows renderer-first independent fixes).

**Tech Stack:** TypeScript 5, Vue 3 `<script setup>`, Pinia, Zod v4 schemas, Vitest + @vue/test-utils. Six-language i18n (`src/views/lang/{en,zh,es,fr,de,ja}.ts`).

**Working location:** git worktree `.worktrees/workspace-parity`, branch `workspace-v2-capability-parity` (branched from `dev` @ c37d428b).

**Reference docs:** PRD `docs/prd/ai-chat-workspace-v2-capability-parity-prd.md` (baseline matrix §3.3), technical design `docs/prd/ai-chat-workspace-v2-capability-parity-technical-design.md` (§6, §7, §12).

## Explicitly deferred (documented, not silently dropped)

Per PRD §3.4 (“Queue unification is an incremental backend migration; it must not block independent renderer fixes”) and the design’s phased rollout:

- **AD-001..004 all-sends pending bridge / run-dispatch bridge** — separate backend migration; existing coordinator busy-delegation stays.
- **FR-HIS recoverable-history drawer + context chips** — needs `workspaceStreamPresenter` start-ack routing design work; transport fields are added here (Task 1) so the later renderer work is additive.
- **FR-VOI/FR-WSP/FR-INT-001 regression certification, E2E suites, soak** — require packaged-app environments.
- **Chat V2 refactor to consume the new composables** — V2 remains the frozen rollback surface; its behavior is the contract the composable implements.

## Task inventory

| # | Capability | PRD refs |
|---|---|---|
| 1 | Submission context parity (`pastedContents`, `confirmedGeneratedImageBatch`, `historySelectionIds`, `submissionId`) | FR-SUB-004/005, FR-IMG-004, FR-HIS-002 transport |
| 2 | Command routing composable (`/goal`, `/loop`, `/skill`, generic slash) | FR-CMD-001..009, FR-SKL-005 |
| 3 | Wire command routing into the workspace center + scheduled-loop approval dialog | FR-CMD-007, FR-CMD-009 |
| 4 | Plan decision validation + exactly-one continuation | FR-PLN-003..008 |
| 5 | Permission `persistent` characterization + cleanup | FR-PER-003/005 |
| 6 | Skill-installation transcript classification | FR-SKL-001..004 |
| 7 | Managed-browser panels in the center | FR-BRW-001..006 |
| 8 | Report / save-image / stop-batch / retry-batch action forwarding | FR-RPT-001/002/009, FR-IMG-011/013 |
| 9 | Composer `request-workspace` wiring | FR-INT-002, FR-WSP-003 |

---

### Task 1: Submission context parity through the workspace chain

**Files:**
- Modify: `src/schemas/ipc/aiChatWorkspace.ts` (widen `startChatRunRequestSchema`)
- Modify: `src/service/AIChatCoordinator.ts` (`buildEngineRequest`, busy-submit delegation)
- Modify: `src/main-process/communication/ai-chat-workspace-ipc.ts` (busySubmit forwarding)
- Modify: `src/views/store/selectedConversation.ts` (`SendOptions`)
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` (`onComposerSend`)
- Test: `test/vitest/main/aiChatWorkspaceCoordinator.test.ts` (extend), `test/vitest/main/components/AiChatCenterSurface.test.ts` (extend)

The pending-queue schema (`src/schemas/ipc/aiChatPendingMessage.ts` `streamRequestSchema`) already accepts `pastedContents` and `confirmedGeneratedImageBatch` — reuse the same shapes so both surfaces call one contract.

- [x] **Step 1.1: Failing schema test** — add to the workspace schema test (or coordinator test) a case asserting `startChatRunRequestSchema.safeParse` accepts `pastedContents: { "p1": "body" }`, `historySelectionIds: ["src-1"]`, `submissionId: "<uuid>"`, and `confirmedGeneratedImageBatch: { references: [...] }`, and that unknown keys still fail. Run: `npx vitest --config vite.main.config.mjs run <file>` — expect FAIL (fields rejected).
- [x] **Step 1.2: Widen the schema** — in `startChatRunRequestSchema`, import `aiChatV2PastedContentsSchema` from `@/schemas/aiChatV2PastedText` and add:
  ```ts
  pastedContents: aiChatV2PastedContentsSchema.optional(),
  historySelectionIds: z.array(z.string().min(1).max(100)).max(20).optional(),
  submissionId: z.string().min(8).max(64).optional(),
  confirmedGeneratedImageBatch: z
    .strictObject({
      references: z
        .array(z.strictObject({ messageId: z.string().min(1).max(100), imageIndex: z.number().int().min(0) }))
        .min(1)
        .max(50),
    })
    .optional(),
  ```
  Run test — expect PASS.
- [x] **Step 1.3: Failing coordinator test** — assert `AIChatCoordinator.startRun` idle path passes `pastedContents` into the engine request (spy on `submitPersistedUserMessage`/engine sink) and busy path forwards them into the queue `submit` call. Expect FAIL (`buildEngineRequest` and `busySubmit` drop them).
- [x] **Step 1.4: Forward through `buildEngineRequest`** — add the four fields to the returned `ChatV2StreamRequest` object; forward the same fields in the `busySubmit` delegation object in `ai-chat-workspace-ipc.ts`. Run coordinator test — expect PASS.
- [x] **Step 1.5: Store + surface** — extend `SendOptions` in `selectedConversation.ts` with `pastedContents?: Record<string, string>`, `historySelectionIds?: string[]`, `submissionId?: string`, `confirmedBatchReferences?: ChatV2GeneratedImageReference[]` (mapped to `confirmedGeneratedImageBatch` in `startChatRun`), pass through. In `AiChatCenterSurface.onComposerSend`, delete the `void options?.pastedContents;` line and pass `pastedContents: options?.pastedContents` into `sendMessage`. Component test: send with pasted contents → `startChatRun` mock receives them; rejected send still calls `onAccepted` never.
- [x] **Step 1.6: Commit** — `feat: forward pasted content, history refs, and confirmed image batches through the workspace submission chain`

### Task 2: Shared command-routing composable

**Files:**
- Create: `src/views/composables/aiChatWorkspace/useChatCommandRouting.ts`
- Test: `test/vitest/utilitycode/useChatCommandRouting.test.ts` (pure logic — no component mount)

Extract the decision logic from `AiChatV2.vue` `onSend` (lines ~4417–4584) into a typed, renderer-safe composable with injected ports (no Pinia dependencies — the caller supplies closures). Disposition model (design §7):

```ts
export type ChatCommandDisposition =
  | { readonly kind: "not_command" }
  | { readonly kind: "completed" }                                     // command handled; draft clears
  | { readonly kind: "submit_prompt"; readonly prompt: string; readonly mode: "chat" | "plan" }
  | { readonly kind: "rejected"; readonly code: string; readonly message: string };
```

Ports interface (caller-owned):
```ts
export interface ChatCommandRoutingPorts {
  readonly isBusy: () => boolean;
  readonly ensureConversationId: () => Promise<string | null>;  // creates chat when empty
  readonly activeGoal: () => { goalId: string } | null;
  readonly appendLocalExchange: (userText: string, assistantText: string) => void;
  readonly setError: (message: string | null) => void;
  readonly translate: (key: string, fallback: string, vars?: Record<string, unknown>) => string;
  readonly createGoal: (input: { conversationId: string; objective: string; replace: boolean })
    => Promise<{ planPrompt: string } | null>;
  readonly startGoalLoop: (input: { conversationId: string; goalId: string; maxIterations: number })
    => Promise<boolean>;
  readonly invokePromptSkill: (input: { conversationId: string; skill: string; arguments?: string })
    => Promise<boolean>;
  readonly createScheduledLoop: (input: { /* mirror aiChatScheduledLoop.createScheduledLoop */ })
    => Promise<{ conversationId: string } | null>;
  readonly controlScheduledLoop: (conversationId: string, op: "pause" | "resume" | "stop")
    => Promise<boolean>;
  readonly getScheduledLoopStatus: (conversationId: string) => Promise<unknown>;
  readonly dispatchSlashCommand: (input: { conversationId: string; rawInput: string })
    => Promise<{ status: boolean; msg: string; action?: string; prompt?: string; commandId?: string; content?: string }>;
  readonly onSlashPromptExpand: (prompt: string, pastedContents?: Record<string, string>) => Promise<void>;
  readonly onClearConversation: () => Promise<void>;
}
```

`routeCommand(text, options)` ordering (mirror V2 exactly):
1. `parseAiLoopCommand(text)` — goal_loop / scheduled_loop / scheduled_loop_control / invalid_loop handled before busy-guard for staging-only paths; command-like input while busy → `rejected` with clear message (FR-SUB-009).
2. `parseAiGoalCommand(text)` — `/goal <objective>` → `createGoal(replace: true)` → on success `submit_prompt` with `mode: "plan"` + planPrompt; failures → local exchange + error.
3. `parseSkillSlashCommand(text)` — `skill_invoke` → `invokePromptSkill`; null ack → `rejected` (never model fallback, FR-SKL-005); ack → `submit_prompt` with task text (`SKILL_SLASH_DEFAULT_TASK` when empty).
4. Generic `/` prefix, no files, `cmd.type === "none"` → `dispatchSlashCommand`: `submit_prompt` action → `onSlashPromptExpand(prompt, pastedContents)` then `completed`; `built-in:command:clear` → `onClearConversation`; failure/status=false → local exchange.
5. Otherwise → `not_command`.

- [x] **Step 2.1: Write failing unit tests** covering: `/goal` happy path returns plan-mode prompt; `/goal` without objective rejected; goal create failure → local exchange; `/loop 3` with active goal → startGoalLoop called; `/loop` without goal → local exchange; scheduled-loop control ops; `/skill` ack-failure rejected + no fallback; `/skill` success → task prompt; generic slash `submit_prompt` expansion called exactly once and NOT re-dispatched (expand flag); `not_command` for plain text; busy-guard for command-like input. Run — expect FAIL (module missing).
- [x] **Step 2.2: Implement the composable** reusing V2's parsers (`parseAiLoopCommand`, `parseAiGoalCommand`, `parseSkillSlashCommand`, `isValidLoopCount`, `SKILL_SLASH_DEFAULT_TASK`) via import — no logic duplication. Run — expect PASS.
- [x] **Step 2.3: Commit** — `feat: extract shared chat command routing composable from Chat V2`

### Task 3: Wire command routing into the workspace center

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue`
- Modify: `src/views/store/selectedConversation.ts` (add `appendLocalExchange`)
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts` (extend)

- [x] **Step 3.1: Store local-exchange action** — add to the selected-conversation store:
  ```ts
  function appendLocalExchange(userText: string, assistantText: string): void {
    const conversationId = workspaceStore.selectedConversationId;
    if (!conversationId) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    presenter.appendLocalUserMessage({ id: `local-command-user-${suffix}`, conversationId, role: "user", content: userText, timestamp: new Date().toISOString(), messageType: MessageType.MESSAGE });
    presenter.appendLocalUserMessage({ id: `local-command-assistant-${suffix}`, conversationId, role: "assistant", content: assistantText, timestamp: new Date().toISOString(), messageType: MessageType.MESSAGE, metadata: { source: "slash-command" } });
    syncFromPresenter();
  }
  ```
  (non-persisted rows — same lifetime contract as V2's `appendLocalCommandExchange`).
- [x] **Step 3.2: Composable instantiation in center** — build ports from existing center APIs (`onNewChat` for ensure, `selectedStore.goal`, `createGoal`/`startGoalLoop`/`stopGoalLoop`, `invokePromptSkill`, `createScheduledLoop`/`controlScheduledLoop`/`getScheduledLoopStatus`, `dispatchSlashCommand` from `@/views/api/slashCommands`, `clearChatV2Conversation` + reload). `onComposerSend` first calls `routeCommand`; `submit_prompt` → continue ordinary path with `mode` override and `isExpandedPrompt` semantics; `completed`/`rejected` → return early (draft clearing only for `completed` — the caller invokes `onAccepted` itself on that path only when the underlying submit accepts; for local-only commands call `options?.onAccepted?.()` immediately, mirroring V2).
- [x] **Step 3.3: Mount `ScheduledLoopToolApprovalDialog`** — copy V2's staged-approval flow (`pendingScheduledLoop` + confirm/cancel handlers at V2 lines ~2984–3010).
- [x] **Step 3.4: Component tests** — `/review` slash routes to `dispatchSlashCommand` mock, raw text never reaches `startChatRun`; `/goal` plan send carries `mode: "plan"`; `/skill` failure keeps draft (onAccepted not called) and shows localized error; scheduled-loop command opens approval dialog before `createScheduledLoop`. Run — expect PASS after wiring.
- [x] **Step 3.5: Commit** — `feat: route slash, goal, loop, and skill commands in the workspace center`

### Task 4: Plan decision validation + continuation

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` (`onLegacyPlanAction`, `onRequestPlanChangesWithFeedback`)
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts` (extend)

Replace the fire-and-forget `try/catch` with V2's validated sequence (`handleApprovePlan` V2 lines 4140–4252):

- [x] **Step 4.1: Failing tests** — approve with mock returning `null` → NO continuation send, `planSubmitError` set to localized `aiChatV2Plan.approve_failed` fallback, card stays actionable; approve with updated state → exactly ONE `sendMessage` continuation (`aiChatV2Plan.approved_continue_message`), store history reloaded; reject/request-changes mirror with their keys; in-flight guard: second click while first `approveChatV2Plan` promise pending issues no second IPC (track with deferred mock).
- [x] **Step 4.2: Implement** — `const decisionInFlight = ref(false)`; every decision path: guard busy + in-flight → `const updated = await approveChatV2Plan(...)` (the API already returns updated state or null — check `src/views/api/aiChatV2.ts` return type; if it returns `CommonMessage` unwrap `.data`) → falsy → error + return → truthy → reload selection (`await selectedStore.loadSelection(conversationId)` to surface the receipt/planStateView) → single `selectedStore.sendMessage(continueText, { mode: "chat" })`. Reuse V2's i18n keys (`aiChatV2Plan.*` — already translated in all six languages).
- [x] **Step 4.3: Run tests → PASS. Commit** — `fix: validate plan decisions and start exactly one continuation in workspace`

### Task 5: Permission persistent-grant characterization

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` (`onGrantPermission` comment/typing only if needed)
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts` (extend)

Design §12.2 finding: `SkillApprovalCard` itself persists the grant via the `skill:grant-permission` IPC *before* emitting `grant`; the parent's job is resume-only. The workspace's `void payload.persistent` is therefore not a lost grant — but it is misleading and untested.

- [x] **Step 5.1: Tests** — (a) grant-once: card emit `grant {persistent:false}` → `AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION` invoked once with `{toolId, conversationId}`; (b) persistent: emit `grant {persistent:true}` → resume still invoked once AND the card's own `skill:grant-permission` persist call is asserted in the existing `SkillApprovalCard` tests (reference, not re-test); (c) resume failure → row shows localized `permission_resume_failed` fallback and a retry click re-invokes. Run — if (c) fails because the store clears in-flight guard incorrectly, fix the store; otherwise PASS.
- [x] **Step 5.2: Replace the misleading discard** — change `onGrantPermission` to accept and document (not forward — resume IPC takes toolId+conversationId only, and persistence already happened in-card):
  ```ts
  function onGrantPermission(message: ChatV2MessageView, payload: { persistent: boolean }): void {
    // The shared SkillApprovalCard has ALREADY persisted the choice through
    // the `skill:grant-permission` IPC before emitting; the surface's only
    // job is resuming the parked tool (persistent is informational here).
    selectedStore.grantToolPermission(message, permissionTexts.value).catch(() => undefined);
  }
  ```
- [x] **Step 5.3: Commit** — `test: characterize permission grant persistence vs resume in workspace`

### Task 6: Skill-installation transcript classification

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue`
- Test: `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts` (extend)

`AiChatV2Message` already mounts `SkillInstallCard` for tool results whose `toolName` starts with `skill_install_` **and** whose `toolResult.sessionId` is a string. The workspace transcript currently collapses those into generic execution receipts (FR-SKL-001 violation).

- [x] **Step 6.1: Failing test** — feed a TOOL_RESULT message with `metadata.toolName = "skill_install_status"` and `metadata.toolResult = { sessionId: "sess-1", state: "awaiting_approval", ... }`; assert the rendered output contains the install card (stub `SkillInstallCard` with a marker, or assert the dedicated transcript item kind) and that it renders OUTSIDE a collapsed generic group; historical (persisted) and live shapes both classify.
- [x] **Step 6.2: Implement** — add `isSkillInstallResult(message)` helper next to `isPermissionPrompt` (same predicate as `AiChatV2Message.isSkillInstallResult`); in the group-walk, emit `{ kind: "skill-install", key: "skill-install-<id>", message }` items rendered through `<AiChatV2Message :message="..." />` (which mounts the card with `conversationId` and the `updated` handler) at the same positions permission prompts surface — both inside the consecutive-tool skip loop and for unpaired rows.
- [x] **Step 6.3: Run → PASS. Commit** — `feat: surface skill installation cards as interactive transcript items in workspace`

### Task 7: Managed-browser panels in the center

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue`
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts` (extend)

Both panels are self-contained (no props; they subscribe via `@/views/api/managedBrowser`).

- [x] **Step 7.1: Failing test** — with a conversation selected, the center renders `ManagedBrowserStartPanel` and `ManagedBrowserSessionCard` (stub both, assert mounted; FR-BRW-005: they must NOT live inside the inspector — assert presence while `workspaceStore.inspectorOpen === false`). Mock the managedBrowser API module to no-op subscriptions.
- [x] **Step 7.2: Implement** — mount inside a compact region between the run strip and the messages area, `v-if="conversationId"`, `data-testid="workspace-browser-region"`; panels keep their own lifecycle (route unmount removes listeners only — the panels already scope their subscriptions; sessions survive route changes by design).
- [x] **Step 7.3: Run → PASS. Commit** — `feat: compose managed-browser start and session panels in workspace center`

### Task 8: Report / save-image / stop-batch / retry-batch forwarding

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue` (forward `report`, `save-generated-image`, `stop-batch`, `retry-generated-image-batch` from `AiChatV2Message`)
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` (handlers + single-output report dialog + reported set + save flow)
- Test: both component test files (extend)

- [x] **Step 8.1: Failing tests** — (a) reportable assistant message's `report` event reaches center → `AIContentReportDialog` opens with the descriptor, `submitted` marks the message reported (session set, tile shows reported state); conversation switch closes the dialog (existing conversation-report watcher pattern extended); (b) `save-generated-image` → `exportGeneratedImage` called with `{conversationId, reference}`; `workspace_required` result surfaces the workspace-setup flow (existing `onRequestWorkspaceSetup`); (c) `stop-batch` → `selectedStore.stopActiveRun()`; (d) `retry-generated-image-batch` → one `sendMessage` with `confirmedBatchReferences` set (Task 1 field) and original instruction.
- [x] **Step 8.2: Transcript forwarding** — add emits + `@report`, `@save-generated-image`, `@stop-batch`, `@retry-generated-image-batch` on every `AiChatV2Message` mount in the transcript (user/assistant/permission/skill-install items); pass `:reported="reportedMessageIds.has(message.id)"` on assistant mounts.
- [x] **Step 8.3: Center handlers** — `reportedMessageIds = ref(new Set<string>())`; `activeSingleDescriptor` + dialog (import `AIContentReportDialog` from `@/views/components/aiContentReport`); save handler mirrors V2's `attemptGeneratedImageExport` (toast = existing `generatedImageNotice` strip, i18n keys `aiChatV2.artifactExport.*` already translated); retry handler: `selectedStore.sendMessage(instruction, { confirmedBatchReferences: references })`.
- [x] **Step 8.4: Run → PASS. Commit** — `feat: forward report, image save, stop-batch, and retry-batch actions through workspace transcript`

### Task 9: Composer `request-workspace` wiring

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue`
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts` (extend)

- [x] **Step 9.1: Failing test** — composer emits `request-workspace` (filesystem tool needs a workspace) → `conversationWorkspace.requestSetup()` runs (assert `WorkspaceRequiredCard` becomes visible with a conversation selected).
- [x] **Step 9.2: Implement** — add `@request-workspace="onRequestWorkspaceSetup"` to the `AiChatV2Composer` mount (the handler + FR-WS-007 busy gate already exist at center lines 558–564).
- [x] **Step 9.3: Run → PASS. Commit** — `feat: wire composer workspace requests to the workspace setup flow`

---

## Verification gates (run in the worktree, all must pass before finishing)

```bash
yarn typecheck            # one-shot tsc (memory: watch-mode trap — use npx tsc --noEmit -p tsconfig.json if script hangs)
yarn vue-typecheck        # vue-tsc one-shot equivalent
yarn test:components      # hard component gate
yarn testmain             # main-process suites (coordinator/store tests)
```

i18n: Tasks 2–4 reuse existing `aiChatV2.*` / `aiChatV2Plan.*` / `aiChatV2.goalLoop.*` / `aiChatV2.scheduledLoop.*` keys (already present in all six languages). Any NEW user-facing key added during implementation MUST be added to all six of `src/views/lang/{en,zh,es,fr,de,ja}.ts` in the same commit.

Commits: one per task (conventional `feat:`/`fix:`/`test:`), never `--no-verify`; pre-commit husky runs eslint + the vitest tsc gate — fix reported errors, never bypass.
