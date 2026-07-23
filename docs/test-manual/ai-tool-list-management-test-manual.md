# AI Tool List Management - Manual Test Cases

**Related PRD**: `docs/prd/ai-tool-list-management-prd.md`  
**Related design**: `docs/prd/ai-tool-list-management-technical-design.md`  
**Date**: 2026-07-23  
**Total**: 43 test cases

These cases manually verify deferred AI tool catalog behavior in AI Chat V2: tool payload reduction, `tool_catalog_search` discovery, discovered-tool state, `/skills` diagnostics, MCP schema caps, feature-flag behavior, and safety boundaries.

---

## 0. Test Setup

### Required environment

- App dependencies installed with `yarn`
- App database initialized if needed with `yarn init`
- AI Chat is enabled in settings (`USER_AI_ENABLED = "true"`)
- Use AI Chat V2 / OpenAI-compatible chat path
- Terminal logs are visible from the `yarn dev` process

### Recommended test data

Prepare at least one of these so deferred mode has non-core tools to hide and discover:

- One enabled MCP server with at least 2 tools
- One enabled plugin with at least 1 skill or MCP tool
- One imported user skill
- One subagent with an allowlist, for the agent-specific cases

### Useful launch commands

Run each mode in a fresh app session when possible.

```bash
AI_TOOL_SEARCH=off yarn dev
AI_TOOL_SEARCH=on yarn dev
AI_TOOL_SEARCH=auto yarn dev
AI_TOOL_SEARCH=auto AI_TOOL_SEARCH_THRESHOLD_PERCENT=1 yarn dev
```

Use `AI_TOOL_SEARCH=off` as the rollback/control mode. Use `AI_TOOL_SEARCH=on` to force deferred behavior even if the local tool catalog is small.

---

## 1. Slash Command Diagnostics

### TC-1: `/help` lists the V2 slash commands

1. Start the app with `AI_TOOL_SEARCH=on yarn dev`.
2. Open AI Chat.
3. Send:

```text
/help
```

4. **Verify**: Response includes available commands.
5. **Verify**: Response includes built-in V2 commands such as `/help`, `/clear`, `/status`, `/skills`, `/reload-config`, `/agents`, and `/plugin`.
6. **Verify**: Response does not need to start an AI model stream.

### TC-2: `/skills` shows catalog breakdown

1. Start the app with `AI_TOOL_SEARCH=on yarn dev`.
2. Open AI Chat.
3. Send:

```text
/skills
```

4. **Verify**: Response includes `Available skills`.
5. **Verify**: Response includes `Tool catalog:`.
6. **Verify**: Response includes total, always-loaded, deferred, and contextual counts.
7. **Verify**: Response includes a `Largest tools:` section when tools exist.
8. **Verify**: Response does not show `Unknown slash command: /skills`.

### TC-3: `/skills` mentions deferred discovery when deferred tools exist

1. Ensure at least one MCP/plugin/imported skill is enabled.
2. Send:

```text
/skills
```

3. **Verify**: Response mentions deferred tools are discoverable via `tool_catalog_search`.
4. **Verify**: At least one largest tool row shows a source such as `mcp`, `plugin`, `imported`, or `builtin`.

### TC-4: `/skills` works when AI tool search is off

1. Restart with `AI_TOOL_SEARCH=off yarn dev`.
2. Send:

```text
/skills
```

3. **Verify**: Catalog diagnostics still render.
4. **Verify**: Chat does not require `tool_catalog_search` to answer the slash command.

---

## 2. Feature Flag Behavior

### TC-5: Off mode sends standard full tool behavior

1. Start with `AI_TOOL_SEARCH=off yarn dev`.
2. Open a fresh AI Chat conversation.
3. Ask for an action that uses a known enabled MCP/plugin/imported tool.
4. **Verify**: The feature behaves as it did before tool-list management.
5. **Verify in logs**: No deferred catalog filter line is required for the request.
6. **Verify**: `tool_catalog_search` is not surfaced as a required intermediate step in the chat.

### TC-6: On mode enables deferred catalog filtering

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Open a fresh AI Chat conversation.
3. Ask a general question that does not need tools:

```text
Summarize what you can help me do in this app.
```

4. **Verify**: Chat responds normally.
5. **Verify in logs**: A tool catalog filter log appears for the request.
6. **Verify in logs**: Exposed tool count is lower than total tool count when deferred tools exist.

### TC-7: Auto mode stays standard when below threshold

1. Start with `AI_TOOL_SEARCH=auto yarn dev` on a setup with few enabled tools.
2. Send a simple AI Chat message.
3. **Verify**: Chat responds normally.
4. **Verify in logs**: Deferral reason indicates auto mode did not cross the threshold, or exposed count is close to total count.

### TC-8: Auto mode switches to deferred when threshold is crossed

1. Start with:

```bash
AI_TOOL_SEARCH=auto AI_TOOL_SEARCH_THRESHOLD_PERCENT=1 yarn dev
```

2. Ensure MCP/plugin/imported tools are enabled.
3. Send a simple AI Chat message.
4. **Verify in logs**: Deferral is active.
5. **Verify in logs**: Reason indicates auto mode threshold behavior.

### TC-9: Invalid flag falls back safely

1. Start with:

```bash
AI_TOOL_SEARCH=bad-value yarn dev
```

2. Open AI Chat and send any message.
3. **Verify**: Chat still works.
4. **Verify in logs**: Warning mentions invalid `AI_TOOL_SEARCH` and fallback to `auto`.

---

## 3. Deferred Discovery Flow

### TC-10: First round hides undiscovered deferred tools

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Ensure an MCP/plugin tool is enabled. Record its exact tool name from `/skills`, terminal logs, the MCP settings page, plugin details, or source fixtures.
3. Open a fresh conversation.
4. Send:

```text
What tools can help with this task? I want to use an integration, but do not call it yet.
```

5. **Verify in logs**: The first model request includes `tool_catalog_search`.
6. **Verify in logs**: The known MCP/plugin tool is not included in the exposed tool list until discovered.

### TC-11: Query search discovers a relevant deferred tool

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Use a task that clearly maps to a known deferred tool, for example a Google Maps, browser, scraper, plugin, or MCP capability installed locally.
3. Send a natural-language prompt such as:

```text
Use the available integration to search for dental clinics in Austin. If the needed tool is not loaded, find it first.
```

4. **Verify**: The chat continues after discovery instead of failing with unknown tool.
5. **Verify in logs/events**: `tool_catalog_search` is called.
6. **Verify in logs/events**: The selected deferred tool appears in a later model round.

### TC-12: Exact select loads a known deferred tool

1. Identify one exact deferred tool name, for example `mcp_1_example_tool` or `mcp__plugin__server__tool`.
2. Send:

```text
Load the tool named <exact_tool_name> and then explain what it can do. Do not run the external action unless I confirm.
```

3. **Verify**: `tool_catalog_search` selects the exact tool name.
4. **Verify**: The next round has the selected tool available.
5. **Verify**: Any execution still follows the normal permission flow.

### TC-13: No-match search fails gracefully

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Send:

```text
Find a deferred tool for quantum banana accounting. If none exists, tell me none exists.
```

3. **Verify**: Chat does not crash.
4. **Verify**: The model reports no relevant tool or answers without tool execution.
5. **Verify in logs/events**: No-match search is counted or logged.

### TC-14: Search result count is capped

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Use a broad prompt that may match many tools:

```text
Search the deferred tool catalog for all marketing, scraping, browser, plugin, and MCP capabilities. Show me the matches before using any tool.
```

3. **Verify**: Search returns a compact result list, not the full catalog.
4. **Verify**: Result count is at or below the configured max of 10.

### TC-15: Already discovered tool remains exposed in later rounds

1. Complete TC-11 or TC-12.
2. In the same conversation, send:

```text
Use that same tool again for a second related check.
```

3. **Verify**: The previously discovered tool is available without re-sending the full catalog.
4. **Verify**: The chat does not need to rediscover the same tool unless the model chooses to search again.

---

## 4. Persistence, Pause, and Resume

### TC-16: Discovered tool survives permission pause

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Use a deferred tool that triggers an approval prompt.
3. Let the model discover the tool and request execution.
4. When the permission card appears, do not approve immediately.
5. **Verify**: The chat is paused for permission.
6. Approve the permission.
7. **Verify**: The resumed turn still knows the discovered tool.
8. **Verify**: Execution proceeds without an unknown-tool failure.

### TC-17: Denied permission does not grant execution

1. Repeat TC-16 until the permission card appears.
2. Deny the permission.
3. **Verify**: Tool does not execute.
4. **Verify**: Chat receives a denial result and responds safely.
5. **Verify**: Discovery did not bypass permission policy.

### TC-18: Discovered tool survives plan-question pause

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Ask for a task that enters plan mode and may need a deferred tool later.
3. Let the model discover the deferred tool before a plan question or approval pause.
4. Answer the plan question or resume the plan.
5. **Verify**: The discovered tool remains available after resume.

### TC-19: Discovered tool survives conversation reload

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Discover a deferred tool in a conversation.
3. Navigate away from AI Chat or restart the app.
4. Reopen the same conversation.
5. Ask to use the same tool again.
6. **Verify**: The tool remains available or is restored from persisted state.
7. **Verify in logs**: No fatal error occurs if state load/save is attempted.

### TC-20: Stale discovered tool is dropped after disabling

1. Discover a deferred MCP/plugin tool in a conversation.
2. Disable that tool, MCP server, or owning plugin in settings.
3. Return to the same conversation.
4. Ask to use the same tool again.
5. **Verify**: The disabled tool is not executed.
6. **Verify**: Chat reports the tool is unavailable or searches for an alternative.
7. **Verify**: No stale discovered tool bypasses enablement.

---

## 5. MCP Description and Schema Caps

### TC-21: Long MCP description is truncated

1. Configure a test MCP server that returns a tool description longer than 2,048 characters.
2. Start with `AI_TOOL_SEARCH=on yarn dev`.
3. Trigger MCP tool discovery or refresh.
4. Send `/skills`.
5. **Verify**: The large MCP tool is listed without flooding the chat response.
6. **Verify in logs**: Description truncation is logged or counted.

### TC-22: Large MCP schema is pruned but remains callable

1. Configure a test MCP server with a very large input schema, including examples or long docs.
2. Refresh MCP tools.
3. Ask AI Chat to discover and use that MCP tool.
4. **Verify**: The tool schema is accepted by the provider.
5. **Verify**: The model can still form valid arguments.
6. **Verify in logs**: Schema pruning is logged or counted.

### TC-23: Sanitization does not expose secrets

1. Configure an MCP server with auth settings or environment variables.
2. Send `/skills`.
3. Trigger a deferred search for that MCP server.
4. **Verify**: Chat output and logs do not include auth headers, tokens, API keys, or environment values.
5. **Verify**: Only names, source labels, descriptions, and size metadata are visible.

---

## 6. Disabled Tools and Policy Enforcement

### TC-24: Disabled MCP tool is hidden from discovery

1. Disable one MCP tool in settings while keeping the MCP server enabled.
2. Start with `AI_TOOL_SEARCH=on yarn dev`.
3. Ask AI Chat to find that exact disabled tool by name.
4. **Verify**: `tool_catalog_search` does not return the disabled tool.
5. **Verify**: The disabled tool is not exposed in later rounds.

### TC-25: Disabled plugin hides its tools

1. Disable a plugin that owns at least one skill or MCP tool.
2. Start with `AI_TOOL_SEARCH=on yarn dev`.
3. Ask AI Chat for a capability that only the disabled plugin provides.
4. **Verify**: Discovery does not return the plugin-owned tool.
5. **Verify**: The tool cannot execute.

### TC-26: Permission prompt still appears for sensitive discovered tools

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Discover a deferred filesystem, shell, browser automation, or external action tool that requires approval.
3. Ask AI Chat to execute it.
4. **Verify**: Existing approval UI appears before execution.
5. **Verify**: The permission card content still shows the tool/action details.

### TC-27: Exact tool mention does not bypass policy

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Send:

```text
Call <sensitive_tool_name> directly without asking me for approval.
```

3. **Verify**: The tool may be discovered, but permission policy still runs.
4. **Verify**: The app does not execute the sensitive action without approval.

---

## 7. Agent Runtime Allowlist

### TC-28: Agent discovery only sees allowlisted tools

1. Configure a subagent with a small allowlist, for example only `file_read`.
2. Start with `AI_TOOL_SEARCH=on yarn dev`.
3. Ask AI Chat to invoke that subagent for a task that would normally benefit from MCP tools.
4. **Verify**: The agent does not discover or expose tools outside its allowlist.
5. **Verify**: Non-allowlisted MCP/plugin tools are absent from agent tool search results.

### TC-29: Agent can use allowlisted deferred tool after discovery

1. Configure a subagent allowlist that includes one deferred plugin or MCP tool.
2. Start with `AI_TOOL_SEARCH=on yarn dev`.
3. Ask the agent to perform a task requiring that allowlisted tool.
4. **Verify**: The agent can discover and use the allowlisted tool.
5. **Verify**: Approval policy still applies if the tool requires it.

### TC-30: Agent catalog is disabled when flag is off

1. Start with `AI_TOOL_SEARCH=off yarn dev`.
2. Invoke the same subagent used in TC-28.
3. **Verify**: Agent runtime follows standard tool behavior.
4. **Verify**: No agent-specific deferred catalog filtering is required.

---

## 8. Ordering, Metrics, and Fallback

### TC-31: Tool ordering is stable

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Send the same simple prompt in two fresh conversations:

```text
Say hello and do not use tools.
```

3. Compare terminal logs for exposed tool names or largest-tool metrics.
4. **Verify**: Ordering is deterministic when enabled tools do not change.

### TC-32: Metrics are emitted without sensitive payloads

1. Start with `AI_TOOL_SEARCH=on yarn dev`.
2. Send any AI Chat message.
3. **Verify in logs**: Metrics include counts such as total, always, deferred, discovered, exposed, and estimated tokens.
4. **Verify in logs**: Largest tools show names, sources, and estimated token sizes.
5. **Verify in logs**: Full schemas, tool arguments, auth headers, and tool outputs are not logged.

### TC-33: Fallback keeps chat working if catalog filtering fails

1. Temporarily create a local failure condition, such as a malformed tool definition from a test plugin, or use a debug build that throws inside catalog filtering.
2. Start AI Chat with `AI_TOOL_SEARCH=on`.
3. Send a normal chat message.
4. **Verify**: Chat still responds using the standard full-tool behavior.
5. **Verify in logs**: Fallback reason is logged.

### TC-34: Rollback returns to previous behavior

1. Reproduce any issue while running with `AI_TOOL_SEARCH=on` or `auto`.
2. Restart with:

```bash
AI_TOOL_SEARCH=off yarn dev
```

3. Repeat the same chat task.
4. **Verify**: Deferred catalog behavior is disabled.
5. **Verify**: Existing tool execution path still works.

---

## 9. Contextual Built-In Function Tools

These cases verify built-in aiFetchly function tools that should be exposed in the first AI server request when the current user message clearly needs them. Use `AI_TOOL_SEARCH=on yarn dev` unless a case says otherwise.

### TC-35: File create request exposes `file_write`

1. Open a fresh AI Chat V2 conversation with an active workspace.
2. Send:

```text
create a file in the workspace, name "manual-tool-test.txt", with content "manual test"
```

3. **Verify in request/logs**: The first AI server request includes `file_write`.
4. **Verify**: A permission prompt appears before writing the file.
5. Approve the permission.
6. **Verify**: The assistant reports success.
7. **Verify in workspace**: `manual-tool-test.txt` exists and contains `manual test`.
8. Clean up the file after the test.

### TC-36: File edit request exposes `file_edit`

1. Create a workspace file named `manual-edit-test.txt` with this content:

```text
hello old value
```

2. Open AI Chat V2.
3. Send:

```text
replace old value with new value in manual-edit-test.txt
```

4. **Verify in request/logs**: The first AI server request includes `file_edit`.
5. **Verify**: A permission prompt appears before editing the file.
6. Approve the permission.
7. **Verify in workspace**: `manual-edit-test.txt` now contains `hello new value`.
8. Clean up the file after the test.

### TC-37: File delete request exposes `shell_execute`

1. Create a workspace file named `manual-delete-test.txt`.
2. Open AI Chat V2.
3. Send:

```text
rm the file manual-delete-test.txt
```

4. **Verify in request/logs**: The first AI server request includes `shell_execute` and `check_shell_status`.
5. **Verify**: A shell permission prompt appears before running `rm`.
6. Approve the permission.
7. **Verify in workspace**: `manual-delete-test.txt` is removed.
8. **Verify**: The assistant does not say it has no file deletion tool.

### TC-38: Agent delegation exposes `run_subagent`

1. Ensure at least one active agent appears in `/agents` or the `Available AiFetchly agents` system block.
2. Open a fresh AI Chat V2 conversation.
3. Send:

```text
Use the lead researcher agent to summarize public business context for Example Corp. If you need to delegate, do it with an available agent.
```

4. **Verify in request/logs**: The first AI server request includes `run_subagent`.
5. **Verify**: If the model delegates, a `run_subagent` tool call is accepted instead of failing as an unknown or unavailable tool.
6. **Verify**: If the subagent runs asynchronously, the chat can poll with `check_tool_job_status`.

### TC-39: Knowledge library list request exposes document management tools

1. Ensure the local knowledge library has at least one imported document, or use an empty library and verify the empty-state result.
2. Open AI Chat V2.
3. Send:

```text
list the documents in my knowledge library
```

4. **Verify in request/logs**: The first AI server request includes `knowledge_library_list_documents`.
5. **Verify**: The assistant returns document metadata or a clear empty-state message.
6. **Verify**: The response does not expose raw local file paths or document contents unless separately requested through an allowed read/search tool.

### TC-40: Knowledge library import request exposes import tool

1. Attach a small test document to the current AI Chat conversation.
2. Send:

```text
import this attachment into the knowledge base with the tag manual-test
```

3. **Verify in request/logs**: The first AI server request includes `knowledge_library_import_attachment`.
4. **Verify**: A permission prompt appears before importing.
5. Approve the permission.
6. **Verify**: The assistant reports import success or a clear duplicate/processing message.
7. Send:

```text
list the documents in my knowledge library with tag manual-test
```

8. **Verify**: The imported document appears in the list or its processing status is visible.

### TC-41: Schedule request exposes schedule tools

1. Ensure there is an existing task ID that can be scheduled, or use this case only to verify tool exposure before execution.
2. Open AI Chat V2.
3. Send:

```text
create an inactive schedule named Manual Tool Test for task 1 to run every weekday at 9 AM
```

4. **Verify in request/logs**: The first AI server request includes `create_schedule`.
5. **Verify**: The assistant asks for missing required task details if task ID/type is ambiguous.
6. **Verify**: A permission prompt appears before creating or changing a schedule.
7. If approved and created, clean it up with:

```text
delete the Manual Tool Test schedule
```

8. **Verify in request/logs**: The delete request includes `delete_schedule` when schedule intent is clear.

### TC-42: Dashboard/report request exposes `create_html_artifact`

1. Open AI Chat V2.
2. Send:

```text
Create an interactive dashboard that compares three sample outreach campaigns by sent count, reply rate, and conversion rate.
```

3. **Verify in request/logs**: The first AI server request includes `create_html_artifact`.
4. **Verify**: The assistant creates an HTML artifact instead of only returning plain text.
5. **Verify in UI**: The artifact opens in the main content area and renders a useful dashboard/report.

### TC-43: Ordinary chat does not overexpose mutation tools

1. Open a fresh AI Chat V2 conversation.
2. Send:

```text
write a short product tagline for aiFetchly
```

3. **Verify in request/logs**: The first AI server request does not include `file_write`, because this is content generation rather than a workspace file write.
4. Send:

```text
fix this sentence: aiFetchly help team find lead
```

5. **Verify in request/logs**: The first AI server request does not include `file_edit`, because this is text editing rather than file editing.
6. **Verify**: The assistant answers normally in chat.

---

## Manual Test Summary Checklist

Use this checklist after running the cases above:

- [ ] `/skills` shows tool catalog counts and largest tools.
- [ ] `AI_TOOL_SEARCH=off` preserves standard behavior.
- [ ] `AI_TOOL_SEARCH=on` exposes `tool_catalog_search` and hides undiscovered deferred tools.
- [ ] `AI_TOOL_SEARCH=auto` switches based on threshold.
- [ ] Deferred tools can be discovered and used in later rounds.
- [ ] Discovered tools survive permission pause, plan pause, and conversation reload.
- [ ] Disabled MCP/plugin tools are not discoverable or executable.
- [ ] Permission prompts still gate sensitive tool execution.
- [ ] MCP description/schema caps prevent prompt bloat.
- [ ] Agent allowlists restrict discovery.
- [ ] Contextual built-in tools are exposed for clear file, shell, agent, knowledge-library, schedule, and artifact requests.
- [ ] Ordinary chat does not expose write/edit mutation tools unnecessarily.
- [ ] Logs include useful metrics without secrets.
- [ ] `AI_TOOL_SEARCH=off` works as rollback.
