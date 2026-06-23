# Plan: AiFetchly Hooks System — MVP Foundation (Phases 1–3)

## Context

AiFetchly's AI chat (`StreamEventProcessor`) can invoke local skills, MCP tools, and legacy tools through `SkillExecutor` / `ToolExecutor`, gated by `SkillPermissionService`. As tool capabilities grow (shell, scraping, automation, file ops), there is no uniform place to block, rewrite, annotate, or audit tool calls based on local policy. Without it, safety checks become scattered conditionals inside the stream processor and IPC handlers — hard to test, easy to bypass.

The PRD (`docs/superpowers/specs/2026-06-23-hooks-system-prd.md`) and technical design (`docs/superpowers/specs/2026-06-23-hooks-system-technical-design.md`) define a lifecycle hook layer adapted from Claude Code's model but fitted to AiFetchly's main-process service layer. The design spans 6 phases; this plan delivers the **MVP foundation** in one session:

- **Phase 1** — Type contracts, matcher, validator, aggregator, registry, dispatcher, callback executor, audit service.
- **Phase 2** — `PreToolUse` / `PostToolUse` / `PostToolUseFailure` integration inside `StreamEventProcessor.executeTool()`.
- **Phase 3 (slice)** — `CommandHookExecutor` with timeout, stdout/stderr caps, env allowlist, trust gate, JSON validation.

**Deferred:** UI + persistence (Phase 4), plugin hooks (Phase 5), HTTP/AI-powered hooks (Phase 6), and `SessionStart` / `UserPromptSubmit` / `Stop` stream integration (dispatcher supports them, but tool events satisfy MVP acceptance criteria).

**Outcome:** built-in callback hooks and trusted command hooks can block, rewrite, and annotate tool execution. Hook `allow` never bypasses `SkillPermissionService`. No-hooks fast path preserves current behavior with negligible overhead. Zero chat-stream crashes from hook failures.

---

## Scope Boundaries (MVP)

In scope:
- Events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`. (Type system defines all 8 events; dispatcher accepts them.)
- Hook types: `callback` (trusted, in-process) and `command` (trusted, local subprocess).
- Sources: `builtin`, `session`. (Registry has slots for `user`/`project`/`plugin`/`policy` but no persistence/UI yet.)
- Built-in demo hooks: `builtin-block-dangerous-shell-delete`, `builtin-scraping-compliance-context` — registered disabled by default for manual QA.

Out of scope:
- Database entities, model/module layer, IPC, UI, i18n strings.
- `PermissionRequest` / `PermissionDenied` dispatch wiring (the type contracts exist; StreamEventProcessor integration deferred until permission UI refactor).
- HTTP, prompt, agent hook executors.
- Plugin ownership filtering.

---

## Files to Create

### Types
- `src/entityTypes/hookTypes.ts` — closed event union, `HookInput` variants, `HookOutput`, `HookDefinition` (callback | command), `AggregatedHookResult`, `HookExecutionError`, `HOOK_LIMITS` constants. Verbatim from tech design §Type System.

### Core service (pure, testable without Electron)
- `src/service/hooks/HookMatcher.ts` — `matchesHookMatcher(matcher, query)`. Glob-lite: `*`, exact, prefix/suffix/contains wildcards. Cap matcher length at 128.
- `src/service/hooks/HookOutputValidator.ts` — `validateHookOutput(unknown) → { valid, output } | { valid, error }`. Rejects non-objects, oversized strings, invalid `permissionDecision`, non-object `updatedInput`/`updatedToolOutput`. Enforces `HOOK_LIMITS`.
- `src/service/hooks/HookResultAggregator.ts` — `aggregateResults(HookSingleResult[]) → AggregatedHookResult`. Rules from tech design §HookResultAggregator (block wins, deny > ask > allow, shallow merge `updatedInput` / `updatedToolOutput` in execution order, append contexts/systemMessages/errors, blocking failure converts to block).
- `src/service/hooks/HookRegistry.ts` — in-memory registry, `Map<HookEventName, HookDefinition[]>`. APIs: `registerBuiltinHook`, `registerSessionHook`, `clearSessionHooks`, `getMatchingHooks`, `resetForTests`. Filters disabled and untrusted command hooks. Source-priority ordering: policy > builtin > session > project > plugin > user.
- `src/service/hooks/executors/CallbackHookExecutor.ts` — `executeCallback(hook, input, abortSignal) → HookSingleResult`. Wraps callback in try/catch, validates output, measures duration, respects abort before start.
- `src/service/hooks/executors/CommandHookExecutor.ts` — `executeCommand(input) → CommandHookExecutionResult`. Rejects untrusted; caps timeout at `HOOK_LIMITS.maxCommandTimeoutMs`; `child_process.spawn` with `shell: false`; pipes JSON on stdin; captures stdout/stderr with byte caps; kills on timeout/abort; parses stdout as JSON; rejects invalid JSON; builds env from `DEFAULT_HOOK_ENV_KEYS` allowlist only (never `process.env`); never injects `Token` values.
- `src/service/hooks/HookCommandTrustService.ts` — in-memory trust store for command hooks (MVP). APIs: `isTrusted(hookId)`, `setTrusted(hookId, trusted)`, `resetForTests()`. Persisted trust deferred to Phase 4.
- `src/service/hooks/HookAuditService.ts` — structured console logs only (no DB in MVP). Emits `HookAuditEntry` shaped per tech design. Redacts sensitive patterns (OpenAI keys, tokens, cookies, `Authorization`) before logging.
- `src/service/hooks/HookDispatcher.ts` — singleton service. `executeHooks({ eventName, input, matchQuery, abortSignal }) → Promise<AggregatedHookResult>`. No-hooks fast path returns `EMPTY_AGGREGATE` when registry reports zero matches. Sequential execution. Calls `HookAuditService` for start/success/blocked/failed/timeout.

### Built-in demo hooks (registered disabled by default)
- `src/service/hooks/builtinHooks.ts` — `registerBuiltinHooks()` registers the two example hooks from tech design §Example Built-In Hooks with `enabled: false`. Called once at app startup from `background.ts` (guarded so it only registers in the main process).

### Stream integration
- Modify `src/service/StreamEventProcessor.ts`:
  - `executeTool()`: build `HookToolDescriptor` via new helper `resolveHookToolDescriptor(toolId, toolName)`; compute pre-permission state from `SkillPermissionService.getPermissionStatus()` (cheap read); run `PreToolUse`; if blocked → return structured tool failure with `blockedByHook: true` and skip executor; merge `updatedInput` into effective params; run `PostToolUse` on success / `PostToolUseFailure` on failure; merge `updatedToolOutput`; append `additionalContext` and `systemMessages` to the existing tool result chunk metadata. **Do not** let hooks bypass `isDeferredSkillPermissionResult` / shell rate limit / dependency-install prompt paths.
  - New private helper `resolveHookToolDescriptor()` — uses `SkillRegistry.isRegistered` / `getSkill` and the `mcp_` prefix convention.
  - New private helper `buildHookBlockedToolResult(aggregate)` returning the failure shape from tech design §Hook Blocked Tool Result.

### Tests (vitest, no Electron)
- `test/vitest/utilitycode/hooks/HookMatcher.test.ts` — exact, wildcard (prefix/suffix/contains), `*`, oversize rejection.
- `test/vitest/utilitycode/hooks/HookOutputValidator.test.ts` — accept minimal/block/permission; reject primitive, bad permissionDecision, oversized strings, non-object `updatedInput`.
- `test/vitest/utilitycode/hooks/HookResultAggregator.test.ts` — block wins, first block reason wins, deny > ask > allow, allow advisory only, shallow input/output merge ordering, blocking failure → block, warning failure → error only.
- `test/vitest/utilitycode/hooks/HookRegistry.test.ts` — register builtin/session, clear session, filter disabled, filter untrusted command, source-priority order.
- `test/vitest/utilitycode/hooks/CallbackHookExecutor.test.ts` — success, throw → error, invalid output → error, respects abort before start, duration measured.
- `test/vitest/utilitycode/hooks/CommandHookExecutor.test.ts` — uses `node -e` fixtures: sends JSON on stdin, parses JSON output, rejects invalid JSON, enforces timeout (sleep past default), caps stdout (fixture that writes > cap), rejects untrusted hook, env contains only allowlist keys (no `process.env` secrets). Use `fs.mkdtemp` + small fixture scripts written to temp dir in `beforeAll`.
- `test/vitest/utilitycode/hooks/HookDispatcher.test.ts` — no-hooks fast path returns EMPTY_AGGREGATE; callback hook success; callback hook throw; invalid callback output; multiple callbacks aggregate; abort before command start.
- `test/vitest/utilitycode/hooks/StreamEventProcessorHooks.test.ts` — integration with fake executors. Uses the existing mock pattern from `skillExecutor.test.ts` (`vi.mock("@/service/SkillExecutor")`, `vi.mock("@/modules/token")`). Cases: (a) no hooks → behavior unchanged, (b) PreToolUse block → executor never called, structured failure returned, (c) PreToolUse `updatedInput` → executor receives updated params, (d) hook `allow` still hits `SkillPermissionService` deny, (e) PostToolUse adds context, (f) PostToolUseFailure adds message but does not flip failure to success.

## Files to Modify

- `src/service/StreamEventProcessor.ts` — integration points listed above.
- `src/background.ts` — call `registerBuiltinHooks()` once during main-process init (guarded by `process.type === 'browser'` or equivalent existing guard).

No changes to: `SkillExecutor.ts`, `SkillPermissionService.ts`, `ToolExecutor.ts`, `SqliteDb.ts`, IPC handlers, channels, preload, lang files, entities. (MVP has no UI/persistence surface.)

---

## Key Reused Symbols (do not re-implement)

- `SkillRegistry.isRegistered(name)`, `SkillRegistry.getSkill(name)` → `SkillDefinition` with `permissionCategory: SkillPermissionCategory` — `src/config/skillsRegistry.ts`, `src/entityTypes/skillTypes.ts`.
- `SkillPermissionService.getPermissionStatus(name) → "granted" | "denied" | "unknown"` and `checkPermission(name) → { allowed, reason?, needsPrompt }` — `src/service/SkillPermissionService.ts`.
- `SkillExecutor.execute(name, args, context) → ToolExecutionResult` — `src/service/SkillExecutor.ts`. Never throws; returns `{ success, result, execution_time_ms, ... }` with `result.needsPermissionPrompt` for deferred permission.
- `ToolExecutionService.saveToolCall` / `saveToolResult` — unchanged, still owns persistence.
- Existing test mocking pattern — `vi.mock("@/modules/token", ...)` plus direct static-method calls. See `test/vitest/utilitycode/skillExecutor.test.ts`.
- Vitest alias `@` → `./src` already configured; new tests belong under `test/vitest/utilitycode/hooks/` to be picked up by the utility-code vitest config.

## Aggregation / Permission Rules (critical correctness)

Implemented in `HookResultAggregator` and verified by tests:
1. `continue: false` ⇒ `blocked = true`; first block reason wins (execution order = priority order).
2. `permissionDecision`: `deny` > `ask` > `allow`. `allow` is advisory only.
3. Hook `allow` **does not** skip `SkillExecutor` / `SkillPermissionService`. Hook `deny` short-circuits before the executor. Hook `ask` forces the existing permission-prompt path (the deferred-permission result already returned by `SkillExecutor` when `needsPrompt`).
4. `updatedInput` applies only to `PreToolUse`; multiple updates shallow-merge in execution order.
5. `updatedToolOutput` applies only to `PostToolUse`; never converts failure → success.

## Security Posture

- Command hooks: `trusted: true` required (in-memory trust service for MVP), `USER_HOOKS_ENABLED` setting will gate them in Phase 4 (for now trust service is the gate).
- Env allowlist: `PATH, HOME, USER, USERNAME, TEMP, TMP` only. Never `process.env` spread, never `Token` values.
- `shell: false` for command hooks; if shell syntax is required later it becomes explicit UI config.
- Audit logs redact secrets (OpenAI keys, bearer tokens, cookies, `Authorization`, passwords).
- Recursion guard stub: `HookExecutionContext { insideHookExecution: boolean }` threaded through dispatcher; tool execution paths can opt to skip user hooks when `insideHookExecution === true` (not wired to `SkillExecutor` in MVP, but the flag exists).

---

## Implementation Order (commits per logical unit, per CLAUDE.md)

1. **Types** — `hookTypes.ts` + empty test placeholder. Commit `feat: add hook system type contracts`.
2. **Matcher + tests.** Commit `feat: add HookMatcher with glob-lite matching`.
3. **Validator + tests.** Commit `feat: add HookOutputValidator with size and shape limits`.
4. **Aggregator + tests.** Commit `feat: add HookResultAggregator with block/deny/ask precedence`.
5. **Registry + tests.** Commit `feat: add HookRegistry with source-priority ordering`.
6. **Callback executor + tests.** Commit `feat: add CallbackHookExecutor`.
7. **Audit service.** Commit `feat: add HookAuditService with secret redaction`.
8. **Dispatcher + tests.** Commit `feat: add HookDispatcher with no-hooks fast path`.
9. **Command trust service + tests.** Commit `feat: add HookCommandTrustService`.
10. **Command executor + tests.** Commit `feat: add CommandHookExecutor with timeout and env allowlist`.
11. **Built-in demo hooks + background.ts wiring.** Commit `feat: register built-in demo hooks (disabled)`.
12. **StreamEventProcessor integration + integration tests.** Commit `feat: integrate PreToolUse/PostToolUse/PostToolUseFailure hooks into StreamEventProcessor`.

---

## Verification

### Unit & integration tests
- `yarn vitest run test/vitest/utilitycode/hooks` (or the project's exact utility-code test script — verify against `package.json`).
- Each new test file must pass independently and as a suite.

### Type check
- `yarn vue-check` and `yarn tsc` must remain green.

### Manual QA (after dev server runs)
1. Run AI chat with **no hooks enabled** → confirm tool execution, permission prompts, and dependency-install prompts behave exactly as before (no-hooks fast path).
2. Enable `builtin-block-dangerous-shell-delete`; ask AI to run `shell_execute` with `rm -rf /tmp/anything` → tool result is a structured failure with `blockedByHook: true` and the block reason; AI receives the failure and can suggest a safer command.
3. Enable `builtin-scraping-compliance-context`; trigger any `scrape_*` tool → successful result unchanged, but `additionalContext` appears in the result chunk metadata.
4. Register a session callback hook at runtime that rewrites a harmless tool's param; confirm executor receives the rewritten value.
5. Configure a trusted command hook pointing at a small `node -e` JSON emitter; confirm output affects execution. Then point it at a script that sleeps past timeout → confirm timeout error, tool proceeds only if `failureMode: "warn"`.
6. Stop chat while a slow command hook runs → confirm abort kills the child process and tool result is not dispatched.

### Acceptance mapping (PRD §MVP Acceptance)
1. PreToolUse callback blocks a tool → ✓ (test + manual QA #2).
2. PreToolUse callback modifies input → ✓ (test + QA #4).
3. Skill permission denial still blocks on hook `allow` → ✓ (aggregator test + integration test (d)).
4. PostToolUse adds context → ✓ (test + QA #3).
5. PostToolUseFailure adds a message without flipping to success → ✓ (integration test (f)).
6. Hook failures never crash chat → ✓ (callback/command executor tests + dispatcher test).
7. No-hooks overhead negligible → ✓ (fast-path test; benchmark informal).
8. Unit tests cover aggregation + permission precedence → ✓.
9. Tool-loop tests cover block / update / success / failure → ✓.

### Command-hook acceptance mapping (PRD §Command Hook Acceptance)
1–7 → covered by `CommandHookExecutor.test.ts` + manual QA #5–#6.

---

## Risks & Mitigations (MVP-specific)

| Risk | Mitigation |
| --- | --- |
| Hook exception crashes chat | All hook execution wrapped in try/catch; aggregator records `hookErrors`; dispatcher never throws. |
| Hook `allow` bypasses permission | Centralized in aggregator + dedicated integration test; `SkillExecutor` path unchanged. |
| Command hook RCE | Trust gate, `shell: false`, env allowlist, no `Token` in input, timeout, stdout cap, audit. |
| Performance regression | Per-event `Map` in registry; fast path returns `EMPTY_AGGREGATE` when zero matches. |
| Recursion | `HookExecutionContext.insideHookExecution` flag threaded through dispatcher (stubs future SkillExecutor opt-out). |
| StreamEventProcessor regressions | Integration tests cover no-hooks path explicitly; deferred-permission and dependency-install branches preserved. |
