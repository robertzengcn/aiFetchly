# AI Tool List Management - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-21
- **Owner**: aiFetchly Desktop
- **Primary area**: AI Chat V2, skills, MCP tools, plugin tools, subagents
- **Reference**:
  - `/home/robertzeng/project/github/claude-code/docs/tool-list-management.md`
- **Related code**:
  - `src/config/skillsRegistry.ts`
  - `src/service/MCPToolService.ts`
  - `src/service/AIChatQueryEngine.ts`
  - `src/service/AIChatQueryLoop.ts`
  - `src/service/StreamEventProcessor.ts`
  - `src/api/aiChatApi.ts`
  - `src/service/AgentRuntime.ts`

## 1. Executive Summary

aiFetchly exposes a growing set of AI-callable tools from built-in skills, imported skills, plugin-owned skills, MCP servers, plan-mode tools, file tools, knowledge tools, and subagents. Today, the enabled tool catalog is commonly assembled as one large list and sent to the LLM API. As users enable more MCP servers, plugins, and specialist agents, the `tools` or `client_tools` payload can consume a significant portion of the model context window before the user message or conversation history is considered.

Claude Code addresses the same problem with a layered tool-list management system: core tools are always loaded, workflow-specific tools are deferred, a search tool lets the model discover deferred tools, and later API calls include only tools that have been discovered. aiFetchly should adopt the same product pattern, adapted to its OpenAI-compatible chat loop and legacy hosted `client_tools` API.

The proposed feature introduces a compact tool catalog, an always-available tool discovery function, per-turn tool filtering, conversation-scoped discovered-tool state, MCP schema size limits, stable tool ordering, and metrics. The first release should focus on AI Chat V2 because it already owns the model-to-tool-to-model loop locally. The legacy hosted chat flow can adopt the same catalog contract after the V2 path proves stable.

## 2. Problem Statement

The current tool payload has several scaling problems:

1. Every enabled tool definition can be sent to the LLM even when most tools are irrelevant to the current task.
2. MCP tools can include very large descriptions and JSON schemas, especially when generated from OpenAPI-like servers.
3. Plugin growth increases the tool catalog without a matching context budget policy.
4. Subagents and plan-mode tools add more capability definitions to the same prompt budget.
5. Re-sending a large, changing tool array can reduce prompt-cache stability.
6. The model may pay attention to irrelevant tools and choose worse tool calls.
7. The application has no first-class metrics for tool catalog size, largest schemas, deferred tools, or prompt impact.

Without a layered approach, installing useful plugins or enabling multiple MCP servers creates a worse chat experience: higher token usage, slower requests, more context pressure, and less predictable tool selection.

## 3. Goals

- Reduce tool-definition tokens sent to the LLM on each request.
- Keep core tools available without extra discovery friction.
- Defer MCP, plugin, imported skill, and subagent tools until needed.
- Let the model discover relevant tools through a compact search tool.
- Preserve discovered tool availability across model rounds, retries, permission pauses, plan questions, and conversation resume.
- Cap excessive MCP descriptions and schemas before they enter the prompt.
- Keep tool ordering stable for prompt-cache friendliness.
- Provide metrics and logs for catalog size, deferred count, exposed count, and largest tool definitions.
- Keep execution security unchanged: a deferred tool cannot execute unless it is enabled and passes existing permission policy.
- Support a staged rollout with feature flags and a safe fallback to the current behavior.

## 4. Non-Goals

- Do not copy Anthropic-only `tool_reference` or `defer_loading` wire formats unless the active provider explicitly supports them.
- Do not require a new agent framework.
- Do not move database access into IPC handlers.
- Do not change tool permission prompts or approval modes.
- Do not remove user-level enable or disable controls for skills and MCP tools.
- Do not make all tools undiscoverable by default. Essential tools must remain always available.
- Do not optimize tool execution results in this PRD. Result truncation and persistence can be handled separately.
- Do not redesign the chat UI beyond optional debug or metrics display.

## 5. Current State

### 5.1 Tool Assembly

`SkillRegistry.getAllToolFunctions()` in `src/config/skillsRegistry.ts` returns built-in skill functions and dynamically discovered MCP functions. This is the primary source of the large tool list.

Current behavior:

- Built-in skills are converted to `ToolFunction`.
- Enabled MCP tools are appended.
- Plugin-owned skills and MCP servers are filtered by plugin enablement.
- The resulting list can be passed directly to AI requests.

### 5.2 AI Chat V2

`AIChatQueryEngine` builds OpenAI-compatible tool definitions from all tool functions, appends plan-mode tools when needed, then passes the full list into `AIChatQueryLoop`.

`AIChatQueryLoop` sends `tools: currentTools` on every model round. This is the best first insertion point for per-round filtering because the loop already owns:

- the messages array,
- tool-call parsing,
- tool-result injection,
- plan-mode transitions,
- permission pauses,
- retries,
- and model-to-tool-to-model rounds.

### 5.3 Legacy Hosted Chat

The legacy hosted path uses `client_tools` in `AiChatApi.streamMessage()` and `AiChatApi.streamContinueWithToolResults()`. This requires server-side support for any deferred-tool contract. Local filtering alone may prevent the remote server from knowing about tools it is expected to orchestrate.

### 5.4 MCP Tool Metadata

`MCPToolService.discoverTools()` persists MCP descriptions and input schemas from server discovery. `getEnabledMCPToolsAsFunctions()` later converts that data into LLM-facing tool definitions.

Current gap: MCP descriptions and schemas are not capped before being stored or sent.

## 6. Product Principles

### 6.1 Small First Payload

The first model call should include only the tools that are broadly useful or required to discover other tools.

### 6.2 Discovery Before Exposure

Workflow-specific tools should be discoverable by name, source, category, and short description before their full JSON schema is exposed.

### 6.3 Deferred Does Not Mean Disabled

A deferred tool remains enabled and executable once discovered. Deferral only controls whether its full schema is sent to the model.

### 6.4 Execution Policy Remains Authoritative

Tool discovery is not permission approval. Existing skill, MCP, shell, file, automation, plan-mode, and agent policies must still run before execution.

### 6.5 Conversation State Is the Source of Truth

Discovered tools must be tracked per conversation and must survive retry, resume, permission pauses, and plan-question pauses.

### 6.6 Stable Ordering

Tool lists should be sorted deterministically by source and name so unchanged tools do not churn prompt-cache inputs.

### 6.7 Observable by Default

The application should record enough metrics to answer: how many tools were available, how many were exposed, why tool search was enabled, and which tools consumed the most prompt budget.

## 7. User Stories

### US-1: Normal User With Many Plugins

As a user with several plugins installed, I want AI chat to remain responsive and accurate without manually disabling plugins before every conversation.

Acceptance criteria:

- The first model request exposes a small tool set.
- The model can discover relevant plugin tools by calling the tool discovery function.
- Previously discovered tools remain available later in the same conversation.

### US-2: User With Multiple MCP Servers

As a user with multiple MCP servers enabled, I want MCP tools to be available when needed without their full schemas consuming the prompt on every request.

Acceptance criteria:

- MCP tools default to deferred loading.
- MCP descriptions are capped in the catalog.
- MCP schemas that are too large are summarized or pruned before exposure.

### US-3: Power User Debugging Tool Availability

As a power user, I want to know which tools are available, deferred, and currently exposed so I can diagnose why the model did or did not call a tool.

Acceptance criteria:

- `/skills` or an equivalent diagnostic command can show total, always-loaded, deferred, and discovered counts.
- Logs include per-request exposed tool count and estimated tool token cost.
- The system can report the top largest tool definitions.

### US-4: Agent Runtime With Allowlisted Tools

As a subagent author, I want an agent's allowed tools to remain enforced while still benefiting from tool-list reduction.

Acceptance criteria:

- Agent runtime only searches and exposes tools inside the agent's allowlist.
- Blocked tools are never returned by discovery.
- Existing max tool-call and policy enforcement remain unchanged.

## 8. Functional Requirements

### FR-1: Tool Catalog Entries

Add a central catalog service that can produce compact entries for all enabled AI-callable capabilities.

Each catalog entry must include:

- tool name,
- source type: `builtin`, `mcp`, `plugin`, `plan`, `subagent`, or `imported`,
- short description,
- optional category,
- optional search hints,
- load policy: `always`, `deferred`, or `contextual`,
- estimated prompt cost,
- schema hash,
- reference to the full tool definition.

### FR-2: Load Policy Classification

The system must classify tools using conservative defaults:

- Always load:
  - tool discovery function,
  - core file read/search tools needed for general assistance,
  - async job status tool,
  - essential plan-mode tools when plan mode is active,
  - safety or permission-related helper tools.
- Deferred by default:
  - MCP tools,
  - plugin-owned tools,
  - imported user skills,
  - subagent invocation targets,
  - specialized browser, scraping, marketing, and integration tools.
- Contextual:
  - tools forced by route, uploaded file type, plan mode, agent allowlist, or explicit user mention.

### FR-3: Tool Discovery Function

Add one always-loaded function, tentatively named `tool_catalog_search`.

Required input:

```json
{
  "query": "string",
  "max_results": "number",
  "select": ["string"]
}
```

Behavior:

- If `select` is provided, resolve exact tool names.
- If `query` is provided, run keyword search across deferred catalog entries.
- Support exact name match, prefix match, source/category match, search-hint match, and description match.
- Return compact search results and the exact tool names selected for exposure on the next round.
- Never return disabled tools or tools blocked by the current policy context.

### FR-4: Per-Round Tool Filtering

Before every LLM request, the query loop must compute the exposed tool set:

```text
always-loaded tools
+ tool_catalog_search
+ tools discovered in this conversation
+ tools required by the active mode
+ tools forced by current context
```

The full tool catalog must not be sent unless deferred mode is disabled.

### FR-5: Discovered Tool State

The system must track discovered tool names per conversation.

State must survive:

- multiple model rounds in one turn,
- tool-result continuation,
- permission pause and resume,
- plan-question pause and resume,
- request retry,
- conversation reload,
- compacted or summarized history.

### FR-6: Deferred Tool Announcements

The model must receive a compact list of deferred tools or deferred tool categories so it knows discovery is possible.

Requirements:

- Initial announcement must be token-budgeted.
- Later announcements should be deltas: added deferred tools and removed deferred tools.
- Do not inject the full deferred catalog on every request.
- Removed tools must only be announced as removed when they are actually unavailable, not merely promoted to always-loaded.

### FR-7: MCP Description and Schema Limits

MCP tool metadata must be capped before it bloats prompts.

Minimum requirements:

- Cap MCP tool descriptions to a configurable limit, default 2,048 characters.
- Cap or prune overly large JSON schemas.
- Remove nonessential schema fields such as huge examples, long markdown docs, and redundant titles when needed.
- Record truncation in logs for diagnostics.
- Preserve enough schema structure for valid tool calls.

### FR-8: Auto Mode

Add a feature flag for rollout:

- `AI_TOOL_SEARCH=off`: current behavior, no deferral.
- `AI_TOOL_SEARCH=on`: always use deferred catalog filtering.
- `AI_TOOL_SEARCH=auto`: use deferred catalog filtering only when estimated tool payload exceeds the configured threshold.

Default recommendation for first production rollout: `auto`.

Auto mode should enable deferral when estimated deferred tool definitions exceed 10% of the active model context window, or when exact context size is unknown and character-based estimation crosses the threshold.

### FR-9: Provider Compatibility

For OpenAI-compatible providers, aiFetchly should implement discovery locally:

1. Send `tool_catalog_search` as a normal function tool.
2. Execute it locally when called.
3. Add returned tool names to conversation discovered state.
4. Include those full tool definitions on the next request.

For Anthropic-compatible providers that support native tool references, aiFetchly may later map the same catalog to provider-native deferred loading.

For the hosted legacy `client_tools` flow, the server contract must be extended before enabling deferred mode.

### FR-10: Diagnostics

Every AI request in deferred mode should log:

- total enabled tool count,
- always-loaded count,
- deferred count,
- discovered count,
- exposed count,
- estimated tool prompt tokens,
- largest tool definitions by estimated size,
- reason deferral is on or off.

Diagnostics must avoid logging secrets, full arguments, auth headers, or sensitive tool outputs.

## 9. Technical Requirements

### TR-1: Architecture Boundaries

- Tool catalog logic belongs in Services.
- Persistence belongs in Models and Modules.
- IPC handlers must remain thin and must not access TypeORM repositories directly.
- AI IPC handlers must check `USER_AI_ENABLED` before doing work.
- Worker processes must not access the database directly.

### TR-2: Suggested New Services

Add:

- `ToolCatalogService`: builds full and compact catalog views.
- `ToolLoadPolicyService`: classifies always, deferred, and contextual tools.
- `ToolCatalogSearchService`: implements search and exact selection.
- `ConversationToolStateService`: persists discovered tool names and deferred announcements.
- `ToolPromptBudgetService`: estimates schema cost and decides auto-mode.

### TR-3: Suggested Integration Points

AI Chat V2:

- Build full catalog in `AIChatQueryEngine`.
- Pass catalog metadata into `AIChatQueryLoop`.
- Filter exposed tools inside `AIChatQueryLoop` immediately before each API request.
- When `tool_catalog_search` returns selected tools, add them to discovered state and continue the loop.

Agent runtime:

- Apply catalog filtering after agent allowlist filtering.
- Discovery must search only tools allowed for that agent.

Legacy hosted chat:

- Keep current behavior until the remote API supports deferred catalogs.
- Add a capability flag before sending partial catalogs to hosted endpoints.

MCP:

- Cap descriptions and schemas in `MCPToolService.discoverTools()`.
- Apply a final cap in `getEnabledMCPToolsAsFunctions()` as defense in depth.

### TR-4: Tool Name Stability

Tool names must remain stable:

- Existing built-in skill names do not change.
- Legacy MCP names keep `mcp_<serverId>_<tool>`.
- Plugin MCP names keep `mcp__<plugin>__<server>__<tool>`.
- Discovery returns exact names that the executor already understands.

### TR-5: Fallback Behavior

If deferred tool loading fails, the system must be able to fall back to the current full-tool behavior.

Fallback triggers:

- feature flag off,
- provider incompatibility,
- malformed catalog state,
- missing full definition for a discovered tool,
- repeated model failure to use discovery.

Fallback must be logged with a reason.

## 10. Search Ranking Requirements

The tool discovery search should rank matches using weighted signals:

- exact tool name match,
- exact name part match,
- MCP/plugin/server prefix match,
- category match,
- required query terms,
- search hint match,
- short description match,
- recent usage in the same conversation,
- explicit tool mention in the user message.

Search results should default to 5 matches and cap at 10 unless the caller explicitly selects exact names.

## 11. Security and Privacy Requirements

- Discovery must never expose disabled tools.
- Discovery must never bypass skill permission checks.
- Discovery must respect plugin enablement.
- Discovery must respect MCP server and MCP tool enablement.
- Agent discovery must respect agent allowed-tool policy.
- Tool summaries must not include secrets from MCP config, plugin options, environment variables, auth settings, or user data.
- Logs must include metadata and sizes, not full sensitive schemas when schemas may contain secrets.
- Shell, filesystem, automation, network, and MCP trust rules remain unchanged.

## 12. UX Requirements

The first release does not require a major UI change. Required user-visible behavior:

- Chat should continue to call tools normally after discovery.
- Errors should clearly distinguish "tool unavailable" from "tool not yet discovered" only when this helps the user.
- `/skills` or a debug command should show available tool counts by load policy.

Optional later UI:

- System settings page showing total tools, deferred tools, always-loaded tools, and largest tools.
- Per-plugin estimate of prompt impact.
- MCP manager warning when a server contributes unusually large schemas.

All new UI strings must be translated in `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`.

## 13. Acceptance Criteria

### AC-1: Reduced First-Round Tool Payload

Given a catalog with 100 enabled tools, including 70 MCP tools, when AI Chat V2 starts a new conversation in deferred mode, the first model request includes only always-loaded tools, mode-required tools, and `tool_catalog_search`.

### AC-2: Discovery Adds Tools Next Round

Given the model calls `tool_catalog_search` for "google maps business search", when the search returns `search_maps_businesses`, the next model request includes the full `search_maps_businesses` tool definition.

### AC-3: Disabled Tools Are Hidden

Given an MCP tool is disabled in settings, when the model searches for it, the discovery tool does not return it and the tool is not exposed in later rounds.

### AC-4: Agent Allowlist Is Enforced

Given an agent is allowed to use only `file_read`, when that agent searches for unrelated MCP tools, discovery returns no blocked MCP tools.

### AC-5: Permission Policy Still Runs

Given a deferred filesystem or automation tool is discovered, when the model later calls it, the existing permission approval flow still runs before execution.

### AC-6: MCP Description Cap

Given an MCP server returns a 30 KB description, when tools are discovered and converted, the LLM-facing description is capped and logs note truncation.

### AC-7: Auto Mode Threshold

Given tool definitions are below the configured threshold, auto mode sends the full list without search. Given tool definitions exceed the threshold, auto mode enables deferred loading.

### AC-8: Pause and Resume

Given a discovered tool is available before a permission pause or plan-question pause, when the conversation resumes, the discovered tool remains exposed.

### AC-9: Stable Ordering

Given the enabled catalog has not changed, repeated requests produce deterministic exposed tool ordering.

### AC-10: Safe Fallback

Given catalog filtering throws an internal error, the request falls back to current full-tool behavior and logs the fallback reason.

## 14. Metrics

Track:

- `tool_catalog.total_count`
- `tool_catalog.always_count`
- `tool_catalog.deferred_count`
- `tool_catalog.contextual_count`
- `tool_catalog.discovered_count`
- `tool_catalog.exposed_count`
- `tool_catalog.estimated_tokens_total`
- `tool_catalog.estimated_tokens_exposed`
- `tool_catalog.search_calls`
- `tool_catalog.search_no_match`
- `tool_catalog.search_selected_count`
- `tool_catalog.fallback_count`
- `mcp_tool.description_truncated_count`
- `mcp_tool.schema_pruned_count`

These can start as structured logs and later move to application diagnostics.

## 15. Rollout Plan

### Phase 1: Measurement and MCP Caps

- Add tool catalog size estimation.
- Log total and exposed tool counts.
- Cap MCP descriptions.
- Add schema pruning utility.
- Sort tool definitions deterministically.
- No model behavior change by default.

### Phase 2: V2 Deferred Catalog MVP

- Add `ToolCatalogService`.
- Add `tool_catalog_search`.
- Add conversation-local discovered-tool state.
- Filter `AIChatQueryLoop` exposed tools per round.
- Keep feature flag defaulted to off or auto.

### Phase 3: Persistence and Resume Support

- Persist discovered tool names per conversation.
- Carry discovered state through permission and plan-question pending turns.
- Add deferred-tool delta announcements.
- Add tests for resume and compact boundaries.

### Phase 4: Agent Runtime Support

- Apply catalog filtering to `AgentRuntime`.
- Restrict discovery by agent allowlist.
- Add tests for blocked and allowed agent tools.

### Phase 5: Hosted API Compatibility

- Extend hosted `/api/ai/ask/stream` and `/api/ai/ask/continue` contracts.
- Add server capability detection.
- Enable deferred catalogs for hosted `client_tools` only when supported.

## 16. Test Plan

Unit tests:

- Load policy classification.
- Tool search ranking and exact selection.
- MCP description truncation and schema pruning.
- Auto-mode threshold decisions.
- Disabled tool filtering.
- Stable ordering.

Integration tests:

- AI Chat V2 first request excludes deferred MCP tools.
- Discovery tool call exposes selected tool on next round.
- Permission pause and resume preserve discovered tools.
- Plan-question pause and resume preserve discovered tools.
- Agent allowlist limits search results.
- Fallback to full tools on catalog error.

Regression tests:

- Existing built-in tool execution still works.
- Existing MCP execution still works after discovery.
- Existing plan-mode tools remain available when plan mode is active.
- Legacy hosted chat remains unchanged until its compatibility phase.

## 17. Risks and Mitigations

### Risk: Model Does Not Discover Needed Tools

Mitigation:

- Include clear system instruction explaining `tool_catalog_search`.
- Use contextual promotion for obvious user mentions and uploaded file types.
- Fall back to full tools after repeated no-tool failures.

### Risk: Search Returns Too Many Similar Tools

Mitigation:

- Default to 5 results.
- Weight exact name/source/category matches strongly.
- Include concise descriptions and source labels in results.

### Risk: Provider Differences

Mitigation:

- Use local OpenAI-compatible function calling for the MVP.
- Keep provider-native deferred loading as an optional later enhancement.
- Maintain feature flag fallback.

### Risk: Tool Schema Pruning Breaks Calls

Mitigation:

- Prefer description truncation first.
- Prune only nonessential schema metadata before pruning structural fields.
- Log pruning decisions.
- Add tests with representative MCP schemas.

### Risk: Catalog State Goes Stale

Mitigation:

- Hash tool definitions.
- Recompute catalog on plugin, skill, MCP, and setting changes.
- If a discovered tool disappears, announce it as unavailable and remove it from exposed tools.

## 18. Open Questions

1. Should `tool_catalog_search` be visible to users in `/skills`, or hidden as an internal system tool?
2. Where should discovered tool state be persisted: conversation metadata, hidden system message metadata, or a dedicated table?
3. Should imported user skills default to deferred or always-loaded if they are small?
4. Should route-aware contextual promotion expose tools related to the current page, such as campaign tools on campaign pages?
5. What should the exact schema pruning limit be for MCP tools: character budget, estimated tokens, or nested property count?
6. Should auto mode use a global context-window estimate or provider-specific model metadata?

## 19. Recommended MVP Scope

The MVP should include:

- Metrics and logging for current tool payload size.
- MCP description cap and basic schema pruning.
- `ToolCatalogService` compact entries.
- `tool_catalog_search` as an always-loaded OpenAI-compatible tool.
- AI Chat V2 per-round filtering.
- Conversation-local discovered-tool state.
- Feature flag: `AI_TOOL_SEARCH=off|on|auto`.
- Unit and integration tests for the V2 loop.

The MVP should not include hosted legacy API changes, provider-native Anthropic tool references, or new UI beyond optional diagnostics.
