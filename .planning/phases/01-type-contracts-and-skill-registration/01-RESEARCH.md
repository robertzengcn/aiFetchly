# Phase 1 Research: Type Contracts and Skill Registration

**Phase:** 1 - Type Contracts and Skill Registration
**Date:** 2026-05-23

## RESEARCH COMPLETE

### Key Findings

#### 1. SkillDefinition Interface (src/entityTypes/skillTypes.ts:70)

The `SkillDefinition` interface requires these fields:
- `name`: kebab-case identifier (string)
- `description`: human-readable for the LLM
- `parameters`: JSON Schema object
- `tier`: `"main"` for main process skills
- `requiresConfirmation`: boolean (false for automation category)
- `permissionCategory`: `"automation"` for Google Maps scraping
- `execute`: async function `(args, context) => Promise<SkillExecutionResult>`
- `source`: `"built-in"`

All built-in skills in `BUILT_IN_SKILLS` array follow the pattern:
```typescript
execute: async (args, context) => {
  const result = await ToolExecutor.execute("tool_name", args, context.conversationId);
  return { success: true, result };
}
```

#### 2. BUILT_IN_SKILLS Registration Pattern (src/config/skillsRegistry.ts)

All built-in skills are registered in the `BUILT_IN_SKILLS` constant array. Each skill definition is a complete `SkillDefinition` object with:
- Full JSON Schema for parameters (type: "object", properties, required)
- Default values in the schema
- Direct delegation to `ToolExecutor.execute()`

The execute function always wraps ToolExecutor results in `{ success: true, result }`.

#### 3. ToolExecutor Dispatch Pattern (src/service/ToolExecutor.ts:102)

`ToolExecutor.executeInternal()` uses a switch statement. Each case:
- Extracts typed parameters from `toolParams` (using `typeof` checks)
- Validates required parameters (throws Error if missing)
- Creates the appropriate module instance
- Calls the module method
- Returns `{ success: true, ...data }` or `{ success: false, error: "..." }`

Example from `search_yellow_pages`:
```typescript
case "search_yellow_pages":
  return await this.executeYellowPagesSearch(toolParams);
```

The method then:
1. Creates a controller instance
2. Validates input
3. Creates and starts a task
4. Polls for completion
5. Returns formatted results

#### 4. Entity Types Naming Convention (src/entityTypes/)

Existing files follow patterns like:
- `scrapeType.ts` ( scraping types)
- `emailextraction-type.ts` (hyphenated)
- `social_platform-type.ts` (underscore + hyphen)
- `task-type.ts`, `campaign-type.ts`

For Google Maps, `googleMapsTypes.ts` follows the camelCase convention established in the PRD.

#### 5. Rate Limiting

`RateLimiterManager.getLimiter(toolName)` provides per-tool rate limiting. The `execute()` method wraps all calls with `acquire()` / `release()`. No special configuration needed for Phase 1.

### Implementation Decisions

1. **New file `src/entityTypes/googleMapsTypes.ts`**: Export all types (input, output, progress, error). Follow existing convention of exporting interfaces and type aliases.

2. **Add to `BUILT_IN_SKILLS` array**: Insert the `search_google_maps_businesses` definition following the exact same pattern as `search_yellow_pages` — it's the closest analog.

3. **Add case in ToolExecutor switch**: Add `case "search_google_maps_businesses":` in `executeInternal()`. Phase 1 returns a stub that throws "Google Maps scraping not yet implemented" since the module won't exist until Phase 2.

4. **Permission category**: `"automation"` — same as `extract_emails_from_urls` and email marketing tools. No new category needed.

### Dependencies

- No new npm packages needed
- No schema changes (Phase 1 is purely code addition)
- No forge.config.js changes needed (worker is Phase 2)

### Risks

- Low risk: Phase 1 is purely additive. All changes are new code or additions to existing arrays/switches.
- The stub in ToolExecutor will need to be replaced in Phase 2 when GoogleMapsModule is implemented.
