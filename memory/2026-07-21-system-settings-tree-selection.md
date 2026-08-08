# Debug Report: System Settings Tree Selection

- Symptom: clicking the Embedding Models or External System labels in the System Settings tree caused unrelated sibling sections, especially 2captcha items, to appear selected or shown.
- Root cause: `v-treeview` used raw numeric `id` values for both group nodes and setting child nodes. Group IDs and setting IDs come from separate database tables, so values can collide. The selection watcher then treated a group click as a setting click with the same numeric ID.
- Fix: tree values now use prefixed IDs (`group:<id>` and `setting:<id>`), and the watcher parses the prefix before resolving the selected group. Highlighting tracks only selected setting IDs.
- Regression test: `test/vitest/main/components/SystemSettingTreeSelection.test.ts` mounts the page with colliding group/setting IDs and verifies selecting `group:2` and `group:3` resolves to the intended groups.
- Verification:
  - `yarn vitest --config test/vitest/main/components/vitest.config.mjs SystemSettingTreeSelection.test.ts --run`
  - `yarn tsc-result --pretty false`
- Related: the full component suite still has unrelated AiChatV2 workspace test failures in `AiChatV2.workspace.test.ts` and `AiChatV2.workspaceTrust.test.ts`.
- Status: DONE_WITH_CONCERNS
