# TODO: Puppeteer Session Recording for AI Training

## Overview
Implement Puppeteer session recording functionality to capture successful scraping sessions for AI model training. Sessions will only be saved when results > 1 are obtained, and recording can be controlled via Electron application menu.

## Phase 1: Core Session Recording Infrastructure

### 1.1 Create Session Recording Manager
- [ ] **Create `src/modules/SessionRecordingManager.ts`**
  - [ ] Implement session logging with state capture
  - [ ] Add result validation (only save when results > 1)
  - [ ] Create session metadata structure
  - [ ] Implement file-based storage system
  - [ ] Add session compression and cleanup

### 1.2 Define Session Data Structures
- [ ] **Create `src/entityTypes/sessionRecording-type.ts`**
  - [ ] Define `SessionRecord` interface
  - [ ] Define `ScrapingAction` interface
  - [ ] Define `SessionMetadata` interface
  - [ ] Define `TrainingDataset` interface

### 1.3 Create Session Storage Entity
- [ ] **Create `src/entity/SessionRecording.entity.ts`**
  - [ ] Database entity for session metadata
  - [ ] Fields: id, task_id, platform, keywords, location, results_count, session_file_path, created_at, status
  - [ ] Extend AuditableEntity

### 1.4 Update Database Configuration
- [ ] **Update `src/config/SqliteDb.ts`**
  - [ ] Add SessionRecordingEntity to entities array
  - [ ] Create migration script for new table

## Phase 2: Integration with Yellow Pages Scraper

### 2.1 Modify YellowPagesScraperProcess
- [ ] **Update `src/childprocess/yellowPagesScraper.ts`**
  - [ ] Import SessionRecordingManager
  - [ ] Add session recording state tracking
  - [ ] Wrap Puppeteer commands with logging
  - [ ] Capture page state before/after each action
  - [ ] Record successful data extraction
  - [ ] Add session recording toggle check

### 2.2 Implement Action Logging Wrapper
- [ ] **Create action logging functions in scraper**
  - [ ] `logAction(state, action, metadata)` function
  - [ ] `capturePageState()` function
  - [ ] `recordScrapingAction()` function
  - [ ] `validateAndSaveSession()` function

### 2.3 Add Session Recording to Key Operations
- [ ] **Wrap key scraping operations**
  - [ ] Page navigation (`goto`, `waitForNavigation`)
  - [ ] Form interactions (`type`, `click`, `select`)
  - [ ] Data extraction (`evaluate`, `querySelector`)
  - [ ] Pagination handling
  - [ ] Error handling and recovery

## Phase 3: Electron Application Menu Integration

### 3.1 Create Menu Manager
- [ ] **Create `src/main-process/menu/MenuManager.ts`**
  - [ ] Implement application menu creation
  - [ ] Add session recording toggle menu item
  - [ ] Add session management submenu
  - [ ] Integrate with existing menu structure

### 3.2 Add Menu Items
- [ ] **Add to main application menu**
  - [ ] "Session Recording" menu item with toggle
  - [ ] "Session Management" submenu
    - [ ] "View Recorded Sessions"
    - [ ] "Export Training Dataset"
    - [ ] "Clear Old Sessions"
    - [ ] "Session Recording Settings"

### 3.3 Implement Menu Event Handlers
- [ ] **Create menu event handlers**
  - [ ] Toggle session recording on/off
  - [ ] Open session management dialog
  - [ ] Export sessions for AI training
  - [ ] Configure recording settings

## Phase 4: Session Storage and Management

### 4.1 Implement File Storage System
- [ ] **Create session file structure**
  - [ ] `sessions/` directory in user data path
  - [ ] `sessions/{platform}/{date}/` subdirectories
  - [ ] Session files: `{taskId}_{timestamp}_session.json`
  - [ ] Metadata files: `{taskId}_{timestamp}_meta.json`

### 4.2 Create Session File Format
- [ ] **Define session file structure**
  ```json
  {
    "metadata": {
      "taskId": 123,
      "platform": "yellowpages.com",
      "keywords": ["restaurants"],
      "location": "New York, NY",
      "resultsCount": 15,
      "timestamp": "2024-01-15T10:30:00Z"
    },
    "actions": [
      {
        "step": 1,
        "action": "goto",
        "url": "https://www.yellowpages.com/",
        "state": "page_content_before",
        "timestamp": "2024-01-15T10:30:01Z"
      },
      {
        "step": 2,
        "action": "type",
        "selector": "#search-term",
        "value": "restaurants",
        "state": "page_content_after",
        "timestamp": "2024-01-15T10:30:02Z"
      }
    ],
    "results": [
      {
        "business_name": "Example Restaurant",
        "phone": "(555) 123-4567",
        "address": "123 Main St, New York, NY"
      }
    ]
  }
  ```

### 4.3 Add Session Compression
- [ ] **Implement session compression**
  - [ ] Compress HTML content (remove unnecessary whitespace)
  - [ ] Compress images and binary data
  - [ ] Use gzip compression for large sessions
  - [ ] Implement cleanup for old sessions

## Phase 5: Session Recording Controls

### 5.1 Add Global Recording Toggle
- [ ] **Create global recording state**
  - [ ] Store recording preference in user settings
  - [ ] Persist across application restarts
  - [ ] Add to system settings database

### 5.2 Implement Recording Filters
- [ ] **Add recording criteria**
  - [ ] Minimum results threshold (default: > 1)
  - [ ] Platform-specific recording rules
  - [ ] Keyword-based recording filters
  - [ ] Success rate thresholds

### 5.3 Add Recording Quality Controls
- [ ] **Implement quality metrics**
  - [ ] Data extraction success rate
  - [ ] Page load success rate
  - [ ] Error frequency tracking
  - [ ] Session duration limits

## Phase 6: Session Management UI

### 6.1 Create Session Management Dialog
- [ ] **Create `src/views/components/SessionManagementDialog.vue`**
  - [ ] List all recorded sessions
  - [ ] Show session metadata and statistics
  - [ ] Provide export functionality
  - [ ] Allow session deletion and cleanup

### 6.2 Add Session Statistics
- [ ] **Implement session analytics**
  - [ ] Total sessions recorded
  - [ ] Success rate by platform
  - [ ] Average results per session
  - [ ] Session duration statistics

### 6.3 Create Export Functionality
- [ ] **Implement training dataset export**
  - [ ] Export to JSON format for AI training
  - [ ] Export to CSV for analysis
  - [ ] Export specific session ranges
  - [ ] Export by platform or keyword

## Phase 7: Integration with Existing IPC System

### 7.1 Add Session Recording IPC Handlers
- [ ] **Create `src/main-process/communication/sessionRecording-ipc.ts`**
  - [ ] `session-recording:toggle` - Enable/disable recording
  - [ ] `session-recording:get-status` - Get current recording status
  - [ ] `session-recording:get-sessions` - List recorded sessions
  - [ ] `session-recording:export` - Export sessions for training
  - [ ] `session-recording:clear` - Clear old sessions

### 7.2 Update Communication Index
- [ ] **Update `src/main-process/communication/index.ts`**
  - [ ] Import and register session recording IPC handlers
  - [ ] Add to main communication registration

### 7.3 Add Frontend API Functions
- [ ] **Update `src/views/api/sessionRecording.ts`**
  - [ ] Create API functions for session management
  - [ ] Integrate with existing IPC system
  - [ ] Add error handling and validation

## Phase 8: Advanced Session Recording Features

### 8.1 Add Intelligent Recording
- [ ] **Implement smart recording logic**
  - [ ] Only record successful scraping patterns
  - [ ] Skip recording for failed or error-prone sessions
  - [ ] Record recovery actions for failed sessions
  - [ ] Track session success patterns

### 8.2 Add Session Annotations
- [ ] **Implement session annotation system**
  - [ ] Mark sessions as "good training data"
  - [ ] Add notes about session quality
  - [ ] Tag sessions by difficulty level
  - [ ] Annotate successful strategies

### 8.3 Add Session Replay
- [ ] **Create session replay functionality**
  - [ ] Replay recorded sessions for debugging
  - [ ] Step-through session actions
  - [ ] Compare expected vs actual results
  - [ ] Validate session accuracy

## Phase 9: AI Training Integration

### 9.1 Create Training Dataset Generator
- [ ] **Create `src/modules/TrainingDatasetGenerator.ts`**
  - [ ] Convert sessions to training examples
  - [ ] Generate input-output pairs for AI training
  - [ ] Create platform-specific training data
  - [ ] Validate training data quality

### 9.2 Implement Data Formatting
- [ ] **Create training data formats**
  - [ ] HTML + Expected Output pairs
  - [ ] Action sequence + Result pairs
  - [ ] Error recovery pattern pairs
  - [ ] Platform-specific training examples

### 9.3 Add Training Data Export
- [ ] **Implement export formats**
  - [ ] OpenAI fine-tuning format
  - [ ] Hugging Face dataset format
  - [ ] Custom JSON training format
  - [ ] CSV for manual review


## Phase 10: Documentation and Deployment

### 10.1 Create User Documentation
- [ ] **Write user guides**
  - [ ] Session recording setup guide
  - [ ] Session management user manual
  - [ ] Training data export guide
  - [ ] Troubleshooting guide

### 10.2 Create Developer Documentation
- [ ] **Write technical documentation**
  - [ ] API reference for session recording
  - [ ] Integration guide for developers
  - [ ] Architecture overview
  - [ ] Contributing guidelines

### 10.3 Prepare for Production
- [ ] **Production deployment**
  - [ ] Test with production data volumes
  - [ ] Optimize for production performance
  - [ ] Add monitoring and alerting
  - [ ] Create backup and recovery procedures

## Implementation Priority

### High Priority (Phase 1-3)
- Core session recording infrastructure
- Integration with Yellow Pages scraper
- Basic Electron menu integration

### Medium Priority (Phase 4-7)
- Session storage and management
- Recording controls and filters
- IPC integration and UI components

### Low Priority (Phase 8-10)
- Advanced features and optimization
- AI training integration
- documentation


## Dependencies

- Existing Yellow Pages scraper infrastructure
- Electron application framework
- SQLite database system
- Vue.js frontend components
- IPC communication system

## Success Criteria

- [ ] Session recording can be toggled via application menu
- [ ] Sessions are only saved when results > 1 are obtained
- [ ] Session files are properly structured and compressed
- [ ] Session management UI is functional and user-friendly
- [ ] Training data can be exported in multiple formats
- [ ] Performance impact is minimal (< 5% scraping speed reduction)
- [ ] Session recording is stable and error-free
- [ ] Documentation is complete and accurate
