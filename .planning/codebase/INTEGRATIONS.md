# External Integrations

**Analysis Date:** 2026-04-22

## APIs & External Services

**Remote AI Server (Go Backend):**
- Base URL: `VITE_LOGIN_URL` env var, resolved at build time via `vite.main.config.mjs` `define` option
- Client: `HttpClient` in `src/modules/lib/httpclient.ts`
- Auth: JWT Bearer token from `Token` service (stored in `electron-store` via `keytar`)
- Endpoints: `/apis/*` prefix (e.g., `/api/auth/device`, chat, email template, RAG config)
- Token refresh: `TokenRefreshService` in `src/modules/tokenRefresh.ts` handles auto-refresh
- Streaming: SSE (Server-Sent Events) for AI chat responses
- Key API classes: `src/api/aiChatApi.ts`, `src/api/ragConfigApi.ts`, `src/api/deviceApi.ts`

**OpenAI API (indirect):**
- Package: `openai ^4.87.3`
- Not called directly from client - requests proxied through remote AI server
- Used for: AI chat, keyword generation, email template generation, embeddings

**Embedding Models (local inference):**
- Package: `@xenova/transformers ^2.17.2`
- Runs locally via Hugging Face transformer models
- Interface: `src/modules/interface/EmbeddingImpl.ts`
- Used by: `VectorSearchService`, RAG pipeline for document embeddings

## Data Storage

**Primary Database:**
- SQLite via better-sqlite3 `^11.9.1`
- ORM: TypeORM `^0.3.20` with decorator-based entity definitions
- Configuration: `src/config/SqliteDb.ts` - singleton `DataSource` management
- Entities: 40+ entities in `src/entity/` (Campaign, SocialAccount, SearchTask, EmailSearch, RAG, AI Chat, etc.)
- Path resolution: `Token` service with `USERSDBPATH` key from `src/config/usersetting.ts`
- Connection: Lazy-initialized singleton per database path

**Vector Storage:**
- sqlite-vec `^0.1.7-alpha.2` - Vector similarity search SQLite extension
- Adapter: `src/modules/adapters/SqliteVecDatabase.ts` - primary implementation
- Factory: `src/modules/factories/VectorDatabaseFactory.ts` - Strategy pattern
- Pool: `src/modules/factories/VectorDatabasePool.ts` - Connection pooling
- Interface: `src/modules/interface/IVectorDatabase.ts` - Database contract
- Index path: `data/vector_index/` under app root
- Native extension: `vec0.dll`/`vec0.dylib`/`vec0.so` - copied during build

**Key Vector/RAG Services:**
- `src/service/VectorStoreService.ts` - Vector database management
- `src/service/VectorSearchService.ts` - Similarity search with metadata
- `src/service/ChunkingService.ts` - Document chunking strategies
- `src/service/DocumentService.ts` - Document lifecycle management
- `src/modules/RagSearchModule.ts` - Full RAG search pipeline
- `src/modules/RAGDocumentModule.ts` - Document CRUD operations
- `src/modules/RAGChunkModule.ts` - Chunk CRUD operations

**File Storage:**
- Local filesystem only
- User data path: `app.getPath('userData')` via Electron
- Temp files: OS temp directory
- Vector indexes: `data/vector_index/`

**Caching:**
- `src/modules/ConfigurationCache.ts` - In-memory configuration caching
- No Redis or external cache

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based auth against Go backend server
- Implementation: `src/controller/UserController.ts`
- Token storage: `electron-store` with `keytar` for OS-native credential storage
- Token service: `src/modules/token.ts` - `Token` class manages auth state
- Token keys defined in `src/config/usersetting.ts`: `TOKENNAME`, `REFRESHTOKEN`, `TOKENEXPIRY`, `REFRESHTOKENEXPIRY`
- Refresh: `src/modules/tokenRefresh.ts` - automatic token refresh with retry
- Login flow: Browser window opens remote login page, JWT tokens returned via callback

**Device Fingerprint:**
- Service: `src/modules/deviceFingerprint.ts`
- API: `src/api/deviceApi.ts` - registers device with Go backend
- Uses `node-machine-id` for hardware-based device identification
- Associated with user account and refresh token

## Social Platform Integration

**Platform Architecture:**
- Platform adapters: `src/modules/BasePlatformAdapter.ts` - abstract base class
- Platform factory: `src/modules/PlatformFactory.ts`
- Platform registry: `src/modules/PlatformRegistry.ts` - platform registration and discovery
- Platform configs: `src/config/platforms/` - per-platform scraper configurations
- Social account management: `src/entity/SocialAccount.entity.ts`, `src/model/` + `src/modules/`

**Supported Platforms:**
- Google Search - `src/childprocess/googleScraper.ts`
- Bing Search - `src/childprocess/bingScraper.ts`
- Baidu Search - `src/childprocess/baiduScraper.ts`
- Yandex Search - `src/childprocess/yandexScraper.ts`
- Yellow Pages (multi-region) - `src/childprocess/YellowPagesScraper.ts`
  - Platform configs: `src/config/platforms/` (yellowpages-com, yelp-com, yell-com, pagesjaunes-fr, paginegialle-it, gelbeseiten-de, 11880-de, itownpage-jp, usonar-yellowpage-jp, korealocalpages-kr, yellowpages-com-sg)
- Facebook - via Puppeteer automation
- YouTube - upload, caption, authentication
- Twitter/X - via Puppeteer automation

**Browser Automation:**
- Engine: Puppeteer with stealth plugins (`rebrowser-puppeteer`)
- Configuration: `src/config/puppeteerconfig.ts` - default browser/scrape configs
- Cluster management: `puppeteer-cluster` for concurrent scraping tabs
- Proxy support: `@lem0-packages/puppeteer-page-proxy` - per-page proxy rotation
- Cookie management: `src/entity/AccountCookies.entity.ts` - stored in SQLite
- User agent rotation: `random-useragent`, `user-agents` packages

**Search Scraping Workers (child processes):**
- `src/childprocess/scrapeManager.ts` - orchestrates scraping across platforms
- `src/childprocess/searchScraper.ts` - general search scraper
- `src/childprocess/emailScraper.ts` - email extraction from pages
- `src/childprocess/emailSearch.ts` - email search orchestration
- `src/childprocess/emailCluster.ts` - bulk email operations
- `src/childprocess/websiteContentScraper.ts` - website content analysis

## AI Service Integration

**AI Chat System:**
- IPC handler: `src/main-process/communication/ai-chat-ipc.ts`
- API client: `src/api/aiChatApi.ts` - chat requests, streaming, tool functions
- Stream processor: `src/service/StreamEventProcessor.ts` - SSE stream handling, plan execution
- Tool executor: `src/service/ToolExecutor.ts` - routes AI tool calls to implementations
- Chat storage: `src/modules/AIChatModule.ts`, `src/model/AIChatMessage.model.ts`
- Attachments: `src/service/AIChatAttachment.service.ts`, `src/model/AIChatAttachment.model.ts`
- AI enable check: `USER_AI_ENABLED` from `src/config/usersetting.ts` - gated feature

**AI Tool Functions:**
- Static tools defined in: `src/config/aiTools.config.ts`
  - `scrape_urls_from_google`, `scrape_urls_from_bing`, `scrape_urls_from_baidu`
  - `scrape_urls_from_yandex`, `extract_emails`, `analyze_website`
  - `extract_contact_info`, `search_yellow_pages`, `generate_keywords`
  - File tools: `file_read`, `file_search`, `file_write`
- Dynamic tools: MCP tools from `src/service/MCPToolService.ts`
- Tool execution: `src/service/ToolExecutionService.ts` - persistent tool execution records
- Skill tools: `src/config/skillsRegistry.ts` - registered skill definitions

**AI Email Template Generation:**
- IPC handler: `src/main-process/communication/ai-email-template-ipc.ts`
- Uses remote AI server for template generation with streaming

**AI Recovery:**
- `src/modules/AIRecoveryHandler.ts` - error recovery for AI operations
- `src/service/ErrorClassification.ts` - error categorization and recovery strategies

**Plan Execution:**
- `StreamEventProcessor` handles AI-generated plans with multiple steps
- `PlanValidator` in `src/service/ValidationUtils.ts` validates plan structure
- Plans support tool calls, skill execution, and sequential step execution

## MCP (Model Context Protocol) Integration

**MCP Client:**
- `src/modules/MCPClient.ts` - supports stdio, SSE, and WebSocket transports
- Authentication: none, api_key, bearer_token, custom
- Tool discovery: `discoverTools()` method
- Entity: `src/entity/MCPTool.entity.ts` - MCP tool persistence
- Service: `src/service/MCPToolService.ts` - MCP tool management
- IPC handler: `src/main-process/communication/mcp-tool-ipc.ts`

## Skill System Integration

**Skill Import:**
- `src/service/SkillImportService.ts` - imports skills from external sources
- Entity: `src/entity/InstalledSkill.entity.ts` - installed skill persistence
- Model: `src/model/InstalledSkill.model.ts`

**Skill Execution:**
- `src/service/SkillExecutor.ts` - executes registered skills
- `src/service/SandboxedSkillExecutor.ts` - runs skills in `isolated-vm` sandbox
- `src/service/SkillPermissionService.ts` - permission grants for skill operations
- `src/service/SkillDiagnosticsService.ts` - skill health checks
- `src/service/SkillWorkerClient.ts` - communicates with SkillWorker child process
- `src/service/SkillEnvironmentManager.ts` - manages skill execution environments
- Worker: `src/childprocess/SkillWorker.ts` - child process entry point for skills
- Python runtime: `src/service/PythonSkillRuntimeService.ts`, `src/childprocess/PythonRuntimeWorker.ts`

**Skill Registry:**
- `src/config/skillsRegistry.ts` - central skill/tool registry with permission requirements

## Email Integration

**Email Sending:**
- Library: nodemailer `^7.0.11`
- Service: `src/modules/lib/emailService.ts` - SMTP transport wrapper
- Supports: custom SMTP hosts, SSL/TLS, authentication
- Bulk email: `src/childprocess/emailSend.ts` - bulk email sending with progress tracking
- Test email: `SENDTESTEMAIL` IPC channel

**Email Extraction:**
- Workers: `src/childprocess/emailScraper.ts`, `src/childprocess/emailSearch.ts`
- Module: `src/modules/EmailSearchTaskModule.ts` - email search business logic
- Model: `src/model/EmailsearchTask.model.ts` - email search data access
- Results: `src/model/EmailsearchResult.model.ts`

**Email Marketing:**
- Templates: `src/model/EmailTemplate.model.ts`, `src/modules/EmailTemplateModule.ts`
- Filters: `src/modules/EmailFilterModule.ts`
- Marketing tasks: `src/model/EmailMarketingTask.model.ts`
- Services: `src/model/EmailService.model.ts` - SMTP service configuration

## Contact Extraction

**Worker Process:**
- Entry: `src/childprocess/contact-extraction/ContactExtractionWorker.ts`
- Queue: `src/childprocess/contact-extraction/ExtractionQueue.ts`
- Discovery: `src/childprocess/contact-extraction/ContactDiscovery.ts`
- Browser pool: `src/childprocess/contact-extraction/BrowserPool.ts`
- IPC handler: `src/main-process/communication/contactExtraction-ipc.ts`
- Module: `src/modules/ContactInfoModule.ts`
- Model: `src/model/ContactInfo.model.ts`
- Entity: `src/entity/ContactInfo.entity.ts`

## Website Analysis

- Service: `src/service/WebsiteAnalysisService.ts` - analyzes websites for content, SEO, etc.
- Worker: `src/childprocess/websiteContentScraper.ts`
- Cheerio for HTML parsing, turndown for HTML-to-Markdown

## File Tool Integration

**File Tools (AI-powered):**
- Config: `src/config/fileToolConfig.ts` - workspace roots, deny-lists, size limits, rate limits
- Guard: `src/service/FilePathGuard.ts` - path traversal prevention, deny-list enforcement
- Service: `src/service/FileToolService.ts` - file read/search/write operations
- Tools: `file_read`, `file_search`, `file_write` exposed as AI tool functions
- Libraries: `fast-glob` for search, `write-file-atomic` for safe writes, `isbinaryfile` for detection
- Size limits: 1MB read, 5MB write, 500KB grep output
- Rate limits: 30/min read, 20/min search, 10/min write

## Monitoring & Observability

**Error Tracking:**
- Winston logger: `src/modules/Logger.ts` - structured logging with file transport
- electron-log: `^5.1.2` - Electron-specific log capture
- Debug: namespaced debug logging via `debug ^4.3.4`

**Logs:**
- Log directory: managed by Logger module, path stored via `USERLOGPATH` setting
- Console override in main process redirects to Winston transports
- File-based log rotation via Winston

## IPC Communication

**Architecture:**
- Main process handlers: `src/main-process/communication/` (25+ IPC handler files)
- Registration: `src/main-process/communication/index.ts` - centralized handler registration
- HMR guard: prevents duplicate handler registration during development
- Frontend API layer: `src/views/api/` - renderer-side IPC wrappers
- Preload bridge: `src/preload.ts` - `contextBridge` exposes IPC methods

**IPC Channel Categories (defined in `src/config/channellist.ts`):**
- Search & scraping: `search:*`, `check:proxy*`, `remove:failureproxy*`
- Email: `email:*`, `buck:email:*`, `send:test:email*`
- Social accounts: `socialaccount:*`
- Video: `video:*`
- System settings: `system_setting:*`
- User auth: `user:*`, `login:*`, `open:page*`
- Scheduling: `schedule:*`, `scheduler:*`, `cron:*`, `schedule:dependency:*`
- Platform management: `platform:*`
- Yellow pages: `yellow_pages:*`
- Language: `language:preference:*`
- RAG: `rag:*` (23 channels for document management, search, embeddings)
- AI Chat: `ai-chat:*` (streaming, history, conversations, tool permissions)
- MCP tools: `mcp:tool:*`
- Skills: `skill:*` (permissions, import, toggle, uninstall)
- System dependencies: `system-dependency:*`
- Dashboard: `dashboard:*`
- WebSocket: `websocket:*`
- Contact extraction: `contact-extraction:*`, `start-contact-extraction*`
- AI email template: `ai-email-template:*`

**WebSocket Client:**
- `src/modules/WebSocketClient.ts` - persistent WebSocket connection to marketing server
- Authentication: JWT token sent on connect
- Features: auto-reconnect with exponential backoff, heartbeat, subscription notifications
- Config: `WS_MAX_RECONNECT`, `WS_RECONNECT_DELAY`, `WS_HEARTBEAT_INTERVAL` env vars
- IPC handler: `src/main-process/communication/websocket-ipc.ts`

## Proxy Management

- Entity: `src/entity/Proxy.entity.ts`, `src/entity/ProxyCheck.entity.ts`
- Model: `src/model/Proxy.model.ts`, `src/model/ProxyCheck.model.ts`
- Module: `src/modules/ProxyModule.ts`
- Support: HTTP, HTTPS, SOCKS5 proxies
- Libraries: `http-proxy-agent`, `https-proxy-agent`, `fetch-socks`, `socks5-http-client`
- Worker: `src/childprocess/googleProxyCheck.ts` - proxy validation
- Per-page proxy: `@lem0-packages/puppeteer-page-proxy`

## Scheduling & Task Management

- Scheduler: `src/modules/ScheduleManager.ts` - cron-based task scheduling
- Background scheduler: `src/modules/BackgroundScheduler.ts` - background task execution
- Task entities: `src/entity/ScheduleTask.entity.ts`, `src/entity/Task.entity.ts`
- Dependency management: `src/modules/ScheduleDependencyModule.ts`
- Execution logging: `src/modules/ScheduleExecutionLogModule.ts`
- IPC handler: `src/main-process/communication/scheduleIpc.ts`

## System Dependency Management

- Catalog: `src/config/dependency-catalog.json` - known system dependencies
- Resolver: `src/service/SystemDependencyResolver.ts` - resolves dependency requirements
- Installer: `src/service/SystemDependencyInstaller.ts` - installs system dependencies
- Retry: `src/service/SystemDependencyRetryService.ts` - retry logic for failed installs
- Audit: `src/service/SystemDependencyAuditLogger.ts` - audit logging
- Entity: `src/entity/DependencyInstallAudit.ts` - audit trail persistence
- IPC handler: `src/main-process/communication/system-dependency-ipc.ts`

## Environment Configuration

**Required env vars:**
- `VITE_LOGIN_URL` - Backend API base URL (embedded at build time)
- `UPDATESERVER` - Auto-updater endpoint

**Secrets location:**
- `.env` file at project root (gitignored)
- OS keychain via `keytar` for sensitive tokens
- `electron-store` with `safeStorage` for local encrypted data

## Webhooks & Callbacks

**Incoming:**
- WebSocket real-time notifications from marketing server (subscription events, task updates)
- Custom protocol handler: `aiFetchly://` URL scheme for deep linking

**Outgoing:**
- HTTP API calls to remote Go backend (`/apis/*`)
- SSE connections for AI streaming responses

---

*Integration audit: 2026-04-22*
