# Chat UI Remote Working Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace premature empty AI response bubbles and "Generating…" text with a clean, persistent loading/working indicator in the bottom-left of the chat transcript whenever the remote AI is working.

**Architecture:** Suppress empty assistant placeholder messages from the transcript projections until actual text, reasoning, or tool outputs arrive. Render a dedicated animated loading/working indicator (`.workspace-transcript__working` / `.v2-messages__working`) at the bottom-left of the message list whenever `isRemoteWorking` is true (runtimeStatus running or streamStatus streaming). Remove the "Generating…" text from the streaming bubble state so assistant bubbles only contain clean response content.

**Tech Stack:** Vue 3, TypeScript, Pinia, Vuetify 3, Vitest, @vue/test-utils.

**Spec:** [docs/superpowers/specs/2026-11-14-chat-remote-working-indicator-design.md](file:///home/robertzeng/project/aiFetchly/docs/superpowers/specs/2026-11-14-chat-remote-working-indicator-design.md)

## Global Constraints

- Never use `any` type — use proper types or `unknown` instead.
- All UI text must be internationalized across all 6 supported languages (`en`, `zh`, `es`, `fr`, `de`, `ja`).
- UI changes require UI tests (`yarn test:components`).
- Auto-commit changes after completing each task using conventional commits.
- Forbidden locally: `yarn package` / `yarn make`.

## Review Focus

1. **Empty assistant message arrives on start event:** The transcript must NOT render an empty bubble with header and blank body while waiting for tokens.
2. **First token arrives:** The assistant bubble must appear immediately as soon as non-empty content or reasoning arrives.
3. **Multi-round tool execution:** When the model calls a tool and executes it before generating the final text response, the loading/working indicator must stay visible between rounds while remote is running.
4. **Terminal states (idle, error, cancelled):** The loading/working indicator must cleanly hide when the turn completes, errors, or is cancelled.
5. **No duplicate "Generating…" copy:** The assistant bubble itself must not render "Generating…" text beneath its content while tokens stream.

---

### Task 1: Internationalization Keys for Working State

**Files:**
- Modify: `src/views/lang/en.ts`
- Modify: `src/views/lang/zh.ts`
- Modify: `src/views/lang/es.ts`
- Modify: `src/views/lang/fr.ts`
- Modify: `src/views/lang/de.ts`
- Modify: `src/views/lang/ja.ts`
- Test: `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`

**Interfaces:**
- Consumes: None
- Produces: `aiChatV2.ai_working` translation string in all 6 language dictionaries

- [ ] **Step 1: Write the failing test**

In `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`, add a unit test asserting that `aiChatV2.ai_working` exists in the English locale dictionary.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:components test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
Expected: FAIL due to missing key `aiChatV2.ai_working`.

- [ ] **Step 3: Add `ai_working` key to all 6 language files**

In `src/views/lang/en.ts`: `ai_working: "Working…"`
In `src/views/lang/zh.ts`: `ai_working: "处理中…"`
In `src/views/lang/es.ts`: `ai_working: "Trabajando…"`
In `src/views/lang/fr.ts`: `ai_working: "En cours…"`
In `src/views/lang/de.ts`: `ai_working: "Wird bearbeitet…"`
In `src/views/lang/ja.ts`: `ai_working: "処理中…"`

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:components test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/lang/*.ts test/vitest/main/components/AiChatWorkspaceTranscript.test.ts
git commit -m "feat(i18n): add aiChatV2.ai_working translation key across all locales"
```

---

### Task 2: Remove "Generating…" Text from StreamStatus Bubble

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2StreamStatus.vue`
- Modify: `src/views/components/aiChatV2/AiChatV2Message.vue`
- Test: `test/vitest/main/components/AiChatV2Message.test.ts` (or existing message tests)

**Interfaces:**
- Consumes: `status: "idle" | "streaming" | "cancelled" | "error"`
- Produces: `AiChatV2StreamStatus` renders only for `error` or `cancelled` inside message bubbles; suppresses "Generating…" during `streaming`.

- [ ] **Step 1: Write the failing test**

In `test/vitest/main/components/AiChatV2Message.toolProgress.test.ts` or a new test in `test/vitest/main/components/`, assert that when an assistant message has `status="streaming"`, it does NOT render the text "Generating…".

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:components test/vitest/main/components/AiChatV2Message.toolProgress.test.ts`
Expected: FAIL (currently renders "Generating…").

- [ ] **Step 3: Update `AiChatV2StreamStatus.vue`**

Update `AiChatV2StreamStatus.vue`:
Set `visible = computed(() => props.status !== "idle" && props.status !== "streaming")` so the in-bubble stream status only surfaces terminal non-success states (`error` or `cancelled`).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:components test/vitest/main/components/AiChatV2Message.toolProgress.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2StreamStatus.vue
git commit -m "refactor(chat): suppress in-bubble generating status during active streaming"
```

---

### Task 3: Suppress Empty Assistant Bubble & Add Working Indicator in Workspace Transcript

**Files:**
- Modify: `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue`
- Modify: `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue`
- Test: `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
- Test: `test/vitest/main/components/AiChatCenterSurface.test.ts`

**Interfaces:**
- Consumes: `isRemoteWorking?: boolean` (or derived from `streamStatus === 'streaming' || runtimeStatus === 'running'`)
- Produces:
  - `projectedItems` excludes assistant messages with empty content, no reasoning, and no tool metadata.
  - `.workspace-transcript__working` element rendered at the bottom-left of the scroller when `isRemoteWorking` is true.

- [ ] **Step 1: Write the failing test**

In `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`:
1. Test that an assistant message with `content: ""` and no reasoning/tool metadata is NOT projected into `projectedItems` as an assistant bubble.
2. Test that when `isRemoteWorking: true` (or `streamStatus: "streaming"`), the `.workspace-transcript__working` indicator is rendered with `data-testid="workspace-transcript-working"`.
3. Test that when `isRemoteWorking: false` and `streamStatus: "idle"`, the working indicator is not rendered.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:components test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement empty bubble suppression and working indicator**

In `AiChatWorkspaceTranscript.vue`:
1. Add prop `isRemoteWorking?: boolean`.
2. Compute `effectiveRemoteWorking = computed(() => props.isRemoteWorking ?? (props.streamStatus === 'streaming'))`.
3. In `projectedItems`, filter out assistant messages where `!msg.content && !msg.metadata?.reasoning?.content && !msg.metadata?.toolCallId && !msg.metadata?.toolResult && !msg.metadata?.planStateView && !msg.metadata?.error`.
4. In template, add `<div v-if="effectiveRemoteWorking" class="workspace-transcript__working" data-testid="workspace-transcript-working" role="status">...</div>` with spinner and localized "Working…" caption.
5. In `AiChatCenterSurface.vue`, pass `:is-remote-working="selectedStore.runtimeStatus === 'running' || selectedStore.streamStatus === 'streaming'"` to `AiChatWorkspaceTranscript`.
6. Add CSS styling for `.workspace-transcript__working` (bottom-left alignment, subtle background, matching padding).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test:components test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
Run: `yarn test:components test/vitest/main/components/AiChatCenterSurface.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue src/views/components/aiChatWorkspace/AiChatCenterSurface.vue test/vitest/main/components/AiChatWorkspaceTranscript.test.ts
git commit -m "feat(chat): suppress empty assistant bubble and show working indicator in workspace transcript"
```

---

### Task 4: Parity in Classic Chat (`AiChatV2.vue` / `AiChatV2Messages.vue`)

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue`
- Modify: `src/views/components/aiChatV2/AiChatV2Messages.vue`
- Test: `test/vitest/main/components/AiChatV2Messages.scroll.test.ts`

**Interfaces:**
- Consumes: `isRemoteWorking: boolean` (from `chatIsRunning`)
- Produces:
  - Empty assistant placeholders are filtered out until deltas arrive.
  - The typing/working indicator in `AiChatV2Messages.vue` displays whenever remote is working, styled with spinner and working status.

- [ ] **Step 1: Write the failing test**

In `test/vitest/main/components/AiChatV2Messages.scroll.test.ts`:
Assert that when `isStreaming: true` or `showTypingIndicator: true`, the working indicator element is rendered and empty assistant bubbles are suppressed.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:components test/vitest/main/components/AiChatV2Messages.scroll.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `AiChatV2.vue` and `AiChatV2Messages.vue`**

1. In `AiChatV2.vue`: In `visibleMessages`, filter out assistant messages with empty content and empty reasoning while `chatIsRunning` is true, so the bubble doesn't render until tokens/tool cards exist.
2. In `AiChatV2Messages.vue`: Update `.v2-messages__typing` to support working indicator presentation with spinner and "Working…" text / aria-label.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:components test/vitest/main/components/AiChatV2Messages.scroll.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2.vue src/views/components/aiChatV2/AiChatV2Messages.vue test/vitest/main/components/AiChatV2Messages.scroll.test.ts
git commit -m "feat(chat): align classic chat with empty bubble suppression and remote working indicator"
```

---

### Task 5: Full Suite Regression Verification

**Files:**
- Test: `test/vitest/main/components/`

- [ ] **Step 1: Run full component test suite**

Run: `yarn test:components`
Expected: All tests pass.

- [ ] **Step 2: Commit any final regression adjustments**

```bash
git status
```
