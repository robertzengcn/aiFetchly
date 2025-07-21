# Schedule System Implementation Task List

## Overview
This document outlines the complete implementation plan for adding a scheduling system to the aiFetchly application. The system will allow users to schedule various types of tasks (search, email marketing, video download, etc.) to run automatically at specified intervals using cron expressions, with support for job dependencies where one job can trigger another job to run after completion.

## Phase 1: Database Schema and Entity Design ✅

### 1.1 Create Schedule Entity ✅
- **Status**: ✅ Completed
- **File**: `src/entity/ScheduleTask.entity.ts`
- **Description**: Created ScheduleTaskEntity with the following fields:
  - `id` (Primary Key)
  - `name` (Task name)
  - `description` (Task description)
  - `task_type` (TaskType enum as string)
  - `task_id` (Foreign key to existing task tables)
  - `cron_expression` (Cron expression for scheduling)
  - `is_active` (Boolean flag)
  - `last_run_time` (Last execution time)
  - `next_run_time` (Next scheduled execution time)
  - `status` (ScheduleStatus enum as string)
  - `execution_count` (Number of successful executions)
  - `failure_count` (Number of failed executions)
  - `last_error_message` (Last error message)
  - `last_modified` (Last modification time)
  - `trigger_type` (TriggerType enum as string: 'cron', 'dependency', 'manual')
  - `parent_schedule_id` (Foreign key to parent schedule, nullable)
  - `dependency_condition` (DependencyCondition enum as string: 'on_success', 'on_completion', 'on_failure')
  - `delay_minutes` (Delay in minutes after parent job completes, default: 0)
  - Inherits from AuditableEntity (created_at, updated_at)

### 1.2 Create Schedule Execution Log Entity
- **Status**: ⏳ Pending
- **File**: `src/entity/ScheduleExecutionLog.entity.ts`
- **Description**: Entity to track execution history with fields:
  - `id` (Primary Key)
  - `schedule_id` (Foreign key to ScheduleTaskEntity)
  - `parent_execution_id` (Foreign key to parent execution log, nullable)
  - `execution_time` (When execution started)
  - `status` (ExecutionStatus enum)
  - `result_message` (Execution result/error)
  - `execution_duration` (Execution time in milliseconds)
  - `task_output_id` (Reference to task output)
  - `triggered_by` (TriggerType: 'cron', 'dependency', 'manual')
  - `created_time` (Log creation time)

### 1.3 Create Schedule Dependency Entity
- **Status**: ⏳ Pending
- **File**: `src/entity/ScheduleDependency.entity.ts`
- **Description**: Entity to manage job dependencies with fields:
  - `id` (Primary Key)
  - `parent_schedule_id` (Foreign key to parent ScheduleTaskEntity)
  - `child_schedule_id` (Foreign key to child ScheduleTaskEntity)
  - `dependency_condition` (DependencyCondition enum as string)
  - `delay_minutes` (Delay in minutes after parent completes, default: 0)
  - `is_active` (Boolean flag)
  - `created_time` (Creation time)
  - `updated_time` (Last update time)

### 1.4 Create Database Migration Scripts
- **Status**: ⏳ Pending
- **File**: `src/sql/scraperdb/schedule_task.sql`
- **Description**: SQL script to create schedule_task table with dependency fields
- **File**: `src/sql/scraperdb/schedule_execution_log.sql`
- **Description**: SQL script to create schedule_execution_log table
- **File**: `src/sql/scraperdb/schedule_dependency.sql`
- **Description**: SQL script to create schedule_dependency table

## Phase 2: Model Layer Implementation

### 2.1 Create ScheduleTaskModel ✅
- **Status**: ✅ Completed
- **File**: `src/model/ScheduleTask.model.ts`
- **Description**: Model class extending BaseDb with methods:
  - `createSchedule(scheduleData: ScheduleCreateRequest): Promise<number>`
  - `updateSchedule(id: number, scheduleData: ScheduleUpdateRequest): Promise<void>`
  - `deleteSchedule(id: number): Promise<void>`
  - `getScheduleById(id: number): Promise<ScheduleTaskEntity | null>`
  - `listSchedules(page: number, size: number, sort?: SortBy): Promise<ScheduleTaskEntity[]>`
  - `getActiveSchedules(): Promise<ScheduleTaskEntity[]>`
  - `updateNextRunTime(id: number, nextRunTime: Date): Promise<void>`
  - `updateLastRunTime(id: number, lastRunTime: Date): Promise<void>`
  - `getSchedulesReadyToExecute(): Promise<ScheduleTaskEntity[]>`
  - `getChildSchedules(parentId: number): Promise<ScheduleTaskEntity[]>`
  - `getParentSchedule(childId: number): Promise<ScheduleTaskEntity | null>`
  - `getDependencyChain(scheduleId: number): Promise<ScheduleTaskEntity[]>`
  - `checkCircularDependencies(scheduleId: number): Promise<boolean>`

### 2.2 Create ScheduleExecutionLogModel ✅
- **Status**: ✅ Completed
- **File**: `src/model/ScheduleExecutionLog.model.ts`
- **Description**: Model class for execution logging with methods:
  - `logExecution(scheduleId: number, status: ExecutionStatus, message: string, duration: number, parentExecutionId?: number): Promise<number>`
  - `getExecutionHistory(scheduleId: number, page: number, size: number): Promise<ScheduleExecutionLogEntity[]>`
  - `getRecentExecutions(limit: number): Promise<ScheduleExecutionLogEntity[]>`
  - `getFailedExecutions(scheduleId: number, limit: number): Promise<ScheduleExecutionLogEntity[]>`
  - `getChildExecutions(parentExecutionId: number): Promise<ScheduleExecutionLogEntity[]>`
  - `getExecutionChain(executionId: number): Promise<ScheduleExecutionLogEntity[]>`

### 2.3 Create ScheduleDependencyModel ✅
- **Status**: ✅ Completed
- **File**: `src/model/ScheduleDependency.model.ts`
- **Description**: Model class for dependency management with methods:
  - `createDependency(parentId: number, childId: number, condition: DependencyCondition, delayMinutes?: number, notes?: string): Promise<number>`
  - `updateDependency(id: number, condition: DependencyCondition, delayMinutes: number, notes?: string): Promise<void>`
  - `deleteDependency(id: number): Promise<void>`
  - `deleteDependencyByParentChild(parentId: number, childId: number): Promise<void>`
  - `getDependenciesByParent(parentId: number): Promise<ScheduleDependencyEntity[]>`
  - `getDependenciesByChild(childId: number): Promise<ScheduleDependencyEntity[]>`
  - `getDependencyById(id: number): Promise<ScheduleDependencyEntity | null>`
  - `getDependencyByParentChild(parentId: number, childId: number): Promise<ScheduleDependencyEntity | null>`
  - `checkCircularDependency(parentId: number, childId: number): Promise<boolean>`
  - `getDependencyChain(startId: number): Promise<ScheduleDependencyEntity[]>`
  - `getDependentSchedules(scheduleId: number): Promise<number[]>`
  - `getParentSchedules(scheduleId: number): Promise<number[]>`
  - `enableDependency(id: number): Promise<void>`
  - `disableDependency(id: number): Promise<void>`
  - `getDependenciesByCondition(condition: DependencyCondition): Promise<ScheduleDependencyEntity[]>`
  - `getAllActiveDependencies(): Promise<ScheduleDependencyEntity[]>`
  - `getDependencyStatistics(): Promise<{total: number, active: number, inactive: number, byCondition: Record<string, number>}>`
  - `validateDependencies(scheduleId: number): Promise<{isValid: boolean, circularDependencies: number[], orphanedDependencies: number[], errors: string[]}>`
  - `cleanupInactiveDependencies(): Promise<number>`

## Phase 3: Service Layer Implementation

### 3.1 Create ScheduleManager ✅
- **Status**: ✅ Completed
- **File**: `src/modules/ScheduleManager.ts`
- **Description**: Core scheduling service with methods:
  - `initializeSchedules(): Promise<void>` - Initialize and load all active schedules
  - `addSchedule(schedule: ScheduleTaskEntity): Promise<void>` - Add new schedule to scheduler
  - `removeSchedule(scheduleId: number): Promise<void>` - Remove schedule from scheduler
  - `updateSchedule(schedule: ScheduleTaskEntity): Promise<void>` - Update existing schedule
  - `executeSchedule(scheduleId: number): Promise<void>` - Execute schedule immediately
  - `validateCronExpression(expression: string): boolean` - Validate cron expressions
  - `calculateNextRunTime(cronExpression: string): Date` - Calculate next execution time
  - `pauseSchedule(scheduleId: number): Promise<void>` - Pause a schedule
  - `resumeSchedule(scheduleId: number): Promise<void>` - Resume a schedule
  - `addDependency(parentId: number, childId: number, condition: DependencyCondition, delayMinutes?: number): Promise<void>` - Add job dependency
  - `removeDependency(parentId: number, childId: number): Promise<void>` - Remove job dependency
  - `executeDependentJobs(parentExecutionId: number, parentStatus: ExecutionStatus): Promise<void>` - Execute dependent jobs
  - `validateDependencyChain(scheduleId: number): Promise<boolean>` - Validate dependency chain
  - `getSchedulerStatus(): SchedulerStatus` - Get current scheduler status
  - `start(): Promise<void>` - Start the scheduler
  - `stop(): Promise<void>` - Stop the scheduler
  - `handleAppShutdown(): Promise<void>` - Handle application shutdown
  - `processDependencyQueue(): Promise<void>` - Process dependency-based schedules

### 3.2 Create TaskExecutorService ✅
- **Status**: ✅ Completed
- **File**: `src/modules/TaskExecutorService.ts`
- **Description**: Service to execute different types of tasks:
  - `executeScheduledTask(schedule: ScheduleTaskEntity, parentExecutionId?: number): Promise<number>` - Execute scheduled task based on type
  - `executeSearchTask(taskId: number): Promise<number>` - Execute search task
  - `executeEmailMarketingTask(taskId: number): Promise<number>` - Execute email marketing task
  - `executeBuckEmailTask(taskId: number): Promise<number>` - Execute bulk email task
  - `executeVideoDownloadTask(taskId: number): Promise<number>` - Execute video download task
  <!-- - `executeSocialTask(taskId: number): Promise<number>` - Execute social task -->
  - `getTaskStatus(taskId: number, taskType: TaskType): Promise<TaskStatus>` - Get task status
  - `cancelTask(taskId: number, taskType: TaskType): Promise<void>` - Cancel running task
  - `executeDependencyChain(scheduleId: number, parentExecutionId?: number): Promise<void>` - Execute dependency chain
  - `getTaskExecutionStatistics(taskType?: TaskType): Promise<{total: number, running: number, completed: number, failed: number, cancelled: number, averageExecutionTime: number}>` - Get execution statistics
  - `validateTaskConfiguration(taskId: number, taskType: TaskType): Promise<{isValid: boolean, errors: string[], warnings: string[]}>` - Validate task configuration

### 3.3 Create BackgroundScheduler ✅
- **Status**: ✅ Completed
- **File**: `src/modules/BackgroundScheduler.ts`
- **Description**: Background service that runs continuously with comprehensive scheduling functionality:
  - `initialize(): Promise<void>`
  - `start(): Promise<void>`
  - `stop(): Promise<void>`
  - `reloadSchedules(): Promise<void>`
  - `getSchedulerStatus(): SchedulerStatus`
  - `handleAppShutdown(): Promise<void>`
  - `processDependencyQueue(): Promise<void>`
  - `handleJobCompletion(executionId: number, status: ExecutionStatus): Promise<void>`
  - `processScheduledTasks(): Promise<void>` - Process cron-based schedules
  - `processExecutionQueue(): Promise<void>` - Manage execution queue
  - `executeScheduleWithRetry(queueItem: ExecutionQueueItem): Promise<void>` - Execute with retry logic
  - `performCleanup(): Promise<void>` - Periodic cleanup tasks
  - `triggerSchedule(scheduleId: number): Promise<void>` - Manually trigger execution
  - `getDetailedStats(): object` - Get detailed scheduler statistics

## Phase 4: Controller Layer Implementation

### 4.1 Create ScheduleController ✅
- **Status**: ✅ Completed
- **File**: `src/controller/ScheduleController.ts`
- **Description**: Controller for handling schedule-related requests with comprehensive functionality:
  - `createSchedule(scheduleData: ScheduleCreateRequest): Promise<number>` - Create new schedule with validation
  - `updateSchedule(id: number, scheduleData: ScheduleUpdateRequest): Promise<void>` - Update existing schedule
  - `deleteSchedule(id: number): Promise<void>` - Delete schedule and clean up dependencies
  - `enableSchedule(id: number): Promise<void>` - Enable a schedule
  - `disableSchedule(id: number): Promise<void>` - Disable a schedule
  - `pauseSchedule(id: number): Promise<void>` - Pause a schedule
  - `resumeSchedule(id: number): Promise<void>` - Resume a schedule
  - `runScheduleNow(id: number): Promise<void>` - Execute schedule immediately
  - `getScheduleList(page: number, size: number, sort?: SortBy): Promise<ScheduleListResponse>` - Get paginated schedule list
  - `getScheduleById(id: number): Promise<ScheduleDetailResponse>` - Get schedule details with execution history and dependencies
  - `getExecutionHistory(scheduleId: number, page: number, size: number): Promise<ExecutionHistoryResponse>` - Get execution history
  - `addDependency(parentId: number, childId: number, dependencyData: DependencyCreateRequest): Promise<number>` - Add job dependency
  - `removeDependency(parentId: number, childId: number): Promise<void>` - Remove job dependency
  - `getDependencyGraph(scheduleId: number): Promise<DependencyGraphResponse>` - Get visual dependency graph
  - `validateDependencies(scheduleId: number): Promise<DependencyValidationResponse>` - Validate dependency chain
  - `getSchedulerStatus(): SchedulerStatus` - Get current scheduler status
  - `startScheduler(): Promise<void>` - Start the scheduler
  - `stopScheduler(): Promise<void>` - Stop the scheduler
  - `getSchedulesByTaskType(taskType: TaskType): Promise<ScheduleTaskEntity[]>` - Get schedules by task type
  - `getRecentExecutions(limit: number): Promise<any[]>` - Get recent executions across all schedules
  - `getExecutionStatistics(scheduleId: number): Promise<any>` - Get execution statistics

## Phase 5: Type Definitions

### 5.1 Create Schedule Types
- **Status**: ✅ Completed
- **File**: `src/entityTypes/schedule-type.ts`
- **Description**: TypeScript type definitions:
  - `ScheduleCreateRequest` - Request interface for creating new schedules
  - `ScheduleUpdateRequest` - Request interface for updating existing schedules
  - `ScheduleListResponse` - Response interface for paginated schedule lists
  - `ScheduleDetailResponse` - Response interface for detailed schedule information
  - `ExecutionHistoryResponse` - Response interface for execution history
  - `DependencyCreateRequest` - Request interface for creating dependencies
  - `DependencyGraphResponse` - Response interface for dependency graph visualization
  - `DependencyValidationResponse` - Response interface for dependency validation
  - `SchedulerStatusInfo` - Interface for scheduler status information
  - `SchedulerStatusResponse` - Response interface for scheduler status
  - `ExecutionQueueItem` - Interface for execution queue items
  - `DetailedStats` - Interface for detailed scheduler statistics
  - `TaskExecutionRequest` - Interface for task execution requests
  - `TaskExecutionResult` - Interface for task execution results
  - `DependencyStatistics` - Interface for dependency statistics
  - `DependencyValidationResult` - Interface for dependency validation results
  - `ScheduleFilterOptions` - Interface for schedule filtering options
  - `ScheduleSearchRequest` - Interface for schedule search requests
  - `ExecutionStatistics` - Interface for execution statistics
  - `CronValidationResult` - Interface for cron expression validation
  - `ScheduleExportData` - Interface for schedule export data
  - `ScheduleImportRequest` - Interface for schedule import requests
  - `ScheduleImportResult` - Interface for schedule import results
  - `ExecutionPriority` enum - Priority levels for execution queue
  - `RetryStrategy` enum - Retry strategies for failed executions
  - `NotificationType` enum - Types of notifications
  - `SchedulerStatus` enum - Scheduler status values
  - Exported enums from entities: `TaskType`, `ScheduleStatus`, `TriggerType`, `DependencyCondition`, `ExecutionStatus`

## Phase 6: Frontend Implementation ✅

### 6.1 Create Schedule API Integration ✅
- **Status**: ✅ Completed
- **File**: `src/views/api/schedule.ts`
- **Description**: Comprehensive API integration with all necessary functions:
  - Schedule management functions (CRUD operations)
  - Execution management functions
  - Dependency management functions
  - Scheduler control functions
  - Utility functions for cron validation
  - Real-time message sending capabilities

### 6.2 Create Schedule List Page ✅
- **Status**: ✅ Completed
- **File**: `src/views/pages/schedule/list.vue`
- **Description**: Modern schedule list page with:
  - Data table with pagination and sorting
  - Advanced filtering and search functionality
  - Real-time scheduler status display
  - Action buttons (create, edit, delete, enable/disable, run now)
  - Import/export functionality
  - Responsive design and user-friendly interactions

### 6.3 Create Schedule Form Component ✅
- **Status**: ✅ Completed
- **File**: `src/views/pages/schedule/widgets/ScheduleForm.vue`
- **Description**: Sophisticated form component with:
  - Comprehensive form validation
  - Visual cron expression builder integration
  - Dependency configuration interface
  - Task type selection with proper validation
  - Support for create and edit modes
  - Real-time validation and user guidance

### 6.4 Create Schedule Table Component ✅
- **Status**: ✅ Completed
- **File**: `src/views/pages/schedule/widgets/ScheduleTable.vue`
- **Description**: Feature-rich data table component with:
  - Comprehensive schedule information display
  - Status indicators with proper colors and icons
  - Action menus for schedule management
  - Sorting functionality
  - Loading states and empty states
  - Time formatting and relative time display

### 6.5 Create Schedule Detail Page ✅
- **Status**: ✅ Completed
- **File**: `src/views/pages/schedule/detail.vue`
- **Description**: Detailed schedule view page with:
  - Comprehensive schedule information display
  - Execution history with detailed information
  - Dependency visualization and management
  - Quick action buttons for common operations
  - Execution statistics and success rates
  - Responsive layout and error handling

### 6.6 Create Supporting Components ✅
- **Status**: ✅ Completed
- **Files**: 
  - `src/views/pages/schedule/widgets/ScheduleStatusBadge.vue`
  - `src/views/pages/schedule/widgets/ExecutionStatusBadge.vue`
  - `src/views/pages/schedule/widgets/CronExpressionBuilder.vue`
  - `src/views/pages/schedule/widgets/ExecutionHistoryTable.vue`
- **Description**: Complete set of supporting components:
  - Status badges with proper colors and icons
  - Visual cron expression builder with presets and custom options
  - Execution history table with detailed information display
  - All components with proper TypeScript types and responsive design

### 6.7 Update Router Configuration ✅
- **Status**: ✅ Completed
- **File**: `src/views/router/index.ts`
- **Description**: Comprehensive routing configuration:
  - Added schedule routes for list, create, edit, and detail views
  - Properly configured navigation menu
  - Meta information for breadcrumbs and permissions
  - Route guards and proper component loading

### 6.8 Create Create/Edit Pages ✅
- **Status**: ✅ Completed
- **Files**: 
  - `src/views/pages/schedule/create.vue`
  - `src/views/pages/schedule/edit.vue`
- **Description**: Dedicated pages for schedule management:
  - Form handling and validation
  - Loading states and error handling
  - Navigation and user feedback
  - Success/error handling with proper user guidance