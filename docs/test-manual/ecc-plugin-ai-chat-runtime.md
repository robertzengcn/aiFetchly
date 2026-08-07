# ECC Plugin AI Chat Runtime - Manual Test Cases

**Plugin**: `ecc`  
**Plugin source folder**: `/home/robertzeng/tmp/workspacetest/ECC-main`  
**Plugin zip**: `/home/robertzeng/tmp/workspacetest/ECC-main.zip`  
**Related UI**: `src/views/components/aiChatV2/AiChatV2.vue`  
**Created**: 2026-07-22

## Goal

Verify that ECC plugin commands, subagents, skills, and MCP servers are discoverable and usable from AiChatV2 after installation from a zip file.

This test plan focuses on runtime behavior in AI Chat, not only Plugin Manager counts.

## Preconditions

- Start the app with `yarn dev`.
- Open the app at `http://localhost:5173` or the Electron window.
- AI provider is configured and can stream chat responses.
- The selected provider supports tools. If AiChatV2 shows "Tools are disabled for this conversation", switch to a provider/model with tool support before running skill, subagent, or MCP cases.
- Use a new conversation for each major section unless the case says otherwise.
- Set the workspace to `/home/robertzeng/project/aiFetchly` for all subagent and file-aware skill tests.
- Have DevTools and main-process logs open if possible.

## Expected ECC Install Counts

Use these counts as a first sanity check against the local fixture:

| Component | Expected Count |
|---|---:|
| Commands | 94 |
| Subagents | 67 |
| Skills | 278 |
| MCP servers | 1 |

The MCP server declared by ECC is `chrome-devtools` from `.mcp.json`. Internally the database may scope it as `ecc__chrome-devtools`, but the plugin detail UI should display `chrome-devtools`.

## Phase 1: Install and Component Discovery

### TC-1.1 - Install ECC from zip
1. Open Settings -> Plugins.
2. Install from local zip: `/home/robertzeng/tmp/workspacetest/ECC-main.zip`.
3. If an older `ecc` install exists, overwrite it.
4. Verify install succeeds without an error toast.
5. Verify the installed plugin row shows `ecc`.

Expected:
- Plugin row is enabled.
- Health is not `invalid`.
- Counts are close to or exactly: 94 commands, 67 subagents, 278 skills, 1 MCP server.

### TC-1.2 - Plugin detail commands tab is populated
1. Open the `ecc` plugin detail dialog.
2. Open the Commands tab.
3. Search visually for `aside`, `code-review`, `ecc-guide`, and `plan`.

Expected:
- Commands tab is not empty.
- At least those four commands are visible.
- Rows show command descriptions.
- No command diagnostic is shown for missing `type: prompt` or missing `name`.

### TC-1.3 - Plugin detail subagents tab is populated
1. Open the Subagents tab in the same plugin detail dialog.
2. Search visually for `code-reviewer`, `typescript-reviewer`, `code-explorer`, and `planner`.

Expected:
- Subagents tab is not empty.
- Rows show mode, tool count, health, and enabled status.
- Plugin-owned subagents are enabled by default unless previously disabled.

### TC-1.4 - Plugin detail skills tab is populated
1. Open the Skills tab.
2. Search visually for `accessibility`, `agent-architecture-audit`, `api-design`, `browser-qa`, `security-review`, and `verification-loop`.

Expected:
- Skills tab is not empty.
- Skills have enabled toggles.
- Skills are listed as plugin-owned components.

### TC-1.5 - Plugin detail MCP tab shows the ECC MCP server
1. Open the MCP Servers tab.

Expected:
- The tab is not empty.
- It shows one server named `chrome-devtools`.
- It shows transport `stdio`.
- The enable switch is visible.
- It does not show a blank row with only a switch.

## Phase 2: Slash Command Discovery in AiChatV2

### TC-2.1 - Slash suggestions include ECC commands
1. Open AI Chat.
2. Start a new conversation.
3. Type `/` in the composer but do not send.

Expected:
- Slash command suggestion dropdown opens.
- Built-in commands such as `/help`, `/status`, and `/agents` are present.
- ECC plugin commands also appear with a Plugin source badge.

### TC-2.2 - Filter slash suggestions by command prefix
1. In the composer, type `/ecc`.
2. Wait for the suggestions debounce.

Expected:
- `/ecc-guide` appears.
- Suggestion row shows the ECC command description.
- Selecting it fills the composer with `/ecc-guide `, including a trailing space when the command expects arguments.

### TC-2.3 - Command list refreshes after plugin reload
1. Keep AI Chat open with `/ecc` typed.
2. In Settings -> Plugins, click reload.
3. Return to AI Chat.

Expected:
- Suggestions still show `/ecc-guide`.
- No duplicate `/ecc-guide` rows appear.
- No stale empty suggestion state persists after reload.

### TC-2.4 - Disabled plugin removes ECC commands from suggestions
1. In Settings -> Plugins, disable `ecc`.
2. Return to AI Chat.
3. Type `/ecc`.

Expected:
- `/ecc-guide` does not appear.
- Built-in slash commands still appear when typing `/`.

Cleanup:
1. Re-enable `ecc`.
2. Return to AI Chat and verify `/ecc-guide` appears again.

## Phase 3: Slash Command Dispatch in AiChatV2

### TC-3.1 - Built-in command still works
1. In AI Chat, send:
   ```text
   /status
   ```

Expected:
- AiChatV2 renders a local command response.
- Response includes command count, agent count, hook count, skill count, diagnostic count, and last reload.
- No model stream is started for `/status`.

### TC-3.2 - ECC prompt command submits to the AI stream
1. Send:
   ```text
   /ecc-guide skills
   ```

Expected:
- The command is not rejected as unknown.
- AiChatV2 starts a normal assistant stream.
- The assistant responds with guidance about ECC skills.
- No local error message says `Unknown slash command: /ecc-guide`.

### TC-3.3 - ECC command with argument substitution
1. Send:
   ```text
   /code-review Review only src/main-process/communication/plugin-ipc.ts
   ```

Expected:
- AiChatV2 submits the expanded ECC prompt to the model.
- The assistant understands the argument text and treats `src/main-process/communication/plugin-ipc.ts` as the review scope.
- If the model calls read/search tools, normal tool call cards appear.
- No second slash-command dispatch loop happens even if the expanded prompt contains slash-looking text.

### TC-3.4 - ECC command with no arguments
1. Send:
   ```text
   /aside
   ```

Expected:
- Command dispatch succeeds.
- The assistant receives the ECC Aside command instructions.
- No `missing type: prompt`, `missing name`, or `Unknown slash command` error appears.

### TC-3.5 - Nonexistent command still fails cleanly
1. Send:
   ```text
   /ecc-this-command-does-not-exist
   ```

Expected:
- AiChatV2 renders a local command response.
- Response says the slash command is unknown.
- No AI stream starts.

## Phase 4: Subagent Discovery and Invocation

### TC-4.1 - `/agents` lists ECC plugin agents
1. In AI Chat, send:
   ```text
   /agents
   ```

Expected:
- The local command response includes plugin-owned agent IDs.
- Rows include agents such as `code-reviewer`, `typescript-reviewer`, `code-explorer`, and `planner`.
- Each row includes a Plugin source marker.

### TC-4.2 - Model can discover plugin agents without `/agents`
1. Start a new conversation.
2. Send:
   ```text
   What AiFetchly subagents are available from the ECC plugin? List only the ECC agent names that you can actually call.
   ```

Expected:
- The model can answer from the injected "Available AiFetchly agents" block.
- It names ECC agents, not only built-in agents.
- It does not hallucinate unavailable agents after the plugin is disabled.

### TC-4.3 - Invoke `code-explorer`
1. Ensure workspace is set to `/home/robertzeng/project/aiFetchly`.
2. Send:
   ```text
   Use the ECC code-explorer subagent to map how AiChatV2 dispatches slash commands. Focus on src/views/components/aiChatV2/AiChatV2.vue and the main-process slash command IPC.
   ```

Expected:
- The model calls `run_subagent`.
- The agent ID corresponds to the ECC `code-explorer` plugin agent.
- Agent task appears in the Agent Task List dialog.
- Task status moves from running to completed.
- Final output includes entry points, execution flow, key files, and recommendations.

### TC-4.4 - Invoke `typescript-reviewer`
1. Send:
   ```text
   Use the ECC typescript-reviewer subagent to review the TypeScript shape of plugin MCP server rows in src/main-process/communication/plugin-ipc.ts and src/views/api/plugins.ts. Report findings only.
   ```

Expected:
- The model calls `run_subagent`.
- The agent ID corresponds to `typescript-reviewer`.
- Output is review-oriented and cites files or says no findings.
- The agent does not edit files.

### TC-4.5 - Disable one subagent and verify runtime exclusion
1. Open Settings -> Plugins -> `ecc` detail -> Subagents.
2. Disable `code-explorer`.
3. Return to AI Chat and send:
   ```text
   Use the ECC code-explorer subagent to inspect AiChatV2 slash commands.
   ```

Expected:
- The model should not successfully run disabled `code-explorer`.
- Either the agent is absent from the available-agent block, or the run fails with a clear unavailable/disabled message.
- Other ECC agents remain available.

Cleanup:
1. Re-enable `code-explorer`.

### TC-4.6 - Disable plugin and verify all ECC subagents disappear
1. Disable the entire `ecc` plugin.
2. Send:
   ```text
   /agents
   ```

Expected:
- ECC agents are absent from the `/agents` response.
- Built-in or other enabled agents may still appear.

Cleanup:
1. Re-enable the `ecc` plugin.
2. Send `/agents` again and verify ECC agents return.

## Phase 5: Skill Discovery and Invocation

### TC-5.1 - Ask the model to use the `accessibility` skill
1. Start a new conversation.
2. Send:
   ```text
   Use the ECC accessibility skill to audit this button markup for WCAG 2.2 AA issues:
   <div onclick="save()">Save</div>
   ```

Expected:
- The model calls the `accessibility` skill/tool or clearly follows the ECC accessibility guidance.
- If a skill permission card appears, approve it for this test.
- The final answer discusses semantic button usage, keyboard access, focus, and accessible name.

### TC-5.2 - Ask the model to use the `api-design` skill
1. Send:
   ```text
   Use the ECC api-design skill to propose a small REST API for enabling and disabling plugin MCP servers. Include endpoints, request bodies, and errors.
   ```

Expected:
- The model calls the `api-design` skill/tool or follows that skill's API design workflow.
- Final answer includes endpoint names, request/response shapes, and error cases.
- No file write occurs unless explicitly approved.

### TC-5.3 - Ask the model to use the `agent-architecture-audit` skill
1. Send:
   ```text
   Use the ECC agent-architecture-audit skill to audit AiChatV2 plugin command dispatch at a high level. Do not edit files.
   ```

Expected:
- The model calls the `agent-architecture-audit` skill/tool or follows its 12-layer audit structure.
- Final answer identifies layers such as system prompt, tool selection, tool execution, rendering, and persistence.
- No files are modified.

### TC-5.4 - Skill permission prompt works
1. Pick an ECC skill that declares tools such as `Read`, `Write`, `Edit`, or `Bash`.
2. Send a prompt that explicitly asks to use that skill.
3. If AiChatV2 shows a `SkillApprovalCard`, click Deny.

Expected:
- The stream pauses while awaiting permission.
- Deny resumes the conversation with a clear permission-denied result.
- The chat does not hang in a running state.

Repeat:
1. Send the same prompt again.
2. Approve the permission.

Expected:
- Skill executes or returns a tool result.
- Chat continues to a final assistant response.

### TC-5.5 - Disabled skill is not used
1. In Settings -> Plugins -> `ecc` detail -> Skills, disable `accessibility`.
2. Return to AI Chat.
3. Send:
   ```text
   Use the ECC accessibility skill to audit this markup: <button></button>
   ```

Expected:
- The disabled skill is not called.
- The model either answers without that tool or says the requested skill is unavailable.

Cleanup:
1. Re-enable `accessibility`.

## Phase 6: MCP Server Availability from AiChatV2

### TC-6.1 - MCP server appears in Plugin Manager and MCP manager
1. Open Settings -> Plugins -> `ecc` detail -> MCP Servers.
2. Verify `chrome-devtools` is enabled.
3. Open AI Chat.
4. Click the toolbox icon in the AiChatV2 header to open Manage MCP Tools.

Expected:
- `chrome-devtools` or its scoped server row is visible.
- Server is enabled.
- Discovered tools are listed after discovery succeeds.

### TC-6.2 - Discover tools for `chrome-devtools`
1. In Plugin detail -> MCP Servers, ensure the `chrome-devtools` server is enabled.
2. In Manage MCP Tools, run discovery for the server if tools are not already listed.

Expected:
- Discovery completes or returns a clear environment error.
- If Chrome/DevTools prerequisites are missing, the error is visible and does not break the plugin detail page.
- If discovery succeeds, tool names use plugin MCP naming internally, such as `mcp__ecc__chrome-devtools__<tool>`.

### TC-6.3 - Ask AiChatV2 to use the MCP server
1. Ensure Chrome DevTools MCP prerequisites are available for your environment.
2. Send:
   ```text
   Use the ECC chrome-devtools MCP server to inspect the currently open page title. If the server is unavailable, report the exact MCP error.
   ```

Expected:
- The model calls an MCP tool if the server and provider support tools.
- A tool call card appears for an MCP tool.
- If the MCP server cannot start, the final response includes the real error rather than pretending success.

### TC-6.4 - Disable MCP server and verify runtime exclusion
1. Disable `chrome-devtools` in Plugin detail -> MCP Servers.
2. Return to AI Chat.
3. Send:
   ```text
   Use the ECC chrome-devtools MCP server to inspect the page title.
   ```

Expected:
- The model cannot call ECC's chrome-devtools MCP tool.
- The answer should say the tool/server is unavailable or fall back without MCP.

Cleanup:
1. Re-enable `chrome-devtools`.

## Phase 7: Combined Runtime Scenarios

### TC-7.1 - Command prompt can lead to tool use
1. Send:
   ```text
   /harness-audit aiFetchly plugin runtime. Keep it read-only.
   ```

Expected:
- Slash command dispatch succeeds.
- AI stream begins with the expanded ECC harness-audit prompt.
- If the model uses tools, it uses read/search tools only unless you explicitly approve broader permissions.
- Final answer is an audit-style report, not an unknown-command error.

### TC-7.2 - Command plus subagent handoff
1. Send:
   ```text
   /plan Investigate whether ECC plugin commands, subagents, skills, and MCP servers are all available in AiChatV2. Use a subagent only after presenting the plan.
   ```

Expected:
- `/plan` expands and streams as a prompt command.
- Assistant presents a plan and waits for confirmation.
- It does not immediately call `run_subagent` before user approval.

### TC-7.3 - Skill plus subagent in one conversation
1. Send:
   ```text
   First use the ECC agent-architecture-audit skill to identify risks in AiChatV2 plugin runtime. Then use the ECC code-explorer subagent to trace one risk to files. Do not edit files.
   ```

Expected:
- At least one skill/tool call or explicit skill-guided section appears.
- A `run_subagent` tool call appears for `code-explorer`.
- Final response separates skill audit findings from subagent trace results.

### TC-7.4 - Plugin reload while AI Chat is open
1. Open AI Chat and type `/code` but do not send.
2. In Settings -> Plugins, reload plugins.
3. Return to AI Chat and wait two seconds.

Expected:
- Slash suggestions refresh.
- `/code-review` remains available once.
- No duplicate suggestions appear.
- Existing conversation remains usable.

## Phase 8: Error Handling and Cleanup

### TC-8.1 - AI disabled blocks AI-serving paths but metadata still behaves
1. Disable AI entitlement/provider availability in the same way used for normal AI-off testing.
2. In AI Chat, send:
   ```text
   /status
   ```
3. Then send:
   ```text
   /ecc-guide
   ```

Expected:
- `/status` can return metadata because it is local.
- `/ecc-guide` dispatch may resolve, but the follow-up AI stream is blocked by AI availability.
- Error is clear and the chat does not hang.

Cleanup:
1. Re-enable AI/provider access.

### TC-8.2 - Uninstall removes ECC runtime surfaces
1. Uninstall `ecc`.
2. Open AI Chat.
3. Type `/ecc`.
4. Send:
   ```text
   /agents
   ```
5. Ask:
   ```text
   Use the ECC accessibility skill.
   ```

Expected:
- `/ecc-guide` and other ECC commands are absent from suggestions.
- ECC agents are absent from `/agents`.
- ECC skills are not called.
- ECC MCP server is absent from Manage MCP Tools.

### TC-8.3 - Reinstall restores runtime surfaces
1. Reinstall from `/home/robertzeng/tmp/workspacetest/ECC-main.zip`.
2. Open AI Chat.
3. Type `/ecc`.
4. Send `/agents`.

Expected:
- `/ecc-guide` returns to slash suggestions.
- ECC agents return to `/agents`.
- Plugin detail again shows commands, subagents, skills, and one MCP server.

## Quick Smoke Test

Run this shorter path when you only need confidence that the latest fixes work:

1. Install or reload `ecc`.
2. Plugin detail:
   - Commands tab shows 94 commands.
   - Subagents tab shows 67 subagents.
   - Skills tab shows 278 skills.
   - MCP Servers tab shows `chrome-devtools`.
3. Open AI Chat and type `/ecc`.
4. Verify `/ecc-guide` appears with a Plugin badge.
5. Send `/ecc-guide skills`.
6. Verify AI stream starts and no unknown-command error appears.
7. Send `/agents`.
8. Verify ECC plugin agents appear.
9. Ask: `Use the ECC code-explorer subagent to trace AiChatV2 slash command dispatch.`
10. Verify `run_subagent` runs and completes.
11. Ask: `Use the ECC accessibility skill to audit <div onclick="save()">Save</div>.`
12. Verify the skill is used or its workflow is clearly followed.
13. Open MCP Servers tab and verify `chrome-devtools` row is visible and non-empty.

## Test Execution Checklist

| Test Case | Pass/Fail | Notes |
|---|---|---|
| TC-1.1 Install ECC from zip | | |
| TC-1.2 Commands tab populated | | |
| TC-1.3 Subagents tab populated | | |
| TC-1.4 Skills tab populated | | |
| TC-1.5 MCP tab shows chrome-devtools | | |
| TC-2.1 Slash suggestions include ECC commands | | |
| TC-2.2 Slash suggestion filtering | | |
| TC-2.3 Suggestions refresh after reload | | |
| TC-2.4 Disabled plugin removes commands | | |
| TC-3.1 Built-in slash command works | | |
| TC-3.2 ECC prompt command streams | | |
| TC-3.3 Command argument substitution | | |
| TC-3.4 Command without arguments | | |
| TC-3.5 Unknown command failure | | |
| TC-4.1 `/agents` lists ECC agents | | |
| TC-4.2 Model discovers ECC agents | | |
| TC-4.3 Invoke code-explorer | | |
| TC-4.4 Invoke typescript-reviewer | | |
| TC-4.5 Disabled subagent excluded | | |
| TC-4.6 Disabled plugin removes agents | | |
| TC-5.1 Use accessibility skill | | |
| TC-5.2 Use api-design skill | | |
| TC-5.3 Use agent-architecture-audit skill | | |
| TC-5.4 Skill permission prompt | | |
| TC-5.5 Disabled skill not used | | |
| TC-6.1 MCP visible in managers | | |
| TC-6.2 Discover chrome-devtools tools | | |
| TC-6.3 Use MCP from AiChatV2 | | |
| TC-6.4 Disabled MCP excluded | | |
| TC-7.1 Command can lead to tool use | | |
| TC-7.2 Command plus subagent handoff | | |
| TC-7.3 Skill plus subagent | | |
| TC-7.4 Reload while chat open | | |
| TC-8.1 AI disabled behavior | | |
| TC-8.2 Uninstall removes surfaces | | |
| TC-8.3 Reinstall restores surfaces | | |
