# Contact Verification AI Tool - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-21
- **Owner**: aiFetchly Desktop
- **Primary area**: AI Chat V2, contact extraction, built-in tools
- **Related features**:
  - `extract_contact_info`
  - Contact Profile Insights
  - AI tool-list management
- **Related code**:
  - `src/config/skillsRegistry.ts`
  - `src/config/aiTools.config.ts`
  - `src/service/BuiltInToolCapabilitiesPromptSection.ts`
  - `src/service/ToolLoadPolicyService.ts`
  - `src/service/ToolExecutor.ts`
  - `src/main-process/communication/contactExtraction-ipc.ts`
  - `src/main-process/communication/urlExtractionCollector.ts`
  - `src/childprocess/contact-extraction/`
  - `src/views/components/aiChatV2/AiChatV2.vue`

## 1. Executive Summary

aiFetchly can extract email addresses and phone numbers from websites, but extraction alone does not establish that a contact is plausible or safe to use. Pages frequently contain placeholders, malformed addresses, tracking values, fax numbers, outdated contact details, and phone numbers whose country cannot be determined reliably.

This feature adds a built-in AI-callable tool named `verify_contact_info`. It performs free, Standard-depth verification using local validation and free DNS lookups. It does not use a paid verification provider, send test emails, perform SMTP mailbox probing, call or text phone numbers, or claim that a mailbox or phone line is active.

The tool is independently callable for contacts supplied by users or returned by any tool. When `extract_contact_info` successfully returns one or more email addresses or phone numbers, aiFetchly must make the verification tool available and require verification before the assistant presents, exports, saves, or uses those contacts as verified data. This post-extraction behavior must not depend only on prompt wording.

Phone-region inference is contact-specific. aiFetchly must not use the website's country, top-level domain, company headquarters, campaign country, or another office's address as a site-wide default. A national-format phone number may be normalized only when an explicit international prefix or evidence from the same contact block supports one country. Otherwise, the original number is preserved and classified as ambiguous.

## 2. Problem Statement

The current `extract_contact_info` result includes raw `emails` and `phones`. These values can contain:

- malformed or truncated email addresses;
- placeholder, test, or disposable email addresses;
- domains that do not exist or cannot receive email;
- role-based mailboxes that are valid but should not be represented as personal contacts;
- dates, prices, order IDs, postal codes, and tracking IDs misidentified as phone numbers;
- fax or toll-free numbers misclassified as direct phone numbers;
- national-format numbers incorrectly normalized using an unrelated country;
- duplicate contacts expressed in different formats;
- values whose technical format is plausible but whose reachability is unknown.

Users need a clear distinction between extraction, Standard verification, and actual deliverability or ownership. Without that distinction, downstream AI workflows can confidently present or act on unreliable data.

## 3. Product Principles

### 3.1 Verify evidence, not ownership

Standard verification establishes whether a value is structurally plausible and supported by available technical evidence. It does not prove that a person owns the contact, that the mailbox or phone line is active, or that the user has consent to contact it.

### 3.2 Preserve uncertainty

When evidence is incomplete or conflicting, return `unknown` or `ambiguous_region`. Do not force a binary answer and do not invent an international phone number.

### 3.3 Resolve phone regions per contact block

Country evidence applies only to the phone number found in the same office card, address block, structured-data object, or closely associated page section. One company's website can list contacts in many countries.

### 3.4 Keep raw evidence

Always preserve the original extracted value, source URL, nearby context, applied checks, and reasons for the classification. Normalization must not destroy the source value.

### 3.5 Enforce the extraction-to-verification handoff

Tool descriptions should guide the model, but product correctness must not rely on the model voluntarily making a second tool call. The tool runtime must expose or schedule the required verification step after successful contact extraction.

### 3.6 Free Standard depth only

The first release must use local libraries, maintained local data lists, and ordinary DNS queries. It must not require a paid data source or create billable verification traffic.

## 4. Goals

- Provide a reusable `verify_contact_info` built-in tool for email addresses and phone numbers.
- Automatically verify emails and phones returned successfully by `extract_contact_info`.
- Allow verification of contacts pasted into chat, loaded from files, or returned by other tools.
- Reject obvious extraction noise and invalid contacts.
- Normalize contacts only when the result is well supported.
- Explain every classification with structured checks and human-readable reasons.
- Preserve ambiguous phone numbers without applying a site-wide default country.
- Keep verification free of paid provider dependencies.
- Keep verification results suitable for later filtering, export, storage, and AI reasoning.
- Maintain current worker/main-process and Model/Module database boundaries.

## 5. Non-Goals

- Confirming that an email mailbox exists or is deliverable.
- Confirming that a phone line is active or reachable.
- Sending an email, making a call, or sending an SMS/WhatsApp message for verification.
- SMTP mailbox probing or SMTP `RCPT TO` verification.
- Carrier, HLR, CNAM, line-owner, spam-trap, or phone-portability lookup.
- Identifying the human owner of a contact.
- Determining marketing consent or legal permission to contact a person.
- Automatically deleting raw contacts that cannot be verified.
- Treating role-based addresses such as `sales@` or `support@` as invalid.
- Treating the website domain, headquarters, campaign country, or top-level domain as authoritative phone-region evidence.
- Creating a dedicated verification-management UI in the first release.
- Replacing the existing contact extraction pipeline.

## 6. Definitions

### 6.1 Standard email verification

Standard email verification includes syntax, normalization, placeholder detection, disposable-domain detection, and DNS/mail-routing checks. It excludes mailbox-level probing.

### 6.2 Standard phone verification

Standard phone verification includes extraction-noise detection, parsing, numbering-plan validation, cautious type classification, evidence-based country resolution, and normalization when confidence is sufficient. It excludes live line-status checks.

### 6.3 Contact block

A contact block is the smallest page region that associates a contact value with its context, such as an office card, footer column, address section, structured-data object, or heading and its immediately related content.

### 6.4 Verified result

In this PRD, a verified result means that Standard checks completed and returned a classification. It does not mean that the contact is active, owned by a specific person, or safe to contact.

## 7. Target Users and User Stories

### US-1: Verify newly extracted contacts

As a user asking AI to extract contacts from company websites, I want every returned email and phone number checked automatically so that the assistant does not present raw extraction as trusted data.

Acceptance criteria:

- An extraction result containing an email or phone triggers the verification workflow.
- The final assistant answer uses verification classifications and reasons.
- Raw values remain available for review.

### US-2: Verify contacts supplied directly

As a user with a list of emails or phone numbers, I want AI to call the verification tool directly without first scraping a website.

Acceptance criteria:

- The tool accepts email-only, phone-only, and mixed inputs.
- Source URLs are optional for direct user input.
- Missing context does not prevent verification, but may produce an ambiguous result.

### US-3: Handle a multinational website

As a user extracting contacts from a multinational company, I want each phone number interpreted using its own office context so that a London number is not normalized using the US headquarters or campaign country.

Acceptance criteria:

- Each phone input can carry separate country evidence.
- Evidence from one contact block is not applied to another block.
- Ambiguous national numbers preserve their original form.

### US-4: Understand why a contact was classified

As a user reviewing contacts, I want to see why each result is likely valid, risky, invalid, or ambiguous so that I can decide whether to keep it.

Acceptance criteria:

- Every result includes check outcomes and reasons.
- A result never relies only on an unexplained numeric score.
- The assistant states the limits of Standard verification when relevant.

### US-5: Reuse verification downstream

As an AI workflow, I want structured verification output so that I can filter, export, save, or use contacts according to the user's requested risk threshold.

Acceptance criteria:

- Result statuses and fields are machine-readable and stable.
- Original and normalized values are both returned when normalization succeeds.
- Invalid and ambiguous contacts are not silently discarded.

## 8. User Experience Requirements

### 8.1 Default AI chat behavior

When contact extraction returns emails or phones, the user should see one coherent workflow:

```text
Extract contact information
          |
          v
Verify extracted emails and phones
          |
          v
Present classified contacts and limitations
```

The assistant should not ask the user for permission to run free Standard verification after the user already requested contact extraction. Verification is a read-only continuation of that request.

### 8.2 Presentation rules

The assistant should group or label results using plain language:

- Likely valid
- Role-based
- Risky
- Invalid
- Unknown
- Region ambiguous

For phone numbers, the assistant should distinguish:

- an explicit international number;
- a national number resolved from the same contact block;
- a plausible number with insufficient regional evidence;
- non-phone extraction noise.

The assistant must not say "deliverable," "active," "reachable," or "owner verified" unless a future verification depth provides evidence for that claim.

### 8.3 No destructive filtering by default

The default response may prioritize likely-valid contacts, but it must retain invalid, risky, and ambiguous results in the structured tool output. Removal requires an explicit user action or downstream policy.

### 8.4 UI scope

The first release may use the existing generic AI Chat V2 tool-call and tool-result presentation. If implementation introduces any new renderer-facing labels, filters, badges, dialogs, loading states, or errors, those changes must:

- use `vue-i18n`;
- update English, Chinese, Spanish, French, German, and Japanese translations;
- include matching Vue component tests;
- add Playwright coverage if the flow becomes multi-step or cross-component in the UI.

## 9. Functional Requirements

### FR-1: Built-in verification tool

Add a built-in tool with the canonical name:

```text
verify_contact_info
```

The tool must support:

- one or more email addresses;
- one or more phone numbers;
- mixed email and phone inputs;
- multiple source/contact groups in one call;
- optional source URL and nearby context;
- partial success when one contact or one network check fails.

The tool must be read-only and must not require confirmation.

### FR-2: Tool description contract

The LLM-facing description must state all of the following:

- Use the tool to validate and normalize email addresses and phone numbers with free Standard-depth checks.
- Call it after any tool returns one or more previously unverified emails or phone numbers.
- Call it before presenting, exporting, saving, or using extracted contacts as verified data.
- Pass original values, source URLs, and nearby contact-block context when available.
- Never use site-wide country assumptions for national phone numbers.
- Preserve ambiguous numbers and original values.
- Do not claim mailbox existence, line activity, ownership, consent, or reachability.
- Do not call the tool again for values that already contain a completed verification result unless the user requests re-verification or the cached result is stale.

### FR-3: Tool input contract

The preferred request shape is:

```json
{
  "contacts": [
    {
      "source_url": "https://example.com/contact",
      "emails": ["sales@example.com"],
      "phones": ["020 7946 0958"],
      "context": {
        "nearby_text": "London Office",
        "address": "10 Example Street, London, United Kingdom",
        "country": "GB",
        "country_evidence": "same_contact_block"
      }
    }
  ]
}
```

Input rules:

- `contacts` is required and must contain at least one item.
- Each item must contain at least one non-empty email or phone value.
- `source_url` is optional but recommended for extracted contacts.
- `context` is optional and applies only to that contact item.
- `country`, when present, uses an ISO 3166-1 alpha-2 code.
- `country_evidence` must describe the source of the country inference.
- Country evidence must be omitted when uncertain.
- Input size and batch limits must prevent excessive CPU, DNS traffic, or tool-result size.
- Invalid input items must return item-level errors where possible instead of failing unrelated contacts.

### FR-4: Email normalization and syntax checks

For each email address, the verifier must:

1. Preserve the original value.
2. Remove surrounding whitespace and extraction punctuation.
3. Normalize the domain using a consistent case and international-domain representation.
4. Validate practical email syntax and total/component lengths.
5. Reject embedded markup, URL fragments, concatenated values, and known extraction artifacts.
6. Detect obvious placeholders and examples.
7. Detect role-based local parts without treating them as invalid.
8. Deduplicate equivalent normalized values while retaining all source references.

The first release should not change the case of the local part solely for deduplication display. If a case-insensitive comparison is used internally, the original spelling must be retained.

### FR-5: Email domain and mail-routing checks

For every syntactically valid, non-placeholder email, the verifier must:

- resolve the domain through DNS;
- check for MX records;
- treat an explicit null MX as evidence that the domain does not accept email;
- when no MX record exists, evaluate standards-compatible address-record fallback separately from an MX success;
- distinguish `NXDOMAIN`, no mail route, timeout, temporary DNS failure, and resolver failure;
- avoid converting temporary network failures into a permanent invalid result;
- cache DNS results using a bounded lifetime that respects DNS data where practical;
- apply bounded concurrency, timeouts, and retries.

### FR-6: Disposable and suspicious email detection

The verifier must support a locally shipped disposable-domain list and locally defined suspicious-pattern rules.

It must distinguish:

- disposable domain;
- obvious placeholder/test address;
- role-based address;
- suspicious local part;
- known-safe syntactic and routing checks.

The disposable-domain data source must be replaceable and updateable without changing the public tool contract. A stale list must not turn all unknown domains into risky results.

### FR-7: Email classifications

Each email must return exactly one primary status:

| Status | Meaning |
| --- | --- |
| `likely_valid` | Syntax is valid and the domain has supported mail routing. |
| `role_based` | Likely valid, but the address represents a function or team rather than an individual. |
| `risky` | The value is disposable, suspicious, or otherwise unsuitable for automatic use. |
| `invalid` | Syntax is invalid, the domain does not exist, or the domain explicitly cannot receive email. |
| `unknown` | Verification could not complete because evidence was insufficient or temporarily unavailable. |

Role-based classification must not hide other risk signals. Secondary flags and reasons must remain available.

### FR-8: Phone preprocessing and noise detection

For each phone value, the verifier must:

1. Preserve the original text.
2. Normalize Unicode digits and common separators for parsing.
3. Preserve extensions as a separate field when recognized.
4. Detect and classify likely non-phone values such as dates, timestamps, prices, postal codes, IDs, and repeated-digit placeholders.
5. Detect labels such as fax, mobile, WhatsApp, toll-free, office, or support from nearby context when available.
6. Avoid removing meaningful international prefixes during cleanup.

### FR-9: Explicit international phone numbers

Numbers beginning with `+` or a recognized international dialing prefix must be parsed as international numbers without a default region.

The verifier may return E.164 normalization only when:

- the country calling code is recognized;
- the national number is possible under current numbering-plan metadata; and
- parsing does not require an unsupported assumption.

An internationally formatted number can still be classified as invalid or possible; the prefix alone is not proof of validity.

### FR-10: National phone number region resolution

For a phone number without an explicit country calling code, the verifier must evaluate country evidence in this priority order:

1. Country explicitly attached to the same structured contact object.
2. Postal address in the same contact block.
3. Country or office heading governing the same contact block.
4. City/region evidence in the same contact block when it maps unambiguously.
5. Other tightly scoped nearby text that clearly associates the number with a country.

The following may be recorded as weak hints for review but must not independently authorize normalization:

- website top-level domain;
- company headquarters;
- campaign country;
- browser locale;
- user locale;
- page language;
- IP geolocation;
- an address or office heading from another contact block.

When one country is strongly supported and the number is valid for that region, the tool may normalize it. When multiple countries remain plausible or evidence conflicts, it must return `ambiguous_region` and omit the E.164 value.

### FR-11: Phone classifications

Each phone must return exactly one primary status:

| Status | Meaning |
| --- | --- |
| `likely_valid` | An explicit international number matches a valid numbering structure. |
| `context_resolved` | A national number was resolved using strong evidence from the same contact block. |
| `ambiguous_region` | Multiple interpretations are plausible or regional evidence is missing/conflicting. |
| `possible` | The value resembles a phone number, but available metadata cannot establish a stronger result. |
| `invalid` | The number is impossible for the supported interpretation. |
| `non_phone` | The extracted value is more likely a date, identifier, postal code, or other non-phone value. |

These statuses describe structural evidence, not line activity.

### FR-12: Structured result contract

The tool must return a stable result containing per-contact outcomes. A representative shape is:

```json
{
  "success": true,
  "verification_depth": "standard",
  "limitations": [
    "Mailbox existence was not checked",
    "Phone line activity was not checked"
  ],
  "summary": {
    "input_emails": 1,
    "input_phones": 1,
    "likely_valid": 1,
    "needs_review": 1,
    "invalid": 0,
    "unknown": 0
  },
  "contacts": [
    {
      "source_url": "https://example.com/contact",
      "emails": [
        {
          "original": "Sales@Example.com",
          "normalized": "Sales@example.com",
          "status": "role_based",
          "checks": {
            "syntax_valid": true,
            "placeholder": false,
            "disposable_domain": false,
            "domain_resolves": true,
            "mail_routing": "mx",
            "role_based": true
          },
          "reasons": [
            "The domain publishes mail-routing records",
            "The local part identifies a sales role"
          ]
        }
      ],
      "phones": [
        {
          "original": "020 7946 0958",
          "normalized": "+442079460958",
          "extension": null,
          "status": "context_resolved",
          "country": "GB",
          "country_confidence": "high",
          "country_evidence": "London office address in the same contact block",
          "number_type": "fixed_line",
          "reasons": ["The number matches the UK numbering structure"]
        }
      ]
    }
  ]
}
```

Result requirements:

- `success` describes whether the tool completed, not whether every contact is valid.
- Each input value produces a result or an item-level error.
- `normalized` is omitted when normalization is unsafe.
- Checks use stable machine-readable values.
- Reasons are concise and safe to display or summarize.
- Limitations are included at the top level.
- A partial result identifies timed-out or failed checks without discarding completed checks.

### FR-13: Automatic handoff after extraction

When `extract_contact_info` completes with at least one email address or phone number:

1. Its result must identify that verification is required.
2. `verify_contact_info` must be exposed to the model on the immediate continuation round even if the tool is normally deferred.
3. The extracted contacts and their available source context must be passed to verification.
4. The assistant must receive the verification result before producing a final contact answer.
5. The runtime must prevent silent completion with raw contacts if the model omits the required verification call.

The product may satisfy step 5 through either:

- runtime-managed automatic execution of `verify_contact_info`; or
- a query-loop postcondition that requires the next model action to call the verification tool.

Runtime-managed automatic execution is preferred because it produces consistent behavior across models and providers.

### FR-14: Extraction result metadata

When raw contacts are present, the extraction result should expose machine-readable handoff metadata equivalent to:

```json
{
  "verification_required": true,
  "verification_tool": "verify_contact_info",
  "verification_depth": "standard"
}
```

When no email or phone was found, `verification_required` must be false and the workflow must not call the verification tool with an empty input.

### FR-15: Independent invocation and repeat prevention

The tool must also work outside contact extraction. The AI should select it when the user asks to:

- verify, validate, clean, normalize, check, or classify emails or phone numbers;
- review contacts imported from CSV, spreadsheet, JSON, or chat text;
- separate likely-valid contacts from invalid or ambiguous contacts.

The workflow must avoid repeated verification in the same chain. A contact result is already verified when it carries a completed verification-depth marker and matching normalized input fingerprint. Re-verification is allowed when:

- the user explicitly requests it;
- the previous result was temporary or unknown;
- cached DNS evidence has expired; or
- verification rules or data versions have materially changed.

### FR-16: Deferred-tool discovery

The verification tool must remain discoverable and usable under the existing tool-list management system.

Required behavior:

- Natural-language verification intent promotes the tool or enables discovery through `tool_catalog_search`.
- A successful `extract_contact_info` call forces the tool into the next exposed tool set.
- The built-in capabilities prompt lists extraction and verification together.
- Search hints include `verify`, `validate`, `email`, `phone`, `contact`, `normalize`, and `clean`.
- Tool filtering must not hide verification during a required post-extraction continuation.

### FR-17: Batch handling

Verification must support batches while protecting the renderer, DNS resolver, and model context.

- Deduplicate inputs before network checks.
- Use bounded DNS concurrency.
- Return progress for sufficiently large batches if execution exceeds the normal interactive threshold.
- Keep per-contact ordering stable relative to first occurrence.
- Return partial results if a batch is cancelled or reaches its deadline.
- Do not retry completed contacts when continuing a partial batch.

Exact batch thresholds are an implementation decision and should be based on measured latency and tool-result size.

### FR-18: AI enable gate

Because the verifier is exposed through AI Chat, all IPC handlers serving the AI tool flow must check AI access first using `Token` and `USER_AI_ENABLED`. When AI is disabled, the handler must return immediately with a clear failure response and must not parse or execute the verification request.

The underlying deterministic verifier may remain reusable by non-AI product features through a separate non-AI service boundary in the future.

### FR-19: Error handling

The verifier must distinguish:

- invalid input;
- unsupported or ambiguous phone region;
- DNS not found;
- DNS timeout or temporary resolver failure;
- local verification-data load failure;
- cancellation;
- overall deadline exceeded;
- internal execution failure.

A failure affecting one item must not fail unrelated items. Temporary failures must return `unknown`, not `invalid`.

## 10. Tool Descriptions

### 10.1 Recommended `verify_contact_info` description

```text
Validate and normalize email addresses and phone numbers using free, local
Standard-depth checks.

For emails, check syntax, placeholder patterns, disposable domains, DNS
resolution, and mail-routing records. For phone numbers, check extraction noise,
international or national formatting, numbering-plan metadata, and country
evidence associated with the same contact block.

Call this tool immediately after any tool, including extract_contact_info,
returns one or more previously unverified email addresses or phone numbers. Run
verification before presenting, exporting, saving, or using those contacts as
verified data. Pass original values, source URLs, and nearby contact context.

Do not use the website domain, company headquarters, campaign country, user
locale, or an unrelated office address as authoritative country evidence. If a
national phone number lacks strong same-block country evidence, preserve the
original number and classify its region as ambiguous.

This tool does not confirm mailbox existence, phone-line activity, ownership,
deliverability, reachability, or marketing consent. Do not claim that it does.
Do not re-verify contacts that already contain a completed verification result
unless the user requests it or the prior result is stale or temporary.
```

### 10.2 Required addition to `extract_contact_info`

```text
POSTCONDITION: If extraction succeeds and returns at least one email address or
phone number, verify all extracted contacts with verify_contact_info before
presenting, exporting, saving, or using them as verified data. Pass each value's
source URL and available nearby contact-block context. Skip verification only
when no email addresses or phone numbers were found or the values already carry
a completed Standard verification result.
```

### 10.3 Built-in capability prompt entry

The compact capabilities prompt should group these tools:

```text
| Extract or verify website contacts; validate or normalize email and phone
numbers | extract_contact_info, verify_contact_info |
scrape extract verify validate email phone contact normalize |
```

## 11. High-Level Architecture and Boundaries

### 11.1 Logical flow

```text
User or another tool
        |
        v
extract_contact_info or direct contact input
        |
        v
Verification handoff policy
        |
        v
verify_contact_info
  |                    |
  |                    +--> Phone parser + numbering metadata
  +--> Email parser + DNS + local domain lists
        |
        v
Structured classifications and evidence
        |
        v
AI summary / export / save / downstream use
```

### 11.2 Process placement

- Shared deterministic verification logic belongs in `src/modules/` or an appropriate shared service/module boundary.
- AI tool registration belongs with the built-in tool registry.
- Tool execution orchestration belongs in the main-process tool execution path.
- Worker-specific extraction stays in `src/childprocess/contact-extraction/`.
- Workers must not access the database.
- IPC handlers must not access TypeORM repositories directly.
- If verification results are persisted, database access must use Model and Module classes and resolve the database path through `Token` and `USERSDBPATH`.
- `AiChatV2.vue` remains a renderer/UI consumer and must not own verification rules or tool-selection policy.

### 11.3 Caching

The verifier should cache reusable checks without hiding freshness:

- DNS answers should use a bounded lifetime and retain result timestamps.
- Disposable-domain membership can be cached by verification-data version.
- Phone parsing can be cached by normalized input, context evidence, and numbering-data version.
- Cached results must never cross user boundaries if they contain source context or user-supplied metadata.
- A cache hit must return the same evidence structure as a fresh check.

## 12. Security, Privacy, and Compliance Requirements

- Treat contact values and nearby page context as potentially sensitive data.
- Do not log full email addresses, phone numbers, or page context at normal log levels.
- Redact contact values from errors and diagnostic events where possible.
- Validate and sanitize all tool arguments before execution.
- Bound input lengths, item counts, DNS concurrency, and result sizes.
- Prevent user-supplied context from changing tool policy or being interpreted as trusted instructions.
- Do not send verification data to a paid or third-party verification API.
- DNS queries may disclose queried domains to the configured resolver; documentation must not represent DNS verification as fully offline.
- Verification status must not be represented as marketing consent.
- Downstream outreach features must retain their existing approval and compliance controls.
- Do not initiate network contact with a target mailbox or phone number.

## 13. Performance and Reliability Requirements

- Local syntax and phone parsing should complete without perceptible delay for a small interactive batch.
- DNS lookups must use bounded concurrency, per-query timeouts, and an overall tool deadline.
- One unavailable DNS domain must not block the full batch.
- Duplicate domains should share DNS work within a call.
- Cancellation from the AI tool runtime must stop pending work promptly.
- Partial completed results must be returned when safe instead of being discarded.
- Result ordering must be deterministic.
- The tool must not create orphaned child processes, browser instances, or unresolved timers.
- Standard verification must not launch Puppeteer; it operates on supplied contacts and context.

## 14. Observability and Product Metrics

Record privacy-safe operational metrics:

- number of verification calls;
- input email and phone counts;
- deduplicated counts;
- counts by primary classification;
- percentage of extraction workflows that completed verification;
- percentage of national phone numbers left ambiguous;
- DNS timeout and temporary-failure rates;
- median and percentile latency by batch size;
- cache hit rate;
- partial-result and cancellation rates;
- number of cases where the runtime enforced a missed postcondition;
- tool discovery/promotion failures.

Do not record raw contacts in telemetry.

Initial product success indicators:

- At least 99% of successful AI contact extractions containing emails or phones proceed through verification before final assistant completion.
- Zero phone numbers are normalized from national format using only a campaign country, site domain, headquarters, user locale, or unrelated address.
- Temporary DNS failures never produce a permanent `invalid` classification.
- Every classified contact includes at least one machine-readable check or reason.

## 15. Testing Requirements

### 15.1 Email unit tests

Cover at minimum:

- valid common addresses;
- leading/trailing extraction punctuation;
- invalid syntax and excessive lengths;
- internationalized domains;
- placeholder/test patterns;
- role-based addresses;
- disposable domains;
- MX success;
- explicit null MX;
- no MX with supported address-record fallback;
- `NXDOMAIN`;
- DNS timeout and temporary failure;
- duplicate values with different domain case;
- values embedded in markup, URLs, or concatenated text.

DNS tests must use controlled fakes or fixtures and must not depend on public DNS availability.

### 15.2 Phone unit tests

Cover at minimum:

- explicit `+` international numbers from several regions;
- recognized international dialing prefixes;
- valid and invalid national numbers with same-block country evidence;
- the same national text producing different valid interpretations;
- conflicting country evidence;
- missing country evidence;
- extensions;
- mobile, fixed-line, toll-free, fax, and unknown labels where metadata supports them;
- Unicode digits and common separators;
- dates, prices, postal codes, IDs, and repeated-digit placeholders;
- preservation of the original value when normalization is omitted.

### 15.3 Tool contract tests

Cover:

- email-only, phone-only, and mixed requests;
- multiple contact blocks with different countries;
- partial item failures;
- stable result schema and ordering;
- deduplication with retained sources;
- cancellation and deadline behavior;
- batch limits;
- absence of raw contacts from normal logs;
- AI-disabled early return before request parsing or verification work.

### 15.4 Agent orchestration tests

Cover:

- successful extraction with emails forces verification availability;
- successful extraction with phones forces verification availability;
- extraction with neither skips verification;
- partial extraction verifies completed contacts and preserves remaining-URL notes;
- deferred tool policy cannot hide required verification;
- final response cannot silently complete with unverified raw contacts;
- direct user request to validate contacts selects or discovers the tool;
- completed verification is not called repeatedly in the same workflow;
- provider/model variation does not bypass the postcondition.

### 15.5 UI tests

No component test change is required if the existing generic tool-call UI is unchanged. Any new visible verification UI must include corresponding tests in `test/vitest/main/components/`. Critical multi-step visible flows must also receive Playwright coverage in `test/e2e/specs/`.

## 16. Acceptance Criteria

### 16.1 Core tool

- `verify_contact_info` is registered as a built-in, read-only tool.
- It accepts email-only, phone-only, and mixed batches.
- It returns original values, optional normalized values, stable statuses, checks, reasons, and limitations.
- It uses no paid verification service.
- It performs no SMTP mailbox probing, email delivery, call, or text.

### 16.2 Email behavior

- Invalid syntax and obvious placeholders are identified.
- Role-based addresses remain usable but are clearly classified.
- DNS outcomes distinguish working mail routing, null MX, missing domain, and temporary failure.
- Temporary resolver failures return `unknown`, not `invalid`.
- Disposable-domain status is based on a local replaceable data source.

### 16.3 Phone behavior

- Explicit international numbers are parsed without a default region.
- National numbers are normalized only with strong same-contact-block evidence.
- Website domain, headquarters, campaign country, user locale, and unrelated addresses cannot independently select a region.
- Conflicting or absent regional evidence returns `ambiguous_region` without an E.164 value.
- Obvious non-phone extraction values are classified separately.

### 16.4 Extraction handoff

- Extraction results with emails or phones declare that verification is required.
- The verification tool is available on the next round even when normally deferred.
- The runtime ensures verification completes before final presentation of contacts as verified.
- Extraction results without emails or phones do not cause an empty verification call.
- Already verified contacts do not loop through verification repeatedly.

### 16.5 Architecture and safety

- `AiChatV2.vue` contains no verification business logic or tool-selection policy.
- Worker processes contain no database access.
- IPC handlers contain no direct repository access.
- AI tool handlers check `USER_AI_ENABLED` before parsing or executing requests.
- Logs and telemetry do not contain raw email addresses or phone numbers.
- Any new user-facing text is translated into all supported languages and covered by UI tests.

## 17. Rollout Plan

### Phase 1: Deterministic verifier and direct tool use

- Implement email and phone Standard checks.
- Register `verify_contact_info` and its schema.
- Add unit and tool-contract tests.
- Support direct AI calls for user-supplied contacts.

### Phase 2: Extraction integration

- Add extraction handoff metadata.
- Force verification availability after extraction.
- Enforce the post-extraction completion rule.
- Add orchestration and partial-result tests.

### Phase 3: Measurement and tuning

- Enable privacy-safe metrics.
- Measure false rejection and ambiguity rates using curated fixtures.
- Tune suspicious patterns and country-evidence thresholds.
- Update local disposable-domain and numbering metadata processes.

### Phase 4: Optional product surfaces

- Consider verification filters, badges, stored evidence, bulk re-verification, and export columns based on observed user demand.
- Any such renderer or persistence work requires a separate UI/data design review.

## 18. Risks and Mitigations

| Risk | User impact | Mitigation |
| --- | --- | --- |
| The model ignores the verification description | Raw contacts appear trusted | Enforce a runtime postcondition or automatic tool composition. |
| DNS providers time out or block requests | Valid emails appear uncertain | Return `unknown`, use bounded retries, and cache temporary results briefly. |
| Disposable-domain data becomes stale | Some temporary addresses are missed | Version the local list and keep its update mechanism replaceable. |
| Phone metadata becomes stale | New number ranges appear invalid | Version and update numbering-plan metadata; prefer `possible` when evidence is uncertain. |
| A global region leaks into parsing | Multinational numbers are corrupted | Prohibit site-wide defaults and test per-block isolation. |
| Tool results become too large | Chat slows down or loses context | Deduplicate, batch, summarize counts, and retain bounded structured evidence. |
| Users interpret `likely_valid` as reachable | Outreach decisions use overstated confidence | Include limitations in every result and prohibit deliverability/ownership language. |
| Verification repeats indefinitely | Latency and DNS traffic increase | Mark completed results and enforce repeat-prevention rules. |
| Contact values leak into logs | Privacy exposure | Redact values and log only counts/statuses. |

## 19. Future Considerations

The following are intentionally deferred and require separate product approval:

- optional paid verification adapters;
- SMTP mailbox probing;
- carrier or live line-status services;
- user-configurable verification depths;
- automatic scheduled re-verification;
- persistent verification history and freshness policies;
- verification badges and filters outside AI Chat;
- marketing-workflow policies based on verification status;
- user-managed disposable-domain allowlists and blocklists.

Any future deeper verification must preserve the Standard result semantics and clearly distinguish technical plausibility, deliverability, ownership, reachability, and consent.

## 20. Definition of Done

The feature is complete when:

1. Standard email and phone verification behavior meets every acceptance criterion.
2. `verify_contact_info` can be called directly and after contact extraction.
3. Extraction-to-verification handoff is enforced independently of model compliance.
4. Multinational and ambiguous phone fixtures prove that no site-wide default country is applied.
5. DNS failure fixtures prove that temporary failures do not become invalid contacts.
6. Tool, orchestration, safety, and regression tests pass.
7. No paid provider, SMTP probe, test message, call, or text is used.
8. Documentation states the verification limits in user-facing language.
9. Any UI text added during implementation is translated and tested.
10. Implementation follows the repository's main/worker process and Model/Module architecture rules.
