# ScheduleManager Singleton Pattern Implementation TODO

## Overview
This document outlines the implementation plan for converting the ScheduleManager to use the Singleton Pattern and adding database persistence for the scheduler running status. This will ensure that the scheduler automatically starts when the application launches if it was previously running.

## Current State Analysis
- **ScheduleManager**: Currently instantiated multiple times in different controllers
- **Running Status**: Only stored in memory, lost on application restart
- **Start/Stop**: Manual user interaction required each time

## Phase 1: Database Schema Updates

### 1.1 Create Scheduler Status Entity
**Priority**: High  
**Status**: ⏳ Pending  
**File**: `src/entity/SchedulerStatus.entity.ts`

```typescript
@Entity("scheduler_status")
export class SchedulerStatusEntity extends AuditableEntity {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column("boolean", { default: false })
    is_running: boolean;
    
    @Column("integer", { default: 0 })
    active_schedules: number;
    
    @Column("integer", { default: 0 })
    total_schedules: number;
    
    @Column("datetime", { nullable: true })
    last_check_time: Date;
    
    @Column("datetime", { nullable: true })
    next_check_time: Date;
    
    @Column("text", { nullable: true })
    last_error_message: string;
    
    @Column("datetime", { nullable: true })
    last_start_time: Date;
    
    @Column("datetime", { nullable: true })
    last_stop_time: Date;
}
```

### 1.2 Update Database Configuration
**Priority**: High  
**Status**: ⏳ Pending  
**File**: `src/config/SqliteDb.ts`

- Add `SchedulerStatusEntity` to the entities array
- Ensure proper migration handling

## Phase 2: Singleton Pattern Implementation

### 2.1 Create Scheduler Status Model
**Priority**: High  
**Status**: ⏳ Pending  
**File**: `src/model/SchedulerStatus.model.ts`

```typescript
export class SchedulerStatusModel extends BaseDb {
    private repository: Repository<SchedulerStatusEntity>;
    
    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(SchedulerStatusEntity);
    }
    
    async getStatus(): Promise<SchedulerStatusEntity | null>;
    async updateStatus(status: Partial<SchedulerStatusEntity>): Promise<void>;
    async initializeStatus(): Promise<void>;
    async resetStatus(): Promise<void>;
}
```

### 2.2 Convert ScheduleManager to Singleton
**Priority**: High  
**Status**: ⏳ Pending  
**File**: `src/modules/ScheduleManager.ts`

**Changes Required**:
1. Add private static instance
2. Make constructor private
3. Add static getInstance() method
4. Add database status persistence
5. Add auto-start functionality

```typescript
export class ScheduleManager {
    private static instance: ScheduleManager;
    private schedulerStatusModel: SchedulerStatusModel;
    
    private constructor() {
        // Initialize with database status
        this.schedulerStatusModel = new SchedulerStatusModel(this.dbpath);
    }
    
    public static getInstance(): ScheduleManager {
        if (!ScheduleManager.instance) {
            ScheduleManager.instance = new ScheduleManager();
        }
        return ScheduleManager.instance;
    }
    
    async initializeWithDatabaseStatus(): Promise<void>;
    async persistStatus(): Promise<void>;
}
```

### 2.3 Update All ScheduleManager Instantiations
**Priority**: High  
**Status**: ⏳ Pending  
**Files to Update**:
- `src/controller/ScheduleController.ts`
- `src/modules/BackgroundScheduler.ts`
- Any other files using `new ScheduleManager()`

**Change**: Replace `new ScheduleManager()` with `ScheduleManager.getInstance()`

## Phase 3: Auto-Start Implementation

### 3.1 Add Application Startup Integration
**Priority**: High  
**Status**: ⏳ Pending  
**File**: `src/background.ts`

**Changes Required**:
1. Import ScheduleManager
2. Add startup check for scheduler status
3. Auto-start scheduler if it was previously running

```typescript
// In app.whenReady() callback
const scheduleManager = ScheduleManager.getInstance();
await scheduleManager.initializeWithDatabaseStatus();
```

### 3.2 Add Status Persistence Methods
**Priority**: High  
**Status**: ⏳ Pending  
**File**: `src/modules/ScheduleManager.ts`

**New Methods**:
- `async persistRunningStatus(): Promise<void>`
- `async persistStoppedStatus(): Promise<void>`
- `async loadStatusFromDatabase(): Promise<void>`
- `async shouldAutoStart(): Promise<boolean>`

## Phase 4: Enhanced Status Management

### 4.1 Update Start/Stop Methods
**Priority**: Medium  
**Status**: ⏳ Pending  
**File**: `src/modules/ScheduleManager.ts`

**Changes Required**:
1. Update `start()` method to persist status
2. Update `stop()` method to persist status
3. Add error handling for database operations

### 4.2 Add Status Recovery Methods
**Priority**: Medium  
**Status**: ⏳ Pending  
**File**: `src/modules/ScheduleManager.ts`

**New Methods**:
- `async recoverFromDatabase(): Promise<void>`
- `async validateDatabaseStatus(): Promise<boolean>`
- `async resetDatabaseStatus(): Promise<void>`

## Phase 5: API and UI Updates

### 5.1 Update Scheduler Status API
**Priority**: Medium  
**Status**: ⏳ Pending  
**File**: `src/views/api/schedule.ts`

**Changes Required**:
1. Update `getSchedulerStatus()` to read from database
2. Add new API methods for status management
3. Update response types to include database status

### 5.2 Update Frontend Status Display
**Priority**: Low  
**Status**: ⏳ Pending  
**File**: `src/views/pages/schedule/list.vue`

**Changes Required**:
1. Add database status indicators
2. Show last start/stop times
3. Add status recovery options

## Phase 6: Error Handling and Recovery

### 6.1 Add Database Error Handling
**Priority**: Medium  
**Status**: ⏳ Pending  
**File**: `src/modules/ScheduleManager.ts`

**Features**:
- Graceful fallback if database is unavailable
- Status recovery mechanisms
- Error logging and reporting

### 6.2 Add Status Validation
**Priority**: Medium  
**Status**: ⏳ Pending  
**File**: `src/modules/ScheduleManager.ts`

**Features**:
- Validate database status consistency
- Auto-repair corrupted status
- Status synchronization between memory and database

## Phase 7: Testing and Validation

### 7.1 Unit Tests
**Priority**: Medium  
**Status**: ⏳ Pending  
**Files**: `test/modules/ScheduleManager.test.ts`

**Test Cases**:
- Singleton pattern implementation
- Database status persistence
- Auto-start functionality
- Error handling scenarios

### 7.2 Integration Tests
**Priority**: Medium  
**Status**: ⏳ Pending  
**Files**: `test/integration/scheduler-integration.test.ts`

**Test Cases**:
- Application startup with scheduler
- Status persistence across restarts
- Error recovery scenarios

## Phase 8: Documentation and Migration

### 8.1 Update Documentation
**Priority**: Low  
**Status**: ⏳ Pending  
**Files**: 
- `doc/schedule-system-task-list.md`
- `README.md`

**Updates**:
- Document singleton pattern usage
- Update architecture diagrams
- Add migration guide

### 8.2 Migration Script
**Priority**: Low  
**Status**: ⏳ Pending  
**File**: `src/scripts/migrate-scheduler-status.ts`

**Features**:
- Create initial scheduler status record
- Migrate existing status data
- Validate migration results

## Implementation Priority Order

1. **Phase 1**: Database Schema Updates (Critical)
2. **Phase 2**: Singleton Pattern Implementation (Critical)
3. **Phase 3**: Auto-Start Implementation (Critical)
4. **Phase 4**: Enhanced Status Management (Important)
5. **Phase 5**: API and UI Updates (Important)
6. **Phase 6**: Error Handling and Recovery (Important)
7. **Phase 7**: Testing and Validation (Important)
8. **Phase 8**: Documentation and Migration (Nice to have)

## Success Criteria

- [ ] ScheduleManager uses Singleton pattern
- [ ] Scheduler status persists in database
- [ ] Application auto-starts scheduler if previously running
- [ ] All existing functionality remains intact
- [ ] Proper error handling and recovery
- [ ] Comprehensive test coverage
- [ ] Documentation updated

## Risk Mitigation

1. **Database Connection Issues**: Implement fallback to memory-only mode
2. **Migration Failures**: Provide rollback mechanisms
3. **Performance Impact**: Monitor database query performance
4. **Concurrency Issues**: Implement proper locking mechanisms

## Estimated Timeline

- **Phase 1-3**: 2-3 days (Critical functionality)
- **Phase 4-6**: 2-3 days (Enhancement and robustness)
- **Phase 7-8**: 1-2 days (Testing and documentation)
- **Total**: 5-8 days

## Notes

- Ensure backward compatibility with existing schedule data
- Consider adding configuration options for auto-start behavior
- Implement proper logging for debugging and monitoring
- Consider adding metrics collection for scheduler performance 