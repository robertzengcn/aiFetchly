# Hooks System Management UI — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorm sign-off 2026-07-01)
**Owner:** AiFetchly AI Chat / Settings
**Related:** `docs/superpowers/specs/2026-06-23-hooks-system-prd.md`, `docs/superpowers/specs/2026-06-23-hooks-system-technical-design.md`
**PRD Phase:** 4 — User Configuration And UI

## Summary

Add a Hooks management page under System Settings that lets users see every registered lifecycle hook, configure their own command hooks, manage trust, toggle the system globally, and inspect recent audit activity. This delivers PRD Phase 4 on top of the already-implemented Phase 1-3 backend (`HookRegistry`, `HookDispatcher`, `HookOutputValidator`, `HookResultAggregator`, `HookAuditService`, `HookCommandTrustService`, `CallbackHookExecutor`, `CommandHookExecutor`, two demo builtins).

The work brings up the missing persistence, IPC, frontend API, UI, and i18n layers, plus the registry/trust upgrades needed for user-managed hooks.

## Goals

1. Let users enumerate all hooks currently registered in `HookRegistry` (builtin, user; session opt-in).
2. Persist user-configured command hooks so they survive restarts.
3. Persist trust grants, replacing the in-memory `HookCommandTrustService` cache.
4. Persist audit entries so users can review recent hook activity.
5. Provide CRUD + trust + global-enable controls behind the standard IPC → Module → Model → Entity architecture.
6. Wire user hooks into `HookRegistry` at app startup.
7. Gate the whole subsystem behind a global enable stored in `Token`.
8. Internationalize every user-facing string across the six supported languages.

## Non-Goals

1. Plugin hooks, project hooks, and policy hooks (PRD Phase 5+, deferred).
2. `http`, `prompt`, `agent`, or `function` hook types (PRD Phase 6, deferred).
3. AI-powered features anywhere in this layer (no `USER_AI_ENABLED` dependency in this work).
4. Creating `callback` hooks from the UI — those are code-registered as builtins.
5. Editing builtin hook definitions — only their enabled state can be overridden.
6. Test-run / dry-run of a hook against sample input (not in PRD acceptance).
7. Audit log retention policy UI (only a query panel; retention/cleanup is a later ops concern).

## Current State

Implemented (Phases 1-3, present on `dev` branch):

- `src/entityTypes/hookTypes.ts` — full type contracts (events, definitions, inputs, outputs, audit entries, limits).
- `src/service/hooks/HookRegistry.ts` — in-memory registry, builtin + session sources, `getMatchingHooks()` only.
- `src/service/hooks/HookDispatcher.ts` — dispatcher with no-hooks fast path.
- `src/service/hooks/HookMatcher.ts`, `HookOutputValidator.ts`, `HookResultAggregator.ts`.
- `src/service/hooks/HookAuditService.ts` — currently console-only.
- `src/service/hooks/HookCommandTrustService.ts` — in-memory trust, explicitly marked "Phase 4 will replace this with persisted Token-backed store when the UI CRUD lands."
- `src/service/hooks/executors/{CallbackHookExecutor,CommandHookExecutor}.ts`.
- `src/service/hooks/builtinHooks.ts` — two demo builtins (disabled by default).
- `StreamEventProcessor.executeTool()` integration (PreToolUse / PostToolUse / PostToolUseFailure).

Not implemented (this spec's scope):

- `src/entity/HookConfig.ts`, `src/entity/HookAuditEntry.ts`
- `src/model/Hook.model.ts`, `src/model/HookAudit.model.ts`
- `src/modules/HookModule.ts`, `src/modules/HookAuditModule.ts`
- `src/main-process/communication/hooks-ipc.ts`
- `src/views/api/hooks.ts`, preload exposure
- `src/views/pages/systemsetting/Hooks.vue` + route + sidebar entry
- i18n keys for the hooks page

## Architecture

The page lives at a new sub-route `system_setting_hooks`, mirroring how MCP and Skills sub-pages already work. The data flow follows the project's mandatory three-layer database access rule (IPC handlers never touch TypeORM directly):

```
Renderer (Hooks.vue)
  -> window.api.hooks.* (preload bridge)
  -> hooks-ipc.ts (IPC handlers, thin)
  -> HookModule / HookAuditModule (business logic)
  -> Hook.model / HookAudit.model (data access)
  -> HookConfig / HookAuditEntry entities (TypeORM)
  -> SQLite
```

Side channels at runtime:

- `HookModule.loadUserHooksIntoRegistry()` runs once at startup (after `SqliteDb` is ready) and pushes enabled user hooks into `HookRegistry` via a new `registerUserHook()` method, plus hydrates `HookCommandTrustService` cache from the `trusted` column.
- `HookAuditService` is upgraded to write through `HookAuditModule` instead of `console.log`.
- `HookDispatcher` gains one early-return gate: when `Token.getValue(USER_HOOKS_ENABLED) !== "true"`, return `EMPTY_AGGREGATE` before the existing no-hooks fast path.

### File layout (new + modified)

```
Entity layer (new)
  src/entity/HookConfig.ts
  src/entity/HookAuditEntry.ts

Model layer (new)
  src/model/Hook.model.ts
  src/model/HookAudit.model.ts

Module layer (new)
  src/modules/HookModule.ts
  src/modules/HookAuditModule.ts

Service layer (modified)
  src/service/hooks/HookRegistry.ts              +listAll, +registerUserHook, +replaceUserHooks
  src/service/hooks/HookCommandTrustService.ts   persist to/from DB via HookModule
  src/service/hooks/HookAuditService.ts          write through HookAuditModule
  src/service/hooks/HookDispatcher.ts            +global-enable Token gate
  src/config/usersetting.ts                      +USER_HOOKS_ENABLED constant

IPC layer (new)
  src/main-process/communication/hooks-ipc.ts

Preload + frontend API (new)
  src/preload.ts                                  +hooksApi namespace + channel whitelist
  src/views/api/hooks.ts

UI (new)
  src/views/pages/systemsetting/Hooks.vue
  src/views/router/index.ts                       +system_setting_hooks route
  src/views/pages/systemsetting/index.vue         +sidebar button "Manage Hooks"

i18n (modified, all 6 languages)
  src/views/lang/{en,zh,es,fr,de,ja}.ts           +system_settings.hooks.* keys

App init (modified)
  src/background.ts (or equivalent init path)     call HookModule.loadUserHooksIntoRegistry() after SqliteDb ready

TypeORM registration (modified)
  src/config/SqliteDb.ts or wherever entities are registered   +HookConfig, +HookAuditEntry
```

## Data Model

### `HookConfig` entity

Mirrors `CommandHookDefinition` from `hookTypes.ts` plus run-status and audit columns. Only `source = "user"` rows are created through the UI.

| Column | Type | Notes |
|---|---|---|
| `id` | string PK | Stable hook ID (UI ensures uniqueness, e.g. `user-block-shell`) |
| `eventName` | string | One of the 8 `HookEventName` values |
| `matcher` | string nullable | Glob/exact/`*`; bounded by `HOOK_LIMITS.maxMatcherChars` (128) |
| `hookType` | string | Always `"command"` for UI-created rows |
| `command` | string | Shell command |
| `cwd` | string nullable | Optional working directory |
| `timeoutMs` | integer | Default `HOOK_LIMITS.defaultCommandTimeoutMs` (5000); capped at `maxCommandTimeoutMs` (60000) |
| `failureMode` | string | `"warn"` or `"block"` |
| `statusMessage` | string nullable | Optional UI progress label |
| `envAllowlist` | text nullable | JSON-serialized array of env var names |
| `source` | string | `"user"` for rows created via UI |
| `enabled` | boolean | Default `false` — new hooks start disabled |
| `trusted` | boolean | Default `false` — explicit Trust action required before execution |
| `lastRunAt` | datetime nullable | Updated by `HookModule` whenever `HookAuditModule.recordEntry()` writes a row for this `hookId` |
| `lastRunStatus` | string nullable | Mirrors `HookAuditStatus` of the most recent audit row for this `hookId` |
| `createdAt` | datetime | TypeORM auto |
| `updatedAt` | datetime | TypeORM auto |

Indexes: `(source)`, `(eventName)`, `(enabled, trusted)`.

### `HookAuditEntry` entity

Mirrors the existing `HookAuditEntry` interface in `hookTypes.ts` lines 280-291.

| Column | Type |
|---|---|
| `id` | integer auto-increment PK |
| `hookRunId` | string, indexed |
| `hookId` | string, indexed |
| `eventName` | string |
| `source` | string |
| `type` | string (`"callback"` or `"command"`) |
| `matchQuery` | string nullable |
| `status` | string (`started`/`success`/`blocked`/`failed`/`timeout`) |
| `durationMs` | integer nullable |
| `reason` | text nullable |
| `timestamp` | datetime |

Indexes: `(timestamp DESC)`, `(hookId, timestamp DESC)`.

### Global enable

Stored in `Token` under key `USER_HOOKS_ENABLED = "USER_HOOKS_ENABLED"` (string value `"true"` or `"false"`), consistent with the existing `USER_AI_ENABLED` pattern. `HookDispatcher` reads this on the fast path.

### Builtin enabled override

Builtins are code-registered, so their `enabled` state needs a persistence slot too. Persist a JSON map in `Token` under key `USER_HOOKS_BUILTIN_OVERRIDES`: `{ [hookId: string]: { enabled: boolean } }`.

Timing: builtins register themselves with their code-defined default `enabled` state via `builtinHooks.ts` at app init. The startup loader (`HookModule.loadUserHooksIntoRegistry()`) runs *after* that and applies the override by mutating the already-registered entry's `enabled` flag in `HookRegistry`. The builtin code remains the single source of truth for *what* the hook does; the override only controls *whether* it runs.

### Registry extensions

`HookRegistry` currently exposes only `registerBuiltinHook`, `registerSessionHook`, `clearSessionHooks`, `getMatchingHooks`, `resetForTests`. Add:

```ts
registerUserHook(hook: HookDefinition): void;
replaceUserHooks(hooks: HookDefinition[]): void;
listAll(filter?: { eventName?: HookEventName; source?: HookSource; includeSession?: boolean }): HookDefinition[];
```

`replaceUserHooks` atomically swaps all user-source entries; used by the startup loader. `listAll` returns builtin + user (+ optionally session) entries, sorted by the existing source-priority ordering.

### Startup load + trust hydration

`HookModule.loadUserHooksIntoRegistry()` (called once after `SqliteDb` is ready):

1. Read all `HookConfig` rows.
2. For each row, construct a `CommandHookDefinition`.
3. Hydrate `HookCommandTrustService` cache: `hookId -> trusted` map from DB.
4. Call `HookRegistry.replaceUserHooks(...)` with enabled user hooks only.
5. Apply builtin overrides from `Token` to the registered builtins.

The order matters: builtin hooks are registered by `builtinHooks.ts` at app init; user hooks are added afterwards by this loader. Both happen before the first AI chat turn.

## IPC + API Surface

### IPC channels (new `src/main-process/communication/hooks-ipc.ts`)

All handlers return the standard `{ status: boolean, data: T | null, msg: string }` envelope. All handlers validate input and call Module methods; no direct DB access.

| Channel | Payload | Returns | Behavior |
|---|---|---|---|
| `hooks:list` | `{ source?: "builtin"\|"user"\|"all", includeSession?: boolean }` | `HookDefinition[]` | Calls `HookRegistry.listAll(filter)` |
| `hooks:create` | `NewHookInput` (all fields except id/timestamps/lastRun*) | `HookConfigRow` | Validates bounds; inserts via `HookModule.create()`; if `enabled`, registers in `HookRegistry` |
| `hooks:update` | `{ id: string, patch: Partial<HookConfigRow> }` | `HookConfigRow` | User hooks only; re-registers in `HookRegistry` if `enabled` or any field changed |
| `hooks:delete` | `{ id: string }` | `{ ok: true }` | User hooks only; rejects builtin/session ids; removes from registry + deletes row |
| `hooks:setEnabled` | `{ id: string, enabled: boolean }` | `{ id: string, enabled: boolean, source: HookSource }` | User hooks: update DB + registry. Builtin: persist override in `Token` + update in-memory registry entry. Returns the effective `enabled` state regardless of source |
| `hooks:setTrusted` | `{ id: string, trusted: boolean }` | `HookConfigRow` | User command hooks only; updates DB + `HookCommandTrustService` cache |
| `hooks:getGlobalEnable` | — | `boolean` | Reads `Token.getValue(USER_HOOKS_ENABLED)` |
| `hooks:setGlobalEnable` | `{ enabled: boolean }` | `boolean` | Writes `Token.setValue(USER_HOOKS_ENABLED, "true"\|"false")` |
| `hooks:listAudit` | `{ hookId?, eventName?, status?, limit?, offset?, fromTime?, toTime? }` | `{ rows: HookAuditEntry[], total: number }` | Calls `HookAuditModule.query()` |

`NewHookInput` shape:

```ts
interface NewHookInput {
  id: string;            // caller-supplied, uniqueness validated
  eventName: HookEventName;
  matcher?: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  failureMode?: "warn" | "block";
  statusMessage?: string;
  envAllowlist?: string[];
  enabled?: boolean;     // defaults to false on create
  trusted?: boolean;     // defaults to false on create; UI should not allow trust-on-create
}
```

### Preload exposure

Add a `hooksApi` sub-namespace to the existing `contextBridge.exposeInMainWorld("api", {...})` block in `src/preload.ts`. Whitelist all `hooks:*` channels for `ipcRenderer.invoke`.

### Frontend API (`src/views/api/hooks.ts`)

```ts
export interface HookListFilter {
  source?: "builtin" | "user" | "all";
  includeSession?: boolean;
}
export interface HookAuditFilter {
  hookId?: string;
  eventName?: HookEventName;
  status?: HookAuditStatus;
  limit?: number;
  offset?: number;
  fromTime?: string;
  toTime?: string;
}

export async function listHooks(filter?: HookListFilter): Promise<HookDefinition[]>;
export async function createHook(input: NewHookInput): Promise<HookConfigRow>;
export async function updateHook(id: string, patch: Partial<HookConfigRow>): Promise<HookConfigRow>;
export async function deleteHook(id: string): Promise<void>;
export async function setHookEnabled(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean; source: HookSource }>;
export async function setHookTrusted(id: string, trusted: boolean): Promise<HookConfigRow>;
export async function getHooksGlobalEnable(): Promise<boolean>;
export async function setHooksGlobalEnable(enabled: boolean): Promise<boolean>;
export async function listHookAudit(filter?: HookAuditFilter): Promise<{ rows: HookAuditEntry[]; total: number }>;
```

### Dispatcher gate

In `HookDispatcher.executeHooks()`, insert one check at the very top (before the no-hooks fast path):

```ts
if (Token.getValue(USER_HOOKS_ENABLED) !== "true") {
  return EMPTY_AGGREGATE;
}
```

## Page Layout & UX

Layout follows **Approach A: Master-Detail** (sign-off 2026-07-01). Single page, three regions stacked top-to-bottom:

```
┌─ System Setting  ›  Hooks ───────────────────────────┐
│ [✓] Enable hooks globally          [+ Add command]    │  <- header bar
│ Filter: Event[All▾] Source[All▾] [□ Show session]     │  <- list filters
│ ┌────────────────────┬──────────────────────────┐    │
│ │ Hooks (N)          │ Edit hook                │    │  <- master-detail
│ │ ────────────────── │ Event:    PreToolUse  ▾  │    │
│ │ ● block-shell  ✓   │ Matcher:  shell_execute  │    │
│ │ ● compliance   ✓   │ Type:     Command     ▾  │    │
│ │ ○ my-cmd      ⚠    │ Command:  node ./check.js│    │
│ │ ○ api-guard   ⏸    │ Timeout:  5000 ms       │    │
│ │                    │ Failure:  Block       ▾  │    │
│ │                    │ [Trust] [Save] [Delete]  │    │
│ └────────────────────┴──────────────────────────┘    │
│                                                       │
│ ─ Recent audit ─────────────────────────────────────  │  <- audit panel
│ Filters: Event[All] Status[All] Hook[All] Last[100]   │
│ Time     Hook         Event      Status   Duration     │
│ 09:42    block-shell  PreToolUse blocked  3ms          │
└───────────────────────────────────────────────────────┘
```

### Editability matrix (per source)

| Action | builtin | user | session |
|---|---|---|---|
| Show in list | default | default | only when "Show session" toggle on |
| Toggle `enabled` | yes (persisted via builtin override) | yes | read-only display only |
| Edit fields | read-only — code is source of truth | yes | no |
| Trust / untrust | always trusted (callback) or trust managed by code | command hooks only | no |
| Delete | no | yes | no |

### Add command hook flow

1. `[+ Add command hook]` switches the right panel to a "new hook" form with defaults: `eventName: PreToolUse`, `matcher: "*"`, `failureMode: "warn"`, `timeoutMs: 5000`, `enabled: false`, `trusted: false`.
2. Inline validation on blur: command non-empty; matcher ≤ 128 chars; timeout ≤ 60000; `envAllowlist` parses as JSON string array.
3. Save calls `hooks:create`. Row is persisted with `enabled: false, trusted: false` so nothing executes until the user explicitly opts in.
4. UI shows a ⚠ "Trust required" badge. Until `[Trust]` is clicked, the hook is registered but filtered out by `HookRegistry.getMatchingHooks()` (existing line 93 behavior — untrusted command hooks are excluded).

### Edit / save flow

- Selecting a row populates the right panel with current values; edits are local to the form until `[Save]`.
- On save: `hooks:update` → success toast `t('system_settings.hooks.toast.saved') || 'Hook saved'`; on failure, error toast and the form stays open with unsaved values.

### Trust flow

- `[Trust]` button only visible for `source=user, type=command, trusted=false`.
- Click → confirmation dialog: "Trusting a command hook means the local process `{command}` will run on every matching `{event}`. Are you sure?" → on confirm, `hooks:setTrusted({trusted:true})`.
- Once trusted, button becomes `[Untrust]` (no confirmation needed to untrust).

### Delete flow

- User hooks only. `[Delete]` → confirmation dialog with hook id + command preview → `hooks:delete`.
- Defense-in-depth: the IPC handler also rejects builtin/session ids with `{ status: false, msg: 'Built-in hooks cannot be deleted' }`.

### Global enable toggle

- Top-left switch. Reads `hooks:getGlobalEnable` on mount; on toggle, calls `hooks:setGlobalEnable`.
- When off, the page shows a yellow banner: "Hooks are globally disabled — no hook will fire." The rest of the page remains interactive so users can still configure hooks.

### Audit panel filtering

- Filters above the audit table: `Event [All▾]`, `Status [All▾]`, `Hook [All▾]`, `Last [100/500/All]`, optional date range.
- Defaults: All events, All statuses, All hooks, last 100 rows.
- Server-side pagination via `hooks:listAudit({ limit, offset, ... })`.

### Error states

- IPC failure: toast `t('system_settings.hooks.toast.load_failed') || 'Failed to load hooks'`; retry button.
- Invalid form fields: inline red error under each field; `[Save]` disabled until valid.
- Attempt to delete/modify builtin: prevent in UI (button hidden); IPC handler also rejects as defense-in-depth.

### Empty states

- No user hooks yet: left list shows only builtins; right panel shows a "Create your first command hook" callout with a button.
- No audit entries yet: audit table shows `t('system_settings.hooks.audit_empty') || 'No hook activity recorded yet'`.

## i18n

All keys live under `system_settings.hooks.*` in each of the six language files. English is the canonical fallback; Vue templates use `t('key') || 'English Text'`.

```
system_settings.hooks.*
  title, description
  global_enable, global_disable_banner
  add_command
  filter_event, filter_source, filter_status, filter_hook
  last_rows, show_session
  list_empty, create_first
  trust_required
  trust_confirm_title, trust_confirm_body
  delete_confirm_title, delete_confirm_body
  builtin_cannot_modify
  audit_title, audit_empty
  audit_time, audit_duration, audit_reason
  field.event, field.matcher, field.type, field.command, field.cwd
  field.timeout, field.failure_mode, field.status_message, field.env_allowlist
  field.enabled, field.trusted, field.source
  source.builtin, source.user, source.session
  status.started, status.success, status.blocked, status.failed, status.timeout
  button.save, button.delete, button.trust, button.untrust, button.cancel
  toast.saved, toast.deleted, toast.trust_updated, toast.load_failed, toast.create_failed
```

Event names (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `UserPromptSubmit`, `SessionStart`, `Stop`, `PermissionRequest`, `PermissionDenied`) stay as code identifiers in the dropdown — they are technical terms, like HTTP method names, and over-translating them harms searchability.

All six files (`en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`) are updated in the same commit. Accurate translations per language; consistent key structure across files.

## Testing Strategy

Project rule: 80%+ coverage minimum.

| Layer | Test file | Key cases |
|---|---|---|
| Model | `test/modules/Hook.model.test.ts` (Mocha) | CRUD; query by source/event; reject worker-process access via `process.env.WORKER_TYPE` guard |
| Module | `test/modules/HookModule.test.ts` (Mocha) | `create` validates matcher length, timeout bounds, id uniqueness; `delete` rejects builtin ids; `setEnabled` updates registry; `loadUserHooksIntoRegistry` registers + hydrates trust + applies builtin overrides |
| Audit model | `test/modules/HookAudit.model.test.ts` (Mocha) | Insert; paginated query; filter combinations (event/status/hookId/time range) |
| Audit module | `test/modules/HookAuditModule.test.ts` (Mocha) | Wraps model; bounded `limit` defaults; redacts `reason` length |
| Registry | `test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts` (Vitest) | `listAll` source/event/includeSession filtering; `registerUserHook` priority; `replaceUserHooks` atomic swap preserves builtin/session entries |
| Dispatcher | extend existing `HookDispatcher.test.ts` | Global-enable Token gate returns `EMPTY_AGGREGATE` when `USER_HOOKS_ENABLED !== "true"`; gate does not break no-hooks fast path when enabled |
| Trust service | `test/vitest/utilitycode/hooks/HookCommandTrustService.persist.test.ts` | Cache hydrated from DB on startup; `setTrusted` writes through to DB; in-memory fallback when DB unavailable |
| IPC | `test/vitest/main/hooks-ipc.test.ts` (Vitest) | Each channel routes to the correct Module method; builtin/session delete rejected with `{status:false}`; no direct repository access; input validation rejects malformed payloads |
| Startup integration | `test/vitest/main/hooks-startup.test.ts` | A persisted user hook fires on a fake tool call after `loadUserHooksIntoRegistry` runs; a disabled user hook does not fire; an untrusted command hook does not fire |
| StreamEventProcessor | extend existing tool-loop tests | PreToolUse user hook blocks tool; PostToolUse user hook adds context; PostToolUseFailure user hook adds user-visible message; trust=false user hook is skipped |

The TypeScript type-check gate (described in CLAUDE.md §Testing) applies to all Vitest configs.

## Security Considerations

This work inherits all PRD security requirements. Highlights specific to the UI/persistence layer:

1. **Command hooks remain disabled-by-default.** New rows are persisted with `enabled: false, trusted: false`; both flags must be explicitly set by the user.
2. **Trust flow has explicit confirmation** with the command preview shown in the dialog.
3. **Trust persistence does not weaken isolation.** `HookCommandTrustService` continues to gate at registration time and at execution time (defense-in-depth, existing line 93 in `HookRegistry.ts`).
4. **No secrets in audit entries.** `HookAuditService` already redacts via `HookOutputValidator` size limits; the new `HookAudit.model` stores the already-redacted string.
5. **Worker process guard.** `Hook.model.ts` and `HookAudit.model.ts` both check `process.env.WORKER_TYPE` and throw on direct access from a worker, matching the project-wide rule.
6. **IPC handlers sanitize input.** All channel payloads are validated before reaching Module methods; malformed payloads return `{ status: false, msg: '...' }` without side effects.
7. **Builtin definitions are never editable from the UI.** Only the `enabled` override is writable; the command/matcher/event fields are read-only for builtins.
8. **No new AI features**, so no `USER_AI_ENABLED` gating is needed anywhere in this layer.

## Acceptance Criteria

Mirrors PRD §"UI Acceptance" plus this spec's additions.

1. Users see when a hook blocked a tool (audit row + tool result message, already wired by Phase 2).
2. Users see when a hook requested permission (audit row).
3. Users can disable hooks globally via the System Settings toggle; the setting persists across restarts and the dispatcher honors it.
4. Users can disable individual configured hooks; the change persists and is reflected in `HookRegistry` immediately.
5. New UI text is translated in all six supported language files.
6. Users can add a new command hook via the UI; on save it is persisted and (once enabled + trusted) fires in subsequent tool loops.
7. Users can edit matcher/command/cwd/timeout/failureMode of user hooks; changes are persisted and re-registered in `HookRegistry`.
8. Users can delete user hooks; the row is removed from the DB and from `HookRegistry`.
9. Users can trust/untrust user command hooks; trust state persists across restarts and hydrates into `HookCommandTrustService` on startup.
10. Users can toggle builtin `enabled` state via the override; the change persists across restarts.
11. Audit panel shows recent entries with filters; the data comes from the persisted `HookAuditEntry` table.
12. The hooks page is reachable from the System Settings sidebar (alongside MCP and Skills).
13. When global enable is off, no hook fires anywhere in the app.
14. When a user hook is `trusted: false`, it does not fire, and the UI shows a clear "Trust required" badge.
15. Worker processes cannot access `Hook.model` / `HookAudit.model` directly (throws on `process.env.WORKER_TYPE`).
16. Test coverage for new files ≥ 80%.

## Open Questions

None. All design questions resolved during brainstorm sign-off on 2026-07-01.
