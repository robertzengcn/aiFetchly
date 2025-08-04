# Search Task Edit Functionality - Todo List

## Overview
This document outlines the tasks required to implement the edit search task functionality, allowing users to modify existing search tasks from the search task list page.

## Current State Analysis
- Search tasks are displayed in SearchResultTable.vue with actions for open folder, download error log, and retry
- Search task data is managed through SearchController and SearchModule
- Current actions: open folder (view details), download error log, retry task
- Missing: edit functionality

## Backend Implementation Tasks

### 1. Database Layer Updates
- [x] Update SearchTaskModel (src/model/SearchTask.model.ts)
  - [x] Add updateSearchTask() method to update task properties
  - [x] Add validation for editable fields (engine, keywords, num_pages, concurrency, etc.)
  - [x] Ensure only tasks with status "NotStart" or "Error" can be edited
  - [x] Add method to check if task is editable based on status

### 2. Search Module Updates
- [x] Update SearchModule (src/modules/searchModule.ts)
  - [x] Add updateSearchTask() method to handle task updates
  - [x] Add validation logic for task editability
  - [x] Update task keywords if keywords are modified
  - [x] Handle proxy updates if proxys are modified
  - [x] Handle account updates if accounts are modified

### 3. Controller Layer Updates
- [x] Update SearchController (src/controller/searchController.ts)
  - [x] Add updateSearchTask() method
  - [x] Add validation for task existence and editability
  - [x] Handle the update workflow (validate → update → return result)
  - [x] Add method to get task details for editing

### 4. IPC Communication Updates
- [x] Update search-ipc.ts (src/main-process/communication/search-ipc.ts)
  - [x] Add new IPC handler for GET_SEARCH_TASK_DETAILS
  - [x] Add new IPC handler for UPDATE_SEARCH_TASK
  - [x] Add validation for incoming edit requests
  - [x] Handle error responses for invalid edit attempts

### 5. Channel Configuration
- [x] Update channellist.ts (src/config/channellist.ts)
  - [x] Add GET_SEARCH_TASK_DETAILS channel constant
  - [x] Add UPDATE_SEARCH_TASK channel constant
  - [x] Add SEARCH_TASK_UPDATE_EVENT channel constant

## Frontend Implementation Tasks

### 6. API Layer Updates
- [x] Update search API (src/views/api/search.ts)
  - [x] Add getSearchTaskDetails(taskId: number) function
  - [x] Add updateSearchTask(taskId: number, data: UpdateSearchTaskData) function
  - [x] Add proper TypeScript types for update data
  - [x] Add error handling for API calls

### 7. Type Definitions
- [x] Update types (src/views/api/types.d.ts)
  - [x] Add UpdateSearchTaskData interface
  - [x] Add SearchTaskDetails interface
  - [x] Add response types for edit operations

### 8. UI Component Updates
- [x] Update SearchResultTable.vue (src/views/pages/search/widgets/SearchResultTable.vue)
  - [x] Add edit icon to actions column (only for editable tasks)
  - [x] Add click handler for edit action
  - [x] Add conditional rendering for edit button based on task status
  - [x] Add loading state for edit operations
- [x] Add EditSearchTask route to router configuration
- [x] Modify index.vue to support both create and edit modes (reuse existing form)

### 9. Edit Dialog Component
- [x] Create EditSearchTaskDialog.vue (src/views/pages/search/components/EditSearchTaskDialog.vue)
  - [x] Create form with all editable fields:
    - Search engine selection
    - Keywords input
    - Number of pages
    - Concurrency settings
    - Browser visibility option
    - Local browser selection
    - Proxy settings
    - Account selection
  - [x] Add form validation
  - [x] Add loading states
  - [x] Add success/error feedback
  - [x] Add cancel/confirm actions
- [x] **Note**: Dialog component created but not used in final implementation - reusing existing index.vue form instead

## Business Logic Tasks

### 10. Validation Rules
- [x] Implement edit validation
  - [x] Only allow editing of tasks with status "NotStart", "Error", or "Processing"
  - [x] Validate search engine compatibility with keywords
  - [x] Validate proxy settings if provided
  - [x] Validate account settings if provided
  - [x] Ensure keywords are not empty
  - [x] Validate numeric fields (pages, concurrency)

### 11. Status Management
- [x] Handle task status updates
  - [x] Reset task status to "NotStart" when edited
  - [x] Clear previous results when task is modified
  - [x] Update task record time when modified
  - [x] Handle log file updates if needed
- [x] Update edit validation to allow "Processing" status in addition to "NotStart" and "Error"

## Testing Tasks

### 12. Unit Tests
- [x] Backend testing
  - [x] Test SearchTaskModel update methods
  - [x] Test SearchModule update functionality
  - [x] Test SearchController update logic
  - [x] Test IPC handlers for edit operations
  - [x] Test validation rules


## Estimated Timeline
- Backend Implementation: 3-4 days
- Frontend Implementation: 2-3 days
- Testing and Documentation: 2-3 days
- Total Estimated Time: 7-10 days

## Priority Levels

### High Priority (Must Have)
- Tasks 1-5: Backend implementation
- Tasks 6-9: Frontend API and basic UI
- Tasks 10-11: Core validation and status management

### Medium Priority (Should Have)
- Tasks 12-13: Testing and validation

## Dependencies
- Existing search task infrastructure
- Current IPC communication system
- Vue.js and Vuetify components
- TypeORM database layer
- Electron main process setup
