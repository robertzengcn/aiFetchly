# Quickstart: AI Skills System Implementation

**Feature**: 001-skill-system | **Branch**: 001-skill-system

## Prerequisites

- Node.js and Yarn installed
- Working aiFetchly development environment
- Understanding of the existing AI chat streaming flow

## Key Files to Understand First

| File | Why |
|------|-----|
| src/api/aiChatApi.ts | Contains ToolFunction, ToolExecutionResult, streamMessage(), streamContinueWithToolResults() |
| src/service/ToolExecutor.ts | Current tool execution with rate limiting - will be wrapped |
| src/service/StreamEventProcessor.ts | Handles tool_call events - will be extended |
| src/config/aiTools.config.ts | Current static tool definitions - will be migrated |
| src/main-process/communication/ai-chat-ipc.ts | IPC handler for AI chat - where skill execution starts |

## Implementation Phases

### Phase 1: Core Loop (Start Here)

1. Create src/config/skillsRegistry.ts - static TypeScript registry
2. Create src/service/SkillExecutor.ts - validates, dispatches, returns results
3. Modify src/service/StreamEventProcessor.ts - integrate SkillExecutor in tool_call handler
4. Migrate 2-3 tools from aiTools.config.ts to registry as proof of concept
5. End-to-end test: AI calls a tool and receives the result

### Phase 2: Permissions

1. Create src/service/SkillPermissionService.ts
2. Add permission categories to all registry entries
3. Add confirmation prompts for high-risk skills
4. Inline chat approval card component

### Phase 3: Import and Management

1. Create installed_skills SQLite entity and model
2. Create src/service/SkillImportService.ts
3. Create src/main-process/communication/skills-ipc.ts
4. Create src/views/pages/systemsetting/skills.vue
5. Hot registration for imported skills

## Running Tests

- Module tests (Mocha): yarn test
- Main process tests (Vitest): yarn testmain
- Type checking: yarn tsc

## Key Patterns

- Registry lookup: SkillRegistry.getSkill(name) before execution
- Permission check: SkillExecutor.checkPermission(name) for non-pure skills
- Tier dispatch: Check skill.tier then route to renderer (direct) / main (IPC) / sandboxed (isolated-vm)
- Result flow: SkillExecutor.execute() then ToolExecutionResult then streamContinueWithToolResults()
