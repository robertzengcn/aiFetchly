# Implementation Plan: AI-Assisted Email Template Creation

**Branch**: `001-ai-email-template` | **Date**: 2025-02-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-ai-email-template/spec.md`
**Tech Stack**: Based on [doc/ai-email-template-tech-stack-architecture.md](../../doc/ai-email-template-tech-stack-architecture.md)

## Summary

Implement AI-powered email template generation that allows marketing users to create professional email templates from scratch using natural language prompts. The system will:

1. Generate complete email templates (subject + body) from user descriptions
2. Support streaming real-time output for immediate feedback
3. Integrate with RAG knowledge base for contextual brand awareness
4. Auto-detect refinement mode for existing templates
5. Validate and use only approved template variables
6. Enforce AI feature access control based on user subscription

**Technical Approach**: Follow existing aiFetchly patterns - main process IPC handlers, local RAG via RagSearchModule, remote AI via AiChatApi, streaming UI via SSE. Phase 1 uses Option B (reuse chat stream) for zero backend changes, with Phase 2 migration path to dedicated endpoint.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**:
  - Electron (desktop app framework)
  - Vue 3 + Composition API (frontend)
  - Vuetify 3 (UI components)
  - TypeORM + SQLite (database)
  - sqlite-vec (vector operations)
  - Pinia (state management)
  - vue-i18n (internationalization - 6 languages)

**Storage**: SQLite with TypeORM (local), Remote AI server (HTTP/SSE)
**Testing**: Mocha (modules), Vitest (main process, utility code), Playwright (E2E)
**Target Platform**: Desktop (Electron - macOS, Windows, Linux)
**Project Type**: Electron desktop application
**Performance Goals**:
  - Template generation complete in under 30 seconds
  - Streaming response latency < 500ms to first character
  - 95% generation success rate
  - Support 10+ concurrent RAG searches

**Constraints**:
  - Must check USER_AI_ENABLED before any AI operations
  - IPC handlers must NOT access database directly (use Model/Module pattern)
  - Worker processes must NOT access database (main process only)
  - All UI text must support 6 languages (en, zh, es, fr, de, ja)
  - Variable replacement must use {$varname} format

**Scale/Scope**:
  - 5 user stories (P1-P3 priority)
  - 25 functional requirements
  - 9 template variables to support
  - 3 IPC channels + handlers
  - 1 new Vue component + modifications to existing template detail page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Based on CLAUDE.md project principles:

### ✅ Database Access Architecture (MANDATORY)
- **Requirement**: All database logic MUST be in Model/Module classes, NEVER in IPC handlers
- **Plan Compliance**: ✅ Will use EmailMarketingModule for data access, IPC handler only validates and calls module methods
- **Files**: New `EmailMarketingModule.ts` (if needed) or extend existing, update `templatedetail.vue`

### ✅ Worker Process Architecture (MANDATORY)
- **Requirement**: Worker processes MUST NEVER access database directly
- **Plan Compliance**: ✅ No worker processes used for this feature; all logic in main process IPC handler

### ✅ AI Feature IPC Handler Rule (MANDATORY)
- **Requirement**: Check USER_AI_ENABLED FIRST before any AI operations
- **Plan Compliance**: ✅ New IPC handler will check Token service at entry point, return error if disabled

### ✅ Child/Worker Process Placement (MANDATORY)
- **Requirement**: All child/worker process code MUST be in `src/childprocess/`
- **Plan Compliance**: ✅ N/A - no worker processes for this feature

### ✅ Internationalization (MANDATORY)
- **Requirement**: All user-facing text MUST be updated in all 6 language files
- **Plan Compliance**: ✅ Will add translation keys to en.ts, zh.ts, es.ts, fr.ts, de.ts, ja.ts

### ✅ TypeScript Standards
- **Requirement**: NEVER use `any` type, explicit return types required
- **Plan Compliance**: ✅ All new code will use proper types, no `any` allowed

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-email-template/
├── spec.md              # Feature specification (COMPLETE)
├── plan.md              # This file
├── research.md          # Phase 0: Technical research & decisions
├── data-model.md        # Phase 1: Entity definitions & relationships
├── quickstart.md        # Phase 1: Developer setup guide
├── contracts/           # Phase 1: API contracts (IPC, types)
│   ├── ipc-channels.ts  # IPC channel definitions
│   ├── emailmarketing-types.ts  # TypeScript types
│   └── ai-template-types.ts     # AI request/response types
└── tasks.md             # Phase 2: Implementation tasks (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── config/
│   └── channellist.ts                 # ADD: AI_EMAIL_TEMPLATE_* channels
├── entityTypes/
│   └── emailmarketingType.ts         # ADD: AIEmailTemplateRequest, AIEmailTemplateResponse
├── main-process/communication/
│   └── ai-email-template-ipc.ts      # NEW: IPC handler for AI template generation
├── api/
│   └── aiChatApi.ts                  # EXTEND: Add streamMessage method if needed
├── modules/
│   └── RagSearchModule.ts            # EXISTING: Use for RAG searches
├── views/
│   ├── api/
│   │   └── emailmarketing.ts         # ADD: generateAIEmailTemplate() function
│   ├── pages/emailmarketing/template/
│   │   └── templatedetail.vue        # MODIFY: Add AI generation UI panel
│   └── lang/
│       ├── en.ts                     # ADD: AI template translation keys
│       ├── zh.ts                     # ADD: Chinese translations
│       ├── es.ts                     # ADD: Spanish translations
│       ├── fr.ts                     # ADD: French translations
│       ├── de.ts                     # ADD: German translations
│       └── ja.ts                     # ADD: Japanese translations
└── views/utils/
    └── emailFun.ts                   # MODIFY: Add new variable replacements

tests/
├── vitest/main/
│   └── ai-email-template-ipc.test.ts  # NEW: IPC handler tests
├── modules/
│   └── emailmarketing.test.ts         # EXTEND: Add AI generation tests
└── e2e/
    └── ai-template-generation.spec.ts # NEW: Playwright E2E tests
```

**Structure Decision**: This is an Electron desktop application with a clear three-layer architecture (renderer/main/database). The feature spans all three layers but maintains strict separation: UI in renderer, business logic in main process modules, data access via models. No new worker processes needed.

## Complexity Tracking

> **No constitution violations - this section not required**

The implementation follows all mandatory project patterns:
- Database access via Module/Model only
- AI enable check in IPC handler
- No worker process database access
- Full internationalization support
- Proper TypeScript typing

## Implementation Phases

### Phase 0: Research & Technical Decisions

**Objective**: Resolve all technical unknowns and document architecture decisions

**Deliverables**: `research.md` with:
1. AI endpoint decision (Option A vs B) - with Phase 1/Phase 2 roadmap
2. RAG integration pattern details
3. Variable validation strategy
4. Streaming implementation approach
5. Error handling patterns
6. Testing strategy for streaming AI responses

**Research Tasks**:
- Document existing AI chat patterns in `ai-chat-ipc.ts`
- Analyze `RagSearchModule` API for email template use cases
- Review existing variable system in `emailFun.ts` and `convertVariableInTemplate`
- Research streaming UI patterns in Vuetify 3
- Document existing AI enable check patterns in other IPC handlers
- Identify test patterns for streaming responses

### Phase 1: Design & Contracts

**Objective**: Complete data model, API contracts, and implementation guide

**Deliverables**:
1. `data-model.md` - Entity definitions, field types, relationships
2. `contracts/` directory with type definitions and IPC channel specs
3. `quickstart.md` - Developer setup and running guide
4. Update agent context with new technologies

**Design Tasks**:
- Define `AIEmailTemplateRequest` and `AIEmailTemplateResponse` types
- Define template variable constant `EMAIL_TEMPLATE_VARIABLES`
- Design IPC message contracts (request/response/chunk)
- Design Vue component props and events
- Plan RAG query construction for email context
- Design streaming response parsing logic

### Phase 2: Task Generation

**Objective**: Break down implementation into actionable, dependency-ordered tasks

**Deliverable**: `tasks.md` generated by `/speckit.tasks` command

**Task Categories**:
1. Infrastructure setup (channels, types, constants)
2. Backend implementation (IPC handler, AI integration)
3. Frontend implementation (Vue component, API layer)
4. Variable system enhancement (new variables, validation)
5. Internationalization (all 6 languages)
6. Testing (unit, integration, E2E)
7. Documentation (API docs, user guide)

## Dependencies

### External Dependencies
- Remote AI server must be accessible (via `VITE_REMOTEADD`)
- RAG embeddings API must be operational

### Internal Dependencies
- `RagSearchModule` must be functional
- `AiChatApi` must have streaming methods
- `Token` service must provide USER_AI_ENABLED check
- Existing email template entities must be accessible via modules

### Blocking Issues
None identified - all dependencies are existing infrastructure.

## Risk Mitigation

| Risk | Mitigation Strategy |
|------|---------------------|
| AI service unavailable during generation | Graceful degradation with clear error messaging; retry mechanism; offer manual template creation |
| RAG returns irrelevant documents | Fallback to generation without RAG; user can disable RAG toggle |
| Invalid variable names in AI output | Post-process validation; strip or replace invalid `{$...}` patterns |
| Streaming connection drops mid-generation | Preserve partial content; offer retry option; don't lose user's prompt |
| User expects different UX than clarification specified | Document UX decisions in quickstart.md; reference clarifications in spec |
| Internationalization delays release | Start i18n work early; use English as fallback during development |
| Variable replacement breaks existing templates | Extensive testing of variable system; backward compatibility check |

## Success Criteria

From spec.md, the following measurable outcomes define success:

- **SC-001**: Users can generate complete email template in under 30 seconds
- **SC-002**: 90% of AI-generated templates contain only valid template variables
- **SC-003**: 80% of users rate templates as "ready to use" or "minor edits only"
- **SC-004**: RAG-enabled templates show 25% higher brand terminology usage
- **SC-005**: 95% of generation attempts complete without timeouts/errors
- **SC-006**: 100% enforcement of AI feature access control
- **SC-007**: 60% reduction in template creation time vs manual
- **SC-008**: 100% accuracy in extended variable population during sending

## Next Steps

1. ✅ Specification complete (`spec.md`)
2. ✅ Clarifications complete (5 UX decisions resolved)
3. ⏳ **Phase 0**: Generate `research.md` - technical research and architecture decisions
4. ⏳ **Phase 1**: Generate design artifacts - `data-model.md`, `contracts/`, `quickstart.md`
5. ⏳ **Phase 2**: Generate `tasks.md` via `/speckit.tasks` command

---

**Ready to proceed with Phase 0: Research & Technical Decisions**
