# Search Task Save-Only Implementation Todo List

## Overview
Implement a new method to save search tasks without automatically running them. This will allow users to create tasks and run them later, providing better task management and scheduling capabilities.

## Current Flow Analysis
Currently, the search task creation flow is:
1. User submits search data via `SEARCHSCRAPERAPI`
2. `SearchController.searchData()` creates task and immediately runs it
3. Task status is set to "Processing" and execution starts

## Required Changes

### 1. Backend Changes

#### 1.1 Controller Layer (`src/controller/searchController.ts`)
- [x] **Add new method `createTaskOnly()`**
  - [x] Extract task creation logic from `searchData()`
  - [x] Remove automatic task execution
  - [x] Set initial task status to "Not Start" instead of "Processing"
  - [x] Return task ID for frontend reference

#### 1.2 Module Layer (`src/modules/searchModule.ts`)
- [x] **Add new method `createSearchTaskOnly()`**
  - [x] Reuse existing `saveSearchtask()` logic
  - [x] Ensure task is saved with "Not Start" status
  - [x] Handle all task-related data (keywords, proxies, accounts)
  - [x] Return task ID

#### 1.3 Model Layer (`src/model/SearchTask.model.ts`)
- [x] **Verify `saveSearchTask()` method**
  - [x] Ensure it can save tasks with "Not Start" status
  - [x] Check if status parameter is properly handled
  - [x] Verify all task fields are saved correctly

### 2. IPC Communication Layer

#### 2.1 Channel Configuration (`src/config/channellist.ts`)
- [x] **Add new channel constant**
  - [x] Add `CREATE_SEARCH_TASK_ONLY` constant
  - [x] Define channel name (e.g., "create-search-task-only")
  - [x] Add proper TypeScript export
  - [x] Update channel list documentation

#### 2.2 Preload Script (`src/preload.ts`)
- [x] **Add new IPC bridge function**
  - [x] Add `createSearchTaskOnly` to contextBridge
  - [x] Expose function to renderer process
  - [x] Add proper TypeScript types
  - [x] Ensure security with proper validation

#### 2.3 IPC Handlers (`src/main-process/communication/search-ipc.ts`)
- [x] **Add new IPC handler**
  - [x] Create handler for `CREATE_SEARCH_TASK_ONLY`
  - [x] Validate input data (same as current validation)
  - [x] Call `SearchController.createTaskOnly()`
  - [x] Return task ID and success status
  - [x] Handle errors appropriately

#### 2.4 API Layer (`src/views/api/search.ts`)
- [x] **Add new API function**
  - [x] Create `createSearchTaskOnly()` function
  - [x] Use `windowInvoke()` with new channel
  - [x] Return task ID or error
  - [x] Add proper TypeScript types

### 3. Frontend Changes

#### 3.1 Search Form (`src/views/pages/search/index.vue`)
- [x] **Add "Save Only" button**
  - [x] Add new button next to "Submit" button
  - [x] Use different styling (e.g., secondary color)
  - [x] Add proper i18n translation keys

- [x] **Add new form submission method**
  - [x] Create `onSaveOnly()` method
  - [x] Call new API function `createSearchTaskOnly()`
  - [x] Show success message with task ID
  - [x] Navigate to task list after successful save

- [x] **Update form validation**
  - [x] Ensure same validation rules apply
  - [x] Handle validation errors consistently

#### 3.2 Task List Page (`src/views/pages/search/resultlist.vue`)
- [x] **Add "Run Task" action**
  - [x] Add run button in task actions
  - [x] Only show for tasks with "Not Start" status
  - [x] Call existing run task functionality

#### 3.3 Search Result Table (`src/views/pages/search/widgets/SearchResultTable.vue`)
- [x] **Update action buttons**
  - [x] Add run button for "Not Start" tasks
  - [x] Update action visibility logic
  - [x] Add proper tooltips and icons

### 4. Database and Status Management

#### 4.1 Task Status Updates
- [x] **Verify status enum values**
  - [x] Check `SearchTaskStatus.NotStart` exists
  - [x] Ensure status transitions are valid
  - [x] Update status display logic

#### 4.2 Task Execution Flow
- [x] **Update run task functionality**
  - [x] Ensure `runSearchTask()` works with saved tasks
  - [x] Update status from "Not Start" to "Processing"
  - [x] Handle task execution properly

### 6. Internationalization

#### 6.1 Translation Keys
- [x] **Add new translation keys**
  - [x] `search.save_only` - "Save Only" button
  - [x] `search.task_saved_successfully` - Success message
  - [x] `search.task_id` - Task ID label
  - [x] `search.run_task` - "Run Task" action
  - [x] `search.task_status_not_start` - Status display