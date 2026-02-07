# Implementation Plan: AI-Powered Contact Information Extraction

**Branch**: `001-ai-contact-extraction` | **Date**: 2025-02-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-ai-contact-extraction/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Extract contact information (email, phone, address) from search result websites using Puppeteer running in a sub-process and remote AI server for intelligent content extraction. Users can select search results on the detail page and initiate batch extraction with real-time progress updates. The system automatically discovers contact pages, handles diverse website structures, and saves extracted data to a local SQLite database with proper status tracking.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**:
- Electron (desktop application framework)
- Vue 3 + Vuetify (frontend UI)
- Puppeteer + puppeteer-extra-plugin-stealth (browser automation)
- TypeORM + SQLite (database)
- Remote AI service (OpenAI/Anthropic API for content extraction)
- WebSocket (real-time progress updates via existing WebSocketClient)

**Storage**:
- SQLite with TypeORM for local persistence
- Independent `ContactInfo` entity with 1:1 relationship to `SearchResult`

**Testing**:
- Mocha (module tests in `test/modules/`)
- Vitest (main process, utility, and task code tests)
- Existing test patterns: `test/modules/*.test.ts`, `test/vitest/**/*.test.ts`

**Target Platform**: Electron desktop application (Windows, macOS, Linux)

**Project Type**: Electron app with Vue 3 frontend (renderer process) and TypeScript backend (main process)

**Performance Goals**:
- Extract contact info from 80% of websites on first attempt
- Complete extraction within 30 seconds per website
- Process up to 50 websites in a single batch
- 95% valid email accuracy rate
- Real-time progress updates within 5 seconds

**Constraints**:
- UI must remain responsive during background extraction
- Browser process isolation (separate worker process)
- Handle bot detection and CAPTCHAs gracefully
- Support multiple languages
- Automatic retry with exponential backoff (max 3 retries)

**Scale/Scope**:
- Add 1 new entity (ContactInfo)
- Add 1 new worker process (contact-extraction-worker)
- Add 3-5 new IPC channels
- Modify 1 existing Vue component (SearchDetailTable.vue)
- Add ~10-15 new TypeScript files
- Target batch size: 10-20 items per extraction

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Note**: No project-specific constitution exists yet. The constitution template is empty. Following general best practices:

✅ **TypeScript Strict Mode**: All code must use explicit types, no `any` types
✅ **Separation of Concerns**: Worker process isolation, independent entity, clear IPC boundaries
✅ **Testing First**: Unit tests for discovery logic, integration tests for extraction flow
✅ **Error Handling**: Graceful degradation, retry logic, user-friendly error messages
⚠️ **Complexity**: Multi-stage discovery pipeline, worker process management (justified by requirements)

**Complexity Justifications**:

| Complexity Aspect | Why Needed | Simpler Alternative Rejected Because |
|-------------------|------------|--------------------------------------|
| Worker process (child_process) | Puppeteer crashes shouldn't crash main app; existing pattern in codebase | Running in main process would destabilize entire Electron app |
| Multi-stage contact discovery | Websites have diverse structures (contact pages, footers, homepages) | Single-stage approach would fail on 60%+ of websites |
| Independent ContactInfo entity | Clean data normalization; easy to extend contact fields; easier re-extraction | Adding columns to SearchResult would violate 3NF and complicate re-extraction |
| Queue system with concurrency limits | Resource management; prevent browser pool exhaustion | Unconcurrent processing would be too slow; unlimited concurrency would crash system |
| WebSocket for progress updates | Real-time UX; matches existing WebSocket infrastructure | Polling would waste resources and provide worse UX |

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-contact-extraction/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── ipc-channels.yaml      # IPC channel definitions
│   └── api-spec.yaml          # API contract specification
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Electron + Vue application structure (existing pattern)
src/
├── main-process/
│   └── communication/
│       └── contactExtraction-ipc.ts        # NEW: IPC handlers for contact extraction
├── entity/
│   └── ContactInfo.entity.ts               # NEW: Contact information entity
├── entityTypes/
│   └── contactExtractionTypes.ts           # NEW: TypeScript type definitions
├── modules/
│   └── contact-extraction/
│       ├── ContactExtractionWorker.ts      # NEW: Worker process for extraction
│       ├── ContactDiscovery.ts             # NEW: Multi-stage contact page discovery
│       ├── ExtractionQueue.ts              # NEW: Queue management with concurrency
│       └── AIClient.ts                     # NEW: Remote AI service integration
├── model/
│   └── ContactInfo.model.ts                # NEW: Data access layer
├── views/
│   ├── api/
│   │   └── contactExtraction.ts            # NEW: Frontend API layer
│   └── pages/
│       └── search/
│           └── widgets/
│               └── SearchDetailTable.vue   # MODIFY: Add "Get Contact Info" button
└── migrations/
    └── CreateContactInfoTable.ts           # NEW: Database migration

tests/
├── modules/
│   └── contact-extraction/
│       ├── ContactDiscovery.test.ts        # NEW: Unit tests for discovery logic
│       └── AIClient.test.ts                # NEW: Unit tests for AI service integration
└── vitest/
    └── main/
        └── contactExtraction-ipc.test.ts    # NEW: IPC handler tests
```

**Structure Decision**: Single Electron application (existing pattern). The feature integrates into the existing Vue frontend and TypeScript backend with established patterns for:
- IPC communication via `src/main-process/communication/`
- Entity definitions via `src/entity/` with TypeORM
- Worker processes for background tasks
- Vue components in `src/views/pages/` with Vuetify UI
- API layer separation in `src/views/api/`
- Testing in both `test/modules/` (Mocha) and `test/vitest/` (Vitest)

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Worker process isolation | Puppeteer crashes shouldn't crash main Electron app; enables independent resource management | Direct main process execution would risk app stability; existing codebase uses this pattern |
| Multi-stage discovery (4 stages) | Websites have highly variable contact info placement (homepage vs /contact vs footer vs AI) | Single-stage approach would fail on majority of websites; heuristic + AI combination provides robustness |
| Queue with concurrency control | Browser instances are resource-intensive; need to limit to 3-5 concurrent browsers | Sequential extraction too slow for batches; unlimited concurrency would crash system via memory exhaustion |
| Independent ContactInfo table | Data normalization (3NF); easy to extend contact fields; clean re-extraction workflow | Adding columns to SearchResult violates normalization; re-extraction becomes messy with NULL handling |
| Real-time progress via WebSocket | Users need immediate feedback on batch operations; existing WebSocket infrastructure | Polling wastes resources and provides poor UX; matches existing real-time update pattern |

**Total Complexity Justifications**: 5 (All justified by functional requirements and existing patterns)

---

## Phase 0: Research & Technical Decisions

### Research Questions

1. **Remote AI Service Integration**
   - Question: What AI service and API pattern should be used for contact extraction?
   - Context: Spec mentions "remote AI server" but doesn't specify which service
   - Decision: OpenAI GPT-4o-mini (cost-effective, fast, structured output via JSON mode)
   - Rationale: Already configured in codebase; supports JSON mode; 128k context; 10x cheaper than GPT-4
   - Alternatives considered: Anthropic Claude (more expensive), local models (less accurate), regex-only (insufficient for complex pages)

2. **Contact Discovery Strategy**
   - Question: How to reliably find contact pages across diverse website structures?
   - Context: Websites use varied URLs (/contact, /about, /support, etc.) and placement (nav, footer)
   - Decision: Multi-stage pipeline: (1) Direct scan → (2) Heuristic link scoring → (3) Fallback routes → (4) AI extraction
   - Rationale: Progressive complexity ensures fast-path for simple sites while handling edge cases
   - Alternatives considered: AI-only (too slow/expensive), regex-only (40% failure rate), sitemap.xml (often missing)

3. **Browser Process Management**
   - Question: How to manage Puppeteer instances for batch extraction without resource exhaustion?
   - Context: Spec requires processing up to 50 items concurrently with responsive UI
   - Decision: Worker process + browser pool (max 3 instances) + job queue with exponential backoff retry
   - Rationale: Worker isolation protects main app; pool limits memory; queue ensures fairness
   - Alternatives considered: One browser per URL (memory exhaustion), sequential processing (too slow), unlimited concurrency (crashes)

4. **Database Schema Design**
   - Question: Should contact info be added to SearchResult table or separate table?
   - Context: SearchResult has 7 existing fields; contact extraction adds 5+ new fields
   - Decision: Independent ContactInfo entity with 1:1 relationship
   - Rationale: Data normalization (3NF); clean re-extraction workflow; easier to extend; follows TypeORM best practices
   - Alternatives considered: Add columns to SearchResult (violates normalization), JSON column (breaks queryability)

5. **Real-Time Progress Communication**
   - Question: How to provide live progress updates from worker to frontend?
   - Context: Spec requires "real-time progress updates" within 5 seconds
   - Decision: WebSocket via existing WebSocketClient module with IPC bridge
   - Rationale: Existing infrastructure; bidirectional; low latency; matches existing patterns
   - Alternatives considered: Polling (wasteful), IPC only (can't cross process boundary easily), file-based events (slow)

### Research Artifacts

See [`research.md`](./research.md) for detailed research findings including:
- AI service API design and prompt engineering
- Contact discovery algorithm specifications
- Worker process IPC patterns
- Error handling strategies for bot detection, CAPTCHAs, and failures
- Performance optimization techniques

---

## Phase 1: Design & Contracts

### Data Model

See [`data-model.md`](./data-model.md) for entity definitions including:
- **ContactInfo** entity: Fields, relationships, validation rules, state transitions
- **SearchResult** modifications: Relationship to ContactInfo
- Migration script: SQL schema changes
- Repository pattern: TypeORM repository methods

### API Contracts

See [`contracts/`](./contracts/) for:
- **ipc-channels.yaml**: IPC channel definitions for contact extraction
  - `start-contact-extraction`: Invoke handler (renderer → main)
  - `contact-extraction-progress`: Event (worker → main → renderer)
  - `get-contact-info`: Query handler
  - `retry-contact-extraction`: Invoke handler
- **api-spec.yaml**: OpenAPI-style specification for internal APIs

### Quick Start Guide

See [`quickstart.md`](./quickstart.md) for:
- Development environment setup
- Local testing instructions
- Common workflows (single extraction, batch extraction, retry failures)
- Troubleshooting guide

---

## Next Steps

1. ✅ **Phase 0**: Generate `research.md` with all technical decisions - COMPLETE
2. ✅ **Phase 1**: Generate design artifacts (`data-model.md`, `contracts/`, `quickstart.md`) - COMPLETE
3. ✅ **Phase 1**: Update agent context via `.specify/scripts/bash/update-agent-context.sh` - COMPLETE
4. ✅ **Re-check Constitution**: All complexity justified by requirements - PASSED
5. **Phase 2**: Use `/speckit.tasks` to generate actionable task breakdown - NEXT STEP

---

## Implementation Checklist

### Phase 0: Research ✅
- [x] Remote AI service integration design (OpenAI GPT-4o-mini)
- [x] Contact page discovery strategy (4-stage pipeline)
- [x] Browser process management (worker + pool + queue)
- [x] Database schema design (independent ContactInfo entity)
- [x] Real-time progress communication (WebSocket + IPC)
- [x] Error handling strategies (5 edge cases covered)
- [x] Performance optimization techniques
- [x] Testing strategy (unit, integration, E2E)

### Phase 1: Design ✅
- [x] Data model complete with entity definitions
- [x] IPC channel contracts defined (4 channels)
- [x] API specification documented
- [x] Quick start guide written
- [x] Agent context updated (TypeScript 5.x added)

### Phase 2: Implementation (Pending - Use /speckit.tasks)

**Key Files to Create**:
- `src/entity/ContactInfo.entity.ts` - Database entity
- `src/migrations/CreateContactInfoTable.ts` - Migration script
- `src/modules/contact-extraction/ContactExtractionWorker.ts` - Worker process
- `src/modules/contact-extraction/ContactDiscovery.ts` - Discovery logic
- `src/modules/contact-extraction/ExtractionQueue.ts` - Queue management
- `src/modules/contact-extraction/BrowserPool.ts` - Browser pool
- `src/modules/contact-extraction/AIClient.ts` - AI service client
- `src/main-process/communication/contactExtraction-ipc.ts` - IPC handlers
- `src/views/api/contactExtraction.ts` - Frontend API layer
- `src/model/ContactInfo.model.ts` - Data access layer
- `src/entityTypes/contactExtractionTypes.ts` - TypeScript types
- `src/views/pages/search/widgets/SearchDetailTable.vue` - UI modifications

**Tests to Create**:
- `test/modules/contact-extraction/ContactDiscovery.test.ts`
- `test/modules/contact-extraction/AIClient.test.ts`
- `test/vitest/main/contactExtraction-ipc.test.ts`

---

**Status**: Phase 1 (Planning) COMPLETE | **Next**: Phase 2 (Tasks) | **Last Updated**: 2025-02-06
