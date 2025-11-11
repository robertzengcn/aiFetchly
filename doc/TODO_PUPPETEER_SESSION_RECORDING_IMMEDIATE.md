# TODO: Immediate Implementation - Puppeteer Session Recording

## Quick Start Implementation (Next 2-3 Days)

### Day 1: Core Session Recording Manager

#### 1.1 Create Basic Session Recording Manager
- [ ] **Create `src/modules/SessionRecordingManager.ts`**
  ```typescript
  export class SessionRecordingManager {
    private isRecording: boolean = false;
    private currentSession: SessionRecord | null = null;
    private trainingData: TrainingDataPoint[] = [];
    
    startSession(taskId: number, platform: string, keywords: string[], location: string): void
    logAction(state: string, action: string): void
    capturePageState(page: Page): Promise<string>
    endSession(resultsCount: number, expectedOutput: any[]): Promise<boolean>
    saveSession(): Promise<void>
  }
  ```

#### 1.2 Define Basic Types
- [ ] **Create `src/entityTypes/sessionRecording-type.ts`**
  ```typescript
  export interface SessionRecord {
    taskId: number;
    platform: string;
    keywords: string[];
    location: string;
    resultsCount: number;
    timestamp: Date;
    trainingData: TrainingDataPoint[];
    expectedOutput: any[];
    sessionFilePath: string;
  }
  
  export interface TrainingDataPoint {
    state: string; // DOM snapshot or simplified representation
    action: string; // Puppeteer action (e.g., "click('#search-submit')")
  }
  ```

### Day 2: Integration with Yellow Pages Scraper

#### 2.1 Modify YellowPagesScraperProcess
- [ ] **Update `src/childprocess/yellowPagesScraper.ts`**
  - [ ] Import SessionRecordingManager
  - [ ] Add recording manager instance
  - [ ] Start session recording when scraping begins
  - [ ] Log key actions (goto, type, click, evaluate)
  - [ ] End session recording when scraping completes

#### 2.2 Add Action Logging Wrappers
- [ ] **Wrap key Puppeteer operations**
  ```typescript
  // Before each action
  if (this.sessionManager.isRecording) {
    const currentState = await this.capturePageState();
    this.sessionManager.logAction(currentState, action);
  }
  
  // Execute action
  await this.executeAction(action, selector, value);
  
  // Note: We only capture state before action for AI training
  // The AI learns: "Given this DOM state, perform this action"
  ```

#### 2.3 Implement Result Validation
- [ ] **Add results validation logic**
  ```typescript
  private async validateAndSaveSession(results: ScrapingResult[]): Promise<void> {
    if (results.length > 1 && this.sessionManager.isRecording) {
      await this.sessionManager.endSession(results.length, results);
      await this.sessionManager.saveSession();
      console.log(`Session recorded with ${results.length} results for AI training`);
    }
  }
  ```

### Day 3: Basic Electron Menu Integration

#### 3.1 Create Simple Menu Manager
- [ ] **Create `src/main-process/menu/MenuManager.ts`**
  ```typescript
  export class MenuManager {
    private isRecordingEnabled: boolean = false;
    
    createMenu(): Menu {
      const template = [
        {
          label: 'Session Recording',
          submenu: [
            {
              label: 'Enable Recording',
              type: 'checkbox',
              checked: this.isRecordingEnabled,
              click: () => this.toggleRecording()
            },
            { type: 'separator' },
            {
              label: 'View Sessions',
              click: () => this.openSessionsFolder()
            }
          ]
        }
      ];
      return Menu.buildFromTemplate(template);
    }
    
    toggleRecording(): void
    openSessionsFolder(): void
  }
  ```

#### 3.2 Integrate with Main Process
- [ ] **Update `src/background.ts`**
  - [ ] Import MenuManager
  - [ ] Create menu instance
  - [ ] Set application menu
  - [ ] Store recording preference

#### 3.3 Add IPC Handler for Recording Toggle
- [ ] **Create basic IPC handler**
  ```typescript
  // In sessionRecording-ipc.ts
  ipcMain.handle('session-recording:toggle', (event, enabled: boolean) => {
    // Update global recording state
    // Persist to user settings
    // Return success status
  });
  
  ipcMain.handle('session-recording:get-status', () => {
    // Return current recording status
  });
  ```

## File Structure to Create

```
src/
├── modules/
│   └── SessionRecordingManager.ts          # Core recording logic
├── entityTypes/
│   └── sessionRecording-type.ts            # Type definitions
├── main-process/
│   └── menu/
│       └── MenuManager.ts                  # Menu management
└── main-process/communication/
    └── sessionRecording-ipc.ts            # IPC handlers
```

## Session File Format (AI Training Optimized)

```json
{
  "platform": "yellowpages.com",
  "taskId": 123,
  "keywords": ["restaurants"],
  "location": "New York, NY",
  "resultsCount": 15,
  "timestamp": "2024-01-15T10:30:00Z",
  "trainingData": [
    {
      "state": "<DOM snapshot or simplified representation>",
      "action": "goto('https://www.yellowpages.com/')"
    },
    {
      "state": "<DOM snapshot after page load>",
      "action": "type('#search-term', 'restaurants')"
    },
    {
      "state": "<DOM snapshot with filled form>",
      "action": "click('#search-submit')"
    },
    {
      "state": "<DOM snapshot of search results>",
      "action": "extract('.result')"
    }
  ],
  "expectedOutput": [
    {
      "business_name": "Example Restaurant",
      "phone": "(555) 123-4567",
      "address": "123 Main St, New York, NY"
    }
  ]
}
```

## Key Integration Points

### 1. YellowPagesScraperProcess Integration
- Start recording when `start()` method is called
- Log actions in `navigateToSearchPage()`, `extractBusinessData()`, etc.
- End recording when `scrapeTask()` completes
- Only save if results > 1

### 2. Menu Integration
- Add "Session Recording" menu item
- Toggle recording on/off
- Open sessions folder
- Show current recording status

### 3. File Storage
- Save sessions to `{userData}/sessions/` directory
- Create subdirectories by platform and date
- Use simple JSON format for now
- Add basic compression later

## Testing Checklist

- [ ] Session recording starts when scraping begins
- [ ] Actions are logged during scraping
- [ ] Session is saved when results > 1
- [ ] Session is not saved when results <= 1
- [ ] Menu toggle works correctly
- [ ] Sessions are saved to correct location
- [ ] Session files contain correct data structure

## Next Steps After Core Implementation

1. **Add session compression** to reduce file sizes
2. **Create session management UI** for viewing/exporting sessions
3. **Add session quality metrics** and filtering
4. **Implement training dataset export** functionality
5. **Add session replay** for debugging
6. **Create advanced recording filters** and controls

## Performance Considerations

- **Minimal impact**: Session recording should add < 100ms per action
- **Memory efficient**: Don't keep entire page HTML in memory
- **Disk efficient**: Compress session files and implement cleanup
- **Async operations**: Don't block scraping for session operations

## Error Handling

- **Graceful degradation**: If recording fails, scraping continues
- **Log errors**: Record recording failures for debugging
- **Fallback behavior**: Continue without recording if manager fails
- **User notification**: Show recording status in UI

This immediate implementation provides the core functionality needed to start recording Puppeteer sessions for AI training, with a clear path for future enhancements.
