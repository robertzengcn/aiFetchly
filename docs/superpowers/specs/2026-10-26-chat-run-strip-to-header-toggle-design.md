# Design: replace the chat run-strip bar with a header sidebar toggle

Date: 2026-10-26
Status: proposed (awaiting approval)

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

- The run strip was the only place that rendered the "Goal: …" text and
  "Scheduled loop running/paused" wording. Removing the bar removes those
  labels; if loop/goal visibility is needed later it can come back as a
  separate small notice (not silently re-added now).
- The separate single-line retry/recovery status under the header
  (`chat-center__recovery-detail`) is a status line, not the button bar —
  it stays.

## Touch list (builder hand-off)

1. `AiChatCenterSurface.vue` — remove the `<AiChatRunStrip>` mount and
   import; remove the now-unused `onStopFromStrip` handler.
2. `AiChatConversationHeader.vue` — move the inspector-toggle button out of
   its position before the overflow `v-menu` to index after it (right of
   "..."); icon/tooltip unchanged (`mdi-panel-right` /
   `mdi-panel-right-close`, "Toggle inspector").
3. Delete `AiChatRunStrip.vue` (dead code once unmounted).
4. Tests (UI change ⇒ tests change, same commit):
   - `test/vitest/main/components/aiChatWorkspace.a11y.test.ts` — delete the
     two run-strip describes (they mount the deleted component directly).
   - `test/vitest/main/components/AiChatCenterSurface.test.ts` — remove the
     `AiChatRunStrip` stub; rewrite the tests that emit `stop` on the strip
     to exercise the composer stop path; delete tests that asserted
     strip visibility/goal/loop text.
   - `test/vitest/main/components/AiChatConversationHeader.test.ts` — add a
     test that the sidebar toggle renders after the overflow menu
     (right of "...") and remains mounted with no conversation.
   - E2E `test/e2e/specs/workspaceRolloutDrill.test.ts` uses
     `workspace-inspector-toggle` by testid — unchanged by the move; verify
     the spec still passes if a targeted run is practical.

## Verification

`yarn test:components` green, `yarn typecheck` green, linted via pre-commit.
