# AI Application Navigation Tool - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-07-13 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/ai-app-navigation-tool-prd.md` |
| Primary code paths | `src/views/router/index.ts`, `src/config/skillsRegistry.ts`, `src/config/aiNavigationRouteManifest.ts`, `src/service/AIAppNavigationCatalogService.ts`, `src/service/AIAppNavigationMatcher.ts`, `src/views/components/aiChat/AiChatBox.vue`, `src/views/components/aiChatV2/AiChatV2.vue` |

## 1. Purpose

This document translates `docs/prd/ai-app-navigation-tool-prd.md` into an implementation-facing technical design.

The feature lets AI Chat route users to safe internal application pages from natural language:

```text
User: "Open email service"
  -> AI calls open_app_page({ query: "Open email service" })
  -> tool resolves a validated route name
  -> tool result is streamed to renderer
  -> renderer validates route
  -> renderer calls router.push({ name: "Email_Marketing_Service_LIST" })
```

The implementation must keep a hard boundary:

```text
Main process / tool layer
  -> resolves intent to a validated navigation command

Renderer
  -> owns Vue Router and executes router.push(...)
```

The main process must never directly call Vue Router.

## 2. Current System Summary

### 2.1 Vue Router

Routes are defined in:

```text
src/views/router/index.ts
```

That file creates the Vue Router and references `.vue` components. Main-process tool code must not import it directly. The implementation should expose a pure, component-free AI navigation manifest generated from or maintained beside the router definitions:

```text
src/config/aiNavigationRouteManifest.ts
```

The target examples already exist:

```text
Email service page:
  path: /emailmarketing/emailservice/list
  route name: Email_Marketing_Service_LIST
  component: src/views/pages/emailservice/list.vue

Email reply audit page:
  path: /emailmarketing/emailreply/audit/list
  route name: AI_Auto_Reply_Audit_List
  component: src/views/pages/emailreply/auditlist.vue
```

Routes already use `meta.visible`, `meta.title`, and `meta.icon`. This feature adds optional AI navigation metadata fields:

```typescript
meta: {
  aiNavigable?: boolean;
  aiAliases?: string[];
  aiDescription?: string;
}
```

### 2.2 AI Tool Registry

Built-in tools are registered in:

```text
src/config/skillsRegistry.ts
```

The registry exports tools through:

```typescript
SkillRegistry.getAllToolFunctions()
```

The AI chat IPC paths already include built-in tools when sending requests to the remote model.

### 2.3 Tool Execution Pipeline

The current AI tool path is:

```text
LLM tool call
  -> StreamEventProcessor
  -> SkillRegistry / SkillExecutor
  -> built-in skill execute()
  -> tool result streamed back to renderer
```

For this feature, the built-in skill should execute synchronously and return a small JSON result. It should not access the database, worker processes, or external services.

### 2.4 Renderer Tool Result Handling

Existing renderer stream handling lives in:

```text
src/views/components/aiChat/AiChatBox.vue
```

AI Chat V2 uses separate components under:

```text
src/views/components/aiChatV2/
```

The navigation action must be handled in whichever chat renderer receives the tool result event.

## 3. Target Architecture

### 3.1 High-Level Components

Add these implementation files:

```text
src/entityTypes/aiAppNavigationTypes.ts
src/config/aiNavigationRouteManifest.ts
src/service/AIAppNavigationRouteMeta.ts
src/service/AIAppNavigationCatalogService.ts
src/service/AIAppNavigationMatcher.ts
src/service/AIAppNavigationToolService.ts
```

Modify these existing files:

```text
src/views/router/index.ts
src/config/skillsRegistry.ts
src/views/components/aiChat/AiChatBox.vue
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Message.vue
```

Add tests under:

```text
test/vitest/utilitycode/aiAppNavigationCatalog.test.ts
test/vitest/utilitycode/aiAppNavigationMatcher.test.ts
test/vitest/main/aiAppNavigationTool.test.ts
```

### 3.2 Runtime Flow

```text
User asks to open a page
  -> remote model emits tool_call open_app_page
  -> SkillExecutor runs built-in skill
  -> AIAppNavigationToolService.validateAndResolve()
  -> AIAppNavigationCatalogService builds route catalog from aiNavigationRouteManifest
  -> AIAppNavigationMatcher scores query against catalog
  -> tool returns one of:
       - navigation command
       - clarification candidates
       - safe failure
  -> StreamEventProcessor forwards tool_result
  -> renderer detects action === "navigate"
  -> renderer validates route against router.getRoutes()
  -> renderer calls router.push({ name })
```

### 3.3 Data Ownership

| Data | Owner | Notes |
| --- | --- | --- |
| Route definitions | Renderer source code | `src/views/router/index.ts` remains the authored router. |
| AI route manifest | Shared config | Component-free route metadata safe for main-process import. |
| Route catalog | Shared service | Derived from manifest; no persistence. |
| Matching score | Tool service | Deterministic calculation; no LLM dependency. |
| Navigation command | Tool result | Validated JSON result only. |
| Actual route transition | Renderer | Uses Vue Router only after local validation. |

## 4. Route Metadata Types

### 4.1 RouteMeta Augmentation

Add a type declaration file if one does not already exist:

```text
src/views/router/routeMeta.d.ts
```

Recommended content:

```typescript
import "vue-router";

declare module "vue-router" {
  interface RouteMeta {
    visible?: boolean;
    title?: string;
    icon?: string;
    keepAlive?: boolean;
    noCache?: boolean;
    activeMenu?: string;
    aiNavigable?: boolean;
    aiAliases?: string[];
    aiDescription?: string;
  }
}
```

If the project already has a `RouteMeta` augmentation, extend that file instead of creating a duplicate.

### 4.2 Metadata Rules

Use route metadata like this:

```typescript
{
  path: "emailservice/list",
  name: "Email_Marketing_Service_LIST",
  meta: {
    visible: true,
    title: "route.email_service",
    icon: "mdi-email-sync",
    aiNavigable: true,
    aiAliases: ["email service", "email edit", "mailbox settings", "smtp settings"],
    aiDescription: "Manage email sending service accounts and mailbox configuration"
  },
  component: () => import("@/views/pages/emailservice/list.vue")
}
```

Explicit exclusions:

```typescript
{
  path: "/login",
  name: "login",
  meta: {
    aiNavigable: false
  },
  component: () => import("@/views/pages/login/login.vue")
}
```

## 5. Shared Types

Create:

```text
src/entityTypes/aiAppNavigationTypes.ts
```

### 5.1 Catalog Entry

```typescript
export interface AiNavigationCatalogEntry {
  readonly routeName: string;
  readonly path: string;
  readonly fullPath: string;
  readonly titleKey?: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly visible: boolean;
  readonly requiresParams: boolean;
  readonly explicitlyIncluded: boolean;
  readonly explicitlyExcluded: boolean;
  readonly source: "router";
}
```

### 5.2 Match Candidate

```typescript
export interface AiNavigationMatchCandidate {
  readonly routeName: string;
  readonly path: string;
  readonly label: string;
  readonly confidence: number;
  readonly matchedSignals: readonly string[];
}
```

### 5.3 Tool Input

```typescript
export interface OpenAppPageInput {
  readonly query: string;
  readonly preferredRouteName?: string;
}
```

### 5.4 Tool Result

```typescript
export type OpenAppPageResult =
  | OpenAppPageSuccess
  | OpenAppPageClarification
  | OpenAppPageUnsupported;

export interface OpenAppPageSuccess {
  readonly success: true;
  readonly action: "navigate";
  readonly routeName: string;
  readonly path?: string;
  readonly label: string;
  readonly confidence: number;
}

export interface OpenAppPageClarification {
  readonly success: false;
  readonly needsClarification: true;
  readonly message: string;
  readonly candidates: readonly AiNavigationMatchCandidate[];
}

export interface OpenAppPageUnsupported {
  readonly success: false;
  readonly message: string;
  readonly needsRouteParams?: boolean;
  readonly notFound?: boolean;
  readonly blocked?: boolean;
}
```

## 6. Zod Schemas

Create schemas next to the types or in a dedicated schema file:

```text
src/schemas/aiAppNavigation.ts
```

Use Zod v4:

```typescript
import { z } from "zod/v4";

export const openAppPageInputSchema = z.object({
  query: z.string().trim().min(1).max(300),
  preferredRouteName: z.string().trim().min(1).max(120).optional(),
});

export type OpenAppPageInput = z.infer<typeof openAppPageInputSchema>;
```

The built-in skill `execute()` method must parse `args` before use:

```typescript
const input = openAppPageInputSchema.parse(args);
```

## 7. AI Navigation Manifest

Create:

```text
src/config/aiNavigationRouteManifest.ts
```

### 7.1 Why A Manifest Is Required

`src/views/router/index.ts` currently imports Vue Router, `Layout`, and lazy `.vue` components. Importing that file from main-process tool code risks pulling renderer-only code into the main bundle.

Use a pure manifest instead. The manifest contains only serializable route data needed by the AI navigation tool:

```typescript
export interface AiNavigationRouteManifestEntry {
  readonly routeName: string;
  readonly path: string;
  readonly titleKey?: string;
  readonly visible?: boolean;
  readonly aiNavigable?: boolean;
  readonly aiAliases?: readonly string[];
  readonly aiDescription?: string;
}
```

Example:

```typescript
export const aiNavigationRouteManifest: readonly AiNavigationRouteManifestEntry[] = [
  {
    routeName: "Email_Marketing_Service_LIST",
    path: "/emailmarketing/emailservice/list",
    titleKey: "route.email_service",
    visible: true,
    aiNavigable: true,
    aiAliases: ["email service", "email edit", "mailbox settings", "smtp settings"],
    aiDescription: "Manage email sending service accounts and mailbox configuration",
  },
  {
    routeName: "AI_Auto_Reply_Audit_List",
    path: "/emailmarketing/emailreply/audit/list",
    titleKey: "route.ai_auto_replies",
    visible: true,
    aiNavigable: true,
    aiAliases: ["email reply log", "auto reply log", "reply audit", "ai replies"],
    aiDescription: "Review AI auto-reply decisions, sent replies, skipped replies, and audit logs",
  },
];
```

### 7.2 Manifest Maintenance Options

Recommended MVP: maintain the manifest manually beside route edits.

Reason:

1. It avoids importing renderer components into main process.
2. It is simple to review in code review.
3. The `CLAUDE.md` route metadata rule already tells developers to update AI navigation metadata when routes change.

Recommended follow-up: add a dev script that validates manifest entries against Vue router names and paths.

```text
scripts/validate-ai-navigation-manifest.ts
```

The script can run in a renderer-aware tooling context and should verify:

1. Every manifest `routeName` exists in `src/views/router/index.ts`.
2. Every manifest path matches the route's computed full path.
3. Routes with `meta.aiNavigable === true` have a manifest entry.
4. Manifest entries do not point to required-param routes unless explicitly allowed later.

### 7.3 Source Of Truth

The authored router remains the source of truth for actual app routing. The AI manifest is the source of truth for model-facing route discovery in main-process tool execution.

When they conflict, runtime navigation still depends on renderer-side `router.getRoutes()` validation, so a stale manifest cannot force navigation to a missing route.

## 8. Catalog Service

Create:

```text
src/service/AIAppNavigationCatalogService.ts
```

### 8.1 Responsibilities

The catalog service:

1. Consumes `aiNavigationRouteManifest`.
2. Normalizes manifest entries.
3. Applies inclusion and exclusion rules.
4. Converts manifest entries into `AiNavigationCatalogEntry` values.
5. Does not call the LLM.
6. Does not call Vue Router runtime APIs in main process.
7. Does not read or write the database.

### 8.2 Route Source

Preferred source for MVP:

```typescript
import { aiNavigationRouteManifest } from "@/config/aiNavigationRouteManifest";
```

This lets the main-process built-in skill generate the catalog without importing Vue, Vue Router instances, layouts, or `.vue` components.

### 8.3 Public API

```typescript
import type { AiNavigationCatalogEntry } from "@/entityTypes/aiAppNavigationTypes";
import type { AiNavigationRouteManifestEntry } from "@/config/aiNavigationRouteManifest";

export class AIAppNavigationCatalogService {
  buildCatalog(
    manifest: readonly AiNavigationRouteManifestEntry[]
  ): AiNavigationCatalogEntry[] {
    // normalize and filter
  }

  isAiNavigableEntry(entry: AiNavigationRouteManifestEntry): boolean {
    // safe inclusion rules
  }
}
```

### 8.4 Required Params Detection

Treat a route as requiring params when the final path includes a required parameter segment:

```text
:id
:taskId(\d+)
:campaignId(\d+)
```

Do not treat optional params as supported in MVP unless there is a safe default.

Recommended helper:

```typescript
function hasRequiredRouteParams(path: string): boolean {
  return /(^|\/):[A-Za-z0-9_]+(\([^)]*\))?($|\/)/.test(path);
}
```

### 8.5 Exclusion Rules

Exclude if any of these are true:

1. `meta.aiNavigable === false`.
2. No route name.
3. Full path has required params.
4. Route name or path includes auth-only terms:
   - `login`
   - `logout`
   - `auth`
   - `callback`
   - `error`
5. The route is known to perform a side effect on load.
6. Route metadata marks it internal-only in the future.

### 8.6 Inclusion Rules

Include if all of these are true:

1. Route passed exclusion rules.
2. Route has a name.
3. `meta.aiNavigable === true` OR default-safe inclusion applies.

Default-safe inclusion applies when:

1. The route is parameter-free.
2. The route has a page-like path or visible menu metadata.
3. The route is not auth/internal/destructive.

`meta.visible === true` should boost inclusion confidence, but should not be the only rule. Some hidden routes are safe, and some visible routes may still need explicit exclusion.

### 8.7 Label Generation

Catalog label priority:

1. `meta.aiLabel` if added later.
2. Last segment of `meta.title`, converted from i18n key to readable words.
3. Route name converted to words.
4. Path converted to words.

Example conversions:

```text
route.email_service -> Email Service
Email_Marketing_Service_LIST -> Email Marketing Service List
/emailmarketing/emailreply/audit/list -> Email Reply Audit List
```

## 9. Matcher Service

Create:

```text
src/service/AIAppNavigationMatcher.ts
```

### 9.1 Responsibilities

The matcher:

1. Normalizes the user's query.
2. Scores query against each catalog entry.
3. Returns success, clarification, or not-found result.
4. Avoids low-confidence automatic navigation.
5. Has deterministic behavior for tests.

### 9.2 Public API

```typescript
import type {
  AiNavigationCatalogEntry,
  OpenAppPageResult,
} from "@/entityTypes/aiAppNavigationTypes";

export interface NavigationMatcherOptions {
  readonly autoNavigateThreshold: number;
  readonly clarificationThreshold: number;
  readonly ambiguityDelta: number;
  readonly maxCandidates: number;
}

export class AIAppNavigationMatcher {
  match(
    query: string,
    catalog: readonly AiNavigationCatalogEntry[],
    options?: Partial<NavigationMatcherOptions>
  ): OpenAppPageResult {
    // score and decide
  }
}
```

Default options:

```typescript
const DEFAULT_OPTIONS: NavigationMatcherOptions = {
  autoNavigateThreshold: 0.8,
  clarificationThreshold: 0.55,
  ambiguityDelta: 0.15,
  maxCandidates: 5,
};
```

### 9.3 Normalization

Normalize query and route text:

1. Lowercase.
2. Replace punctuation with spaces.
3. Split camel/pascal/snake/kebab words.
4. Collapse whitespace.
5. Remove stop words.

Stop words:

```typescript
const NAVIGATION_STOP_WORDS = new Set([
  "open",
  "go",
  "to",
  "navigate",
  "show",
  "view",
  "switch",
  "page",
  "screen",
  "list",
  "the",
  "a",
  "an",
  "i",
  "want",
  "need",
  "please",
]);
```

Important: stop words should be removed only from token scoring, not from phrase matching. For example, `"email reply log"` should still match alias phrases.

### 9.4 Signals

Each catalog entry should score against these text sources:

| Signal | Source | Weight |
| --- | --- | --- |
| Exact alias phrase | `meta.aiAliases` | 1.00 |
| Partial alias tokens | `meta.aiAliases` | 0.85 |
| Label tokens | generated label | 0.75 |
| Description tokens | `meta.aiDescription` | 0.55 |
| Route name tokens | route name | 0.45 |
| Path tokens | full path | 0.35 |
| Visible boost | `meta.visible === true` | +0.05 |
| Explicit include boost | `meta.aiNavigable === true` | +0.05 |

Cap final confidence at `1.0`.

### 9.5 Scoring Formula

Recommended deterministic score:

```typescript
score = max(
  exactAliasScore,
  weightedTokenOverlap(aliasTokens, queryTokens, 0.85),
  weightedTokenOverlap(labelTokens, queryTokens, 0.75),
  weightedTokenOverlap(descriptionTokens, queryTokens, 0.55),
  weightedTokenOverlap(routeNameTokens, queryTokens, 0.45),
  weightedTokenOverlap(pathTokens, queryTokens, 0.35),
) + boosts;
```

Token overlap:

```typescript
function weightedTokenOverlap(
  sourceTokens: readonly string[],
  queryTokens: readonly string[],
  weight: number
): number {
  if (sourceTokens.length === 0 || queryTokens.length === 0) return 0;
  const source = new Set(sourceTokens);
  const query = new Set(queryTokens);
  const matches = [...query].filter((token) => source.has(token)).length;
  return Math.min(1, matches / Math.max(1, query.size)) * weight;
}
```

### 9.6 Decision Logic

```typescript
const sorted = candidates.sort((a, b) => b.confidence - a.confidence);
const top = sorted[0];
const second = sorted[1];

if (!top || top.confidence < clarificationThreshold) {
  return {
    success: false,
    notFound: true,
    message: "No matching application page was found.",
  };
}

if (
  top.confidence >= autoNavigateThreshold &&
  (!second || top.confidence - second.confidence >= ambiguityDelta)
) {
  return {
    success: true,
    action: "navigate",
    routeName: top.routeName,
    path: top.path,
    label: top.label,
    confidence: top.confidence,
  };
}

return {
  success: false,
  needsClarification: true,
  message: "Several application pages match your request.",
  candidates: sorted.slice(0, maxCandidates),
};
```

### 9.7 Preferred Route Name

`preferredRouteName` is optional and should be used only when:

1. The value exists in the catalog.
2. The route is AI-navigable.
3. The query does not conflict with the preferred route.

This is useful for follow-up clarification:

```text
User: "Open email page."
Assistant: "Do you mean Email Service, Email Reply Audit, or Email Templates?"
User: "Reply audit."
```

The second turn can pass `preferredRouteName` if the assistant selected from previous candidates.

## 10. Tool Service

Create:

```text
src/service/AIAppNavigationToolService.ts
```

### 10.1 Responsibilities

The tool service:

1. Parses tool args with Zod v4.
2. Builds route catalog.
3. Invokes matcher.
4. Returns `OpenAppPageResult`.
5. Does not call `router.push`.
6. Does not mutate data.

### 10.2 Public API

```typescript
import type { OpenAppPageResult } from "@/entityTypes/aiAppNavigationTypes";

export class AIAppNavigationToolService {
  openAppPage(rawArgs: unknown): OpenAppPageResult {
    const input = openAppPageInputSchema.parse(rawArgs);
    const catalog = this.catalogService.buildCatalog(aiNavigationRouteManifest);
    return this.matcher.match(input.query, catalog);
  }
}
```

### 10.3 Error Handling

Zod validation errors should return a safe tool result:

```typescript
{
  success: false,
  message: "Invalid navigation request."
}
```

Do not leak stack traces or local file paths to the model.

## 11. Built-In Skill Registration

Modify:

```text
src/config/skillsRegistry.ts
```

Add imports:

```typescript
import { AIAppNavigationToolService } from "@/service/AIAppNavigationToolService";
```

Add built-in skill:

```typescript
{
  name: "open_app_page",
  description: "Navigate AiFetchly to a safe internal application page based on the user's natural language request. Use this tool when the user explicitly asks to open, go to, navigate to, show, view, or switch to an application page, list, dashboard, settings screen, log, audit page, management page, inbox, template page, campaign page, schedule page, or configuration page. Do not use it for general questions, data mutations, sending, deleting, scraping, scheduling, external URLs, login/auth pages, required-record detail pages, or ambiguous destinations.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The user's natural language page navigation request.",
      },
      preferredRouteName: {
        type: "string",
        description: "Optional route name selected from a previous clarification candidate.",
      },
    },
    required: ["query"],
  },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "pure",
  source: "built-in",
  execute: async (args) => {
    const service = new AIAppNavigationToolService();
    const result = service.openAppPage(args);
    return { success: result.success, result };
  },
}
```

The production tool description can be long, but keep the key "use when" and "do not use when" rules from the PRD.

## 12. Renderer Handling

### 12.1 Shared Renderer Helper

Create a renderer-safe helper:

```text
src/views/utils/aiNavigationResultHandler.ts
```

This avoids duplicating logic between AI Chat V1 and V2.

```typescript
import type { Router } from "vue-router";

interface ToolNavigationResult {
  readonly success?: unknown;
  readonly action?: unknown;
  readonly routeName?: unknown;
}

export async function handleAiNavigationToolResult(
  router: Router,
  toolResult: unknown
): Promise<boolean> {
  if (!isNavigationResult(toolResult)) return false;

  const route = router
    .getRoutes()
    .find((item) => item.name === toolResult.routeName);

  if (!route) {
    console.warn("AI navigation route was not found", toolResult.routeName);
    return true;
  }

  if (!isRendererAiNavigableRoute(route)) {
    console.warn("AI navigation route was blocked", toolResult.routeName);
    return true;
  }

  await router.push({ name: toolResult.routeName });
  return true;
}

function isNavigationResult(value: unknown): value is {
  success: true;
  action: "navigate";
  routeName: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as ToolNavigationResult;
  return (
    record.success === true &&
    record.action === "navigate" &&
    typeof record.routeName === "string" &&
    record.routeName.length > 0
  );
}
```

### 12.2 Renderer Route Validation

Renderer validation must repeat critical safety checks:

1. Route exists in `router.getRoutes()`.
2. Route does not have `meta.aiNavigable === false`.
3. Route path does not contain required params.
4. Route name/path is not login/auth/callback/logout/error.

Even though the tool service validates routes, the renderer should treat streamed tool results as untrusted input.

### 12.3 AI Chat V1 Integration

Modify:

```text
src/views/components/aiChat/AiChatBox.vue
```

Add:

```typescript
import { useRouter } from "vue-router";
import { handleAiNavigationToolResult } from "@/views/utils/aiNavigationResultHandler";

const router = useRouter();
```

In the `tool_result` case, after extracting `chunk.toolResult`, call:

```typescript
await handleAiNavigationToolResult(router, chunk.toolResult);
```

If the function returns `true`, the result was handled as a navigation tool result. The UI should still record/display the tool result row so the chat transcript remains complete.

### 12.4 AI Chat V2 Integration

AI Chat V2 should use the same helper in its tool-result handling path. If tool result rendering is split across message components, prefer handling navigation in the parent stream/event component where `useRouter()` is available and side effects are easier to control.

## 13. Route Metadata Rollout

### 13.1 High-Value Initial Routes

Add route metadata first to:

```text
Email_Marketing_Service_LIST
AI_Auto_Reply_Audit_List
Email_Receive_List
Email_Marketing_Template_List
Email_Marketing_Filter_LIST
BUCK_Email_TASK_LIST
CampaignList
SocialaccountList
ScheduleList
system_setting_index
```

Use exact route names from `src/views/router/index.ts`; verify current names before editing.

### 13.2 Example Metadata

Email service:

```typescript
aiNavigable: true,
aiAliases: [
  "email service",
  "email edit",
  "email settings",
  "mailbox settings",
  "smtp settings",
  "sending mailbox"
],
aiDescription: "Manage email service accounts, sending mailbox settings, and SMTP configuration"
```

Email reply audit:

```typescript
aiNavigable: true,
aiAliases: [
  "email reply log",
  "reply audit",
  "auto reply log",
  "ai replies",
  "email auto replies"
],
aiDescription: "Review AI auto-reply decisions, sent replies, skipped replies, and audit logs"
```

### 13.3 Exclusions

Add `aiNavigable: false` to:

1. Login page.
2. Required-param detail/edit pages where no safe default exists.
3. Auth callback pages.
4. Error pages.
5. Internal-only utility pages.
6. Any page that starts an operation on load.

## 14. AI Enable Gate

No new standalone IPC handler is required for the MVP. The tool is reached through the existing AI Chat flow, which already gates AI chat requests.

If a future route-catalog IPC handler is added, it must follow the repository rule:

```text
Check USER_AI_ENABLED before parsing request data or doing work.
```

Use:

```typescript
import { USER_AI_ENABLED } from "@/config/usersetting";
import { Token } from "@/modules/token";

if (new Token().getValue(USER_AI_ENABLED) !== "true") {
  return { status: false, msg: "AI features are disabled.", data: null };
}
```

## 15. Security Design

### 15.1 Trust Boundaries

| Boundary | Risk | Control |
| --- | --- | --- |
| LLM tool call args | Prompt injection or malformed input | Zod parse and route allowlist. |
| Tool result stream | Forged or stale route name | Renderer re-validates route. |
| Route catalog | Unsafe page included | Exclusion rules and explicit `aiNavigable: false`. |
| Route transition | Required params missing | Reject param routes by default. |
| User intent | Action request mistaken for navigation | Tool description and matcher ambiguity handling. |

### 15.2 No External Navigation

The tool must not support:

```text
https://...
http://...
file://...
mailto:
custom app protocol URLs
absolute file paths
operating system locations
```

Only route names from the generated internal catalog are valid.

### 15.3 No Data Mutation

`open_app_page` is a pure navigation helper. It must never:

1. Click buttons.
2. Fill forms.
3. Submit forms.
4. Send emails.
5. Start tasks.
6. Run scraping.
7. Approve actions.
8. Create/update/delete records.

### 15.4 Required Params

Required-param routes are blocked in MVP. This avoids unsafe guesses like:

```text
/campaign/edit/:id
/emailreceive/detail/:id
/schedule/detail/:id
```

Future support can add a separate tool or parameter resolver only when the target record is explicitly known and validated.

## 16. Internationalization

No new user-facing UI text is required for the MVP unless a visible navigation confirmation, error, or clarification UI is added.

If new UI text is added, update all language files:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Route `meta.aiAliases` and `meta.aiDescription` can start in English because they are primarily model-facing metadata. If non-English matching is required in MVP, add localized aliases or use translated route titles in the renderer catalog.

## 17. Testing Strategy

### 17.1 Catalog Tests

File:

```text
test/vitest/utilitycode/aiAppNavigationCatalog.test.ts
```

Cover:

1. Includes parameter-free safe route.
2. Excludes route with `meta.aiNavigable === false`.
3. Excludes login route.
4. Excludes required-param route.
5. Preserves normalized full paths from the manifest.
6. Generates readable label from route title/name/path.
7. Preserves aliases and description.

### 17.2 Matcher Tests

File:

```text
test/vitest/utilitycode/aiAppNavigationMatcher.test.ts
```

Cover:

1. `"open email service"` resolves to `Email_Marketing_Service_LIST`.
2. `"open email edit page"` resolves to `Email_Marketing_Service_LIST`.
3. `"check email reply log"` resolves to `AI_Auto_Reply_Audit_List`.
4. `"open email page"` returns clarification candidates.
5. Low-confidence unrelated query returns `notFound`.
6. Top two close scores return clarification.
7. Exact alias match beats generic title match.

### 17.3 Tool Tests

File:

```text
test/vitest/main/aiAppNavigationTool.test.ts
```

Cover:

1. Valid tool input returns success for known examples.
2. Invalid input returns safe failure.
3. Login query fails safely.
4. Detail-page query fails with `needsRouteParams` when applicable.
5. Result does not contain arbitrary URLs.

### 17.4 Renderer Helper Tests

If the project has renderer utility tests, add:

```text
test/vitest/utilitycode/aiNavigationResultHandler.test.ts
```

Cover:

1. Navigates when result is valid and route exists.
2. Does not navigate when action is not `"navigate"`.
3. Does not navigate when route is missing.
4. Does not navigate when route is blocked by metadata.
5. Does not navigate when route requires params.

### 17.5 Manual QA Prompts

Run in AI Chat:

```text
Open email service.
Open email edit page.
Check email reply log.
Open email page.
Open login.
Open campaign 123.
What is the email service page for?
Send a bulk email.
```

Expected:

1. Specific page prompts navigate.
2. Ambiguous email prompt asks for clarification.
3. Login/detail prompts do not navigate.
4. General question is answered, not navigated.
5. Action request is not treated as completed by navigation.

## 18. Implementation Plan

### Step 1: Types And Schemas

1. Add `src/entityTypes/aiAppNavigationTypes.ts`.
2. Add `src/schemas/aiAppNavigation.ts`.
3. Add route meta augmentation if needed.

### Step 2: Catalog Helper

1. Add `AIAppNavigationCatalogService`.
2. Implement manifest entry normalization.
3. Implement path normalization.
4. Implement inclusion/exclusion checks.
5. Add catalog unit tests.

### Step 3: Matcher

1. Add `AIAppNavigationMatcher`.
2. Implement normalization and tokenization.
3. Implement weighted scoring.
4. Implement success/clarification/not-found decisions.
5. Add matcher unit tests.

### Step 4: Tool Service And Registry

1. Add `AIAppNavigationToolService`.
2. Register `open_app_page` in `SkillRegistry`.
3. Use the explicit tool description from the PRD.
4. Add tool tests.

### Step 5: Renderer Result Handling

1. Add `aiNavigationResultHandler`.
2. Wire AI Chat V1 tool result handling.
3. Wire AI Chat V2 tool result handling if V2 is in scope.
4. Add renderer helper tests where possible.

### Step 6: Route Metadata

1. Add metadata to high-value routes.
2. Add explicit exclusions for login and required-param routes where useful.
3. Verify catalog output manually.

### Step 7: Manual QA

1. Run dev app with `yarn dev`.
2. Test prompts from Section 17.5.
3. Verify no console errors.
4. Verify chat transcript still records tool call and result.

## 19. Rollback Plan

If the feature causes routing issues:

1. Remove `open_app_page` registration from `SkillRegistry`.
2. Leave route metadata in place; it is inert without the tool.
3. Keep renderer helper unused.
4. Re-enable after matcher or validation fixes.

No database migration rollback is required because the MVP adds no persistence.

## 20. Future Enhancements

1. Support selected required-param routes using validated recent context.
2. Add translated aliases for non-English natural language navigation.
3. Add route usage telemetry for improving aliases.
4. Add command-palette UI that reuses the same catalog and matcher.
5. Add embedding-based route matching after deterministic matching is stable.
6. Add "open last viewed item" support with explicit user confirmation.

## 21. Open Technical Questions

1. Should AI Chat V1 and V2 ship support in the same implementation phase?
2. Should hidden but safe routes require `aiNavigable: true`, or should default inclusion include them?
3. Should matching happen in main process only, renderer only, or shared pure services used by both?
4. Should route metadata include localized aliases now, or defer until non-English matching is requested?
5. Should navigation attempts be logged for diagnostics?

## 22. Recommended MVP

Build the first version with:

1. Pure catalog and matcher services.
2. `open_app_page` built-in skill.
3. Renderer-side route validation.
4. AI Chat V1 integration.
5. Metadata for email service and email reply audit examples.
6. Explicit login/auth/param route exclusions.
7. Unit tests for catalog, matcher, and tool service.

This satisfies the core requirement: users can talk with AI Chat to route to safe application pages, and new safe pages can be supported through route metadata instead of manual function-call schema updates.
