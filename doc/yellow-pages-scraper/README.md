# Yellow Pages Scraper: Process Architecture and AI Support

This document describes how **YellowPagesScraperProcess** and **YellowPagesScraper** work together, and how they use the AI support feature for scraping assistance and contact extraction.

---

## 1. Overview

| Component | File | Role |
|-----------|------|------|
| **YellowPagesScraper** | `src/childprocess/YellowPagesScraper.ts` | Scraper engine: browser automation, page navigation, selector-based extraction, and AI support calls. |
| **YellowPagesScraperProcess** | `src/childprocess/YellowPagesScraperProcess.ts` | Optional child-process wrapper: IPC via `process.send`, task lifecycle (start/stop/pause/resume), delegates scraping to `YellowPagesScraper`. |

There are **two ways** the scraper can run as a child process:

1. **Utility process (primary)** – Main app uses **YellowPagesScraper.ts** as the entry. The file contains the `YellowPagesScraper` class and a **top-level script** that listens on Electron’s `parentPort`, creates one `YellowPagesScraper` per task, and forwards messages (START, PAUSE, RESUME, AI_SUPPORT_RESPONSE). **AI support is used in this path** (parentPort is available).
2. **Node spawn (alternative)** – **YellowPagesScraperProcess.ts** is the entry (e.g. via `ChildProcessManager`). It uses `process.send` for IPC and instantiates `YellowPagesScraper` inside the process. In this path, `YellowPagesScraper`’s AI support uses `parentPort`, which is **not** set for a Node-spawned process, so AI requests return “No parentPort available” and are effectively disabled.

The rest of this doc focuses on the **utility-process** flow where AI support is active.

---

## 2. How YellowPagesScraperProcess and YellowPagesScraper Work Together

### 2.1 When YellowPagesScraperProcess Is the Entry (Node-Spawned Child)

- **YellowPagesScraperProcess** is the process entry. It:
  - Sets up `process.on("message")` for IPC with the main process.
  - Handles message types: `START_TASK`, `STOP_TASK`, `PAUSE_TASK`, `RESUME_TASK`, `TASK_DATA`, `HEALTH_CHECK`.
  - Keeps a single `scraper: YellowPagesScraper | null`. Creates it when starting a task (with task/platform data or defaults).
  - Wires callbacks from the scraper to outbound IPC:
    - **onProgress** → `sendProgressUpdate(taskId, progress)`
    - **onComplete** → `sendTaskCompleted(taskId, results)`
    - **onError** → `sendErrorMessage(...)`
  - For **START_TASK**: sets `currentTaskId`, `isRunning`, then calls `startScraping(taskId)`.
  - **startScraping**:
    - Ensures `this.scraper` exists (creates `YellowPagesScraper` with task/platform data if needed).
    - Registers the three callbacks above.
    - Calls `await this.scraper.start()`.
  - **PAUSE_TASK** / **RESUME_TASK** / **STOP_TASK** delegate to `this.scraper.pause()` / `resume()` / `stop()` and send status updates.

- **YellowPagesScraper** (used inside this process):
  - Does the real work: browser launch, navigation, search form fill, listing/detail extraction, pagination.
  - Does **not** talk to the main process directly; it only uses callbacks set by YellowPagesScraperProcess (`onProgress`, `onComplete`, `onError`).
  - When AI support is requested, it uses `parentPort`; in a Node-spawned process that is undefined, so AI requests fail with “No parentPort available”.

So in this path, **YellowPagesScraperProcess** = process boundary + task control; **YellowPagesScraper** = scraping logic only.

### 2.2 When YellowPagesScraper.ts Is the Entry (Utility Process – Primary for AI)

- The **entry** is the top-level script at the bottom of **YellowPagesScraper.ts** (same file as the class). It:
  - Uses Electron’s **parentPort** for IPC (provided when the process is run as a utility process).
  - Listens for messages: `START`, `PAUSE`, `RESUME`, `AI_SUPPORT_RESPONSE`.
  - For **START**: builds a `YellowPagesScraper` with `message.taskData` and `message.platformInfo`, stores it in `globalScraper`, wires progress/complete/error to `parentPort.postMessage(...)`, then calls `scraper.start()`.
  - For **PAUSE** / **RESUME**: calls `globalScraper.pause()` / `resume()`.
  - For **AI_SUPPORT_RESPONSE**: calls `globalScraper.handleAiSupportResponse(message)` so the scraper can resolve the matching pending AI request.

- **YellowPagesScraper** (same class, different entry):
  - Again does all scraping (browser, navigation, extraction).
  - Uses **parentPort** to send progress/complete/error (via the callbacks set by the top-level script).
  - Uses **parentPort** to send **AI_SUPPORT_REQUEST** and receives **AI_SUPPORT_RESPONSE** on the same channel; `handleAiSupportResponse` resolves the promise returned by `requestAiSupport(...)`.

So in this path there is **no** YellowPagesScraperProcess; the “process” is the script in YellowPagesScraper.ts, and the class **YellowPagesScraper** does scraping + AI request/response over parentPort.

---

## 3. AI Support: End-to-End Flow

AI support is used only when the child runs as a **utility process** (YellowPagesScraper.ts as entry), where `parentPort` exists.

### 3.1 Enabling AI Support

- Task data includes `aiSupportEnabled?: boolean` (e.g. set from `task.ai_support_enabled` in **YellowPagesProcessManager**).
- **YellowPagesScraper** constructor sets `this.aiSupportEnabled = taskData.aiSupportEnabled ?? false`.
- All AI behavior is gated on `this.aiSupportEnabled`.

### 3.2 Where the Scraper Requests AI

**YellowPagesScraper** calls `requestAiSupport(...)` in two situations:

1. **Step guidance (search page navigation failure)**  
   - When navigation to the search page or form fill fails (`navigateToSearchPage` catch block).
   - Request type: `step_guidance`.
   - Payload: `pageUrl`, `stepContext: "navigate_to_search_page"`, `errorInfo`, `selectorsTried` (from platform selectors).
   - Used to get alternative selectors or “skip” guidance so the scraper can try AI-suggested selectors (e.g. keyword/location inputs, search button) and retry.

2. **Contact extraction (detail page, missing contact fields)**  
   - When selector-based extraction on a detail page finds no email, phone, or website.
   - Request type: `contact_extraction`.
   - Payload: `pageUrl`, `businessName`, `stepContext: "detail_page_extraction"`, `errorInfo`.
   - Used to fill `email`, `phone`, `website`, `address`, `social_media` from AI-extracted data.

### 3.3 requestAiSupport (Child Side)

- If `!this.aiSupportEnabled`: returns `{ success: false, errorMessage: "AI support disabled" }`.
- If no `parentPort`: returns `{ success: false, errorMessage: "No parentPort available" }`.
- Captures current page state: `page.content()` and optional base64 screenshot.
- Builds a unique `requestId` (e.g. `ai-${taskId}-${counter}-${timestamp}`).
- Builds **AiSupportRequestMessage**:  
  `type: "AI_SUPPORT_REQUEST"`, `taskId`, `requestId`, `requestType`, `pageContent`, `screenshot`, `pageUrl`, `businessName`, `stepContext`, `errorInfo`, `platformName`, `selectorsTried`.
- Creates a **Promise** and stores it in `pendingAiRequests` under `requestId`, with a 60s timeout (on timeout, the promise resolves with `success: false`, `errorMessage: "AI support request timed out"`).
- Sends the message: `parentPort.postMessage(requestMessage)`.
- Returns the promise; the caller `await requestAiSupport(...)` and then uses `AiSupportResult` (e.g. `suggestedSelectors` for step_guidance, or `emails`/`phones`/etc. for contact_extraction).

### 3.4 handleAiSupportResponse (Child Side)

- When the top-level script in YellowPagesScraper.ts receives a message and `isAiSupportResponseMessage(message)` is true, it calls `globalScraper.handleAiSupportResponse(message)`.
- **handleAiSupportResponse**:
  - Looks up `pendingAiRequests.get(requestId)`.
  - Clears the timeout and removes the entry from `pendingAiRequests`.
  - Builds `AiSupportResult` from `message` (success, requestType, data, errorMessage) and calls `pending.resolve(result)`.
- The awaiting `requestAiSupport()` then returns, and the scraper uses the result (e.g. apply suggested selectors or merge contact data).

### 3.5 Main Process: Receiving Request and Sending Response

- **YellowPagesProcessManager** (main process) receives messages from the **utility** child. When `message.type === "AI_SUPPORT_REQUEST"` and `isAiSupportRequestMessage(message)`:
  - It calls `handleAiSupportRequest(message, childProcess)`.
- **handleAiSupportRequest**:
  - Uses **YellowPagesAiSupportHandler** (creates one with optional log file if needed).
  - Calls `await this.aiSupportHandler.handleAiSupportRequest(request, childProcess)`.
- **YellowPagesAiSupportHandler**:
  - Checks AI is enabled (e.g. token/user setting); if not, sends **AI_SUPPORT_RESPONSE** with `success: false` and a user-facing error, then returns.
  - Validates request (structure, rate limit, page content size, screenshot format).
  - Optionally uses a cache keyed by request; on cache hit, sends cached **AI_SUPPORT_RESPONSE** and returns.
  - Calls `executeAiRequest(request)` (with timeout), which calls `performAiRequest(request)`:
    - **contact_extraction** → `handleContactExtraction(request)` (e.g. AI/API to extract emails, phones, address, social links from page content/screenshot).
    - **step_guidance** → `handleStepGuidance(request)` (e.g. AI/API to suggest selectors or actions from page content/screenshot and error context).
  - Builds **AiSupportResponseMessage**:  
    `type: "AI_SUPPORT_RESPONSE"`, `taskId`, `requestId`, `success`, `requestType`, `data` or `errorMessage`.
  - Sends response to child: `childProcess.postMessage(JSON.stringify(response))`.
- The child’s `parentPort` receives the message; the top-level handler parses it and calls `globalScraper.handleAiSupportResponse(message)`, which resolves the pending AI request as above.

### 3.6 Summary Diagram (Utility Process + AI)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Main Process (YellowPagesProcessManager)                                │
│  - Forks child: YellowPagesScraper.js (utility process)                 │
│  - On message "AI_SUPPORT_REQUEST" → handleAiSupportRequest(...)        │
│  - YellowPagesAiSupportHandler: validate → cache? → AI API               │
│    → build AI_SUPPORT_RESPONSE → childProcess.postMessage(response)     │
└─────────────────────────────────────────────────────────────────────────┘
                    │                                    ▲
                    │ parentPort.postMessage             │ parentPort receives
                    │ (START / PROGRESS / COMPLETED /    │ AI_SUPPORT_RESPONSE
                    │  ERROR / AI_SUPPORT_REQUEST)       │
                    ▼                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│ Child Process (YellowPagesScraper.ts entry)                              │
│  - Top-level: parentPort.on("message") → START → new YellowPagesScraper │
│    → onProgress/onComplete/onError → parentPort.postMessage              │
│  - PAUSE/RESUME → globalScraper.pause()/resume()                        │
│  - AI_SUPPORT_RESPONSE → globalScraper.handleAiSupportResponse(msg)     │
│                                                                          │
│  YellowPagesScraper (class)                                              │
│  - requestAiSupport(...) → postMessage(AI_SUPPORT_REQUEST)             │
│    → store pending promise → await → resolve in handleAiSupportResponse │
│  - Uses result: step_guidance → try suggested selectors;                │
│    contact_extraction → merge emails/phones/address/social into result   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Files Reference

| File | Purpose |
|------|---------|
| `src/childprocess/YellowPagesScraper.ts` | Scraper engine class + utility-process entry (parentPort); AI request/response. |
| `src/childprocess/YellowPagesScraperProcess.ts` | Optional process entry using process.send; wraps YellowPagesScraper. |
| `src/modules/YellowPagesProcessManager.ts` | Main process: spawns utility child (YellowPagesScraper.js), passes task data (aiSupportEnabled), handles AI_SUPPORT_REQUEST. |
| `src/modules/YellowPagesAiSupportHandler.ts` | Validates request, checks AI enabled, rate limit, cache; calls AI APIs; sends AI_SUPPORT_RESPONSE to child. |
| `src/modules/interface/BackgroundProcessMessages.ts` | AiSupportRequestMessage, AiSupportResponseMessage, isAiSupportRequestMessage, etc. |

---

## 5. Configuration and Timeouts

- **YellowPagesScraper**: `AI_REQUEST_TIMEOUT_MS = 60000` (60s) for waiting for AI_SUPPORT_RESPONSE; after that, the pending promise resolves with a timeout error.
- **YellowPagesAiSupportHandler**: configurable `requestTimeout` (default 30s) for the main process’s AI API call; also cache TTL, max page size, and rate limiting.

This keeps the child from hanging indefinitely if the main process or AI service is slow or unresponsive.
