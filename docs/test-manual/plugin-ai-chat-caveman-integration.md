# Plugin AI Chat Integration — caveman-main Plugin

**Plugin**: `caveman-main` (located at `/home/robertzeng/tmp/workspacetest/caveman-main`)
**Test date**: 2026-07-21
**Related PRD**: `docs/prd/plugin-subagent-management-prd.md`
**Related file**: `src/views/components/aiChatV2/AiChatV2.vue`

## Plugin contents

The `caveman-main` plugin contains 3 agents discovered via auto-detection from its `agents/` directory (no `agents` field in `plugin.json`):

| Agent | ID (expected) | Tools | Model | Description |
|-------|---------------|-------|-------|-------------|
| `cavecrew-investigator` | `plugin:caveman:cavecrew-investigator` | Read, Grep, Glob, Bash | haiku | Read-only code locator |
| `cavecrew-builder` | `plugin:caveman:cavecrew-builder` | Read, Edit, Write, Grep, Glob | — | Surgical 1-2 file editor |
| `cavecrew-reviewer` | `plugin:caveman:cavecrew-reviewer` | Read, Grep, Bash | haiku | Diff/branch/file reviewer |

---

## Phase 1: Plugin Installation & Agent Registration

### TC-1.1 — Plugin install triggers agent import
1. Open aiFetchly → Settings → Plugins
2. Install the `caveman-main` plugin
3. **Verify**: Install succeeds without errors
4. Open plugin detail → **Subagents** tab
5. **Verify**: 3 agents listed: `cavecrew-investigator`, `cavecrew-builder`, `cavecrew-reviewer`
6. **Verify**: Each row shows correct name, description, tool count, mode, health=`healthy`, status=`active`

### TC-1.2 — Agents appear in Subagents management page
1. Navigate to Settings → Subagents
2. Filter by Source = `plugin`
3. **Verify**: All 3 caveman agents shown
4. **Verify**: Source column shows `Plugin` chip
5. **Verify**: Plugin column shows `caveman` chip
6. **Verify**: Tool column shows correct counts: Investigator=4, Builder=5, Reviewer=3
7. **Verify**: Model column: Investigator=`haiku`, Builder=`—`, Reviewer=`haiku`

### TC-1.3 — Agent detail panel shows full definition
1. Click on `cavecrew-investigator` row in Subagents page
2. **Verify**: Detail dialog opens with all fields: ID, name, description, source=`Plugin`, pluginName=`caveman`, mode, allowedTools=[Read,Grep,Glob,Bash], maxToolCalls, maxRuntime, systemPrompt visible
3. **Verify**: System prompt is the Markdown body from `agents/cavecrew-investigator.md` (Caveman-ultra instructions)
4. **Verify**: System prompt area has a readonly hint ("Plugin agents are read-only")
5. **Verify**: No edit or delete buttons shown (plugin agents are read-only)

### TC-1.4 — Agent-only plugin validation (caveman has no skills/MCP declared)
1. Open plugin detail → Overview tab
2. **Verify**: Skill count = 0 (or whatever the plugin declares), MCP server count = 0 (or whatever the plugin declares), Agent count = 3

---

## Phase 2: Plugin Agent Enable/Disable

### TC-2.1 — Disable a single plugin agent
1. In Subagents page, toggle `cavecrew-reviewer` OFF
2. **Verify**: Status changes to disabled
3. Reload the page
4. **Verify**: Status persists as disabled after reload
5. In Plugin detail → Subagents tab, verify the same agent also shows disabled

### TC-2.2 — Disabled agent excluded from AI chat runtime
1. With `cavecrew-reviewer` disabled, open AI Chat
2. Start a new conversation
3. Send: "What agents are available for me to use?"
4. **Verify**: AI lists only `cavecrew-investigator` and `cavecrew-builder` — reviewer is absent

### TC-2.3 — Re-enable agent
1. Toggle `cavecrew-reviewer` back ON in Subagents page
2. Open AI Chat → send "What agents are available?"
3. **Verify**: All 3 agents now appear

### TC-2.4 — Disable entire plugin hides all agents
1. Go to Settings → Plugins → disable the `caveman` plugin
2. Go to Settings → Subagents
3. **Verify**: All 3 caveman agents show as unavailable (plugin disabled indicator)
4. Open AI Chat → send "What agents are available?"
5. **Verify**: No caveman agents listed
6. Re-enable the plugin
7. **Verify**: Agents reappear; their previous individual enabled/disabled states are preserved

---

## Phase 3: AI Chat — Agent Discovery & Invocation

### TC-3.1 — AI discovers plugin agents via system message
1. Ensure all 3 agents are enabled
2. Open AI Chat, start a new conversation
3. Send: "What agents are available for me to use?"
4. **Verify**: AI lists the 3 caveman agents with their IDs and descriptions (from the "Available agents" system message block)

### TC-3.2 — Invoke cavecrew-investigator via AI chat
1. Set a workspace to the aiFetchly project root (or any project with source code)
2. Send: "Use the cavecrew-investigator agent to find where AgentRuntime is defined"
3. **Verify**: AI calls `run_subagent` with agentId matching the caveman investigator
4. Open AgentTaskListDialog (list icon in chat header)
5. **Verify**: Task appears with status `running` → `completed`
6. **Verify**: Result in chat is file:line references in compressed format (no prose), matching the agent's output spec

### TC-3.3 — Invoke cavecrew-reviewer via AI chat
1. Send: "Use cavecrew-reviewer to review src/service/AgentRuntime.ts"
2. **Verify**: AI invokes `run_subagent` with reviewer agent
3. Open AgentTaskListDialog
4. **Verify**: Task completes
5. **Verify**: Output uses severity-tagged format: `path:line: <emoji> <severity>: <problem>. <fix>.` with 🔴/🟡/🔵/❓

### TC-3.4 — Invoke cavecrew-builder via AI chat
1. Send: "Use cavecrew-builder to fix the typo on line 12 of src/views/api/agents.ts"
2. **Verify**: AI invokes `run_subagent` with builder agent
3. **Verify**: Builder outputs a receipt: `<path:line-range> — <change ≤10 words>.` with `verified: <re-read OK | mismatch @ path:line>.`
4. **Verify**: If the agent performed an edit, the actual file was changed

### TC-3.5 — Agent task appears in task list dialog
1. During an agent invocation, click the AgentTaskListDialog icon in the chat header
2. **Verify**: Dialog opens showing active tasks
3. **Verify**: Task shows agent name, status (running/completed/failed), tool call count, elapsed time
4. **Verify**: Cancel button is present for running tasks

---

## Phase 4: Agent Tool Restrictions & Behavior

### TC-4.1 — Investigator refuses to edit files
1. Send: "Use cavecrew-investigator to write a new file called test.txt"
2. **Verify**: Agent refuses and returns: "Read-only. Spawn cavecrew-builder."

### TC-4.2 — Reviewer refuses to edit files
1. Send: "Use cavecrew-reviewer to edit src/config/SqliteDb.ts"
2. **Verify**: Agent refuses — no edit/write tools in its allowedTools

### TC-4.3 — Builder refuses 3+ file scope
1. Send: "Use cavecrew-builder to refactor all modules in src/modules/"
2. **Verify**: Agent returns: `too-big. split: <n one-line tasks>.`

### TC-4.4 — Investigator output format is compressed
1. Send: "Use cavecrew-investigator to find all usages of the Token class"
2. **Verify**: Output follows the specified format:
   ```
   <path:line> — `<symbol>` — <≤6 word note>
   ```
3. **Verify**: Grouped with one-word headers (`Defs:`, `Refs:`, `Callers:`, etc.) when 3+ rows
4. **Verify**: Totals line at the end (e.g., `2 defs, 5 refs.`)

### TC-4.5 — Reviewer skips formatting nits unless asked
1. Send: "Use cavecrew-reviewer to do a quick review of src/views/api/agents.ts"
2. **Verify**: No 🔵 nit findings unless the review specifically asks for thorough review
3. Send: "Use cavecrew-reviewer to do a thorough review of src/views/api/agents.ts"
4. **Verify**: 🔵 nit findings may now appear for style/naming issues

---

## Phase 5: Edge Cases & Error Handling

### TC-5.1 — Agent invocation with no workspace set
1. Start a new conversation without setting a workspace
2. Send: "Use cavecrew-investigator to find AgentRuntime"
3. **Verify**: Agent still runs (agents work without workspace if they don't need workspace-relative paths, or the AI handles the missing workspace gracefully)

### TC-5.2 — Concurrent agent tasks
1. Send two messages requesting different agents in quick succession:
   - "Use cavecrew-investigator to find all uses of the Token class"
   - "Use cavecrew-reviewer to review src/views/api/agents.ts"
2. Open AgentTaskListDialog
3. **Verify**: Both tasks appear with independent statuses and both complete

### TC-5.3 — Agent with missing required tool
1. Disable one of the tools that `cavecrew-investigator` needs (e.g., disable `Grep` if possible at plugin level)
2. Send: "Use cavecrew-investigator to find AgentRuntime"
3. **Verify**: Agent either uses remaining tools or reports tool unavailability; health may reflect `partial_load`

### TC-5.4 — Cancel a running agent task
1. Send a message that triggers a long-running agent task (e.g., investigator with a broad search)
2. Open AgentTaskListDialog while task is running
3. Click Cancel on the task
4. **Verify**: Task status changes to `cancelled` or `failed`

---

## Phase 6: Plugin Uninstall Cleanup

### TC-6.1 — Uninstall removes agent definitions
1. Note the 3 caveman agents in Subagents page
2. Go to Settings → Plugins → uninstall `caveman`
3. **Verify**: Uninstall succeeds
4. Go to Settings → Subagents
5. **Verify**: All 3 caveman agents are gone

### TC-6.2 — Uninstall does not affect other agents
1. Have a built-in agent (`agent-lead-researcher`) and/or user-created agents present
2. Uninstall caveman plugin
3. **Verify**: Built-in and user agents still exist in Subagents page

### TC-6.3 — Uninstall clears AI chat runtime
1. After uninstalling, open AI Chat
2. Send: "What agents are available?"
3. **Verify**: No caveman agents listed

---

## Quick Smoke Test (happy path)

1. Install `caveman-main` plugin → verify 3 agents in Subagents page with `Plugin` source chip
2. Open AI Chat → set workspace to aiFetchly project root
3. Send: "**Use cavecrew-investigator** to find where `AgentRuntime.runSync` is defined"
4. Watch AgentTaskListDialog → task completes with file:line references in compressed format
5. Send: "**Use cavecrew-reviewer** to review `src/service/AgentRuntime.ts`"
6. Verify severity-tagged findings returned (🔴/🟡/🔵/❓)
7. Send: "**Use cavecrew-builder** to fix the typo on line 12 of `src/views/api/agents.ts`"
8. Verify builder outputs a diff receipt with verification status
9. Done — plugin agents are working end-to-end

---

## Test Execution Checklist

| # | Test Case | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| TC-1.1 | Plugin install triggers agent import | | |
| TC-1.2 | Agents appear in Subagents page | | |
| TC-1.3 | Agent detail panel shows full definition | | |
| TC-1.4 | Agent-only plugin validation | | |
| TC-2.1 | Disable single plugin agent | | |
| TC-2.2 | Disabled agent excluded from runtime | | |
| TC-2.3 | Re-enable agent | | |
| TC-2.4 | Disable plugin hides all agents | | |
| TC-3.1 | AI discovers plugin agents | | |
| TC-3.2 | Invoke cavecrew-investigator | | |
| TC-3.3 | Invoke cavecrew-reviewer | | |
| TC-3.4 | Invoke cavecrew-builder | | |
| TC-3.5 | Agent task in task list dialog | | |
| TC-4.1 | Investigator refuses edit | | |
| TC-4.2 | Reviewer refuses edit | | |
| TC-4.3 | Builder refuses 3+ file scope | | |
| TC-4.4 | Investigator output format | | |
| TC-4.5 | Reviewer skips formatting nits | | |
| TC-5.1 | Agent invocation with no workspace | | |
| TC-5.2 | Concurrent agent tasks | | |
| TC-5.3 | Agent with missing required tool | | |
| TC-5.4 | Cancel running agent task | | |
| TC-6.1 | Uninstall removes agent definitions | | |
| TC-6.2 | Uninstall does not affect other agents | | |
| TC-6.3 | Uninstall clears AI chat runtime | | |
