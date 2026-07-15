# AI Application Navigation Tool - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-13
- **Owner**: Engineering Team
- **Related areas**: AI Chat, Vue Router, renderer navigation, built-in tools, route metadata
- **Technical design**: `docs/prd/ai-app-navigation-tool-technical-design.md`
- **Related files**:
  - `src/views/router/index.ts`
  - `src/views/components/aiChat/AiChatBox.vue`
  - `src/config/skillsRegistry.ts`
  - `src/service/StreamEventProcessor.ts`
  - `src/service/AIChatQueryEngine.ts`
  - `src/entityTypes/commonType.ts`
  - `CLAUDE.md`

## 1. Summary

AiFetchly should let users navigate the desktop application through natural language in AI Chat. When a user says "open email service", "show email reply logs", or "go to campaign list", the assistant should route the app to the best matching internal page.

The feature should support as many pages as possible automatically. New routes should become AI-navigable by default when they are safe, parameter-free application pages. Developers should only need route metadata for better matching, explicit inclusion, or explicit exclusion.

The recommended implementation is a built-in AI tool that returns a validated navigation command. The main process and AI tool layer should never directly call Vue Router. The renderer receives the tool result and performs `router.push(...)` using Vue Router.

## 2. Problem

AiFetchly has many feature pages across email marketing, campaigns, scraping, accounts, schedules, settings, RAG, and AI tools. Users currently need to find the correct menu item or remember where a workflow lives.

This creates several problems:

1. Users must manually search the UI for pages they can describe in plain language.
2. AI Chat can explain what to do but cannot move the user to the page.
3. Page routing logic would become hard to maintain if every supported page is manually duplicated in an AI tool enum.
4. New pages may be forgotten unless there is a route-level convention.
5. Some pages, such as login, detail pages requiring IDs, destructive action pages, or setup-only internal pages, must not be opened automatically.

The product needs a scalable navigation layer that understands the existing Vue router and remains safe.

## 3. Goals

1. Let users ask AI Chat to open application pages by natural language.
2. Support most safe, parameter-free application pages automatically.
3. Avoid manual updates to the AI tool definition for every new route.
4. Use Vue route metadata as the source of truth for navigation eligibility and matching hints.
5. Exclude unsafe or unsuitable pages such as login, auth callback, required-param detail pages, and destructive action pages.
6. Allow developers to add `meta.aiNavigable`, `meta.aiAliases`, and `meta.aiDescription` to improve route matching.
7. Execute actual navigation only in the renderer process with Vue Router.
8. Return validated route names or paths only from the AI tool layer.
9. Keep AI feature handlers gated by `USER_AI_ENABLED`.
10. Keep all IPC payloads and tool parameters validated with Zod v4 where new boundaries are added.
11. Provide deterministic fallback behavior when the user's request is ambiguous.
12. Add developer guidance to `CLAUDE.md` so future routes include AI navigation metadata when appropriate.

## 4. Non-Goals

1. Do not let the AI navigate to arbitrary external URLs.
2. Do not let the AI execute Vue Router directly from the main process.
3. Do not support required route params in the MVP unless a page has a safe default.
4. Do not auto-submit forms, click buttons, mutate data, send emails, start scraping, or perform destructive actions.
5. Do not expose hidden security-sensitive pages by default.
6. Do not require updating a static function-call enum for every new page.
7. Do not depend on `CLAUDE.md` for runtime behavior. `CLAUDE.md` is only a developer reminder.
8. Do not add a new database entity for the MVP.
9. Do not use fuzzy matching that can route to low-confidence pages without confirmation.

## 5. Target Users

### 5.1 Marketing Operator

Wants to move quickly between campaign, email service, template, reply log, and task pages by asking the AI assistant.

Example:

```text
Open the email reply log.
```

Expected result: navigate to `AI_Auto_Reply_Audit_List`.

### 5.2 New User

Does not know the navigation structure yet and wants the assistant to guide them to the correct screen.

Example:

```text
Where do I configure my sending mailbox?
```

Expected result: the assistant can either answer or call the navigation tool to open the email service page.

### 5.3 Power User

Uses AI Chat as a command palette for fast navigation.

Example:

```text
Go to schedules.
```

Expected result: navigate to the schedule list page if it is a safe route.

### 5.4 Maintainer

Adds new pages and wants them to become AI-navigable with minimal extra work and clear safety rules.

## 6. User Stories

1. As a user, I can say "open email edit page" and AiFetchly opens the email service list page.
2. As a user, I can say "check email reply log" and AiFetchly opens the AI auto-reply audit list page.
3. As a user, I can say "open system settings" and AiFetchly opens the system settings page.
4. As a user, if my request matches multiple pages, AiFetchly asks me to choose rather than guessing incorrectly.
5. As a user, if I ask for a page that requires an ID, AiFetchly explains that it needs a specific item first.
6. As a developer, when I add a normal list or index page, it becomes AI-navigable unless I mark it otherwise.
7. As a developer, when I add a sensitive or auth-related page, I can set `meta.aiNavigable = false`.
8. As a developer, I can add aliases like "email reply log" or "mailbox settings" to improve natural language matching.

## 7. Product Behavior

### 7.1 Basic Flow

```text
User message
  -> AI decides to call `open_app_page`
  -> tool resolves a route from a navigation catalog
  -> tool returns a validated navigation command
  -> renderer handles tool result
  -> renderer calls `router.push(...)`
  -> chat shows a short confirmation
```

### 7.2 Example: Email Service

User:

```text
I want to open email edit page.
```

Tool input:

```json
{
  "query": "open email edit page"
}
```

Tool result:

```json
{
  "success": true,
  "action": "navigate",
  "routeName": "Email_Marketing_Service_LIST",
  "label": "Email Service",
  "confidence": 0.91
}
```

Renderer action:

```ts
router.push({ name: "Email_Marketing_Service_LIST" });
```

### 7.3 Example: Email Reply Audit

User:

```text
I want check email reply log.
```

Tool result:

```json
{
  "success": true,
  "action": "navigate",
  "routeName": "AI_Auto_Reply_Audit_List",
  "label": "AI Auto Replies",
  "confidence": 0.94
}
```

Renderer action:

```ts
router.push({ name: "AI_Auto_Reply_Audit_List" });
```

### 7.4 Ambiguous Match

User:

```text
Open email page.
```

Possible matches:

- Email service
- Email template
- Email filter
- Email receive
- Bulk email task
- Email reply audit

Expected result:

```json
{
  "success": false,
  "needsClarification": true,
  "message": "Several email pages match your request.",
  "candidates": [
    { "routeName": "Email_Marketing_Service_LIST", "label": "Email Service" },
    { "routeName": "Email_Marketing_Template_List", "label": "Email Template" },
    { "routeName": "AI_Auto_Reply_Audit_List", "label": "AI Auto Replies" }
  ]
}
```

The assistant should ask a clarification question instead of navigating.

### 7.5 Unsupported Required Params

User:

```text
Open campaign detail.
```

If the matching route requires `:id` and no ID is known, the tool should not navigate. It should return:

```json
{
  "success": false,
  "needsRouteParams": true,
  "message": "This page requires a specific campaign ID."
}
```

## 8. Route Metadata Contract

Route metadata should drive automatic support.

### 8.1 Recommended Route Meta Fields

```ts
meta: {
  visible: true,
  title: "route.email_service",
  icon: "mdi-email-sync",
  aiNavigable: true,
  aiAliases: ["email service", "email edit", "mailbox settings", "smtp settings"],
  aiDescription: "Manage email sending service accounts and mailbox configuration"
}
```

### 8.2 Field Semantics

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `aiNavigable` | `boolean` | No | Explicitly include or exclude the route from AI navigation. |
| `aiAliases` | `string[]` | No | Natural language phrases that should match this page. |
| `aiDescription` | `string` | No | Human-readable route purpose for matching and tool descriptions. |
| `title` | `string` | Existing | Existing i18n title key; can be used as a weak label signal. |
| `visible` | `boolean` | Existing | Can help default inclusion, but must not be the only safety rule. |

### 8.3 Default Inclusion Rules

A route should be included in the AI navigation catalog when all are true:

1. `meta.aiNavigable !== false`.
2. The route has a stable `name`.
3. The route does not require params.
4. The route is not an auth, login, callback, or error page.
5. The route is not a destructive or irreversible workflow.
6. The route is not marked as internal-only.
7. The route component is a normal application page, not a modal-only or implementation helper page.

### 8.4 Default Exclusion Rules

Exclude routes when any are true:

1. `meta.aiNavigable === false`.
2. Route path contains required params, such as `:id`.
3. Route name or path matches login/auth/callback/logout.
4. Route is used only for authentication handoff.
5. Route starts a side-effecting action on load.
6. Route requires a missing runtime context that the tool cannot safely infer.
7. Route is a detail/edit page where navigating without an entity ID would fail.

Optional params can be supported later if the route has a safe default.

## 9. Navigation Catalog

### 9.1 Catalog Source

The catalog should be generated from Vue Router route definitions. The implementation can use either:

1. A pure helper that consumes `constantRoutes` from `src/views/router/index.ts`.
2. `router.getRoutes()` inside the renderer.

The MVP should prefer a pure helper when possible so it is easy to test.

### 9.2 Catalog Entry Shape

```ts
export interface AiNavigationCatalogEntry {
  routeName: string;
  path: string;
  titleKey?: string;
  label: string;
  aliases: string[];
  description?: string;
  visible: boolean;
  requiresParams: boolean;
}
```

### 9.3 Label Resolution

Use this priority:

1. `meta.aiLabel` if added later.
2. `meta.aiDescription` summary if short enough.
3. `meta.title` translated label when available in renderer.
4. Route name converted to readable words.
5. Route path converted to readable words.

### 9.4 Catalog Availability To AI

The full route catalog can be large. The tool definition should not put every route in an enum. Instead:

1. Define a single `open_app_page` tool with a free-text `query`.
2. Include a concise tool description explaining it opens internal app pages.
3. Resolve `query` inside application code against the catalog.
4. Return top candidates when confidence is low or ambiguous.

This avoids changing the tool schema whenever a page is added.

## 10. AI Tool Contract

### 10.1 Tool Name

`open_app_page`

### 10.2 Tool Description

The function-call description must be explicit enough that the model knows when navigation is appropriate and when it should answer normally or use another tool.

Recommended production tool description:

```text
Navigate AiFetchly to a safe internal application page based on the user's natural language request.

Use this tool when:
- The user explicitly asks to open, go to, navigate to, show, view, or switch to an application page.
- The user asks for a page-like destination such as a list, dashboard, settings screen, log, audit page, management page, inbox, template page, campaign page, schedule page, or configuration page.
- The user appears blocked because they do not know where a feature is located and the best next step is to open the relevant page.
- The request is only about navigation and does not require changing data, submitting a form, sending a message, starting a task, scraping, or calling an external service.

Do not use this tool when:
- The user is asking a general question that can be answered directly without opening a page.
- The user asks to create, edit, delete, send, run, import, export, scrape, schedule, approve, or otherwise mutate data.
- The requested action needs a specific record ID or object that is not known, such as opening a detail/edit page for a specific campaign, email, account, schedule, or task.
- The user asks to log in, log out, open an auth callback, open a system error page, or access an internal helper page.
- The user asks to open an external website, URL, file path, browser page, or operating-system location.
- The user asks for a destructive or high-impact workflow; explain what page they can open or ask for confirmation instead.
- The destination is ambiguous between multiple pages; return clarification candidates rather than choosing one.

This tool only returns a navigation command for a validated internal route. It must not click buttons, fill forms, submit forms, mutate data, send emails, start automation, scrape websites, read private records, or navigate to external websites.
```

The final implementation should keep the same intent even if wording is shortened to fit remote model/tool limits.

### 10.2.1 Positive Use Examples

| User request | Expected tool behavior |
| --- | --- |
| "Open email service." | Call `open_app_page` with query `"Open email service."` |
| "I want to edit email settings." | Call `open_app_page`; resolve to email service list/config page. |
| "Check email reply log." | Call `open_app_page`; resolve to AI auto-reply audit list. |
| "Go to campaign list." | Call `open_app_page`; resolve to campaign list if available. |
| "Where can I manage schedules?" | Call `open_app_page` if opening the schedule page is the best next step. |
| "Show system settings." | Call `open_app_page`; resolve to system settings. |

### 10.2.2 Negative Use Examples

| User request | Expected behavior |
| --- | --- |
| "What is the email service page used for?" | Answer directly; do not navigate unless the user also asks to open it. |
| "Create a new campaign." | Do not use navigation as an action substitute; explain or ask whether to open the campaign page. |
| "Delete this schedule." | Do not use this tool; deletion is a data mutation and needs the appropriate workflow. |
| "Send this email now." | Do not use this tool; sending email is high-impact and requires the send workflow/confirmation. |
| "Open campaign 123." | Do not navigate unless route params are supported and the ID is validated. |
| "Open login." | Do not navigate; login/auth routes are excluded. |
| "Open https://example.com." | Do not use this tool; external navigation is out of scope. |
| "Open email page." | Return clarification candidates if multiple email pages match. |

### 10.2.3 Ambiguous Intent Guidance

If the user request includes both a page intent and an action intent, the assistant should separate them:

1. If the user primarily wants to perform an action, do not use `open_app_page` as though navigation completes the action.
2. If opening a page would help the user manually complete the action, ask a short confirmation or phrase the response clearly.
3. If another purpose-built AI tool exists for the action, prefer that tool over navigation.

Examples:

```text
User: "Send a bulk email."
Assistant behavior: Do not call open_app_page as the final action. Use the proper email-send workflow if available and approved, or ask whether to open the bulk email task page.
```

```text
User: "I need to configure SMTP."
Assistant behavior: Call open_app_page because the request is naturally a configuration-page navigation request.
```

### 10.3 Parameters

```ts
const openAppPageSchema = z.object({
  query: z.string().min(1).max(300),
  preferredRouteName: z.string().optional(),
});
```

### 10.4 Result Types

Successful navigation command:

```ts
interface OpenAppPageSuccess {
  success: true;
  action: "navigate";
  routeName: string;
  path?: string;
  label: string;
  confidence: number;
}
```

Clarification result:

```ts
interface OpenAppPageClarification {
  success: false;
  needsClarification: true;
  message: string;
  candidates: Array<{
    routeName: string;
    label: string;
    confidence: number;
  }>;
}
```

Unsupported result:

```ts
interface OpenAppPageUnsupported {
  success: false;
  message: string;
  needsRouteParams?: boolean;
  notFound?: boolean;
}
```

### 10.5 Permission Category

Recommended permission category: `pure`.

Rationale:

- The tool only requests navigation.
- It does not read private data.
- It does not mutate app data.
- It does not send email, scrape, or call external services.

Actual navigation should still happen only after the renderer verifies that the route is allowed.

## 11. Matching Strategy

### 11.1 MVP Matching

Use deterministic lexical scoring:

1. Normalize query and route text to lowercase.
2. Tokenize words.
3. Score exact alias matches highest.
4. Score route label matches next.
5. Score description and title key matches lower.
6. Boost routes with `meta.visible === true`.
7. Penalize generic matches such as "list", "page", "open", "show", "go".

### 11.2 Confidence Thresholds

Recommended thresholds:

- `>= 0.80`: navigate if the top match is clearly ahead.
- `0.55 - 0.79`: return candidates and ask for confirmation unless one exact alias matches.
- `< 0.55`: return not found.

### 11.3 Ambiguity Rule

If the top two candidates are close, do not navigate automatically.

Recommended rule:

```text
if topScore - secondScore < 0.15, ask for clarification.
```

### 11.4 Future Matching Enhancements

After MVP, route matching can use:

1. Embeddings over route labels and descriptions.
2. User language translation-aware matching.
3. Recently visited pages as weak context.
4. Current feature area as weak context.
5. LLM reranking over top deterministic candidates.

These are optional and should not be required for the first release.

## 12. Renderer Integration

### 12.1 Navigation Execution Location

Only renderer code should call Vue Router.

Recommended location:

- `src/views/components/aiChat/AiChatBox.vue` for existing AI Chat.
- Equivalent AI Chat V2 stream result handling if V2 uses a separate component.

### 12.2 Tool Result Handling

Renderer should detect:

```ts
result.success === true &&
result.action === "navigate" &&
typeof result.routeName === "string"
```

Then call:

```ts
await router.push({ name: result.routeName });
```

### 12.3 Renderer Validation

Before navigation, renderer should verify:

1. Route name exists in `router.getRoutes()`.
2. Route is AI-navigable by the same catalog rules.
3. Route does not require missing params.
4. Tool result action is exactly `"navigate"`.

If validation fails, show a tool result error and do not navigate.

## 13. Main Process And AI Tool Integration

### 13.1 Built-In Tool Registration

Add `open_app_page` to the built-in skill registry.

The tool should:

1. Validate input with Zod v4.
2. Resolve the query against the route catalog.
3. Return a navigation command or clarification result.
4. Avoid direct renderer calls.
5. Avoid direct database access.

### 13.2 AI Enable Gate

The existing AI chat IPC path already gates chat requests through `USER_AI_ENABLED`. If a new IPC handler is added for route catalog operations or tool execution, it must check `USER_AI_ENABLED` first, before parsing request data or doing work.

### 13.3 No Database Requirement

The MVP route catalog is static or renderer-derived. It should not require new entities, models, modules, migrations, or database access.

## 14. Security And Safety

### 14.1 Threat Model

Potential issues:

1. Prompt injection asks the assistant to open login, auth callback, or sensitive internal pages.
2. A route has side effects on load.
3. The tool returns an arbitrary route name not in the allowlist.
4. A hidden route becomes accessible unintentionally.
5. Ambiguous query opens the wrong operational page.

### 14.2 Controls

1. Use a route allowlist generated by strict catalog rules.
2. Support `meta.aiNavigable = false` for explicit exclusion.
3. Exclude required-param routes by default.
4. Renderer validates route before calling `router.push`.
5. Tool returns candidates when ambiguous.
6. No arbitrary URLs.
7. No external navigation.
8. No form submission or action execution.

## 15. Developer Workflow

### 15.1 Adding A New Page

When adding a route:

1. Add the Vue route normally in `src/views/router/index.ts`.
2. Decide whether AI navigation should support it.
3. For safe parameter-free list/index/settings pages, either rely on default inclusion or set `meta.aiNavigable = true`.
4. Add `meta.aiAliases` when users may refer to the page with names different from the route title.
5. Add `meta.aiDescription` for pages whose purpose is not obvious from the title.
6. Set `meta.aiNavigable = false` for login, auth, callback, detail pages needing params, destructive workflows, and internal helper pages.
7. If adding visible user-facing text, update all i18n language files.

### 15.2 Example Metadata

```ts
{
  path: "emailreply/audit/list",
  name: "AI_Auto_Reply_Audit_List",
  meta: {
    visible: true,
    title: "route.ai_auto_replies",
    icon: "mdi-robot-outline",
    aiNavigable: true,
    aiAliases: ["email reply log", "auto reply log", "reply audit", "ai replies"],
    aiDescription: "Review AI auto-reply decisions, sent replies, skipped replies, and audit logs"
  },
  component: () => import("@/views/pages/emailreply/auditlist.vue")
}
```

### 15.3 CLAUDE.md Rule

`CLAUDE.md` should include a mandatory rule:

- When adding or modifying Vue routes, update AI navigation metadata.
- Safe parameter-free pages should be AI-navigable.
- Unsafe, auth, callback, required-param, destructive, or internal routes should set `meta.aiNavigable = false`.
- Add `aiAliases` and `aiDescription` when the route title is not enough for natural language matching.

## 16. Acceptance Criteria

### 16.1 Functional Acceptance Criteria

1. User can ask AI Chat to open the email service page and the app navigates to `Email_Marketing_Service_LIST`.
2. User can ask AI Chat to open email reply logs and the app navigates to `AI_Auto_Reply_Audit_List`.
3. User can ask for a common safe page and receive either navigation or a clarification prompt.
4. User cannot navigate to login through the AI navigation tool.
5. User cannot navigate to a required-param detail route without params.
6. Ambiguous queries return candidates instead of navigating.
7. The tool does not require a static enum of every route.
8. Renderer validates route names before navigation.

### 16.2 Developer Acceptance Criteria

1. New safe parameter-free routes are included automatically by catalog rules.
2. Developers can exclude routes with `meta.aiNavigable = false`.
3. Developers can improve matching with `meta.aiAliases`.
4. Developers can explain route purpose with `meta.aiDescription`.
5. `CLAUDE.md` includes the route metadata rule.

### 16.3 Technical Acceptance Criteria

1. No direct database access is introduced.
2. No worker process involvement is introduced.
3. No arbitrary external URL navigation is possible.
4. New boundary inputs are validated with Zod v4.
5. AI feature IPC gates remain in place.
6. Tests cover catalog generation, exclusions, matching, ambiguity, and renderer validation.

## 17. Test Plan

### 17.1 Unit Tests

Add tests for:

1. Catalog includes safe parameter-free routes.
2. Catalog excludes login/auth routes.
3. Catalog excludes required-param routes.
4. Catalog respects `meta.aiNavigable = false`.
5. Catalog includes explicit `meta.aiNavigable = true` safe routes.
6. Matching exact aliases selects the expected route.
7. Ambiguous email query returns multiple candidates.
8. Low-confidence query returns not found.

Recommended location:

- `test/vitest/utilitycode/` for pure catalog and matcher helpers.
- `test/vitest/main/` if the tool is registered through main-process AI infrastructure.

### 17.2 Integration Tests

Add tests for:

1. `open_app_page({ query: "open email service" })` returns `Email_Marketing_Service_LIST`.
2. `open_app_page({ query: "check email reply log" })` returns `AI_Auto_Reply_Audit_List`.
3. `open_app_page({ query: "open login" })` fails safely.
4. Tool result with unknown route name is rejected by renderer validation.

### 17.3 Manual QA

Manual prompts:

1. "Open email service."
2. "Open email edit page."
3. "Check email reply log."
4. "Show campaign list."
5. "Go to system settings."
6. "Open login page."
7. "Open campaign detail."
8. "Open email page."

Expected behavior:

- Specific safe prompts navigate.
- Login/detail prompts do not navigate.
- Ambiguous prompts ask for clarification.

## 18. Rollout Plan

### Phase 1: Foundation

1. Add route metadata type support.
2. Add catalog generation helper.
3. Add matcher helper.
4. Add tests for catalog and matcher.

### Phase 2: AI Tool

1. Register `open_app_page` as a built-in skill.
2. Return navigation commands, clarification candidates, or safe failure.
3. Add tool execution tests.

### Phase 3: Renderer Handling

1. Detect navigation tool results in AI Chat.
2. Validate route name against current router.
3. Call `router.push`.
4. Add user-visible confirmation or tool result status.

### Phase 4: Route Metadata Coverage

1. Add metadata to high-value routes:
   - Email service
   - Email reply audit
   - Email receive
   - Email template
   - Email filter
   - Bulk email task list
   - Campaign list
   - Social account list
   - Schedule list
   - System settings
2. Mark unsafe or unsupported routes with `aiNavigable = false`.

### Phase 5: Improve Matching

1. Add translated title lookup in renderer catalog if needed.
2. Add recently visited page context if useful.
3. Consider embeddings or LLM reranking only after deterministic matching is stable.

## 19. Open Questions

1. Should hidden but safe settings pages be included by default, or only with `aiNavigable = true`?
2. Should AI Chat V1 and V2 both support navigation on day one?
3. Should route matching use translated labels for non-English user prompts in MVP?
4. Should the tool support optional params later, such as opening the last viewed campaign?
5. Should navigation events be logged for diagnostics?

## 20. Recommended MVP Scope

Build the smallest safe version:

1. Pure route catalog helper.
2. Deterministic text matcher.
3. `open_app_page` built-in skill.
4. Renderer-side route validation and `router.push`.
5. Metadata coverage for email service and email reply audit examples.
6. Explicit exclusions for login/auth/required-param routes.
7. Tests for the known examples and safety exclusions.

This delivers natural-language app navigation without creating a maintenance burden where every new page requires a manual tool schema update.
