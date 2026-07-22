# Subagent Detail Dialog Source Location Debug

Date: 2026-07-15

## Symptom

Clicking a row in the Subagents system settings page opened a right-side drawer,
but the requested behavior is a pop-up detail window. Auto-imported agents from
`~/.aifetchly` or workspace `.aifetchly` files also did not show where the
source Markdown file lives.

## Root Cause

`AgentDetailPanel.vue` was implemented as a `v-navigation-drawer`. Dynamic agent
definitions also did not preserve file-location metadata in the management DTO:
the parser received each draft's `relativePath`, but discarded it when building
`AgentDefinitionView`.

## Fix

- `buildAgentDefinition` now writes `manifest.sourceLocation` with `sourceId`,
  `sourceLabel`, `relativePath`, and optional `rootPath`.
- The global `~/.aifetchly` loader passes its root path into agent definition
  building.
- `AgentDetailPanel.vue` now renders as a `v-dialog` modal and shows a source
  file row when source metadata or plugin component path exists.
- Added `subagents.field_source_file` translations for all supported languages.

## Verification

- `yarn vitest run --config vite.main.config.mjs test/vitest/main/service/agentFrontmatter.test.ts`
  passed: 39 tests.
- `yarn tsc-result` passed.
- `yarn vue-tsc --noEmit` was attempted but is blocked by existing unrelated
  `AiChatV2.vue` slash-command metadata type errors where `metadata.source` is
  `"slash-command"` but the view type currently only accepts `"chat-v2"`.

## Status

DONE_WITH_CONCERNS: code and focused regression are verified; full Vue typecheck
is blocked by a pre-existing unrelated type error.
