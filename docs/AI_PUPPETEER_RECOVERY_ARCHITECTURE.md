# AI-Assisted Puppeteer Recovery Architecture

This document outlines the architecture for adding AI/LLM support to the search scraping functionality. When Puppeteer operations fail (e.g., selector not found, page structure changed), the system can ask an LLM to help analyze the page and suggest recovery actions.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MAIN PROCESS (Electron)                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  SearchModule                                                      │   │
│  │  ├─ AIRecoveryHandler (NEW)                                       │   │
│  │  │   ├─ Receives page state from child process                    │   │
│  │  │   ├─ Calls AiChatApi (remote server)                          │   │
│  │  │   └─ Sends recovery actions back to child                      │   │
│  │  └─ Process message handler                                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│                    parentPort.postMessage / on('message')                │
│                              │                                           │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────────┐
│                           CHILD PROCESS (utilityProcess)                 │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  taskCode.ts → UserSearch → ScrapeManager → GoogleScraper        │   │
│  │                                                                   │   │
│  │  On failure:                                                      │   │
│  │  1. Capture page state (screenshot, HTML, selectors tried)        │   │
│  │  2. Send "requestAIRecovery" message to main process             │   │
│  │  3. Wait for "aiRecoveryResponse" with actions                   │   │
│  │  4. Execute recovery actions in Puppeteer                         │   │
│  │  5. Resume normal operation or report failure                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                               │
                         HTTP API calls
                               │
┌──────────────────────────────┼───────────────────────────────────────────┐
│                           REMOTE AI SERVER                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  /api/ai/puppeteer/recovery (NEW endpoint)                        │   │
│  │  - Receives page state + failed operation context                 │   │
│  │  - Returns recovery actions (click, type, waitFor, etc.)         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

1. **Main process handles AI API calls** - The `HttpClient` requires token management which only works in main process
2. **Child process captures page state** - Only the child process has access to Puppeteer's `Page` object
3. **Async message passing** - Child sends request, waits for response via Promise
4. **Timeout handling** - If AI recovery takes too long, fall back to existing error handling

---

## Implementation Guide

### 1. Message Types

**File: `src/entityTypes/processMessage-type.ts`**

Add new message types for AI recovery:

```typescript
// Add to existing ProcessMessage types

export interface AIRecoveryRequest {
    requestId: string;          // Unique ID to match request/response
    operation: string;          // 'search_input' | 'parse_results' | 'next_page' | 'wait_results'
    searchEngine: string;       // 'google' | 'bing' | 'baidu' etc.
    currentUrl: string;
    pageTitle: string;
    errorMessage: string;
    attemptedSelectors: string[];
    screenshot?: string;        // Base64 encoded (optional, for vision models)
    htmlSample: string;         // Cleaned/truncated HTML (max ~10KB)
    accessibilityTree?: string; // For finding interactive elements
    keyword?: string;           // Current search keyword if applicable
}

export interface AIRecoveryResponse {
    requestId: string;
    success: boolean;
    actions: AIRecoveryAction[];
    confidence: number;         // 0-1
    reasoning: string;
    error?: string;
}

export interface AIRecoveryAction {
    type: 'click' | 'type' | 'focus' | 'waitForSelector' | 'pressKey' | 'scroll' | 'evaluate';
    selector?: string;
    selectorType?: 'css' | 'xpath';
    value?: string;             // For 'type' actions
    key?: string;               // For 'pressKey' actions  
    timeout?: number;           // For 'waitForSelector'
    reason: string;
}
```

### 2. Page State Capture Utility

**File: `src/childprocess/utils/PageStateCapture.ts`**

Create this utility in the child process to capture page state:

```typescript
import { Page } from 'puppeteer';
import { AIRecoveryRequest } from '@/entityTypes/processMessage-type';
import { v4 as uuidv4 } from 'uuid';

export interface CaptureOptions {
    includeScreenshot?: boolean;
    maxHtmlLength?: number;
    includeAccessibilityTree?: boolean;
}

export async function capturePageState(
    page: Page,
    operation: string,
    searchEngine: string,
    errorMessage: string,
    attemptedSelectors: string[],
    options: CaptureOptions = {}
): Promise<AIRecoveryRequest> {
    const {
        includeScreenshot = false,
        maxHtmlLength = 10000,
        includeAccessibilityTree = true
    } = options;

    // Get basic page info
    const [currentUrl, pageTitle, html] = await Promise.all([
        page.url(),
        page.title(),
        page.content()
    ]);

    // Clean and truncate HTML
    const cleanedHtml = cleanHtml(html, maxHtmlLength);

    // Optionally capture screenshot
    let screenshot: string | undefined;
    if (includeScreenshot) {
        try {
            const buffer = await page.screenshot({
                type: 'png',
                encoding: 'base64',
                fullPage: false
            });
            screenshot = buffer as string;
        } catch (e) {
            console.warn('Failed to capture screenshot:', e);
        }
    }

    // Optionally get accessibility tree
    let accessibilityTree: string | undefined;
    if (includeAccessibilityTree) {
        try {
            const snapshot = await page.accessibility.snapshot();
            accessibilityTree = JSON.stringify(snapshot, null, 2).substring(0, 5000);
        } catch (e) {
            console.warn('Failed to get accessibility tree:', e);
        }
    }

    return {
        requestId: uuidv4(),
        operation,
        searchEngine,
        currentUrl,
        pageTitle,
        errorMessage,
        attemptedSelectors,
        screenshot,
        htmlSample: cleanedHtml,
        accessibilityTree
    };
}

function cleanHtml(html: string, maxLength: number): string {
    // Remove script and style content
    let cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Focus on main content area if possible
    const mainMatch = cleaned.match(/<main[^>]*>[\s\S]*?<\/main>/i) ||
                      cleaned.match(/<div[^>]*id=["']?(?:main|content|search)[^>]*>[\s\S]*?<\/div>/i);
    
    if (mainMatch && mainMatch[0].length < maxLength) {
        cleaned = mainMatch[0];
    }

    return cleaned.substring(0, maxLength);
}
```

### 3. AI Recovery Executor

**File: `src/childprocess/utils/AIRecoveryExecutor.ts`**

Execute the AI-suggested actions safely:

```typescript
import { Page } from 'puppeteer';
import { AIRecoveryAction } from '@/entityTypes/processMessage-type';

const SAFE_OPERATIONS = ['click', 'type', 'focus', 'waitForSelector', 'pressKey', 'scroll'];
const DEFAULT_TIMEOUT = 5000;

export async function executeRecoveryActions(
    page: Page,
    actions: AIRecoveryAction[]
): Promise<{ success: boolean; failedAt?: number; error?: string }> {
    
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        
        // Validate action
        if (!SAFE_OPERATIONS.includes(action.type)) {
            console.warn(`Skipping unsafe action type: ${action.type}`);
            continue;
        }

        try {
            console.log(`Executing recovery action ${i + 1}/${actions.length}: ${action.type} - ${action.reason}`);
            
            switch (action.type) {
                case 'click':
                    if (!action.selector) throw new Error('Selector required for click');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    await page.click(action.selector);
                    break;

                case 'type':
                    if (!action.selector || !action.value) throw new Error('Selector and value required for type');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    await page.type(action.selector, action.value, { delay: 50 + Math.random() * 100 });
                    break;

                case 'focus':
                    if (!action.selector) throw new Error('Selector required for focus');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    await page.focus(action.selector);
                    break;

                case 'waitForSelector':
                    if (!action.selector) throw new Error('Selector required for waitForSelector');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    break;

                case 'pressKey':
                    if (!action.key) throw new Error('Key required for pressKey');
                    await page.keyboard.press(action.key as any);
                    break;

                case 'scroll':
                    if (action.selector) {
                        await page.$eval(action.selector, el => el.scrollIntoView({ behavior: 'smooth' }));
                    } else {
                        await page.evaluate(() => window.scrollBy(0, 300));
                    }
                    break;
            }

            // Small delay between actions
            await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

        } catch (error) {
            console.error(`Recovery action ${i + 1} failed:`, error);
            return {
                success: false,
                failedAt: i,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    return { success: true };
}
```

### 4. AI Recovery Bridge in Child Process

**File: `src/childprocess/utils/AIRecoveryBridge.ts`**

This handles the async communication with main process:

```typescript
import { AIRecoveryRequest, AIRecoveryResponse } from '@/entityTypes/processMessage-type';
import { ProcessMessage } from '@/entityTypes/processMessage-type';

type ParentPort = {
    postMessage: (message: string) => void;
    on: (event: string, handler: (e: { data: string }) => void) => void;
};

// Store pending recovery requests
const pendingRequests = new Map<string, {
    resolve: (response: AIRecoveryResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}>();

const AI_RECOVERY_TIMEOUT = 30000; // 30 seconds

/**
 * Initialize the AI recovery response listener
 * Call this once when the child process starts
 */
export function initAIRecoveryListener(parentPort: ParentPort): void {
    // Note: This should be integrated into the existing message handler in taskCode.ts
    // Here we just handle the AI recovery responses
}

/**
 * Handle incoming AI recovery response
 * Call this from the main message handler when action === 'aiRecoveryResponse'
 */
export function handleAIRecoveryResponse(response: AIRecoveryResponse): void {
    const pending = pendingRequests.get(response.requestId);
    if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(response.requestId);
        pending.resolve(response);
    }
}

/**
 * Request AI recovery from the main process
 */
export function requestAIRecovery(
    parentPort: ParentPort,
    request: AIRecoveryRequest
): Promise<AIRecoveryResponse> {
    return new Promise((resolve, reject) => {
        // Set timeout
        const timeout = setTimeout(() => {
            pendingRequests.delete(request.requestId);
            reject(new Error('AI recovery request timed out'));
        }, AI_RECOVERY_TIMEOUT);

        // Store pending request
        pendingRequests.set(request.requestId, { resolve, reject, timeout });

        // Send request to main process
        const message: ProcessMessage<AIRecoveryRequest> = {
            action: 'requestAIRecovery',
            data: request
        };
        parentPort.postMessage(JSON.stringify(message));
    });
}
```

### 5. Update taskCode.ts

**File: `src/taskCode.ts`**

Add AI Recovery Message Handling to the switch statement:

```typescript
// Add this case to handle AI recovery responses from main process
case 'aiRecoveryResponse': {
    const response = pme.data as AIRecoveryResponse;
    handleAIRecoveryResponse(response);
    break;
}
```

### 6. Main Process AI Recovery Handler

**File: `src/modules/AIRecoveryHandler.ts`**

This runs in the main process and calls the remote AI server:

```typescript
import { AiChatApi } from '@/api/aiChatApi';
import { AIRecoveryRequest, AIRecoveryResponse, AIRecoveryAction } from '@/entityTypes/processMessage-type';

export class AIRecoveryHandler {
    private aiChatApi: AiChatApi;

    constructor() {
        this.aiChatApi = new AiChatApi();
    }

    /**
     * Process an AI recovery request by calling the remote AI server
     */
    async handleRecoveryRequest(request: AIRecoveryRequest): Promise<AIRecoveryResponse> {
        try {
            // Build the prompt for the AI
            const prompt = this.buildRecoveryPrompt(request);
            
            // Call AI chat API with structured prompt
            const response = await this.aiChatApi.sendMessage({
                message: prompt,
                systemPrompt: this.getSystemPrompt(request.operation),
                model: 'gpt-4o-mini' // or your preferred model
            });

            if (!response.status || !response.data) {
                return {
                    requestId: request.requestId,
                    success: false,
                    actions: [],
                    confidence: 0,
                    reasoning: 'AI API call failed',
                    error: response.msg || 'Unknown error'
                };
            }

            // Parse the AI response into recovery actions
            return this.parseAIResponse(request.requestId, response.data.message);

        } catch (error) {
            console.error('AI Recovery Handler error:', error);
            return {
                requestId: request.requestId,
                success: false,
                actions: [],
                confidence: 0,
                reasoning: 'Exception during AI recovery',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private getSystemPrompt(operation: string): string {
        return `You are a Puppeteer automation expert helping recover from web scraping failures.

TASK: Analyze the page state and suggest Puppeteer actions to complete the "${operation}" operation.

RESPONSE FORMAT: Return ONLY valid JSON in this exact format:
{
  "success": true,
  "actions": [
    {
      "type": "waitForSelector|click|type|focus|pressKey|scroll",
      "selector": "CSS selector",
      "selectorType": "css",
      "value": "text to type (for type action)",
      "key": "Enter (for pressKey action)",
      "timeout": 5000,
      "reason": "Brief explanation"
    }
  ],
  "confidence": 0.85,
  "reasoning": "Overall explanation of the recovery strategy"
}

RULES:
1. Only use safe operations: click, type, focus, waitForSelector, pressKey, scroll
2. Prefer CSS selectors over XPath
3. Consider aria-label, role, and data-* attributes
4. Maximum 5 actions per recovery attempt
5. Include waits before interactions
6. If no reliable solution, set success: false`;
    }

    private buildRecoveryPrompt(request: AIRecoveryRequest): string {
        let prompt = `FAILED OPERATION: ${request.operation}
SEARCH ENGINE: ${request.searchEngine}
CURRENT URL: ${request.currentUrl}
PAGE TITLE: ${request.pageTitle}
ERROR: ${request.errorMessage}
ATTEMPTED SELECTORS: ${request.attemptedSelectors.join(', ')}

HTML SAMPLE:
\`\`\`html
${request.htmlSample}
\`\`\`
`;

        if (request.accessibilityTree) {
            prompt += `\nACCESSIBILITY TREE (truncated):
\`\`\`json
${request.accessibilityTree}
\`\`\`
`;
        }

        if (request.keyword) {
            prompt += `\nCURRENT KEYWORD: ${request.keyword}\n`;
        }

        prompt += `\nPlease analyze and provide recovery actions.`;

        return prompt;
    }

    private parseAIResponse(requestId: string, aiMessage: string): AIRecoveryResponse {
        try {
            // Try to extract JSON from the response
            const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in AI response');
            }

            const parsed = JSON.parse(jsonMatch[0]);
            
            return {
                requestId,
                success: parsed.success ?? false,
                actions: this.validateActions(parsed.actions || []),
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0)),
                reasoning: parsed.reasoning || 'No reasoning provided'
            };

        } catch (error) {
            console.error('Failed to parse AI response:', error);
            return {
                requestId,
                success: false,
                actions: [],
                confidence: 0,
                reasoning: 'Failed to parse AI response',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private validateActions(actions: unknown[]): AIRecoveryAction[] {
        const validTypes = ['click', 'type', 'focus', 'waitForSelector', 'pressKey', 'scroll'];
        
        return actions
            .filter((a): a is AIRecoveryAction => {
                if (typeof a !== 'object' || a === null) return false;
                const action = a as Record<string, unknown>;
                return typeof action.type === 'string' && validTypes.includes(action.type);
            })
            .slice(0, 5); // Maximum 5 actions
    }
}
```

### 7. Update SearchModule.ts

**File: `src/modules/SearchModule.ts`**

Add to the message handler where child process messages are received:

```typescript
import { AIRecoveryHandler } from '@/modules/AIRecoveryHandler';
import { AIRecoveryRequest, AIRecoveryResponse } from '@/entityTypes/processMessage-type';

// In SearchModule class, add:
private aiRecoveryHandler: AIRecoveryHandler;

constructor() {
    // ... existing code
    this.aiRecoveryHandler = new AIRecoveryHandler();
}

// In the child.on('message') handler, add this case:
case 'requestAIRecovery': {
    const request = childdata.data as AIRecoveryRequest;
    console.log(`Received AI recovery request: ${request.requestId} for operation: ${request.operation}`);
    
    // Process recovery request asynchronously
    this.aiRecoveryHandler.handleRecoveryRequest(request)
        .then((response: AIRecoveryResponse) => {
            const message: ProcessMessage<AIRecoveryResponse> = {
                action: 'aiRecoveryResponse',
                data: response
            };
            child.postMessage(JSON.stringify(message));
        })
        .catch((error) => {
            const errorResponse: AIRecoveryResponse = {
                requestId: request.requestId,
                success: false,
                actions: [],
                confidence: 0,
                reasoning: 'Error processing recovery request',
                error: error instanceof Error ? error.message : String(error)
            };
            const message: ProcessMessage<AIRecoveryResponse> = {
                action: 'aiRecoveryResponse',
                data: errorResponse
            };
            child.postMessage(JSON.stringify(message));
        });
    break;
}
```

### 8. Integrate into GoogleScraper

**File: `src/childprocess/googleScraper.ts`**

Update `GoogleScraper` to use AI recovery:

```typescript
// In GoogleScraper class, add:
private parentPort: ParentPort | null = null;
private aiRecoveryEnabled = false;

// Set these via config or constructor
setParentPort(port: ParentPort): void {
    this.parentPort = port;
    this.aiRecoveryEnabled = true;
}

// Update search_keyword method:
async search_keyword(keyword: string) {
    // Try standard selectors first (existing code)
    for (const selector of this.searchSelectors) {
        try {
            const input = await this.page.$(selector);
            if (input) {
                // ... existing logic
                return;
            }
        } catch (error) {
            continue;
        }
    }

    // All selectors failed - try AI recovery
    if (this.aiRecoveryEnabled && this.parentPort) {
        this.logger.info('Standard selectors failed, attempting AI recovery...');
        
        try {
            const pageState = await capturePageState(
                this.page,
                'search_input',
                this.search_engine_name,
                'No search input found with standard selectors',
                this.searchSelectors,
                { includeAccessibilityTree: true }
            );
            pageState.keyword = keyword;

            const response = await requestAIRecovery(this.parentPort, pageState);

            if (response.success && response.actions.length > 0) {
                this.logger.info(`AI suggested ${response.actions.length} recovery actions (confidence: ${response.confidence})`);
                
                const result = await executeRecoveryActions(this.page, response.actions);
                
                if (result.success) {
                    // Now type the keyword using the recovered input
                    await this.page.keyboard.type(keyword, { delay: 50 + Math.random() * 100 });
                    await this.page.keyboard.press('Enter');
                    this.logger.info('AI recovery successful!');
                    return;
                } else {
                    this.logger.warn(`AI recovery actions failed at step ${result.failedAt}: ${result.error}`);
                }
            } else {
                this.logger.warn(`AI recovery not successful: ${response.reasoning}`);
            }
        } catch (error) {
            this.logger.error('AI recovery error:', error);
        }
    }

    throw new CustomError("No search input found", 202405301120304);
}
```

---

## Configuration

Add AI recovery options to your config:

```typescript
// In SMconfig or similar
interface AIRecoveryConfig {
    enabled: boolean;
    maxAttempts: number;           // Max recovery attempts per operation (default: 2)
    timeoutMs: number;             // Timeout for AI response (default: 30000)
    includeScreenshot: boolean;    // Include screenshot for vision models
    operations: string[];          // Which operations to enable recovery for
    // e.g., ['search_input', 'parse_results', 'next_page']
}
```

---

## Sequence Diagram

```
┌────────────┐     ┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│GoogleScraper│     │  taskCode   │     │SearchModule │     │ Remote AI    │
│(child proc)│     │(child proc) │     │(main proc)  │     │   Server     │
└─────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬───────┘
      │                   │                   │                   │
      │ Selector fails    │                   │                   │
      │───────────────────│                   │                   │
      │ capturePageState()│                   │                   │
      │<──────────────────│                   │                   │
      │                   │                   │                   │
      │ requestAIRecovery │                   │                   │
      │──────────────────>│                   │                   │
      │                   │ postMessage       │                   │
      │                   │──────────────────>│                   │
      │                   │                   │ HTTP POST         │
      │                   │                   │──────────────────>│
      │                   │                   │                   │
      │                   │                   │ JSON response     │
      │                   │                   │<──────────────────│
      │                   │ postMessage       │                   │
      │                   │<──────────────────│                   │
      │ AIRecoveryResponse│                   │                   │
      │<──────────────────│                   │                   │
      │                   │                   │                   │
      │ executeRecoveryActions()              │                   │
      │───────────────────│                   │                   │
      │                   │                   │                   │
      │ Resume operation  │                   │                   │
      │───────────────────│                   │                   │
```

---

## File Structure

New files to create:

```
src/
├── entityTypes/
│   └── processMessage-type.ts    # Add AIRecoveryRequest, AIRecoveryResponse, AIRecoveryAction
├── childprocess/
│   └── utils/
│       ├── PageStateCapture.ts   # Captures page state for AI analysis
│       ├── AIRecoveryExecutor.ts # Safely executes AI-suggested actions
│       └── AIRecoveryBridge.ts   # Handles async IPC with main process
├── modules/
│   └── AIRecoveryHandler.ts      # Main process handler, calls remote AI
└── taskCode.ts                   # Add case for 'aiRecoveryResponse'
```

Files to modify:

```
src/
├── modules/
│   └── SearchModule.ts           # Add AIRecoveryHandler, handle 'requestAIRecovery' messages
└── childprocess/
    ├── googleScraper.ts          # Integrate AI recovery in search_keyword, parse_async, etc.
    ├── baiduScraper.ts           # Similar integration
    └── searchScraper.ts          # Base class modifications if needed
```

---

## Implementation Priority

1. **Phase 1**: Message types and basic infrastructure
2. **Phase 2**: Page state capture utility  
3. **Phase 3**: Main process AI recovery handler
4. **Phase 4**: Integration into `search_keyword()` in GoogleScraper
5. **Phase 5**: Extend to `parse_async()` and `next_page()`
6. **Phase 6**: Add monitoring and caching for successful recovery strategies

---

## Alternative: Dedicated AI Endpoint (Recommended for Production)

Instead of using the general chat endpoint, consider creating a dedicated endpoint on your remote AI server:

```
POST /api/ai/puppeteer/recovery
```

This endpoint would:
- Be optimized for this specific use case
- Have pre-configured prompts and model settings
- Return structured JSON directly (no parsing needed)
- Support optional vision analysis with screenshots
- Have separate rate limiting and logging

---

## Safety Considerations

**Critical security measures:**

```typescript
// Allowlist of safe Puppeteer operations
const SAFE_OPERATIONS = [
    'click', 'type', 'focus', 'hover', 'select',
    'waitForSelector', 'waitForNavigation', 'waitForTimeout',
    'keyboard.press', 'keyboard.type',
    'mouse.click', 'mouse.move',
    'evaluate'  // But with strict code validation
];

// Domain allowlist to prevent navigation attacks
const ALLOWED_DOMAINS = [
    'google.com', 'bing.com', 'yandex.com', 'baidu.com',
    // ... other search engines
];

// Validate LLM-suggested actions before execution
function validateAction(action: RecoveryAction): boolean {
    if (!SAFE_OPERATIONS.includes(action.type)) {
        return false;
    }
    
    // For evaluate actions, check for dangerous patterns
    if (action.type === 'evaluate' && action.value) {
        const dangerous = ['fetch', 'XMLHttpRequest', 'localStorage', 'document.cookie'];
        if (dangerous.some(d => action.value!.includes(d))) {
            return false;
        }
    }
    
    return true;
}
```

---

## Cost & Performance Considerations

- **Caching**: Cache successful recovery strategies per search engine + operation
- **Rate limiting**: Limit AI calls per session (e.g., max 5 recoveries per task)
- **Fallback without AI**: Always maintain the existing non-AI error handling
- **Logging**: Log all AI recovery attempts for analysis and improvement

---

## Related Documents

- [AI Chat Implementation](ai-chat-implementation-summary.md)
- [AI Function Call](ai_funciton_call.md)
- [Puppeteer Training](PuppeteerTrain.md)
