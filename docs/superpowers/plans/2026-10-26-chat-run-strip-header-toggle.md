# Replace Chat Run-Strip Bar with Header Sidebar Toggle + Header Status Chips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the run-strip bar from the workspace chat; keep its goal/loop status as chips beside the header title; move the inspector (sidebar) toggle to the right of the "..." menu; the composer Stop becomes the ONE primary stop (goal → loop → run).

**Architecture:** `AiChatConversationHeader.vue` gains two display-only props (`goalObjective`, `loopStatus`) rendered as text chips after the title, and its inspector-toggle `<button>` moves one slot to the right of the overflow menu. `AiChatCenterSurface.vue` drops the `<AiChatRunStrip>` mount and points the composer's `@stop` at the primary-stop handler (currently on the strip) so goal/loop stop precedence survives; `AiChatRunStrip.vue` is deleted.

**Tech Stack:** Vue 3 SFC + vue-i18n (existing keys), Pinia, Vitest + @vue/test-utils, Playwright (e2e, unchanged).

**Spec:** `docs/superpowers/specs/2026-10-26-chat-run-strip-to-header-toggle-design.md`

## Global Constraints

- No `any` types; explicit return types on functions (repo TypeScript rules).
- Reuse existing i18n keys only — `workspaceChat.runStrip.goal|loopRunning|loopPaused` already exist in en/zh/es/fr/de/ja; no new keys, no translations touched.
- UI change and its tests land in the same commit (repo rule); `yarn test:components` is a hard gate.
- Auto-commit each completed unit of work; conventional commit types (`refactor`, `test`).
- Do NOT run `yarn package`/`yarn make` locally (environment-blocked per repo rules).

## Review Focus

1. **Composer Stop during an active goal loop** — must call the goal-stop IPC, not silently only the run. Pinned: Task 2 Step 3 (rewritten rollback-precedence test via composer `$emit("stop")`).
2. **Adapter OFF (`sharedOrchestration: false`)** — header receives `null/null`; no stale goal/loop chips. State also reconciles to `null` after `seedGoal(null)`. Pinned: Task 2 Step 3 (adapter-off test rewrite).
3. **Sidebar toggle reachable with NO conversation selected and with one selected** — always rendered at its new position. Pinned: Task 1 Step 1 (toggle-after-overflow + no-conversation tests).
4. **Idle runtime without goal/loop** — no chips render at all. Pinned: Task 1 Step 1 (chips-absent test).
5. **Composer Stop still cancels spoken output** — untouched behavior after re-wiring to the primary handler. Already pinned: existing test "cancels the voice job when the COMPOSER Stop fires (audit B06)" (`AiChatCenterSurface.test.ts:5611`) must keep passing.

---

### Task 1: Header — status chips + sidebar toggle repositioning

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatConversationHeader.vue`
- Test: `test/vitest/main/components/AiChatConversationHeader.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 relies on these): props `goalObjective?: string | null` and `loopStatus?: string | null`; testids `workspace-header-goal`, `workspace-header-loop`; inspector toggle keeps testid `workspace-inspector-toggle` but renders AFTER the overflow menu (`workspace-header-overflow`) inside `.header-actions`.

- [ ] **Step 1: Write the failing tests in `AiChatConversationHeader.test.ts`**

Extend the existing `mountHeader` so extra header props and the needed i18n can be supplied (keep the callsite backward compatible):

```ts
function mountHeader(
  runtimeStatus: ConversationRuntimeStatus,
  extra: Partial<{
    goalObjective: string | null;
    loopStatus: string | null;
    hasConversation: boolean;
  }> = {}
) {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        workspaceChat: {
          header: { backgroundAgents: "Background Agents" },
          runStrip: {
            goal: "Goal: {objective}",
            loopRunning: "Scheduled loop running",
            loopPaused: "Scheduled loop paused",
          },
        },
      },
    },
  });
  return mount(AiChatConversationHeader, {
    props: {
      title: "Test",
      runtimeStatus,
      recovering: false,
      activeToolCount: 0,
      inspectorOpen: false,
      hasConversation: true,
      ...extra,
    },
    /* stubs unchanged */
  });
}
```

New tests (new `describe("AiChatConversationHeader goal/loop chips + sidebar toggle placement")`):

- goal chip: `mountHeader("running", { goalObjective: "Ship the parity suite" })` → `[data-testid="workspace-header-goal"]` exists, its text is `Goal: Ship the parity suite`, and the node is a `<span>` (`wrapper.find(...).element.tagName`).toBe(`"SPAN"`) with no `button` role — because it is NOT clickable.
- loop chip running: `mountHeader("running", { loopStatus: "running" })` → `[data-testid="workspace-header-loop"]` text `Scheduled loop running`.
- loop chip paused: `mountHeader("queue", { loopStatus: "paused" })` → text `Scheduled loop paused`.
- unknown loop value passes through: `loopStatus: "draining"` → text `draining`.
- chips absent when props omitted: default `mountHeader("running")` → both testids absent.
- placement: default `mountHeader("idle")` → chip `<span />`... assert order: `find('[data-testid="conversation-header"] [data-testid="workspace-header-overflow"]')` and `[data-testid="workspace-inspector-toggle"]` select the last two children of `.header-actions` in DOM order — index check: the overflow node's next element sibling is the inspector toggle:
```ts
const overflow = wrapper.get('[data-testid="workspace-header-overflow"]');
expect(
  overflow.element.nextElementSibling?.matches('[data-testid="workspace-inspector-toggle"]')
).toBe(true);
```
- always shown: `mountHeader("idle", { hasConversation: false })` → toggle still exists.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatConversationHeader.test.ts`
Expected: FAIL (unknown prop ignored → chips missing tests hierarchical: goal/loop tests FAIL; the "chips absent" test PASSES trivially; the placement test FAILS because the toggle currently sits BEFORE the overflow).

- [ ] **Step 3: Implement in `AiChatConversationHeader.vue`**

1. Props block: add `goalObjective?: string | null;` and `loopStatus?: string | null;` to `defineProps<{ ... }>`.
2. Template: after the `<h1 class="header-title">` element, insert:

```html
<span
  v-if="goalObjective"
  class="header-chip"
  data-testid="workspace-header-goal"
>{{ t('workspaceChat.runStrip.goal', { objective: goalObjective }) || `Goal: ${goalObjective}` }}</span>
<span
  v-if="loopLabel"
  class="header-chip"
  data-testid="workspace-header-loop"
>{{ loopLabel }}</span>
```

3. Script: move/copy the loop-label mapping from the deleted strip — local computed:

```ts
const loopLabel = computed(() => {
  if (!props.loopStatus) return "";
  const map: Record<string, { key: string; fallback: string }> = {
    running: { key: "workspaceChat.runStrip.loopRunning", fallback: "Scheduled loop running" },
    paused: { key: "workspaceChat.runStrip.loopPaused", fallback: "Scheduled loop paused" },
  };
  const entry = map[props.loopStatus];
  return entry ? t(entry.key) || entry.fallback : props.loopStatus;
});
```

4. Template: move the `<v-tooltip>` `/ inspector toggle <button>` block (currently the first child of `.header-actions`) to AFTER `</v-menu>` — last child of `.header-actions`.
5. Style: add `.header-chip` (bordered pill, 11.5–12px, muted like `.header-status` but non-interactive: no `hover` rule, no `cursor: pointer`). Reuse the `.header-status` visual language minus interaction.

- [ ] **Step 4: Run header tests to verify they pass**

Run: `npx vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatConversationHeader.test.ts`
Expected: PASS (existing B03 describe included).

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatWorkspace/AiChatConversationHeader.vue test/vitest/main/components/AiChatConversationHeader.test.ts
git commit -m "feat: header chips for goal/loop state and sidebar toggle right of overflow menu"
```

---

### Task 2: Surface — drop the strip, rewire props and the ONE primary stop

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue`
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts`

**Interfaces:**
- Consumes: Task 1's header props (chips + testids) and testids.
- Produces: composer `@stop` handler named `onPrimaryStop` (goal → loop → run precedence, cancels speech first); `stopActiveRunWithSpeech` remains for the image batch stop only.

- [ ] **Step 1: Write the failing test changes in `AiChatCenterSurface.test.ts`**

1. Stub list: delete the `AiChatRunStrip: true,` stub line (currently ~line 368).
2. Extend `HeaderStub` props array (it must carry the new props for `.props()` assertions):
```ts
props: ["title", "hasConversation", "inspectorOpen", "goalObjective", "loopStatus", "runtimeStatus", "recovering", "activeToolCount"],
```
3. In the `describe("AiChatCenterSurface shared-orchestration rollback (audit R2 G02)")`:
   - Rename test `"renders goal/loop orchestration state in the strip by default (%#)"` → `"renders goal/loop orchestration state in the header by default (%#)"`; replace `findComponent({ name: "AiChatRunStrip" })` assertions with `findComponent({ name: "AiChatConversationHeader" })` asserting `.props("goalObjective")` → `"Ship the parity suite"`.
   - Test `"adapter off hides the goal/loop state while runtime status remains"`: keep the seeding; replace strip assertions with: `header.props("goalObjective")` is `null`, `header.props("loopStatus")` is `null`, and after `seedGoal(null)` still `null`.
   - Test `"rollback keeps command interception + durable stop precedence intact"`: replace
     `wrapper.findComponent({ name: "AiChatRunStrip" }).vm.$emit("stop")` with
     `wrapper.findComponent({ name: "AiChatV2Composer" }).vm.$emit("stop")`
     (same pattern as the existing B06 test at ~line 5619). The goal-stop IPC assertion below it is UNCHANGED — this pins the precedence migration to the composer.
4. Delete the now-impossible test `"cancels the voice job when the run strip Stop fires"` (lines ~5631–5644) — the composer voice-cancel coverage remains in `"cancels the voice job when the COMPOSER Stop fires (audit B06)"`.

- [ ] **Step 2: Run the modified suite to verify the new assertions fail for the right reason**

Run: `npx vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatCenterSurface.test.ts --reporter=dot`
Expected: FAIL on (a) header `goalObjective` prop (still `undefined` on the surface), (b) composer-stop precedence test (goal IPC not called — composer currently only stops the run), and possibly noise from the removed stub. Chips-absent and voice-cancel composer test must pass already.

- [ ] **Step 3: Implement in `AiChatCenterSurface.vue`**

1. Template: delete the `<AiChatRunStrip ... />` element (lines ~21–30) including the follow-up comment block about the strip (lines ~32–34 keep: the recovery-detail comment references "the run strip keeps the high-level state" — reword to "the header status keeps the high-level state").
2. Header element: pass the orchestration state through:
   `:goal-objective="sharedOrchestrationEnabled ? activeGoalObjective : null"` and
   `:loop-status="sharedOrchestrationEnabled ? activeLoopStatus : null"`
3. Composer binding: change `@stop="stopActiveRunWithSpeech"` → `@stop="onPrimaryStop"`.
4. Script: delete the `AiChatRunStrip` import; rename `onStopFromStrip` → `onPrimaryStop` (body unchanged: resetSpeechFeed, voice.stopSpeaking, goal → loop → run) and update its doc comment to say the composer Stop is the single primary stop affordance (PRD §13); update the `stopActiveRunWithSpeech` doc comment ("The run strip's handler keeps the goal/loop precedence below…" — now the handler IS the shared primary stop; the batch stop still uses it directly).

- [ ] **Step 4: Run the surface suite to verify it passes**

Run: `npx vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatCenterSurface.test.ts`
Expected: PASS (including the existing B06 composer voice test from Review Focus #5).

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatWorkspace/AiChatCenterSurface.vue test/vitest/main/components/AiChatCenterSurface.test.ts
git commit -m "refactor: composer stop becomes the single primary stop; header owns goal/loop chips"
```

---

### Task 3: Delete the dead strip component + prune its a11y tests

**Files:**
- Delete: `src/views/components/aiChatWorkspace/AiChatRunStrip.vue`
- Test: `test/vitest/main/components/aiChatWorkspace.a11y.test.ts`

**Interfaces:**
- Consumes: nothing (file is now unreferenced by source — verify with grep before deleting).
- Produces: a11y suite no longer mounts the strip.

- [ ] **Step 1: Verify no remaining references**

Run: `grep -rn "AiChatRunStrip" src/ test/`
Expected: only `aiChatWorkspace.a11y.test.ts` matches (import, the two describes). If any `src/` match exists, STOP and fix first.

- [ ] **Step 2: Prune `aiChatWorkspace.a11y.test.ts`**

- Delete the `AiChatRunStrip` import (line 6).
- Trim the type import (lines ~10–13) to only `ConversationRuntimeStatus` if still used after the deletions below — after removing the `states` array it becomes unused, so remove `ChatRunStatus` and `ConversationRuntimeStatus` from it entirely.
- Delete the `for (const runtimeStatus of states) { ... }` strip block and the `states` array (~168–175, only used by that block).
- Delete the whole `describe("A11Y-007 repository minimum sizing on run-strip actions", ...)` block (~212–233).
- Update the file-header doc comment (lines ~15–36): drop the run-strip bullets (A11Y-001/002 strip wording, A11Y-003 strip actions, A11Y-007) — keep A11Y-010 rationale and the WorkspaceStatusIndicator battery (it stays and still certifies the named status indicator).
- Leave the `runStrip` i18n messages block at the top (harmless; the header chip tests in the OTHER file carry their own messages).

- [ ] **Step 3: Delete the component**

```bash
rm src/views/components/aiChatWorkspace/AiChatRunStrip.vue
```

- [ ] **Step 4: Run the a11y suite to verify it passes**

Run: `npx vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/aiChatWorkspace.a11y.test.ts`
Expected: PASS (A11Y-010 + status-indicator describes only).

- [ ] **Step 5: Commit**

```bash
git add -A src/views/components/aiChatWorkspace/AiChatRunStrip.vue test/vitest/main/components/aiChatWorkspace.a11y.test.ts
git commit -m "refactor: delete the run strip component and prune its a11y tests"
```

---

### Task 4: Whole-feature verification (test and confirm)

**Files:** none modified expected; fix-forward if anything surfaces.

- [ ] **Step 1: Full component suite**

Run: `yarn test:components`
Expected: all files pass, 0 failures (this is the repo's hard gate).

- [ ] **Step 2: Type checks**

Run: `yarn typecheck`
Expected: exits clean.

- [ ] **Step 3: Targeted e2e (best effort)**

Run: `AIFETCHLY_MB_E2E=1 xvfb-run -a -s "-screen 0 1920x1080x24" npx playwright test test/e2e/specs/workspaceRolloutDrill.test.ts` (uses `workspace-inspector-toggle` by testid — reposition must not affect it)
Expected: green. If the environment lacks Electron/Chrome deps, record the failure as environment-blocked evidence instead of pushing through.

- [ ] **Step 4: Report to the user**

Summarize: bar gone; chips beside title (goal/loop); toggle right of "..." always visible; composer send button = the Stop (goal → loop → run); tests + typecheck results.

- [ ] **Step 5: Commit anything outstanding (fix-forward only)**

```bash
git status --porcelain   # confirm clean; if a fix was needed:
git add -A && git commit -m "fix: <what surfaced during verification>"
```
