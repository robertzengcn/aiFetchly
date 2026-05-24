# AiFetchly — AI-Powered Marketing Automation

## What This Is

An Electron desktop application (Vue 3 + TypeScript) that combines AI-powered chat, web scraping, social media automation, and email marketing for digital marketers and lead generation teams.

## Core Value

Users can discover, contact, and market to prospects across platforms using AI-assisted workflows — from finding businesses on Google Maps to generating and sending personalized email campaigns.

## Current Milestone: v1.1 AI Chat File Operation Recording

**Goal:** Record every file CRUD operation performed by AI chat skills and display those records in near real-time inside the AI chat box, giving users visibility into what the AI changed.

**Target features:**
- Shared TypeScript types for file operation records
- FileOperationTracker service emitting records via IPC
- ToolExecutor integration intercepting file_write, file_edit, and delete tool calls
- New IPC channel for file operation events
- Frontend API wrappers for subscribing to file operation events
- AI chat UI component update to display operation badges
- All 6-language translations for operation UI text

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- The skill system (SkillExecutor, SkillPermissionService, skillsRegistry) is operational
- File tools (read, write, edit, glob, grep) are working with permission prompts
- StreamEventProcessor handles tool calls from AI chat
- ToolExecutor dispatches AI skill execution
- Child process pattern established (contact-extraction, yellowPagesScraper workers)
- IPC handler pattern established (contactExtraction-ipc, etc.)
- Vue 3 + Vuetify UI page pattern established
- i18n with 6 languages (en, zh, es, fr, de, ja)
- Google Maps Business Scraper — full feature with AI skill, UI page, and persistence (v1.0)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Create shared TypeScript types for file operation records (type, path, timestamp, success, conversation/skill context)
- [ ] Create FileOperationTracker service that emits records to renderer via IPC
- [ ] Add AI_FILE_OPERATION IPC channel to channellist
- [ ] Integrate ToolExecutor to emit records for file_write, file_edit, and delete tool calls
- [ ] Add frontend API wrappers in aiChat.ts for subscribing to file operation events
- [ ] Update AI chat Vue component to display file operation badges in the chat box
- [ ] Add translations for all 6 supported languages (file operation UI text)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Database persistence of operation records — in-memory only in v1.1, defer to future milestone
- Full rollback/undo system — complex, not needed in first version
- Recording manual user file edits — only AI skill operations tracked
- Recording read-only operations (file_read, glob_files, grep_files) — no mutation, no record needed
- Dynamic imports or untyped `any` values — maintain type safety
- "View diff" for edit operations — deferred to future milestone

## Context

aiFetchly is an Electron desktop app (Vue 3 + TypeScript) with an AI chat interface. The skill system supports:

- **skillsRegistry.ts**: Static registration of built-in skills with JSON Schema parameters
- **SkillExecutor.ts**: Validates input, checks permissions, executes, and audits
- **ToolExecutor.ts**: Dispatches skill execution with validation and rate limiting
- **StreamEventProcessor**: Routes AI tool calls through the skill pipeline
- **FileToolService.ts**: Handles file read/write/edit/glob/grep operations for AI tools
- **Child process pattern**: Workers in `src/childprocess/` perform browser automation
- **IPC pattern**: Handlers in `src/main-process/communication/` use Modules (never direct DB access)
- **Three-layer DB**: Entity → Model → Module; IPC handlers never access DB directly
- **Worker constraint**: Workers never access TypeORM, SqliteDb, or app database paths
- **i18n**: 6 languages supported via `src/views/lang/{en,zh,es,fr,de,ja}.ts`

Permission categories: `pure`, `network`, `filesystem`, `automation`.

For file operation recording, the interception point is `ToolExecutor.executeFileTool()` — the path that dispatches AI file tools to `FileToolService`. After each write-like operation completes, a `FileOperationRecord` will be emitted to the renderer via the new `AI_FILE_OPERATION` IPC channel.

## Constraints

- **Tech stack**: TypeScript 5.x, Electron main process, Vue 3 + Vuetify frontend
- **No database persistence in v1.1**: In-memory records only; records lost on app restart
- **No direct DB writes in IPC handlers**: Follow Model/Module architecture if persistence added later
- **Tracking never breaks skill execution**: FileOperationTracker.emit() failures must be caught silently
- **Read-only operations not tracked**: file_read, glob_files, grep_files are excluded
- **Translations**: All 6 languages required for any user-facing text

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Interception at ToolExecutor level | Central dispatch point for all AI tool calls; single place to emit records | — Pending |
| No database persistence in v1.1 | Reduces complexity; in-memory tracking sufficient for initial UX validation | — Pending |
| FileOperationTracker as static service | Matches existing service patterns (RateLimiterManager); easy to call from ToolExecutor | — Pending |
| Read-only operations excluded | No mutation = no user confusion; reduces noise in the operation feed | — Pending |
| Emit on both success and failure | Users need to know when AI attempted but failed to change a file | — Pending |
| Shared GoogleMapsModule for AI and UI | One orchestration layer, two entry points. Avoids duplication, ensures consistent behavior | — Pending |
| `automation` permission category (not new category) | Google Maps scraping fits existing automation risk profile; no new permission flow needed | — Pending |
| Puppeteer browser scraping only in v1 | Fastest to integrate with existing patterns; Places API can be added later | — Pending |
| Same hard cap (50) for AI and UI | Simpler reasoning, consistent limits, avoids user confusion | — Pending |
| Save results to local history | Users expect to recover results later; entity + model + module pattern | — Pending |
| CSV + JSON export only | Covers most marketing workflow needs; XLSX deferred | — Pending |
| Worker never accesses database | Follows established architecture; main process handles all persistence | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-25 after milestone v1.1 initialization*
