# AI HTML Artifacts - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-17
- **Owner**: AiFetchly Desktop Engineering
- **Related areas**: AiChatV2, renderer layout, AI tools, artifact preview, HTML sandboxing
- **Technical design**: `docs/prd/ai-html-artifacts-technical-design.md`
- **Related files**:
  - `src/views/layout/layout.vue`
  - `src/views/components/aiChatV2/AiChatV2.vue`
  - `src/views/components/aiChatV2/AiChatV2Message.vue`
  - `src/views/components/aiChatV2/AiChatV2Messages.vue`
  - `src/entityTypes/aiChatV2Types.ts`
  - `src/main-process/communication/ai-chat-v2-ipc.ts`
  - `src/service/AIChatQueryEngine.ts`
  - `src/service/StreamEventProcessor.ts`

## 1. Summary

AiFetchly should let the AI assistant create visual HTML artifacts and display them in the application's main content area. A user may ask for statistical information, a report, a dashboard, a comparison table, or another visual summary. The assistant should be able to call a controlled tool that creates a standalone HTML artifact. The renderer should then display that artifact in the main workspace using a sandboxed iframe.

This feature should not turn normal assistant messages into raw HTML. Chat remains conversational. Generated HTML is treated as a separate artifact with a clear app boundary: the AI requests artifact creation through a tool, the main process validates and stores it, and the renderer displays it safely.

## 2. Background

AiFetchly already has a docked AiChatV2 panel beside the main router content. The layout has a natural place for a preview workspace: the main body can continue showing the current route or temporarily show an AI-generated artifact.

AiChatV2 already handles streamed tool calls and tool results. That makes an artifact tool the right product interface. The AI can call a tool when a rendered output is useful, and the UI can represent the result as a compact card in chat while opening the actual HTML in the main area.

The current AiChatV2 message renderer displays assistant text as plain text. That is the correct default because AI output is untrusted. Rendering AI-generated HTML directly with `v-html` would create an XSS risk. XSS, or cross-site scripting, means untrusted HTML or script executes inside the app's renderer. In Electron, that risk is higher because the renderer is part of a desktop application.

## 3. Problem Statement

Users often ask the AI for information that is easier to understand visually than as chat text. Examples include statistical summaries, campaign performance breakdowns, lead research reports, keyword comparisons, task result dashboards, and generated HTML previews.

Without a dedicated artifact feature:

1. The AI can only describe visual information in chat text.
2. Large reports make the chat hard to scan.
3. The app has no safe first-class place to display generated HTML.
4. Rendering raw AI HTML inside Vue would create security and stability risks.
5. Users cannot keep a generated report visible while continuing the conversation.
6. Future artifact types such as charts, markdown reports, and generated previews would need separate ad hoc UI paths.

## 4. Goals

1. Allow AiChatV2 to create and display HTML artifacts through a controlled tool call.
2. Display generated artifacts in the main application area, not inside the chat message bubble.
3. Keep normal assistant messages as text by default.
4. Use a sandboxed iframe for rendered HTML.
5. Store artifact metadata so chat history can reopen previous artifacts.
6. Show a compact artifact card in chat with actions such as open, copy HTML, and regenerate.
7. Support visual use cases such as statistical reports, dashboards, comparison tables, charts, formatted summaries, and generated page previews.
8. Prevent AI-generated HTML from accessing Electron APIs, filesystem APIs, cookies, localStorage, or arbitrary navigation.
9. Avoid external network dependencies in generated artifacts for the MVP.
10. Preserve existing AI enable gating for all AI-driven artifact creation.
11. Follow the existing database architecture: Model and Module classes handle persistence, IPC handlers do not directly access the database.
12. Update all user-facing UI text in English, Chinese, Spanish, French, German, and Japanese during implementation.

## 5. Non-Goals

The first release will not include:

1. Rendering arbitrary assistant messages as HTML.
2. Allowing AI-generated HTML to run with unsandboxed browser privileges.
3. Allowing generated artifacts to call Electron, Node.js, filesystem, shell, or app-internal APIs.
4. Allowing generated artifacts to navigate the parent application directly.
5. Allowing external scripts, external stylesheets, remote tracking pixels, or CDN dependencies.
6. Supporting login forms, payment forms, file uploads, or data-submitting forms inside generated artifacts.
7. Replacing route pages with permanent AI-generated UI.
8. Building a full website editor.
9. Supporting collaborative artifact editing.
10. Worker-process database access.
11. Direct database access from renderer code or IPC handlers.

## 6. Target Users

### 6.1 Marketing Operator

Wants campaign, scraping, contact, or email marketing data summarized in a visual report.

Example:

```text
Generate a statistical report for these campaign results and show it in the main area.
```

Expected result: AiFetchly opens an HTML report with metrics, tables, and visual sections.

### 6.2 Business User

Wants a readable document-like summary while continuing to ask follow-up questions.

Example:

```text
Create a comparison dashboard for these leads.
```

Expected result: the main workspace shows the dashboard, and chat remains available for refinement.

### 6.3 Power User

Wants the AI to quickly create reusable visual artifacts from pasted data or uploaded files.

Example:

```text
Turn this CSV summary into a visual dashboard.
```

Expected result: the AI creates an artifact and opens it immediately.

### 6.4 Developer

Wants a clear tool boundary so the AI can display content without bypassing app security, Vue rendering rules, or Electron isolation.

## 7. User Stories

1. As a user, I can ask the AI to generate a statistical report and see it in the main content area.
2. As a user, I can ask for a visual dashboard and keep chatting while the dashboard remains visible.
3. As a user, I can reopen an artifact generated earlier in the conversation.
4. As a user, I can close the artifact preview and return to the normal app route.
5. As a user, I can copy the generated HTML when I need to inspect or export it.
6. As a user, I can ask the AI to regenerate or revise an artifact.
7. As a user, if the AI only needs to answer a simple question, it responds in chat instead of opening a new artifact.
8. As a developer, I can register one built-in tool that creates HTML artifacts through the existing AI tool pipeline.
9. As a developer, I can rely on a typed artifact payload instead of parsing arbitrary tool result text.
10. As a security reviewer, I can verify that generated HTML is sandboxed and has no privileged app access.

## 8. Product Behavior

### 8.1 Basic Flow

```text
User asks for visual output
  -> AI decides whether a visual artifact is useful
  -> AI calls `create_html_artifact`
  -> main process validates and stores the artifact
  -> tool result returns artifact metadata
  -> AiChatV2 shows an artifact card
  -> layout opens the artifact in the main workspace
  -> artifact renders in a sandboxed iframe
```

### 8.2 Tool Name

The MVP tool should be named:

```text
create_html_artifact
```

This name is specific enough to guide the model and narrow enough for security review. The product concept should still be named "AI Artifacts" so future types can be added without renaming the whole feature.

### 8.3 Tool Description

The tool registration should use a description with strong use and non-use guidance:

```text
Create a standalone HTML artifact and display it in the application's main content area.

Use this tool when the user asks for information that is better presented visually or interactively, such as dashboards, statistical reports, comparison tables, charts, summaries with layout, generated landing-page previews, visual plans, or formatted documents.

The HTML must be self-contained and safe to render in a sandboxed iframe. Use semantic HTML and inline CSS. Do not rely on external network resources, remote scripts, remote stylesheets, cookies, localStorage, Electron APIs, filesystem access, or navigation. Do not include forms that submit data, login fields, payment fields, tracking scripts, or code intended to escape the sandbox.

Do not use this tool for ordinary conversational answers, short explanations, code snippets, command output, private/internal reasoning, or content that the user did not ask to visualize. If a simple text response is enough, respond in chat instead.
```

### 8.4 Tool Parameters

```ts
interface CreateHtmlArtifactInput {
  title: string;
  html: string;
  description?: string;
  openImmediately?: boolean;
}
```

Requirements:

1. `title` is required and must be short enough for UI display.
2. `html` is required and must be a complete standalone document or safe fragment.
3. `description` is optional and should summarize what the artifact shows.
4. `openImmediately` defaults to `true`.
5. The tool should reject empty HTML.
6. The tool should enforce a maximum HTML size.
7. The tool should return a clear error when validation fails.

### 8.5 Tool Result

Successful result:

```json
{
  "success": true,
  "artifact": {
    "id": "artifact-123",
    "type": "html",
    "title": "Campaign Statistics Report",
    "mimeType": "text/html",
    "openImmediately": true
  },
  "summary": "Created an HTML report."
}
```

Failure result:

```json
{
  "success": false,
  "error": "The HTML artifact exceeds the maximum allowed size.",
  "summary": "Could not create the HTML artifact."
}
```

### 8.6 When The AI Should Use The Tool

The AI should use `create_html_artifact` when:

1. The user explicitly asks to display generated content in the main area.
2. The user asks to generate HTML, a page, a report, a dashboard, a chart, or a visual summary.
3. The response contains multiple sections that are easier to scan visually.
4. The answer includes statistical information, comparison tables, grouped metrics, timelines, or report-like output.
5. The user wants an output that should remain visible while the chat continues.
6. The user asks to preview generated content.

### 8.7 When The AI Should Not Use The Tool

The AI should not use `create_html_artifact` when:

1. A simple chat answer is enough.
2. The user asks a normal factual question.
3. The user asks for code snippets to paste elsewhere.
4. The output is command output, logs, stack traces, or implementation notes.
5. The user asks to modify the actual AiFetchly codebase. Coding tools should handle that instead.
6. The artifact would need external scripts, unsandboxed browser access, filesystem access, login, payment, uploads, or direct app mutation.
7. The content includes sensitive data and the user did not ask for a rendered artifact.

### 8.8 Chat UI Behavior

When an artifact is created, AiChatV2 should show a compact artifact card. The card should include:

1. Artifact title.
2. Artifact type.
3. Short description or summary.
4. Open action.
5. Copy HTML action.
6. Regenerate or revise affordance when appropriate.
7. Error state if artifact creation failed.

The chat message should not inline the full HTML.

### 8.9 Main Workspace Behavior

The main workspace should support an artifact preview state:

1. If `openImmediately` is true, the new artifact opens automatically.
2. The user can close the preview and return to the previous route.
3. The preview should have a stable header with title and close action.
4. The preview should fit within the existing `layout.vue` main body.
5. The AiChatV2 dock should remain usable while an artifact is open.
6. If another artifact opens, it replaces the current preview.
7. The preview should work on desktop and degrade cleanly on mobile.

### 8.10 Rendering Behavior

HTML artifacts must render in an iframe, not through `v-html`.

Baseline iframe:

```html
<iframe sandbox="" :srcdoc="artifactHtml"></iframe>
```

If a later release supports client-side charts or small interactions, the app may allow scripts with a stricter review:

```html
<iframe sandbox="allow-scripts" :srcdoc="artifactHtml"></iframe>
```

The MVP should prefer no scripts. If scripts are allowed later, the iframe must not include `allow-same-origin`.

## 9. Artifact Data Model Requirements

The exact schema belongs in technical design, but the product requires these concepts:

```ts
interface AIArtifact {
  id: string;
  conversationId: string;
  type: "html";
  title: string;
  description?: string;
  mimeType: "text/html";
  content: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

Requirements:

1. Artifacts are associated with a Chat V2 conversation.
2. Artifact content is persisted so history can reopen it.
3. Regeneration should create a new version or a new artifact record, not silently overwrite prior content.
4. Tool results store metadata that points to the artifact.
5. Large artifact content should not be duplicated into every visible chat message.
6. Artifact persistence must follow the Model and Module architecture.

## 10. System Architecture Requirements

### 10.1 Main Process

1. Register a built-in AI tool named `create_html_artifact`.
2. Validate tool input with a structured schema.
3. Check AI enablement before AI stream work, consistent with existing Chat V2 requirements.
4. Store artifact data through an Artifact Module and Model.
5. Return typed artifact metadata in the tool result.
6. Never directly manipulate Vue Router or renderer state from the main process.

### 10.2 Renderer

1. Detect artifact metadata in Chat V2 tool results.
2. Render artifact cards in `AiChatV2Message.vue`.
3. Emit an event from AiChatV2 when an artifact should open.
4. Let `layout.vue` own the main workspace preview state.
5. Render artifact HTML through a dedicated `AiArtifactWorkspace` component.
6. Fetch artifact content through a typed renderer API when reopening history items.

### 10.3 Persistence

1. Database logic must live in `src/model/` and `src/modules/`.
2. IPC handlers must call modules and never use TypeORM repositories directly.
3. Worker processes must not access artifact persistence directly.
4. Artifact reads and writes must use the standard database path resolution pattern.

## 11. Security Requirements

1. Never render AI-generated HTML with `v-html` in the app renderer.
2. Render artifacts in sandboxed iframes.
3. Do not include `allow-same-origin` in the iframe sandbox.
4. Do not expose Electron, Node.js, filesystem, or app APIs to artifact HTML.
5. Block or strip remote scripts, remote stylesheets, and remote media by default.
6. Block form submission and parent navigation.
7. Enforce maximum HTML size.
8. Treat all artifact content as untrusted.
9. Sanitize the artifact title and description before displaying them in Vue UI.
10. Store only validated metadata in chat message metadata.
11. Log validation failures without leaking sensitive artifact content.

## 12. UX Requirements

1. Artifact opening should feel immediate after the tool result arrives.
2. The preview should not resize or collapse the chat unexpectedly.
3. The user should always understand that the preview was generated by AI.
4. The close action should restore the prior route view.
5. The artifact card should make it clear whether the preview is currently open.
6. Empty, failed, or invalid artifacts should show a clear error in chat.
7. Long artifact titles should truncate without breaking layout.
8. The experience should work with the existing light and dark themes.
9. All new user-facing strings must be translated in `en`, `zh`, `es`, `fr`, `de`, and `ja`.

## 13. Example User Flows

### 13.1 Statistical Report

User:

```text
Generate statistical information from this data and show it in the main area.
```

Expected behavior:

1. AI summarizes the data.
2. AI calls `create_html_artifact`.
3. The main workspace opens an HTML report with metrics and tables.
4. Chat shows an artifact card titled "Statistical Information".

### 13.2 Simple Answer

User:

```text
What is a bounce rate?
```

Expected behavior:

1. AI answers in chat.
2. No artifact is created.
3. The main workspace remains unchanged.

### 13.3 Dashboard Revision

User:

```text
Make the report focus more on conversion rate and less on impressions.
```

Expected behavior:

1. AI creates a revised artifact version.
2. The new version opens in the main workspace.
3. The prior artifact remains available in conversation history.

## 14. Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| ART-001 | Register `create_html_artifact` as a built-in AI tool. | P0 |
| ART-002 | Validate `title`, `html`, `description`, and `openImmediately`. | P0 |
| ART-003 | Persist artifacts by conversation through Model and Module layers. | P0 |
| ART-004 | Return artifact metadata in Chat V2 tool results. | P0 |
| ART-005 | Render artifact cards in AiChatV2 messages. | P0 |
| ART-006 | Open artifacts in the main workspace from AiChatV2 tool results. | P0 |
| ART-007 | Render HTML through a sandboxed iframe. | P0 |
| ART-008 | Prevent `v-html` rendering of generated artifact HTML. | P0 |
| ART-009 | Support reopening prior artifacts from chat history. | P1 |
| ART-010 | Support copy HTML action. | P1 |
| ART-011 | Support artifact versioning or regeneration history. | P1 |
| ART-012 | Add translated UI strings for all supported languages. | P1 |
| ART-013 | Provide validation errors for rejected artifacts. | P1 |
| ART-014 | Add tests for tool validation and renderer metadata handling. | P1 |

## 15. Acceptance Criteria

1. Given a user asks for a visual report, the AI can call `create_html_artifact` and the main area displays the generated HTML.
2. Given a user asks a short factual question, the AI responds in chat and does not create an artifact.
3. Given an artifact tool result has `openImmediately: true`, the artifact opens automatically.
4. Given the user closes the artifact preview, the prior route content is visible again.
5. Given an artifact is reopened from chat history, the stored artifact content is loaded and rendered.
6. Given HTML contains disallowed external scripts or unsafe behavior, validation rejects or sanitizes it.
7. Given an artifact title is very long, the UI truncates it without layout overlap.
8. Given the app is in dark mode, the artifact preview shell remains readable.
9. Given the app is in any supported language, new UI strings have translations.
10. Given a malicious artifact attempts to access the parent app, Electron APIs, or local storage, the sandbox prevents it.

## 16. Testing Requirements

### 16.1 Unit Tests

1. Tool input validation accepts valid HTML artifacts.
2. Tool input validation rejects empty title.
3. Tool input validation rejects empty HTML.
4. Tool input validation rejects oversized HTML.
5. Tool result serialization returns artifact metadata only.
6. Artifact Module stores and retrieves artifacts through the Model layer.

### 16.2 Renderer Tests

1. AiChatV2 renders an artifact card for artifact tool results.
2. AiChatV2 does not inline artifact HTML.
3. `layout.vue` opens the artifact workspace when AiChatV2 emits an open event.
4. Artifact workspace uses iframe `srcdoc`.
5. Artifact workspace does not use `v-html` for artifact content.

### 16.3 Manual QA

1. Generate a statistical report from sample data.
2. Generate a comparison dashboard.
3. Ask a simple question and confirm no artifact opens.
4. Reopen an old artifact from chat history.
5. Test close and reopen behavior.
6. Test light and dark themes.
7. Test all supported languages for new labels.
8. Try malicious HTML payloads that include script, remote resources, form submission, and parent navigation.

## 17. Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| AI overuses artifacts for simple answers | Chat becomes noisy and slow | Strong tool description and system instruction: prefer chat by default |
| Generated HTML executes unsafe code | Security issue | Sandbox iframe, no `allow-same-origin`, validation, no `v-html` |
| External resources leak data | Privacy issue | Block remote scripts, styles, and media in MVP |
| Large artifacts slow the renderer | Poor UX | Enforce max size and show validation errors |
| Artifact state conflicts with routes | User loses navigation context | Keep artifact preview as layout-owned temporary state with close restore |
| Chat history becomes bloated | Slow history loading | Store content separately and keep chat metadata small |
| Future artifact types need redesign | Extra migration work | Name product "AI Artifacts" and make HTML one artifact type |

## 18. Rollout Plan

### Phase 1: HTML Artifact MVP

1. Add artifact types.
2. Add artifact persistence Model and Module.
3. Register `create_html_artifact`.
4. Add artifact tool result metadata.
5. Add artifact card in AiChatV2.
6. Add `AiArtifactWorkspace` with sandboxed iframe.
7. Wire AiChatV2 to `layout.vue`.
8. Add i18n strings and tests.

### Phase 2: History And Revision UX

1. Reopen artifacts from old conversations.
2. Add artifact version labels.
3. Add copy HTML.
4. Add regenerate/revise flow.
5. Add better empty and failure states.

### Phase 3: Richer Artifact Types

1. Add markdown artifacts if needed.
2. Add chart-specific artifacts if needed.
3. Evaluate whether limited `allow-scripts` is safe for local chart rendering.
4. Add export options such as save as HTML or PDF if product demand exists.

## 19. Open Questions

1. What is the maximum allowed artifact HTML size for MVP?
2. Should MVP store artifact content in the existing chat message table, a new artifact entity, or a related artifact table?
3. Should generated HTML be sanitized, constrained by generation rules only, or both?
4. Should scripts be completely forbidden in MVP?
5. Should artifacts be scoped only to the active conversation or also appear in a global artifact library later?
6. Should artifact preview replace the route content or appear as an overlay on top of it?
7. Should copy HTML be available in MVP or Phase 2?

## 20. Recommended MVP Decisions

1. Use a new artifact entity/table instead of storing full HTML in chat metadata.
2. Forbid scripts in MVP.
3. Forbid external resources in MVP.
4. Use iframe `sandbox=""` for MVP rendering.
5. Keep `openImmediately` defaulted to `true`.
6. Place the preview in the main route area with a close action.
7. Show only metadata and actions in chat, never the full HTML.
8. Name the product surface "AI Artifacts" and the first tool `create_html_artifact`.

## 21. Success Metrics

1. Users can generate and view an HTML report without leaving the current chat.
2. The AI does not create artifacts for ordinary short answers in manual testing.
3. Artifact creation failures return clear user-facing errors.
4. No generated HTML is rendered through Vue `v-html`.
5. Security test payloads cannot access app privileges or parent renderer state.
6. Generated artifacts can be reopened from chat history.
7. The feature works in light mode, dark mode, and all supported languages.
