# Design: replace the chat run-strip bar with a header sidebar toggle + header status chips

Date: 2026-10-26
Status: approved with amendment (goal/loop labels move to the header)

## Intent

When the user sends a message, the workspace chat shows a bordered bar just
under the chat header (the "run strip") with a status label plus **Stop** and
**Details** buttons. The user does not want this bar. The only thing it is
still wanted for — one obvious way to open the Activity sidebar — moves into
the conversation header as a persistent icon button to the right of the
"..." (overflow) button.

## Goals

- The run-strip bar never renders in the workspace chat.
- The header has exactly one sidebar affordance: the existing inspector
  toggle icon button, repositioned to the **right of the "..." button**.
- The toggle always renders (it has no v-if today; moving it keeps that),
  and keeps its open/close toggle semantics (click when closed → sidebar
  opens with the last-viewed tab; click when open → closes).
- Stopping a run stays possible: the composer's send button already becomes
  Stop while the agent is running (`@stop="stopActiveRunWithSpeech"`), so
  no separate Stop button is needed — confirmed by the user.
- **Amendment (user): no feature loss.** The run strip's "Goal: …" text and
  "Scheduled loop running/paused" wording move into the conversation
  header, next to the title: the header receives `goalObjective` and
  `loopStatus` (same gating: only when shared orchestration is enabled)
  and renders them as small status chips beside the title, reusing the
  existing i18n keys `workspaceChat.runStrip.goal|loopRunning|loopPaused`
  so the six-language translations stay untouched.

## Non-goals

- No redesign of the Activity/inspector panel itself.
- No change to the header status pill (FR-009 summarized status, clickable
  into Activity) — running / waiting / failed states remain visible there.
- No change to pinned permission / question cards in the message flow.

## Approach considered and picked

1. **Add a brand-new icon button right of "..."** while keeping the old
   toggle — two buttons that open the same sidebar; clutter. Rejected.
2. **Move the existing toggle to right of "..."** — one affordance, exactly
   where the user wants it, no duplication. **Picked.**

## Consequences worth knowing

- ~~The run strip was the only place that rendered the "Goal: …" text and
  "Scheduled loop running/paused" wording.~~ **Resolved by the amendment:**
  those labels continue to render as status chips beside the header title,
  with the same visibility rules (shared-orchestration-gated data from the
  center surface).
- The separate single-line retry/recovery status under the header
  (`chat-center__recovery-detail`) is a status line, not the button bar —
  it stays.

## Touch list (builder hand-off)

1. `AiChatCenterSurface.vue` — remove the `<AiChatRunStrip>` mount and
   import; remove the now-unused `onStopFromStrip` handler; pass
   `goal-objective` and `loop-status` (the previous strip props) to
   `AiChatConversationHeader` instead.
2. `AiChatConversationHeader.vue` — accept `goalObjective` / `loopStatus`
   props; render the status chips (goal text + loop state) beside the
   title using the existing `workspaceChat.runStrip.*` i18n keys; move the
   inspector-toggle button out of its position before the overflow
   `v-menu` to index after it (right of "..."); icon/tooltip unchanged
   (`mdi-panel-right` / `mdi-panel-right-close`, "Toggle inspector").
3. Delete `AiChatRunStrip.vue` (dead code once unmounted).
4. Tests (UI change ⇒ tests change, same commit):
   - `test/vitest/main/components/aiChatWorkspace.a11y.test.ts` — delete the
     two run-strip describes (they mount the deleted component directly).
   - `test/vitest/main/components/AiChatCenterSurface.test.ts` — remove the
     `AiChatRunStrip` stub; rewrite the tests that emit `stop` on the strip
     to exercise the composer stop path; repoint the goal/loop-display
     tests at the header chips.
   - `test/vitest/main/components/AiChatConversationHeader.test.ts` — add
     tests: goal/loop chips render with the existing translations and hide
     when the props are empty, and the sidebar toggle renders after the
     overflow menu (right of "...") with no conversation selected.
   - E2E `test/e2e/specs/workspaceRolloutDrill.test.ts` uses
     `workspace-inspector-toggle` by testid — unchanged by the move; verify
     the spec still passes if a targeted run is practical.

## Verification

`yarn test:components` green, `yarn typecheck` green, linted via pre-commit.
