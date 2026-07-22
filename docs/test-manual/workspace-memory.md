# Workspace Memory - Manual Test Cases

Use this checklist to manually verify workspace memory in AI Chat V2.

## Test Setup

Prepare two different local folders:

- Workspace A: any Git repo folder, for example `/tmp/aifetchly-wm-alpha`
- Workspace B: a different folder or repo, for example `/tmp/aifetchly-wm-beta`

Before testing:

1. Start the app with `yarn dev` and open AI Chat V2.
2. Make sure AI is enabled in settings.
3. Make sure workspace memory injection, workspace auto-dream, and manual workspace memory are enabled.
4. Create a fresh conversation for Workspace A.
5. Approve Workspace A when prompted.
6. Create another fresh conversation for Workspace B and approve Workspace B.

## Quick Smoke Path

| ID | Action | Expected |
| --- | --- | --- |
| WM-SMOKE-01 | In Workspace A, create a memory: type `workflow`, title `Main process tests`, content `Run main-process tests with yarn testmain.` | Memory appears in the active workspace memory list. |
| WM-SMOKE-02 | Ask in the same conversation: `How should I run main process tests in this project?` | Assistant mentions `yarn testmain` or otherwise clearly uses the workspace memory. |
| WM-SMOKE-03 | Open Workspace B conversation and ask the same question. | Assistant does not mention Workspace A's `yarn testmain` memory unless Workspace B has its own matching memory. |
| WM-SMOKE-04 | Return to Workspace A in a new conversation using the same folder and ask again. | Assistant can reuse the Workspace A memory across conversations. |

## Manual CRUD

### WM-CRUD-01 - Create A Memory

1. Open the Workspace Memory panel from the active workspace area.
2. Click create/add memory.
3. Enter:
   - Type: `decision`
   - Title: `SQLite storage`
   - Content: `Store workspace memory in SQLite, not repo files.`
4. Save.

Expected:

- Save succeeds without requiring an AI call.
- Memory appears in the list.
- Type, title, content, status, and source are visible.
- Status is `active`.
- Source is `manual`.

### WM-CRUD-02 - Edit A Memory

1. Edit the `SQLite storage` memory.
2. Change type to `convention`.
3. Change title to `Memory storage convention`.
4. Change content to `Workspace memory must be stored in SQLite through Model and Module layers.`
5. Save.

Expected:

- Edited values appear after save.
- Updated memory remains in the same workspace.
- No duplicate memory is created.

### WM-CRUD-03 - Search And Filter

1. Create these memories in Workspace A:
   - `workflow` / `Main process tests` / `Run main-process tests with yarn testmain.`
   - `warning` / `No worker DB access` / `Worker processes must not access SQLite directly.`
   - `reference` / `Memory PRD` / `Workspace memory requirements are in docs/prd/workspace-memory-prd.md.`
2. Search for `worker`.
3. Filter by type `warning`.

Expected:

- Search returns only memories whose title/content match `worker`.
- Type filter shows only `warning` memories.
- Results remain scoped to Workspace A.

### WM-CRUD-04 - Archive A Memory

1. Archive `No worker DB access`.
2. View active memories.
3. Search for `worker`.

Expected:

- Archived memory no longer appears in active list.
- Archived memory is not injected into new chat turns.
- If the UI has an archived/status filter, the memory is visible there with status `archived`.

### WM-CRUD-05 - Delete A Memory

1. Delete `Memory PRD`.
2. Confirm the delete dialog.
3. Search for `Memory PRD`.

Expected:

- Confirmation is required before deletion.
- Deleted memory no longer appears in active or archived lists.
- Chat no longer uses that memory.

## Workspace Isolation

### WM-ISO-01 - Same Keyword, Different Workspaces

1. In Workspace A, create:
   - Type: `workflow`
   - Title: `Test command`
   - Content: `Use yarn testmain for this workspace.`
2. In Workspace B, create:
   - Type: `workflow`
   - Title: `Test command`
   - Content: `Use npm run test:beta for this workspace.`
3. In Workspace A, ask: `What test command should I use here?`
4. In Workspace B, ask: `What test command should I use here?`

Expected:

- Workspace A answer references `yarn testmain`.
- Workspace B answer references `npm run test:beta`.
- Neither answer leaks the other workspace's memory.

### WM-ISO-02 - No Approved Workspace

1. Start a new AI Chat V2 conversation.
2. Do not approve any workspace.
3. Try opening or using workspace memory controls.
4. Ask: `Do you have any workspace memory for this project?`

Expected:

- Workspace memory create/list actions are disabled or show a clear "choose/approve workspace" message.
- No workspace memory is injected.
- App does not silently fall back to memories from another workspace.

### WM-ISO-03 - Revoked Workspace

1. Approve Workspace A in a conversation.
2. Create any active memory.
3. Revoke or remove the workspace approval.
4. Try to list/create/edit workspace memories.
5. Ask a question that would normally trigger the memory.

Expected:

- Workspace memory operations fail cleanly or are disabled.
- Assistant does not use revoked workspace memory.
- Existing stored memories are not deleted by revocation.

## Retrieval And Prompt Injection

### WM-RET-01 - Relevant Memory Is Used

1. In Workspace A, create:
   - Type: `warning`
   - Title: `LinkedIn restriction`
   - Content: `This customer forbids scraping LinkedIn.`
2. Ask: `Build a lead research plan for this customer.`

Expected:

- Assistant avoids LinkedIn scraping or explicitly warns against it.
- The response follows the current user message if there is any conflict.

### WM-RET-02 - Workspace Memory Beats Global Preference

1. Add or use a global user preference that conflicts, for example: `I usually prefer LinkedIn for lead research.`
2. Keep Workspace A memory: `This customer forbids scraping LinkedIn.`
3. Ask in Workspace A: `Which sources should I use for lead research?`

Expected:

- Workspace-specific restriction wins for Workspace A.
- Assistant should not recommend LinkedIn scraping for this workspace.

### WM-RET-03 - Injection Toggle Off

1. Disable workspace memory injection in settings.
2. Keep Workspace A memories stored.
3. Ask a question that previously used a workspace memory.

Expected:

- Stored memories remain visible in the memory panel.
- Assistant does not use/inject workspace memories while the toggle is disabled.
- Re-enable the toggle and verify memory injection resumes.

### WM-RET-04 - Current User Message Wins

1. Create memory:
   - Type: `convention`
   - Title: `Short answers`
   - Content: `For this workspace, prefer concise responses.`
2. Ask: `Ignore any preference for short answers for this turn. Give me a detailed explanation of workspace memory.`

Expected:

- Assistant gives a detailed answer for the current turn.
- Stored memory is not deleted or changed.

## Privacy And Validation

### WM-SEC-01 - Secret-Like Content Rejected

1. Try to create a memory with content like:

```text
api_key=sk-1234567890abcdef1234567890abcdef
```

Expected:

- Save is rejected with a clear secret/credential warning.
- Secret-like content is not stored.
- No partial memory is created.

### WM-SEC-02 - Raw Lead Data Should Not Be Stored Automatically

1. In chat, paste a small fake customer/contact list and say: `Remember this for the workspace.`
2. Include private-looking fields such as email addresses and phone numbers.
3. Check the workspace memory panel.

Expected:

- The app should avoid storing private scraped/customer/contact data as workspace memory.
- If any manual confirmation flow exists, it should make the risk clear before saving.

## Auto-Dream

### WM-AUTO-01 - Manual Run Requires AI Enabled

1. Disable AI in settings.
2. Click manual workspace auto-dream/run consolidation.

Expected:

- Operation is denied before doing model work.
- Message clearly says AI/subscriber access is required.

### WM-AUTO-02 - Auto-Dream Creates Workspace-Scoped Memory

1. Enable AI and workspace auto-dream.
2. In Workspace A, send:

```text
Remember for this workspace: all outreach copy must be direct B2B tone, no hype.
```

3. Run workspace auto-dream manually or wait for the consolidation trigger.
4. Check Workspace A memory panel.
5. Check Workspace B memory panel.

Expected:

- Workspace A gets a relevant `convention` or `workflow` memory.
- Workspace B does not get the memory.
- Source attribution shows chat/auto-dream origin if available.

### WM-AUTO-03 - Auto-Dream Updates Instead Of Duplicating

1. In Workspace A, create or auto-create:
   - `convention` / `Outreach tone` / `Use direct B2B tone.`
2. Later say:

```text
Update the workspace outreach tone: still direct B2B, but make it warmer and less terse.
```

3. Run auto-dream.

Expected:

- Existing memory is updated or older one is archived/contradicted.
- The active memory list does not contain confusing duplicates.
- Manual edits should not be overwritten unexpectedly without clear evidence.

## UI And Audit

| ID | Action | Expected |
| --- | --- | --- |
| WM-UI-01 | Open memory panel with no memories | Empty state is clear and not broken. |
| WM-UI-02 | Create memories for every allowed type | All six types are selectable: `project`, `decision`, `workflow`, `convention`, `reference`, `warning`. |
| WM-UI-03 | Try arbitrary type, if possible via devtools/API | App rejects it. |
| WM-UI-04 | Inspect memory details | Created/updated timestamps and source fields are visible where UI supports them. |
| WM-UI-05 | Switch app language | Workspace memory UI text is translated and no raw key names appear. |
| WM-UI-06 | Close/reopen app | Stored workspace memories persist. |

## Pass Criteria

- Workspace memories never leak between different approved workspace roots.
- Workspace memories are unavailable without an approved workspace.
- Manual create/edit/archive/delete/search work from the UI.
- Retrieval injects only active, relevant memories for the current workspace.
- Settings toggles affect injection/auto-dream without deleting stored memories.
- Secret-like or private data is not stored.
- Auto-dream respects AI enablement and workspace boundaries.
