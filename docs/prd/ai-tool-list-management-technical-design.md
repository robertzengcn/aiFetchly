# AI Tool List Management - Technical Design

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-21 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/ai-tool-list-management-prd.md` |
| Reference | `/home/robertzeng/project/github/claude-code/docs/tool-list-management.md` |
| Primary code paths | `src/config/skillsRegistry.ts`, `src/service/MCPToolService.ts`, `src/service/AIChatQueryEngine.ts`, `src/service/AIChatQueryLoop.ts`, `src/service/AIChatQueryEvents.ts`, `src/service/AgentRuntime.ts`, `src/api/aiChatApi.ts` |

## 1. Purpose

This document translates the AI Tool List Management PRD into an implementation-facing design for aiFetchly.

The goal is to reduce the `tools` or `client_tools` payload sent to LLM providers when many built-in skills, imported skills, plugin tools, MCP tools, plan-mode tools, and subagents are enabled. The design introduces a local deferred tool catalog for AI Chat V2 first, then extends the same contract to agent runtime and hosted legacy chat once provider support exists.

The design follows Claude Code's layered model at the product level:

```text
Full enabled catalog exists locally
  -> only core tools and discovery tool are sent initially
  -> model calls discovery tool for relevant capabilities
  -> discovered full schemas are exposed on later model rounds
  -> execution still passes existing permission and policy checks
```

The design does not depend on Anthropic-native `tool_reference` blocks. For the OpenAI-compatible V2 loop, discovery is implemented as a normal function tool and state is tracked locally.

## 2. Current Behavior To Preserve

### 2.1 Tool Registry Contract

`SkillRegistry.getAllToolFunctions()` returns enabled AI-callable tools in the current `ToolFunction` shape:

```typescript
export interface ToolFunction {
  type: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}
```

Existing callers should continue to work while the deferred catalog rolls out.

### 2.2 AI Chat V2 Loop Contract

`AIChatQueryEngine` currently builds `OpenAITool[]` and passes them to `AIChatQueryLoop`.

`AIChatQueryLoop.run()` owns the model round loop and sends:

```typescript
{
  messages,
  model: input.request.model,
  temperature: input.request.temperature,
  max_tokens: currentMaxTokens,
  stream: true,
  tools: currentTools.length > 0 ? currentTools : undefined,
  tool_choice: resolveToolChoiceForRound(...)
}
```

This round boundary is the correct place to filter the exposed tool list.

### 2.3 Tool Execution Contract

Tool execution remains unchanged:

```text
AIChatQueryLoop
  -> SkillExecutor / ToolExecutor / plan tool interceptors
  -> existing permission, timeout, hooks, and policy code
```

Discovery only controls prompt exposure. It does not grant permission, trust MCP servers, bypass plan-mode gating, or authorize agent tools.

### 2.4 Architecture Boundaries

Implementation must preserve repository rules:

- IPC handlers check `USER_AI_ENABLED` first for AI features.
- IPC handlers call Modules or Services, not TypeORM repositories.
- Database access stays in Models and Modules.
- Worker processes never access the database directly.
- New worker entry points, if ever needed, must live under `src/childprocess/`.

The first release requires no new worker process.

## 3. Scope

In scope for MVP:

- Tool catalog type system.
- Tool load policy classification.
- MCP description truncation and schema pruning utilities.
- Compact `tool_catalog_search` function.
- AI Chat V2 per-round tool filtering.
- Conversation-local discovered-tool state.
- Feature flag based enablement: off, on, auto.
- Structured logs for catalog metrics.
- Tests for catalog, search, V2 loop filtering, and MCP caps.

In scope after MVP:

- Persisted discovered-tool state.
- Deferred tool delta announcements.
- Agent runtime allowlist-aware catalog filtering.
- Hosted `client_tools` compatibility.
- Optional diagnostics UI.

Out of scope:

- Anthropic-native `tool_reference` support in MVP.
- New remote tool-search service.
- Tool result storage or truncation.
- Permission mode redesign.
- New plugin format fields.

## 4. Key Decisions

### 4.1 V2 Uses Local Discovery

OpenAI-compatible providers do not have a common `tool_reference` block. aiFetchly will expose `tool_catalog_search` as a normal function. When the model calls it, the local loop executes it and records selected tool names. On the next round, the selected tools' full schemas are included in `tools`.

### 4.2 `tool_catalog_search` Is Always Loaded

The discovery function must be available whenever deferred mode is active. It is part of the core exposed tool set.

### 4.3 MCP Tools Default To Deferred

MCP tools are the largest and most variable tool source. They default to `deferred` unless explicitly promoted by context or feature configuration.

### 4.4 Plan Tools Stay Mode-Required

Plan-mode tools are small and semantically required when plan mode is active. They should be exposed directly during plan mode rather than requiring discovery. `EnterPlanMode` remains contextual in normal chat when auto-plan is enabled.

### 4.5 Agent Runtime Filters Before Catalog Search

Agent runs already narrow tools through `AgentToolPolicyService`. Catalog search for an agent must operate only inside that narrowed tool set.

### 4.6 State Starts In Memory, Then Persists

The MVP can keep discovered tool state inside one `AIChatQueryLoop.run()` invocation. Phase 3 persists state to conversation metadata so resume and compaction boundaries are safe.

### 4.7 Fallback Is Non-Destructive

If catalog filtering fails, the app logs the reason and sends the full tool list for that request. This preserves existing behavior and avoids blocking chat.

## 5. Target Architecture

```text
SkillRegistry.getAllToolFunctions()
  -> ToolCatalogService.buildCatalog()
       - normalizes ToolFunction/OpenAITool data
       - computes source, policy, size, schema hash
       - applies stable ordering
       - includes full tool definition locally
  -> ToolPromptBudgetService.resolveMode()
       - off/on/auto
       - estimates prompt cost
  -> AIChatQueryLoop
       - includes tool_catalog_search when deferred mode is active
       - filters exposed tools every round
       - intercepts tool_catalog_search calls
       - records discovered tools
       - continues normal loop
  -> AiChatApi.openAIChatCompletionStream()
       - receives reduced OpenAITool[]
```

For MCP metadata:

```text
MCPToolService.discoverTools()
  -> ToolSchemaSanitizer.truncateDescription()
  -> ToolSchemaSanitizer.pruneJsonSchema()
  -> persist sanitized metadata

MCPToolService.getEnabledMCPToolsAsFunctions()
  -> apply defense-in-depth sanitization
  -> return ToolFunction[]
```

For later persisted state:

```text
AIChatQueryEngine
  -> ConversationToolStateModule.load(conversationId)
  -> AIChatQueryLoop.run({ toolCatalogState })
  -> ConversationToolStateModule.save(conversationId, discoveredNames, announcements)
```

## 6. New Files

Recommended files:

```text
src/entityTypes/toolCatalogTypes.ts
src/config/toolCatalogConfig.ts
src/service/ToolCatalogService.ts
src/service/ToolLoadPolicyService.ts
src/service/ToolCatalogSearchService.ts
src/service/ToolPromptBudgetService.ts
src/service/ToolSchemaSanitizer.ts
src/service/ToolCatalogMetricsService.ts
src/service/ConversationToolStateService.ts
src/modules/ConversationToolStateModule.ts
src/model/ConversationToolState.model.ts
src/entity/ConversationToolState.entity.ts
test/vitest/main/service/ToolCatalogService.test.ts
test/vitest/main/service/ToolCatalogSearchService.test.ts
test/vitest/main/service/ToolPromptBudgetService.test.ts
test/vitest/main/service/ToolSchemaSanitizer.test.ts
test/vitest/main/service/AIChatQueryLoop.toolCatalog.test.ts
```

MVP can omit the entity/model/module files if discovered state remains in memory. Add them in Phase 3.

## 7. Type System

### 7.1 Catalog Types

File: `src/entityTypes/toolCatalogTypes.ts`

```typescript
import type { OpenAITool, ToolFunction } from "@/api/aiChatApi";

export type ToolCatalogSource =
  | "builtin"
  | "mcp"
  | "plugin"
  | "imported"
  | "plan"
  | "subagent"
  | "system";

export type ToolLoadPolicy = "always" | "deferred" | "contextual";

export type ToolCatalogMode = "off" | "on" | "auto";

export interface ToolCatalogEntry {
  readonly name: string;
  readonly source: ToolCatalogSource;
  readonly loadPolicy: ToolLoadPolicy;
  readonly description: string;
  readonly shortDescription: string;
  readonly category?: string;
  readonly searchHints: readonly string[];
  readonly estimatedTokens: number;
  readonly schemaHash: string;
  readonly toolFunction?: ToolFunction;
  readonly openAITool: OpenAITool;
}

export interface ToolCatalog {
  readonly entries: readonly ToolCatalogEntry[];
  readonly byName: ReadonlyMap<string, ToolCatalogEntry>;
  readonly always: readonly ToolCatalogEntry[];
  readonly deferred: readonly ToolCatalogEntry[];
  readonly contextual: readonly ToolCatalogEntry[];
  readonly totalEstimatedTokens: number;
  readonly deferredEstimatedTokens: number;
}

export interface ToolCatalogRuntimeContext {
  readonly conversationId: string;
  readonly model?: string;
  readonly isPlanMode: boolean;
  readonly autoPlanEnabled: boolean;
  readonly currentUserMessage: string;
  readonly uploadedFileTypes: readonly string[];
  readonly routeName?: string;
  readonly allowedToolNames?: ReadonlySet<string>;
  readonly blockedToolNames?: ReadonlySet<string>;
}

export interface ToolCatalogState {
  readonly discoveredToolNames: ReadonlySet<string>;
  readonly announcedDeferredNames: ReadonlySet<string>;
}

export interface ToolCatalogFilterResult {
  readonly exposedTools: readonly OpenAITool[];
  readonly exposedToolNames: readonly string[];
  readonly deferredToolNames: readonly string[];
  readonly mode: "standard" | "deferred";
  readonly reason: string;
  readonly metrics: ToolCatalogMetrics;
}

export interface ToolCatalogMetrics {
  readonly totalCount: number;
  readonly alwaysCount: number;
  readonly deferredCount: number;
  readonly contextualCount: number;
  readonly discoveredCount: number;
  readonly exposedCount: number;
  readonly estimatedTotalTokens: number;
  readonly estimatedExposedTokens: number;
  readonly largestTools: readonly ToolCatalogLargestTool[];
}

export interface ToolCatalogLargestTool {
  readonly name: string;
  readonly source: ToolCatalogSource;
  readonly estimatedTokens: number;
}
```

### 7.2 Search Types

```typescript
export interface ToolCatalogSearchArgs {
  readonly query?: string;
  readonly max_results?: number;
  readonly select?: readonly string[];
}

export interface ToolCatalogSearchMatch {
  readonly name: string;
  readonly source: ToolCatalogSource;
  readonly description: string;
  readonly category?: string;
  readonly score: number;
  readonly alreadyExposed: boolean;
}

export interface ToolCatalogSearchResult {
  readonly success: boolean;
  readonly query: string;
  readonly matches: readonly ToolCatalogSearchMatch[];
  readonly selectedToolNames: readonly string[];
  readonly missingToolNames: readonly string[];
  readonly message: string;
}
```

### 7.3 Persisted State Types

Phase 3 can persist state in a dedicated entity:

```typescript
export interface ConversationToolStateView {
  readonly conversationId: string;
  readonly discoveredToolNames: readonly string[];
  readonly announcedDeferredToolNames: readonly string[];
  readonly catalogHash?: string;
  readonly updatedAt: string;
}
```

## 8. Configuration

File: `src/config/toolCatalogConfig.ts`

```typescript
export const TOOL_CATALOG_SEARCH_TOOL_NAME = "tool_catalog_search";

export const TOOL_CATALOG_ENV = {
  mode: "AI_TOOL_SEARCH",
  thresholdPercent: "AI_TOOL_SEARCH_THRESHOLD_PERCENT",
} as const;

export const TOOL_CATALOG_DEFAULTS = {
  mode: "auto",
  autoThresholdPercent: 10,
  charsPerToken: 4,
  shortDescriptionChars: 240,
  mcpDescriptionChars: 2048,
  schemaMaxChars: 12000,
  searchDefaultMaxResults: 5,
  searchMaxResults: 10,
  largestToolMetricCount: 10,
} as const;
```

Use environment variables for developer rollout. A later settings UI can move stable user-facing controls into `Token`.

Mode resolution:

```text
AI_TOOL_SEARCH=off     -> standard behavior
AI_TOOL_SEARCH=on      -> deferred behavior
AI_TOOL_SEARCH=auto    -> threshold-based behavior
unset                  -> auto in development, off or auto by release decision
invalid value          -> auto and log warning
```

## 9. Tool Source Detection

`ToolCatalogService` should derive source without changing existing tool names.

Suggested rules:

```text
name === tool_catalog_search          -> system
name starts with "mcp__"              -> mcp and plugin-owned MCP
name matches /^mcp_[0-9]+_/           -> mcp
SkillRegistry.getSkill(name).source   -> builtin/imported/plugin inference
plan tool names                       -> plan
run_subagent or subagent wrappers     -> subagent/system depending on implementation
fallback                              -> builtin
```

Because `SkillDefinition.source` is currently `"built-in" | "user" | "marketplace"` and plugin ownership is stored separately as `pluginOwner`, map as:

```text
source === "built-in"                 -> builtin
source === "user"                     -> imported
source === "marketplace"              -> imported
pluginOwner exists                    -> plugin
```

The catalog service may accept optional injected resolvers in tests:

```typescript
interface ToolCatalogServiceDeps {
  readonly getSkillDefinition?: (name: string) => SkillDefinition | null;
  readonly inferPlanToolName?: (name: string) => boolean;
}
```

## 10. Load Policy Rules

File: `src/service/ToolLoadPolicyService.ts`

The load policy service should be pure and easy to test.

Always loaded:

```text
tool_catalog_search
file_read
glob_files
grep_files
check_tool_job_status
knowledge_library_search only when RAG/document context is active
EnterPlanMode only when auto-plan is enabled and not already in plan mode
AskUserQuestion and SubmitPlanForApproval only when plan mode is active
```

Deferred:

```text
MCP tools
plugin-owned skills
imported user skills
marketplace skills
browser automation tools not obviously required
marketing workflow tools
external scraping/search tools
subagent targets
```

Contextual promotion:

```text
uploaded .csv/.xlsx/.pdf          -> matching file/document tools
current route is MCP settings     -> MCP diagnostic tools, if any
current message mentions exact tool name -> promote that tool for one turn
plan mode active                  -> plan tools
agent allowlist has small count   -> expose all allowed tools if under budget
```

Implementation shape:

```typescript
export class ToolLoadPolicyService {
  classify(input: {
    readonly tool: OpenAITool;
    readonly source: ToolCatalogSource;
    readonly context: ToolCatalogRuntimeContext;
  }): ToolLoadPolicy {
    // deterministic rule ordering
  }
}
```

Policy must not inspect tool arguments because arguments do not exist before tool selection.

## 11. Catalog Building

File: `src/service/ToolCatalogService.ts`

Responsibilities:

1. Accept full `ToolFunction[]` or `OpenAITool[]`.
2. Normalize to `OpenAITool`.
3. Sanitize descriptions and schemas.
4. Estimate token cost.
5. Compute schema hash.
6. Classify source and load policy.
7. Build indexes and sorted lists.

Public API:

```typescript
export class ToolCatalogService {
  async buildFromToolFunctions(input: {
    readonly toolFunctions: readonly ToolFunction[];
    readonly extraOpenAITools?: readonly OpenAITool[];
    readonly context: ToolCatalogRuntimeContext;
  }): Promise<ToolCatalog> {
    // implementation
  }

  buildFromOpenAITools(input: {
    readonly tools: readonly OpenAITool[];
    readonly context: ToolCatalogRuntimeContext;
  }): ToolCatalog {
    // implementation
  }

  filterForRound(input: {
    readonly catalog: ToolCatalog;
    readonly state: ToolCatalogState;
    readonly modeDecision: ToolCatalogModeDecision;
    readonly forcedToolNames?: ReadonlySet<string>;
  }): ToolCatalogFilterResult {
    // implementation
  }
}
```

Stable ordering:

```text
system tools first, by name
plan tools next, by name
builtin tools next, by name
imported/plugin tools next, by name
MCP tools last, by name
```

Deduplicate by name before building the catalog. Existing built-ins should continue to take precedence over MCP name collisions.

## 12. Prompt Budget Decision

File: `src/service/ToolPromptBudgetService.ts`

Responsibilities:

- Resolve feature flag mode.
- Estimate total and deferred tool cost.
- Decide whether deferred mode is active.
- Return an explainable reason for logs.

Types:

```typescript
export interface ToolCatalogModeDecision {
  readonly mode: "standard" | "deferred";
  readonly configuredMode: ToolCatalogMode;
  readonly reason: string;
  readonly thresholdTokens?: number;
  readonly estimatedDeferredTokens: number;
  readonly contextWindowTokens?: number;
}
```

Context window source:

1. Use provider/model metadata if available.
2. Use `LocalAIProviderConfig.contextSize` for local providers.
3. Use a conservative fallback such as 128,000 tokens for modern hosted chat only if no model metadata exists.
4. If no reliable context size exists, use a character threshold fallback.

Token estimate:

```typescript
function estimateToolTokens(tool: OpenAITool): number {
  const json = JSON.stringify(tool);
  return Math.ceil(json.length / TOOL_CATALOG_DEFAULTS.charsPerToken);
}
```

Auto decision:

```text
if configured off -> standard
if configured on -> deferred
if deferredEstimatedTokens >= contextWindowTokens * thresholdPercent / 100 -> deferred
else -> standard
```

## 13. Discovery Tool

### 13.1 Tool Definition

The discovery tool is a normal OpenAI function:

```typescript
export const TOOL_CATALOG_SEARCH_OPENAI_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: TOOL_CATALOG_SEARCH_TOOL_NAME,
    description:
      "Search the available deferred tool catalog and select tools to load before calling them.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keyword query describing the capability, integration, source, or exact tool name.",
        },
        max_results: {
          type: "number",
          minimum: 1,
          maximum: TOOL_CATALOG_DEFAULTS.searchMaxResults,
        },
        select: {
          type: "array",
          items: { type: "string" },
          description:
            "Exact tool names to load. Use this when a deferred tool name is already known.",
        },
      },
      required: [],
    },
  },
};
```

### 13.2 Search Behavior

File: `src/service/ToolCatalogSearchService.ts`

Algorithm:

1. Normalize query to lowercase words.
2. If `select` contains names, resolve exact names first.
3. If query exactly matches a tool name, return that match first.
4. Parse tool-name parts:
   - `mcp__plugin__server__tool` -> plugin, server, tool parts.
   - `mcp_42_search` -> mcp, server id, tool parts.
   - `file_read` -> file, read.
   - `SearchMapsBusinesses` -> search, maps, businesses.
5. Apply required terms if a term starts with `+`.
6. Score matches.
7. Return top `max_results`.

Scoring:

| Signal | Score |
|------|-------|
| Exact full name | 100 |
| Exact name part | 20 |
| MCP/plugin/server part | 18 |
| Required term match | 16 |
| Category match | 14 |
| Search hint match | 12 |
| Partial name part | 8 |
| Short description word match | 5 |
| Already used/discovered in conversation | 3 |

Selection output:

- `selectedToolNames` should include exact selects plus matched names that should be loaded.
- Search results should avoid loading too many tools by default.
- If the model only wants to inspect choices, it can set a low `max_results`.

### 13.3 Tool Result Content

Result returned to the model:

```json
{
  "success": true,
  "query": "maps businesses",
  "selectedToolNames": ["search_maps_businesses"],
  "matches": [
    {
      "name": "search_maps_businesses",
      "source": "builtin",
      "category": "maps",
      "description": "Search local businesses from map providers.",
      "score": 42,
      "alreadyExposed": false
    }
  ],
  "message": "Selected 1 tool. The full schema will be available in the next model round."
}
```

The result should be compact. Do not include full schemas in the tool result.

## 14. AIChatQueryLoop Integration

### 14.1 Extend Loop Input

File: `src/service/AIChatQueryEvents.ts`

Add optional catalog fields:

```typescript
export interface AIChatQueryLoopInput {
  // existing fields...
  toolCatalog?: ToolCatalog;
  toolCatalogState?: ToolCatalogState;
  toolCatalogModeDecision?: ToolCatalogModeDecision;
}
```

Pending state types must carry catalog state:

```typescript
export interface PendingPermissionTurn {
  // existing fields...
  toolCatalogState?: ToolCatalogStateSnapshot;
}

export interface PendingPlanQuestionTurn {
  // existing fields...
  toolCatalogState?: ToolCatalogStateSnapshot;
}
```

Use serializable snapshots in pending objects:

```typescript
export interface ToolCatalogStateSnapshot {
  readonly discoveredToolNames: readonly string[];
  readonly announcedDeferredNames: readonly string[];
}
```

### 14.2 Filter Before Request

Inside `AIChatQueryLoop.run()`, replace direct use of `currentTools` in the request with a filtered list.

Current:

```typescript
tools: currentTools.length > 0 ? currentTools : undefined
```

Target:

```typescript
const toolFilter = this.resolveToolsForRound({
  baseTools: currentTools,
  catalog: input.toolCatalog,
  state: mutableToolCatalogState,
  modeDecision: input.toolCatalogModeDecision,
  planContext,
  forcedToolNames,
});

await this.deps.streamChatCompletion({
  messages,
  model: input.request.model,
  temperature: input.request.temperature,
  max_tokens: currentMaxTokens,
  stream: true,
  tools: toolFilter.exposedTools.length > 0 ? toolFilter.exposedTools : undefined,
  tool_choice: resolveToolChoiceForRound({
    message: input.request.message,
    hasTools: toolFilter.exposedTools.length > 0,
    isPlanMode: Boolean(planContext),
    round,
    startRound: input.startRound,
  }),
}, onChunk, options);
```

Important: `currentTools` remains the full local executable set for the loop. Only `toolFilter.exposedTools` is sent to the provider.

### 14.3 Intercept Discovery Tool Calls

In the parsed tool-call loop, before plan tool handling and before `SkillExecutor`, add:

```typescript
if (call.name === TOOL_CATALOG_SEARCH_TOOL_NAME) {
  await emitToolCall(call.arguments ?? {});
  const result = catalogSearchService.search({
    args: call.arguments ?? {},
    catalog: input.toolCatalog,
    state: mutableToolCatalogState,
    context,
  });
  for (const name of result.selectedToolNames) {
    mutableToolCatalogState.discoveredToolNames.add(name);
  }
  const content = serializeToolResultContent(result);
  eventSink.emit({
    type: "tool_result",
    conversationId: input.conversationId,
    messageId: input.assistantMessageId,
    toolCallId: call.id,
    toolName: call.name,
    fullContent: content,
    toolResult: result as unknown as Record<string, unknown>,
  });
  messages.push({
    role: "tool",
    tool_call_id: call.id,
    content,
  });
  continue;
}
```

Implementation should avoid the `as unknown as` cast above by defining the result as `Record<string, unknown>` compatible or by adding a small serializer helper.

### 14.4 Unknown Tool Recovery

If the model calls a deferred tool before discovery, the provider should normally reject the call because it did not receive the schema. Some providers may still stream an unknown tool name. The loop should handle this gracefully:

```text
if call.name is in catalog but not currently exposed:
  add it to discovered state
  push tool result:
    success: false
    error: "Tool was deferred and has now been loaded. Retry the call with valid arguments."
  continue round
```

This avoids failing the user turn when the model inferred an exact name from the deferred announcement.

### 14.5 Permission Pause Carry-Forward

When returning `paused_for_permission`, include the catalog state snapshot:

```typescript
pending: {
  // existing fields...
  openAITools: currentTools,
  toolCatalogState: snapshotToolCatalogState(mutableToolCatalogState),
}
```

On resume, rebuild the mutable state from the snapshot. This prevents discovered tools from disappearing after approval.

### 14.6 Plan Question Carry-Forward

When returning `paused_for_plan_question`, include the same snapshot. When the user answers, pass the snapshot back into the loop.

Current code uses `openAITools: input.openAITools` in `handlePlanToolAskUserQuestion()`. That should be changed to preserve current tool mutations and catalog state consistently.

## 15. AIChatQueryEngine Integration

File: `src/service/AIChatQueryEngine.ts`

### 15.1 Initial Turn

Current V2 flow:

```text
toolFunctions = SkillRegistry.getAllToolFunctions()
openAITools = toOpenAITools(toolFunctions)
plan tools appended depending on mode
loop.run({ openAITools: allOpenAITools })
```

Target flow:

```text
toolFunctions = SkillRegistry.getAllToolFunctions()
baseOpenAITools = toOpenAITools(toolFunctions)
mode-required plan tools are appended
catalog = ToolCatalogService.buildFromToolFunctions(...)
decision = ToolPromptBudgetService.resolveMode(...)
state = ConversationToolStateService.loadOrCreate(...)
loop.run({
  openAITools: allOpenAITools,
  toolCatalog: catalog,
  toolCatalogModeDecision: decision,
  toolCatalogState: state
})
```

### 15.2 Deferred Tool Announcement

For MVP, include a compact system message only when deferred mode is active:

```text
Some available tools are deferred to reduce context usage. Use tool_catalog_search when you need a capability that is not currently exposed. Deferred tool categories include: mcp, plugin, imported, marketing, scraping, browser automation.
```

Do not include the full list in every request.

Phase 3 should add delta announcements based on `announcedDeferredNames`.

### 15.3 Completion Persistence

After a loop finishes, save the updated catalog state through `ConversationToolStateService`.

For MVP, if state is in memory only, no persistence step is needed.

## 16. AgentRuntime Integration

File: `src/service/AgentRuntime.ts`

Current flow:

```text
allTools = SkillRegistry.getAllToolFunctions()
exposedNames = policy.filterExposedToolNames(...)
exposedTools = exposedNames.map(name -> full schema)
loop.run({ openAITools: exposedTools })
```

Target flow:

```text
allTools = SkillRegistry.getAllToolFunctions()
allowedNames = policy.filterExposedToolNames(...)
allowedToolFunctions = allTools.filter(name in allowedNames)
catalog = ToolCatalogService.buildFromToolFunctions({
  toolFunctions: allowedToolFunctions,
  extraOpenAITools: mode tools if needed,
  context: { allowedToolNames: new Set(allowedNames), ... }
})
loop.run({
  openAITools: allowedOpenAITools,
  toolCatalog: catalog,
  toolCatalogState: empty per agent task,
  toolCatalogModeDecision
})
```

Important behavior:

- Discovery can never return tools outside `allowedNames`.
- If `allowedNames.length` is small, auto mode should probably stay standard.
- Agent-specific discovered state can be scoped to the agent task, not the parent chat conversation.

## 17. Legacy Hosted Chat Compatibility

Legacy path:

```text
AiChatApi.streamMessage()
  -> POST /api/ai/ask/stream with client_tools

AiChatApi.streamContinueWithToolResults()
  -> POST /api/ai/ask/continue with client_tools
```

Do not enable local deferred filtering for this path until the hosted server supports it. Otherwise the remote orchestrator will only know the reduced list and may be unable to call tools that local state thinks are discoverable.

Future hosted API contract:

```typescript
interface DeferredClientToolsPayload {
  readonly mode: "standard" | "deferred";
  readonly exposed_tools: readonly ToolFunction[];
  readonly deferred_catalog?: readonly ToolCatalogSummaryForServer[];
  readonly discovered_tool_names?: readonly string[];
  readonly catalog_hash?: string;
}
```

Server capability flag:

```text
/api/ai/capabilities -> { deferred_client_tools: true }
```

Until then, hosted legacy chat remains standard mode.

## 18. MCP Sanitization

File: `src/service/ToolSchemaSanitizer.ts`

### 18.1 Description Truncation

```typescript
export function truncateDescription(
  value: string | undefined,
  maxChars = TOOL_CATALOG_DEFAULTS.mcpDescriptionChars
): { readonly value: string | undefined; readonly truncated: boolean } {
  if (!value) return { value, truncated: false };
  if (value.length <= maxChars) return { value, truncated: false };
  return {
    value: `${value.slice(0, maxChars)}... [truncated]`,
    truncated: true,
  };
}
```

Use ASCII `...` instead of ellipsis to match repo editing rules.

### 18.2 Schema Pruning

Prune only when `JSON.stringify(schema).length > schemaMaxChars`.

Pruning order:

1. Remove `examples`.
2. Remove `default` when it is a long string or object.
3. Truncate long `description` fields recursively.
4. Remove redundant `title`.
5. Cap long enum arrays by keeping the first N values and adding a short description note.
6. If still too large, replace deeply nested object descriptions with short summaries while preserving:
   - `type`,
   - `properties`,
   - `required`,
   - `items`,
   - `enum` when small,
   - `additionalProperties` when present.

Return diagnostics:

```typescript
export interface SchemaSanitizeResult {
  readonly schema: Record<string, unknown>;
  readonly changed: boolean;
  readonly originalChars: number;
  readonly sanitizedChars: number;
  readonly actions: readonly string[];
}
```

### 18.3 Integration Points

In `MCPToolService.discoverTools()`:

```text
for each discovered tool:
  truncate description
  prune inputSchema
  store sanitized schema in metadata.toolSchemas
```

In `MCPToolService.getEnabledMCPToolsAsFunctions()`:

```text
sanitize again before returning ToolFunction
```

Defense in depth matters because older database rows may already contain huge metadata.

## 19. Persistence Design

Phase 3 should add a dedicated table instead of overloading message metadata.

### 19.1 Entity

File: `src/entity/ConversationToolState.entity.ts`

```typescript
@Entity("conversation_tool_state")
@Index(["conversationId"], { unique: true })
export class ConversationToolStateEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Column("text", { nullable: false, default: "[]" })
  discoveredToolNamesJson: string;

  @Column("text", { nullable: false, default: "[]" })
  announcedDeferredToolNamesJson: string;

  @Column("varchar", { length: 128, nullable: true })
  catalogHash?: string;

  @Column("datetime", { nullable: false })
  updatedAt: Date;
}
```

### 19.2 Model

File: `src/model/ConversationToolState.model.ts`

Responsibilities:

- `findByConversationId(conversationId)`
- `upsertState(view)`
- `deleteByConversationId(conversationId)` if conversation deletion later needs cleanup

Model extends `BaseDb` and uses the normal database path resolution. Do not access it from workers.

### 19.3 Module

File: `src/modules/ConversationToolStateModule.ts`

Responsibilities:

- Validate names as strings.
- Deduplicate and sort names before persistence.
- Drop names that are no longer in the current catalog.
- Convert entity rows into `ConversationToolStateView`.

### 19.4 Service

File: `src/service/ConversationToolStateService.ts`

Responsibilities:

- Load state for a conversation.
- Snapshot mutable sets for pending turns.
- Merge in selected names after search.
- Compute deferred announcement deltas.
- Save final state after loop completion or pause.

## 20. Deferred Announcement Design

MVP announcement can be category-level. Phase 3 should implement deltas.

### 20.1 Initial Category Announcement

Injected once into the messages assembled by `AIChatQueryEngine`:

```text
Tool catalog mode is active. Some tools are deferred to reduce context usage. Use `tool_catalog_search` when a task may need an integration, MCP server, plugin tool, imported skill, browser automation, scraper, or specialist workflow tool that is not currently available.
```

### 20.2 Delta Announcement

When persistent state exists:

```typescript
interface DeferredToolsDelta {
  readonly addedNames: readonly string[];
  readonly addedLines: readonly string[];
  readonly removedNames: readonly string[];
}
```

Format compact lines:

```text
<tool name> [source/category] - <short description>
```

Budgeting:

- Always include names.
- Cap descriptions to `shortDescriptionChars`.
- If names plus descriptions exceed budget, keep names and source only.
- Sort by source, then name.

## 21. Metrics And Logging

File: `src/service/ToolCatalogMetricsService.ts`

Structured log example:

```json
{
  "event": "tool_catalog_filter",
  "conversationId": "conv-123",
  "mode": "deferred",
  "reason": "deferred tool estimate exceeded 10% context threshold",
  "totalCount": 118,
  "alwaysCount": 8,
  "deferredCount": 93,
  "contextualCount": 17,
  "discoveredCount": 2,
  "exposedCount": 11,
  "estimatedTotalTokens": 45200,
  "estimatedExposedTokens": 4200,
  "largestTools": [
    { "name": "mcp__crm__openapi__create_lead", "source": "mcp", "estimatedTokens": 5400 }
  ]
}
```

Rules:

- Do not log full schemas by default.
- Do not log MCP auth config, environment variables, API keys, or tool arguments.
- Include names and sizes because names are already visible in the tool catalog.

## 22. Error Handling

### 22.1 Catalog Build Failure

If `ToolCatalogService.build*()` throws:

```text
log error
mode = standard
send full currentTools
continue request
```

### 22.2 Search Failure

If `tool_catalog_search` throws:

```text
return tool result:
{
  success: false,
  error: "Tool catalog search failed. The system will continue with currently exposed tools."
}
```

Do not crash the whole turn unless the failure indicates corrupted local state.

### 22.3 Discovered Tool Missing

If state contains a name that no longer exists:

```text
drop from discovered set
optionally announce unavailable in Phase 3
continue
```

### 22.4 Provider Rejects Reduced Tool Set

If a provider rejects the request because of tool schema issues, existing recovery surfaces the API failure. Auto fallback can retry once with full tools only if:

- no side-effectful tool was executed in this round,
- the failure happened before any assistant content or tool call was processed,
- the feature flag allows fallback retry.

MVP can log and fail normally instead of retrying with full tools.

## 23. Testing Strategy

### 23.1 Unit Tests

`ToolLoadPolicyService.test.ts`

- MCP tools classify as deferred.
- `tool_catalog_search` classifies as always.
- plan tools classify as always only in plan mode.
- plugin-owned skills classify as deferred.
- exact user message mention promotes contextual tool.

`ToolCatalogService.test.ts`

- deduplicates by tool name.
- preserves stable ordering.
- computes hashes consistently.
- calculates estimated token counts.
- filters exposed tools in standard mode and deferred mode.

`ToolCatalogSearchService.test.ts`

- exact `select` resolves names.
- exact name query wins.
- MCP prefix/name part ranking works.
- required `+term` filters candidates.
- disabled/blocked tools are absent.
- max results cap is enforced.

`ToolPromptBudgetService.test.ts`

- off always returns standard.
- on always returns deferred.
- auto returns deferred above threshold.
- auto returns standard below threshold.
- invalid env values fall back predictably.

`ToolSchemaSanitizer.test.ts`

- truncates long descriptions.
- leaves short descriptions unchanged.
- prunes examples and long descriptions.
- preserves required schema structure.
- reports actions and size changes.

### 23.2 AI Chat V2 Loop Tests

`AIChatQueryLoop.toolCatalog.test.ts`

Use injected fake `streamChatCompletion` and fake tool execution.

Cases:

- first request excludes deferred tools.
- first request includes `tool_catalog_search`.
- search result causes selected tool to appear in second request.
- unknown deferred tool call adds discovery error and continues.
- permission pause includes catalog state snapshot.
- plan-question pause includes catalog state snapshot.
- fallback standard mode sends all tools.

### 23.3 MCP Integration Tests

`MCPToolService` tests:

- discovered 30 KB description is capped before metadata persistence.
- old oversized metadata is capped during `getEnabledMCPToolsAsFunctions()`.
- schema pruning produces valid object schema.

### 23.4 Agent Runtime Tests

Agent tests:

- catalog search returns only agent-allowed tools.
- blocked tool is not exposed after search.
- small allowlist in auto mode remains standard.

### 23.5 Regression Tests

- `yarn testmain` for main process service tests.
- Existing skill execution tests.
- Existing MCP tool naming tests.
- Existing plan-mode tests.
- Existing permission pause/resume tests.

## 24. Implementation Phases

### Phase 1: Measurement And Sanitization

Files:

```text
src/config/toolCatalogConfig.ts
src/service/ToolSchemaSanitizer.ts
src/service/ToolPromptBudgetService.ts
src/service/ToolCatalogMetricsService.ts
src/service/MCPToolService.ts
```

Work:

1. Add constants and env parsing.
2. Add token estimation helpers.
3. Add MCP description truncation.
4. Add schema pruning.
5. Add defense-in-depth sanitization in MCP conversion.
6. Add structured logs for current full tool payload.

No behavior change to tool exposure.

### Phase 2: V2 Deferred Catalog MVP

Files:

```text
src/entityTypes/toolCatalogTypes.ts
src/service/ToolCatalogService.ts
src/service/ToolLoadPolicyService.ts
src/service/ToolCatalogSearchService.ts
src/service/AIChatQueryEngine.ts
src/service/AIChatQueryLoop.ts
src/service/AIChatQueryEvents.ts
```

Work:

1. Build catalog from V2 tool functions.
2. Add `tool_catalog_search` to exposed tools in deferred mode.
3. Add in-memory discovered set.
4. Filter tools per round.
5. Intercept discovery tool calls.
6. Add first-round category announcement.
7. Add V2 loop tests.

Feature flag default: `AI_TOOL_SEARCH=off` for first merge, then `auto` after QA.

### Phase 3: Persistence And Deltas

Files:

```text
src/entity/ConversationToolState.entity.ts
src/model/ConversationToolState.model.ts
src/modules/ConversationToolStateModule.ts
src/service/ConversationToolStateService.ts
src/config/SqliteDb.ts
```

Work:

1. Add entity to SQLite config.
2. Load state in `AIChatQueryEngine`.
3. Save state on completion, pause, and cancel where useful.
4. Carry state through pending permission and plan-question turns.
5. Add deferred-tool delta announcements.

### Phase 4: Agent Runtime

Files:

```text
src/service/AgentRuntime.ts
src/service/AgentToolPolicyService.ts
src/service/AIChatQueryLoop.ts
```

Work:

1. Build catalog after agent allowlist filtering.
2. Use agent-task scoped discovered state.
3. Ensure discovery cannot return blocked tools.
4. Add runtime tests.

### Phase 5: Hosted API Compatibility

Files:

```text
src/api/aiChatApi.ts
src/service/StreamEventProcessor.ts
hosted API server code
```

Work:

1. Add server capability discovery.
2. Add deferred `client_tools` payload shape.
3. Update continue endpoint contract.
4. Keep fallback to current full `client_tools`.

## 25. Rollback Plan

Immediate rollback:

```text
AI_TOOL_SEARCH=off
```

This must restore full-tool behavior without code changes.

Partial rollback:

- Keep MCP sanitization enabled because it reduces prompt risk and should not change tool semantics.
- Disable only per-round filtering if search behavior causes model quality issues.

Code rollback:

- Remove `toolCatalog` fields from loop input only after all callers are updated.
- Keep schema sanitizer if already used by MCP metadata.

## 26. Performance Considerations

Catalog building should be cheap enough to run per user turn.

Optimizations:

- Memoize catalog by a hash of tool names and schema hashes.
- Invalidate cache when:
  - plugin enablement changes,
  - skill registry changes,
  - MCP server/tool enablement changes,
  - MCP discovery updates metadata,
  - plan mode changes available plan tools.
- Avoid repeated `JSON.stringify` for the same tool by caching estimated token counts.
- Keep search in memory. No vector index is needed for MVP.

Expected cost:

```text
100-300 tools:
  catalog build: acceptable per turn
  search: simple O(n * terms), acceptable
  prompt savings: large when MCP schemas are heavy
```

## 27. Security Review Checklist

- Discovery output excludes disabled tools.
- Discovery output excludes policy-blocked tools.
- Tool execution still goes through `SkillExecutor`, `ToolExecutor`, plan policy, hooks, and permission services.
- MCP stdio trust remains enforced before discovery or execution.
- Catalog summaries do not expose auth config or environment variables.
- Logs contain tool names and sizes only, not full sensitive configuration.
- Unknown tool recovery does not execute the tool automatically.
- Feature flag fallback does not replay side-effectful tool calls.

## 28. Open Implementation Questions

1. Should MVP default be `off` or `auto` after merge?
2. Should discovered state be saved on every search call or only at turn terminal/pause boundaries?
3. Should `/skills` list deferred policy details or remain a simple user-facing catalog?
4. Should contextual promotion inspect only the current user message or recent conversation messages too?
5. Should very small plugin/imported tools remain always-loaded under auto mode?
6. Should schema pruning happen destructively at MCP discovery time or preserve raw schemas separately and sanitize only for LLM exposure?

## 29. Recommended First PR

The first implementation PR should be deliberately small:

1. Add `toolCatalogConfig.ts`.
2. Add `ToolSchemaSanitizer`.
3. Add `ToolPromptBudgetService` token estimation.
4. Apply MCP description caps in `MCPToolService`.
5. Add structured logging for current full catalog size.
6. Add unit tests.

This gives immediate protection against pathological MCP schemas and produces the metrics needed to tune deferred-mode thresholds before changing model behavior.
