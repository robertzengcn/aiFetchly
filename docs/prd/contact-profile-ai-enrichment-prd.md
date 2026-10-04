# Contact Profile AI Enrichment - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview

Contact Profile Insights currently crawls target URLs and extracts email addresses using deterministic page scraping. Users with AI access need an optional way to enrich those profiles with additional public contact fields, especially phone numbers, addresses, and social links.

This feature adds a per-task AI support option to Contact Profile Insights. When enabled, the crawler will continue using the existing low-cost email extraction flow first, then send only selected high-value pages to the AI contact extraction service for enrichment.

### 1.2 Objectives

- Let AI-enabled users opt in to richer contact profile extraction per task.
- Avoid automatic AI spend just because the account has AI access.
- Reuse existing AI contact extraction infrastructure instead of creating a second prompt or API path.
- Minimize LLM cost by calling AI only after cheap scraping identifies likely contact pages.
- Preserve the current non-AI email extraction behavior for all users and existing tasks.
- Store enriched contact data in a way that can be displayed, exported, and reused by downstream workflows.

### 1.3 Non-Goals

- Do not replace the existing regex-based email crawler.
- Do not call an LLM on every crawled page.
- Do not add direct database access from worker processes.
- Do not create a new remote AI endpoint if the existing contact extraction endpoint is sufficient.
- Do not expose the AI option to users whose account does not have AI enabled.

## 2. Problem Statement

Contact Profile Insights may crawl many pages under a single URL. The current contact discovery function can open a browser, navigate homepage/contact/fallback pages, and call AI multiple times. If that function is called blindly for every crawled page or every input URL, the same site may be crawled twice and the task can generate unnecessary LLM cost.

The desired behavior is:

1. Crawl cheaply first.
2. Identify pages that are most likely to contain useful public contact details.
3. Call AI only for the best candidates.
4. Stop once enough contact fields are found.

## 3. User Experience Requirements

### 3.1 Task Creation UI

On the Contact Profile Insights task form, show an AI support option only when the current user has AI enabled.

Recommended label:

> AI enrich contact profiles

Recommended helper text:

> Use AI on selected contact-like pages to find phone numbers, addresses, and social links. This may use AI credits.

Behavior:

- Hidden when `aiEnabled` is false.
- Visible when `aiEnabled` is true.
- Disabled while the form is loading or submitting.
- Default should be off for cost safety, unless a future user setting records an explicit preference.
- Saved with the task so edit/detail views can show the selected behavior.

### 3.2 Task Edit UI

When editing a pending or error task:

- Show the saved AI support value if the user still has AI access.
- If the user no longer has AI access, hide or disable the option and submit `false`.
- Do not allow enabling AI enrichment from the UI unless `aiEnabled` is true.

### 3.3 Task Result UI

Contact Profile Insights results should be able to show enriched fields:

- Emails
- Phone number
- Address
- Social links
- AI enrichment status
- Confidence, if available

If AI support is disabled or no AI result is found, existing email-only results should continue to display normally.

## 4. Functional Requirements

### 4.1 Per-Task Configuration

Add an `aiSupportEnabled` boolean to the Contact Profile Insights task configuration.

The value must flow through:

- Vue form state
- Frontend API payload
- IPC request payload
- Controller/module task creation
- Task entity/model persistence
- Worker task payload

Backend must verify `USER_AI_ENABLED` before honoring `aiSupportEnabled`.

### 4.2 AI Candidate Selection

The crawler must not send every page to AI. It should use deterministic scraping results to select a limited number of candidate pages.

A page becomes an AI candidate when at least one of these conditions is true:

- The page contains at least one extracted email.
- The URL path includes contact-like terms such as `contact`, `contact-us`, `about`, `support`, `team`, or `help`.
- The page title contains contact-like terms.
- The page appears to be a homepage and contains email or phone-like text.

Candidate scoring should prefer:

| Signal | Priority |
| --- | --- |
| Contact-like URL with email | Highest |
| Contact-like URL without email | High |
| Homepage with email | Medium |
| About/support/team page with email | Medium |
| Generic page with email | Low |

### 4.3 AI Invocation Limits

Default limits:

- Maximum AI pages per domain: 1
- Maximum AI pages per domain when first result lacks phone and address: 2
- Maximum AI pages per task: 20
- Maximum page content sent to AI: use the existing AI API size validation and trimming behavior
- Screenshot: off by default for this task flow

The crawler should stop AI enrichment for a domain when it has found:

- at least one email, and
- at least one phone number or address.

### 4.4 Reuse Existing AI Infrastructure

Use the existing AI contact extraction API:

- `AiChatApi.extractContactInfo(pageContent, url, entityName, screenshot?)`

Preferred process flow:

1. Worker/child process scrapes the page.
2. Worker sends an `AI_SUPPORT_REQUEST` with `requestType: "contact_extraction"` to the main process.
3. Main process handles the request through the existing AI support handler pattern.
4. Main process checks `USER_AI_ENABLED`, rate limits, validates content size, and calls the AI API.
5. Main process sends an `AI_SUPPORT_RESPONSE` back to the worker.
6. Worker merges the AI result into its scraped result payload.
7. Main process saves the final result through Module/Model classes.

The full `discoverAndExtractContactInfo(url)` browser discovery flow should not be the default path for this feature because it duplicates crawling and may call AI several times per URL.

### 4.5 Fallback Behavior

If AI support fails for a page:

- Save the regex-extracted email result.
- Mark AI enrichment status as failed or skipped.
- Do not fail the whole task unless the base email extraction task fails.
- Continue processing other URLs within the configured limits.

If AI is disabled at runtime:

- Ignore the task's AI support flag.
- Continue normal email extraction.
- Record a clear AI skipped reason if an enrichment status field exists.

## 5. Technical Design

### 5.1 Existing Components to Reuse

- Contact Profile Insights form: `src/views/pages/emailextraction/index.vue`
- AI API client: `src/api/aiChatApi.ts`
- Email crawling flow: `src/childprocess/emailSearch.ts`, `src/childprocess/emailCluster.ts`, `src/childprocess/emailScraper.ts`
- Main process AI support pattern: `YellowPagesAiSupportHandler`
- AI support bridge pattern: `AiSupportBridge`
- Existing `USER_AI_ENABLED` gate from `src/config/usersetting`
- Email extraction task Module/Model architecture

### 5.2 Data Model

Add task-level configuration:

```typescript
aiSupportEnabled: boolean;
```

Recommended result-level fields:

```typescript
phone?: string | null;
address?: string | null;
socialLinks?: string[] | null;
aiEnrichmentStatus?: "not_requested" | "queued" | "completed" | "skipped" | "failed";
aiEnrichmentError?: string | null;
aiConfidence?: number | null;
```

Implementation can either extend the current email result tables or create a related contact profile enrichment table. The preferred approach is to avoid overloading `emailsearch_result_detail` if multiple enriched fields per domain are expected.

### 5.3 Backend Flow

```text
Renderer form
  -> emailextraction frontend API
  -> main-process email extraction IPC
  -> EmailextractionController
  -> EmailSearchTaskModule.saveSearchtask()
  -> EmailSearchTaskModule.searchEmail()
  -> taskCode child process
  -> EmailSearch / EmailCluster / emailScraper
  -> AI candidate scorer
  -> AI_SUPPORT_REQUEST to main process
  -> AI support handler + AiChatApi.extractContactInfo()
  -> AI_SUPPORT_RESPONSE to child process
  -> save result through EmailSearchTaskModule
```

### 5.4 Worker/Main Process Boundary

Worker processes must not access the database directly. They may:

- Crawl pages.
- Extract emails via regex.
- Score pages for AI eligibility.
- Request AI support through IPC.
- Send final scraped/enriched results to the main process.

Main process must:

- Check AI access before AI calls.
- Perform AI API calls.
- Persist task and result data through Module/Model classes.

## 6. AI Cost Control Strategy

The feature must follow a cheap-first extraction pipeline.

### 6.1 Candidate Pipeline

1. Crawl page normally.
2. Extract email and page metadata.
3. Add page to candidate list only if it has contact signals.
4. Deduplicate by normalized URL and domain.
5. Score candidates.
6. Call AI for the highest-scoring candidate only.
7. Optionally call AI for one more candidate if required fields are still missing.
8. Stop when useful enriched data is found.

### 6.2 Content Sent to AI

Before sending page content:

- Remove scripts, styles, SVG, navigation boilerplate, and duplicate whitespace.
- Prefer visible `document.body.innerText`.
- Limit content using existing API validation and trimming.
- Include URL and page title or inferred entity name.
- Do not send screenshots by default.

### 6.3 Caching and Deduplication

The AI support handler should cache successful responses where possible. The crawler should also avoid repeat AI calls for:

- Same normalized URL.
- Same domain after successful enrichment.
- Same page content hash within one task.

## 7. Acceptance Criteria

### 7.1 UI

- AI option appears only for users with `aiEnabled === true`.
- AI option is hidden or disabled for non-AI users.
- Task submission includes `aiSupportEnabled`.
- Editing a pending/error task preserves the saved AI option.
- All new user-facing labels are translated in supported language files.

### 7.2 Backend

- Task persistence includes `aiSupportEnabled`.
- Backend checks `USER_AI_ENABLED` before any AI call.
- Normal email extraction still works when AI support is disabled.
- Worker process does not access the database directly.
- AI calls are routed through main process support handling.

### 7.3 Cost Control

- AI is not called for every crawled page.
- Default AI call count is capped per domain and per task.
- AI enrichment stops early when phone or address is found.
- Duplicate pages do not trigger duplicate AI calls in the same task.

### 7.4 Result Quality

- Results can include phone, address, social links, and confidence when AI finds them.
- Existing email results are saved even if AI enrichment fails.
- AI failures are visible enough for troubleshooting but do not fail the whole task.

## 8. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| AI cost grows unexpectedly | Use per-task opt-in, strict page caps, candidate scoring, and dedupe. |
| AI option appears to non-AI users | Gate UI using `aiEnabled` and recheck `USER_AI_ENABLED` in backend. |
| Worker violates database architecture | Keep all persistence in main process Module/Model classes. |
| Duplicate crawling slows tasks | Reuse the already-loaded email crawler page content instead of defaulting to `discoverAndExtractContactInfo(url)`. |
| Poor extraction on sparse pages | Try one additional contact-like candidate page if the first AI result lacks phone/address. |
| Schema churn | Prefer a small additive schema change and keep existing email-only result behavior intact. |

## 9. Phased Delivery

### Phase 1: Task Option and Persistence

- Add `aiSupportEnabled` to form, types, IPC payloads, task entity, model, and module.
- Gate UI visibility by user AI entitlement.
- Add translations for all supported languages.
- Verify non-AI tasks are unchanged.

### Phase 2: Candidate Scoring and AI Support Bridge

- Add candidate scoring to the email crawler.
- Route selected page content to main process via `AI_SUPPORT_REQUEST`.
- Reuse existing AI support handler and `AiChatApi.extractContactInfo`.
- Enforce per-domain and per-task caps.

### Phase 3: Result Persistence and Display

- Store phone, address, social links, confidence, and enrichment status.
- Show enriched fields in Contact Profile Insights details/export.
- Ensure AI failures do not hide email results.

### Phase 4: Optimization

- Add content-hash dedupe.
- Tune scoring based on real task logs.
- Consider a user setting for default AI support preference.
- Consider screenshot fallback only for pages where text extraction is insufficient.

## 10. Open Questions

- Should enriched contact fields live directly on `emailsearch_result`, or in a separate contact profile enrichment table?
- Should the default AI option be always off, or remember the user's last explicit choice?
- What should the first release cap be for maximum AI pages per task: 20, 50, or subscription-tier based?
- Should exports include AI enrichment status and confidence by default?

## 11. Recommended Default Decisions

- Default AI support off.
- Maximum AI pages per domain: 1.
- Maximum fallback AI pages per domain: 1 additional page only if phone/address is missing.
- Maximum AI pages per task: 20.
- Screenshots disabled by default.
- Main-process AI support handler is the only path for AI calls from this task.
- `discoverAndExtractContactInfo(url)` remains available for the existing AI tool flow, but is not the default Contact Profile Insights task enrichment path.
