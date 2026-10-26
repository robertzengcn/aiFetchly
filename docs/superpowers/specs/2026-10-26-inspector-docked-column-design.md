# Design: dock the inspector as a real layout column (push, not overlay)

Date: 2026-10-26
Status: proposed (short design — awaiting approval)

## Intent (user request)

Clicking the header sidebar toggle today opens the inspector as a floating
panel that sits ON TOP of the chat content (`.overlay` on narrow/medium;
`position: fixed` pinned to the viewport's right edge on wide screens).
The user wants the main area to SHRINK instead: the inspector becomes a
third column of the app shell — [left nav][chat center][inspector] —
extending the app area to the right, pushing/reflowing content, never
covering it.

## Constraint that made it float

`AppInspectorHost` (the only global inspector mount, `design §9.3`) renders
its inspector inside `<Teleport to="body">` — outside the shell's flex row.
`.workspace-inspector.docked` therefore uses `position: fixed` (it would
otherwise land in normal flow below the full-height shell), and
`ScheduleInspector.vue` is likewise `position: fixed` unconditionally.

## Approach (decided by the request; one sensible way)

Render the inspector IN the shell's flex row instead of teleporting it to
`<body>`:

1. `AppInspectorHost.vue` — drop the `<Teleport to="body">` wrapper. The host
   is already a direct flex child of `.app-workspace-shell` after `<main>`,
   so with no Teleport the active inspector becomes the row's third column
   for BOTH inspector kinds (chat + schedule). Nothing on other routes
   remounts it: the shell component (not the route) owns it.
2. `AiChatInspector.vue` `.workspace-inspector.docked` — replace
   `position: fixed; top/right/bottom; box-shadow` with in-flow
   (`position: relative; height: 100%; flex-shrink: 0` is already on the
   base rule). The inline `width` style and the resizer keep working, and
   the width preference keeps its existing 320–720px clamp.
3. `ScheduleInspector.vue` — same: `.app-inspector` goes in-flow
   (`position: relative; height: 100%;`) with the overlay drawer variant
   (narrow/medium) unchanged.
4. Narrow/medium shell modes keep the OVERLAY/drawer presentation
   (`overlay = shell.mode !== 'wide'`); only the wide docked mode pushes
   layout — a push column on a small viewport would starve the chat.

## Goals / non-goals

- Goal: wide-screen open inspector = real right column; chat + composer
  reflow; content never covered; resize and persisted width unchanged.
- Non-goal: restyling the tabs/panels; changing resize behavior; any
  narrow/medium overlay change.

## Tests (same commit — repo rule)

- `AiChatInspector` source-level assertion (jsdom has no flex layout;
  same technique as the chip clamp): the `.docked` rule must NOT declare
  `position: fixed` and must declare in-flow participation.
- New `AppInspectorHost` topology test: with a chat target open, the
  inactive render does NOT teleport the panel to `document.body` — it
  renders inside the shell row (`dispatch must move with the mount`).
- Run the e2e rollout drill (its workspace-inspector interactions remain
  presence-based) to catch regressions from the mount move.

## Sequel note

This is the third UI change asserted via `?raw` CSS for layout truths
(chip clamp, docked flow). Out of scope here: consolidating them.
