# Tasks: AI-Assisted Email Template Creation

**Feature Branch**: `001-ai-email-template`
**Input**: Design documents from `/specs/001-ai-email-template/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ipc-channels.md ✅, quickstart.md ✅

**Tests**: Tests are included - unit tests for IPC handlers, integration tests for RAG, and E2E tests for full user workflows.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Path Conventions

This is an Electron desktop application with three-layer architecture:
- **Renderer UI**: `src/views/pages/emailmarketing/template/`
- **Main Process**: `src/main-process/communication/`
- **Modules**: `src/modules/`
- **Config**: `src/config/`
- **Entity Types**: `src/entityTypes/`
- **Utils**: `src/views/utils/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create feature branch `001-ai-email-template` from `dev` branch
- [ ] T002 Verify all dependencies installed (yarn install)
- [ ] T003 [P] Review existing AI chat IPC patterns in `src/main-process/communication/ai-chat-ipc.ts` for reference
- [ ] T004 [P] Review existing variable system in `src/views/utils/emailFun.ts` to understand current implementation
- [ ] T005 [P] Review template detail UI in `src/views/pages/emailmarketing/template/templatedetail.vue` to understand current layout

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 [P] Add IPC channel constants to `src/config/channellist.ts`
  ```typescript
  export const AI_EMAIL_TEMPLATE_GENERATE_STREAM = 'ai-email-template:generate-stream';
  export const AI_EMAIL_TEMPLATE_GENERATE_CHUNK = 'ai-email-template:generate-chunk';
  export const AI_EMAIL_TEMPLATE_GENERATE_COMPLETE = 'ai-email-template:generate-complete';
  export const AI_EMAIL_TEMPLATE_ERROR = 'ai-email-template:error';
  export const AI_EMAIL_TEMPLATE_STOP = 'ai-email-template:stop';
  export const AI_EMAIL_TEMPLATE_VALIDATE = 'ai-email-template:validate';
  export const AI_EMAIL_TEMPLATE_GENERATE = 'ai-email-template:generate';
  ```

- [ ] T007 [P] Create central variable registry in new file `src/config/emailTemplateVariables.ts`
  ```typescript
  export const EMAIL_TEMPLATE_VARIABLES = {
      SEND_TIME: '{$send_time}',
      SENDER: '{$sender}',
      RECEIVER_EMAIL: '{$receiver_email}',
      RECEIVER_NAME: '{$receiver_name}',
      URL: '{$url}',
      DESCRIPTION: '{$description}',
      COMPANY_NAME: '{$company_name}',
      CAMPAIGN_NAME: '{$campaign_name}'
  } as const;
  export type EmailTemplateVariable = typeof EMAIL_TEMPLATE_VARIABLES[keyof typeof EMAIL_TEMPLATE_VARIABLES];
  export const EMAIL_TEMPLATE_VARIABLE_LIST: EmailTemplateVariable[] = Object.values(EMAIL_TEMPLATE_VARIABLES);
  export const VARIABLE_DESCRIPTIONS: Record<EmailTemplateVariable, string> = { /* descriptions */ };
  ```

- [ ] T008 [P] Add TypeScript types to `src/entityTypes/emailmarketingType.ts`
  - `AIEmailTemplateRequest` interface
  - `AIEmailTemplateResponse` interface
  - `EmailTemplateTone` type (formal, casual, friendly, professional)
  - `EmailTemplateType` type (cold_outreach, follow_up, newsletter, promotion, custom)
  - `AIEmailTemplateStreamEvent` union type
  - Extend `EmailTemplatePreviewdata` with new fields: ReceiverName, CompanyName, CampaignName

- [ ] T009 [P] Create variable validation utility in new file `src/views/utils/variableValidation.ts`
  - `validateAIOutputVariables(content: string): ValidationResult` function
  - `validateAIRequest(request: AIEmailTemplateRequest): ValidationResult` function
  - `parseEmailTemplateFromStream(content: string): { title, content }` function
  - `extractVariables(content: string): EmailTemplateVariable[]` function

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Generate New Email Template with AI (Priority: P1) 🎯 MVP

**Goal**: Enable users to create email templates from scratch using AI text prompts with real-time streaming output

**Independent Test**: Open a new template, click "Generate with AI", enter prompt "cold outreach for SaaS product", and receive complete email with subject and body containing valid template variables, displayed in real-time as it generates

### Tests for User Story 1

- [ ] T010 [P] [US1] Create IPC handler unit test in `tests/vitest/main/ai-email-template-ipc.test.ts`
  - Test AI enable check returns error when disabled
  - Test request validation rejects invalid inputs
  - Test successful generation flow
  - Test streaming event emission
  - Test variable validation logic

- [ ] T011 [P] [US1] Create E2E test in `tests/e2e/ai-template-generation.spec.ts`
  - Test full user workflow: open template → click AI generate → enter prompt → see streaming → verify result
  - Test AI disabled scenario shows upgrade prompt
  - Test streaming display shows content character-by-character
  - Test generated template contains only valid variables
  - Test regeneration shows confirmation dialog

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create IPC handler in new file `src/main-process/communication/ai-email-template-ipc.ts`
  - Import dependencies: Token, RagSearchModule, AiChatApi, channels
  - Implement `registerAIEmailTemplateHandlers()` function
  - Add `ipcMain.on(AI_EMAIL_TEMPLATE_GENERATE_STREAM, ...)` handler
  - Add USER_AI_ENABLED check as FIRST line in handler
  - Implement RAG search integration (if useRAG enabled)
  - Implement AiChatApi.streamMessage() call with EMAIL_TEMPLATE_SYSTEM_PROMPT
  - Implement streaming chunk forwarding via AI_EMAIL_TEMPLATE_GENERATE_CHUNK
  - Implement parseEmailTemplateFromStream() to extract title/content
  - Implement validateAIOutputVariables() to check variables
  - Send AI_EMAIL_TEMPLATE_GENERATE_COMPLETE event with final result
  - Add error handling and AI_EMAIL_TEMPLATE_ERROR event sending
  - Export register function

- [ ] T013 [P] [US1] Add frontend API function in `src/views/api/emailmarketing.ts`
  - Create `generateAIEmailTemplate(data: AIEmailTemplateRequest): Promise<AIEmailTemplateResponse>` function
  - Set up event listeners for AI_EMAIL_TEMPLATE_GENERATE_CHUNK, COMPLETE, ERROR
  - Implement `windowInvoke(AI_EMAIL_TEMPLATE_GENERATE_STREAM, data)` call
  - Handle streaming chunks and update callback
  - Handle completion event and resolve promise with data
  - Handle error event and reject promise
  - Clean up event listeners on completion/error

- [ ] T014 [P] [US1] Create AI generation UI panel in `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Add import for `generateAIEmailTemplate` from emailmarketing API
  - Add reactive state: `aiPanelOpen`, `prompt`, `tone`, `templateType`, `useRAG`, `isStreaming`, `streamedContent`
  - Add "Generate with AI" button (Vuetify v-btn) in right column with variable buttons
  - Add `v-expansion-panels` component with inline expansion (not modal)
  - Add `v-textarea` for prompt input with 500 char limit
  - Add `v-select` for tone dropdown with options: formal, casual, friendly, professional
  - Add `v-select` for template type dropdown with options: cold_outreach, follow_up, newsletter, promotion, custom
  - Add nested `v-expansion-panels` for "Advanced" section
  - Add `v-checkbox` for "Use knowledge base" toggle inside Advanced section (hidden by default)
  - Add streaming output display area with streamedContent binding
  - Add "Stop Generating" button (v-btn color="error") visible only during streaming
  - Add "Generate" button (v-btn color="primary") with loading state
  - Add event listeners in `onMounted()` for: AI_EMAIL_TEMPLATE_GENERATE_CHUNK, COMPLETE, ERROR
  - Implement `generateTemplate()` function to call API with current state
  - Implement `stopGeneration()` function to send AI_EMAIL_TEMPLATE_STOP event
  - Remove event listeners in `onUnmounted()`
  - Handle completion event: populate `tplTitle` and `tplcontent` fields, collapse panel
  - Handle error event: show alert with error message

- [ ] T015 [US1] Add i18n translation keys to `src/views/lang/en.ts`
  ```typescript
  aiTemplateGeneration: {
    title: 'Generate with AI',
    promptPlaceholder: 'Describe what email you want to create...',
    promptLabel: 'Email Description',
    tone: 'Tone',
    toneFormal: 'Formal',
    toneCasual: 'Casual',
    toneFriendly: 'Friendly',
    toneProfessional: 'Professional',
    templateType: 'Email Type',
    typeColdOutreach: 'Cold Outreach',
    typeFollowUp: 'Follow Up',
    typeNewsletter: 'Newsletter',
    typePromotion: 'Promotion',
    typeCustom: 'Custom',
    advanced: 'Advanced Options',
    useKnowledgeBase: 'Use knowledge base for context',
    generateButton: 'Generate',
    stopButton: 'Stop Generating',
    generating: 'Generating template...',
    error: {
      aiDisabled: 'AI features are not enabled. Please upgrade your plan to access AI features.',
      timeout: 'Generation timed out. Please try again.',
      serviceUnavailable: 'AI service is temporarily unavailable. Please try again later.',
      networkError: 'Network connection failed. Please check your internet and try again.',
      parseError: 'Generation produced invalid format. Please try again with a clearer prompt.'
    },
    invalidVariables: 'Template contained unsupported variables and they were removed:',
    regenerateConfirm: 'Replace current generated template?',
    regenerateConfirmTitle: 'Regenerate Template'
  }
  ```

- [ ] T016 [P] [US1] Add i18n translation keys to `src/views/lang/zh.ts` (Chinese)
  - Translate all keys from en.ts `aiTemplateGeneration` section
  - Maintain same key structure as English

- [ ] T017 [P] [US1] Add i18n translation keys to `src/views/lang/es.ts` (Spanish)
  - Translate all keys from en.ts `aiTemplateGeneration` section
  - Maintain same key structure as English

- [ ] T018 [P] [US1] Add i18n translation keys to `src/views/lang/fr.ts` (French)
  - Translate all keys from en.ts `aiTemplateGeneration` section
  - Maintain same key structure as English

- [ ] T019 [P] [US1] Add i18n translation keys to `src/views/lang/de.ts` (German)
  - Translate all keys from en.ts `aiTemplateGeneration` section
  - Maintain same key structure as English

- [ ] T020 [P] [US1] Add i18n translation keys to `src/views/lang/ja.ts` (Japanese)
  - Translate all keys from en.ts `aiTemplateGeneration` section
  - Maintain same key structure as English

- [ ] T021 [US1] Create system prompt constant in `src/main-process/communication/ai-email-template-ipc.ts`
  ```typescript
  const EMAIL_TEMPLATE_SYSTEM_PROMPT = `
  You are an expert email marketing copywriter. Generate professional email templates based on user descriptions.

  CRITICAL RULES:
  1. Use ONLY these template variables (exactly as shown):
     - {$send_time} - Current timestamp
     - {$sender} - Sender email/name
     - {$receiver_email} - Recipient email address
     - {$receiver_name} - Recipient's first name for personalization
     - {$url} - Source URL or landing page
     - {$description} - Contextual description
     - {$company_name} - Recipient's company name
     - {$campaign_name} - Campaign reference name

  2. NEVER invent new variable names like {$first_name} or {$date}
  3. Output format:
     Subject: [email subject line]

     [email body content]

  4. Match the requested tone: {tone}
  5. Follow {templateType} best practices
   7. Keep emails concise (150-300 words)
  8. Use professional formatting (short paragraphs, clear CTAs)
  `;
  ```

- [ ] T022 [US1] Register AI email template handlers in main process entry point
  - Import `registerAIEmailTemplateHandlers` from `ai-email-template-ipc.ts`
  - Call `registerAIEmailTemplateHandlers()` in main process initialization
  - Verify handlers are registered by checking IPC channel registration

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Users can generate email templates with AI using natural language prompts with real-time streaming feedback.

---

## Phase 4: User Story 2 - Generate with Contextual Knowledge (Priority: P2)

**Goal**: Enable RAG integration to enhance AI generation with brand guidelines, past templates, and product information

**Independent Test**: Upload brand documents to knowledge base, enable "Use knowledge base" toggle, generate template, and verify content references brand-specific terminology

### Tests for User Story 2

- [ ] T023 [P] [US2] Create RAG integration unit test in `tests/vitest/main/ai-email-template-rag.test.ts`
  - Test RAG search with valid query returns results
  - Test RAG search with no results falls back gracefully
  - Test RAG context formatting in prompt
  - Test RAG failure doesn't block generation

- [ ] T024 [P] [US2] Create E2E test in `tests/e2e/ai-template-rag.spec.ts`
  - Test enabling RAG toggle enhances generation with knowledge base content
  - Test RAG with empty knowledge base still generates template
  - Test RAG search failure doesn't crash generation

### Implementation for User Story 2

- [ ] T025 [US2] Implement RAG search in `src/main-process/communication/ai-email-template-ipc.ts` handler
  - Import RagSearchModule from `@/modules/RagSearchModule`
  - Initialize RAG module: `await ragSearchModule.initialize()`
  - Check if `useRAG` is true in request data
  - Create search request: `{ query: 'email template: ' + requestData.prompt, options: { limit: requestData.ragLimit || 5 } }`
  - Call `await ragSearchModule.search(searchRequest)`
  - Format RAG results as context: map results to `[Document ${index + 1}: ${result.document.name}]\n${result.content}`
  - Prepend RAG context to user prompt: `Based on:\n${ragContext}\n\n---\n\n${requestData.prompt}`
  - Wrap RAG search in try/catch, log error, proceed with original prompt if RAG fails
  - Pass enhancedPrompt to AiChatApi.streamMessage instead of original prompt

- [ ] T026 [US2] Add RAG state tracking to UI in `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Add `ragEnabled` reactive state bound to RAG checkbox
  - Add `ragResultsCount` to show how many documents were retrieved
  - Display RAG status indicator when search completes: "Found X relevant documents"
  - Show warning if RAG search fails: "Knowledge base search failed, using basic generation"

- [ ] T027 [US2] Add i18n keys for RAG to all 6 language files
  - Add to `aiTemplateGeneration` section: `ragStatusSearching`, `ragStatusFound`, `ragStatusFailed`, `ragStatusEmpty`
  - Update en.ts, zh.ts, es.ts, fr.ts, de.ts, ja.ts

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Users can generate templates with or without knowledge base context.

---

## Phase 5: User Story 3 - Refine Existing Template with AI (Priority: P3)

**Goal**: Automatically detect existing template content and enter refinement mode to improve/rewrite templates

**Independent Test**: Open existing template with content, click "Generate with AI", provide modification instruction "make it more casual", receive updated content with preserved variable structure

### Tests for User Story 3

- [ ] T028 [P] [US3] Create refinement mode unit test in `tests/vitest/main/ai-email-template-refine.test.ts`
  - Test auto-detect logic identifies templates with content
  - Test refinement mode sends existing content as context
  - Test "Start fresh" button clears content and switches to creation mode
  - Test variable placement is preserved during refinement

- [ ] T029 [P] [US3] Create E2E test in `tests/e2e/ai-template-refine.spec.ts`
  - Test opening template with content auto-enters refinement mode
  - Test refinement prompt modifies existing content appropriately
  - Test "Start fresh" button switches to creation mode
  - Test multiple refinement iterations work correctly

### Implementation for User Story 3

- [ ] T030 [US3] Implement refinement detection logic in `src/main-process/communication/ai-email-template-ipc.ts`
  - Add function `shouldUseRefinementMode(template: EmailTemplate): boolean`
  - Check if `template.TplTitle` exists and has non-whitespace content
  - Check if `template.TplContent` exists and has >50 characters
  - Return true if either condition met, false otherwise

- [ ] T031 [US3] Modify IPC handler to support refinement mode in `src/main-process/communication/ai-email-template-ipc.ts`
  - Check `shouldUseRefinementMode(existingTemplate)` at start of handler
  - If in refinement mode and not `startFresh` flag:
    - Extract existing title and content from template
    - Build refinement context: `Current template title: ${title}\nCurrent template content: ${content}\n\nUser wants to: ${prompt}\n\nPlease improve/rewrite the template based on the user's request while maintaining the template variable structure.`
    - Pass refinementContext to AiChatApi instead of basic prompt
  - Add "Start fresh" button handler logic

- [ ] T032 [US3] Add refinement UI to `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Add computed property `hasExistingContent` to check if `tplTitle` or `tplcontent` have content
  - Add "Start fresh (ignore existing content)" button in AI generation panel (visible only when `hasExistingContent` is true)
  - Add visual indicator showing current mode: "Creating new template" vs "Improving existing template"
  - Handle refinement completion by updating fields while preserving variable structure

- [ ] T033 [US3] Add i18n keys for refinement to all 6 language files
  - Add to `aiTemplateGeneration` section: `modeCreating`, `modeRefining`, `startFreshButton`, `startFreshConfirm`
  - Update en.ts, zh.ts, es.ts, fr.ts, de.ts, ja.ts

**Checkpoint**: All user stories should now be independently functional. Users can create, refine, and regenerate templates with full AI integration.

---

## Phase 6: User Story 4 - Enhanced Variable System (Priority: P1)

**Goal**: Implement extended variable set (8 variables) with validation and replacement logic

**Independent Test**: Generate template with AI, verify only approved variables used, send test email and confirm all variables replaced correctly

### Tests for User Story 4

- [ ] T034 [P] [US4] Create variable validation test in `tests/vitest/utility/variable-validation.test.ts`
  - Test `validateAIOutputVariables()` correctly identifies invalid variables
  - Test invalid variables are stripped from content
  - Test valid variables are preserved
  - Test all 8 variables are in allowed list

- [ ] T035 [P] [US4] Create variable replacement test in `tests/vitest/utility/variable-replacement.test.ts`
  - Test `convertVariableInTemplate()` replaces all 8 variables
  - Test new variables (ReceiverName, CompanyName, CampaignName) are replaced
  - Test variables are replaced in both title and content
  - Test missing optional variables default to empty string

- [ ] T036 [P] [US4] Create E2E test in `tests/e2e/variable-system.spec.ts`
  - Test AI-generated templates with invalid variables show warning and sanitize content
  - Test sending email with new variables populates correctly

### Implementation for User Story 4

- [ ] T037 [P] [US4] Update variable replacement logic in `src/views/utils/emailFun.ts`
  - Import extended EmailTemplatePreviewdata interface with new fields
  - Update `convertVariableInTemplate()` function:
    - Add replacement for `{$receiver_name}` → `data.ReceiverName || ''`
    - Add replacement for `{$company_name}` → `data.CompanyName || ''`
    - Add replacement for `{$campaign_name}` → `data.CampaignName || ''`
  - Apply replacements to both title and content
  - Add helper function `formatSendTime()` to format timestamp as YYYY-MM-DD HH:mm:ss

- [ ] T038 [P] [US4] Add variable buttons to UI in `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Add "Insert Recipient Name" button for `{$receiver_name}` variable
  - Add "Insert Company Name" button for `{$company_name}` variable
  - Add "Insert Campaign Name" button for `{$campaign_name}` variable
  - Group buttons logically: keep existing 5 buttons, add 3 new buttons

- [ ] T039 [US4] Fix bug in `src/childprocess/emailSend.ts` - populate Url and Description
  - Find `EmailTemplatePreviewdata` construction
  - Add `Url: item.source` to populate {$url} variable
  - Add `Description: item.description` or campaign description to populate {$description} variable
  - Add new fields: `ReceiverName`, `CompanyName`, `CampaignName` based on available data
  - Test that all variables are populated during email sending

- [ ] T040 [US4] Add validation warning to UI in `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Watch for `AI_EMAIL_TEMPLATE_GENERATE_COMPLETE` event
  - Check if `hasInvalidVariables` is true in response
  - Show warning dialog or alert: `Template contained unsupported variables: ${invalidVariables.join(', ')}. They have been removed.`
  - Allow user to review sanitized content before saving

**Checkpoint**: Extended variable system complete with 8 variables, validation, and proper replacement during email sending.

---

## Phase 7: User Story 5 - AI Feature Access Control (Priority: P1)

**Goal**: Enforce AI feature access control based on user subscription plan

**Independent Test**: Verify AI-disabled users see upgrade prompt and cannot generate templates; verify AI-enabled users can generate without prompts

### Tests for User Story 5

- [ ] T041 [P] [US5] Create access control unit test in `tests/vitest/main/ai-email-template-access.test.ts`
  - Test USER_AI_ENABLED check returns error when 'false'
  - Test USER_AI_ENABLED check allows generation when 'true'
  - Test error message is clear and actionable

- [ ] T042 [P] [US5] Create E2E test in `tests/e2e/ai-access-control.spec.ts`
  - Test AI-disabled user sees upgrade prompt
  - Test upgrade prompt links to upgrade page
  - Test AI-enabled user can generate without prompts

### Implementation for User Story 5

- [ ] T043 [US5] Verify AI enable check is FIRST line in `src/main-process/communication/ai-email-template-ipc.ts`
  - Confirm `Token` import from `@/modules/token`
  - Confirm `USER_AI_ENABLED` import from `@/config/usersetting`
  - Confirm check is at very top of handler before any processing
  - Test returns error immediately when disabled
  - Verify error message: "AI features are not enabled. Please upgrade your plan to access AI features."

- [ ] T044 [US5] Add upgrade prompt UI in `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Watch for `AI_EMAIL_TEMPLATE_ERROR` event
  - Check if error message contains "AI features are not enabled"
  - Show upgrade dialog with:
    - Title: "Upgrade Required"
    - Message: "AI template generation requires a paid plan. Upgrade now to access this feature?"
    - Primary button: "View Plans" (links to upgrade page)
    - Secondary button: "Cancel"
  - Use Vuetify `v-dialog` or `v-alert` for display

- [ ] T045 [US5] Add i18n keys for access control to all 6 language files
  - Add to `aiTemplateGeneration.error` section: upgradeRequired, upgradeMessage, viewPlansButton
  - Update en.ts, zh.ts, es.ts, fr.ts, de.ts, ja.ts

**Checkpoint**: AI feature access control fully enforced. Only authorized users can generate templates.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T046 [P] Add comprehensive error handling for all edge cases in `src/main-process/communication/ai-email-template-ipc.ts`
  - Handle AI service timeout (30s timeout with partial content return)
  - Handle network errors with retry logic
  - Handle malformed AI output with validation and retry
  - Handle concurrent generation requests (queue or prevent)
  - Handle inappropriate content filtering

- [ ] T047 [P] Add logging for all AI template operations in `src/main-process/communication/ai-email-template-ipc.ts`
  - Log generation requests with prompt, tone, type
  - Log RAG search results (count, relevance)
  - Log generation completion with status
  - Log errors with full context
  - Use structured logging format

- [ ] T048 [P] Optimize streaming performance in `src/main-process/communication/ai-email-template-ipc.ts`
  - Throttle chunk emissions to ~30 FPS (every 33ms max)
  - Clear streaming buffer after completion to free memory
  - Optimize RAG query construction

- [ ] T049 [P] Add regeneration confirmation dialog in `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Show dialog when user clicks Generate after already having generated content
  - Dialog text: "Replace current generated template? Your existing AI-generated content will be replaced."
  - Options: "Replace" (primary), "Cancel" (secondary)
  - Use Vuetify `v-dialog` component

- [ ] T050 [P] Add "Advanced" section state persistence in `src/views/pages/emailmarketing/template/templatedetail.vue`
  - Save RAG toggle state when panel collapses/expands
  - Save "Start fresh" checkbox state
  - Restore state when panel reopens

- [ ] T051 Update `src/childprocess/emailSend.ts` to populate new extended variables
  - Add `ReceiverName` extraction from contact data or email list
  - Add `CompanyName` extraction from campaign or contact data
  - Add `CampaignName` from campaign metadata
  - Test all 8 variables populate correctly during sending

- [ ] T052 [P] Create documentation in `docs/ai-email-template-feature.md`
  - User guide: How to generate templates with AI
  - Developer guide: How to extend prompt templates
  - Troubleshooting guide: Common issues and solutions
  - Include screenshots and examples

- [ ] T053 [P] Add code comments throughout implementation
  - Document AI enable check requirement
  - Document RAG integration pattern
  - Document variable validation logic
  - Document streaming implementation

- [ ] T054 Run full test suite and verify all tests pass
  - Run `yarn testmain` - all IPC handler unit tests pass
  - Run `yarn vitest-puppeteer` - utility code tests pass
  - Run E2E tests with Playwright - all scenarios pass
  - Fix any failing tests

- [ ] T055 Manual testing checklist
  - Test all 5 user stories independently
  - Test with all 6 UI languages (en, zh, es, fr, de, ja)
  - Test edge cases from spec.md
  - Test on macOS, Windows, Linux (if possible)
  - Verify performance: generation completes in <30s
  - Verify no TypeScript errors (`yarn tsc`)

- [ ] T056 [P] Create README for this feature in `specs/001-ai-email-template/README.md`
  - Feature overview
  - Quick start for developers
  - Link to all documentation
  - Link to test coverage report

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - User Stories 1, 4, 5 are P1 (can be done in any order or in parallel)
  - User Story 2 is P2 (can be done in parallel with P1 stories)
  - User Story 3 is P3 (can be done in parallel with other stories)
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational - Integrates with US1 but independently testable
- **User Story 3 (P3)**: Can start after Foundational - Integrates with US1 but independently testable
- **User Story 4 (P1)**: Can start after Foundational - Extends existing system, independently testable
- **User Story 5 (P1)**: Can start after Foundational - Cross-cutting concern, applies to all stories

### Within Each User Story

- Tests MUST be written and FAIL before implementation (TDD)
- Type definitions before implementation
- Backend (IPC handler) before frontend (UI)
- Core functionality before integration
- Story complete before moving to next priority

### Parallel Opportunities

**Setup Phase**:
- T003, T004, T005 can run in parallel (read-only code review)

**Foundational Phase**:
- T006, T007, T008, T009 can all run in parallel (different files)

**User Story 1**:
- T010, T011 (tests) can run in parallel
- T016, T017, T018, T019, T020 (i18n files) can run in parallel
- T021 (system prompt) can be done alongside others

**User Story 2**:
- T023, T024 (tests) can run in parallel

**User Story 3**:
- T028, T029 (tests) can run in parallel
- T033 (i18n) can run in parallel with other work

**User Story 4**:
- T034, T035, T036 (tests) can run in parallel

**User Story 5**:
- T041, T042 (tests) can run in parallel

**Polish Phase**:
- T046, T047, T048, T049, T050, T052, T053, T056 can run in parallel (different concerns)

**Cross-Story Parallelization** (with multiple developers):
- Developer A: User Story 1 + User Story 4 (both P1)
- Developer B: User Story 2 (P2)
- Developer C: User Story 3 + User Story 5 (P3 + P1)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
yarn test tests/vitest/main/ai-email-template-ipc.test.ts
yarn test tests/e2e/ai-template-generation.spec.ts

# Launch all i18n file updates together (requires 6 separate terminals/commands):
# Terminal 1:
nvim src/views/lang/en.ts
# Terminal 2:
nvim src/views/lang/zh.ts
# Terminal 3:
nvim src/views/lang/es.ts
# Terminal 4:
nvim src/views/lang/fr.ts
# Terminal 5:
nvim src/views/lang/de.ts
# Terminal 6:
nvim src/views/lang/ja.ts
```

---

## Implementation Strategy

### MVP First (User Stories 1, 4, 5 - P1 stories)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Generate with AI)
4. Complete Phase 6: User Story 4 (Enhanced Variables)
5. Complete Phase 7: User Story 5 (Access Control)
6. **STOP and VALIDATE**: Test MVP independently - users can generate templates with proper variables and access control
7. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Core AI generation works (MVP!)
3. Add User Story 4 → Test independently → Extended variables work
4. Add User Story 5 → Test independently → Access control enforced
5. Add User Story 2 → Test independently → RAG integration works
6. Add User Story 3 → Test independently → Refinement mode works
7. Polish phase → Cross-cutting improvements
8. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - **Developer A**: User Story 1 (Generate) + User Story 4 (Variables)
   - **Developer B**: User Story 2 (RAG) + User Story 5 (Access Control)
   - **Developer C**: User Story 3 (Refinement) + Polish tasks
3. Stories complete and integrate independently

---

## Task Summary

- **Total Tasks**: 56 tasks
- **Setup Phase**: 5 tasks
- **Foundational Phase**: 4 tasks (BLOCKS all user stories)
- **User Story 1 (P1)**: 12 tasks
- **User Story 2 (P2)**: 5 tasks
- **User Story 3 (P3)**: 6 tasks
- **User Story 4 (P1)**: 7 tasks
- **User Story 5 (P1)**: 5 tasks
- **Polish Phase**: 12 tasks

**Parallel Opportunities**: 28 tasks marked [P] can run in parallel (50% of all tasks)

**Test Coverage**: 9 test files covering unit, integration, and E2E scenarios

**MVP Scope**: Phases 1-3 + Phases 6-7 (User Stories 1, 4, 5) = 33 tasks for core functionality

**Independent Test Criteria**:
- **US1**: Generate complete template from prompt with streaming
- **US2**: RAG integration enhances generation with knowledge base
- **US3**: Auto-detect refinement mode improves existing templates
- **US4**: Extended variables (8 vars) validated and replaced correctly
- **US5**: AI access control enforced based on subscription

---

## Notes

- [P] tasks = different files, no dependencies, can run in parallel
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Tests written first following TDD methodology
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Tasks include exact file paths for immediate execution
- All i18n tasks (6 languages) can be done in parallel by different developers
- AI enable check is MANDATORY and must be FIRST line in IPC handler
- Database access via Module/Model pattern only (constitution requirement)
- No `any` types allowed - use proper TypeScript types
