# Move "Report conversation" into the chat "..." menu — short design

Date: 2026-11-03
Status: Proposed — awaiting approval

## Intent and why

In the AI chat workspace (`AiChatCenterSurface.vue`, route `aiworkspace`), the
icon-only "Report this conversation for review" button sits in the strip below
the transcript, above the composer. It competes with the composer strip's
context (workspace badge, history toggle, compaction status) and is easy to
miss. The top-right "..." conversation menu (`AiChatConversationHeader.vue`)
is the established home for infrequent conversation actions. Moving the report
entry there declutters the bottom strip and groups conversation-level actions
under one affordance.

## Goals

- The report action is reachable from the "..." menu at the top right of the
  conversation header.
- The bottom workspace strip no longer shows the report button (the workspace
  badge, history toggle, and compaction status stay).
- The multi-select conversation report dialog flow, capability gating, and
  analytics are unchanged.

## Non-goals

- No change to `AiChatV2.vue`'s header-level report button (it is already in
  the top header there, not at the bottom).
- No change to per-output report buttons (`AIContentReportButton`) or to the
  reporting backend/IPC.
- No redesign of the "..." menu beyond adding the one item.

## Approaches considered

1. **Menu item in the existing "..." overflow menu (chosen).** Add a
   non-destructive "Report conversation" item to
   `AiChatConversationHeader.vue`, emit a `report` event, and wire it to the
   existing `onOpenConversationReport` in `AiChatCenterSurface.vue`. Smallest
   change, follows the header's existing emit pattern
   (Rename/Export/Duplicate/…), reuses existing i18n keys.
   Traded off: the action is one click deeper than the visible button.
2. **Keep a visible header icon outside the menu.** One click shallower, but
   the header's `header-actions` row is already dense (overflow + inspector
   toggle) and the user explicitly asked to consolidate into the "..." menu.
   Dropped.
3. **Hunt the item near the destructive section.** Reporting is not
   destructive; grouping it below the divider would miscommunicate
   (PRD §11.5 separates destructive actions). Dropped.

**User decision recorded:** when conversation reporting is unavailable or
there is nothing reportable yet, the menu item stays **visible but disabled**
with the disabled reason as a tooltip — matching today's button (PRD §11.4,
design §10.1 "stable presence, announced reason").

## Behavior

- `AiChatConversationHeader.vue` gains a "Report conversation" menu item
  (`mdi-flag-outline`) in the non-destructive section (after Background
  Agents, above the divider), `data-testid="workspace-overflow-report"`.
- New props on the header: `reportEnabled: boolean`, `reportLoading: boolean`,
  `reportDisabledReason?: string`, and a new emit `(e: "report")`.
- The item is disabled when `!reportEnabled || reportLoading`; a `v-tooltip`
  on the item shows `reportDisabledReason` when there is one. Item title uses
  the existing key `aiConversationReport.action` ("Report conversation") —
  no new translation keys, so all six language files stay valid as-is.
- `AiChatCenterSurface.vue` removes `<AIConversationReportButton>` from the
  workspace strip and passes the existing
  `conversationReportEnabled` / `reportCapabilitiesLoading` /
  `conversationReportDisabledReason` to the header, handling
  `@report="onOpenConversationReport"`.
- `AIConversationReportButton.vue` stays (still used by `AiChatV2.vue`); only
  its use in the center surface goes away.
- Keyboard/screen-reader behavior follows `v-menu` + `v-list-item` defaults;
  the disabled state is announced by Vuetify (`aria-disabled`).

## Constraints

- AGENTS.md rules apply: no new UI text without all six language files
  (none needed here), component tests updated in the same change, and an
  auto-commit when the unit of work is done.
- The report flow itself must not change: same snapshot builder
  (`buildChatV2ConversationSnapshot`), same dialog, same
  `opened`/`scope_changed` analytics once the dialog opens.

## Tests to update (same change)

- `test/vitest/main/components/AiChatConversationHeader.test.ts`: new case —
  renders the report item, emits `report` on click, and reflects
  disabled + reason for the unavailable/loading states.
- `test/vitest/main/components/AiChatCenterSurface.test.ts`: existing
  conversation-report cases currently trigger
  `AIConversationReportButton` (`~line 1778/1803`); update them to open via
  the header overflow menu emit, and assert the strip no longer renders the
  button.
- `test/vitest/main/components/AIConversationReportButton.test.ts`: untouched
  (component still used by AiChatV2).

## Left to the builder

- Exact placement details (spacing of the divider) are the builder's call
  within the non-destructive section.
- Whether the tooltip wraps the whole item or hits edge cases with disabled
  pointer handling — verify in a component test.
