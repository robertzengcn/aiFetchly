# Data Model: AI Skills System

**Date**: 2026-04-03 | **Feature**: 001-skill-system

## Entities

### SkillDefinition (Runtime — Static Registry)

In-memory representation of a registered skill. Lives in `skillsRegistry.ts`.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Unique kebab-case identifier (e.g., `google_search`) |
| description | string | Human-readable description shown to the LLM |
| parameters | Record<string, unknown> | JSON Schema for input validation |
| tier | 'renderer' \| 'main' \| 'sandboxed' | Where the skill executes |
| requiresConfirmation | boolean | Whether user consent is needed before execution |
| permissionCategory | 'pure' \| 'network' \| 'filesystem' \| 'automation' | Permission classification |
| execute | (args: Record<string, unknown>) => Promise<ToolExecutionResult> | The function that runs the skill |
| source | 'built-in' \| 'user' \| 'marketplace' | Origin of the skill |

**Relationships**: Each SkillDefinition maps 1:1 to a `ToolFunction` (the LLM-facing subset: name, description, parameters).

### SkillManifest (Import — JSON File)

JSON structure within a skill package zip.

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| name | string | Yes | Unique kebab-case, not shadowing built-in names |
| version | string | Yes | Valid semver (e.g., `1.0.0`) |
| description | string | Yes | Non-empty, max 500 characters |
| author | string | No | Max 100 characters |
| runtime | string | Yes | Must be `javascript` (Python deferred) |
| entry | string | Yes | Relative path within the zip to the entry JS file |
| parameters | object | Yes | Valid JSON Schema with `type: "object"` |
| permissions | string[] | No | Array from: `network`, `filesystem`, `automation` |

### InstalledSkill (Persistence — SQLite)

| Column | SQLite Type | Constraints | Description |
|--------|------------|-------------|-------------|
| id | INTEGER | PK AUTOINCREMENT | Row identifier |
| name | TEXT | UNIQUE NOT NULL | Skill identifier |
| version | TEXT | NOT NULL | Semver version string |
| source | TEXT | NOT NULL | `built-in` / `user` / `marketplace` |
| manifest_json | TEXT | NOT NULL | Full manifest JSON for hot registration |
| permissions_json | TEXT | NOT NULL DEFAULT '[]' | Granted permissions JSON array |
| enabled | INTEGER | NOT NULL DEFAULT 1 | 0 = disabled, 1 = enabled |
| installed_at | TEXT | NOT NULL | ISO 8601 timestamp |
| updated_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Relationships**: `name` links back to `SkillDefinition.name` at runtime.

### PermissionGrant (Persistence — Token Service)

Stored as key-value pairs via the existing `Token` service pattern.

| Key Pattern | Value | Description |
|-------------|-------|-------------|
| `SKILL_PERMISSION_<skillName>` | `'granted'` \| `'denied'` | Global permission for a skill |
| `SKILL_NETWORK_DOMAIN_<skillName>_<domain>` | `'always'` \| `'once'` | Per-domain network permission |
| `SKILL_DEV_MODE` | `'true'` \| `'false'` | Developer mode toggle |

## State Transitions

### Skill Lifecycle

```
[Not Installed] → import → [Installed (enabled)]
[Installed (enabled)] → disable → [Installed (disabled)]
[Installed (disabled)] → enable → [Installed (enabled)]
[Installed] → uninstall → [Not Installed]
[Installed] → update (re-import same name) → [Installed (updated)]
```

### Permission Flow

```
[Unknown] → first execution → check category:
  pure → [Auto-Allowed]
  network → prompt per domain → [Allowed Once] / [Always Allowed] / [Denied]
  filesystem → prompt → [Allowed] / [Denied]
  automation → prompt → [Allowed] / [Denied]
```

### Tool-Call Execution Flow

```
[tool_call event received]
  → validate tool name in registry → (invalid → return error result)
  → check skill enabled → (disabled → return error result)
  → check permission category:
      pure → execute immediately
      other → check stored permission:
          granted → execute
          denied → return denied result
          unknown → prompt user → (grant → execute + store, deny → return denied result)
  → execute at tier (renderer/main/sandboxed)
  → return ToolExecutionResult
  → streamContinueWithToolResults()
```
