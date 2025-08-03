# Search Task Edit Functionality - Todo List

## Overview
This document outlines the tasks required to implement the edit search task functionality, allowing users to modify existing search tasks from the search task list page.

## Current State Analysis
- Search tasks are displayed in `SearchResultTable.vue` with actions for open folder, download error log, and retry
- Search task data structure includes: engine, keywords, num_pages, concurrency, notShowBrowser, localBrowser, accounts
- Current IPC handlers exist for search operations but no edit functionality
- Search task entity has fields that can be modified: enginer_id, num_pages, concurrency, notShowBrowser, localBrowser

## Implementation Tasks

### 1. Backend/Model Layer

#### 1.1 Update SearchTask Model
- [ ] **Task**: Add update method to SearchTaskModel
  - **File**: `src/model/SearchTask.model.ts`
  - **Description**: Create `updateSearchTask(taskId: number, updates: Partial<SearchTaskEntity>): Promise<boolean>` method
  - **Dependencies**: None
  - **Priority**: High

#### 1.2 Update SearchModule
- [ ] **Task**: Add update task method to SearchModule
  - **File**: `src/modules/searchModule.ts`
  - **Description**: Create `updateSearchTask(taskId: number, updates: SearchDataParam): Promise<boolean>` method
  - **Dependencies**: SearchTaskModel update method
  - **Priority**: High

#### 1.3 Update SearchController
- [ ] **Task**: Add update task method to SearchController
  - **File**: `src/controller/searchController.ts`
  - **Description**: Create `updateSearchTask(taskId: number, data: Usersearchdata): Promise<void>` method
  - **Dependencies**: SearchModule update method
  - **Priority**: High

### 2. IPC Communication Layer

#### 2.1 Add IPC Handler
- [ ] **Task**: Add edit search task IPC handler
  - **File**: `src/main-process/communication/search-ipc.ts`
  - **Description**: Add new IPC handler for `EDITSEARCHTASK` channel
  - **Dependencies**: SearchController update method
  - **Priority**: High

#### 2.2 Update Channel List
- [ ] **Task**: Add new channel constant
  - **File**: `src/config/channellist.ts`
  - **Description**: Add `EDITSEARCHTASK` constant
  - **Dependencies**: None
  - **Priority**: Medium

### 3. Frontend API Layer

#### 3.1 Add API Function
- [ ] **Task**: Create edit search task API function
  - **File**: `src/views/api/search.ts`
  - **Description**: Add `editSearchTask(taskId: number, data: Usersearchdata): Promise<any>` function
  - **Dependencies**: IPC handler
  - **Priority**: High

#### 3.2 Update API Types
- [ ] **Task**: Add edit task types
  - **File**: `src/views/api/types.ts` or relevant type file
  - **Description**: Add types for edit task request/response
  - **Dependencies**: None
  - **Priority**: Medium

### 4. Frontend UI Components

#### 4.1 Add Edit Icon to SearchResultTable
- [ ] **Task**: Add edit icon to actions column
  - **File**: `src/views/pages/search/widgets/SearchResultTable.vue`
  - **Description**: Add edit icon button in the actions template
  - **Dependencies**: Edit dialog component
  - **Priority**: High

#### 4.2 Create Edit Dialog Component
- [ ] **Task**: Create SearchTaskEditDialog component
  - **File**: `src/views/pages/search/widgets/SearchTaskEditDialog.vue`
  - **Description**: Create a dialog component for editing search task parameters
  - **Dependencies**: None
  - **Priority**: High

#### 4.3 Add Edit Function to SearchResultTable
- [ ] **Task**: Implement edit task function
  - **File**: `src/views/pages/search/widgets/SearchResultTable.vue`
  - **Description**: Add `editTask(item)` function to handle edit button clicks
  - **Dependencies**: Edit dialog component, API function
  - **Priority**: High

### 5. Edit Dialog Implementation

#### 5.1 Dialog Form Fields
- [ ] **Task**: Create form fields for editable parameters
  - **File**: `src/views/pages/search/widgets/SearchTaskEditDialog.vue`
  - **Description**: Add form fields for: search engine, keywords, num_pages, concurrency, notShowBrowser, localBrowser
  - **Dependencies**: None
  - **Priority**: High

#### 5.2 Form Validation
- [ ] **Task**: Add form validation
  - **File**: `src/views/pages/search/widgets/SearchTaskEditDialog.vue`
  - **Description**: Add validation rules for form fields
  - **Dependencies**: None
  - **Priority**: Medium

#### 5.3 Load Existing Data
- [ ] **Task**: Load current task data into form
  - **File**: `src/views/pages/search/widgets/SearchTaskEditDialog.vue`
  - **Description**: Populate form with existing task data when dialog opens
  - **Dependencies**: API function to get task details
  - **Priority**: High

#### 5.4 Save Functionality
- [ ] **Task**: Implement save functionality
  - **File**: `src/views/pages/search/widgets/SearchTaskEditDialog.vue`
  - **Description**: Add save button and function to update task
  - **Dependencies**: API function
  - **Priority**: High

### 6. API Integration

#### 6.1 Get Task Details API
- [ ] **Task**: Create get task details API
  - **File**: `src/views/api/search.ts`
  - **Description**: Add `getSearchTaskDetails(taskId: number): Promise<SearchtaskItem>` function
  - **Dependencies**: Backend get task method
  - **Priority**: Medium

#### 6.2 Update Task API
- [ ] **Task**: Create update task API
  - **File**: `src/views/api/search.ts`
  - **Description**: Add `updateSearchTask(taskId: number, data: Usersearchdata): Promise<any>` function
  - **Dependencies**: Backend update method
  - **Priority**: High

### 7. Backend Get Task Details

#### 7.1 Add Get Task Method to Controller
- [ ] **Task**: Add get task details method to SearchController
  - **File**: `src/controller/searchController.ts`
  - **Description**: Add `getSearchTaskDetails(taskId: number): Promise<SearchtaskItem>` method
  - **Dependencies**: SearchModule get task method
  - **Priority**: Medium

#### 7.2 Add IPC Handler for Get Task
- [ ] **Task**: Add get task details IPC handler
  - **File**: `src/main-process/communication/search-ipc.ts`
  - **Description**: Add IPC handler for `GETSEARCHTASKDETAILS` channel
  - **Dependencies**: SearchController get task method
  - **Priority**: Medium

### 8. UI/UX Enhancements

#### 8.1 Loading States
- [ ] **Task**: Add loading states to edit dialog
  - **File**: `src/views/pages/search/widgets/SearchTaskEditDialog.vue`
  - **Description**: Show loading indicators during save operations
  - **Dependencies**: None
  - **Priority**: Low

#### 8.2 Success/Error Messages
- [ ] **Task**: Add success/error message handling
  - **File**: `src/views/pages/search/widgets/SearchTaskEditDialog.vue`
  - **Description**: Show appropriate messages after save operations
  - **Dependencies**: None
  - **Priority**: Medium

#### 8.3 Refresh Table After Edit
- [ ] **Task**: Refresh search result table after successful edit
  - **File**: `src/views/pages/search/widgets/SearchResultTable.vue`
  - **Description**: Reload table data after successful task update
  - **Dependencies**: None
  - **Priority**: Medium

### 9. Validation and Error Handling

#### 9.1 Input Validation
- [ ] **Task**: Add comprehensive input validation
  - **Description**: Validate all form inputs (keywords, num_pages, concurrency, etc.)
  - **Dependencies**: None
  - **Priority**: High

#### 9.2 Error Handling
- [ ] **Task**: Add error handling for API calls
  - **Description**: Handle network errors, validation errors, and server errors
  - **Dependencies**: None
  - **Priority**: Medium

#### 9.3 Permission Checks
- [ ] **Task**: Add permission checks for editing tasks
  - **Description**: Ensure only tasks in appropriate status can be edited
  - **Dependencies**: None
  - **Priority**: Medium

### 10. Testing

#### 10.1 Unit Tests
- [ ] **Task**: Add unit tests for new methods
  - **Description**: Test SearchController, SearchModule, and model update methods
  - **Dependencies**: None
  - **Priority**: Medium

#### 10.2 Integration Tests
- [ ] **Task**: Add integration tests for IPC handlers
  - **Description**: Test the complete flow from frontend to backend
  - **Dependencies**: None
  - **Priority**: Low

#### 10.3 UI Tests
- [ ] **Task**: Add UI tests for edit dialog
  - **Description**: Test form validation, save functionality, and error handling
  - **Dependencies**: None
  - **Priority**: Low

### 11. Documentation

#### 11.1 API Documentation
- [ ] **Task**: Document new API endpoints
  - **Description**: Update API documentation with new edit task endpoints
  - **Dependencies**: None
  - **Priority**: Low

#### 11.2 User Documentation
- [ ] **Task**: Create user guide for edit functionality
  - **Description**: Document how to use the edit search task feature
  - **Dependencies**: None
  - **Priority**: Low

## Implementation Order

### Phase 1: Backend Foundation (High Priority)
1. Update SearchTaskModel with update method
2. Add update method to SearchModule
3. Add update method to SearchController
4. Add IPC handler for edit task
5. Add channel constant

### Phase 2: Frontend Foundation (High Priority)
6. Create SearchTaskEditDialog component
7. Add edit icon to SearchResultTable
8. Add API functions for edit and get task details
9. Implement edit task function in SearchResultTable

### Phase 3: Integration and Polish (Medium Priority)
10. Add form validation and error handling
11. Add loading states and success/error messages
12. Refresh table after successful edit
13. Add comprehensive testing

### Phase 4: Documentation and Final Testing (Low Priority)
14. Add unit and integration tests
15. Update documentation
16. Final testing and bug fixes

## Dependencies Map

```
SearchTaskModel.update() 
    ↓
SearchModule.updateSearchTask()
    ↓
SearchController.updateSearchTask()
    ↓
IPC Handler (EDITSEARCHTASK)
    ↓
Frontend API function
    ↓
Edit Dialog Component
    ↓
SearchResultTable edit function
```

## Notes

- Only tasks in "Not Start" or "Error" status should be editable
- Keywords should be editable as a comma-separated string
- Search engine should be validated against available engines
- All numeric fields should have appropriate min/max validation
- The edit dialog should show current values and allow modification
- After successful edit, the table should refresh to show updated data
- Error messages should be user-friendly and specific 