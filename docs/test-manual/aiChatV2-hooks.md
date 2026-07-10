# AI Chat V2 — Hooks System Manual Test

| Metadata | Value |
|---|---|
| Version | 1.0 |
| Created | 2026-07-08 |
| Feature | AI Chat Hooks System (Lifecycle Interceptor) |
| PRD | `docs/superpowers/specs/2026-06-23-hooks-system-prd.md` |
| Plan | `docs/superpowers/plans/2026-07-01-hooks-system-management-ui.md` |

## 1. Prerequisites

### 1.1 Environment

- [ ] AiFetchly dev server running (`yarn dev`)
- [ ] Application initialized with `yarn init`
- [ ] AI Chat V2 view accessible
- [ ] AI enabled (`USER_AI_ENABLED` = `true`)
- [ ] Browser DevTools open for network/console inspection
- [ ] Electron main process logs visible (`DEBUG='hook*,dispatcher*' yarn dev`)

### 1.2 Built-in Hooks (for QA)

Two demo callback hooks are registered at app startup (both **disabled by default**):

| ID | Event | Matcher | Behavior |
|---|---|---|---|---|
| `builtin-block-dangerous-shell-delete` | `PreToolUse` | `shell_execute` | Blocks `rm -rf /` or `rm -rf *` commands |
| `builtin-scraping-compliance-context` | `PostToolUse` | `scrape_*` | Adds compliance reminder after scrapes |

Both hooks are **enabled by default** — the dangerous shell blocker protects against accidental `rm -rf` out of the box.

### 1.3 How to Disable Hooks (if needed for testing)

Hooks are globally enabled by default. Disable them via **System Settings → Hooks**, the global toggle switch, or directly via DevTools console:

```js
// In main process DevTools or IPC:
const { Token } = require("@/modules/token");
const { USER_HOOKS_ENABLED } = require("@/config/usersetting");
new Token().setValue(USER_HOOKS_ENABLED, "false");
```

Individual built-in hooks can be toggled off from **System Settings → Hooks** without disabling the whole system.

---

## 2. Global Enable Gate

The entire hook system is gated by `Token.getValue(USER_HOOKS_ENABLED) === "false"`. Defaults to ON when the token is unset.

| Test | Steps | Expected |
|---|---|---|
| **2.1 — Hooks enabled by default** | 1. Fresh start with no hooks config<br>2. Open AI Chat V2<br>3. Send a dangerous prompt (e.g. "run shell command `rm -rf /`") | Hook blocks the command; tool result shows block reason |
| **2.2 — Disable hooks globally** | 1. Set `USER_HOOKS_ENABLED` to `"false"`<br>2. Send matching tool prompt | Tool executes normally; hooks do not fire |
| **2.3 — Re-enable hooks globally** | 1. Set `USER_HOOKS_ENABLED` to `"true"` (or unset it)<br>2. Verify setting | Hooks fire again on next matching tool call |
| **2.4 — Disabled returns empty aggregate** | 1. With hooks disabled, check main process logs | `[HookDispatcher]` shows `EMPTY_AGGREGATE` fast path |

---

## 3. PreToolUse Hook — Block Dangerous Shell Commands

### 3.1 Enable the built-in blocking hook

1. Open **System Settings → Hooks**
2. Find `builtin-block-dangerous-shell-delete`
3. Toggle it **ON** (enabled)
4. Verify status shows "enabled"

### 3.2 Block a dangerous command

| Test | Steps | Expected |
|---|---|---|
| **3.2a — `rm -rf /` blocked** | Send in AI Chat: `run shell command rm -rf /` | Tool result shows error message: "Dangerous recursive delete command blocked by hook policy." |
| **3.2b — `rm -rf *` blocked** | Send: `run shell command rm -rf *` | Same block message; tool not executed |
| **3.2c — Safe `rm` allowed** | Send: `run shell command rm tempfile.txt` | Tool executes normally; file removed |
| **3.2d — Non-shell tool unaffected** | Send: `run shell command echo hello` | Hook matcher matches all `shell_execute`, but the callback only blocks `rm -rf (\/|\*)`; `echo hello` passes through |
| **3.2e — Blocked message visible in chat** | Observe the blocked tool result in the chat | Hook reason is shown as the error message; no raw JSON |

### 3.3 Disable hook and verify

| Test | Steps | Expected |
|---|---|---|
| **3.3a — Toggle off** | 1. Disable `builtin-block-dangerous-shell-delete`<br>2. Send: `run shell command rm -rf /` | Command executes (and fails harmless — no `/` mounted); hook no longer blocks |
| **3.3b — Re-enable** | 1. Re-enable the hook<br>2. Send: `run shell command rm -rf /` | Blocking behavior returns |

---

## 4. PostToolUse Hook — Compliance Context After Scraping

### 4.1 Enable the scraping compliance hook

1. Open **System Settings → Hooks**
2. Find `builtin-scraping-compliance-context`
3. Toggle it **ON**
4. Verify status shows "enabled"

### 4.2 Verify context injection after a scrape

| Test | Steps | Expected |
|---|---|---|
| **4.2a — Scrape tool triggers hook** | 1. Send: `scrape https://example.com` (or any valid URL)<br>2. Wait for tool result | The AI's next response includes the compliance context: "When using scraped contact data, recommend compliant outreach..." |
| **4.2b — Non-scrape tool unaffected** | Send: `run shell command echo hello` | No compliance context added; PostToolUse matcher `scrape_*` doesn't match `shell_execute` |
| **4.2c — Hook does not modify scraped output** | Inspect the scrape tool result | `updatedToolOutput` is unset; the scraped content is returned unchanged; only `additionalContext` is injected |

### 4.3 Disable hook and verify

| Test | Steps | Expected |
|---|---|---|
| **4.3a — Toggle off** | 1. Disable the compliance hook<br>2. Send a scrape prompt | Tool output is normal; no compliance reminder appears in model response |

### 4.4 Hook modifies tool output (updatedToolOutput)

| Test | Steps | Expected |
|---|---|---|
| **4.4a — Hook wraps output with metadata** | 1. Create a PostToolUse command hook for `scrape_*` that returns metadata: `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const i=JSON.parse(b);console.log(JSON.stringify({continue:true,updatedToolOutput:{complianceChecked:true,checkedAt:new Date().toISOString()}}))})"`<br>2. Enable the hook<br>3. Send: `scrape https://example.com` | Tool result JSON includes `complianceChecked: true` and `checkedAt` merged into the output |
| **4.4b — Hook strips fields from output** | Create a PostToolUse command hook that returns `{updatedToolOutput:{content:"[REDACTED]"}}` with only a `content` key | The original tool output fields are replaced by the new `content`; other original fields remain |

### 4.5 Multiple PostToolUse hooks

| Test | Steps | Expected |
|---|---|---|
| **4.5a — Two hooks both add context** | 1. Create two PostToolUse command hooks with matcher `scrape_*` each returning `{continue:true, additionalContext:"Context A"}` and `{continue:true, additionalContext:"Context B"}`<br>2. Send: `scrape https://example.com` | AI's next response includes both "Context A" and "Context B" (merged in hook priority order) |
| **4.5b — One modifies output, one adds context** | 1. Hook A: returns `{updatedToolOutput:{checked:true}}`<br>2. Hook B: returns `{additionalContext:"Reviewed"}`<br>3. Send a scrape prompt | Both changes apply: output has `checked:true` and response includes "Reviewed" |

### 4.6 PostToolUse returning systemMessage

| Test | Steps | Expected |
|---|---|---|
| **4.6a — systemMessage injected into model** | Create a PostToolUse command hook for `scrape_*` that returns `{continue:true, systemMessage:"When presenting scraped data, always prefix with 'Source: '."}` | AI's response prefixes scraped content with "Source: " (system message influences model behavior) |

### 4.7 PostToolUse hook failure modes

| Test | Steps | Expected |
|---|---|---|
| **4.7a — failureMode=warn continues** | 1. Create a PostToolUse command hook that prints invalid JSON: `node -e "console.log('not json')"` with failureMode=warn<br>2. Send a scrape prompt | Tool output is normal; hook error logged; AI response unaffected |
| **4.7b — failureMode=block blocks result** | Same hook with failureMode=block | Hook error prevents the tool result from reaching the model; error behavior depends on dispatcher |

---

## 5. PostToolUseFailure Hook (Manual Simulation)

No built-in demo hook exists. Test by creating a user command hook and triggering a tool failure.

### 5.1 Create a user command hook for PostToolUseFailure

1. Open **System Settings → Hooks**
2. Click **"Add Hook"**
3. Fill in:
   - Event: `PostToolUseFailure`
   - Matcher: `*`
   - Type: `command`
   - Command: `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const i=JSON.parse(b);console.log(JSON.stringify({additionalContext:'Hook saw failure: '+(i.toolOutput?.error||'unknown')}))})"`
   - Timeout: `5000`
   - Failure mode: `warn`
4. Click Save

### 5.2 Trigger a tool failure

| Test | Steps | Expected |
|---|---|---|
| **5.2a — PostToolUseFailure fires** | 1. Send: `run shell command cat /nonexistent_file_xyz`<br>2. Wait for tool result | Tool result shows failure. Audit log shows PostToolUseFailure hook fired with status `success`. |
| **5.2b — Failure remains failure** | Check the tool result status | Result shows `success: false`; hook cannot turn failure into success |
| **5.2c — Successful tool does not trigger** | Send: `run shell command echo ok` | No PostToolUseFailure audit entry; event never fires for successful tools |

---

## 6. Command Hooks (User-Configured)

Command hooks execute a local process, receive hook input JSON on stdin, and return hook output JSON on stdout.

### 6.1 Create a command hook

1. Open **System Settings → Hooks**
2. Click **"Add Hook"**
3. Fill in:
   - Event: `PreToolUse`
   - Matcher: `shell_execute`
   - Type: `command`
   - Command: `node -e "process.stdin.resume(); let b=''; process.stdin.on('data',c=>b+=c); process.stdin.on('end',()=>{const i=JSON.parse(b); if(i.input?.command?.includes('dangerous')){console.log(JSON.stringify({continue:false,reason:'Blocked by user command hook'}))}else{console.log(JSON.stringify({continue:true}))}})"`
   - Timeout: `5000`
   - Failure mode: `warn`
4. Click Save

### 6.2 Hook blocks via stdout JSON

The hook's command receives JSON on stdin and must print a JSON result to stdout.
The table below gives concrete commands to paste for each scenario.

| Test | Command to paste | Prompt to send | Expected |
|---|---|---|---|
| **6.2a — Block** | `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({continue:false,reason:'Blocked by manual test'}))})"` | `run shell command echo hello` | Tool result shows error "Blocked by manual test"; tool not executed |
| **6.2b — Allow** | `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({continue:true}))})"` | `run shell command echo hello` | Tool executes normally; no error |
| **6.2c — Invalid JSON** | `node -e "console.log('not json')"` | `run shell command echo hello` | Hook fails (parse error); tool continues (failure mode: warn); error logged to console |

### 6.3 Timeout behavior

| Test | Steps | Expected |
|---|---|---|
| **6.3a — Hook times out** | 1. Create a command hook: `node -e "setTimeout(() => process.exit(0), 10000)"` with timeoutMs=2000 and failureMode=block<br>2. Send matching prompt | Hook times out; if failureMode=block, tool is blocked with timeout error; if failureMode=warn, tool continues |
| **6.3b — Verify timeout duration** | Check audit logs | `durationMs` is close to 2000; status is `timeout` |

### 6.4 Input forwarded correctly

| Test | Command to paste | Prompt to send | Expected |
|---|---|---|---|
| **6.4a — Hook receives tool name** | `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const i=JSON.parse(b);console.log(JSON.stringify({continue:true,additionalContext:'tool.name='+i.tool.name}))})"` | `run shell command echo hello` | Tool executes. The AI's next response includes "tool.name=shell_execute" (injected via `additionalContext`) |
| **6.4b — Hook receives command arguments** | `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const i=JSON.parse(b);console.log(JSON.stringify({continue:true,additionalContext:'cmd='+i.input.command}))})"` | `run shell command echo hello` | AI response includes "cmd=echo hello" |
| **6.4c — Hook sees the event name** | `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const i=JSON.parse(b);console.log(JSON.stringify({continue:true,additionalContext:'event='+i.eventName}))})"` | `run shell command echo hello` | AI response includes "event=PreToolUse" |

---

## 7. Hook Result Aggregation

### 7.1 Multiple hooks on same event

| Test | Steps | Expected |
|---|---|---|
| **7.1a — Block wins** | 1. Enable both the dangerous-shell-delete hook (blocks) AND another PreToolUse hook that allows<br>2. Send: `run shell command rm -rf /` | Block wins; tool is not executed |
| **7.1b — Deny always wins** | 1. Create two PreToolUse hooks: one returns `permissionDecision: "allow"`, another returns `permissionDecision: "deny"`<br>2. Send matching prompt | Tool is denied; deny wins over allow |
| **7.1c — Source priority order** | Built-in hooks execute before user hooks | `builtin-block-dangerous-shell-delete` runs before any user command hook |

---

## 8. Hook Registry & Management UI

Refer to the Hooks Management UI plan for full CRUD testing. Key tests:

| Test | Steps | Expected |
|---|---|---|
| **8.1 — List hooks** | Open **System Settings → Hooks** | All registered hooks shown (built-in + user-configured) with source, event, matcher, enabled status |
| **8.2 — Toggle hook** | Toggle a built-in hook ON/OFF | Saved immediately; behavior changes on next tool call |
| **8.3 — Edit user hook** | Click edit on a user-configured hook | Command, matcher, if condition, timeout, failure mode editable |
| **8.4 — Delete user hook** | Delete a user-configured hook | Removed from registry; no longer fires |
| **8.5 — Last run status** | Check the hook row after firing | Shows last run timestamp + status (success/failed/timeout) |

---

## 9. Audit Logs

| Test | Steps | Expected |
|---|---|---|
| **9.1 — Audit entry created** | 1. Enable `builtin-block-dangerous-shell-delete`<br>2. Send: `run shell command rm -rf /`<br>3. Open Hook Audit panel | Entry shows: hook ID, event, status "success" (or "blocked"), duration, source |
| **9.2 — Filter audit by hook** | Use the audit filter in System Settings | Entries filterable by hook ID, event name, status |
| **9.3 — Filter by status** | Trigger a timeout hook | Audit filtered by "timeout" shows only that entry |
| **9.4 — No secrets in audit** | Use a command hook with a secret in stdin | Audit log `reason` field is redacted; no raw secret exposed |

---

## 10. Hook Matcher Patterns

| Test | Matcher | Tool Name | Expected Match |
|---|---|---|---|
| **10a — Wildcard** | `*` | any | Match |
| **10b — Exact** | `shell_execute` | `shell_execute` | Match |
| **10c — Exact (no match)** | `shell_execute` | `scrape_page` | No match |
| **10d — Suffix wildcard** | `mcp_*` | `mcp_weather_get` | Match |
| **10e — Prefix wildcard** | `*_search` | `web_search` | Match |
| **10f — Contains wildcard** | `scrape_*_urls` | `scrape_all_urls` | Match |
| **10g — Empty matcher** | `""` | any | No match |
| **10h — Oversized matcher** | >200 chars | any | No match (malformed) |
| **10i — `if` matches arg value** | matcher=`shell_execute`, if=`echo *` | `shell_execute` with command=`echo hello` | Match (`if` pattern matches arg value) |
| **10j — `if` does not match arg value** | matcher=`shell_execute`, if=`git *` | `shell_execute` with command=`ls -la` | No match (`if` pattern rejects) |
| **10k — `if` applies to non-tool events** | event=`SessionStart`, if=`echo *` | `SessionStart` has no tool input | Match (`if` ignored for non-tool events) |
| **10l — `if` matches non-`command` arg** | matcher=`mcp_*`, if=`weather` | `mcp_weather` tool with `location=London` | Match (`weather` found in `JSON.stringify(toolInput)`) |

---

## 11. Permission Integration

| Test | Steps | Expected |
|---|---|---|
| **11.1 — Hook allow does not bypass permission** | 1. Register a skill that requires permission prompt<br>2. Create a PreToolUse hook that returns `permissionDecision: "allow"`<br>3. Use the skill | Permission prompt still appears; hook `allow` does not skip `SkillPermissionService` |
| **11.2 — Hook deny short-circuits permission** | 1. PreToolUse hook returns `permissionDecision: "deny"`<br>2. Use any matching tool | Tool is denied; permission prompt never shown |
| **11.3 — Existing permission deny > hook allow** | 1. Manually set a skill to "denied" in permissions<br>2. PreToolUse hook returns `allow`<br>3. Use the skill | Skill is denied; hook allow cannot override existing deny |

---

## 12. Abort / Stop During Hook

| Test | Steps | Expected |
|---|---|---|
| **12.1 — Stop during callback hook** | 1. Create a callback hook with a async delay (`await new Promise(r => setTimeout(r, 5000))`)<br>2. Send matching prompt<br>3. Click Stop before hook completes | Hook aborted; remaining hooks skipped; tool does not execute |
| **12.2 — Stop during command hook** | 1. Create a slow command hook (e.g., `node -e "setTimeout(() => process.exit(0), 10000)"`)<br>2. Send matching prompt<br>3. Click Stop | Command process killed; chat stops; no orphaned process |

---

## 13. Edge Cases

| Test | Steps | Expected |
|---|---|---|
| **13.1 — No hooks matched** | 1. Enable hooks globally but register no matching hooks<br>2. Send any tool prompt | Dispatcher fast-paths: `EMPTY_AGGREGATE`; tool executes normally; <5ms overhead |
| **13.2 — Hook throws exception** | Create a callback hook that throws | Hook marked as failed; tool continues (failureMode=warn); no crash |
| **13.3 — Hook modifies tool input** | Create a PreToolUse command hook for `shell_execute` that prints `{"updatedInput":{"command":"echo safe"}}`, then send `run shell command echo hello` | Tool receives the modified input instead of the original. The tool-call card/history should show `command: "echo safe"` and the shell result should output `safe` |
| **13.4 — Hook returns systemMessage** | Create any hook returning `{ systemMessage: "Hello from hook" }` | System message appears in the chat UI |
| **13.5 — Multiple hooks add context** | Two PostToolUse hooks each return `additionalContext` | Both context strings appear; merged in order |
| **13.6 — Abort signal before dispatch** | 1. Send a prompt<br>2. Click Stop before the tool call | Dispatcher sees `abortSignal.aborted` and returns `EMPTY_AGGREGATE` |

---

## 14. Regression Testing

| Test | Steps | Expected |
|---|---|---|
| **14.1 — No hooks = no behavior change** | 1. Disable hooks globally<br>2. Run through standard AI chat prompts (chat, plan, subagent, file ops) | All behaviors identical to before hooks feature |
| **14.2 — Existing permission system intact** | Run existing permission tests | No change to how permissions are granted, prompted, or denied |
| **14.3 — Unit test suite passes** | Run all hook tests | All pass |

---

## 15. Automated Test Reference

```bash
# All hook utility tests
npx vitest run test/vitest/utilitycode/hooks/

# Specific dispatcher tests
npx vitest run test/vitest/utilitycode/hooks/HookDispatcher.test.ts

# Registry tests
npx vitest run test/vitest/utilitycode/hooks/HookRegistry.test.ts
npx vitest run test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts

# Module-level tests
yarn test test/modules/HookModule.test.ts
yarn test test/modules/HookAuditModule.test.ts

# Full suite
yarn test
```

| Test File | Coverage |
|---|---|
| `HookDispatcher.test.ts` | Global gate, callback success/throw, aggregation, abort, no-hooks path |
| `HookMatcher.test.ts` | Exact, wildcard, prefix/suffix glob, edge cases, `if` condition matching |
| `HookRegistry.test.ts` | Registration, dedup, source priority, event filtering |
| `HookRegistry.listAll.test.ts` | listAll, registerUserHook, replaceUserHooks, filters |
| `HookResultAggregator.test.ts` | Block wins, deny wins, input merge, context merge |
| `HookOutputValidator.test.ts` | Valid/invalid output, size caps, unknown field stripping |
| `CallbackHookExecutor.test.ts` | Sync/async callbacks, throw handling, abort |
| `CommandHookExecutor.test.ts` | stdin JSON, stdout parse, timeout, invalid JSON |
| `HookAuditService.test.ts` | Entry shape, console logging, status values |
| `HookModule.test.ts` | CRUD, registry sync, validation |

---

## 16. Test Pass Criteria

- [ ] Hooks enabled by default; no performance regression when hooks fire
- [ ] Global enable/disable works immediately (no restart)
- [ ] Built-in PreToolUse hook blocks dangerous commands
- [ ] Built-in PostToolUse hook adds context after scraping
- [ ] Command hooks execute with stdin/stdout JSON contract
- [ ] Command hook timeout kills process within configured ms
- [ ] Invalid hook JSON treated as failure, not allow
- [ ] Block wins in aggregation; deny wins over allow
- [ ] Hook allow does not bypass SkillPermissionService
- [ ] Stop during hook aborts execution cleanly
- [ ] Audit entries created for every hook fire
- [ ] PreToolUse fires before tool execution
- [ ] PostToolUse fires after successful tool execution
- [ ] PostToolUse can modify tool output via `updatedToolOutput`
- [ ] PostToolUse can inject `systemMessage` into model context
- [ ] Multiple PostToolUse hooks aggregate context in priority order
- [ ] PostToolUseFailure fires after failed tool execution
- [ ] PermissionRequest fires when permission is needed
- [ ] PermissionRequest hook returning `deny` skips permission dialog
- [ ] PermissionDenied fires when permission is denied
- [ ] PermissionDenied hook can inject guidance via `additionalContext`
- [ ] SessionStart fires once per new conversation
- [ ] SessionStart hook can inject `additionalContext` and `systemMessage`
- [ ] UserPromptSubmit fires on every user message
- [ ] UserPromptSubmit `if` condition is ignored (non-tool event)
- [ ] Stop fires on conversation turn end (completed / user_stopped / error)
- [ ] Stop hook can inject summary via `additionalContext`
- [ ] PreToolUse deny → PermissionDenied fires (not PostToolUseFailure)
- [ ] PreToolUse block → no PostToolUse / PostToolUseFailure
- [ ] Permission already granted → no PermissionRequest fires
- [ ] All 13+ vitest hook test files pass
- [ ] All module test files pass

---

## 17. SessionStart Hook

Fires once when a new conversation begins. Dispatches with `matchQuery: undefined`
(→ `""`), so only hooks with `matcher: "*"` match.

### 17.1 Create a user command hook for SessionStart

1. Open **System Settings → Hooks** → **"Add Hook"**
2. Fill in:
   - Event: `SessionStart`
   - Matcher: `*`
   - Type: `command`
   - Command: `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({continue:true}))})"`
   - Timeout: `5000`
   - Failure mode: `warn`
3. Click Save

### 17.2 Verification

| Test | Steps | Expected |
|---|---|---|
| **17.2a — Fires on first message** | 1. Open a **new** conversation in AI Chat V2<br>2. Send: `hello`<br>3. Open **System Settings → Hooks → Audit Log** | Audit log shows one entry for `SessionStart` + one for `UserPromptSubmit` (from the same message) |
| **17.2b — Fires only once per conversation** | Send a second message in the same conversation: `how are you?` | Only `UserPromptSubmit` entries; no second `SessionStart` |
| **17.2c — Fires for each new conversation** | Start another new conversation, send any message | `SessionStart` fires again for the new conversation |
| **17.2d — Specific matcher does not match** | 1. Create a second SessionStart hook with matcher `shell_execute`<br>2. Send a plain chat message in a new conversation | Only the `*` matcher hook fires; `shell_execute` matcher skips `matchQuery=""` |

### 17.3 Hook output behaviors

| Test | Steps | Expected |
|---|---|---|
| **17.3a — Hook returns additionalContext** | Create a SessionStart command hook that returns `{continue:true, additionalContext:"Session opened at "+new Date().toISOString()}` | AI's first response in the new session shows awareness of the session time (context injected) |
| **17.3b — Hook returns systemMessage** | Create a SessionStart command hook that returns `{continue:true, systemMessage:"You are assisting a new user. Be friendly and introduce yourself."}` | AI introduces itself and is friendly in the first response |
| **17.3c — Multiple hooks both contribute** | Create two SessionStart hooks: one returns `{additionalContext:"Context A"}`, another returns `{additionalContext:"Context B"}` | AI's first response includes both contexts, ordered by hook priority |

### 17.4 SessionStart hook failure

| Test | Steps | Expected |
|---|---|---|
| **17.4a — failureMode=warn** | 1. Create a SessionStart hook that throws (invalid JSON) with failureMode=warn<br>2. Send `hello` in a new conversation | Chat works normally; hook error logged to console; no user-visible impact |
| **17.4b — failureMode=block** | Same hook with failureMode=block | Chat still proceeds (SessionStart info is advisory; block is logged but conversation starts) |

---

## 18. UserPromptSubmit Hook

Fires on every user message submission.

### 18.1 Create a user command hook for UserPromptSubmit

Same pattern as §17.1 but with:
- Event: `UserPromptSubmit`
- Matcher: `*`

### 18.2 Verification

| Test | Steps | Expected |
|---|---|---|
| **18.2a — Fires on every message** | Send 3 messages: `first`, `second`, `third` | Audit log shows 3 `UserPromptSubmit` entries, one per message |
| **18.2b — Contains prompt in input** | Create a hook that echoes back: `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const i=JSON.parse(b);console.log(JSON.stringify({additionalContext:'prompt: '+i.prompt?.substring(0,50)}))})"` | The AI's next response includes "prompt: ..." (injected via `additionalContext`) |
| **18.2c — Hook with `if` condition matching prompt** | 1. Create a UserPromptSubmit hook with matcher=`*`, if=`urgent`, returning `{additionalContext:"User marked as urgent"}`<br>2. Send: `this is urgent, help me` | Hook fires; AI response includes "User marked as urgent" |
| **18.2d — `if` on non-tool event is ignored** | 1. Same hook but set if=`nonexistent_*`<br>2. Send: `hello world` | Hook still fires (UserPromptSubmit is non-tool; `if` is ignored) |

### 18.3 Hook output behaviors

| Test | Steps | Expected |
|---|---|---|
| **18.3a — Hook returns systemMessage** | Create a UserPromptSubmit hook returning `{systemMessage:"The user is asking about: "+i.prompt?.substring(0,30)}` | AI response is influenced by the system message reflecting the prompt content |
| **18.3b — Multiple hooks both add context** | Two UserPromptSubmit hooks, each returning different `additionalContext` | Both contexts appear merged in order |
| **18.3c — Hook failure (warn)** | Hook that prints invalid JSON with failureMode=warn | Chat continues; error logged; no user-visible impact |

---

## 19. PermissionRequest Hook

Fires when `SkillPermissionService` needs user permission for a tool.
Dispatches with `matchQuery` set to the tool name (e.g. `"shell_execute"`).

### 19.1 Create a user command hook for PermissionRequest

1. Open **System Settings → Hooks** → **"Add Hook"**
2. Fill in:
   - Event: `PermissionRequest`
   - Matcher: `shell_execute`
   - Type: `command`
   - Command: `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({continue:true}))})"`
   - Timeout: `5000`
   - Failure mode: `warn`
3. Click Save

### 19.2 Verification

| Test | Steps | Expected |
|---|---|---|
| **19.2a — Fires before permission prompt** | 1. Clear any saved `shell_execute` permission<br>2. Send: `run shell command echo hello` | Audit log shows `PermissionRequest` before the permission dialog appears |
| **19.2b — Already-granted tool does not fire** | 1. Grant `shell_execute` permanently<br>2. Send the same command in a new conversation | No `PermissionRequest` entry (permission cached; hook not dispatched) |
| **19.2c — Non-matching tool skips** | Send a non-shell prompt (e.g. `scrape https://example.com`) | No `PermissionRequest` entry for `shell_execute` matcher |
| **19.3 — Hook cannot bypass permission** | Create a `PermissionRequest` hook returning `permissionDecision: "allow"` | Permission prompt still appears; hook allow does not bypass `SkillPermissionService` |

### 19.3 Hook deny behavior

| Test | Steps | Expected |
|---|---|---|
| **19.3a — Hook returns deny → skips dialog** | Create a PermissionRequest hook for `shell_execute` that returns `{permissionDecision:"deny", reason:"Blocked by policy"}` | Permission dialog is **not** shown; tool is denied immediately; audit shows `PermissionDenied` |
| **19.3b — Hook deny reason shown in audit** | After the test above, check audit log | `PermissionDenied` entry includes the reason "Blocked by policy" from the hook |

### 19.4 Hook output behaviors

| Test | Steps | Expected |
|---|---|---|
| **19.4a — Hook adds additionalContext** | Create a PermissionRequest hook returning `{additionalContext:"User has been warned about shell access"}` | `additionalContext` is available to the system (may appear in permission dialog context) |
| **19.4b — Multiple hooks on PermissionRequest** | Two PermissionRequest hooks: one returns `{additionalContext:"Ctx A"}`, another returns `{additionalContext:"Ctx B"}` | Both contexts are available; merged in priority order |
| **19.4c — Hook returns systemMessage** | PermissionRequest hook returns `{systemMessage:"Remind user of security policy before granting permission"}` | System message influences the AI's behavior when the permission dialog appears |

### 19.5 PermissionRequest hook failure

| Test | Steps | Expected |
|---|---|---|
| **19.5a — failureMode=warn** | Hook prints invalid JSON with failureMode=warn | Permission dialog still appears; hook error logged |
| **19.5b — Hook timeout** | Hook command: `node -e "setTimeout(() => process.exit(0), 10000)"` with timeoutMs=2000, failureMode=warn | Hook times out; permission dialog still appears; audit shows timeout |

---

## 20. PermissionDenied Hook

Fires when a tool is denied — either by user clicking Deny in the permission prompt,
or by a PreToolUse hook returning `permissionDecision: "deny"`.

### 20.1 Create a user command hook for PermissionDenied

1. Open **System Settings → Hooks** → **"Add Hook"**
2. Fill in:
   - Event: `PermissionDenied`
   - Matcher: `*`
   - Type: `command`
   - Command: `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({continue:true}))})"`
   - Timeout: `5000`
   - Failure mode: `warn`
3. Click Save

### 20.2 Verification

| Test | Steps | Expected |
|---|---|---|
| **20.2a — Denied by user** | 1. Clear saved `shell_execute` permission<br>2. Send: `run shell command ls`<br>3. When permission dialog appears, click **Deny** | Audit log shows `PermissionDenied` entry with `reason` field |
| **20.2b — Denied by PreToolUse hook** | 1. Create a PreToolUse hook with matcher `shell_execute` returning `{ permissionDecision: "deny", reason: "Blocked by policy" }`<br>2. Send a shell command | Audit log shows `PermissionDenied`; tool not executed |
| **20.2c — Granted tool does not fire** | Grant `shell_execute` permission, send command | No `PermissionDenied` entry |

### 20.3 Hook output behaviors

| Test | Steps | Expected |
|---|---|---|
| **20.3a — Hook adds guidance via additionalContext** | Create a PermissionDenied hook returning `{additionalContext:"Remind user they can request admin access if they need this tool"}` | AI response includes the guidance message |
| **20.3b — Hook returns systemMessage** | PermissionDenied hook returns `{systemMessage:"Explain why the tool was denied and suggest alternatives"}` | AI explains the denial reason and suggests alternative approaches |
| **20.3c — Multiple hooks both contribute** | Two PermissionDenied hooks, each returning different `additionalContext` | Both contexts appear merged in priority order |

### 20.4 Different denial sources

| Test | Steps | Expected |
|---|---|---|
| **20.4a — Denied by user — reason captured** | 1. Clear shell_execute permission<br>2. Send: `run shell command ls`<br>3. Click **Deny** in the dialog | Audit entry contains the reason from user action (e.g., "User denied permission") |
| **20.4b — Denied by PreToolUse hook — different reason** | PreToolUse hook for `shell_execute` returns `{permissionDecision:"deny", reason:"Company policy: no shell access"}` | Audit shows reason "Company policy: no shell access" (different from 20.4a) |

### 20.5 PermissionDenied hook failure

| Test | Steps | Expected |
|---|---|---|
| **20.5a — failureMode=warn** | Hook throws (invalid JSON) with failureMode=warn | Denial flow continues; error logged |
| **20.5b — failureMode=block** | Same hook with failureMode=block | Denial flow continues (denial is already a terminal state for the tool); block is logged but has no additional effect |

---

## 21. Stop Hook

Fires when a conversation turn ends — by natural completion, user clicking Stop, or error.

### 21.1 Create a user command hook for Stop

Same pattern as §17.1 but with:
- Event: `Stop`
- Matcher: `*`

### 21.2 Verification

| Test | Steps | Expected |
|---|---|---|
| **21.2a — Stop on completion** | Send: `say hi`, wait for full response | Audit log shows `Stop` with `reason: "completed"` |
| **21.2b — Stop on user click** | 1. Send: `write a 500 word essay about AI`<br>2. Click **Stop** button while streaming | Audit log shows `Stop` with `reason: "user_stopped"` |
| **21.2c — Stop on error** | Temporarily disable AI mid-session (set `USER_AI_ENABLED = "false"`), try to send | Audit log shows `Stop` with `reason: "error"` |

### 21.3 Hook output behaviors

| Test | Steps | Expected |
|---|---|---|
| **21.3a — Hook adds session summary via additionalContext** | Create a Stop command hook returning `{additionalContext:"Conversation turn ended. Reason: "+i.reason}` | After the turn ends, the next turn's context includes the stop reason |
| **21.3b — Hook returns systemMessage** | Stop hook returns `{systemMessage:"The previous response was interrupted. Summarize what was completed."}` | On the next user message, the AI summarizes what was done before the stop |
| **21.3c — Multiple Stop hooks** | Two Stop hooks, each returning different `additionalContext` | Both contexts appear merged in priority order |

### 21.4 Stop hook failure

| Test | Steps | Expected |
|---|---|---|
| **21.4a — failureMode=warn** | Hook prints invalid JSON with failureMode=warn | Conversation continues; error logged |
| **21.4b — failureMode=block** | Same hook with failureMode=block | Stop event has no follow-up action to block; error logged but no user-visible effect |

---

## 22. Event Ordering & Mutual Exclusivity

Key architectural invariants: (a) a given tool invocation dispatches at most one of `{PreToolUse, PostToolUse, PostToolUseFailure}`, and (b) `PermissionRequest` and `PermissionDenied` are independent of the tool-use event family.

### 22.1 PreToolUse deny → PermissionDenied fires (no PostToolUseFailure)

| Test | Steps | Expected |
|---|---|---|
| **22.1a — PreToolUse deny triggers PermissionDenied** | 1. Create a PreToolUse hook for `shell_execute` returning `{permissionDecision:"deny", reason:"No shells"}`<br>2. No saved permission for `shell_execute`<br>3. Send: `run shell command echo hi` | Audit shows `PreToolUse` → `PermissionDenied`. No `PostToolUseFailure` (denial is not a tool failure). |
| **22.1b — PreToolUse block does NOT trigger PermissionDenied** | 1. PreToolUse hook returns `{continue:false, reason:"Blocked"}`<br>2. No saved permission<br>3. Send a matching command | Audit shows only `PreToolUse` with status `blocked`. No `PermissionRequest`, no `PermissionDenied`. |

### 22.2 PreToolUse block → no PostToolUse / PostToolUseFailure

| Test | Steps | Expected |
|---|---|---|
| **22.2a — Blocked tool = no follow-up hook** | 1. Enable `builtin-block-dangerous-shell-delete`<br>2. Also register a PostToolUse and PostToolUseFailure hook with matcher `*` for visibility<br>3. Send: `run shell command rm -rf /` | Audit shows only `PreToolUse` (blocked). Neither `PostToolUse` nor `PostToolUseFailure` fires. |

### 22.3 PreToolUse allow (pass-through) → PostToolUse fires

| Test | Steps | Expected |
|---|---|---|
| **22.3a — Successful tool → PostToolUse** | 1. PreToolUse hook returns `{continue:true}`<br>2. PostToolUse hook (matcher `*`) logs the event<br>3. Send: `run shell command echo ok` | Audit shows `PreToolUse` → `PostToolUse`. Tool result is `success: true`. |
| **22.3b — Failed tool → PostToolUseFailure** | 1. Same PreToolUse pass-through hook<br>2. PostToolUseFailure hook (matcher `*`) logs the event<br>3. Send: `run shell command cat /nope` | Audit shows `PreToolUse` → `PostToolUseFailure`. Tool result is `success: false`. |

### 22.4 Permission already granted → no PermissionRequest

| Test | Steps | Expected |
|---|---|---|
| **22.4a — Cached permission skips request** | 1. Grant `shell_execute` permission permanently<br>2. Register PermissionRequest hook matcher `shell_execute`<br>3. Send: `run shell command ls` | No `PermissionRequest` entry. PostToolUse fires directly after PreToolUse. |

### 22.5 PreToolUse deny vs PermissionDenied from user — different sources

| Test | Steps | Expected |
|---|---|---|
| **22.5a — Deny source is distinguishable in audit** | 1. Case A: PreToolUse hook returns `{permissionDecision:"deny"}` → audit shows `source: "system"` or similar<br>2. Case B: User clicks Deny in dialog → audit shows `source: "user"` | Audit entries for each case contain distinguishable source information |
| **22.5b — SessionStart + UserPromptSubmit on first message** | 1. Register hooks for both events<br>2. Send first message in brand new conversation | Audit shows `SessionStart` then `UserPromptSubmit` (in that order). Both fire before any PreToolUse. |
| **22.5c — Stop fires after every turn type** | After each of: successful tool, failed tool, denied tool, plain chat | Stop fires after each turn completion with appropriate reason |

---

## 23. If Condition Filter (Secondary Filter)

The `if` field is an optional glob-lite pattern matched against tool input argument values. It acts as a secondary pre-filter after `matcher`. For tool events only (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`); ignored for non-tool events.

### 22.1 Create a hook with `if` condition

1. Open **System Settings → Hooks** → **"Add Hook"**
2. Fill in:
   - Event: `PreToolUse`
   - Matcher: `shell_execute`
   - If condition: `git *`
   - Type: `command`
   - Command: `node -e "process.stdin.resume();let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({additionalContext:'git command detected'}))})"`
   - Timeout: `5000`
   - Failure mode: `warn`
3. Click Save

### 22.2 Verification

| Test | Steps | Expected |
|---|---|---|
| **22.2a — `if` matches** | Send: `run shell command git status` | Hook fires; AI response includes "git command detected" in `additionalContext` |
| **22.2b — `if` does not match** | Send: `run shell command echo hello` | Hook does not fire (no `additionalContext`); tool executes normally |
| **22.2c — `if` ignored for non-tool events** | 1. Create a `UserPromptSubmit` hook with matcher=`*`, if=`git *`<br>2. Send a plain chat message `hello` | Hook fires (non-tool event ignores `if` condition) |
| **22.2d — `if` with empty value** | Edit the hook: set `if` to blank | Hook fires on all `shell_execute` invocations (no filter) |
| **22.2e — `if` with `*` wildcard** | Edit the hook: set `if` to `*` | Same as empty — matches all `shell_execute` invocations |

### 22.3 Matches against serialized toolInput

The `if` condition scans individual string argument values. If none match, it falls back to matching against `JSON.stringify(toolInput)`.

| Test | Steps | Expected |
|---|---|---|
| **22.3a — Match in serialized fallback** | Create a hook with matcher=`mcp_search`, if=`keyword.*query` and call an MCP tool with `{ "query": "hello world" }` | Hook fires (`"keyword.*query"` matches `"query":"hello world"` in serialized JSON) |

---

## 24. All 8 Events — Quick-Reference Smoke Test

Create one command hook per event (all `matcher: "*"`, trivial `{continue:true}` command).
Then run the trigger sequence below and check the audit log after each step.

| Step | Action | Expected Audit Events |
|------|--------|----------------------|
| 1 | Open new conversation | |
| 2 | Send: `hello` | `SessionStart`, `UserPromptSubmit` |
| 3 | Send: `run shell command echo hi` | `UserPromptSubmit`, `PreToolUse`, `PostToolUse` |
| 4 | Send: `run shell command cat /nope` | `UserPromptSubmit`, `PreToolUse`, `PostToolUseFailure` |
| 5 | Send: `run shell command ls` → deny permission | `UserPromptSubmit`, `PermissionRequest`, `PermissionDenied` |
| 6 | Click **Stop** mid-stream | `Stop` (reason: `user_stopped`) |
| 7 | Wait for natural end | `Stop` (reason: `completed`) |

### Smoke test order (if short on time)

1. **§17.2a** — SessionStart fires on new conversation
2. **§18.2a** — UserPromptSubmit fires on every message
3. **§5.2a** — PostToolUseFailure fires after failed tool
4. **§19.2a** — PermissionRequest fires before permission dialog
5. **§20.2b** — PermissionDenied fires from PreToolUse deny
6. **§21.2a/b** — Stop fires on completion + user stop
