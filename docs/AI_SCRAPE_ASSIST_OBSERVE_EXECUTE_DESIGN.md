# AI Scrape Assist: Observe-Execute Model Design

This document describes the design for upgrading the current one-step AI scrape assist to an **observe-execute** (observe-plan-execute-verify) model. It covers both client (aiFetchly) and server (aifetchserver) changes.

---

## Current Architecture Analysis

The current **one-step** scrape assist flow:

```
YellowPagesScraper (child process)
  → sends AI_SUPPORT_REQUEST via IPC
    → YellowPagesAiSupportHandler (main process)
      → AiChatApi.scrapeAssist() HTTP call
        → aifetchserver /api/ai/scrape/assist endpoint
          → ScrapeAssistService.get_scrape_guidance()
            → Single LLM call → returns JSON guidance
          ← Returns suggested_selectors, suggested_actions, should_skip
        ← Returns response
      ← Returns response
    ← Sends AI_SUPPORT_RESPONSE via IPC
  ← Receives result, tries to apply selectors blindly
```

**Key problems with the current approach:**

1. **One-shot, no feedback loop**: The AI gives guidance once based on HTML + screenshot, the client blindly applies it, and if it fails there's no way for the AI to learn from the failure.

2. **No observation after execution**: The AI suggests selectors/actions, but never sees whether they worked. It can't self-correct.

3. **Hardcoded action interpretation**: The `YellowPagesScraper` manually maps `suggestedSelectors` fields like `keywordInput`, `locationInput` to specific Puppeteer actions (click, type) with hardcoded logic. There's no structured action format.

4. **No session/conversation context**: Each request is stateless. The AI doesn't know what it suggested before or what the outcomes were.

5. **Mixed concerns in `suggested_actions`**: The `suggested_actions` field is a `string[]` of human-readable instructions, not machine-executable actions. The client can't actually execute them automatically.

---

## Proposed Observe-Execute Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────┐
│              OBSERVE-EXECUTE LOOP                     │
│                                                       │
│  1. OBSERVE: Client sends current page state         │
│     (HTML, screenshot, URL, DOM snapshot)            │
│                          ↓                            │
│  2. PLAN: Server analyzes and returns structured     │
│     executable actions with session_id                │
│                          ↓                            │
│  3. EXECUTE: Client executes actions one-by-one       │
│     via Puppeteer, collecting results                 │
│                          ↓                            │
│  4. REPORT: Client sends action results + new page    │
│     state back to server                              │
│                          ↓                            │
│  5. VERIFY: Server evaluates if goal is achieved      │
│     → If yes: return success                          │
│     → If no: go back to step 2 with new plan         │
│                                                       │
│  Max iterations: configurable (default 3)             │
└─────────────────────────────────────────────────────┘
```

### Detailed Design

#### 1. Server-Side Changes (aifetchserver)

**New schemas** (`schemas/scrape_assist.py`):

```python
class ExecutableAction(BaseModel):
    """A single machine-executable Puppeteer action."""
    action_id: str  # unique within the session
    type: str  # "click", "type", "waitForSelector", "scroll", "pressKey", "navigate", "screenshot"
    selector: str | None = None
    selector_type: str = "css"  # "css", "xpath", "text"
    value: str | None = None  # for "type" actions
    key: str | None = None  # for "pressKey" actions
    timeout: int = 5000  # ms
    description: str  # human-readable explanation of why this action

class ActionResult(BaseModel):
    """Result of executing a single action."""
    action_id: str
    success: bool
    error: str | None = None
    element_found: bool = False
    screenshot_after: str | None = None  # optional screenshot after this action

class ObserveRequest(BaseModel):
    """Initial observation request - starts or continues a session."""
    session_id: str | None = None  # None = new session, set = continue
    page_content: str
    page_url: str
    screenshot: str | None = None
    goal: str  # what the scraper is trying to achieve
    platform_name: str = "yellowpages"
    selectors_available: dict[str, str] = {}  # platform's known selectors
    previous_action_results: list[ActionResult] = []  # results from last round
    iteration: int = 0

class ObserveResponse(BaseModel):
    """Server response with executable plan."""
    session_id: str
    status: str  # "actions_needed", "goal_achieved", "give_up"
    actions: list[ExecutableAction] = []
    explanation: str
    confidence: float
    should_retry: bool = False
    max_iterations_remaining: int
```

**New service method** — `ScrapeAssistService` gets an `observe_and_plan` method that:

- Maintains conversation context via `session_id` (server-side can use Redis or in-memory dict for short-lived sessions)
- Builds a richer prompt that includes the goal, previous actions and their results
- Returns structured `ExecutableAction` objects instead of free-text suggestions
- Tracks iteration count and enforces a max (e.g., 3 rounds)

**New API endpoints**:

```python
# POST /scrape/observe - Start or continue an observe-execute session
@router.post("/observe", response_model=AIResponse[ObserveResponse])
async def scrape_observe(request: ObserveRequest, ...):
    ...

# POST /scrape/complete - Mark a session as complete (for cleanup)
@router.post("/complete")
async def scrape_complete(session_id: str, success: bool, ...):
    ...
```

**System prompt** changes from "return selectors JSON" to:

> "You are a web automation agent. Given the current page state, a goal, and optionally the results of previous actions you suggested, produce a sequence of executable Puppeteer actions to achieve the goal. Each action must be one of: click, type, waitForSelector, scroll, pressKey, navigate. Return structured JSON with action_id, type, selector, value, etc. If the goal appears already achieved based on the page state, return status='goal_achieved'. If you've exhausted reasonable attempts, return status='give_up'."

**Session management**: Use a simple in-memory dict with TTL (or Redis) keyed by `session_id`. Each session stores:

- The original goal
- History of observations and actions (for multi-turn LLM context)
- Iteration counter

---

#### 2. Client-Side Changes (aiFetchly)

**`AiChatApi`** — Add new methods and interfaces:

```typescript
interface ObserveRequest {
  sessionId?: string;
  pageContent: string;
  pageUrl: string;
  screenshot?: string;
  goal: string;
  platformName: string;
  selectorsAvailable: Record<string, string>;
  previousActionResults: ActionResult[];
  iteration: number;
}

interface ExecutableAction {
  actionId: string;
  type: "click" | "type" | "waitForSelector" | "scroll" | "pressKey" | "navigate" | "screenshot";
  selector?: string;
  selectorType: "css" | "xpath" | "text";
  value?: string;
  key?: string;
  timeout: number;
  description: string;
}

interface ObserveResponse {
  sessionId: string;
  status: "actions_needed" | "goal_achieved" | "give_up";
  actions: ExecutableAction[];
  explanation: string;
  confidence: number;
  shouldRetry: boolean;
  maxIterationsRemaining: number;
}

// New method
async scrapeObserve(params: ObserveRequest): Promise<CommonApiresp<ObserveResponse>>
```

**`YellowPagesAiSupportHandler`** — Add a new request type `"observe_execute"` that acts as a thin proxy to the server (or optionally orchestrates the loop in main process).

**`YellowPagesScraper` (child process)** — Add an action executor:

```typescript
private async executeAction(action: ExecutableAction): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "click":
        await this.page.click(action.selector, { timeout: action.timeout });
        return { actionId: action.actionId, success: true, elementFound: true };
      case "type":
        await this.page.type(action.selector, action.value, { delay: 50 });
        return { actionId: action.actionId, success: true, elementFound: true };
      case "waitForSelector":
        await this.page.waitForSelector(action.selector, { timeout: action.timeout });
        return { actionId: action.actionId, success: true, elementFound: true };
      case "pressKey":
        await this.page.keyboard.press(action.key);
        return { actionId: action.actionId, success: true, elementFound: true };
      // ... etc
    }
  } catch (error) {
    return { actionId: action.actionId, success: false, error: error.message, elementFound: false };
  }
}
```

**New IPC message types** in `BackgroundProcessMessages.ts`:

```typescript
type AiSupportRequestType = "step_guidance" | "contact_extraction" | "observe_execute";

interface AiObserveExecuteRequestMessage extends BaseBackgroundMessage {
  type: "AI_OBSERVE_EXECUTE_REQUEST";
  requestId: string;
  goal: string;
  pageContent: string;
  pageUrl: string;
  screenshot?: string;
  platformName: string;
  selectorsAvailable: Record<string, string>;
}

interface AiExecuteActionsMessage extends BaseBackgroundMessage {
  type: "AI_EXECUTE_ACTIONS";
  requestId: string;
  actions: ExecutableAction[];
}

interface AiActionResultsMessage extends BaseBackgroundMessage {
  type: "AI_ACTION_RESULTS";
  requestId: string;
  results: ActionResult[];
  newPageContent: string;
  newScreenshot?: string;
}

interface AiObserveExecuteCompleteMessage extends BaseBackgroundMessage {
  type: "AI_OBSERVE_EXECUTE_COMPLETE";
  requestId: string;
  success: boolean;
  explanation: string;
}
```

---

#### 3. Where to Put the Loop Orchestration

**Option A: Loop in the main process** (`YellowPagesAiSupportHandler`)

- Main process orchestrates the observe-execute loop
- Child process just executes individual actions and reports back
- Pro: Main process has HTTP access and can manage sessions easily
- Con: More complex IPC back-and-forth

**Option B: Loop in the child process** (`YellowPagesScraper`) — **Recommended**

- Child process sends one `observe_execute` request with the goal
- Main process proxies each observe call to the server
- Child process executes actions locally, gathers new state, and sends another request
- Pro: Simpler IPC (child drives the loop), action execution is closer to the page
- Con: Child process needs to manage more state

**Recommended flow (Option B):**

```
Child Process (drives loop):
  1. Capture page state (HTML + screenshot)
  2. Send AI_OBSERVE_REQUEST to main process (with goal, state, previous results)
  3. Receive AI_OBSERVE_RESPONSE (with actions or "done"/"give_up")
  4. If actions_needed: execute each action, collect results
  5. Go to step 1 with new state + action results
  6. If goal_achieved/give_up: done

Main Process (thin proxy):
  - Receives AI_OBSERVE_REQUEST
  - Calls server POST /scrape/observe
  - Returns AI_OBSERVE_RESPONSE to child
```

---

#### 4. Backward Compatibility

- Keep the existing `/scrape/assist` endpoint and `step_guidance` request type working as-is
- Add the new `/scrape/observe` endpoint alongside it
- Add `observe_execute` as a new `AiSupportRequestType`
- The child process can choose which mode to use based on configuration (e.g., `aiSupportMode: "single" | "observe_execute"`)

---

#### 5. Key Design Considerations

| Concern | Recommendation |
|---------|-----------------|
| **Max iterations** | Default 3, configurable per request. Prevents infinite loops and runaway costs. |
| **Session TTL** | 5 minutes server-side. After that, session state is evicted. |
| **Action safety** | Reuse the `SAFE_OPERATIONS` whitelist from `puppeteer_recovery.py`. Only allow click, type, waitForSelector, scroll, pressKey, navigate. |
| **Token cost** | Each iteration is an LLM call. Consider including cumulative conversation history but summarizing older rounds to keep token count manageable. |
| **Timeout** | Each observe-execute round should have a timeout (30s). The total loop should also have a global timeout (e.g., 90s). |
| **Caching** | Cache by (goal + page_url + platform) for the initial observation. Don't cache subsequent iterations since they depend on dynamic state. |
| **Error escalation** | If the AI gives up or max iterations reached, fall back to the old behavior (use hardcoded selectors or skip the step). |

---

#### 6. Additional Improvements (Recommended)

These items improve reliability, safety, debuggability, and long-term evolvability beyond the core observe-execute loop.

##### 6.1 Output Safety + Strict Executability

- **Action allowlist**: enforce a server-side allowlist similar to `puppeteer_recovery.py` (e.g., only `click`, `type`, `waitForSelector`, `pressKey`, `scroll`, `navigate`). Reject any other action types.
- **Cap actions per round**: limit action count per iteration (e.g., max 5) to prevent runaway loops and costs.
- **Action validation**: validate each action before returning it to the client (required fields present; selector type known; timeout bounds).
- **Selectors as facts**: optionally require each action to include an `expected_outcome` (e.g., “results list becomes visible”, “URL changes”, “input value equals keyword”) so the client can verify deterministically.

##### 6.2 Better “Observation” Payload (Reduce Hallucinated Selectors)

Instead of sending only raw HTML, include higher-signal structured data to help planning:

- **Accessibility tree snapshot** (if available): mirrors the approach used by puppeteer recovery, and helps the model reason about visible/interactive elements.
- **Selector probe results**: client can pre-test candidate selectors and report `{ selector: { exists, visible, count } }` so the model plans based on evidence.
- **Targeted HTML excerpts**: send relevant container snippets (e.g., search form container, list container) rather than very large HTML blocks.

##### 6.3 Explicit Goal Verification (Don’t Trust “goal_achieved” Alone)

Add an explicit verification mechanism:

- Server returns `success_criteria` (or “verifier steps”), such as:
  - “selector X exists and is visible”
  - “results count >= 1”
  - “URL matches pattern”
  - “input value matches keyword/location”
- Client evaluates criteria after executing the actions and sends the pass/fail + evidence back to the server.

##### 6.4 Robust JSON Parsing for LLM Responses (Server)

Current scrape assist uses custom JSON extraction/parsing. For consistency and reliability:

- Use `safe_parse_json_from_llm_response()` from `aifetchserver.utils.json_utils` (already used in puppeteer recovery) to handle code fences, leading/trailing text, and other common LLM formatting issues.

##### 6.5 Session Memory + Summarization

To control token growth across iterations:

- Maintain a **rolling summary** of prior rounds (what was attempted, what failed, why).
- Keep only the most recent N observations/results verbatim; store older rounds in the summary.

##### 6.6 Fallback Ladder (Graceful Degradation)

When observe-execute cannot solve the step within limits:

1. Try alternate selector strategies (CSS → text-based → XPath) within the allowlist.
2. Try recovery micro-actions (cookie banner close, small scroll, short wait).
3. Fall back to the existing one-shot `/scrape/assist` (“step_guidance”) response.
4. If still failing, return a clear “give_up” outcome with actionable diagnostics for humans (missing selectors, blocked by CAPTCHA/Cloudflare, etc.).

##### 6.7 Telemetry + Debug Artifacts

For production debugging and iteration improvements:

- Log per-session: `session_id`, iteration, model used, actions returned, action results, URL/title changes, confidence.
- Optionally persist minimal artifacts: first/last HTML snippet, last screenshot reference, last error (with redaction).

##### 6.8 Protocol Versioning + Compatibility

Add protocol/version fields to prevent client/server drift:

- `mode: "one_shot" | "observe_execute"`
- `protocol_version: 1`

This allows introducing new fields or action types later without breaking older clients.

---

#### 6. Summary of Changes Per File

| File | Changes |
|------|---------|
| `aifetchserver/schemas/scrape_assist.py` | Add `ExecutableAction`, `ActionResult`, `ObserveRequest`, `ObserveResponse` models |
| `aifetchserver/services/scrape_assist.py` | Add `observe_and_plan()` method with session management, multi-turn prompt building, action validation |
| `aifetchserver/api/scrape_assist.py` | Add `POST /scrape/observe` and `POST /scrape/complete` endpoints |
| `src/api/aiChatApi.ts` | Add `scrapeObserve()` method, `ExecutableAction`, `ActionResult`, `ObserveRequest`, `ObserveResponse` interfaces |
| `src/modules/interface/BackgroundProcessMessages.ts` | Add `observe_execute` request type and new IPC message types for the loop |
| `src/modules/YellowPagesAiSupportHandler.ts` | Add handler for `observe_execute` requests (thin proxy to server) |
| `src/childprocess/YellowPagesScraper.ts` | Add `executeAction()` method, `observeExecuteLoop()` method that drives the loop, replace hardcoded selector application with structured action execution |

---

## References

- Current server: `aifetchserver/services/scrape_assist.py`, `aifetchserver/api/scrape_assist.py`
- Current client: `src/api/aiChatApi.ts`, `src/modules/YellowPagesAiSupportHandler.ts`
- Related: `aifetchserver/services/puppeteer_recovery.py` for structured action format and safety patterns
- Existing doc: `docs/AI_PUPPETEER_RECOVERY_ARCHITECTURE.md`
