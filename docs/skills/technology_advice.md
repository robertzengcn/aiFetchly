# Technology Advice: Implementing AI Skills in aiFetchly

This document complements [skills_workflow.md](./skills_workflow.md), [Skill Permissions and User Trust.md](./Skill%20Permissions%20and%20User%20Trust.md), and [Sandboxing TypeScript_JS Skills.md](./Sandboxing%20TypeScript_JS%20Skills.md). It covers concrete **how** decisions: libraries, patterns, and code-level choices for each layer.

---

## 1. The Most Critical Missing Piece: Tool-Call Execution Loop

The docs describe the loop conceptually. The key technology decision is **how `AiChatBox.vue` orchestrates it**. The current `case 'tool_call'` handler only displays the event — it does not execute or continue.

**Recommended approach: a `SkillExecutor` service (renderer-side orchestrator)**

```
src/
  service/
    skillExecutor.ts     ← new: dispatches tool calls to the right tier
  config/
    skillsRegistry.ts    ← new: static allowlist of built-in skills
  main-process/
    communication/
      skills-ipc.ts      ← new: IPC handlers for main-process skills
```

The flow in `AiChatBox.vue`'s `case 'tool_call'` should be:

1. **Validate** → is the tool name in the registry?
2. **Permission check** → does this skill need user confirmation? (use `dialog.showMessageBox` via IPC)
3. **Execute** → delegate to `SkillExecutor.execute(toolName, toolArgs)`
4. **Continue the stream** → call `streamContinueWithToolResults()`

The stream continuation must use the **same `onEvent` callback** so tokens keep flowing into the same `assistantContent` accumulator.

---

## 2. Skill Registry: Static Registry is the Right Choice for This Project

The `no dynamic import` rule means the only safe pattern is a **static registry** — a TypeScript file with explicit imports:

```typescript
// src/config/skillsRegistry.ts

interface SkillDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  tier: 'renderer' | 'main' | 'server';
  requiresConfirmation: boolean;
  permissionCategory: 'network' | 'filesystem' | 'automation' | 'pure';
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
```

Each skill is a **named export** from its own file (static import at the top of `skillsRegistry.ts`). The registry maps `name → SkillDefinition`. The LLM only sees the `name`, `description`, and `parameters` fields (the `ToolFunction` subset).

**Why this is better than a manifest.json approach for this use case**: TypeScript type safety all the way through, no file I/O at startup, no deserialization risks.

---

## 3. Built-in Skill Execution Tiers: Technology per Tier

### Tier 1: Renderer-only skills (pure)

These are synchronous or async functions that live entirely in the renderer. No special tech needed. Examples: format data, extract emails from text, summarize local history.

### Tier 2: Main-process skills (IPC)

Technology pattern — follow the existing **Module + IPC handler** architecture:

```typescript
// src/main-process/communication/skills-ipc.ts
ipcMain.handle('EXECUTE_SKILL', async (event, { skillName, args }) => {
  // 1. Check AI enable first (mandatory per project constitution)
  const tokenService = new Token();
  if (tokenService.getValue(USER_AI_ENABLED) !== 'true') {
    return { status: false, msg: 'AI not enabled', data: null };
  }
  // 2. Validate skillName is in allowlist
  // 3. Execute via Module layer (never direct DB access)
  // 4. Return JSON result
});
```

The renderer calls `window.electron.invoke('EXECUTE_SKILL', ...)` via `contextBridge`.

### Tier 3: Server skills

For skills that hit external APIs, the call goes through the existing `AiChatApi` (via `HttpClient`). This tier is already handled on the server side — the aifetchserver registers server-side tools and executes them there. Ensure the `client_tools` list only includes *client-side* skills where execution is local.

---

## 4. Sandboxing: When and What Library

| Scenario | Recommended approach |
|----------|----------------------|
| Built-in skills (your own code) | No sandbox needed — they're in your static registry |
| User-written personal scripts (power users) | **isolated-vm** with explicit allowlist of safe APIs |
| Third-party skill marketplace (future) | **Hidden BrowserWindow** (`sandbox: true`) — most isolated, Chrome's own sandbox |
| Python skills | Child process with `child_process.spawn`, not `exec` — lower risk surface |

**For v1**, you most likely only need **built-in skills**. Skip sandboxing until users can author their own code.

If/when you add user-authored skills, **isolated-vm** is the right call. Key setup:

- `memoryLimit: 64MB` (or similar) for most skills
- No access to: `process`, `fs`, `require`, `electron`
- Explicit grants: a "safe fetch" proxy, a `log` function, skill args

**Note:** `vm2` is no longer maintained — avoid it. `isolated-vm` is the current standard.

---

## 5. Permission System: Manifest at Install-time vs Runtime Prompts

The **manifest-at-install** approach is often better than runtime interception because:

- No permission dialog interrupting the AI stream
- Permission granted once, persisted (via existing `Token` / `ElectronStoreService` patterns)
- Better UX — user knows upfront what a skill does

**Concrete shape:**

```typescript
interface SkillPermissions {
  network?: string[];       // ['linkedin.com', 'api.example.com']
  filesystem?: 'read' | 'write' | 'none';
  automation?: boolean;     // can trigger Puppeteer/social posting
  database?: 'read' | 'write' | 'none';
}
```

Store granted permissions using the existing `Token` service pattern (same as `USER_AI_ENABLED`). Example keys: `SKILL_PERMISSION_linkedin_scraper = 'granted'`.

**Permission categories (risk mapping):**

- **automation** — can trigger social posting / scraping tasks → **High**, always confirm
- **filesystem** — can read/write local files → **High**, always confirm
- **network** — external HTTP calls → **Medium**, confirm first time per domain
- **pure** — no side effects → **None**, auto-allow

---

## 6. TypeScript Type Design (fits existing types)

Existing `ToolFunction` and `ToolExecutionResult` in `src/api/aiChatApi.ts` are the right foundation. Suggested additions:

```typescript
// Extend in src/entityTypes/commonType.ts or a new skillTypes.ts

export interface SkillExecutionContext {
  conversationId: string;
  skillName: string;
  toolCallId: string;
  args: Record<string, unknown>;
}

export type SkillTier = 'renderer' | 'main' | 'server';
export type SkillPermissionCategory = 'pure' | 'network' | 'filesystem' | 'automation';

export interface SkillResult {
  success: boolean;
  data: Record<string, unknown>;
  executionTimeMs: number;
  error?: string;
}
```

**Important:** Use `Record<string, unknown>` (not `any`) per project TypeScript rules. Each skill's `execute()` should narrow args with a type guard before use.

---

## 7. Integration with `AiChatBox.vue`'s Current Stream Handler

The `case 'tool_call'` in `sendMessage()` needs to become **async-capable**. Options:

**Option A (simpler): Fire-and-forget async inside the case**

```typescript
case 'tool_call': {
  // existing UI updates...
  isExecutingTool.value = true;

  executeSkillAndContinue(chunk, streamConversationId).catch(err => {
    streamError.value = err.message;
  });
  break;
}
```

**Option B (cleaner): Refactor the stream handler to support async**

`streamMessage()` in `AiChatApi.ts` uses `onEvent: (event: StreamEvent) => void`. To await tool execution before continuing, either:

- Change `onEvent` to return `Promise<void>` and allow async handlers, or
- Use a Promise queue to sequence tool execution with the stream

Option A is the minimal-risk change for v1.

---

## 8. aifetchserver Side (FastAPI)

The `/api/ai/ask/stream` endpoint should:

1. Accept `client_tools` in the request body (already sent from `aiChatApi.ts`)
2. Pass those tool definitions to the LLM as `tools=` in the API call
3. When the model requests a tool, emit a `tool_call` SSE event with `toolName`, `toolId`, and `toolParams`
4. The `/api/ai/ask/continue` endpoint receives `tool_results`, appends them to the conversation, then streams the next LLM response

**Convention:** Avoid double execution — either:

- **`client_tools`** → Electron executes them and calls `/continue`, or
- **Server-registered tools** → LangGraph executes them with no client `/continue`

Do not have both layers try to handle the same tool name.

---

## Summary: Recommended Implementation Order

| Step | What to build | Key tech |
|------|---------------|----------|
| 1 | `skillsRegistry.ts` with 1–2 pure skills | TypeScript static registry |
| 2 | `SkillExecutor.execute()` in renderer | Plain async/await |
| 3 | Wire `tool_call → execute → continue` in `AiChatBox.vue` | Existing `streamContinueWithToolResults()` |
| 4 | Skill permission storage | Existing `Token` service pattern |
| 5 | First main-process skill + IPC handler | `ipcMain.handle`, Module layer |
| 6 | Permission prompt dialog for high-risk skills | Electron `dialog.showMessageBox` |
| 7 | UI skill selector (toggle + choose skills) | New component, similar to `MCPToolManager` |
| 8 | Sandboxing (only if user-authored scripts needed) | `isolated-vm` |

Steps 1–3 deliver an end-to-end AI skills loop. Steps 4–7 make it production-safe. Step 8 applies only when users can run untrusted or user-authored code.

---

## Related docs

- [skills_workflow.md](./skills_workflow.md) — brain vs hands, tiers, no dynamic import
- [Skill Permissions and User Trust.md](./Skill%20Permissions%20and%20User%20Trust.md) — capability hooks, manifests, UX
- [Sandboxing TypeScript_JS Skills.md](./Sandboxing%20TypeScript_JS%20Skills.md) — isolated-vm, hidden window comparison
