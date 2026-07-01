# MCP Server Integration - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview
The MCP (Model Context Protocol) Server Integration System is a comprehensive AI-powered scraping and marketing automation solution designed to extend the existing aiFetchly application with external API capabilities. The system will integrate seamlessly with the current Electron-based architecture, leveraging established modules for browser management, data processing, and task scheduling while providing standardized MCP protocol interfaces for AI assistants and external tools.

### 1.2 Objectives
- Implement MCP server protocol for external AI assistant integration
- Provide search engine content scraping capabilities through MCP tools
- Enable yellow pages content scraping via standardized MCP interfaces
- Implement email extraction and scraping from websites
- Develop email marketing automation capabilities
- Integrate with existing aiFetchly infrastructure (browser management, database, scheduling)
- Ensure aiFetchly application is logged in and running for MCP server operation
- Ensure compliance with web scraping best practices and rate limiting
- Maintain high performance and reliability standards

### 1.3 Success Metrics
- Successfully implement MCP protocol with 100% specification compliance
- Achieve 95%+ success rate for search engine content scraping
- Support 10+ search engines and yellow pages platforms
- Extract emails from 90%+ of target websites accurately
- Deliver email marketing campaigns with 98%+ deliverability
- Maintain sub-500ms response time for MCP tool calls
- Achieve 99.9% uptime for MCP server operations
- Ensure aiFetchly application remains logged in and accessible during MCP operations
- Maintain seamless integration between MCP server and aiFetchly login state

## 2. System Architecture

### 2.1 High-Level Architecture (MCP Server Integration)

```
┌─────────────────────────────────────────────────────────────┐
│                    External AI Assistants                  │
│               (Cursor, Claude Desktop, etc.)               │
└─────────────────────────┬───────────────────────────────────┘
                          │ MCP Protocol (JSON-RPC over stdio)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server Layer                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Request   │  │   Response  │  │   Login     │       │
│  │  Handler    │  │  Formatter  │  │  State      │       │
│  │             │  │             │  │  Monitor    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Search    │  │  YellowPages │  │    Email    │       │
│  │   Engine    │  │   Scraper   │  │  Extraction │       │
│  │   Tools     │  │    Tools    │  │    Tools    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Email     │  │   Task      │  │   Resource  │       │
│  │ Marketing   │  │ Management  │  │ Management  │       │
│  │   Tools     │  │   Tools     │  │   Tools     │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────┬───────────────────────────────────────┘
                      │ IPC Communication
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              aiFetchly Main Process (Electron)             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   MCP       │  │  Controller │  │   Module    │       │
│  │ Controller  │  │   Registry  │  │  Manager    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Browser   │  │  Database   │  │  Schedule   │       │
│  │  Manager    │  │  Manager    │  │  Manager    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────┬───────────────────────────────────────┘
                      │ Child Process Management
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                Child Processes (Scraping)                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  Puppeteer  │  │   Content   │  │    Email    │       │
│  │   Engine    │  │  Extractor  │  │   Sender    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Platform  │  │   Proxy     │  │   Cookie    │       │
│  │   Adapter   │  │  Manager    │  │  Manager    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 MCP Protocol Implementation

#### 2.2.1 MCP Server Core Components
- **MCPServer**: Main server class implementing MCP protocol specification
- **ToolRegistry**: Registry for all available MCP tools and their schemas
- **RequestHandler**: Handles incoming MCP requests and routes to appropriate tools
- **ResponseFormatter**: Formats responses according to MCP protocol standards
- **ErrorHandler**: Standardized error handling and reporting

#### 2.2.2 MCP Tool Categories
- **Search Engine Tools**: Google, Bing, DuckDuckGo, Yandex scraping tools
- **Yellow Pages Tools**: Business directory scraping and data extraction
- **Email Tools**: Email extraction, validation, and marketing automation
- **Task Management Tools**: Task creation, monitoring, and result retrieval
- **Resource Tools**: File management, data export, and system monitoring

### 2.3 Login State Management System

#### 2.3.1 MCP Request Flow with Login State Check
```
┌─────────────────────────────────────────────────────────────┐
│                MCP Request Flow                            │
├─────────────────────────────────────────────────────────────┤
│  1. MCP Request Received                                   │
│  2. Check aiFetchly Application Login State               │
│  3. Verify Application is Running and Accessible          │
│  4. Execute Tool with Current User Context                │
│  5. Return Response                                        │
└─────────────────────────────────────────────────────────────┘
```

#### 2.3.2 Login State Components
- **LoginStateMonitor**: Monitors aiFetchly application login status
- **ApplicationHealthChecker**: Verifies aiFetchly is running and responsive
- **UserContextProvider**: Provides current logged-in user context
- **SessionValidator**: Validates current aiFetchly session is active
- **StateNotifier**: Notifies MCP server of login state changes

#### 2.3.3 Login State Requirements
- **Application Running**: aiFetchly must be running and accessible
- **User Logged In**: A user must be logged into aiFetchly application
- **Session Active**: Current session must be valid and not expired
- **Resources Available**: Browser instances and database connections must be available

### 2.4 Integration with Existing aiFetchly Architecture

#### 2.4.1 Controller Integration
```typescript
interface IMCPController {
    // Integration with existing controllers
    yellowPagesController: YellowPagesController;
    emailExtractionController: EmailExtractionController;
    taskController: TaskController;
    
    // MCP-specific methods
    registerTools(): void;
    handleToolCall(toolName: string, parameters: any): Promise<any>;
    getToolSchema(toolName: string): MCPToolSchema;
    
    // Login state management
    checkLoginState(): Promise<boolean>;
    getCurrentUserContext(): Promise<UserContext | null>;
    notifyLoginStateChange(isLoggedIn: boolean): void;
}
```

#### 2.4.2 Module Integration
- **BrowserManager**: Reuse existing Puppeteer management
- **DatabaseManager**: Leverage existing TypeORM models
- **ScheduleManager**: Integrate with existing cron system
- **AccountCookiesModule**: Reuse authentication system
- **PlatformRegistry**: Extend existing platform support

## 3. MCP Tools Specification

### 3.1 Login State Requirements

#### 3.1.1 MCP Request Format
MCP tool calls use standard MCP protocol without authentication headers:

```typescript
interface MCPRequest {
    method: string;
    params: any;
    // No authentication headers required
}
```

#### 3.1.2 Login State Error Response
When aiFetchly is not logged in or running, MCP requests will receive an error response:

```typescript
interface LoginStateError {
    error: {
        code: "APPLICATION_NOT_RUNNING" | "USER_NOT_LOGGED_IN" | "SESSION_EXPIRED" | "RESOURCES_UNAVAILABLE";
        message: string;
        details?: {
            required_action: string;
            login_url?: string;
            application_status?: string;
        };
    };
}
```

#### 3.1.3 User Context from aiFetchly
MCP tools will use the current logged-in user context from aiFetchly:

```typescript
interface UserContext {
    user_id: string;
    username: string;
    subscription_tier: "free" | "premium" | "enterprise";
    session_info: {
        session_id: string;
        expires_at: string;
        last_activity: string;
    };
    application_state: {
        is_running: boolean;
        is_logged_in: boolean;
        browser_instances: number;
        database_connected: boolean;
    };
}
```

### 3.2 Search Engine Scraping Tools

#### 3.2.1 `search_google`
**Description**: Scrape Google search results with advanced filtering options
**Parameters**:
- `query` (required): Search query string
- `pages` (optional): Number of pages to scrape (default: 1, max: 10)
- `language` (optional): Search language (default: "en")
- `country` (optional): Country code for localized results
- `safe_search` (optional): Safe search setting
- `result_type` (optional): "organic", "ads", "all"

**Response Format**:
```typescript
interface GoogleSearchResult {
    query: string;
    total_results: number;
    results: {
        title: string;
        url: string;
        description: string;
        position: number;
        domain: string;
        type: "organic" | "ad";
    }[];
    related_searches: string[];
    search_metadata: {
        timestamp: string;
        processing_time: number;
        page: number;
    };
}
```

#### 3.2.2 `search_bing`
**Description**: Scrape Bing search results
**Parameters**: Similar to `search_google`
**Response Format**: Similar structure to Google results


### 3.3 Yellow Pages Scraping Tools

#### 3.3.1 `scrape_yellow_pages`
**Description**: Extract business information from yellow pages platforms
**Parameters**:
- `platform` (required): "yellowpages.com", "yelp.com", "paginegialle.it", etc.
- `search_term` (required): Business category or name
- `location` (required): City, state, or coordinates
- `radius` (optional): Search radius in miles/km
- `max_results` (optional): Maximum results to return (default: 50)
- `include_reviews` (optional): Include customer reviews (default: false)

**Response Format**:
```typescript
interface YellowPagesResult {
    businesses: {
        name: string;
        address: string;
        phone: string;
        website?: string;
        email?: string;
        rating?: number;
        review_count?: number;
        categories: string[];
        hours?: { [day: string]: string };
        coordinates?: { lat: number, lng: number };
        reviews?: { author: string, rating: number, text: string, date: string }[];
    }[];
    search_metadata: {
        platform: string;
        search_term: string;
        location: string;
        total_found: number;
        timestamp: string;
    };
}
```

#### 3.3.2 `get_business_details`
**Description**: Get detailed information for a specific business
**Parameters**:
- `business_url` (required): Direct URL to business listing
- `platform` (required): Platform identifier
- `include_reviews` (optional): Include all reviews
- `include_photos` (optional): Include photo URLs

### 3.4 Email Scraping Tools

#### 3.4.1 `extract_emails_from_website`
**Description**: Extract email addresses from websites
**Parameters**:
- `urls` (required): Array of website URLs
- `max_pages_per_site` (optional): Pages to crawl per site (default: 5)
- `follow_internal_links` (optional): Follow internal links (default: true)
- `email_validation` (optional): Validate extracted emails (default: true)
- `exclude_patterns` (optional): Email patterns to exclude
- `timeout` (optional): Timeout per page in seconds (default: 30)

**Response Format**:
```typescript
interface EmailExtractionResult {
    results: {
        url: string;
        emails: {
            email: string;
            context: string; // Surrounding text
            page_url: string;
            is_valid: boolean;
            confidence_score: number;
        }[];
        pages_processed: number;
        processing_time: number;
        errors?: string[];
    }[];
    summary: {
        total_emails: number;
        unique_emails: number;
        valid_emails: number;
        domains: { [domain: string]: number };
        timestamp: string;
    };
}
```

#### 3.4.2 `validate_email_list`
**Description**: Validate a list of email addresses
**Parameters**:
- `emails` (required): Array of email addresses
- `check_mx_record` (optional): Check MX record existence
- `check_disposable` (optional): Check for disposable email services
- `check_role_based` (optional): Identify role-based emails

### 3.5 Email Marketing Tools

#### 3.5.1 `create_email_task`
**Description**: Create a new email marketing task
**Parameters**:
- `task_name` (required): Name of the email marketing task
- `task_desc` (optional): Description of the email marketing task
- `status` (optional): Task status (1=Processing, 2=Complete, 3=Error, default: 1)

**Response Format**:
```typescript
interface EmailTaskResult {
    task_id: number;
    task_name: string;
    task_desc?: string;
    status: number;
    record_time: string;
    created_at: string;
}
```

#### 3.5.2 `get_email_task`
**Description**: Get email marketing task by ID
**Parameters**:
- `id` (required): Task ID to retrieve

**Response Format**:
```typescript
interface EmailTaskDetails {
    id: number;
    task_name?: string;
    task_desc?: string;
    status: number;
    record_time?: string;
}
```

#### 3.5.3 `update_email_task`
**Description**: Update an existing email marketing task
**Parameters**:
- `id` (required): Task ID to update
- `task_name` (optional): Updated task name
- `task_desc` (optional): Updated task description
- `status` (optional): Updated task status (1=Processing, 2=Complete, 3=Error)

**Response Format**:
```typescript
interface UpdateResult {
    success: boolean;
    message: string;
    updated_at: string;
}
```

#### 3.5.4 `delete_email_task`
**Description**: Delete an email marketing task
**Parameters**:
- `id` (required): Task ID to delete

**Response Format**:
```typescript
interface DeleteResult {
    success: boolean;
    message: string;
}
```

#### 3.5.5 `update_email_task_status`
**Description**: Update the status of an email marketing task
**Parameters**:
- `id` (required): Task ID to update
- `status` (required): New task status (1=Processing, 2=Complete, 3=Error)

**Response Format**:
```typescript
interface StatusUpdateResult {
    success: boolean;
    message: string;
    new_status: number;
    updated_at: string;
}
```

### 3.6 Task Management Tools

#### 3.6.1 `create_scraping_task`
**Description**: Create a new scraping task with scheduling
**Parameters**:
- `task_type` (required): "search_engine", "yellow_pages", "email_extraction"
- `task_config` (required): Task-specific configuration
- `schedule` (optional): Cron expression for recurring tasks
- `priority` (optional): Task priority level
- `notifications` (optional): Notification settings

#### 3.6.2 `get_task_status`
**Description**: Get current status of a scraping task
**Parameters**:
- `task_id` (required): Task identifier

#### 3.6.3 `get_task_results`
**Description**: Retrieve results from completed task
**Parameters**:
- `task_id` (required): Task identifier
- `format` (optional): "json", "csv", "xlsx"

### 3.7 Resource Management Tools

#### 3.7.1 `get_system_status`
**Description**: Get MCP server and system health status
**Response Format**:
```typescript
interface SystemStatus {
    mcp_server: {
        status: "healthy" | "degraded" | "down";
        uptime: number;
        active_connections: number;
        tools_registered: number;
    };
    aifetchly: {
        browser_instances: number;
        active_tasks: number;
        database_status: "connected" | "disconnected";
        memory_usage: number;
        cpu_usage: number;
    };
    last_updated: string;
}
```

#### 3.7.2 `export_data`
**Description**: Export data in various formats
**Parameters**:
- `data_type` (required): "search_results", "business_data", "emails", "campaigns"
- `format` (required): "json", "csv", "xlsx", "pdf"
- `filter` (optional): Data filtering options
- `date_range` (optional): Date range for data export

## 4. Technical Implementation

### 4.1 Official MCP TypeScript SDK Integration

#### 4.1.1 Dependencies and Setup
The MCP server implementation uses the official Model Context Protocol TypeScript SDK:

**Package Dependencies:**
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

**TypeScript Configuration:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Package.json Configuration:**
```json
{
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  }
}
```

#### 4.1.3 Core Server Implementation
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

class AiFetchlyMCPServer {
    private server: McpServer;
    private aiFetchlyController: AiFetchlyController;
    private loginStateMonitor: LoginStateMonitor;
    private transport: StdioServerTransport;
    
    constructor() {
        this.server = new McpServer({
            name: "aifetchly-mcp-server",
            version: "1.0.0"
        });
        this.aiFetchlyController = new AiFetchlyController();
        this.loginStateMonitor = new LoginStateMonitor();
        this.transport = new StdioServerTransport();
        this.registerTools();
    }
    
    private registerTools(): void {
        // Register search engine tools
        this.server.tool(
            "create_search_task",
            {
                title: "Create Search Task",
                description: "Create a new search engine scraping task",
                inputSchema: {
                    searchEnginer: z.string().describe("Search engine (google, bing)"),
                    keywords: z.array(z.string()).describe("Array of search keywords"),
                    num_pages: z.number().describe("Number of pages to scrape"),
                    concurrency: z.number().describe("Number of concurrent processes"),
                    notShowBrowser: z.boolean().describe("Run browser in headless mode"),
                    proxys: z.array(z.object({})).optional().describe("Array of proxy configurations"),
                    localBrowser: z.string().optional().describe("Local browser path"),
                    accounts: z.array(z.number()).optional().describe("Array of account IDs for authentication"),
                    cookies: z.array(z.array(z.object({}))).optional().describe("Array of cookie configurations")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleSearchEngine("create_search_task", params);
            }
        );
        
        this.server.tool(
            "list_search_tasks",
            {
                title: "List Search Tasks",
                description: "List all search engine tasks",
                inputSchema: {
                    page: z.number().optional().default(0).describe("Page number for pagination"),
                    size: z.number().optional().default(20).describe("Number of tasks per page"),
                    sortby: z.string().optional().describe("Sort by field (created_at, status, etc.)")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleSearchEngine("list_search_tasks", params);
            }
        );
        
        this.server.tool(
            "get_search_task",
            {
                title: "Get Search Task",
                description: "Get search task details by ID",
                inputSchema: {
                    task_id: z.number().describe("Task ID to retrieve")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleSearchEngine("get_search_task", params);
            }
        );
        
        this.server.tool(
            "get_search_results",
            {
                title: "Get Search Results",
                description: "Get results from a search task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to get results for"),
                    page: z.number().optional().default(0).describe("Page number for pagination"),
                    size: z.number().optional().default(20).describe("Number of results per page")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleSearchEngine("get_search_results", params);
            }
        );
        
        this.server.tool(
            "update_search_task",
            {
                title: "Update Search Task",
                description: "Update an existing search task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to update"),
                    searchEnginer: z.string().optional().describe("Updated search engine"),
                    keywords: z.array(z.string()).optional().describe("Updated search keywords"),
                    num_pages: z.number().optional().describe("Updated number of pages"),
                    concurrency: z.number().optional().describe("Updated concurrency setting"),
                    notShowBrowser: z.boolean().optional().describe("Updated headless mode setting"),
                    proxys: z.array(z.object({})).optional().describe("Updated proxy configurations"),
                    localBrowser: z.string().optional().describe("Updated local browser path"),
                    accounts: z.array(z.number()).optional().describe("Updated account IDs"),
                    cookies: z.array(z.array(z.object({}))).optional().describe("Updated cookie configurations")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleSearchEngine("update_search_task", params);
            }
        );
        
        this.server.tool(
            "delete_search_task",
            {
                title: "Delete Search Task",
                description: "Delete a search task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to delete")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleSearchEngine("delete_search_task", params);
            }
        );
        
        // Register yellow pages tools
        this.server.tool(
            "create_yellow_pages_task",
            {
                title: "Create Yellow Pages Task",
                description: "Create a new yellow pages scraping task",
                inputSchema: {
                    name: z.string().describe("Task name"),
                    platform: z.string().describe("Platform identifier (yellowpages.com, yelp.com, etc.)"),
                    keywords: z.array(z.string()).describe("Array of search keywords"),
                    location: z.string().optional().describe("City, state, or coordinates"),
                    max_pages: z.number().optional().describe("Maximum pages to scrape"),
                    concurrency: z.number().optional().describe("Number of concurrent processes"),
                    account_id: z.number().optional().describe("Account ID for authentication"),
                    proxy_config: z.object({}).optional().describe("Proxy configuration object"),
                    delay_between_requests: z.number().optional().describe("Delay between requests in milliseconds"),
                    headless: z.boolean().optional().describe("Run browser in headless mode"),
                    scheduled_at: z.string().optional().describe("Scheduled execution time")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleYellowPages("create_yellow_pages_task", params);
            }
        );
        
        this.server.tool(
            "get_yellow_pages_task",
            {
                title: "Get Yellow Pages Task",
                description: "Get yellow pages task by ID",
                inputSchema: {
                    task_id: z.number().describe("Task ID to retrieve")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleYellowPages("get_yellow_pages_task", params);
            }
        );
        
        this.server.tool(
            "list_yellow_pages_tasks",
            {
                title: "List Yellow Pages Tasks",
                description: "List all yellow pages tasks with optional filtering",
                inputSchema: {
                    page: z.number().optional().default(0).describe("Page number for pagination"),
                    size: z.number().optional().default(20).describe("Number of tasks per page"),
                    status: z.string().optional().describe("Filter by task status"),
                    platform: z.string().optional().describe("Filter by platform")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleYellowPages("list_yellow_pages_tasks", params);
            }
        );
        
        this.server.tool(
            "start_yellow_pages_task",
            {
                title: "Start Yellow Pages Task",
                description: "Start a yellow pages scraping task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to start")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleYellowPages("start_yellow_pages_task", params);
            }
        );
        
        this.server.tool(
            "stop_yellow_pages_task",
            {
                title: "Stop Yellow Pages Task",
                description: "Stop a running yellow pages scraping task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to stop")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleYellowPages("stop_yellow_pages_task", params);
            }
        );
        
        this.server.tool(
            "get_yellow_pages_results",
            {
                title: "Get Yellow Pages Results",
                description: "Get results from a yellow pages task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to get results for"),
                    page: z.number().optional().default(0).describe("Page number for pagination"),
                    size: z.number().optional().default(20).describe("Number of results per page")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleYellowPages("get_yellow_pages_results", params);
            }
        );
        
        // Register email extraction tools
        this.server.tool(
            "create_email_extraction_task",
            {
                title: "Create Email Extraction Task",
                description: "Create a new email extraction task",
                inputSchema: {
                    validUrls: z.array(z.string().url()).describe("Array of website URLs to extract emails from"),
                    searchResultId: z.number().optional().describe("Search result ID if this is a follow-up task"),
                    concurrency: z.number().describe("Number of concurrent processes"),
                    pagelength: z.number().describe("Number of pages to process per URL"),
                    notShowBrowser: z.boolean().describe("Run browser in headless mode"),
                    proxys: z.array(z.object({})).optional().describe("Array of proxy configurations"),
                    type: z.number().describe("Email extraction type (1=basic, 2=advanced, etc.)"),
                    processTimeout: z.number().describe("Process timeout in seconds"),
                    maxPageNumber: z.number().optional().describe("Maximum number of pages to process")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailExtraction("create_email_extraction_task", params);
            }
        );
        
        this.server.tool(
            "list_email_extraction_tasks",
            {
                title: "List Email Extraction Tasks",
                description: "List all email extraction tasks",
                inputSchema: {
                    page: z.number().optional().default(0).describe("Page number for pagination"),
                    size: z.number().optional().default(20).describe("Number of tasks per page"),
                    sortby: z.string().optional().describe("Sort by field (created_at, status, etc.)")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailExtraction("list_email_extraction_tasks", params);
            }
        );
        
        this.server.tool(
            "get_email_extraction_task",
            {
                title: "Get Email Extraction Task",
                description: "Get email extraction task details by ID",
                inputSchema: {
                    task_id: z.number().describe("Task ID to retrieve")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailExtraction("get_email_extraction_task", params);
            }
        );
        
        this.server.tool(
            "get_email_extraction_results",
            {
                title: "Get Email Extraction Results",
                description: "Get results from an email extraction task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to get results for"),
                    page: z.number().optional().default(0).describe("Page number for pagination"),
                    size: z.number().optional().default(20).describe("Number of results per page")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailExtraction("get_email_extraction_results", params);
            }
        );
        
        this.server.tool(
            "update_email_extraction_task",
            {
                title: "Update Email Extraction Task",
                description: "Update an existing email extraction task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to update"),
                    validUrls: z.array(z.string().url()).optional().describe("Updated array of website URLs"),
                    concurrency: z.number().optional().describe("Updated concurrency setting"),
                    pagelength: z.number().optional().describe("Updated page length setting"),
                    notShowBrowser: z.boolean().optional().describe("Updated headless mode setting"),
                    proxys: z.array(z.object({})).optional().describe("Updated proxy configurations"),
                    type: z.number().optional().describe("Updated extraction type"),
                    processTimeout: z.number().optional().describe("Updated process timeout"),
                    maxPageNumber: z.number().optional().describe("Updated maximum page number")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailExtraction("update_email_extraction_task", params);
            }
        );
        
        this.server.tool(
            "delete_email_extraction_task",
            {
                title: "Delete Email Extraction Task",
                description: "Delete an email extraction task",
                inputSchema: {
                    task_id: z.number().describe("Task ID to delete")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailExtraction("delete_email_extraction_task", params);
            }
        );
        
        // Register email marketing tools
        this.server.tool(
            "create_email_task",
            {
                title: "Create Email Marketing Task",
                description: "Create a new email marketing task",
                inputSchema: {
                    task_name: z.string().describe("Name of the email marketing task"),
                    task_desc: z.string().optional().describe("Description of the email marketing task"),
                    status: z.number().optional().default(1).describe("Task status (1=Processing, 2=Complete, 3=Error)")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailMarketing("create_email_task", params);
            }
        );
        
        this.server.tool(
            "get_email_task",
            {
                title: "Get Email Marketing Task",
                description: "Get email marketing task by ID",
                inputSchema: {
                    id: z.number().describe("Task ID to retrieve")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailMarketing("get_email_task", params);
            }
        );
        
        this.server.tool(
            "update_email_task",
            {
                title: "Update Email Marketing Task",
                description: "Update an existing email marketing task",
                inputSchema: {
                    id: z.number().describe("Task ID to update"),
                    task_name: z.string().optional().describe("Updated task name"),
                    task_desc: z.string().optional().describe("Updated task description"),
                    status: z.number().optional().describe("Updated task status (1=Processing, 2=Complete, 3=Error)")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailMarketing("update_email_task", params);
            }
        );
        
        this.server.tool(
            "delete_email_task",
            {
                title: "Delete Email Marketing Task",
                description: "Delete an email marketing task",
                inputSchema: {
                    id: z.number().describe("Task ID to delete")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailMarketing("delete_email_task", params);
            }
        );
        
        this.server.tool(
            "update_email_task_status",
            {
                title: "Update Email Task Status",
                description: "Update the status of an email marketing task",
                inputSchema: {
                    id: z.number().describe("Task ID to update"),
                    status: z.number().describe("New task status (1=Processing, 2=Complete, 3=Error)")
                }
            },
            async (params) => {
                await this.validateLoginState();
                return await this.aiFetchlyController.handleEmailMarketing("update_email_task_status", params);
            }
        );
        
        // Register system status tool
        this.server.tool(
            "get_system_status",
            {
                title: "System Status",
                description: "Get MCP server and system health status",
                inputSchema: {}
            },
            async () => {
                return await this.getSystemStatus();
            }
        );
    }
    
    async start(): Promise<void> {
        // Start MCP server with stdio transport
        await this.server.connect(this.transport);
        this.startLoginStateMonitoring();
        console.log("aiFetchly MCP Server started successfully");
    }
    
    private async validateLoginState(): Promise<void> {
        const isLoggedIn = await this.loginStateMonitor.checkLoginState();
        if (!isLoggedIn) {
            throw new Error("aiFetchly application must be logged in and running to use MCP tools");
        }
    }
    
    private startLoginStateMonitoring(): void {
        // Monitor aiFetchly login state changes
        this.loginStateMonitor.onLoginStateChange((isLoggedIn) => {
            console.log(`aiFetchly login state changed: ${isLoggedIn ? 'logged in' : 'logged out'}`);
        });
    }
    
    private async getSystemStatus(): Promise<any> {
        const userContext = await this.loginStateMonitor.getCurrentUserContext();
        return {
            mcp_server: {
                status: "healthy",
                uptime: process.uptime(),
                tools_registered: this.server.getToolCount(),
                version: "1.0.0"
            },
            aifetchly: userContext?.application_state || {
                is_running: false,
                is_logged_in: false,
                browser_instances: 0,
                database_connected: false
            },
            last_updated: new Date().toISOString()
        };
    }
}
```

#### 4.1.4 Tool Implementation Pattern
```typescript
// Tool implementations using the official MCP SDK
import { z } from "zod";

// Example tool implementation pattern
class SearchEngineTool {
    constructor(
        private aiFetchlyController: AiFetchlyController,
        private loginStateMonitor: LoginStateMonitor
    ) {}
    
    async executeGoogleSearch(params: {
        query: string;
        pages?: number;
    }) {
        // Validate login state
        await this.validateLoginState();
        
        // Execute the search
        const result = await this.aiFetchlyController.handleSearchEngine("search_google", params);
        
        // Return MCP-compliant response
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }
            ]
        };
    }
    
    private async validateLoginState(): Promise<void> {
        const isLoggedIn = await this.loginStateMonitor.checkLoginState();
        if (!isLoggedIn) {
            throw new Error("aiFetchly application must be logged in and running");
        }
        
        const userContext = await this.loginStateMonitor.getCurrentUserContext();
        if (!userContext?.application_state.is_running) {
            throw new Error('aiFetchly application is not running');
        }
        
        if (!userContext.application_state.is_logged_in) {
            throw new Error('User is not logged into aiFetchly application');
        }
        
        if (!userContext.application_state.database_connected) {
            throw new Error('Database connection is not available');
        }
        
        if (userContext.application_state.browser_instances <= 0) {
            throw new Error('No browser instances available');
        }
    }
}
```

#### 4.1.5 MCP Server Startup and Integration
```typescript
// Main entry point for the MCP server
import { AiFetchlyMCPServer } from './mcp-server.js';
import { LoginStateMonitor } from './LoginStateMonitor.js';

async function main() {
    try {
        console.log('Starting aiFetchly MCP Server...');
        
        // Initialize login state monitor
        const loginStateMonitor = new LoginStateMonitor();
        
        // Create and start MCP server
        const mcpServer = new AiFetchlyMCPServer(loginStateMonitor);
        await mcpServer.start();
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('Received SIGINT, shutting down MCP Server...');
            await mcpServer.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM, shutting down MCP Server...');
            await mcpServer.stop();
            process.exit(0);
        });

        // Handle login state changes from parent process
        process.stdin.on('data', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'loginStateChange') {
                    console.log('Received login state change:', message.isLoggedIn);
                    loginStateMonitor.updateLoginState(message.isLoggedIn);
                }
            } catch (error) {
                console.error('Error parsing message from parent process:', error);
            }
        });

        // Initialize login state from environment variable
        const initialLoginState = process.env.AIFETCHLY_LOGIN_STATE === 'true';
        loginStateMonitor.updateLoginState(initialLoginState);
        
        console.log('MCP Server started successfully');
        
    } catch (error) {
        console.error('Failed to start MCP Server:', error);
        process.exit(1);
    }
}

// Start the server
main().catch(console.error);
```

#### 4.1.6 MCP Server Integration with aiFetchly

The MCP server will be automatically started when the Electron app starts and integrated into the main application lifecycle:

##### 4.1.6.1 Main Process Integration

```typescript
// src/background.ts (Main Process)
import { app, BrowserWindow, ipcMain } from 'electron';
import { MCPIntegration } from './mcp/MCPIntegration';
import { LoginStateMonitor } from './mcp/LoginStateMonitor';

class AiFetchlyApp {
    private mainWindow: BrowserWindow | null = null;
    private mcpIntegration: MCPIntegration;
    private loginStateMonitor: LoginStateMonitor;

    constructor() {
        this.mcpIntegration = new MCPIntegration();
        this.loginStateMonitor = new LoginStateMonitor();
    }

    async initialize(): Promise<void> {
        // Initialize the main window
        await this.createMainWindow();
        
        // Start MCP server when app is ready
        await this.startMCPServer();
        
        // Initialize login state monitoring
        await this.initializeLoginStateMonitoring();
        
        // Set up IPC handlers for MCP communication
        this.setupMCPIPC();
    }

    private async startMCPServer(): Promise<void> {
        try {
            console.log('Starting MCP Server...');
            await this.mcpIntegration.startMCPServer();
            console.log('MCP Server started successfully');
        } catch (error) {
            console.error('Failed to start MCP Server:', error);
            // Don't fail the entire app if MCP server fails to start
            // The app can still function without MCP server
        }
    }

    private async initializeLoginStateMonitoring(): Promise<void> {
        // Start monitoring login state for MCP server
        this.loginStateMonitor.startMonitoring();
        
        // Listen for login state changes
        this.loginStateMonitor.on('loginStateChanged', (isLoggedIn) => {
            console.log('Login state changed:', isLoggedIn);
            // Notify MCP server about login state changes
            this.mcpIntegration.notifyLoginStateChange(isLoggedIn);
        });
    }

    private setupMCPIPC(): void {
        // IPC handlers for MCP server communication
        ipcMain.handle('mcp:get-status', () => {
            return {
                isRunning: this.mcpIntegration.isMCPServerRunning(),
                loginState: this.loginStateMonitor.getCurrentLoginState()
            };
        });

        ipcMain.handle('mcp:restart', async () => {
            try {
                await this.mcpIntegration.stopMCPServer();
                await this.mcpIntegration.startMCPServer();
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        });
    }

    async shutdown(): Promise<void> {
        // Stop MCP server when app is closing
        await this.mcpIntegration.stopMCPServer();
        this.loginStateMonitor.stopMonitoring();
    }
}

// App lifecycle management
const aiFetchlyApp = new AiFetchlyApp();

app.whenReady().then(async () => {
    await aiFetchlyApp.initialize();
});

app.on('window-all-closed', async () => {
    await aiFetchlyApp.shutdown();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        await aiFetchlyApp.initialize();
    }
});

app.on('before-quit', async () => {
    await aiFetchlyApp.shutdown();
});
```

##### 4.1.6.2 Enhanced MCP Integration Class

```typescript
// src/mcp/MCPIntegration.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

export class MCPIntegration extends EventEmitter {
    private mcpProcess: ChildProcess | null = null;
    private isRunning = false;
    private loginState = false;

    async startMCPServer(): Promise<void> {
        if (this.isRunning) {
            console.log('MCP Server is already running');
            return;
        }

        try {
            // Get the path to the compiled MCP server
            const mcpServerPath = path.join(__dirname, 'mcp-server', 'main.js');
            
            // Start the MCP server as a child process
            this.mcpProcess = spawn('node', [mcpServerPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    // Pass login state to MCP server
                    AIFETCHLY_LOGIN_STATE: this.loginState.toString()
                }
            });

            // Handle MCP server output
            this.mcpProcess.stdout?.on('data', (data) => {
                console.log('MCP Server:', data.toString());
            });

            this.mcpProcess.stderr?.on('data', (data) => {
                console.error('MCP Server Error:', data.toString());
            });

            this.mcpProcess.on('error', (error) => {
                console.error('MCP Server error:', error);
                this.emit('error', error);
            });

            this.mcpProcess.on('exit', (code) => {
                console.log(`MCP Server exited with code ${code}`);
                this.isRunning = false;
                this.emit('exit', code);
            });

            this.isRunning = true;
            console.log('MCP Server started successfully');
            this.emit('started');

        } catch (error) {
            console.error('Failed to start MCP Server:', error);
            throw error;
        }
    }

    async stopMCPServer(): Promise<void> {
        if (!this.mcpProcess || !this.isRunning) {
            return;
        }

        try {
            this.mcpProcess.kill('SIGTERM');
            this.isRunning = false;
            console.log('MCP Server stopped');
            this.emit('stopped');
        } catch (error) {
            console.error('Failed to stop MCP Server:', error);
            throw error;
        }
    }

    notifyLoginStateChange(isLoggedIn: boolean): void {
        this.loginState = isLoggedIn;
        // Send login state change to MCP server via stdin
        if (this.mcpProcess && this.mcpProcess.stdin) {
            this.mcpProcess.stdin.write(JSON.stringify({
                type: 'loginStateChange',
                isLoggedIn: isLoggedIn
            }) + '\n');
        }
    }

    isMCPServerRunning(): boolean {
        return this.isRunning;
    }

    getLoginState(): boolean {
        return this.loginState;
    }
}
```

##### 4.1.6.3 Application Startup Sequence

The MCP server startup follows this sequence when the Electron app starts:

1. **Electron App Ready**: `app.whenReady()` event fires
2. **Main Window Creation**: Create the main BrowserWindow
3. **MCP Server Startup**: Start MCP server as child process
4. **Login State Monitoring**: Initialize login state monitoring
5. **IPC Setup**: Set up IPC handlers for MCP communication
6. **Ready State**: Application is fully ready for MCP operations

**Startup Flow Diagram:**
```
Electron App Start
    ↓
App Ready Event
    ↓
Create Main Window
    ↓
Start MCP Server (Child Process)
    ↓
Initialize Login State Monitor
    ↓
Setup IPC Handlers
    ↓
Application Ready
    ↓
MCP Tools Available
```

##### 4.1.6.4 Build Configuration

The MCP server will be built as part of the main application build process:

```json
// package.json
{
  "scripts": {
    "build": "npm run build:main && npm run build:renderer && npm run build:mcp-server",
    "build:mcp-server": "tsc -p tsconfig.mcp-server.json",
    "dev": "concurrently \"npm run dev:main\" \"npm run dev:renderer\" \"npm run dev:mcp-server\"",
    "dev:mcp-server": "tsc -p tsconfig.mcp-server.json --watch"
  }
}
```

```json
// tsconfig.mcp-server.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/mcp-server",
    "rootDir": "./src/mcp-server",
    "module": "ESNext",
    "target": "ES2020"
  },
  "include": ["src/mcp-server/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

##### 4.1.6.5 Error Handling and Recovery

The MCP server includes robust error handling and recovery mechanisms:

```typescript
// Error handling in MCPIntegration
class MCPIntegration extends EventEmitter {
    private retryCount = 0;
    private maxRetries = 3;
    private retryDelay = 5000; // 5 seconds

    async startMCPServer(): Promise<void> {
        try {
            // ... existing startup code ...
        } catch (error) {
            console.error('Failed to start MCP Server:', error);
            
            // Implement retry logic
            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`Retrying MCP Server startup (${this.retryCount}/${this.maxRetries})...`);
                
                setTimeout(() => {
                    this.startMCPServer();
                }, this.retryDelay);
            } else {
                console.error('Max retries reached. MCP Server will not start.');
                this.emit('failed', error);
            }
        }
    }

    // Auto-restart on unexpected exit
    private setupAutoRestart(): void {
        this.mcpProcess?.on('exit', (code) => {
            if (code !== 0) {
                console.log('MCP Server exited unexpectedly, attempting restart...');
                setTimeout(() => {
                    this.startMCPServer();
                }, this.retryDelay);
            }
        });
    }
}
```

### 4.2 Integration with Existing Controllers

#### 4.2.1 MCP Controller
```typescript
class MCPController {
    private yellowPagesController: YellowPagesController;
    private emailExtractionController: EmailExtractionController;
    private searchEngineController: SearchEngineController;
    private emailMarketingController: EmailMarketingController;
    private loginStateMonitor: LoginStateMonitor;
    
    constructor() {
        this.yellowPagesController = YellowPagesController.getInstance();
        this.loginStateMonitor = new LoginStateMonitor();
        // Initialize other controllers
    }
    
    async handleRequest(toolName: string, parameters: any, userContext: UserContext): Promise<any> {
        // Validate login state and resource availability
        this.validateLoginState(userContext);
        
        // Route to appropriate controller based on tool category
        const toolCategory = this.getToolCategory(toolName);
        
        switch (toolCategory) {
            case 'search_engine':
                return await this.searchEngineController.handleMCPRequest(toolName, parameters, userContext);
            case 'yellow_pages':
                return await this.yellowPagesController.handleMCPRequest(toolName, parameters, userContext);
            case 'email_extraction':
                return await this.emailExtractionController.handleMCPRequest(toolName, parameters, userContext);
            case 'email_marketing':
                return await this.emailMarketingController.handleMCPRequest(toolName, parameters, userContext);
            default:
                throw new Error(`Unknown tool category: ${toolCategory}`);
        }
    }
    
    private validateLoginState(userContext: UserContext): void {
        if (!userContext.application_state.is_running) {
            throw new Error('aiFetchly application is not running');
        }
        
        if (!userContext.application_state.is_logged_in) {
            throw new Error('User is not logged into aiFetchly application');
        }
        
        if (!userContext.application_state.database_connected) {
            throw new Error('Database connection is not available');
        }
    }
    
    private getToolCategory(toolName: string): string {
        // Map tool names to categories
        const toolCategories = {
            'search_google': 'search_engine',
            'search_bing': 'search_engine',
            'scrape_yellow_pages': 'yellow_pages',
            'extract_emails_from_website': 'email_extraction',
            'create_email_campaign': 'email_marketing',
            // ... map all tools
        };
        
        return toolCategories[toolName] || 'unknown';
    }
    
    async checkLoginState(): Promise<boolean> {
        return await this.loginStateMonitor.checkLoginState();
    }
    
    async getCurrentUserContext(): Promise<UserContext | null> {
        return await this.loginStateMonitor.getCurrentUserContext();
    }
    
    notifyLoginStateChange(isLoggedIn: boolean): void {
        this.loginStateMonitor.notifyLoginStateChange(isLoggedIn);
    }
}
```

### 4.3 Login State Management Implementation

#### 4.3.1 LoginStateMonitor
```typescript
class LoginStateMonitor {
    private aiFetchlyApp: AiFetchlyApplication;
    private userContext: UserContext | null = null;
    private loginStateListeners: ((isLoggedIn: boolean) => void)[] = [];
    
    constructor() {
        this.aiFetchlyApp = AiFetchlyApplication.getInstance();
        this.setupLoginStateMonitoring();
    }
    
    async checkLoginState(): Promise<boolean> {
        try {
            // Check if aiFetchly application is running
            const isRunning = await this.aiFetchlyApp.isRunning();
            if (!isRunning) {
                return false;
            }
            
            // Check if user is logged in
            const isLoggedIn = await this.aiFetchlyApp.isUserLoggedIn();
            if (!isLoggedIn) {
                return false;
            }
            
            // Check if database is connected
            const isDbConnected = await this.aiFetchlyApp.isDatabaseConnected();
            if (!isDbConnected) {
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Error checking login state:', error);
            return false;
        }
    }
    
    async getCurrentUserContext(): Promise<UserContext | null> {
        try {
            const isLoggedIn = await this.checkLoginState();
            if (!isLoggedIn) {
                return null;
            }
            
            // Get current user info from aiFetchly
            const userInfo = await this.aiFetchlyApp.getCurrentUserInfo();
            const appState = await this.aiFetchlyApp.getApplicationState();
            
            this.userContext = {
                user_id: userInfo.id,
                username: userInfo.username,
                subscription_tier: userInfo.subscription_tier,
                session_info: {
                    session_id: userInfo.session_id,
                    expires_at: userInfo.session_expires_at,
                    last_activity: userInfo.last_activity
                },
                application_state: {
                    is_running: appState.is_running,
                    is_logged_in: appState.is_logged_in,
                    browser_instances: appState.browser_instances,
                    database_connected: appState.database_connected
                }
            };
            
            return this.userContext;
        } catch (error) {
            console.error('Error getting user context:', error);
            return null;
        }
    }
    
    private setupLoginStateMonitoring(): void {
        // Listen for login state changes from aiFetchly
        this.aiFetchlyApp.onLoginStateChange((isLoggedIn) => {
            this.notifyLoginStateChange(isLoggedIn);
        });
        
        // Periodic check for login state
        setInterval(async () => {
            const isLoggedIn = await this.checkLoginState();
            if (this.userContext && !isLoggedIn) {
                this.notifyLoginStateChange(false);
            }
        }, 30000); // Check every 30 seconds
    }
    
    onLoginStateChange(callback: (isLoggedIn: boolean) => void): void {
        this.loginStateListeners.push(callback);
    }
    
    private notifyLoginStateChange(isLoggedIn: boolean): void {
        this.loginStateListeners.forEach(callback => callback(isLoggedIn));
    }
}
```

#### 4.3.2 AiFetchlyApplication Integration
```typescript
class AiFetchlyApplication {
    private static instance: AiFetchlyApplication;
    private loginStateListeners: ((isLoggedIn: boolean) => void)[] = [];
    
    static getInstance(): AiFetchlyApplication {
        if (!this.instance) {
            this.instance = new AiFetchlyApplication();
        }
        return this.instance;
    }
    
    async isRunning(): Promise<boolean> {
        // Check if the Electron main process is running
        return process.uptime() > 0;
    }
    
    async isUserLoggedIn(): Promise<boolean> {
        // Check with existing aiFetchly login system
        // This would integrate with your existing authentication
        const accountCookiesModule = new AccountCookiesModule();
        return await accountCookiesModule.isUserLoggedIn();
    }
    
    async isDatabaseConnected(): Promise<boolean> {
        // Check database connection status
        try {
            // This would check your existing database connection
            return true; // Simplified for example
        } catch (error) {
            return false;
        }
    }
    
    async getCurrentUserInfo(): Promise<any> {
        // Get current user information from aiFetchly
        const accountCookiesModule = new AccountCookiesModule();
        return await accountCookiesModule.getCurrentUserInfo();
    }
    
    async getApplicationState(): Promise<any> {
        const browserManager = new BrowserManager();
        
        return {
            is_running: await this.isRunning(),
            is_logged_in: await this.isUserLoggedIn(),
            browser_instances: browserManager.getActiveInstanceCount(),
            database_connected: await this.isDatabaseConnected()
        };
    }
    
    onLoginStateChange(callback: (isLoggedIn: boolean) => void): void {
        this.loginStateListeners.push(callback);
    }
    
    notifyLoginStateChange(isLoggedIn: boolean): void {
        this.loginStateListeners.forEach(callback => callback(isLoggedIn));
    }
}
```

### 4.4 New Controller Implementations

#### 4.4.1 Search Engine Controller
```typescript
class SearchEngineController extends BaseController {
    private searchEngineModule: SearchEngineModule;
    private browserManager: BrowserManager;
    
    async searchGoogle(parameters: GoogleSearchParameters): Promise<GoogleSearchResult> {
        // Implement Google search logic
    }
    
    async searchBing(parameters: BingSearchParameters): Promise<BingSearchResult> {
        // Implement Bing search logic
    }
    
    async searchDuckDuckGo(parameters: DuckDuckGoSearchParameters): Promise<DuckDuckGoSearchResult> {
        // Implement DuckDuckGo search logic
    }
}
```

#### 4.4.2 Email Marketing Controller
```typescript
class EmailMarketingController extends BaseController {
    private emailMarketingModule: EmailMarketingModule;
    private emailTemplateModule: EmailTemplateModule;
    private campaignAnalyticsModule: CampaignAnalyticsModule;
    
    async createCampaign(parameters: CreateCampaignParameters): Promise<EmailCampaignResult> {
        // Implement campaign creation logic
    }
    
    async sendCampaign(campaignId: string): Promise<SendCampaignResult> {
        // Implement campaign sending logic
    }
    
    async getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
        // Implement analytics retrieval
    }
}
```

### 4.5 Database Schema Extensions

#### 4.5.1 MCP Request Logging
```typescript
@Entity()
export class MCPRequestLog {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column()
    user_id: string;
    
    @Column()
    tool_name: string;
    
    @Column("json")
    parameters: any;
    
    @Column("json", { nullable: true })
    response: any;
    
    @Column()
    status: "success" | "error" | "login_required" | "app_not_running";
    
    @Column({ nullable: true })
    error_message: string;
    
    @Column()
    processing_time: number;
    
    @Column()
    login_state: {
        is_running: boolean;
        is_logged_in: boolean;
        database_connected: boolean;
        browser_instances: number;
    };
    
    @CreateDateColumn()
    created_at: Date;
}
```

#### 4.5.2 Login State Monitoring
```typescript
@Entity()
export class LoginStateLog {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column()
    user_id: string;
    
    @Column()
    event_type: "login" | "logout" | "app_start" | "app_stop" | "session_expired";
    
    @Column("json")
    application_state: {
        is_running: boolean;
        is_logged_in: boolean;
        database_connected: boolean;
        browser_instances: number;
    };
    
    @Column({ nullable: true })
    error_message: string;
    
    @CreateDateColumn()
    created_at: Date;
}
```

### 4.6 Database Schema Extensions

#### 4.6.1 Search Engine Results
```typescript
@Entity()
export class SearchEngineResult {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column()
    taskId: number;
    
    @Column()
    searchEngine: string;
    
    @Column()
    query: string;
    
    @Column("json")
    results: any;
    
    @Column()
    totalResults: number;
    
    @CreateDateColumn()
    createdAt: Date;
    
    @UpdateDateColumn()
    updatedAt: Date;
}
```

#### 4.6.2 Email Campaigns
```typescript
@Entity()
export class EmailCampaign {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column()
    name: string;
    
    @Column()
    subject: string;
    
    @Column("text")
    template: string;
    
    @Column("json")
    recipients: string[];
    
    @Column("json")
    senderConfig: any;
    
    @Column({
        type: "enum",
        enum: ["created", "scheduled", "sending", "completed", "failed"]
    })
    status: string;
    
    @Column({ nullable: true })
    scheduledAt: Date;
    
    @Column({ nullable: true })
    sentAt: Date;
    
    @Column("json", { nullable: true })
    analytics: any;
    
    @CreateDateColumn()
    createdAt: Date;
    
    @UpdateDateColumn()
    updatedAt: Date;
}
```

### 4.7 Configuration and Environment

#### 4.7.1 MCP Server Configuration
```typescript
interface MCPServerConfig {
    server: {
        name: string;
        version: string;
        port?: number;
        host?: string;
    };
    tools: {
        search_engines: {
            enabled: string[];
            rate_limits: { [engine: string]: number };
            proxies?: string[];
        };
        yellow_pages: {
            enabled_platforms: string[];
            max_results_per_request: number;
            rate_limits: { [platform: string]: number };
        };
        email: {
            extraction: {
                max_pages_per_site: number;
                timeout_per_page: number;
                validation_enabled: boolean;
            };
            marketing: {
                smtp_configs: any[];
                tracking_enabled: boolean;
                unsubscribe_link_required: boolean;
            };
        };
    };
    security: {
        api_keys: { [service: string]: string };
        rate_limiting: {
            requests_per_minute: number;
            burst_size: number;
        };
        allowed_origins: string[];
    };
    login_state: {
        check_interval: number; // milliseconds
        timeout_threshold: number; // milliseconds
        retry_attempts: number;
        monitoring_enabled: boolean;
    };
}
```

## 5. Security and Compliance

### 5.1 Data Privacy and Protection
- **GDPR Compliance**: Implement data protection measures for EU users
- **Email Privacy**: Respect robots.txt and email harvesting policies
- **Data Encryption**: Encrypt sensitive data at rest and in transit
- **Access Control**: Implement role-based access control for MCP tools
- **Audit Logging**: Log all MCP tool calls and data access

### 5.2 Login State Security
- **Application State Validation**: Verify aiFetchly is running and responsive
- **Session Validation**: Ensure user session is active and not expired
- **Resource Availability**: Check browser instances and database connectivity
- **State Monitoring**: Continuous monitoring of login state changes
- **Error Handling**: Graceful handling of login state failures
- **Logging**: Comprehensive logging of login state events
- **Recovery**: Automatic recovery when login state is restored

### 5.3 Web Scraping Ethics and Legal Compliance
- **Rate Limiting**: Implement respectful rate limiting for all platforms
- **Robots.txt Compliance**: Respect website scraping policies
- **Terms of Service**: Ensure compliance with platform ToS
- **User Agent Identification**: Use appropriate user agent strings
- **IP Rotation**: Implement IP rotation to avoid blocking

### 5.4 Email Marketing Compliance
- **CAN-SPAM Compliance**: Implement required unsubscribe mechanisms
- **GDPR Email Consent**: Ensure proper consent for email marketing
- **Bounce Handling**: Implement proper bounce and complaint handling
- **Sender Reputation**: Monitor and maintain sender reputation
- **Authentication**: Implement SPF, DKIM, and DMARC authentication

## 6. Performance and Scalability

### 6.1 Performance Requirements
- **MCP Response Time**: Sub-500ms for simple tool calls
- **Concurrent Requests**: Support 50+ concurrent MCP connections
- **Scraping Performance**: Process 1000+ pages per hour per browser instance
- **Email Sending**: Send 10,000+ emails per hour with proper throttling
- **Memory Usage**: Optimize for <2GB memory usage per browser instance

### 6.2 Scalability Architecture
- **Horizontal Scaling**: Support multiple MCP server instances
- **Load Balancing**: Distribute tool calls across available resources
- **Queue Management**: Implement task queuing for resource-intensive operations
- **Caching**: Cache frequently accessed data and results
- **Database Optimization**: Implement proper indexing and query optimization

### 6.3 Monitoring and Metrics
- **Performance Monitoring**: Track response times and throughput
- **Error Monitoring**: Monitor and alert on error rates
- **Resource Monitoring**: Track CPU, memory, and network usage
- **Business Metrics**: Track success rates and data quality
- **Health Checks**: Implement comprehensive health check endpoints

## 7. Development Phases and Timeline

### 7.1 Phase 1: MCP Server Foundation (4-6 weeks)
**Objectives:**
- Implement core MCP server protocol
- Create basic tool registry and request handling
- Integrate with existing aiFetchly architecture
- Implement basic search engine scraping tools

**Deliverables:**
- MCP server core implementation
- Basic search engine tools (Google, Bing)
- Integration with existing browser manager
- Basic error handling and logging
- Initial documentation and testing

**Success Criteria:**
- MCP server responds to basic protocol requests
- Google and Bing search tools functional
- Integration with existing architecture complete
- Basic performance benchmarks met

### 7.2 Phase 2: Yellow Pages Integration (3-4 weeks)
**Objectives:**
- Integrate existing yellow pages functionality with MCP tools
- Extend yellow pages scraping capabilities
- Implement business data extraction and validation
- Add support for additional yellow pages platforms

**Deliverables:**
- Yellow pages MCP tools implementation
- Extended platform support
- Business data validation and enrichment
- Bulk scraping capabilities
- Performance optimization

**Success Criteria:**
- Yellow pages tools fully functional through MCP
- Support for 5+ yellow pages platforms
- Data accuracy >95% compared to manual verification
- Performance targets met for bulk operations

### 7.3 Phase 3: Email System Implementation (4-5 weeks)
**Objectives:**
- Implement email extraction from websites
- Create email validation and enrichment system
- Develop email marketing campaign management
- Implement email analytics and tracking

**Deliverables:**
- Email extraction MCP tools
- Email validation and verification system
- Email campaign creation and management tools
- Email analytics and reporting system
- Compliance and deliverability features

**Success Criteria:**
- Email extraction accuracy >90%
- Email validation accuracy >95%
- Email campaign deliverability >95%
- Full compliance with email marketing regulations

### 7.4 Phase 4: Advanced Features and Optimization (3-4 weeks)
**Objectives:**
- Implement advanced task management and scheduling
- Add data export and reporting capabilities
- Optimize performance and add caching
- Implement comprehensive monitoring and alerting

**Deliverables:**
- Advanced task management tools
- Data export and reporting system
- Performance optimization and caching
- Monitoring and alerting system
- Comprehensive documentation

**Success Criteria:**
- All performance targets met
- Comprehensive monitoring in place
- Full documentation complete
- System ready for production deployment

### 7.5 Phase 5: Testing and Production Deployment (2-3 weeks)
**Objectives:**
- Comprehensive testing of all MCP tools
- Performance and load testing
- Security testing and compliance verification
- Production deployment and monitoring setup

**Deliverables:**
- Complete test suite
- Load and performance test results
- Security audit and compliance verification
- Production deployment scripts
- Monitoring and alerting configuration

**Success Criteria:**
- All tests passing with >95% coverage
- Performance targets met under load
- Security and compliance verified
- Successful production deployment

## 8. Risk Assessment and Mitigation

### 8.1 Technical Risks
- **MCP Protocol Changes**: Monitor MCP specification updates and maintain compatibility
- **Platform API Changes**: Implement robust error handling for platform changes
- **Performance Degradation**: Implement comprehensive monitoring and optimization
- **Integration Complexity**: Use established patterns from existing aiFetchly architecture

### 8.2 Business Risks
- **Legal Compliance**: Regular legal review of scraping practices
- **Platform Blocking**: Implement IP rotation and respectful scraping practices
- **Email Deliverability**: Monitor sender reputation and implement best practices
- **Data Quality**: Implement validation and verification at multiple levels

### 8.3 Operational Risks
- **System Downtime**: Implement redundancy and failover mechanisms
- **Data Loss**: Implement comprehensive backup and recovery procedures
- **Security Breaches**: Implement defense-in-depth security measures
- **Resource Exhaustion**: Implement proper resource management and monitoring

## 9. Success Criteria and KPIs

### 9.1 Technical KPIs
- **MCP Protocol Compliance**: 100% specification compliance
- **Tool Response Time**: <500ms average response time
- **System Uptime**: 99.9% uptime target
- **Error Rate**: <1% error rate for all tool calls
- **Concurrent Users**: Support 50+ concurrent MCP connections
- **Login State Detection**: <100ms average login state check time
- **State Recovery**: <5 seconds to recover when login state is restored
- **Monitoring Accuracy**: >99% accurate login state detection

### 9.2 Business KPIs
- **Data Accuracy**: >95% accuracy for all scraped data
- **Search Coverage**: Support 10+ search engines and platforms
- **Email Deliverability**: >95% email delivery rate
- **User Adoption**: Integration with 5+ AI assistant platforms
- **Performance**: Process 10,000+ data points per hour

### 9.3 Quality KPIs
- **Test Coverage**: >90% code coverage
- **Documentation**: Complete API documentation and user guides
- **Security**: Pass security audit with no critical issues
- **Compliance**: Full compliance with relevant regulations
- **User Satisfaction**: Positive feedback from integration partners

## 10. Conclusion

The MCP Server Integration represents a significant enhancement to the aiFetchly platform, extending its capabilities to serve as a comprehensive AI-powered scraping and marketing automation service. By implementing the Model Context Protocol, aiFetchly will become accessible to a wide range of AI assistants and external tools, significantly expanding its utility and market reach.

The integration leverages the existing robust architecture of aiFetchly, including its proven browser management, database systems, and task scheduling capabilities, while adding standardized external interfaces and new functionality areas. The phased approach ensures steady progress while allowing for iterative improvements based on real-world usage and feedback.

Key benefits of this implementation include:
- **Standardized Integration**: MCP protocol enables seamless integration with AI assistants
- **Extended Functionality**: New search engine and email marketing capabilities
- **Scalable Architecture**: Built on proven aiFetchly infrastructure
- **Compliance Focus**: Strong emphasis on legal and ethical compliance
- **Performance Optimization**: Designed for high-throughput operations
- **Comprehensive Monitoring**: Full observability and health monitoring

The focus on **interface standardization**, **performance optimization**, **compliance**, and **user experience** will result in a robust and reliable MCP server that meets the needs of modern AI-powered workflows while maintaining the high standards established by the existing aiFetchly platform.

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Author**: AI Development Team  
**Reviewed By**: Technical Architecture Team  
