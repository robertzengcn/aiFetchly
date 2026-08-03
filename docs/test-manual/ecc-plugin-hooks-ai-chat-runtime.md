# ECC Plugin Hooks in AI Chat - Manual Test Cases

**Plugin**: `ecc`  
**Plugin source folder**: `/home/robertzeng/tmp/workspacetest/ECC-main`  
**Related UI**: `src/views/pages/systemsetting/plugins.vue`, `src/views/components/aiChatV2/AiChatV2.vue`  
**Created**: 2026-07-23  

## Goal

Verify that hooks shipped by the installed ECC plugin are visible in Plugin Manager and are executed by the AiChatV2 runtime after the plugin is enabled.

This document tests plugin-owned hooks, not user-created hooks. Generic hook system tests are in `docs/test-manual/aiChatV2-hooks.md`.

## Preconditions

- Start the app from `/home/robertzeng/project/aiFetchly`.
- Recommended command for hook evidence:
  ```bash
  DEBUG='hook*,plugin*' yarn dev
  ```
- AI Chat V2 is available and the selected model/provider supports tools.
- AI is enabled.
- Hooks are globally enabled. If you previously disabled hooks, re-enable them from **System Settings -> Hooks**.
- The ECC plugin from `/home/robertzeng/tmp/workspacetest/ECC-main` is installed and enabled.
- Use workspace `/home/robertzeng/project/aiFetchly`.
- Keep main-process logs visible.

## Expected ECC Hook Inventory

Open `/home/robertzeng/tmp/workspacetest/ECC-main/hooks/hooks.json`. The plugin currently declares 21 hook matchers:

| Event | Expected Count |
|---|---:|
| `PreToolUse` | 8 |
| `PreCompact` | 1 |
| `SessionStart` | 2 |
| `PostToolUse` | 2 |
| `PostToolUseFailure` | 1 |
| `Stop` | 6 |
| `SessionEnd` | 1 |
| **Total** | **21** |

Important compatibility note: ECC is a Claude plugin, so some matchers use Claude tool names such as `Bash`, `Write`, and `Edit`. AiFetchly tool names may be different, for example `shell_execute`, `file_write`, or `file_edit`. Wildcard matchers (`*`) and lifecycle hooks should fire regardless. Claude-name-specific hooks only fire if AiFetchly maps those names or the actual tool name matches exactly.

## TC-HOOK-1 - Plugin detail shows ECC hooks

1. Open **System Settings -> Plugins**.
2. Find the installed `ecc` plugin.
3. Verify the plugin row has a Hooks count.
4. Open plugin detail.
5. Open the **Hooks** tab.

Expected:
- Hooks tab is present.
- Hooks tab is not empty.
- Total hook rows are 21.
- Rows include events `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `Stop`.
- Example hook IDs or descriptions are visible:
  - `session:start`
  - `pre:bash:dispatcher`
  - `pre:observe:continuous-learning`
  - `post:dispatcher:sync`
  - `post:mcp-health-check`
  - `stop:format-typecheck`

Fail if:
- Plugin detail has no Hooks tab.
- Hooks count is 0.
- Hooks tab only shows an empty table.

## TC-HOOK-2 - Disable and re-enable plugin removes/restores hooks

1. In **System Settings -> Plugins**, disable `ecc`.
2. Open `ecc` plugin detail.
3. Check the Hooks count/tab.
4. Re-enable `ecc`.
5. Open plugin detail again.

Expected:
- When disabled, plugin-owned runtime hooks are not active.
- After re-enable, Hooks count returns to 21.
- AI Chat slash suggestions/components refresh without restarting the app.

Runtime check:
1. With `ecc` disabled, start a new AI Chat conversation and send:
   ```text
   Reply with exactly: hook disabled check
   ```
2. Check main-process logs.
3. Re-enable `ecc`, start a new conversation, and send:
   ```text
   Reply with exactly: hook enabled check
   ```

Expected:
- Disabled case: no `plugin:ecc` hook execution appears in logs/audit.
- Enabled case: `SessionStart` hook execution for `plugin:ecc` appears.

## TC-HOOK-3 - `SessionStart` fires once per conversation

1. Ensure `ecc` is enabled.
2. Open AI Chat.
3. Start a new conversation.
4. Send:
   ```text
   Reply with exactly: session start test
   ```
5. Wait for the response.
6. Send a second message in the same conversation:
   ```text
   Reply with exactly: same conversation
   ```
7. Start another new conversation.
8. Send:
   ```text
   Reply with exactly: new conversation
   ```

Expected:
- First message in the first conversation fires ECC `SessionStart` hooks.
- Second message in the same conversation does not fire `SessionStart` again.
- First message in the new conversation fires ECC `SessionStart` again.
- Main-process logs or hook audit show `SessionStart` entries from source `plugin` with IDs beginning `plugin:ecc:`.

Acceptable user-visible behavior:
- The assistant may not visibly mention ECC session context. Some ECC `SessionStart` hooks only inject context when prior ECC state exists.
- Logs/audit are the source of truth for this test.

## TC-HOOK-4 - `Stop` fires after a normal chat turn

1. Start AiFetchly with:
   ```bash
   DEBUG='hook*,plugin*' yarn dev
   ```
2. Ensure `ecc` is enabled.
3. Open AI Chat and start a new conversation.
4. Send:
   ```text
   Reply with exactly: stop hook test
   ```
5. Wait until the response is complete.
6. Inspect main-process logs or hook audit.

Expected:
- `Stop` hook event fires after the assistant response completes.
- Source is `plugin`.
- Hook IDs beginning `plugin:ecc:` are logged/audited.
- Chat response still completes normally.

Fail if:
- No `Stop` event is logged after completion.
- Chat remains stuck in streaming state.

## TC-HOOK-5 - `PreToolUse` wildcard hooks fire before a safe tool call

1. Start AiFetchly with hook debug logging enabled.
2. Ensure `ecc` is enabled.
3. Open AI Chat with workspace `/home/robertzeng/project/aiFetchly`.
4. Send:
   ```text
   Use an available file search tool to find package.json in the current workspace, then summarize only the path you found.
   ```
5. Wait until a tool call card appears and completes.
6. Check logs/audit for `PreToolUse`.

Expected:
- A safe read/search tool is called.
- `PreToolUse` fires before the tool call.
- At least wildcard ECC hooks fire, especially:
  - `pre:observe:continuous-learning`
  - `pre:mcp-health-check` if the tool path is treated as an MCP tool or wildcard hook
- Chat tool result completes normally.

Notes:
- ECC hooks with matchers `Write`, `Edit`, `Bash`, or `Bash|Write|Edit|MultiEdit` may not fire for AiFetchly file-search tools.
- That is expected unless AiFetchly adds Claude tool-name aliasing.

## TC-HOOK-6 - `PostToolUse` fires after a successful tool call

1. Reuse the successful tool-call conversation from TC-HOOK-5, or start a new one.
2. Send:
   ```text
   Use a read-only tool to inspect package.json and tell me only the package name.
   ```
3. Wait until the tool result is complete.
4. Check logs/audit for `PostToolUse`.

Expected:
- A successful tool result is produced.
- ECC `PostToolUse` hooks fire after the tool result.
- Expected hook IDs include:
  - `post:dispatcher:sync`
  - `post:dispatcher:async`
- The assistant can continue using the tool output.

Fail if:
- Tool succeeds but no `PostToolUse` execution appears.
- Hook failure prevents a successful read-only tool result.

## TC-HOOK-7 - `PostToolUseFailure` fires after a failed tool call

1. Start a new AI Chat conversation.
2. Send:
   ```text
   Use a file read tool to read /tmp/aiFetchly-ecc-hook-file-that-does-not-exist.txt and report the error.
   ```
3. If the model asks permission for file access, approve only the read.
4. Wait for the tool failure result.
5. Check logs/audit for `PostToolUseFailure`.

Expected:
- The tool result is a failure because the file does not exist.
- ECC `PostToolUseFailure` hook fires.
- Expected hook ID/description:
  - `post:mcp-health-check`
- The original tool failure remains visible to the user.

Acceptable variation:
- If the model refuses to call a file-read tool, use a shell command instead:
  ```text
  Run shell command: cat /tmp/aiFetchly-ecc-hook-file-that-does-not-exist.txt
  ```

## TC-HOOK-8 - Claude matcher compatibility check for `Bash`

This test determines whether AiFetchly maps Claude matcher `Bash` to the AiFetchly shell tool name.

1. Start AiFetchly with hook debug logging enabled.
2. Ensure `ecc` is enabled.
3. Open a new AI Chat conversation.
4. Send:
   ```text
   Run shell command: echo ecc-hook-bash-compat
   ```
5. Approve the shell tool if prompted.
6. Inspect main-process logs/audit.

Expected if Claude matcher aliasing is supported:
- `PreToolUse` hook `pre:bash:dispatcher` fires.
- Main-process logs or hook audit include `plugin:ecc:pre:bash:dispatcher`.

Expected if aliasing is not supported:
- Wildcard ECC `PreToolUse` hooks fire.
- `pre:bash:dispatcher` does not fire because its matcher is `Bash`, while AiFetchly likely uses a different shell tool name such as `shell_execute`.

Record the result:
- Pass with alias support: `pre:bash:dispatcher` fired.
- Compatibility gap: wildcard hooks fired but `pre:bash:dispatcher` did not. File a follow-up bug/request to map Claude tool names to AiFetchly tool names.

## TC-HOOK-9 - Write/Edit matcher compatibility check

This test should be run in a throwaway file only.

1. Create or choose a throwaway path:
   ```text
   /tmp/aiFetchly-ecc-hook-manual-test.txt
   ```
2. In AI Chat, send:
   ```text
   Use a file write or edit tool to create /tmp/aiFetchly-ecc-hook-manual-test.txt with the text: ecc hook write test
   ```
3. Approve the write if prompted.
4. Check logs/audit.

Expected if Claude matcher aliasing is supported:
- ECC `PreToolUse` hooks with matchers `Write`, `Edit|Write`, and `Write|Edit|MultiEdit` fire.
- Main-process logs or hook audit may include:
  - `pre:write:doc-file-warning`
  - `pre:edit-write:suggest-compact`
  - `pre:config-protection`
  - `pre:edit-write:gateguard-fact-force`

Expected if aliasing is not supported:
- Wildcard `PreToolUse` hooks fire.
- Claude-name-specific write/edit hooks do not fire.

Cleanup:
```bash
rm -f /tmp/aiFetchly-ecc-hook-manual-test.txt
```

## TC-HOOK-10 - Global hooks toggle suppresses ECC hooks

1. Open **System Settings -> Hooks**.
2. Turn the global hooks toggle OFF.
3. Start a new AI Chat conversation.
4. Send:
   ```text
   Reply with exactly: global hooks off
   ```
5. Check logs/audit.
6. Turn the global hooks toggle ON again.
7. Start another new conversation and send:
   ```text
   Reply with exactly: global hooks on
   ```

Expected:
- With global hooks OFF, no ECC `SessionStart` or `Stop` hooks fire.
- With global hooks ON, ECC lifecycle hooks fire again.
- Plugin remains installed and enabled in both cases.

## TC-HOOK-11 - Plugin uninstall removes ECC hooks

1. Open **System Settings -> Plugins**.
2. Uninstall `ecc`.
3. Open **System Settings -> Hooks** or plugin manager surfaces.
4. Start a new AI Chat conversation.
5. Send:
   ```text
   Reply with exactly: uninstalled hook check
   ```
6. Check logs/audit.

Expected:
- No `plugin:ecc` hooks are listed or executed.
- AI Chat still works normally.
- Built-in hooks, if enabled, are unaffected.

Cleanup:
- Reinstall `ecc` from `/home/robertzeng/tmp/workspacetest/ECC-main` or the zip if you need to continue plugin testing.

## Evidence to Capture

For each failed case, capture:

- Screenshot of the plugin detail Hooks tab.
- Main-process log lines around `HookDispatcher`, `plugin-hook`, or `plugin:ecc`.
- Hook audit row if the Hooks UI exposes audit history.
- AI Chat screenshot showing the prompt, tool-call card, and result.
- The actual tool name shown in the tool-call card, because matcher compatibility depends on the tool name.

## Pass Criteria

ECC plugin hook support is acceptable when:

- Plugin Manager shows the ECC Hooks tab with 21 rows.
- Disabling `ecc` suppresses plugin-owned hook execution.
- Re-enabling `ecc` restores plugin-owned hook execution without app restart.
- `SessionStart` fires once per conversation.
- `Stop` fires after completed turns.
- Wildcard `PreToolUse` and `PostToolUse` hooks fire around tool calls.
- `PostToolUseFailure` fires for failed tool calls.
- Any Claude-name matcher gaps are recorded clearly with the AiFetchly tool name that failed to match.
