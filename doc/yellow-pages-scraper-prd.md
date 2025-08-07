# Yellow Pages Scraper System - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview
The Yellow Pages Scraper System is a comprehensive web scraping solution designed to extract business information from various yellow pages platforms worldwide. The system will integrate seamlessly with the existing aiFetchly application architecture, leveraging the established module system, browser management, and scheduling capabilities.

### 1.2 Objectives
- Extract comprehensive business information from multiple yellow pages platforms
- Support multiple platforms: yellowpages.com, PagineGialle.it, PagesJaunes.fr, Yelp.com, YellowPages.ca, and others
- Integrate with existing account cookies management for authentication
- Provide scheduling capabilities through the existing cron module
- Implement robust design patterns for maintainability and extensibility
- Ensure compliance with web scraping best practices and rate limiting

### 1.3 Success Metrics
- Successfully extract data from 95%+ of target pages
- Support 10+ yellow pages platforms within 3 months
- Achieve 99.9% uptime for scheduled scraping tasks
- Maintain data accuracy of 98%+ compared to manual verification
- Complete scraping tasks within specified time limits

## 2. System Architecture

### 2.1 High-Level Architecture (Electron Multi-Process)
```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Electron)                │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Yellow    │  │   Platform  │  │   Schedule  │       │
│  │   Pages     │  │   Registry  │  │   Manager   │       │
│  │   Module    │  │             │  │             │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Task      │  │   Result    │  │   Browser   │       │
│  │   Manager   │  │   Manager   │  │   Manager   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Child Process (Scraping)                   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Scraper   │  │   Platform  │  │   Data      │       │
│  │   Engine    │  │   Adapter   │  │   Processor │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Puppeteer │  │   Cookie    │  │   Proxy     │       │
│  │   Manager   │  │   Manager   │  │   Manager   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**Process Communication:**
- **IPC (Inter-Process Communication)** between Main and Child processes
- **Message-based communication** for task coordination
- **Progress reporting** from Child to Main process
- **Error handling** across process boundaries

### 2.2 Design Patterns Implementation (Interface-Oriented)

#### 2.2.1 Interface-First Design
- **IScraperEngine**: Core scraping engine interface
- **IPlatformAdapter**: Platform-specific adapter interface
- **IDataExtractor**: Data extraction strategy interface
- **ITaskManager**: Task management interface
- **IProgressReporter**: Progress reporting interface

#### 2.2.2 Factory Pattern (Interface-Based)
- **IScraperFactory**: Creates appropriate scraper instances based on platform type
- **IPlatformFactory**: Generates platform-specific adapter implementations
- **IDataExtractorFactory**: Creates data extraction strategies

#### 2.2.3 Strategy Pattern (Interface-Driven)
- **IScrapingStrategy**: Different strategies for different platforms
- **IDataExtractionStrategy**: Various approaches for extracting specific data fields
- **IRateLimitingStrategy**: Different rate limiting approaches

#### 2.2.4 Adapter Pattern (Interface Standardization)
- **IPlatformAdapter**: Standardizes interface across different yellow pages platforms
- **IDataAdapter**: Converts platform-specific data to standardized format
- **ICookieAdapter**: Standardizes cookie management across platforms

#### 2.2.5 Observer Pattern (Interface-Based Events)
- **IScrapingObserver**: Monitors scraping progress and events
- **ITaskObserver**: Tracks task execution status
- **IProgressObserver**: Handles progress updates

#### 2.2.6 Template Method Pattern (Interface Templates)
- **IBaseScraper**: Common scraping workflow with platform-specific implementations
- **IBasePlatformAdapter**: Template for platform adapter implementations

### 2.3 Platform Extensibility Framework

#### 2.3.1 Easy Platform Addition
The system is designed to make adding new platforms as simple as possible through a standardized configuration approach:

**Configuration-Based Platform Addition:**
```typescript
// Example: Adding a new platform via configuration
const newPlatformConfig = {
  name: "NewYellowPages",
  baseUrl: "https://newyellowpages.com",
  country: "Country",
  language: "Language",
  selectors: {
    businessList: ".business-item",
    businessName: ".business-name",
    phone: ".phone-number",
    email: ".email-address",
    website: ".website-link",
    address: ".address",
    categories: ".categories",
    socialMedia: ".social-links",
    pagination: {
      nextButton: ".next-page",
      currentPage: ".current-page",
      maxPages: ".total-pages"
    }
  },
  rateLimit: 100, // requests per hour
  delayBetweenRequests: 2000, // milliseconds
  customExtractors: {
    // Optional custom extraction functions
    extractBusinessHours: (element) => { /* custom logic */ },
    extractRating: (element) => { /* custom logic */ }
  }
}
```

#### 2.2.6 Plugin Architecture
- **Platform Plugin System**: Each platform is implemented as a plugin
- **Configuration-Driven**: Platform behavior defined through JSON configuration
- **Hot-Reloading**: New platforms can be added without restarting the application
- **Version Control**: Platform configurations are versioned and can be updated independently

## 3. Functional Requirements

### 3.1 Core Scraping Functionality

#### 3.1.1 Data Extraction Requirements
The system must extract the following information from each business listing:

**Required Fields:**
- Business Name (string)
- Email Address (string, optional)
- Phone Number (string, optional)
- Social Media Links (array of strings)
- Address (object with street, city, state, zip, country)
- Website URL (string, optional)
- Categories Information (array of strings)
- Business Hours (object with day/time structure)
- Business Description (string, optional)
- Rating and Reviews (object with rating, review count)

**Optional Fields:**
- Fax Number (string)
- Contact Person (string)
- Year Established (number)
- Number of Employees (string)
- Payment Methods (array of strings)
- Specialties (array of strings)

#### 3.1.2 Platform Support Matrix

| Platform | URL | Country | Language | Status |
|----------|-----|---------|----------|--------|
| YellowPages.com | yellowpages.com | USA | English | Phase 1 |
| Yelp.com | yelp.com | USA | English | Phase 1 |
| YellowPages.ca | yellowpages.ca | Canada | English/French | Phase 1 |
| PagesJaunes.fr | pagesjaunes.fr | France | French | Phase 2 |
| PagineGialle.it | paginegialle.it | Italy | Italian | Phase 2 |
| GelbeSeiten.de | gelbeseiten.de | Germany | German | Phase 3 |
| 11880.com | 11880.com | Germany | German | Phase 3 |
| Yell.com | yell.com | UK | English | Phase 3 |
| 192.com | 192.com | UK | English | Phase 3 |

### 3.2 Integration Requirements

#### 3.2.1 Account Cookies Integration
- Utilize existing `AccountCookiesModule` for authentication
- Support multiple account profiles per platform
- Automatic cookie rotation for rate limiting avoidance
- Cookie validation and refresh mechanisms

#### 3.2.2 Browser Management Integration
- Leverage existing `BrowserManager` for Puppeteer instances
- Support stealth mode for anti-detection
- Proxy support through existing proxy management
- Browser session management and cleanup

#### 3.2.3 Scheduling Integration
- Integrate with existing `BackgroundScheduler` and `ScheduleManager`
- Support cron-based scheduling
- Task dependency management
- Execution logging and monitoring

### 3.3 Data Management

#### 3.3.1 Data Storage
- Store scraped data in SQLite database
- Implement data deduplication
- Support data export in multiple formats (CSV, JSON, Excel)
- Data versioning and history tracking

#### 3.3.2 Data Validation
- Implement data quality checks
- Validate email formats and phone numbers
- Detect and flag duplicate entries
- Data completeness scoring

## 4. Technical Requirements

### 4.1 Technology Stack

#### 4.1.1 Core Technologies
- **Puppeteer**: Web scraping and browser automation
- **TypeScript**: Type-safe development
- **SQLite**: Data storage (existing infrastructure)
- **Node.js**: Runtime environment

#### 4.1.2 Dependencies (Already Available)
The project already includes all necessary dependencies for the Yellow Pages Scraper System:

**Puppeteer Ecosystem:**
- `puppeteer`: "npm:rebrowser-puppeteer@^24.8.1" - Core browser automation
- `puppeteer-cluster`: "^0.23.0" - Concurrent scraping management
- `puppeteer-extra`: "^3.3.6" - Enhanced Puppeteer functionality
- `puppeteer-extra-plugin-stealth`: "^2.11.2" - Anti-detection capabilities
- `puppeteer-extra-plugin-recaptcha`: "^3.6.8" - CAPTCHA handling

**Data Processing:**
- `cheerio`: "^1.0.0-rc.3" - HTML parsing and manipulation
- `lodash`: "^4.17.21" - Utility functions for data processing

**Scheduling & Automation:**
- `cron`: "^2.3.0" - Task scheduling (already used in BackgroundScheduler)

**Additional Utilities:**
- `random-useragent`: "^0.5.0" - User agent rotation
- `user-agents`: "^1.1.550" - User agent management
- `uuid`: "^9.0.1" - Unique identifier generation
- `winston`: "^3.2.1" - Logging framework

**No additional dependencies required** - the system can be implemented using existing packages.

### 4.2 Performance Requirements

#### 4.2.1 Scraping Performance
- Minimum 100 businesses scraped per hour per platform
- Maximum 5 seconds per business listing
- Concurrent scraping support (configurable concurrency)
- Rate limiting compliance (respect robots.txt and platform limits)

#### 4.2.2 System Performance (Multi-Process)
- **Main Process**: Remains responsive during scraping operations
- **Child Process**: Dedicated resources for scraping tasks
- **Memory Isolation**: Child process crashes don't affect main process
- **CPU Distribution**: Scraping operations isolated from UI thread
- **Concurrent Tasks**: Support multiple child processes simultaneously
- **Process Management**: Automatic cleanup of completed/terminated processes

#### 4.2.3 Process-Specific Requirements
- **Main Process Memory**: Under 500MB during peak operations
- **Child Process Memory**: Under 1.5GB per scraping task
- **IPC Latency**: Under 50ms for message communication
- **Process Startup**: Under 2 seconds for child process initialization
- **Graceful Shutdown**: Under 5 seconds for process termination

### 4.3 Reliability Requirements

#### 4.3.1 Error Handling (Multi-Process)
- **Main Process Resilience**: Child process failures don't crash the main application
- **Graceful Degradation**: Failed scraping tasks don't affect other operations
- **Automatic Recovery**: Restart child processes on unexpected termination
- **Error Propagation**: Proper error reporting from child to main process
- **Network Timeout Handling**: Configurable timeouts for different operations
- **Retry Mechanisms**: Automatic retry with exponential backoff

#### 4.3.2 Data Integrity
- **Transaction-based Storage**: Atomic operations for data consistency
- **Data Validation**: Validate scraped data before storage
- **Backup Procedures**: Regular backups of scraped data
- **Data Consistency**: Checksums and validation for data integrity
- **Process Isolation**: Child process data corruption doesn't affect main process

#### 4.3.3 Process Management
- **Process Monitoring**: Real-time monitoring of child process health
- **Resource Cleanup**: Automatic cleanup of terminated processes
- **Memory Leak Prevention**: Proper resource disposal in child processes
- **Crash Recovery**: Automatic restart of crashed child processes
- **Graceful Shutdown**: Proper termination of all child processes on app exit

## 5. Database Schema

### 5.1 Yellow Pages Entities

#### 5.1.1 YellowPagesTask Entity
```typescript
interface YellowPagesTask {
  id: number;
  name: string;
  platform: string;
  keywords: string[];
  location: string;
  max_pages: number;
  concurrency: number;
  status: TaskStatus;
  created_at: Date;
  updated_at: Date;
  scheduled_at?: Date;
  completed_at?: Date;
  error_log?: string;
  run_log?: string;
}
```

#### 5.1.2 YellowPagesResult Entity
```typescript
interface YellowPagesResult {
  id: number;
  task_id: number;
  business_name: string;
  email?: string;
  phone: string;
  website?: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  social_media: string[];
  categories: string[];
  business_hours?: object;
  description?: string;
  rating?: number;
  review_count?: number;
  scraped_at: Date;
  platform: string;
  raw_data: object;
}
```

#### 5.1.3 YellowPagesPlatform Entity
```typescript
interface YellowPagesPlatform {
  id: number;
  name: string;
  base_url: string;
  country: string;
  language: string;
  is_active: boolean;
  rate_limit: number;
  delay_between_requests: number;
  selectors: object;
  created_at: Date;
  updated_at: Date;
}
```

## 6. Module Structure (Multi-Process Architecture)

### 6.1 Main Process Modules (Interface-Oriented)

#### 6.1.1 YellowPagesModule (Main Process)
```typescript
class YellowPagesModule extends BaseModule implements ITaskManager {
  private childProcessManager: ChildProcessManager;
  private scraperFactory: IScraperFactory;
  private progressReporter: IProgressReporter;
  
  constructor() {
    super();
    this.childProcessManager = new ChildProcessManager();
    this.scraperFactory = new YellowPagesScraperFactory();
    this.progressReporter = new ProgressReporter();
  }
  
  // ITaskManager Implementation
  async createTask(taskData: YellowPagesTaskData): Promise<number> {
    // Implementation for creating tasks
  }
  
  async startTask(taskId: number): Promise<void> {
    // Spawn child process for scraping
    const childProcess = await this.childProcessManager.spawnScraperProcess(taskId);
    return this.monitorChildProcess(childProcess);
  }
  
  async stopTask(taskId: number): Promise<void> {
    await this.childProcessManager.terminateProcess(taskId);
  }
  
  async pauseTask(taskId: number): Promise<void> {
    // Implementation for pausing tasks
  }
  
  async resumeTask(taskId: number): Promise<void> {
    // Implementation for resuming tasks
  }
  
  async getTaskStatus(taskId: number): Promise<TaskStatus> {
    // Implementation for getting task status
  }
  
  async getTaskProgress(taskId: number): Promise<TaskProgress> {
    // Implementation for getting task progress
  }
  
  async getTaskResults(taskId: number): Promise<YellowPagesResult[]> {
    // Implementation for getting task results
  }
  
  async listTasks(filters?: TaskFilters): Promise<TaskSummary[]> {
    // Implementation for listing tasks
  }
  
  async updateTask(taskId: number, updates: Partial<YellowPagesTask>): Promise<void> {
    // Implementation for updating tasks
  }
  
  async deleteTask(taskId: number): Promise<void> {
    // Implementation for deleting tasks
  }
  
  // Child Process Management
  private async monitorChildProcess(childProcess: ChildProcess): Promise<void> {
    // Monitor progress and handle IPC communication
  }
}
```

#### 6.1.2 ChildProcessManager
```typescript
class ChildProcessManager {
  private activeProcesses: Map<number, ChildProcess> = new Map();
  
  async spawnScraperProcess(taskId: number): Promise<ChildProcess> {
    const childProcess = spawn('node', ['src/childprocess/yellowPagesScraper.js'], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });
    
    this.activeProcesses.set(taskId, childProcess);
    return childProcess;
  }
  
  async terminateProcess(taskId: number): Promise<void> {
    const process = this.activeProcesses.get(taskId);
    if (process) {
      process.kill();
      this.activeProcesses.delete(taskId);
    }
  }
  
  getActiveProcesses(): Map<number, ChildProcess> {
    return this.activeProcesses;
  }
}
```

#### 6.1.3 PlatformFactoryModule
```typescript
class PlatformFactoryModule {
  createPlatformAdapter(platformName: string): PlatformAdapter
  getSupportedPlatforms(): PlatformInfo[]
  validatePlatform(platformName: string): boolean
}
```

### 6.2 Child Process Modules (Interface-Oriented)

#### 6.2.1 YellowPagesScraperProcess (Child Process)
```typescript
// src/childprocess/yellowPagesScraper.ts
class YellowPagesScraperProcess implements IScraperEngine {
  private taskId: number;
  private platformAdapter: IPlatformAdapter;
  private dataExtractor: IDataExtractor;
  private progressReporter: IProgressReporter;
  private browserManager: BrowserManager;
  private isRunning: boolean = false;
  
  constructor(taskId: number) {
    this.taskId = taskId;
    this.setupIPCCommunication();
  }
  
  async start(): Promise<void> {
    try {
      // Load task configuration from main process
      const taskConfig = await this.getTaskConfiguration();
      
      // Initialize platform adapter
      this.platformAdapter = this.createPlatformAdapter(taskConfig.platform);
      
      // Start scraping process
      await this.executeScraping(taskConfig);
      
      // Send completion message to main process
      process.send({ type: 'COMPLETED', taskId: this.taskId });
      
    } catch (error) {
      // Send error message to main process
      process.send({ 
        type: 'ERROR', 
        taskId: this.taskId, 
        error: error.message 
      });
    }
  }
  
  private async executeScraping(taskConfig: YellowPagesTask): Promise<void> {
    const browser = await this.browserManager.createBrowser();
    const page = await browser.newPage();
    
    // Apply cookies if available
    await this.applyCookies(page, taskConfig.accountId);
    
    // Execute scraping with progress reporting
    await this.scrapeWithProgress(page, taskConfig);
    
    await browser.close();
  }
  
  private async scrapeWithProgress(page: Page, taskConfig: YellowPagesTask): Promise<void> {
    let currentPage = 1;
    const totalPages = taskConfig.maxPages;
    
    while (currentPage <= totalPages) {
      // Scrape current page
      const results = await this.platformAdapter.extractBusinessData(page);
      
      // Send progress update to main process
      process.send({
        type: 'PROGRESS',
        taskId: this.taskId,
        progress: {
          currentPage,
          totalPages,
          resultsCount: results.length,
          percentage: (currentPage / totalPages) * 100
        }
      });
      
      // Move to next page
      await this.platformAdapter.handlePagination(page, totalPages);
      currentPage++;
      
      // Rate limiting delay
      await this.delay(taskConfig.delayBetweenRequests);
    }
  }
  
  private setupIPCCommunication(): void {
    process.on('message', (message) => {
      switch (message.type) {
        case 'START':
          this.start();
          break;
        case 'STOP':
          this.stop();
          break;
        case 'PAUSE':
          this.pause();
          break;
      }
    });
  }
}
```

#### 6.2.2 ScraperEngineModule (Child Process)
```typescript
class ScraperEngineModule implements IScraperEngine {
  private taskId: number;
  private platformAdapter: IPlatformAdapter;
  private dataExtractor: IDataExtractor;
  private progressReporter: IProgressReporter;
  
  constructor(
    taskId: number,
    platformAdapter: IPlatformAdapter,
    dataExtractor: IDataExtractor,
    progressReporter: IProgressReporter
  ) {
    this.taskId = taskId;
    this.platformAdapter = platformAdapter;
    this.dataExtractor = dataExtractor;
    this.progressReporter = progressReporter;
  }
  
  async scrapeTask(task: YellowPagesTask): Promise<YellowPagesResult[]> {
    // Implementation using interfaces
    return await this.platformAdapter.extractBusinessData(await this.createPage());
  }
  
  async extractBusinessData(page: Page, selectors: PlatformSelectors): Promise<BusinessData> {
    // Implementation using IDataExtractor interface
    return await this.dataExtractor.extractBusinessData(page);
  }
  
  async handlePagination(page: Page, maxPages: number): Promise<void> {
    // Implementation using IPlatformAdapter interface
    return await this.platformAdapter.handlePagination(page, maxPages);
  }
  
  // IScraperEngine implementation
  async start(): Promise<void> {
    // Implementation
  }
  
  async stop(): Promise<void> {
    // Implementation
  }
  
  async pause(): Promise<void> {
    // Implementation
  }
  
  async resume(): Promise<void> {
    // Implementation
  }
  
  onProgress(callback: (progress: ScrapingProgress) => void): void {
    this.progressReporter.onProgressUpdate(callback);
  }
  
  onError(callback: (error: ScrapingError) => void): void {
    this.progressReporter.onError(callback);
  }
  
  onComplete(callback: (results: YellowPagesResult[]) => void): void {
    this.progressReporter.onCompletion(callback);
  }
}
```

### 6.3 Integration Modules

#### 6.3.1 YellowPagesScheduleModule
```typescript
class YellowPagesScheduleModule extends BaseModule {
  async scheduleTask(taskId: number, cronExpression: string): Promise<void>
  async unscheduleTask(taskId: number): Promise<void>
  async getScheduledTasks(): Promise<ScheduledTask[]>
}
```

#### 6.3.2 YellowPagesCookiesModule
```typescript
class YellowPagesCookiesModule extends BaseModule {
  async getCookiesForPlatform(platform: string, accountId: number): Promise<CookiesType>
  async saveCookiesForPlatform(platform: string, accountId: number, cookies: CookiesType): Promise<void>
  async rotateCookies(platform: string): Promise<void>
}
```

### 6.4 IPC Communication Protocol

#### 6.4.1 Message Types
```typescript
interface IPCMessage {
  type: 'START' | 'STOP' | 'PAUSE' | 'PROGRESS' | 'COMPLETED' | 'ERROR';
  taskId: number;
  data?: any;
  error?: string;
  progress?: ScrapingProgress;
}

interface ScrapingProgress {
  currentPage: number;
  totalPages: number;
  resultsCount: number;
  percentage: number;
  estimatedTimeRemaining?: number;
}
```

#### 6.4.2 Main Process IPC Handler
```typescript
class YellowPagesIPCHandler {
  private yellowPagesModule: YellowPagesModule;
  
  setupIPCHandlers(): void {
    ipcMain.handle('yellow-pages:create-task', async (event, taskData) => {
      return await this.yellowPagesModule.createTask(taskData);
    });
    
    ipcMain.handle('yellow-pages:run-task', async (event, taskId) => {
      return await this.yellowPagesModule.runTask(taskId);
    });
    
    ipcMain.handle('yellow-pages:stop-task', async (event, taskId) => {
      return await this.yellowPagesModule.stopTask(taskId);
    });
    
    ipcMain.handle('yellow-pages:get-results', async (event, taskId) => {
      return await this.yellowPagesModule.getTaskResults(taskId);
    });
  }
  
  handleChildProcessMessage(message: IPCMessage): void {
    switch (message.type) {
      case 'PROGRESS':
        this.updateTaskProgress(message.taskId, message.progress);
        break;
      case 'COMPLETED':
        this.handleTaskCompletion(message.taskId);
        break;
      case 'ERROR':
        this.handleTaskError(message.taskId, message.error);
        break;
    }
  }
}
```

## 7. Interface Definitions and Implementations

### 7.1 Core Interface Definitions

#### 7.1.1 IScraperEngine Interface
```typescript
interface IScraperEngine {
  // Core scraping functionality
  async scrapeTask(task: YellowPagesTask): Promise<YellowPagesResult[]>
  async extractBusinessData(page: Page, selectors: PlatformSelectors): Promise<BusinessData>
  async handlePagination(page: Page, maxPages: number): Promise<void>
  
  // Process management
  async start(): Promise<void>
  async stop(): Promise<void>
  async pause(): Promise<void>
  async resume(): Promise<void>
  
  // Progress reporting
  onProgress(callback: (progress: ScrapingProgress) => void): void
  onError(callback: (error: ScrapingError) => void): void
  onComplete(callback: (results: YellowPagesResult[]) => void): void
}
```

#### 7.1.2 IPlatformAdapter Interface
```typescript
interface IPlatformAdapter {
  readonly platformName: string;
  readonly baseUrl: string;
  readonly version: string;
  
  // Core platform operations
  async searchBusinesses(keywords: string[], location: string): Promise<SearchResult[]>
  async extractBusinessData(page: Page): Promise<BusinessData>
  async handlePagination(page: Page, maxPages: number): Promise<void>
  async applyCookies(page: Page, cookies: CookiesType): Promise<void>
  
  // Platform configuration
  getSelectors(): PlatformSelectors
  getRateLimitingConfig(): RateLimitingConfig
  getAuthenticationConfig(): AuthenticationConfig
  
  // Platform-specific features
  supportsAuthentication(): boolean
  supportsProxy(): boolean
  supportsCookies(): boolean
  getSupportedFeatures(): PlatformFeature[]
}
```

#### 7.1.3 IDataExtractor Interface
```typescript
interface IDataExtractor {
  // Data extraction strategies
  async extractBusinessName(element: Element): Promise<string>
  async extractPhoneNumber(element: Element): Promise<string>
  async extractEmail(element: Element): Promise<string | null>
  async extractWebsite(element: Element): Promise<string | null>
  async extractAddress(element: Element): Promise<Address>
  async extractSocialMedia(element: Element): Promise<string[]>
  async extractCategories(element: Element): Promise<string[]>
  async extractBusinessHours(element: Element): Promise<BusinessHours | null>
  async extractRating(element: Element): Promise<Rating | null>
  
  // Validation
  validateExtractedData(data: BusinessData): ValidationResult
  sanitizeData(data: BusinessData): BusinessData
}
```

#### 7.1.4 ITaskManager Interface
```typescript
interface ITaskManager {
  // Task lifecycle management
  async createTask(taskData: YellowPagesTaskData): Promise<number>
  async startTask(taskId: number): Promise<void>
  async stopTask(taskId: number): Promise<void>
  async pauseTask(taskId: number): Promise<void>
  async resumeTask(taskId: number): Promise<void>
  
  // Task monitoring
  async getTaskStatus(taskId: number): Promise<TaskStatus>
  async getTaskProgress(taskId: number): Promise<TaskProgress>
  async getTaskResults(taskId: number): Promise<YellowPagesResult[]>
  
  // Task management
  async listTasks(filters?: TaskFilters): Promise<TaskSummary[]>
  async updateTask(taskId: number, updates: Partial<YellowPagesTask>): Promise<void>
  async deleteTask(taskId: number): Promise<void>
}
```

#### 7.1.5 IProgressReporter Interface
```typescript
interface IProgressReporter {
  // Progress reporting
  reportProgress(progress: ScrapingProgress): void
  reportError(error: ScrapingError): void
  reportCompletion(results: YellowPagesResult[]): void
  
  // Progress tracking
  getCurrentProgress(): ScrapingProgress
  getEstimatedTimeRemaining(): number
  getSuccessRate(): number
  
  // Event handling
  onProgressUpdate(callback: (progress: ScrapingProgress) => void): void
  onError(callback: (error: ScrapingError) => void): void
  onCompletion(callback: (results: YellowPagesResult[]) => void): void
}
```

#### 7.1.6 IFactory Interfaces
```typescript
interface IScraperFactory {
  createScraperEngine(platform: string): IScraperEngine
  createPlatformAdapter(platform: string): IPlatformAdapter
  createDataExtractor(platform: string): IDataExtractor
  getSupportedPlatforms(): string[]
}

interface IPlatformFactory {
  createAdapter(platformName: string): IPlatformAdapter
  registerAdapter(platformName: string, adapter: IPlatformAdapter): void
  unregisterAdapter(platformName: string): void
  getRegisteredAdapters(): Map<string, IPlatformAdapter>
}
```

### 7.2 Implementation Examples

#### 7.2.1 Concrete ScraperEngine Implementation
```typescript
class YellowPagesScraperEngine implements IScraperEngine {
  private platformAdapter: IPlatformAdapter;
  private dataExtractor: IDataExtractor;
  private progressReporter: IProgressReporter;
  private isRunning: boolean = false;
  
  constructor(
    platformAdapter: IPlatformAdapter,
    dataExtractor: IDataExtractor,
    progressReporter: IProgressReporter
  ) {
    this.platformAdapter = platformAdapter;
    this.dataExtractor = dataExtractor;
    this.progressReporter = progressReporter;
  }
  
  async scrapeTask(task: YellowPagesTask): Promise<YellowPagesResult[]> {
    this.isRunning = true;
    const results: YellowPagesResult[] = [];
    
    try {
      const browser = await this.createBrowser();
      const page = await browser.newPage();
      
      await this.platformAdapter.applyCookies(page, task.cookies);
      
      for (let currentPage = 1; currentPage <= task.maxPages && this.isRunning; currentPage++) {
        const pageResults = await this.scrapePage(page, task, currentPage);
        results.push(...pageResults);
        
        this.progressReporter.reportProgress({
          currentPage,
          totalPages: task.maxPages,
          resultsCount: results.length,
          percentage: (currentPage / task.maxPages) * 100
        });
        
        if (currentPage < task.maxPages) {
          await this.platformAdapter.handlePagination(page, task.maxPages);
          await this.delay(task.delayBetweenRequests);
        }
      }
      
      await browser.close();
      this.progressReporter.reportCompletion(results);
      return results;
      
    } catch (error) {
      this.progressReporter.reportError({
        message: error.message,
        taskId: task.id,
        timestamp: new Date()
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
  
  async start(): Promise<void> {
    this.isRunning = true;
  }
  
  async stop(): Promise<void> {
    this.isRunning = false;
  }
  
  async pause(): Promise<void> {
    // Implementation for pausing
  }
  
  async resume(): Promise<void> {
    // Implementation for resuming
  }
  
  onProgress(callback: (progress: ScrapingProgress) => void): void {
    this.progressReporter.onProgressUpdate(callback);
  }
  
  onError(callback: (error: ScrapingError) => void): void {
    this.progressReporter.onError(callback);
  }
  
  onComplete(callback: (results: YellowPagesResult[]) => void): void {
    this.progressReporter.onCompletion(callback);
  }
}
```

#### 7.2.2 Concrete PlatformAdapter Implementation
```typescript
class YellowPagesComAdapter implements IPlatformAdapter {
  readonly platformName = 'yellowpages.com';
  readonly baseUrl = 'https://www.yellowpages.com';
  readonly version = '1.0.0';
  
  async searchBusinesses(keywords: string[], location: string): Promise<SearchResult[]> {
    // Implementation for yellowpages.com search
  }
  
  async extractBusinessData(page: Page): Promise<BusinessData> {
    // Implementation for yellowpages.com data extraction
  }
  
  async handlePagination(page: Page, maxPages: number): Promise<void> {
    // Implementation for yellowpages.com pagination
  }
  
  async applyCookies(page: Page, cookies: CookiesType): Promise<void> {
    // Implementation for applying cookies
  }
  
  getSelectors(): PlatformSelectors {
    return {
      businessList: '.result',
      businessName: '.business-name',
      phone: '.phone',
      email: '.email',
      website: '.website',
      address: '.address',
      categories: '.categories',
      socialMedia: '.social-media',
      pagination: {
        nextButton: '.next-page',
        currentPage: '.current-page',
        maxPages: '.total-pages'
      }
    };
  }
  
  getRateLimitingConfig(): RateLimitingConfig {
    return {
      requestsPerHour: 100,
      delayBetweenRequests: 2000,
      maxConcurrentRequests: 1
    };
  }
  
  getAuthenticationConfig(): AuthenticationConfig {
    return {
      requiresAuthentication: false,
      supportsCookies: true,
      supportsProxy: true
    };
  }
  
  supportsAuthentication(): boolean {
    return false;
  }
  
  supportsProxy(): boolean {
    return true;
  }
  
  supportsCookies(): boolean {
    return true;
  }
  
  getSupportedFeatures(): PlatformFeature[] {
    return ['search', 'pagination', 'cookies', 'proxy'];
  }
}
```

#### 7.2.3 Concrete Factory Implementation
```typescript
class YellowPagesScraperFactory implements IScraperFactory {
  private platformAdapters: Map<string, IPlatformAdapter> = new Map();
  private dataExtractors: Map<string, IDataExtractor> = new Map();
  
  constructor() {
    this.registerDefaultAdapters();
    this.registerDefaultExtractors();
  }
  
  createScraperEngine(platform: string): IScraperEngine {
    const platformAdapter = this.createPlatformAdapter(platform);
    const dataExtractor = this.createDataExtractor(platform);
    const progressReporter = new ProgressReporter();
    
    return new YellowPagesScraperEngine(platformAdapter, dataExtractor, progressReporter);
  }
  
  createPlatformAdapter(platform: string): IPlatformAdapter {
    const adapter = this.platformAdapters.get(platform);
    if (!adapter) {
      throw new Error(`Platform adapter not found: ${platform}`);
    }
    return adapter;
  }
  
  createDataExtractor(platform: string): IDataExtractor {
    const extractor = this.dataExtractors.get(platform);
    if (!extractor) {
      throw new Error(`Data extractor not found: ${platform}`);
    }
    return extractor;
  }
  
  getSupportedPlatforms(): string[] {
    return Array.from(this.platformAdapters.keys());
  }
  
  private registerDefaultAdapters(): void {
    this.platformAdapters.set('yellowpages.com', new YellowPagesComAdapter());
    this.platformAdapters.set('yelp.com', new YelpComAdapter());
    this.platformAdapters.set('yellowpages.ca', new YellowPagesCaAdapter());
  }
  
  private registerDefaultExtractors(): void {
    this.dataExtractors.set('yellowpages.com', new YellowPagesDataExtractor());
    this.dataExtractors.set('yelp.com', new YelpDataExtractor());
    this.dataExtractors.set('yellowpages.ca', new YellowPagesCaDataExtractor());
  }
}
```

### 7.3 Platform Configuration System

#### 7.3.1 Platform Configuration Schema
```typescript
interface PlatformConfig {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  country: string;
  language: string;
  isActive: boolean;
  version: string;
  
  // Rate limiting
  rateLimit: number; // requests per hour
  delayBetweenRequests: number; // milliseconds
  maxConcurrentRequests: number;
  
  // Selectors
  selectors: PlatformSelectors;
  
  // Custom extractors (optional)
  customExtractors?: {
    [key: string]: (element: Element) => any;
  };
  
  // Platform-specific settings
  settings: {
    requiresAuthentication: boolean;
    supportsProxy: boolean;
    supportsCookies: boolean;
    searchUrlPattern: string;
    resultUrlPattern: string;
  };
  
  // Metadata
  metadata: {
    description: string;
    lastUpdated: Date;
    maintainer: string;
    documentation: string;
  };
}
```

#### 7.3.2 Platform Registration System
```typescript
class PlatformRegistry {
  private platforms: Map<string, PlatformConfig> = new Map();
  
  // Register a new platform
  registerPlatform(config: PlatformConfig): void {
    this.validatePlatformConfig(config);
    this.platforms.set(config.id, config);
    this.savePlatformConfig(config);
  }
  
  // Get platform configuration
  getPlatformConfig(platformId: string): PlatformConfig | null {
    return this.platforms.get(platformId) || null;
  }
  
  // List all available platforms
  getAllPlatforms(): PlatformConfig[] {
    return Array.from(this.platforms.values());
  }
  
  // Update platform configuration
  updatePlatformConfig(platformId: string, updates: Partial<PlatformConfig>): void {
    const existing = this.platforms.get(platformId);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.platforms.set(platformId, updated);
      this.savePlatformConfig(updated);
    }
  }
  
  // Remove platform
  removePlatform(platformId: string): void {
    this.platforms.delete(platformId);
    this.removePlatformConfig(platformId);
  }
}
```

### 7.4 Platform Development Kit (PDK)

#### 7.4.1 Platform Template Generator
```typescript
class PlatformTemplateGenerator {
  generatePlatformTemplate(platformName: string, baseUrl: string): PlatformConfig {
    return {
      id: platformName.toLowerCase().replace(/\s+/g, '-'),
      name: platformName,
      displayName: platformName,
      baseUrl: baseUrl,
      country: "Unknown",
      language: "Unknown",
      isActive: false,
      version: "1.0.0",
      
      rateLimit: 100,
      delayBetweenRequests: 2000,
      maxConcurrentRequests: 1,
      
      selectors: {
        businessList: "/* TODO: Add business list selector */",
        businessName: "/* TODO: Add business name selector */",
        phone: "/* TODO: Add phone selector */",
        email: "/* TODO: Add email selector */",
        website: "/* TODO: Add website selector */",
        address: "/* TODO: Add address selector */",
        categories: "/* TODO: Add categories selector */",
        socialMedia: "/* TODO: Add social media selector */",
        pagination: {
          nextButton: "/* TODO: Add next button selector */",
          currentPage: "/* TODO: Add current page selector */",
          maxPages: "/* TODO: Add max pages selector */"
        }
      },
      
      settings: {
        requiresAuthentication: false,
        supportsProxy: true,
        supportsCookies: true,
        searchUrlPattern: `${baseUrl}/search?q={keywords}&location={location}`,
        resultUrlPattern: `${baseUrl}/business/{id}`
      },
      
      metadata: {
        description: `Platform configuration for ${platformName}`,
        lastUpdated: new Date(),
        maintainer: "System",
        documentation: ""
      }
    };
  }
}
```

#### 7.4.2 Platform Testing Framework
```typescript
class PlatformTestingFramework {
  async testPlatformConfig(config: PlatformConfig): Promise<TestResult> {
    const results = {
      selectors: await this.testSelectors(config.selectors),
      rateLimiting: await this.testRateLimiting(config),
      authentication: await this.testAuthentication(config),
      pagination: await this.testPagination(config),
      dataExtraction: await this.testDataExtraction(config)
    };
    
    return {
      success: Object.values(results).every(r => r.success),
      results,
      recommendations: this.generateRecommendations(results)
    };
  }
  
  private async testSelectors(selectors: PlatformSelectors): Promise<SelectorTestResult> {
    // Test each selector against a sample page
    // Return success/failure for each selector
  }
}
```

## 8. User Interface Requirements

### 8.1 Task Management Interface
- Create new scraping tasks
- View task status and progress
- Edit existing tasks
- Delete tasks
- Export results

### 8.2 Platform Management Interface
- Configure platform settings
- Manage platform-specific selectors
- Enable/disable platforms
- View platform statistics
- **Add new platforms through UI**
- **Platform configuration editor**
- **Platform testing interface**
- **Platform template generator**

### 8.3 Platform Development Interface
- **Platform Configuration Editor**: Visual editor for creating/editing platform configurations
- **Selector Inspector**: Tool to inspect and test CSS selectors on live pages
- **Platform Testing Dashboard**: Test platform configurations before deployment
- **Platform Template Library**: Pre-built templates for common platform types
- **Platform Import/Export**: Share platform configurations between installations

### 8.4 Results Management Interface
- View scraped data
- Filter and search results
- Export data in various formats
- Data quality indicators

## 9. Security and Compliance

### 9.1 Rate Limiting
- Respect robots.txt files
- Implement configurable delays between requests
- Rotate user agents and IP addresses
- Monitor and adjust scraping speed based on platform response

### 9.2 Data Privacy
- Secure storage of sensitive business information
- Compliance with data protection regulations
- Data retention policies
- Access control and audit logging

### 9.3 Error Handling
- Comprehensive error logging
- Graceful degradation on failures
- Retry mechanisms with exponential backoff
- User notification for critical errors

## 10. Testing Strategy

### 10.1 Unit Testing
- Test individual platform adapters
- Test data extraction functions
- Test scheduling mechanisms
- Test error handling scenarios

### 10.2 Integration Testing
- Test end-to-end scraping workflows
- Test database operations
- Test scheduling integration
- Test browser management integration

### 10.3 Performance Testing
- Load testing with multiple concurrent tasks
- Memory usage testing
- Database performance testing
- Network latency testing

## 11. Deployment and Maintenance

### 11.1 Deployment Requirements
- Integration with existing Electron application
- Database migration scripts
- Configuration management
- Environment-specific settings

### 11.2 Monitoring and Logging
- Real-time task monitoring
- Performance metrics collection
- Error tracking and alerting
- Usage analytics

### 11.3 Maintenance Procedures
- Regular platform selector updates
- Database optimization
- Performance monitoring
- Security updates

## 12. Implementation Phases

### Phase 1 (Weeks 1-4): Core Infrastructure
- Database schema implementation
- Base module structure
- Platform factory and adapter pattern
- Basic scraping engine
- **Platform configuration system**
- **Platform registry and management**

### Phase 2 (Weeks 5-8): Platform Support & Development Tools
- YellowPages.com implementation
- Yelp.com implementation
- YellowPages.ca implementation
- Basic UI integration
- **Platform Development Kit (PDK)**
- **Platform configuration editor**
- **Platform testing framework**

### Phase 3 (Weeks 9-12): Advanced Features & Extensibility
- Scheduling integration
- Cookie management integration
- Advanced error handling
- Performance optimization
- **Platform template generator**
- **Selector inspector tool**
- **Platform import/export functionality**

### Phase 4 (Weeks 13-16): Additional Platforms & Community Features
- European platforms (PagesJaunes.fr, PagineGialle.it)
- German platforms (GelbeSeiten.de, 11880.com)
- UK platforms (Yell.com, 192.com)
- **Platform marketplace**
- **Community platform sharing**
- **Platform versioning system**

### Phase 5 (Weeks 17-20): Polish and Testing
- Comprehensive testing
- Performance optimization
- Documentation
- User training materials
- **Platform development documentation**
- **Platform contribution guidelines**

## 13. Risk Assessment

### 13.1 Technical Risks
- **Platform Changes**: Yellow pages platforms may change their structure
- **Rate Limiting**: Platforms may implement stricter anti-scraping measures
- **Performance**: Large-scale scraping may impact system performance
- **Platform Maintenance**: Keeping multiple platform configurations up-to-date

### 13.2 Mitigation Strategies
- **Flexible Selectors**: Use multiple selector strategies for robustness
- **Adaptive Rate Limiting**: Implement intelligent rate limiting
- **Scalable Architecture**: Design for horizontal scaling
- **Comprehensive Monitoring**: Real-time monitoring and alerting
- **Platform Configuration Management**: Version control and automated testing for platform configurations
- **Community-Driven Updates**: Allow community contributions for platform maintenance

## 14. Success Criteria

### 14.1 Functional Success
- Successfully extract data from all target platforms
- Integrate seamlessly with existing application
- Support scheduled scraping tasks
- Provide comprehensive data export capabilities

### 14.2 Performance Success
- Achieve target scraping speeds
- Maintain system stability under load
- Provide responsive user interface
- Ensure data accuracy and completeness

### 14.3 User Success
- Intuitive task management interface
- Clear progress indicators
- Comprehensive error reporting
- Easy data export and analysis

## 15. Conclusion

The Yellow Pages Scraper System represents a significant enhancement to the aiFetchly application, providing comprehensive business data extraction capabilities while maintaining the existing architecture's strengths. The implementation follows **interface-oriented programming principles** and integrates seamlessly with current modules, ensuring maintainability and extensibility for future platform additions.

**Key Innovation: Interface-First Design**
The system's most significant feature is its **interface-driven architecture** combined with **configuration-driven platform extensibility**. This dual approach provides:

### **Interface-Oriented Benefits:**
- **Loose Coupling**: Components depend on interfaces, not concrete implementations
- **Easy Testing**: Mock implementations can be easily created for testing
- **Extensibility**: New implementations can be added without changing existing code
- **Maintainability**: Clear contracts between components
- **Dependency Injection**: Easy to swap implementations at runtime

### **Configuration-Driven Benefits:**
- **Reduces Development Time**: New platforms can be added in minutes instead of days
- **Enables Non-Developers**: Business users can add platforms without coding knowledge
- **Facilitates Community Contributions**: Platform configurations can be shared and improved
- **Ensures Consistency**: All platforms follow the same interface contracts
- **Supports Rapid Iteration**: Platform configurations can be updated without code deployment

### **Multi-Process Architecture Benefits:**
- **Responsive UI**: Main process remains interactive during scraping
- **Process Isolation**: Child process failures don't affect the main application
- **Resource Management**: Dedicated resources for scraping operations
- **Scalability**: Multiple concurrent scraping tasks

The phased approach ensures steady progress while allowing for iterative improvements based on real-world usage and feedback. The focus on **interface-oriented design**, **multi-process architecture**, **performance**, **user experience**, and **platform extensibility** will result in a robust and reliable scraping solution that meets the needs of modern business intelligence requirements while being easily adaptable to new platforms and changing requirements. 
The phased approach ensures steady progress while allowing for iterative improvements based on real-world usage and feedback. The focus on compliance, performance, user experience, and **platform extensibility** will result in a robust and reliable scraping solution that meets the needs of modern business intelligence requirements while being easily adaptable to new platforms and changing requirements. 