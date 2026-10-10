# Contact Profile AI Enrichment - Technical Design

## 1. Purpose

This document translates `docs/contact-profile-ai-enrichment-prd.md` into an implementation design for Contact Profile Insights AI enrichment.

The core decision is to keep the current email crawler as the primary extraction engine, then use AI only on selected high-value pages. This avoids calling `discoverAndExtractContactInfo(url)` for every page or URL, which would duplicate browser navigation and can trigger multiple AI calls per site.

## 2. Current System Summary

### 2.1 Current Email Extraction Flow

```text
src/views/pages/emailextraction/index.vue
  -> src/views/api/emailextraction.ts
  -> src/main-process/communication/emailextraction-ipc.ts
  -> EmailextractionController.searchEmail()
  -> EmailSearchTaskModule.saveSearchtask()
  -> EmailSearchTaskModule.searchEmail()
  -> src/taskCode.ts utility child process
  -> EmailSearch.searchEmail()
  -> EmailCluster.searchdata()
  -> emailScraper.crawlSite()
  -> emailScraper.extractLink()
  -> callback(EmailResult)
  -> EmailSearchTaskModule.saveSearchResult()
```

The current `EmailResult` payload contains:

```typescript
export type EmailResult = {
  url: string;
  pageTitle: string;
  filteredLinks: string[];
  emails: string[];
};
```

### 2.2 Current AI Contact Extraction Flow

The existing reusable AI API is:

```typescript
AiChatApi.extractContactInfo(
  pageContent: string,
  url: string,
  entityName?: string,
  screenshot?: string
)
```

There is also a child-to-main AI support pattern:

```text
child process
  -> AI_SUPPORT_REQUEST
  -> YellowPagesAiSupportHandler
  -> AiChatApi.extractContactInfo()
  -> AI_SUPPORT_RESPONSE
  -> child process
```

That pattern already provides:

- `USER_AI_ENABLED` validation in the main process.
- Request validation.
- Page size limits.
- Rate limiting.
- Successful response caching.
- A typed `contact_extraction` request type.

### 2.3 Existing Contact Discovery Function

`discoverAndExtractContactInfo(url)` is useful for URL-only extraction tools, but it is not the preferred path for this feature. It launches its own browser, navigates candidate pages, and may call AI for homepage, heuristic contact page, and fallback routes.

For Contact Profile Insights, the email crawler already has a loaded page and extracted page text. The AI enrichment path should reuse that page context instead of starting another discovery pipeline.

## 3. Target Architecture

```text
Contact Profile Insights form
  -> task payload includes aiSupportEnabled
  -> task persisted with aiSupportEnabled
  -> child process receives aiSupportEnabled
  -> email crawler visits pages as today
  -> candidate scorer records likely contact pages
  -> per-domain AI budget chooses best page
  -> child sends AI_SUPPORT_REQUEST(contact_extraction)
  -> main process validates USER_AI_ENABLED
  -> main process calls AiChatApi.extractContactInfo()
  -> child receives AI_SUPPORT_RESPONSE
  -> child merges enrichment into EmailResult
  -> main process saves result through EmailSearchTaskModule
```

## 4. File-Level Change Map

### 4.1 Frontend

| File | Change |
| --- | --- |
| `src/views/pages/emailextraction/index.vue` | Add AI support switch visible only when current user has `aiEnabled === true`. Include value in submit and edit flow. |
| `src/views/api/emailextraction.ts` | Pass `aiSupportEnabled` through create/update API payloads. |
| `src/entityTypes/emailextraction-type.ts` | Add task and result enrichment fields. |
| `src/views/lang/en.ts` | Add English labels and helper text. |
| `src/views/lang/zh.ts` | Add Chinese labels and helper text. |
| `src/views/lang/es.ts` | Add Spanish labels and helper text. |
| `src/views/lang/fr.ts` | Add French labels and helper text. |
| `src/views/lang/de.ts` | Add German labels and helper text. |
| `src/views/lang/ja.ts` | Add Japanese labels and helper text. |

### 4.2 Main Process

| File | Change |
| --- | --- |
| `src/main-process/communication/emailextraction-ipc.ts` | Validate AI entitlement before accepting `aiSupportEnabled: true`; coerce to false when disabled. Handle child `AI_SUPPORT_REQUEST` messages. |
| `src/controller/emailextractionController.ts` | Include `aiSupportEnabled` in create, edit, and detail data. |
| `src/modules/EmailSearchTaskModule.ts` | Persist task flag, pass flag into child process data, save enriched fields from `EmailResult`. |
| `src/model/EmailsearchTask.model.ts` | Persist new task field through TypeORM entity. |
| New or existing result model | Persist result-level enrichment fields. |

### 4.3 Child Process

| File | Change |
| --- | --- |
| `src/taskCode.ts` | Handle `AI_SUPPORT_RESPONSE` messages for email extraction child flow. |
| `src/childprocess/emailSearch.ts` | Pass AI config into `EmailCluster`. |
| `src/childprocess/emailCluster.ts` | Track per-task and per-domain AI budgets. |
| `src/childprocess/emailScraper.ts` | Collect clean page text, score AI candidates, request AI support for selected pages. |
| `src/childprocess/utils/AiSupportBridge.ts` | Reuse existing bridge if the current parent port shape works for utility process messages. |

## 5. Data Model Design

### 5.1 Task-Level Field

Add `aiSupportEnabled` to the task configuration types:

```typescript
export type EmailscFormdata = {
  // existing fields
  aiSupportEnabled?: boolean;
};

export type EmailsControldata = {
  // existing fields
  aiSupportEnabled?: boolean;
};

export interface EmailSearchTaskDetail {
  // existing fields
  aiSupportEnabled: boolean;
}
```

Add a TypeORM column to `EmailSearchTaskEntity`:

```typescript
@Column("boolean", { default: false })
aiSupportEnabled: boolean;
```

Use the default `false` so existing tasks remain non-AI.

### 5.2 Result-Level Fields

Recommended additive fields for `EmailSearchResultEntity`:

```typescript
@Column("text", { nullable: true })
phone: string | null;

@Column("text", { nullable: true })
address: string | null;

@Column("simple-json", { nullable: true })
socialLinks: string[] | null;

@Column("text", { default: "not_requested" })
aiEnrichmentStatus:
  | "not_requested"
  | "queued"
  | "completed"
  | "skipped"
  | "failed";

@Column("text", { nullable: true })
aiEnrichmentError: string | null;

@Column("real", { nullable: true })
aiConfidence: number | null;
```

Rationale:

- These fields are profile-level data for a crawled URL/domain, not per-email detail.
- Keeping them on `emailsearch_result` makes list/detail/export queries straightforward.
- `emailsearch_result_detail` can continue representing individual email rows.

If the team expects multiple enriched contact profiles per domain later, use a new `emailsearch_contact_profile` table instead. For the first implementation, additive fields on `emailsearch_result` are simpler and lower risk.

### 5.3 Extended Runtime Types

```typescript
export type AiEnrichmentStatus =
  | "not_requested"
  | "queued"
  | "completed"
  | "skipped"
  | "failed";

export type EmailAiEnrichment = {
  phones: string[];
  address?: string | null;
  socialLinks?: string[] | null;
  confidence?: number | null;
  status: AiEnrichmentStatus;
  error?: string | null;
};

export type EmailResult = {
  url: string;
  pageTitle: string;
  filteredLinks: string[];
  emails: string[];
  aiEnrichment?: EmailAiEnrichment;
};
```

## 6. IPC and Process Communication

### 6.1 Create/Update Task Payload

Renderer sends:

```typescript
const scraperData: EmailscFormdata = {
  extratype,
  urls: validateurl,
  pagelength: page_length.value,
  concurrency: concurrent_quantity.value,
  notShowBrowser: !convertNumberToBoolean(showinbrwoser.value),
  proxys: proxyValue.value,
  searchTaskId: searchtaskId.value,
  processTimeout: processTimeout.value,
  maxPageNumber: maxPageNumber.value,
  aiSupportEnabled: aiSupportEnabled.value,
};
```

Main process must not trust the renderer value. It should normalize:

```typescript
const allowAiSupport =
  qdata.data.aiSupportEnabled === true &&
  tokenService.getValue(USER_AI_ENABLED) === "true";
```

Persist only `allowAiSupport`.

### 6.2 Utility Child AI Support Request

Reuse the existing `AiSupportRequestMessage`:

```typescript
const request: AiSupportRequestMessage = {
  type: "AI_SUPPORT_REQUEST",
  taskId,
  requestId,
  requestType: "contact_extraction",
  pageContent: cleanedContent,
  pageUrl: candidate.url,
  businessName: candidate.entityName,
  platformName: "contact-profile-insights",
};
```

The corresponding response data is already represented by `AiExtractedContactData`:

```typescript
export interface AiExtractedContactData {
  emails: string[];
  phones: string[];
  address?: string;
  socialLinks?: string[];
  confidence?: number;
  businessName?: string;
  website?: string;
  description?: string;
}
```

### 6.3 Main Process Message Handling

`EmailSearchTaskModule.searchEmail()` currently listens for standard child messages. Add a pre-parse branch similar to `SearchModule`:

```typescript
child.on("message", (message: unknown) => {
  if (isAiSupportRequestPayload(message)) {
    const aiSupportHandler = new YellowPagesAiSupportHandler();
    aiSupportHandler.handleAiSupportRequest(message, child);
    return;
  }

  // Existing parseChildMessage<EmailResult>() flow.
});
```

If Electron `UtilityProcess` typing differs from `child_process` typing in this path, add a small adapter function rather than weakening types across the handler.

## 7. Candidate Selection Algorithm

### 7.1 Candidate Shape

```typescript
type EmailAiCandidate = {
  url: string;
  domain: string;
  pageTitle: string;
  emails: string[];
  cleanedContent: string;
  entityName: string;
  score: number;
  reasons: string[];
  contentHash: string;
};
```

### 7.2 Scoring

Recommended initial scores:

```typescript
const CONTACT_PATH_SCORE = 50;
const EMAIL_PRESENT_SCORE = 30;
const HOMEPAGE_SCORE = 15;
const TITLE_CONTACT_SCORE = 15;
const PHONE_REGEX_SCORE = 10;
const ABOUT_SUPPORT_TEAM_SCORE = 10;
```

Example scoring function:

```typescript
function scoreCandidate(input: {
  url: string;
  pageTitle: string;
  emails: string[];
  bodyText: string;
  rootUrl: string;
}): EmailAiCandidateScore {
  let score = 0;
  const reasons: string[] = [];
  const parsed = new URL(input.url);
  const path = parsed.pathname.toLowerCase();
  const title = input.pageTitle.toLowerCase();

  if (input.emails.length > 0) {
    score += EMAIL_PRESENT_SCORE;
    reasons.push("email_present");
  }

  if (/contact|contact-us|contactus|get-in-touch/.test(path)) {
    score += CONTACT_PATH_SCORE;
    reasons.push("contact_path");
  }

  if (/about|support|team|help/.test(path)) {
    score += ABOUT_SUPPORT_TEAM_SCORE;
    reasons.push("supporting_contact_path");
  }

  if (/contact|support|team|about/.test(title)) {
    score += TITLE_CONTACT_SCORE;
    reasons.push("contact_title");
  }

  if (isHomepage(input.url, input.rootUrl)) {
    score += HOMEPAGE_SCORE;
    reasons.push("homepage");
  }

  if (PHONE_PATTERN.test(input.bodyText)) {
    score += PHONE_REGEX_SCORE;
    reasons.push("phone_like_text");
  }

  return { score, reasons };
}
```

### 7.3 Selection Rules

Per domain:

1. Keep a sorted candidate list by score descending.
2. Send only the best candidate first.
3. If the response has no phone and no address, allow one additional candidate.
4. Stop once a response includes phone or address.

Per task:

1. Keep `aiRequestsUsed`.
2. Do not exceed `MAX_AI_PAGES_PER_TASK`.
3. Keep `seenContentHashes`.
4. Keep `seenNormalizedUrls`.
5. Skip duplicates before calling AI.

Recommended constants:

```typescript
const MAX_AI_PAGES_PER_DOMAIN = 1;
const MAX_AI_FALLBACK_PAGES_PER_DOMAIN = 1;
const MAX_AI_PAGES_PER_TASK = 20;
const MIN_AI_CANDIDATE_SCORE = 30;
```

## 8. Page Content Preparation

The child process should prepare compact text before requesting AI:

```typescript
const cleanedContent = await page.evaluate(() => {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, svg, img, nav").forEach((node) => {
    node.remove();
  });

  return clone.innerText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15000);
});
```

Rules:

- Prefer visible text over full HTML.
- Do not include screenshots by default.
- Let `AiChatApi.extractContactInfo()` enforce final payload limits.
- Use the page title or hostname as `entityName`.

## 9. UI Implementation Details

### 9.1 User AI Entitlement

Follow the Yellow Pages create page pattern:

```typescript
const userInfo = (await windowInvoke(QUERY_USER_INFO)) as UserInfoType | undefined;
aiOptionVisible.value = userInfo?.aiEnabled === true;
```

### 9.2 Form Controls

Recommended Vuetify control:

```vue
<v-switch
  v-if="aiOptionVisible"
  v-model="aiSupportEnabled"
  :label="t('emailextraction.ai_support_enabled') || 'AI enrich contact profiles'"
  :hint="t('emailextraction.ai_support_hint') || 'Use AI on selected contact-like pages to find phone numbers, addresses, and social links. This may use AI credits.'"
  persistent-hint
  color="primary"
  :disabled="loading"
/>
```

### 9.3 Edit Behavior

When loading task data:

```typescript
aiSupportEnabled.value = aiOptionVisible.value
  ? task.aiSupportEnabled === true
  : false;
```

When submitting:

```typescript
aiSupportEnabled: aiOptionVisible.value && aiSupportEnabled.value === true
```

## 10. Persistence Implementation Details

### 10.1 Save Task

In `EmailSearchTaskModule.saveSearchtask()`:

```typescript
task.aiSupportEnabled = data.aiSupportEnabled === true;
```

### 10.2 Load Task

In `getEmailContoldata()` and controller detail mapping:

```typescript
aiSupportEnabled: task.aiSupportEnabled === true
```

### 10.3 Save Result

In `EmailSearchTaskModule.saveSearchResult()`:

```typescript
data.phone = res.aiEnrichment?.phones?.[0] ?? null;
data.address = res.aiEnrichment?.address ?? null;
data.socialLinks = res.aiEnrichment?.socialLinks ?? null;
data.aiEnrichmentStatus =
  res.aiEnrichment?.status ?? "not_requested";
data.aiEnrichmentError =
  res.aiEnrichment?.error ?? null;
data.aiConfidence =
  res.aiEnrichment?.confidence ?? null;
```

Continue saving email result details as today.

## 11. Failure Modes

| Failure | Behavior |
| --- | --- |
| User lacks AI entitlement | Persist `aiSupportEnabled = false`; normal email extraction continues. |
| AI request times out | Save email result; mark AI enrichment failed for that result. |
| AI returns no data | Save email result; mark AI enrichment completed or skipped with no extra fields. |
| AI handler rate-limits | Save email result; stop or defer additional AI calls for the task. |
| Page content too large | Let handler return validation error; save email result. |
| Child process exits unexpectedly | Existing task error handling applies. |

## 12. Security and Privacy

- UI gating is not security. Main process must validate `USER_AI_ENABLED`.
- Worker processes must not access the database directly.
- Only page text, URL, and inferred entity name should be sent to AI by default.
- Screenshots should remain disabled unless a future explicit fallback is added.
- Do not send cookies, proxy credentials, account credentials, or raw browser storage to AI.
- Keep logs free of full page content and AI payloads.

## 13. Testing Strategy

### 13.1 Unit Tests

Add tests for:

- AI entitlement normalization in IPC/main process.
- Candidate scoring and selection.
- Per-domain and per-task AI caps.
- Content dedupe by normalized URL and content hash.
- Result mapping from `AiExtractedContactData` to `EmailResult.aiEnrichment`.
- Save/load of `aiSupportEnabled`.

Suggested locations:

- `test/vitest/utilitycode/` for pure scoring utilities.
- `test/vitest/main/` for IPC and main process gating.
- `test/modules/` for module/model persistence behavior.

### 13.2 Integration Tests

Add a task-level test with mocked AI support:

1. Create task with `aiSupportEnabled = true`.
2. Crawl pages where multiple pages contain emails.
3. Verify AI is requested only for top candidates.
4. Verify enriched fields are saved.
5. Verify base email results are still saved when AI fails.

### 13.3 Regression Tests

- Existing Contact Profile Insights task creation still works without AI fields.
- Existing task edit still works for pending/error tasks.
- Existing exports still include emails.
- Non-AI users cannot trigger AI calls by crafting payloads manually.

## 14. Rollout Plan

### Step 1: Schema and Types

- Add task flag and result enrichment fields.
- Add TypeScript types.
- Verify existing tasks default to non-AI.

### Step 2: UI and Payload

- Add AI switch with i18n.
- Pass flag through create/update/detail flows.
- Backend normalizes flag using `USER_AI_ENABLED`.

### Step 3: Main Process AI Routing

- Add `AI_SUPPORT_REQUEST` handling to email task child message listener.
- Reuse `YellowPagesAiSupportHandler`.
- Add tests for disabled AI and successful response.

### Step 4: Candidate Scoring

- Add pure scoring utility.
- Add per-domain and per-task budget tracker.
- Integrate with `emailScraper` page extraction.

### Step 5: Result Display and Export

- Persist enriched fields.
- Add columns/detail fields.
- Include enriched fields in export if present.

## 15. Implementation Notes

### 15.1 Avoid This Pattern

Do not call this for every crawled page:

```typescript
await discoverAndExtractContactInfo(job.url);
```

It starts a separate browser flow and can perform multiple AI calls. It remains appropriate for URL-only tool extraction, but not for cost-sensitive Contact Profile Insights task enrichment.

### 15.2 Prefer This Pattern

Use already-loaded page text:

```typescript
if (data.aiSupportEnabled && budget.canRequest(candidate)) {
  const response = await requestAiSupport(parentPort, {
    type: "AI_SUPPORT_REQUEST",
    taskId,
    requestId,
    requestType: "contact_extraction",
    pageContent: candidate.cleanedContent,
    pageUrl: candidate.url,
    businessName: candidate.entityName,
    platformName: "contact-profile-insights",
  });
}
```

### 15.3 Backward Compatibility

- `aiSupportEnabled` is optional in request types and defaults to false.
- Existing saved tasks with no flag are treated as false.
- Existing result rows with no enrichment fields remain valid.
- Existing exports should not break if enrichment fields are null.

## 16. Open Technical Decisions

| Decision | Recommended Default |
| --- | --- |
| Result storage | Add fields to `emailsearch_result` first. |
| AI option default | Off. |
| Screenshots | Disabled. |
| Max AI pages per domain | 1 primary plus 1 fallback. |
| Max AI pages per task | 20. |
| Candidate scoring location | Pure utility under `src/childprocess/contact-extraction/` or `src/childprocess/email-ai-enrichment/`. |
| AI request path | Main process `AI_SUPPORT_REQUEST` handled by `YellowPagesAiSupportHandler`. |

## 17. Verification Checklist

- TypeScript compiles.
- `yarn vue-check` passes for UI type changes.
- Relevant Vitest/Mocha tests pass.
- Manual create task as AI user shows switch and saves flag.
- Manual create task as non-AI user hides switch and cannot enable AI via payload.
- Task with many pages sends bounded AI requests.
- AI failure still saves email results.
- Export handles enriched and non-enriched rows.
