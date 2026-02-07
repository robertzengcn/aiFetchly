# Tasks: AI-Powered Contact Information Extraction

**Input**: Design documents from `/specs/001-ai-contact-extraction/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: This feature specification does NOT include TDD requirements. Tests will be created after implementation following existing project patterns.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `test/` at repository root
- This is an Electron + Vue application with TypeScript backend (main process) and Vue frontend (renderer process)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for contact extraction feature

完成 T001 Create directory structure `src/modules/contact-extraction/` for extraction logic
完成 T002 [P] Add TypeScript type definitions in `src/entityTypes/contactExtractionTypes.ts`
完成 T003 [P] Add IPC channel constants to `src/config/channellist.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create ContactInfo entity in `src/entity/ContactInfo.entity.ts` with all fields and relationships
- [ ] T005 Add OneToOne relationship to ContactInfo in `src/entity/SearchResult.entity.ts`
- [ ] T006 Create database migration in `src/migrations/CreateContactInfoTable.ts`
- [ ] T007 Run migration to create `contact_info` table using `yarn init`
- [ ] T008 Create ContactInfoRepository in `src/model/ContactInfo.model.ts` with custom query methods
- [ ] T009 [P] Add `extractContactInfo` method to existing `src/api/aiChatApi.ts` for AI-powered contact extraction
- [ ] T010 [P] Add contact extraction types to `src/entityTypes/contactExtractionTypes.ts` (ContactExtractionRequest, ContactExtractionResponse)
- [ ] T011 [P] Implement BrowserPool class in `src/modules/contact-extraction/BrowserPool.ts` with Puppeteer
- [ ] T012 Implement ContactDiscovery with 4-stage pipeline in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T013 Implement ExtractionQueue with concurrency control in `src/modules/contact-extraction/ExtractionQueue.ts`
- [ ] T014 Create ContactExtractionWorker process in `src/modules/contact-extraction/ContactExtractionWorker.ts`
- [ ] T015 Create IPC handlers in `src/main-process/communication/contactExtraction-ipc.ts` for all 4 channels
- [ ] T016 Register IPC handlers in main process bootstrap

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Batch Contact Extraction from Search Results (Priority: P1) 🎯 MVP

**Goal**: Enable users to select multiple search results and extract contact information (emails, phones, addresses) from websites using Puppeteer and AI analysis

**Independent Test**: Select 5 search results with known contact information, click "Get Contact Info with AI" button, verify extraction completes and contact data is saved to database with correct status

### Implementation for User Story 1

- [ ] T017 [US1] Implement `start-contact-extraction` IPC handler in `src/main-process/communication/contactExtraction-ipc.ts`
- [ ] T018 [US1] Implement worker message handler for extraction requests in `src/modules/contact-extraction/ContactExtractionWorker.ts`
- [ ] T019 [US1] Add queue processing logic with concurrency limits in `src/modules/contact-extraction/ExtractionQueue.ts`
- [ ] T020 [US1] Implement database save logic for extracted contact info in `src/modules/contact-extraction/ExtractionQueue.ts`
- [ ] T021 [US1] Implement progress update IPC bridge (worker → main → renderer) in `src/main-process/communication/contactExtraction-ipc.ts`
- [ ] T022 [US1] Create frontend API wrapper in `src/views/api/contactExtraction.ts` for IPC communication
- [ ] T023 [US1] Add "Get Contact Info with AI" button to `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T024 [US1] Implement checkbox selection logic for search results in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T025 [US1] Add click handler to trigger extraction in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T026 [US1] Add extraction status column to SearchDetailTable display in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T027 [US1] Add contact info columns (email, phone, address) to SearchDetailTable in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T028 [US1] Implement real-time progress listener in `src/views/pages/search/widgets/SearchDetailTable.vue` for status updates
- [ ] T029 [US1] Add loading indicators and progress display in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T030 [US1] Test extraction with 5 real websites and verify database saves

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Users can select search results, initiate extraction, and see results populate in the table.

---

## Phase 4: User Story 2 - Intelligent Contact Page Discovery (Priority: P2)

**Goal**: Automatically discover and navigate to contact pages on diverse websites using heuristic link scoring, keyword matching, and AI-assisted page analysis

**Independent Test**: Provide URLs with various contact page structures (/contact, /about, footer-only, AI-required) and verify the system correctly identifies and navigates to the appropriate page before extracting information

### Implementation for User Story 2

- [ ] T032 [P] [US2] Implement Stage 1 (Homepage Direct Scan) in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T032 [P] [US2] Implement Stage 2 (Heuristic Link Scoring) in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T033 [P] [US2] Implement Stage 3 (Fallback Standard Routes) in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T034 [P] [US2] Implement Stage 4 (AI-Assisted Extraction) in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T035 [US2] Integrate all 4 discovery stages in pipeline with fallback logic in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T036 [US2] Add discovery metadata tracking (method, confidence, duration) in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T038 [US2] Test discovery pipeline on 10 websites with varying structures

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Discovery pipeline should achieve 90%+ success rate across diverse website structures.

---

## Phase 5: User Story 3 - Real-Time Progress and Status Updates (Priority: P3)

**Goal**: Provide clear feedback about extraction progress with status indicators, automatic table refresh, and real-time updates as results arrive

**Independent Test**: Initiate extraction on 10 items and observe: (1) progress indicator shows "Processing X of Y", (2) table auto-refreshes within 10 seconds of completion, (3) status chips update from pending → analyzing → completed/failed

### Implementation for User Story 3

- [ ] T038 [US3] Add `contact-extraction-progress` IPC event listener in main process in `src/main-process/communication/contactExtraction-ipc.ts`
- [ ] T039 [US3] Forward progress events to focused window in `src/main-process/communication/contactExtraction-ipc.ts`
- [ ] T040 [US3] Implement progress state management in Vue component in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T041 [US3] Add status chips (pending, analyzing, completed, failed) with color coding in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T042 [US3] Implement progress dialog showing "Processing X of Y items" in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T043 [US3] Add automatic table refresh on progress events in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T044 [US3] Add error message display for failed extractions in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T045 [US3] Implement debounced progress updates to prevent UI flicker in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T047 [US3] Test progress updates with 20 concurrent extractions

**Checkpoint**: All user stories should now be independently functional. Users see real-time progress, automatic table updates, and clear status indicators.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T047 [P] Implement retry logic with exponential backoff in `src/modules/contact-extraction/ExtractionQueue.ts`
- [ ] T048 [P] Add URL validation before extraction in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T049 [P] Implement bot detection handling in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T050 [P] Add email validation helper in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T051 [P] Add phone validation helper in `src/modules/contact-extraction/ContactDiscovery.ts`
- [ ] T052 Implement `get-contact-info` IPC handler for querying existing data in `src/main-process/communication/contactExtraction-ipc.ts`
- [ ] T053 Implement `retry-contact-extraction` IPC handler in `src/main-process/communication/contactExtraction-ipc.ts`
- [ ] T054 Add Retry button to UI for failed extractions in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T055 Add export functionality for extracted contact info in `src/views/pages/search/widgets/SearchDetailTable.vue`
- [ ] T056 Add unit tests for ContactDiscovery logic in `test/modules/contact-extraction/ContactDiscovery.test.ts`
- [ ] T057 Add unit tests for contact extraction AI integration in `test/modules/contact-extraction/contactExtraction.test.ts`
- [ ] T058 Add IPC handler tests in `test/vitest/main/contactExtraction-ipc.test.ts`
- [ ] T059 [P] Create E2E test fixtures in `test/fixtures/contact-websites/`
- [ ] T060 Performance optimization: batch database updates in `src/modules/contact-extraction/ExtractionQueue.ts`
- [ ] T061 Add comprehensive error logging with DEBUG flags in `src/modules/contact-extraction/`
- [ ] T062 Update documentation with API key setup in `.env.example`
- [ ] T063 Run quickstart.md validation scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User Story 1 (P1): Core batch extraction
  - User Story 2 (P2): Intelligent discovery (can parallelize with US1)
  - User Story 3 (P3): Real-time progress (can parallelize with US1/US2)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Enhances US1 discovery success rate
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Enhances US1 user experience

### Within Each User Story

- Models/Entities before services/logic
- Services before IPC handlers
- IPC handlers before frontend API
- Frontend API before UI components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

**Setup Phase (Phase 1)**:
- T002, T003 can run in parallel

**Foundational Phase (Phase 2)**:
- T009, T010, T011 can run in parallel (AI API extension, types, BrowserPool)
- T030-T033 (US2 discovery stages) can be developed in parallel if stubbed

**User Story 1 (Phase 3)**:
- After foundation, T016-T022 (backend) can proceed in parallel with T023-T028 (frontend) if IPC contracts are respected

**User Story 2 (Phase 4)**:
- T030-T033 (4 discovery stages) can run in parallel as independent functions

**User Story 3 (Phase 5)**:
- T037-T040 (IPC + state) can run in parallel with T041-T044 (UI components)

**Polish Phase (Phase 6)**:
- T046-T050 (retry/validation) can run in parallel
- T055-T058 (tests) can run in parallel

**Cross-Story Parallelization**:
- Once Foundational phase completes, US1, US2, and US3 can be developed in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Backend tasks (can run together):
Task T016: "Implement start-contact-extraction IPC handler"
Task T017: "Implement worker message handler"
Task T018: "Add queue processing logic"
Task T019: "Implement database save logic"
Task T020: "Implement progress update IPC bridge"

# Frontend tasks (can run together after backend contracts defined):
Task T021: "Create frontend API wrapper"
Task T022: "Add Get Contact Info button"
Task T023: "Implement checkbox selection"
Task T024-T028: "UI components and listeners"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T015) - CRITICAL
3. Complete Phase 3: User Story 1 (T016-T029)
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

**MVP Scope**: Users can select search results, click "Get Contact Info", and see extraction complete with contact data saved to database.

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo (90%+ success rate)
4. Add User Story 3 → Test independently → Deploy/Demo (Real-time UX)
5. Add Polish → Final feature complete

Each story adds value without breaking previous stories:
- US1: Basic batch extraction works
- US2: Extraction succeeds on 90%+ of websites
- US3: Users see real-time progress and clear status

### Parallel Team Strategy

With multiple developers after Foundational phase:

1. Team completes Setup + Foundational together
2. Once Foundational (T001-T016) is done:
   - Developer A: User Story 1 (T016-T029) - Core extraction
   - Developer B: User Story 2 (T030-T036) - Discovery pipeline
   - Developer C: User Story 3 (T037-T045) - Progress UX
3. Stories integrate at IPC contract boundaries

---

## Summary

| Metric | Count |
|--------|-------|
| **Total Tasks** | 63 |
| **Setup Tasks** | 3 |
| **Foundational Tasks** | 13 |
| **User Story 1 (P1) Tasks** | 14 |
| **User Story 2 (P2) Tasks** | 7 |
| **User Story 3 (P3) Tasks** | 9 |
| **Polish Tasks** | 17 |
| **Parallelizable Tasks** | ~25% (marked [P]) |
| **MVP Scope** | Phases 1-3 (30 tasks) |

### Key Files to Create

**Backend (Main Process)**:
- `src/entity/ContactInfo.entity.ts`
- `src/model/ContactInfo.model.ts`
- `src/entityTypes/contactExtractionTypes.ts`
- `src/api/aiChatApi.ts` (modify - add extractContactInfo method)
- `src/modules/contact-extraction/ContactExtractionWorker.ts`
- `src/modules/contact-extraction/ContactDiscovery.ts`
- `src/modules/contact-extraction/ExtractionQueue.ts`
- `src/modules/contact-extraction/BrowserPool.ts`
- `src/main-process/communication/contactExtraction-ipc.ts`
- `src/migrations/CreateContactInfoTable.ts`

**Frontend (Renderer Process)**:
- `src/views/api/contactExtraction.ts`
- `src/views/pages/search/widgets/SearchDetailTable.vue` (modify)

**Tests**:
- `test/modules/contact-extraction/ContactDiscovery.test.ts`
- `test/modules/contact-extraction/contactExtraction.test.ts`
- `test/vitest/main/contactExtraction-ipc.test.ts`

### Technology Stack

- **Language**: TypeScript 5.x
- **Database**: SQLite with TypeORM
- **Browser Automation**: Puppeteer + puppeteer-extra-plugin-stealth
- **AI Service**: OpenAI GPT-4o-mini
- **IPC**: Electron IPC (4 channels)
- **Frontend**: Vue 3 + Vuetify
- **Testing**: Mocha (modules), Vitest (main process)

### Success Criteria

- ✅ Extract contact info from 80%+ of websites
- ✅ Complete extraction within 30 seconds per website
- ✅ Process up to 50 websites in single batch
- ✅ 95% valid email accuracy rate
- ✅ Real-time progress updates within 5 seconds
- ✅ UI remains responsive during extraction
- ✅ Worker process isolation protects main app

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Tests are created after implementation (not TDD for this feature)
- Follow existing codebase patterns for IPC, TypeORM, and Vue components
- All TypeScript types must be explicit (no `any` types)
- Worker process crashes must not crash main Electron app
- Browser pool limited to 3 concurrent instances to prevent memory exhaustion
