# Workspace Memory — Additional Manual Test Cases

These test cases supplement `workspace-memory.md` and cover areas not yet verified in the QA report (2026-07-10).

**Prerequisites:** Same as `workspace-memory.md` — two workspace folders, AI enabled, all three workspace memory toggles on.

---

## 1. Cross-Conversation Memory Sharing

### WM-XCONV-01 — Two conversations share the same workspace memory

1. Open Workspace A conversation. Create memory: type `workflow`, title `Build command`, content `Run yarn build to build the app.`
2. Open a **new** conversation, also bound to Workspace A.
3. Ask: `How do I build this project?`

**Expected:**
- Assistant references `yarn build` from the memory created in the other conversation.
- The memory panel in the new conversation shows the memory (status `active`).
- `lastUsedAt` is updated on the memory record.

### WM-XCONV-02 — Memory created in conversation 2 is visible in conversation 1

1. Open Workspace A conversation 2. Create memory: type `warning`, title `Deploy restriction`, content `Never deploy on Fridays.`
2. Switch back to Workspace A conversation 1.
3. Open the workspace memory panel.

**Expected:**
- The `Deploy restriction` memory is listed.
- Source shows `manual` (or whichever source kind was used).

### WM-XCONV-03 — Memory count badge updates across conversations

1. In Workspace A conversation 1, note the badge count (should be 0 or N).
2. Create a new memory.
3. Switch to Workspace A conversation 2.

**Expected:**
- Badge in conversation 2 reflects the new total (including the memory created in conversation 1).

---

## 2. Settings Toggles

### WM-TOGGLE-01 — Injection toggle disables memory in prompts

1. Create a memory in Workspace A: type `convention`, title `Code style`, content `Use single quotes in all TypeScript files.`
2. Verify it is used by asking a relevant question.
3. Disable the **workspace memory injection** toggle in settings.
4. Ask the same question again.
5. Check the memory panel.

**Expected:**
- After disabling, assistant does NOT reference the memory.
- Stored memories are still visible in the panel (not deleted).
- Re-enable the toggle → memory is used again in the next turn.

### WM-TOGGLE-02 — Manual memory toggle disables create/edit/archive/delete

1. Disable the **manual workspace memory** toggle.
2. Open the workspace memory panel.
3. Try to create, edit, archive, or delete a memory.

**Expected:**
- Create/edit/archive/delete actions are disabled or hidden.
- The list is still viewable (read-only).
- Re-enable the toggle → actions become available again.

### WM-TOGGLE-03 — Auto-dream toggle disables background consolidation

1. Disable the **workspace auto-dream** toggle.
2. In Workspace A chat, say: `Remember for this workspace: always use port 3000 for dev server.`
3. Wait or trigger auto-dream manually.
4. Check the workspace memory panel.

**Expected:**
- Auto-dream does NOT create a new memory from the chat.
- The auto-dream status section shows disabled or no recent run.
- Manual memory creation still works independently.

### WM-TOGGLE-04 — Toggles persist after app restart

1. Disable workspace memory injection.
2. Restart the app (`yarn dev`).
3. Open settings.

**Expected:**
- The injection toggle is still disabled after restart.
- Stored memories are intact.

---

## 3. Memory Editor Dialog Validation

### WM-VALID-01 — Title length limits

1. Open the create memory dialog.
2. Try to save with an empty title.

**Expected:** Validation error; save is blocked.

### WM-VALID-02 — Title max length

1. Enter a title with exactly 200 characters. Save.
2. Enter a title with 201 characters. Try to save.

**Expected:**
- 200-char title saves successfully.
- 201-char title is rejected with a validation message.

### WM-VALID-03 — Content length limits

1. Enter content with exactly 8000 characters. Save.
2. Enter content with 8001 characters. Try to save.

**Expected:**
- 8000-char content saves successfully.
- 8001-char content is rejected.

### WM-VALID-04 — All six memory types are selectable

1. Open the create dialog.
2. Check the type dropdown.

**Expected:** Exactly these six types are available: `project`, `decision`, `workflow`, `convention`, `reference`, `warning`. No other types.

### WM-VALID-05 — Confidence value clamping

1. Open the edit dialog for an existing memory.
2. Set confidence to -5. Save.
3. Set confidence to 105. Save.

**Expected:**
- Confidence is clamped to 0 on the low end.
- Confidence is clamped to 100 on the high end.
- No error — value is silently corrected.

### WM-VALID-06 — Secret-like content rejected in editor

1. Open the create dialog.
2. Enter title `API Config` and content: `The API key is sk-proj-abcdefghijklmnop1234567890abcdef`. Save.

**Expected:**
- Save is rejected with a clear message about secret/credential content.
- No partial memory is created.

### WM-VALID-07 — Secret patterns that should be rejected

Try creating memories with each of these content patterns:

| Pattern | Example |
|---------|---------|
| API key | `api_key=sk-1234567890abcdef1234567890abcdef` |
| Bearer token | `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZXN0IjoxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U` |
| Password | `password=SuperSecret123!` |
| Cookie | `session_cookie=abc123def456` |
| Private key | `-----BEGIN RSA PRIVATE KEY-----` |

**Expected:** All are rejected with the secret warning message.

---

## 4. Status Badge Behavior

### WM-BADGE-01 — Badge shows memory count

1. Open Workspace A conversation (no memories yet).
2. Check the workspace memory status badge in the chat toolbar.

**Expected:** Badge shows 0 or is hidden/empty.

### WM-BADGE-02 — Badge updates after memory creation

1. Create a memory in Workspace A.
2. Observe the badge.

**Expected:** Badge count increases by 1.

### WM-BADGE-03 — Badge updates after memory deletion

1. Delete the memory created in WM-BADGE-02.
2. Observe the badge.

**Expected:** Badge count decreases by 1 (or hides if 0).

### WM-BADGE-04 — Badge click navigates to memory panel

1. Click the workspace memory status badge.

**Expected:** The workspace memory panel opens.

---

## 5. Source Attribution Display

### WM-SOURCE-01 — Manual memory shows source as "manual"

1. Create a memory manually through the panel.
2. View the memory details.

**Expected:** Source kind is displayed as `manual`. Source conversation/task IDs are not shown (since it was manual).

### WM-SOURCE-02 — Memory created via "remember this" chat command

1. In Workspace A chat, type: `Remember this for this workspace: our API base URL is https://api.example.com/v2`
2. Open the workspace memory panel.

**Expected:**
- A new memory appears with source `chat_v2` (or equivalent).
- Source conversation ID is populated.

### WM-SOURCE-03 — Timestamps are visible

1. Create a memory.
2. View memory details.

**Expected:** Created/updated timestamps are visible. If the memory has been used in a prompt, `lastUsedAt` is also shown.

---

## 6. Context Injection Order

### WM-CTX-01 — Workspace memory appears before global user memory

1. Create a global user memory (e.g., `I prefer dark mode in all tools.`).
2. Create a workspace memory in Workspace A: type `convention`, title `Theme`, content `This workspace always uses light theme.`
3. In Workspace A, ask: `What theme should this project use?`

**Expected:**
- Assistant references the workspace memory (light theme) over the global preference.
- The system prompt order places workspace memory BEFORE global user memory.

### WM-CTX-02 — Workspace memory appears after workspace context block

1. Open DevTools console (if available) or observe the assembled context.
2. In Workspace A, send any message.

**Expected:** In the assembled context array, the workspace memory block appears AFTER the active workspace block and BEFORE the durable user memory block.

### WM-CTX-03 — Memory count and token budget respected

1. Create 12 active memories in Workspace A with varied types and relevance to a test question.
2. Ask a question that keyword-matches several memories.
3. Observe (via DevTools or response) how many are injected.

**Expected:**
- No more than 8 memories are injected per prompt (default cap).
- Total estimated tokens for the injected block does not exceed 1800.

---

## 7. Archival and Contradiction

### WM-ARCH-01 — Archived memory is not injected

1. Create a memory: type `workflow`, title `Deploy process`, content `Deploy via yarn deploy to production.`
2. Verify it is used in chat.
3. Archive it.
4. Ask the same question again.

**Expected:** Assistant does NOT reference the archived memory.

### WM-ARCH-02 — Archived memory is still visible in panel

1. After archiving in WM-ARCH-01, filter the memory panel by status `archived`.

**Expected:** The archived memory is visible with status `archived`.

### WM-ARCH-03 — Unarchive a memory

1. If the UI supports unarchiving: unarchive the memory from WM-ARCH-01.
2. Check the active list.
3. Ask the relevant question.

**Expected:**
- Memory returns to active status.
- Assistant uses it again.

### WM-ARCH-04 — Delete vs archive distinction

1. Archive a memory. Note it still exists (visible in archived filter).
2. Delete a different memory. Confirm deletion.

**Expected:**
- Archived memory can be unarchived or permanently deleted later.
- Deleted memory is permanently gone — not visible in any list.

---

## 8. Auto-Dream Deep Tests

### WM-AUTO-04 — Auto-dream respects cooldown

1. Trigger auto-dream manually for Workspace A.
2. Immediately trigger it again.

**Expected:** Second trigger is either blocked by cooldown or completes instantly with no new memories (if cooldown is enforced).

### WM-AUTO-05 — Auto-dream status shows run details

1. Trigger auto-dream manually.
2. Check the auto-dream status in the workspace memory panel.

**Expected:** Status shows last run time, status (completed/failed), and counts of memories created/updated/archived.

### WM-AUTO-06 — Auto-dream does not write when AI is disabled

1. Disable AI in settings.
2. Trigger auto-dream manually.

**Expected:** Operation is denied with a message about AI being required.

### WM-AUTO-07 — Auto-dream groups by workspace correctly

1. Have conversations in both Workspace A and Workspace B.
2. In each, say something memorable for that workspace.
3. Run auto-dream.

**Expected:**
- Workspace A memories are only about Workspace A content.
- Workspace B memories are only about Workspace B content.
- No cross-contamination.

### WM-AUTO-08 — Automatic auto-dream from one active conversation

**Goal:** Verify that Workspace Auto-Dream runs automatically when one approved workspace conversation has enough chat messages.

**Preconditions:**
- AI is enabled.
- Workspace auto-dream is enabled.
- Workspace memory injection can be on or off; it does not affect creation.
- Use a fresh workspace or a workspace with no successful auto-dream run in the last 24 hours.
- Open the Workspace Memory panel before starting and note the current "Last run" value.

Use these exact chat turns in one Workspace A conversation:

1. Send:

```text
For this workspace, remember this durable decision: all release branches must be named release/YYYY-MM-DD.
```

2. Wait for the assistant response to complete.
3. Send:

```text
For this workspace, remember this workflow: before packaging Electron builds, run yarn build and then yarn make.
```

4. Wait for the assistant response to complete.
5. Send:

```text
For this workspace, remember this warning: do not run database migrations from a worker process; the main process must handle database writes.
```

6. Wait 10-30 seconds after the third assistant response.
7. Open the Workspace Memory panel and refresh/reopen it if needed.

**Expected:**
- Workspace Auto-Dream runs automatically after the third assistant response.
- The auto-dream status shows a newer last-run timestamp.
- One or more new memories may appear with source `auto_dream`.
- Created memory content should be about release branch naming, Electron packaging workflow, or worker database restrictions.
- Chat response completion is not delayed or blocked by auto-dream.

**Notes:**
- If there was already a successful workspace auto-dream run within 24 hours, automatic execution is skipped by cooldown. Use a fresh workspace or wait for the cooldown to expire.
- If the model decides not to create memories, use WM-AUTO-09 to verify the manual forced path.

### WM-AUTO-09 — Manual run uses the same chat sources

**Goal:** Verify that the Run Auto Summary button can force consolidation when automatic cooldown or thresholds make the result ambiguous.

1. Use the same conversation from WM-AUTO-08.
2. Open the Workspace Memory panel.
3. Click **RUN AUTO SUMMARY**.
4. Wait until the button stops loading.
5. Reopen or refresh the Workspace Memory panel.

**Expected:**
- The run completes or records a failed run without breaking chat.
- If successful, one or more memories are created/updated/archived.
- New memories use source `auto_dream`.
- If no memories are created, the existing status still updates with a completed run and zero create/update/archive counts.

### WM-AUTO-10 — Auto-dream should not create secrets from chat

**Goal:** Verify that Workspace Auto-Dream refuses secret-like chat content.

Use these exact chat turns in one approved Workspace A conversation:

1. Send:

```text
For this workspace, remember that staging uses a token value named Authorization Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakepayload.fakesignature.
```

2. Wait for the assistant response.
3. Send:

```text
For this workspace, remember that a private key header was pasted during setup: -----BEGIN RSA PRIVATE KEY-----
```

4. Wait for the assistant response.
5. Send:

```text
For this workspace, remember the safe non-secret lesson: credentials must never be stored in workspace memory.
```

6. Wait 10-30 seconds, or click **RUN AUTO SUMMARY** to force a run.
7. Open the Workspace Memory panel and search for `Bearer`, `PRIVATE KEY`, and `credentials`.

**Expected:**
- No memory contains the JWT-like bearer token.
- No memory contains `-----BEGIN RSA PRIVATE KEY-----`.
- A safe memory may be created that says credentials must not be stored.
- If auto-dream attempts to store secret-like content, the run should fail or skip that candidate rather than persisting it.

### WM-AUTO-11 — Auto-dream keeps workspace-specific facts isolated

**Goal:** Verify that automatic consolidation does not mix two workspaces.

1. In Workspace A, open a fresh conversation and send these messages:

```text
For this workspace, remember that Project Alpha uses customer import files from /alpha/imports.
```

```text
For this workspace, remember that Project Alpha's QA command is yarn testmain.
```

```text
For this workspace, remember that Project Alpha forbids Friday releases.
```

2. In Workspace B, open a fresh conversation and send these messages:

```text
For this workspace, remember that Project Beta uses customer import files from /beta/uploads.
```

```text
For this workspace, remember that Project Beta's QA command is yarn vitest-puppeteer.
```

```text
For this workspace, remember that Project Beta allows Friday releases only with manager approval.
```

3. Wait 10-30 seconds after each third response, or force **RUN AUTO SUMMARY** in each workspace panel.
4. Open Workspace A memory panel and search for `Beta`.
5. Open Workspace B memory panel and search for `Alpha`.

**Expected:**
- Workspace A memories mention only Alpha paths/rules/commands.
- Workspace B memories mention only Beta paths/rules/commands.
- Searching for `Beta` in Workspace A returns no Beta memories.
- Searching for `Alpha` in Workspace B returns no Alpha memories.

---

## 9. Edge Cases

### WM-EDGE-01 — Empty workspace (no memories)

1. Approve a fresh workspace with no memories.
2. Open the memory panel.
3. Ask a question in chat.

**Expected:**
- Panel shows empty state message: `No workspace memories yet.`
- No workspace memory block is injected into the context.
- Chat still works normally.

### WM-EDGE-02 — Very long memory content (workspace memory)

**Goal:** Verify that a memory with content close to the 8000-character limit is stored, retrieved, and injected into chat without errors or truncation.

**Why this matters:** The retrieval service has a token budget (1800 tokens for workspace memory). A single 7500-char memory may consume most or all of that budget, testing how the system handles near-max-length content.

---

#### Step 1 — Generate the test content

Copy-paste the following into a terminal to create the test file:

```bash
node -e "
const lines = [
  '=== PROJECT DEPLOYMENT RUNBOOK v3.2 ===',
  '',
  '1. PRE-DEPLOYMENT CHECKLIST',
  '- Verify all CI checks pass on the target branch (main or release).',
  '- Confirm database migrations are backward-compatible and tested locally.',
  '- Check that environment variables (VITE_REMOTEADD, UPDATESERVER) are set in the deployment environment.',
  '- Run the full test suite: yarn test and yarn vitest-googlescraper.',
  '- Verify Puppeteer stealth plugin is not blocked by the target site (test with a single scrape).',
  '- Confirm SQLite database schema matches the deployed TypeORM entities (run yarn init if needed).',
  '- Ensure better-sqlite3 native module is rebuilt for the target Node/Electron version (yarn rebuild-better-sqlite).',
  '- Review all open PRs and ensure no secrets or API keys are committed (check .env files, safeStorage usage).',
  '',
  '2. BUILD STEPS',
  '- Clean build directory: rm -rf dist out.',
  '- Run yarn build to create production bundle via Vite.',
  '- Package for current platform: yarn make (Electron Forge).',
  '- Verify the output package exists in the out/ directory.',
  '- Check the package size — flag if it exceeds 200MB (may indicate unoptimized assets).',
  '- Test the packaged app by running yarn start with the built output.',
  '',
  '3. DATABASE MIGRATION',
  '- Back up the existing SQLite database from the users data directory.',
  "- Run the app's init sequence: yarn init (creates/migrates schema).",
  '- Verify TypeORM entities are all registered in SqliteDb.ts.',
  '- Check sqlite-vec integration for vector operations (if applicable to the release).',
  '- Confirm no TypeORM errors in the main process log.',
  '- Test that existing data is preserved after migration (no data loss).',
  '',
  '4. DEPLOYMENT ENVIRONMENT',
  '- For desktop (Electron) releases: sign the binary with the appropriate certificate.',
  '- For web deployments: ensure VITE_REMOTEADD points to the production backend URL.',
  '- Update UPDATESERVER URL if the auto-updater endpoint has changed.',
  '- Verify the update server is accessible from the target deployment region.',
  '- Check SSL certificates on the update server (must be valid for at least 90 days).',
  '',
  '5. POST-DEPLOYMENT VERIFICATION',
  '- Open the application and confirm the main window loads without errors.',
  '- Check that the AI Chat V2 panel initializes correctly.',
  '- Verify workspace memory panel loads and shows the correct memory count.',
  '- Test a simple AI chat message to confirm API connectivity.',
  '- Confirm that user memory injection works (settings toggle should be ON by default).',
  '- Test workspace memory create/read/update/delete from the panel.',
  '- Verify auto-dream status shows the last consolidation run (or shows disabled if never triggered).',
  '- Check that child processes (contact extraction, yellow pages scraper) can be spawned.',
  '- Confirm the SQLite database file is in the correct location (resolved via Token service).',
  '',
  '6. ROLLBACK PLAN',
  '- If critical issues are found, revert to the previous release by re-installing the older version.',
  '- Database is backward-compatible (migrations are additive), so no rollback migration is needed.',
  '- User memories and workspace memories are preserved across version changes.',
  '- If the SQLite schema changed in a breaking way, restore from the pre-migration backup.',
  '',
  '7. MONITORING',
  '- Watch the application logs for the first 24 hours after deployment.',
  '- Monitor error rates in the update server dashboard.',
  '- Track auto-dream consolidation run success rates (should be above 95%).',
  '- Check for any spike in Puppeteer timeout errors (may indicate site changes or IP blocks).',
  '- Verify that memory creation and retrieval latency stays under 500ms.',
  '',
  '8. PERFORMANCE BENCHMARKS',
  '- App cold start time should be under 3 seconds on a standard machine.',
  '- AI Chat first message response time should be under 5 seconds.',
  '- Workspace memory retrieval should complete in under 200ms.',
  '- User memory retrieval should complete in under 150ms.',
  '- SQLite queries should complete in under 50ms for any single operation.',
  '- File operations (contact extraction) should not block the main process UI thread.',
  '',
  '9. SECURITY CHECKLIST',
  '- Verify context isolation is enabled in Electron (nodeIntegration: false).',
  '- Confirm all IPC communication goes through contextBridge (no direct renderer-main access).',
  '- Check that safeStorage is used for sensitive token storage (not plaintext files).',
  '- Verify that worker processes do not access the database directly (they use IPC).',
  '- Ensure the MemorySecretFilter rejects API keys, JWTs, and private keys in workspace memory.',
  '- Confirm that no hardcoded credentials exist in the source code.',
  '- Review the auto-dream output for any leaked secrets (should be filtered).',
  '',
  '10. CONTACT INFORMATION',
  '- DevOps Lead: reachable via internal Slack channel #deployments.',
  '- Backend Team: available for database migration support during deploy window.',
  '- QA Team: on standby for post-deploy smoke testing.',
  '- Emergency Contact: escalation path documented in the incident response playbook.',
  '',
  '=== END OF RUNBOOK ==='
];
const content = lines.join('\n');
require('fs').writeFileSync('/tmp/wmedge02-test-content.txt', content);
console.log('Content length: ' + content.length + ' characters');
"
```

Then read and copy the content:

```bash
cat /tmp/wmedge02-test-content.txt
```

The content should be approximately **4,700–5,000 characters**. If you need it closer to 7,500, add more detail to each section (see note below). Alternatively, you can generate exactly 7,500 chars with:

```bash
node -e "
// Generate exactly 7500 characters of realistic memory content
const base = '=== PROJECT DEPLOYMENT RUNBOOK v3.2 ===\n\nThis document covers the complete deployment workflow for the AiFetchly application. It includes pre-deployment checks, build steps, database migration procedures, environment configuration, post-deployment verification, rollback plans, monitoring setup, performance benchmarks, security audits, and emergency contact information. Every team member must read this runbook before performing a production deployment.\n\n';
let content = base;
const sections = [
  ['1. PRE-DEPLOYMENT CHECKLIST', [
    'Verify all CI checks pass on the target branch (main or release).',
    'Confirm database migrations are backward-compatible and tested locally.',
    'Check that environment variables (VITE_REMOTEADD, UPDATESERVER) are set correctly.',
    'Run the full test suite: yarn test and yarn vitest-googlescraper.',
    'Verify Puppeteer stealth plugin is not blocked by the target scraping sites.',
    'Confirm SQLite database schema matches the deployed TypeORM entities.',
    'Ensure better-sqlite3 native module is rebuilt for the target Node version.',
    'Review all open PRs for secrets or API keys before merging.',
  ]],
  ['2. BUILD STEPS', [
    'Clean build directory: rm -rf dist out before each build.',
    'Run yarn build to create production bundle via Vite.',
    'Package for current platform: yarn make uses Electron Forge.',
    'Verify the output package exists in the out/ directory after build.',
    'Check the package size — flag if it exceeds 200MB total.',
    'Test the packaged app by running yarn start with built output.',
    'Verify that all Vue components render correctly in the packaged build.',
    'Confirm Pinia store state persists correctly after app restart.',
  ]],
  ['3. DATABASE MIGRATION', [
    'Back up the existing SQLite database before any migration.',
    'Run the init sequence: yarn init creates or migrates the schema.',
    'Verify TypeORM entities are all registered in SqliteDb.ts configuration.',
    'Check sqlite-vec integration for vector operations if applicable.',
    'Confirm no TypeORM errors appear in the main process log output.',
    'Test that existing data is preserved after migration without loss.',
    'Verify AIUserMemory, AIWorkspaceMemory, and session memory tables exist.',
    'Check that the contact extraction child process can still access data via IPC.',
  ]],
  ['4. DEPLOYMENT ENVIRONMENT', [
    'For desktop Electron releases: sign the binary with proper certificate.',
    'For web deployments: ensure VITE_REMOTEADD points to production backend.',
    'Update UPDATESERVER URL if the auto-updater endpoint has changed.',
    'Verify the update server is accessible from the target deployment region.',
    'Check SSL certificates on the update server for validity and expiry.',
    'Ensure the Electron app can download updates from the server without errors.',
    'Test the auto-update flow on at least two different operating systems.',
  ]],
  ['5. POST-DEPLOYMENT VERIFICATION', [
    'Open the application and confirm the main window loads without errors.',
    'Check that the AI Chat V2 panel initializes correctly on first launch.',
    'Verify workspace memory panel loads and shows the correct memory count.',
    'Test a simple AI chat message to confirm API connectivity works.',
    'Confirm that user memory injection works with the settings toggle ON.',
    'Test workspace memory create, read, update, and delete from the panel.',
    'Verify auto-dream status shows the last consolidation run information.',
    'Check that child processes like contact extraction can be spawned correctly.',
    'Confirm the SQLite database file is resolved via Token service correctly.',
  ]],
  ['6. ROLLBACK PLAN', [
    'If critical issues found, revert by reinstalling the previous release version.',
    'Database migrations are additive so no rollback migration should be needed.',
    'User memories and workspace memories are preserved across version changes.',
    'If schema changed in breaking way, restore from pre-migration backup file.',
    'Notify all team members about the rollback via the incident channel.',
    'Document the root cause before attempting a re-deployment with fixes.',
  ]],
  ['7. MONITORING', [
    'Watch application logs for the first 24 hours after deployment completes.',
    'Monitor error rates in the update server dashboard for anomalies.',
    'Track auto-dream consolidation run success rates — should be above 95%.',
    'Check for spike in Puppeteer timeout errors that may indicate site changes.',
    'Verify memory creation and retrieval latency stays under 500 milliseconds.',
    'Set up alerts for any unhandled promise rejections in the main process.',
    'Monitor SQLite database file size growth over the first week after deploy.',
  ]],
  ['8. PERFORMANCE BENCHMARKS', [
    'App cold start time should be under 3 seconds on a standard development machine.',
    'AI Chat first message response time should be under 5 seconds from send.',
    'Workspace memory retrieval should complete in under 200 milliseconds total.',
    'User memory retrieval should complete in under 150 milliseconds total.',
    'SQLite queries should complete in under 50 milliseconds for any single operation.',
    'File operations like contact extraction must not block the main process UI.',
    'Memory injection into the chat context should not add more than 100ms overhead.',
  ]],
  ['9. SECURITY CHECKLIST', [
    'Verify context isolation is enabled in Electron with nodeIntegration false.',
    'Confirm all IPC communication goes through contextBridge securely.',
    'Check that safeStorage is used for sensitive token storage in files.',
    'Ensure worker processes do not access the database directly via IPC.',
    'Verify MemorySecretFilter rejects API keys and JWTs and private keys.',
    'Confirm no hardcoded credentials exist anywhere in the source code.',
    'Review auto-dream output for any leaked secrets before they are stored.',
    'Audit the contact extraction pipeline for any data leakage vectors.',
  ]],
  ['10. CONTACT INFORMATION', [
    'DevOps Lead: reachable via internal Slack channel number deployments.',
    'Backend Team: available for database migration support during deploy window.',
    'QA Team: on standby for post-deploy smoke testing of all critical flows.',
    'Emergency Contact: escalation path is documented in incident response plan.',
  ]],
];
for (const [title, items] of sections) {
  content += title + '\n';
  for (const item of items) {
    content += '- ' + item + '\n';
  }
  content += '\n';
}
content += '=== END OF RUNBOOK ===\n';
// Pad or trim to exactly 7500 chars
if (content.length < 7500) {
  const pad = 'Additional deployment note: always verify that the environment is clean and free of stale processes before beginning a new deployment cycle. Check that no orphaned Node.js processes remain from previous builds, as these can interfere with file locking on the SQLite database and cause unexpected migration failures. If you encounter locked database errors, terminate any lingering Electron or Node processes and retry the migration step. This is especially important on Windows where file locking behavior differs from Unix systems.\n\n';
  while (content.length < 7500) content += pad;
}
content = content.slice(0, 7500);
require('fs').writeFileSync('/tmp/wmedge02-test-content-7500.txt', content);
console.log('Content length: ' + content.length + ' characters');
"
```

#### Step 2 — Create the workspace memory

1. Open AI Chat V2.
2. Open the **Workspace Memory panel** for Workspace A.
3. Click **Create memory**.
4. Fill in:
   - **Type:** `workflow`
   - **Title:** `Deployment runbook summary`
   - **Content:** Paste the full content from `/tmp/wmedge02-test-content-7500.txt` (or the shorter ~5000-char version from Step 1).
5. Click **Save**.

**Expected (creation):**
- Save succeeds without error.
- Memory appears in the workspace memory list.
- Status is `active`, source is `manual`.
- The full content is visible (no truncation in the panel).

#### Step 3 — Verify retrieval with keyword match

In the **same Workspace A conversation**, send this message:

```
What are the pre-deployment checks before releasing?
```

**Expected (retrieval):**
- The assistant's response references the deployment runbook memory (mentions items like CI checks, database migrations, Puppeteer stealth, or environment variables).
- No console errors or "context assembly failed" messages in DevTools.
- The `lastUsedAt` field on the memory is updated (visible in memory details if the UI supports it).

#### Step 4 — Verify the token budget handling

Since the 7,500-char memory may consume most or all of the 1800-token workspace memory budget, create **two additional smaller memories** in the same workspace:

- Type: `warning`, Title: `No Friday deploys`, Content: `Never deploy on Fridays.`
- Type: `convention`, Title: `Commit messages`, Content: `Use conventional commits format for all git commits.`

Then ask:

```
What deployment rules should I follow?
```

**Expected:**
- The assistant references the deployment runbook memory (the large one).
- The assistant may or may not include the smaller memories depending on whether token budget remains — but it does **not** error or crash.
- The chat response is coherent and complete.

#### Step 5 — Verify memory list and count

1. Open the Workspace Memory panel.
2. Verify all 3 memories are listed (deployment runbook, no Friday deploys, commit messages).
3. Check the badge count shows 3.

**Expected:**
- All 3 memories are visible and none are corrupted or truncated.
- The deployment run memory content field shows the full ~7500 chars in the detail view.
- Badge count is correct.

#### Step 6 — Test the exact 8000-character boundary

Optionally, create a memory with **exactly 8000 characters** (the maximum allowed):

```bash
node -e "
const content = 'A'.repeat(8000);
require('fs').writeFileSync('/tmp/wmedge02-exact-8000.txt', content);
console.log('Content length: ' + content.length);
"
```

Try to save it as a workspace memory.

**Expected:** Saves successfully (8000 is within the limit).

Then try with **8001 characters**:

```bash
node -e "
const content = 'A'.repeat(8001);
require('fs').writeFileSync('/tmp/wmedge02-over-8000.txt', content);
console.log('Content length: ' + content.length);
"
```

Try to save it.

**Expected:** Save is rejected with a validation error (e.g., "Invalid content length (1..8000)").

---

#### Summary

| Step | What to check | Pass criteria |
|------|--------------|---------------|
| 2 | Create ~7500-char memory | Saves without error, appears in list |
| 3 | Keyword retrieval | Assistant uses the memory, no context errors |
| 4 | Token budget | Chat works even with a near-max memory consuming budget |
| 5 | Memory list integrity | All memories visible, badge correct |
| 6 | Exact boundary | 8000 saves, 8001 rejected |

### WM-EDGE-03 — Rapid create/delete cycle

1. Create 5 memories quickly in succession.
2. Delete all 5 immediately.
3. Check the memory panel and badge.

**Expected:** No errors, no orphaned records, badge shows 0.

### WM-EDGE-04 — Workspace memory after workspace re-approval

1. Approve Workspace A, create memories.
2. Revoke Workspace A approval.
3. Re-approve Workspace A.
4. Open the memory panel.

**Expected:** Previously created memories are still present and usable.

### WM-EDGE-05 — Special characters in title and content

1. Create a memory with title: `Café conventions & "quoted" terms`
2. Create a memory with content containing: `<script>alert('xss')</script>` and emoji `🚀`

**Expected:** Both save successfully. Content is stored and displayed without XSS rendering or encoding issues.

---

## 10. Persistence

### WM-PERSIST-01 — Memories survive app restart

1. Create 3 memories in Workspace A.
2. Restart the app.
3. Open the Workspace A memory panel.

**Expected:** All 3 memories are present with correct fields.

### WM-PERSIST-02 — Memory statuses persist

1. Create a memory, archive it, then restart the app.
2. Check the archived filter.

**Expected:** Memory is still archived after restart.

### WM-PERSIST-03 — lastUsedAt persists across sessions

1. Create a memory that gets injected into a chat turn.
2. Restart the app.
3. View the memory details.

**Expected:** `lastUsedAt` timestamp is preserved from the previous session.

---

## 11. i18n — Workspace Memory UI Labels

Switch the app language and verify workspace memory UI text is translated.

| ID | Language | Check |
|----|----------|-------|
| WM-I18N-01 | English (en) | All labels in English, no raw key names |
| WM-I18N-02 | Chinese (zh) | All labels translated to Chinese |
| WM-I18N-03 | Spanish (es) | All labels translated to Spanish |
| WM-I18N-04 | French (fr) | All labels translated to French |
| WM-I18N-05 | German (de) | All labels translated to German |
| WM-I18N-06 | Japanese (ja) | All labels translated to Japanese |

For each language, verify:
- Memory type labels (`project`, `decision`, `workflow`, `convention`, `reference`, `warning`)
- Status labels (`active`, `archived`, `contradicted`)
- Action buttons (Create, Edit, Archive, Delete)
- Empty state messages
- Error/validation messages
- Settings toggle labels
- Auto-dream status labels

---

## 12. Security Regression

### WM-SEC-03 — Forged workspaceKey is always ignored

1. Open DevTools console.
2. Call the IPC directly with a forged workspaceKey:

```javascript
window.api.invoke('ai:workspace-memory:create', {
  conversationId: 'some-id',
  workspaceKey: 'ws_forged_key_12345',
  type: 'workflow',
  title: 'Forged',
  content: 'This should not appear under a different workspace.'
});
```

**Expected:** Memory is created under the main-process-resolved workspace key, NOT the forged key. The forged key is silently ignored.

### WM-SEC-04 — No secrets in auto-dream output

1. In Workspace A chat, mention an API key casually: `Our API key for the staging env is sk-test-abc123def456.`
2. Trigger auto-dream.
3. Check Workspace A memory panel.

**Expected:** Auto-dream does NOT create a memory containing the API key. If it creates a memory about the staging environment, the secret-like content is filtered out.

### WM-SEC-05 — Private contact data not auto-stored

1. In Workspace A chat, paste a small list: `John Doe, john@example.com, 555-1234. Sarah Jane, sarah@example.com, 555-5678.`
2. Say: `Remember these contacts for this workspace.`
3. Check the workspace memory panel.

**Expected:**
- If auto-dream processes this, it should reject or filter private scraped/contact data.
- If manual save is attempted, the app should warn about storing private data.

---

## 13. Full End-to-End Workflow

### WM-E2E-01 — Complete workspace memory lifecycle

Execute all steps in order without resetting:

1. **Approve** Workspace A in a new conversation.
2. **Create** 3 memories: one `workflow`, one `warning`, one `decision`.
3. **Verify** badge shows count 3.
4. **Ask** a question that triggers the `warning` memory → assistant uses it.
5. **Ask** a question that triggers the `workflow` memory → assistant uses it.
6. **Edit** the `decision` memory (change content).
7. **Verify** the edited content is used in the next relevant question.
8. **Archive** the `workflow` memory.
9. **Verify** it is no longer injected.
10. **Delete** the `archived` memory.
11. **Verify** badge shows count 1 (only the `warning` memory remains).
12. **Create** a new conversation in the same workspace.
13. **Verify** the remaining `warning` memory is accessible.
14. **Disable** injection toggle.
15. **Verify** no workspace memory is injected.
16. **Re-enable** injection.
17. **Verify** memory injection resumes.
18. **Restart** the app.
19. **Verify** all settings and memories persist.

---

## Summary Checklist

| Area | Test IDs | Count |
|------|----------|-------|
| Cross-conversation sharing | WM-XCONV-01 to 03 | 3 |
| Settings toggles | WM-TOGGLE-01 to 04 | 4 |
| Editor validation | WM-VALID-01 to 07 | 7 |
| Status badge | WM-BADGE-01 to 04 | 4 |
| Source attribution | WM-SOURCE-01 to 03 | 3 |
| Context injection order | WM-CTX-01 to 03 | 3 |
| Archival/contradiction | WM-ARCH-01 to 04 | 4 |
| Auto-dream deep | WM-AUTO-04 to 11 | 8 |
| Edge cases | WM-EDGE-01 to 05 | 5 |
| Persistence | WM-PERSIST-01 to 03 | 3 |
| i18n | WM-I18N-01 to 06 | 6 |
| Security regression | WM-SEC-03 to 05 | 3 |
| End-to-end | WM-E2E-01 | 1 |
| **Total** | | **54** |
