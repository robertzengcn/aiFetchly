# API Contracts: AI Skills System

**Date**: 2026-04-03 | **Feature**: 001-skill-system

## SkillRegistry API

### getAllToolFunctions()

Returns the LLM-facing tool definitions for all registered and enabled skills.

```
Input:  (none)
Output: ToolFunction[]

ToolFunction {
  type: 'function'
  name: string              // e.g., 'google_search'
  description: string
  parameters: {             // JSON Schema object
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}
```

### getSkill(name: string)

Looks up a skill by name. Returns null if not found or disabled.

```
Input:  name: string
Output: SkillDefinition | null
```

### isRegistered(name: string)

Checks if a skill name exists in the registry (regardless of enabled status).

```
Input:  name: string
Output: boolean
```

### registerSkill(skill: SkillDefinition)

Adds a skill to the registry at runtime (used for imported skills).

```
Input:  skill: SkillDefinition
Output: void
Throws: Error if name already registered
```

### unregisterSkill(name: string)

Removes a skill from the registry at runtime (used for uninstall).

```
Input:  name: string
Output: void
```

## SkillExecutor API

### execute(name, args, context)

Validates, permission-checks, and dispatches skill execution.

```
Input:
  name: string
  args: Record<string, unknown>
  context: SkillExecutionContext {
    conversationId: string
    toolCallId: string
  }

Output: Promise<ToolExecutionResult> {
  tool_call_id: string
  tool_name: string
  success: boolean
  result: string        // JSON stringified result data
  execution_time_ms: number
  error?: string
}
```

### checkPermission(name: string)

Checks if the user has already granted permission for a skill.

```
Input:  name: string
Output: Promise<'granted' | 'denied' | 'unknown'>
```

## IPC Channels

### EXECUTE_SKILL

Executes a main-process tier skill.

```
Direction: Renderer → Main → Renderer
Channel: 'EXECUTE_SKILL'

Request: {
  skillName: string
  args: Record<string, unknown>
  toolCallId: string
}

Response: ToolExecutionResult
```

### IMPORT_SKILL

Imports a skill package from a zip file.

```
Direction: Renderer → Main
Channel: 'IMPORT_SKILL'

Request: {
  zipPath: string
}

Response: {
  success: boolean
  name?: string
  error?: string
}
```

### LIST_INSTALLED_SKILLS

Lists all installed skills from the database.

```
Direction: Renderer → Main → Renderer
Channel: 'LIST_INSTALLED_SKILLS'

Request: (none)
Response: InstalledSkill[]
```

### TOGGLE_SKILL

Enables or disables an installed skill.

```
Direction: Renderer → Main
Channel: 'TOGGLE_SKILL'

Request: {
  name: string
  enabled: boolean
}

Response: {
  success: boolean
  error?: string
}
```

### UNINSTALL_SKILL

Removes an installed skill and its files.

```
Direction: Renderer → Main
Channel: 'UNINSTALL_SKILL'

Request: {
  name: string
}

Response: {
  success: boolean
  error?: string
}
```

### CHECK_SKILL_PERMISSION

Checks or requests permission for a skill execution.

```
Direction: Renderer → Main → Renderer
Channel: 'CHECK_SKILL_PERMISSION'

Request: {
  skillName: string
  category: 'network' | 'filesystem' | 'automation'
  domain?: string       // for network category
}

Response: {
  granted: boolean
  persistent: boolean
}
```

## StreamEventProcessor Integration

### Modified handleToolCallEvent()

Existing method extended to use SkillExecutor.

```
Flow:
1. Parse tool_call event → { toolName, toolCallId, toolParams }
2. Look up skill in registry
3. If not found → return error ToolExecutionResult
4. Check permission via SkillExecutor
5. Execute skill via SkillExecutor.execute()
6. Call streamContinueWithToolResults() with result
```
