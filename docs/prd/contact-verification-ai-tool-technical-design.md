# Contact Verification AI Tool - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-08-21 |
| Status | Draft |
| Owner | aiFetchly engineering |
| Source PRD | [`contact-verification-ai-tool-prd.md`](./contact-verification-ai-tool-prd.md) |
| Primary code paths | `src/config/skillsRegistry.ts`, `src/config/aiTools.config.ts`, `src/service/ToolExecutor.ts`, `src/service/SkillExecutor.ts`, `src/service/ToolLoadPolicyService.ts`, `src/service/ToolCatalogService.ts`, `src/childprocess/contact-extraction/`, `src/schemas/worker/contactExtraction.ts` |

## 1. Purpose

This document translates the Contact Verification AI Tool PRD into an implementation design.

The feature adds a reusable AI-callable tool:

```text
verify_contact_info
```

It also makes Standard verification an automatic part of the existing `extract_contact_info` AI-tool path. The design uses local parsing, local data, and ordinary DNS. It does not use a paid verification provider, SMTP mailbox probing, test messages, phone calls, SMS, carrier lookup, or live-line lookup.

The implementation must preserve one distinction throughout its types and output:

```text
extracted value
    != structurally plausible contact
    != active mailbox or phone line
    != identified owner
    != permission to contact
```

## 2. Decision Summary

The implementation will use these decisions:

1. Add a standalone `verify_contact_info` built-in tool for contacts supplied by the user or returned by tools other than `extract_contact_info`.
2. Run the same verification engine automatically inside the contact-extraction worker's URL-only AI-tool path. Do not depend on the model to make a second call after extraction.
3. Return raw and verified data together from `extract_contact_info`; the model never receives a successful extraction result that labels raw values as verified.
4. Keep verification logic runtime-neutral so the main process and contact-extraction worker can both import it. The module must not import Electron, TypeORM, `Token`, or renderer code.
5. Use `libphonenumber-js/max` for phone parsing and type metadata, `validator` for practical email syntax validation, Node's `url.domainToASCII` for domains, and Node's `dns.promises` for mail-routing checks.
6. Treat phone-country evidence as contact-group data. Never accept a site-wide default region.
7. Use a dependency-injected DNS adapter and clock so tests never depend on public DNS or wall-clock timing.
8. Keep caches in memory only. Do not add a database entity or migration in the first release.
9. Redact contact values in the shared skill audit logger before exposing the direct AI tool.
10. Keep `AiChatV2.vue` unchanged unless later work adds a dedicated verification display.

## 3. Current System

### 3.1 Existing contact extraction

The current AI-tool path is:

```text
LLM calls extract_contact_info({ urls })
  -> SkillRegistry entry
  -> ToolExecutor.execute("extract_contact_info")
  -> ToolExecutor.executeContactExtraction()
  -> extractContactFromUrls()
  -> ContactExtractionWorker
  -> discoverAndExtractContactInfo(url)
  -> worker sends one extract-contact-url-result per URL
  -> UrlExtractionCollector
  -> ToolExecutor formats raw emails and phones
  -> AIChatQueryLoop sends tool_result to the model
```

`discoverAndExtractContactInfo()` currently returns flat email and phone arrays plus an optional address and social links. Its validation consists mainly of regular expressions. The result does not preserve the DOM block that contained each contact.

### 3.2 Existing worker boundary

The contact worker already performs browser navigation, AI-assisted page extraction, and regex fallback. It sends results to the main process and does not access the database in the URL-only AI-tool flow.

This design keeps that boundary:

```text
Worker may:
  - inspect rendered pages;
  - collect contact evidence;
  - run local parsing;
  - make DNS queries;
  - return structured results.

Worker may not:
  - open TypeORM repositories;
  - resolve the user database path;
  - save verification results.
```

### 3.3 Existing tool-list behavior

Specialized built-in tools are deferred unless the current message names the tool or matches a contextual intent rule. `ToolCatalogService` supports forced names, but `AIChatQueryLoop` currently filters each round without passing a verification-specific forced set.

Automatic verification inside the extraction worker avoids this failure mode for `extract_contact_info`. Direct verification still needs contextual promotion, catalog search hints, and the compact capabilities prompt.

### 3.4 Existing permission behavior

`SkillPermissionService` automatically permits only tools with `permissionCategory: "pure"`. The separate `requiresConfirmation` field does not override category-based permission checks.

Standard verification performs read-only local work plus DNS lookups. The PRD requires no second prompt after the user asks for contact verification or extraction. This design therefore registers the tool as `pure` and explicitly documents that email-domain DNS queries leave the local process. Introducing a new read-only-network permission category would require a broader permission and UI redesign and is outside this feature.

### 3.5 Existing logging risk

`SkillExecutor.auditLog()` currently records sanitized tool arguments. Its generic sanitizer truncates strings but does not redact `emails`, `phones`, `nearby_text`, or `address`. Registering the direct tool without changing this sanitizer would place contact data in normal logs.

Contact-key redaction is a release blocker.

## 4. Target Architecture

### 4.1 Component diagram

```text
                            AI Chat V2
                                |
                +---------------+---------------+
                |                               |
                v                               v
    verify_contact_info call        extract_contact_info call
                |                               |
                v                               v
 ContactVerificationAiTools          ContactExtractionWorker
                |                               |
                |                    ContactEvidenceExtractor
                |                               |
                +--------------+----------------+
                               v
                 ContactVerificationService
                    |                    |
                    v                    v
             EmailVerifier          PhoneVerifier
                    |                    |
                    v                    v
            DnsMailRouteResolver   libphonenumber-js
                    |
                    v
               node:dns
```

### 4.2 Process diagram

```text
Main process                                  Worker process
------------                                  --------------
AI gate
  |
  +-- direct verify tool
  |      -> shared verifier -> DNS
  |
  +-- extract tool
         -> send URL request ----------------> Puppeteer extraction
                                                -> contact evidence
                                                -> shared verifier -> DNS
                                                -> verified payload
         <------------------------------------ worker message
         -> format one tool result
```

The shared verifier is safe to import in either process because it has no Electron or database dependency.

### 4.3 Why extraction verification runs in the worker

The URL-only worker emits one result per URL, and partial snapshots are built from those messages. Verifying each URL before its worker message provides three useful properties:

- Full results are verified before they reach `ToolExecutor`.
- Partial snapshots already contain verification outcomes.
- DNS work overlaps with other URLs still being scraped under the existing bounded browser concurrency.

Running verification only after `extractContactFromUrls()` returns would add latency after the browser work and could lose verification when the outer browser timeout returns a partial snapshot.

### 4.4 Direct tool and automatic composition

The same engine has two entry points:

```text
Direct AI call:
  ContactVerificationAiTools.verify(args, context)
    -> AI enable gate
    -> Zod parse
    -> ContactVerificationService.verify()

Automatic extraction composition:
  ContactExtractionWorker.handleExtractContactFromUrls()
    -> discoverAndExtractContactInfo()
    -> ContactEvidenceExtractor.buildGroups()
    -> ContactVerificationService.verify()
    -> send raw + verified worker result
```

The worker does not call `SkillExecutor` or fabricate a model tool call. It composes the deterministic service directly. The separate AI tool remains available for pasted contacts, files, spreadsheets, and outputs from other tools.

## 5. Proposed Files

### 5.1 New production files

```text
src/entityTypes/contactVerificationTypes.ts
src/config/contactVerification.ts
src/config/contact-verification/disposableEmailDomains.ts
src/config/contact-verification/countryAliases.ts
src/service/contact-verification/ContactVerificationService.ts
src/service/contact-verification/EmailVerifier.ts
src/service/contact-verification/PhoneVerifier.ts
src/service/contact-verification/DnsMailRouteResolver.ts
src/service/contact-verification/ContactVerificationCache.ts
src/service/ContactVerificationAiTools.ts
src/childprocess/contact-extraction/ContactEvidenceExtractor.ts
```

### 5.2 Modified production files

```text
package.json
yarn.lock
src/config/skillsRegistry.ts
src/config/aiTools.config.ts
src/service/ToolExecutor.ts
src/service/SkillExecutor.ts
src/service/ToolLoadPolicyService.ts
src/service/ToolCatalogService.ts
src/service/BuiltInToolCapabilitiesPromptSection.ts
src/childprocess/contact-extraction/ContactDiscovery.ts
src/childprocess/contact-extraction/ContactExtractionWorker.ts
src/entityTypes/contactExtractionTypes.ts
src/schemas/worker/contactExtraction.ts
src/main-process/communication/urlExtractionCollector.ts
```

`urlExtractionCollector.ts` needs only type widening and fixture updates. It should not perform verification itself.

### 5.3 New and modified tests

```text
test/vitest/main/service/ContactVerificationAiTools.test.ts
test/vitest/main/service/ContactVerificationService.test.ts
test/vitest/main/service/EmailVerifier.test.ts
test/vitest/main/service/PhoneVerifier.test.ts
test/vitest/main/service/DnsMailRouteResolver.test.ts
test/vitest/main/service/SkillExecutorContactRedaction.test.ts
test/vitest/main/service/ToolLoadPolicyService.test.ts
test/vitest/main/service/ToolCatalogService.test.ts
test/vitest/main/service/ToolExecutor.test.ts
test/vitest/main/contactExtractionWorkerIpc.test.ts
test/vitest/main/contactExtractionRecovery.test.ts
test/vitest/utilitycode/schemas/contactExtractionWorker.test.ts
test/vitest/utilitycode/skillsRegistry.test.ts
```

No entity, Model, Module, migration, renderer component, or language-file change is required for the first release.

## 6. Dependencies

### 6.1 New direct runtime dependencies

Add these as direct production dependencies rather than relying on transitive lockfile entries:

| Dependency | Use | Import rule |
| --- | --- | --- |
| `libphonenumber-js` | Parse, validate, normalize, and classify phone numbers | Import from `libphonenumber-js/max` because number type and stricter metadata are required. |
| `validator` | Practical email syntax validation | Import only `isEmail` if the package export supports it; otherwise use the default module without `any`. |

The repository already has `@types/validator`, but not a direct `validator` runtime dependency. The implementation must add the runtime package explicitly.

### 6.2 Platform APIs

Use Node APIs already available in Electron's main and Node worker processes:

- `dns.promises.resolveMx`
- `dns.promises.resolve4`
- `dns.promises.resolve6`
- `url.domainToASCII`
- `crypto.createHash`

Do not import browser-only APIs or Electron APIs into the verification service.

### 6.3 Local data

Ship two versioned, compile-time data modules:

- disposable email domains;
- ISO country names and common aliases mapped to ISO 3166-1 alpha-2 codes.

Compile-time TypeScript modules are preferred to runtime filesystem reads because they work consistently in development, Vite bundles, and packaged ASAR builds.

Each data module must export a data version. Verification results include those versions so future re-verification can identify stale rules.

## 7. Public AI Tool Contract

### 7.1 Tool registration

Register the tool in `skillsRegistry.ts`:

```ts
{
  name: "verify_contact_info",
  description: CONTACT_VERIFICATION_TOOL_DESCRIPTION,
  parameters: CONTACT_VERIFICATION_TOOL_PARAMETERS,
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "pure",
  timeoutClass: "network",
  source: "built-in",
  execute: async (args, context) => {
    const result = await verifyContactInfoForAi(args, context);
    return { success: result.success, result };
  },
}
```

The proposed snippet is illustrative. The implementation must use the repository's exact `SkillDefinition` and return types.

Also add the same public function name, description, and JSON Schema to `aiTools.config.ts` for the legacy/static client-tool surface. Keep the schema and description in shared exported constants to prevent the two registrations from drifting.

### 7.2 Tool description

Use the description approved in the PRD. Keep these instructions near the beginning because catalog entries may shorten long descriptions:

```text
Validate and normalize email addresses and phone numbers using free Standard
checks. Use after any tool returns previously unverified emails or phones, and
before presenting, exporting, saving, or using them as verified contacts.
```

The full description must also state:

- no mailbox or live-line confirmation;
- no ownership, reachability, or consent claim;
- no site-wide phone region;
- preserve ambiguous values;
- pass same-contact-block evidence when available;
- avoid repeated verification of completed, current results.

### 7.3 External JSON input

The technical contract refines the PRD's conceptual context object into an evidence array. This prevents one free-form country string from being treated as authoritative without its source.

```ts
export const countryEvidenceSourceSchema = z.enum([
  "explicit_user",
  "structured_contact",
  "same_block_address",
  "same_block_heading",
  "same_block_text",
  "page_level",
  "site_domain",
  "headquarters",
  "campaign_country",
  "user_locale",
  "unknown",
]);

export const contactVerificationInputSchema = z.strictObject({
  contacts: z
    .array(
      z.strictObject({
        source_url: z.string().url().max(2048).optional(),
        emails: z.array(z.string().min(1).max(320)).max(50).default([]),
        phones: z.array(z.string().min(1).max(128)).max(50).default([]),
        context: z
          .strictObject({
            nearby_text: z.string().max(1500).optional(),
            address: z.string().max(1000).optional(),
            country_evidence: z
              .array(
                z.strictObject({
                  country: z.string().length(2),
                  source: countryEvidenceSourceSchema,
                  evidence_text: z.string().max(240).optional(),
                })
              )
              .max(8)
              .default([]),
          })
          .optional(),
      })
    )
    .min(1)
    .max(25),
});
```

Add a post-schema refinement that enforces:

- every group contains at least one email or phone;
- the full call contains at most 100 email and phone values combined;
- country codes are uppercased before use and must exist in phone metadata;
- duplicate values are allowed at input but deduplicated during execution.

Defaults shown above apply to parsed data. The LLM-facing JSON Schema should describe defaults but should not depend on the model sending empty arrays.

### 7.4 Internal TypeScript input

The runtime-neutral service uses camelCase types:

```ts
export type CountryEvidenceSource =
  | "explicit_user"
  | "structured_contact"
  | "same_block_address"
  | "same_block_heading"
  | "same_block_text"
  | "page_level"
  | "site_domain"
  | "headquarters"
  | "campaign_country"
  | "user_locale"
  | "unknown";

export interface CountryEvidence {
  readonly country: string;
  readonly source: CountryEvidenceSource;
  readonly evidenceText?: string;
}

export interface ContactVerificationGroup {
  readonly sourceUrl?: string;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly context?: {
    readonly nearbyText?: string;
    readonly address?: string;
    readonly countryEvidence: readonly CountryEvidence[];
  };
}

export interface ContactVerificationRequest {
  readonly contacts: readonly ContactVerificationGroup[];
}
```

Do not use `any` in schemas, adapters, DNS error handling, or tool results.

## 8. Result Contract

### 8.1 Status types

```ts
export type EmailVerificationStatus =
  | "likely_valid"
  | "role_based"
  | "risky"
  | "invalid"
  | "unknown";

export type PhoneVerificationStatus =
  | "likely_valid"
  | "context_resolved"
  | "ambiguous_region"
  | "possible"
  | "invalid"
  | "non_phone";

export type MailRoutingStatus =
  | "mx"
  | "implicit_address"
  | "null_mx"
  | "no_route"
  | "nxdomain"
  | "temporary_failure"
  | "resolver_failure"
  | "not_checked";
```

### 8.2 Per-email result

```ts
export interface EmailVerificationResult {
  readonly original: string;
  readonly normalized?: string;
  readonly status: EmailVerificationStatus;
  readonly checks: {
    readonly syntaxValid: boolean;
    readonly placeholder: boolean;
    readonly disposableDomain: boolean;
    readonly suspiciousLocalPart: boolean;
    readonly roleBased: boolean;
    readonly domainResolves: boolean | null;
    readonly mailRouting: MailRoutingStatus;
  };
  readonly reasons: readonly string[];
  readonly checkedAt: string;
  readonly rulesVersion: string;
}
```

`domainResolves: null` means the DNS check did not produce a stable answer. It must not be converted to `false`.

### 8.3 Per-phone result

```ts
export interface PhoneVerificationResult {
  readonly original: string;
  readonly normalized?: string;
  readonly extension?: string;
  readonly status: PhoneVerificationStatus;
  readonly country?: string;
  readonly countryConfidence?: "high" | "medium" | "low";
  readonly countryEvidence?: string;
  readonly numberType?:
    | "mobile"
    | "fixed_line"
    | "fixed_line_or_mobile"
    | "toll_free"
    | "premium_rate"
    | "voip"
    | "unknown";
  readonly reasons: readonly string[];
  readonly checkedAt: string;
  readonly rulesVersion: string;
}
```

### 8.4 Top-level result

```ts
export interface ContactVerificationResult {
  readonly success: boolean;
  readonly verificationDepth: "standard";
  readonly verificationPerformed: true;
  readonly partial: boolean;
  readonly limitations: readonly string[];
  readonly summary: {
    readonly inputEmails: number;
    readonly inputPhones: number;
    readonly uniqueEmails: number;
    readonly uniquePhones: number;
    readonly likelyValid: number;
    readonly needsReview: number;
    readonly invalid: number;
    readonly unknown: number;
  };
  readonly contacts: readonly ContactVerificationGroupResult[];
  readonly dataVersions: {
    readonly rules: string;
    readonly disposableDomains: string;
    readonly phoneMetadata: string;
  };
}
```

The AI adapter converts internal camelCase keys to the snake_case JSON contract from the PRD. Internal types should not use duplicate snake_case properties.

### 8.5 Extraction result

Extend each successful URL result without removing existing fields:

```ts
export interface VerifiedUrlContactExtractionData {
  readonly emails?: readonly string[];
  readonly phones?: readonly string[];
  readonly address?: string | null;
  readonly socialLinks?: readonly string[] | null;
  readonly verification: ContactVerificationResult;
  readonly verificationRequired: false;
  readonly verificationPerformed: true;
}
```

The worker's raw intermediate object may temporarily use `verificationRequired: true`, but that object must not be serialized to the model. After the worker runs verification, the public extraction result is completed and sets it to false.

If an unexpected verifier failure occurs, synthesize `unknown` results for every input and return:

```text
verificationPerformed = true
partial = true
verificationRequired = false
```

The extraction itself remains successful. The limitation explains that Standard checks could not complete. This is safer than returning raw contacts with no status or failing the entire scrape.

## 9. Email Verification Design

### 9.1 Pipeline

```text
raw email
  -> conservative wrapper cleanup
  -> split local part and domain
  -> domainToASCII + lowercase domain
  -> validator.isEmail
  -> placeholder / role / suspicious rules
  -> disposable-domain lookup
  -> DNS mail-route lookup
  -> primary status precedence
  -> reasons + checks
```

### 9.2 Conservative cleanup

Cleanup may remove:

- surrounding whitespace;
- a leading `mailto:` prefix;
- balanced display wrappers such as `<address@example.com>`;
- trailing punctuation that cannot be part of the parsed address.

Cleanup must not remove characters from the middle of an address or rewrite the local part to make invalid input pass.

The original string is always retained.

### 9.3 Domain normalization

Steps:

1. Split at the final `@` after conservative cleanup.
2. Convert the domain with `domainToASCII()`.
3. Reject an empty conversion.
4. Lowercase the ASCII domain.
5. Preserve the local part's display case.
6. Build `normalized = localPart + "@" + asciiDomain`.

Use a lowercased full normalized key only for deduplication. Return the first observed original spelling and attach all source groups internally.

### 9.4 Syntax validation

Use `validator.isEmail()` with explicit options committed in configuration. The intended Standard profile is:

- require a domain;
- disallow display names;
- allow UTF-8 local parts only if the chosen package and downstream result serialization handle them consistently;
- enforce practical total and component lengths;
- reject IP-literal domains in the first release;
- reject localhost and single-label domains.

Do not implement a large RFC email grammar with a new regular expression.

### 9.5 Local rule sets

Keep versioned sets for:

- placeholder domains and local parts;
- role-based local parts;
- suspicious local-part patterns;
- disposable domains.

Example role local parts include `info`, `sales`, `support`, `contact`, and `admin`. Role-based is a descriptive classification, not a rejection.

Example placeholder signals include `example.com`, `example.org`, `test`, `yourname`, and obvious repeated characters. Placeholder results are `invalid` when the value clearly cannot represent a real contact.

Disposable domains and suspicious-but-plausible local parts are `risky` unless a stronger invalid condition applies.

### 9.6 DNS adapter

Define an injectable adapter:

```ts
export interface DnsMailRouteAdapter {
  resolveMx(domain: string): Promise<readonly MxRecord[]>;
  resolve4(domain: string): Promise<readonly string[]>;
  resolve6(domain: string): Promise<readonly string[]>;
}

export interface DnsMailRouteResult {
  readonly status: MailRoutingStatus;
  readonly domainResolves: boolean | null;
  readonly retryable: boolean;
}
```

The production adapter wraps `dns.promises`. Tests inject a fake adapter.

### 9.7 DNS decision table

| MX result | Address fallback | Output | Email consequence |
| --- | --- | --- | --- |
| One or more usable MX records | Not needed | `mx` | Routing evidence passes. |
| Explicit null MX (`exchange === "."`) | Not used | `null_mx` | `invalid`. |
| `ENODATA` / no MX | A or AAAA exists | `implicit_address` | Routing passes with a lower-confidence reason. |
| `ENODATA` / no MX | No A or AAAA | `no_route` | `invalid`. |
| `ENOTFOUND` / `NXDOMAIN` | Not used | `nxdomain` | `invalid`. |
| Timeout, `SERVFAIL`, temporary refusal | Not used | `temporary_failure` | `unknown`. |
| Unclassified resolver error | Not used | `resolver_failure` | `unknown`. |

The error mapper accepts `unknown`, checks for an object with a string `code`, and never casts caught errors to `any`.

### 9.8 Timeouts and retry

Node DNS promises do not consistently support cancellation across target runtimes. Wrap each lookup in a timeout race:

- per DNS operation: 3 seconds;
- one retry for temporary failures only;
- no retry for `NXDOMAIN`, null MX, or no-data answers;
- clear every timer in `finally`;
- attach a rejection handler to a late DNS promise so it cannot become unhandled.

The service checks the tool `AbortSignal` before starting each new lookup and between retry attempts. An already-running native DNS call may finish in the background, but it must not keep a tool timer or result mutation alive.

### 9.9 Email classification precedence

Apply one deterministic precedence order:

1. Invalid syntax, placeholder, `NXDOMAIN`, null MX, or no route -> `invalid`.
2. Temporary or unknown DNS outcome -> `unknown`.
3. Disposable domain or suspicious local part -> `risky`.
4. Role-based local part with valid routing -> `role_based`.
5. Valid syntax and supported routing -> `likely_valid`.

Secondary flags remain visible even when a higher-precedence status wins.

## 10. Phone Verification Design

### 10.1 Pipeline

```text
raw phone
  -> Unicode normalization
  -> extract extension
  -> non-phone heuristics
  -> detect explicit international prefix
  -> select strong country evidence, if needed
  -> libphonenumber parse
  -> possible / valid / type checks
  -> safe E.164 normalization or preserve original
  -> status + reasons
```

### 10.2 Character normalization

Normalize:

- full-width digits through Unicode NFKC;
- Arabic-Indic and Eastern Arabic-Indic digits through explicit code-point maps;
- non-breaking spaces to ordinary spaces;
- supported extension markers into a separate extension value.

Keep `+`, parentheses, spaces, hyphens, and periods until parsing. Do not strip all non-digits before checking whether the input is a date, price, ID, or extension-bearing value.

### 10.3 Non-phone heuristics

Before phone parsing, reject or downgrade values matching strong non-phone shapes:

- ISO and locale date patterns;
- time and timestamp patterns;
- currency-prefixed numeric values;
- postal/ZIP formats when context labels them as postal data;
- order, tracking, SKU, registration, or account IDs when nearby labels say so;
- repeated single-digit placeholders;
- too few or too many digits for an international phone number.

Context labels may strengthen a non-phone result. They must not turn an impossible number into a valid number.

### 10.4 Explicit international numbers

Treat these as explicit in the first release:

- leading `+`;
- leading `00`, converted to `+` before parsing.

Other outbound dialing prefixes require a known origin country and therefore use the national/context path.

Parse explicit numbers without a default country. Return E.164 only when parsing succeeds and metadata reports a possible number. Use `isValid()` for `likely_valid`; use `possible` when the length is plausible but assigned-range validation fails.

### 10.5 Country evidence policy

Strong evidence sources:

```text
explicit_user
structured_contact
same_block_address
same_block_heading
same_block_text
```

Weak sources that never authorize normalization by themselves:

```text
page_level
site_domain
headquarters
campaign_country
user_locale
unknown
```

Algorithm:

1. Discard weak evidence for parsing decisions but retain it for reasons.
2. Normalize strong country codes to uppercase.
3. If there is exactly one distinct strong country, parse using that country.
4. If there are two or more distinct strong countries, return `ambiguous_region` and omit E.164.
5. If there is no strong country and the number is not explicit international format, return `ambiguous_region` when the digit count is phone-like; otherwise return `invalid` or `non_phone`.

The first release does not brute-force a national number across every country. That approach creates false confidence because many national strings are valid in several numbering plans.

### 10.6 Country-name extraction

`ContactEvidenceExtractor` may convert an explicit country name in the same DOM block to an ISO code using the local alias table. It may also use an ISO code from structured data such as `addressCountry`.

The first release does not infer a country from a city name alone. A global city database adds ambiguity and maintenance cost. City-only inference can be added later with a separately evaluated data source.

### 10.7 Phone classification

| Condition | Status | Normalized value |
| --- | --- | --- |
| Explicit international number is valid | `likely_valid` | E.164 included. |
| National number is valid under one strong country | `context_resolved` | E.164 included. |
| No strong country or conflicting strong countries | `ambiguous_region` | Omitted. |
| Parsed number is possible but not valid | `possible` | Included only when parsing did not require a disputed country. |
| Number is impossible under an explicit/supported interpretation | `invalid` | Omitted. |
| Strong non-phone heuristic matches | `non_phone` | Omitted. |

### 10.8 Number type

Map `libphonenumber-js/max` types into the stable public enum. Unknown library values map to `unknown`. The mapping layer prevents a dependency update from changing the public tool contract.

Labels such as fax or WhatsApp come from page evidence, not numbering metadata. Keep evidence labels separate from the metadata-derived number type.

## 11. Contact Evidence Extraction

### 11.1 Goal

The current flat arrays do not prove that an address belongs to a particular phone. The worker must capture per-value evidence before the page closes.

### 11.2 Evidence sources

Collect candidates in this order:

1. JSON-LD `Organization`, `LocalBusiness`, `ContactPoint`, and postal-address objects.
2. `mailto:` and `tel:` anchors.
3. Exact rendered-text matches for AI-returned values.
4. Regex matches in rendered text for fallback extraction.

For DOM values, find the nearest bounded semantic container from:

```text
address, article, section, li, footer, [itemscope],
[class*="contact"], [class*="office"], [class*="location"]
```

Cap captured nearby text at 1,500 characters and evidence text at 240 characters before it leaves the worker.

### 11.3 Evidence scope

Evidence is strong only when:

- the contact and country appear in the same JSON-LD object; or
- the contact and address/country heading appear in the same selected DOM container.

A page-wide address, page language, domain suffix, or organization headquarters remains weak. Do not upgrade it because the page has only one visible phone number.

### 11.4 Proposed extraction type

```ts
export interface ExtractedContactEvidence {
  readonly kind: "email" | "phone";
  readonly value: string;
  readonly nearbyText?: string;
  readonly address?: string;
  readonly labels: readonly string[];
  readonly countryEvidence: readonly CountryEvidence[];
}
```

Extend `ContactInfo` and the worker outbound schema with:

```ts
readonly contactEvidence?: readonly ExtractedContactEvidence[];
```

Keep existing `emails`, `phones`, `address`, and `socialLinks` fields for compatibility.

### 11.5 Building verification groups

For each extracted value:

- use its matching evidence record when present;
- otherwise create a group with the source URL and no country evidence;
- never attach the legacy page-level `address` as strong phone evidence;
- deduplicate repeated value/evidence pairs before verification.

Email values can share domain checks across groups. Phone values retain their own evidence even when the original strings match, because the same national string can mean different things in different offices.

## 12. Service Design

### 12.1 Main service

```ts
export interface ContactVerificationServiceDeps {
  readonly dnsResolver: DnsMailRouteResolver;
  readonly cache: ContactVerificationCache;
  readonly now: () => Date;
}

export interface ContactVerificationOptions {
  readonly signal?: AbortSignal;
  readonly emitProgress?: (event: ContactVerificationProgress) => void;
}

export class ContactVerificationService {
  constructor(deps?: Partial<ContactVerificationServiceDeps>);

  verify(
    request: ContactVerificationRequest,
    options?: ContactVerificationOptions
  ): Promise<ContactVerificationResult>;
}
```

The default constructor creates production dependencies. Tests inject all nondeterministic dependencies.

### 12.2 Execution phases

1. Validate service-level limits defensively.
2. Build stable deduplication indexes.
3. Verify unique emails with bounded concurrency.
4. Verify phones locally in input order.
5. Project unique results back to every group.
6. Compute summary counters.
7. Return a completed or partial result without raw-input logging.

### 12.3 Bounded concurrency

Reuse `mapWithConcurrency()` from `src/utils/concurrency.ts` for email-domain work. Catch inside each mapper so one domain failure cannot reject the entire map.

Initial limits:

| Limit | Value |
| --- | ---: |
| Contact groups per call | 25 |
| Total email + phone values | 100 |
| Email values per group | 50 |
| Phone values per group | 50 |
| Concurrent unique-domain DNS checks | 8 |
| DNS operation timeout | 3 seconds |
| Overall service soft deadline | 30 seconds |
| Progress event interval | At most 4 per second |

These values belong in `src/config/contactVerification.ts`, not scattered literals.

### 12.4 Progress

For direct tool calls, emit phases through `SkillExecutionContext.emitProgress`:

```text
validating
checking_email_domains
checking_phones
finalizing
```

Worker-composed verification does not need a second renderer tool card. It can fold verification progress into the existing per-URL extraction progress message.

### 12.5 Partial results

The service must resolve with partial results rather than reject after any work completes.

- Completed contacts keep their final classifications.
- Contacts skipped because of cancellation or deadline become `unknown` for email and `possible` or `ambiguous_region` for phone, based on completed local checks.
- `partial` becomes true.
- Reasons state which check did not finish.

Only invalid top-level input should return `success: false` with no contact results.

## 13. Cache Design

### 13.1 Scope

Use process-local bounded maps. The main process and worker maintain separate caches. No cache data is persisted.

### 13.2 Domain cache

Key:

```text
lowercase ASCII domain
```

Value:

```ts
interface CachedMailRoute {
  readonly result: DnsMailRouteResult;
  readonly expiresAt: number;
}
```

Initial expiration policy:

| Result | Lifetime |
| --- | ---: |
| `mx`, `implicit_address` | 15 minutes |
| `null_mx`, `no_route`, `nxdomain` | 5 minutes |
| temporary/resolver failure | 30 seconds |

Cap the map at 1,000 domains. On overflow, remove expired entries first, then the oldest inserted entries. A simple bounded `Map` is sufficient; do not add an LRU package for this feature.

### 13.3 Phone cache

Phone parsing is inexpensive. Cache only within one verification call through the deduplication index. Do not add a process-global phone cache containing user inputs.

### 13.4 Verification fingerprint

Build a SHA-256 fingerprint from:

- the cleaned contact value;
- strong country evidence codes and sources;
- verification depth;
- rules version;
- disposable-domain data version;
- phone metadata version.

Return the fingerprint only if a downstream repeat-prevention use case needs it. Do not log it together with a raw value.

## 14. AI Gate, Permission, and Execution

### 14.1 AI enable check

`ContactVerificationAiTools.verify()` must check AI enablement before parsing arguments:

```ts
const enabled = new Token().getValue(USER_AI_ENABLED) === "true";
if (!enabled) {
  return {
    success: false,
    error: "AI features are not enabled on this plan.",
  };
}
```

`ToolExecutor.executeContactExtraction()` must retain or add the same early gate before reading URLs or spawning the worker. The worker continues to receive `WORKER_AI_ENABLED` from the main process.

The shared deterministic service does not import `Token`. This keeps it usable in the child process. The authorized caller owns the AI gate.

### 14.2 Permission category

Register `verify_contact_info` as:

```text
requiresConfirmation: false
permissionCategory: pure
```

Rationale:

- the user explicitly supplied contacts or requested extraction;
- verification does not modify a remote system;
- the PRD requires no second confirmation;
- the current permission service has no read-only-network category.

Trade-off: MX/A/AAAA queries disclose email domains to the machine's configured DNS resolver. The user-facing limitation and security documentation must say this plainly.

### 14.3 Timeout class

Use `timeoutClass: "network"` for direct calls. The query-loop ceiling is 90 seconds, while the verifier has its own 30-second soft deadline and returns partial outcomes.

Extraction keeps its browser/async routing. Verification runs before each worker result, so the existing extraction collector and partial snapshot receive verified payloads.

### 14.4 ToolExecutor routing

Add a direct switch case for legacy and compatibility execution:

```text
verify_contact_info -> executeContactVerification()
```

The SkillRegistry definition may call `ContactVerificationAiTools` directly, but `ToolExecutor` still needs the case because `aiTools.config.ts` and older execution paths can dispatch by name.

Use one shared function for both routes so behavior cannot diverge.

## 15. Automatic Extraction Integration

### 15.1 Worker flow

Change only the URL-only branch used by the AI tool:

```text
handleExtractContactFromUrls(url)
  -> discoverAndExtractContactInfo(url)
  -> build evidence groups from rendered-page evidence
  -> ContactVerificationService.verify(groups)
  -> attach verification result
  -> process.send(extract-contact-url-result)
```

The DB-backed `extract-contact` queue may preserve current persistence behavior in this release. It can reuse the verification result later, but adding stored verification columns requires a separate data-design decision.

### 15.2 Failure isolation

If scraping succeeds but verification throws unexpectedly:

1. Catch the error inside the URL mapper.
2. Convert every raw email to `unknown` and every national phone to `ambiguous_region` unless an already completed local rule proves `invalid` or `non_phone`.
3. Set `verification.partial = true`.
4. Keep the URL result `success = true`.
5. Return a generic limitation without stack paths or raw contact values.

If scraping fails, preserve the existing failed URL behavior and do not invoke verification with an empty group.

### 15.3 Worker schema

Extend `contactExtractionWorkerOutboundSchema` with typed optional evidence and verification fields. Do not replace typed fields with `z.unknown()`.

The schema remains the source for `ContactExtractionWorkerOutbound`. Update worker protocol tests for:

- verified successful result;
- partial verification result;
- raw compatibility result during migration;
- malformed status/evidence rejection.

### 15.4 Migration compatibility

During one release window, the main process should accept an older worker result with no `verification` field and run the shared verifier in the main process as a compatibility fallback. This protects development and packaged builds where worker/main bundles are temporarily mismatched.

Fallback rules:

- do not use the legacy page-level address as strong country evidence;
- preserve national phones as ambiguous when no contact evidence exists;
- attach the same completed result shape;
- emit a privacy-safe warning containing counts and worker version, not contacts.

Remove the compatibility fallback after packaged-worker verification confirms both bundles always upgrade together.

## 16. Tool Discovery and Prompting

### 16.1 Contextual intent

Add `verify_contact_info` to a contextual verification set in `ToolLoadPolicyService`.

Use an intent expression that requires a verification action near a contact noun:

```text
verify|validate|check|clean|normalize|classify
    near
email|mail address|phone|telephone|mobile|contact
```

Avoid promoting the tool for generic questions such as "how does email work?" or "what is phone verification?".

### 16.2 Catalog search hints

Add these hints in `ToolCatalogService`:

```text
verify email
validate email
check phone
normalize phone
clean contacts
contact quality
invalid contacts
disposable email
phone region
```

### 16.3 Capabilities prompt

Replace the existing extraction-only row with a grouped capability:

```text
| Browse/scrape result URLs; extract or verify contacts; validate or normalize
email and phone values | scrape_urls_from_search_engine,
extract_contact_info, verify_contact_info, read_url_content |
scrape extract verify validate email phone contact normalize |
```

### 16.4 Extraction description

Keep the PRD's postcondition in the `extract_contact_info` description even though the runtime composes verification automatically. It teaches the model that the nested verification result is authoritative and tells it not to call the verifier again.

Add one sentence:

```text
The extraction result already includes Standard verification when contacts are
found; do not call verify_contact_info again for results marked
verification_performed: true.
```

## 17. Logging, Privacy, and Security

### 17.1 Skill audit redaction

Update `SkillExecutor.sanitizeForLog()` before registering the tool.

Treat these normalized keys as contact-sensitive:

```text
email, emails, phone, phones, nearbytext, address,
countryevidence, evidencetext, contacts
```

For contact arrays and groups, log counts instead of values:

```json
{
  "contacts": "[REDACTED_CONTACT_GROUPS count=3]",
  "emails": "[REDACTED_CONTACTS count=8]",
  "phones": "[REDACTED_CONTACTS count=4]"
}
```

Do not hash raw contacts into normal logs. Low-entropy phone numbers and common addresses are vulnerable to guessing.

### 17.2 Service logging

Allowed fields:

- tool call ID;
- batch counts;
- unique-domain count;
- status counts;
- cache hit count;
- duration;
- partial/cancelled flag;
- resolver error category.

Forbidden fields:

- raw or normalized emails;
- raw or normalized phones;
- local parts;
- nearby text;
- postal addresses;
- source URLs with query strings;
- DNS response hostnames when they expose customer-specific infrastructure.

### 17.3 Source URLs

When metrics need origin grouping, log only a normalized hostname after removing credentials and query/fragment data. Do not log full source URLs from tool input.

### 17.4 Prompt injection boundary

`nearby_text`, address text, and evidence text are untrusted webpage data. They are data fields, not instructions.

- The deterministic verifier must never evaluate them as prompts.
- Only country alias matching and label heuristics may inspect them.
- Cap lengths before worker IPC.
- Do not append raw nearby text to system messages or tool descriptions.
- Return a short evidence reason rather than echoing the full block.

### 17.5 DNS privacy

DNS verification queries only the email domain, never the local part. Phone verification performs no network request.

Do not query:

- SMTP servers directly;
- `_` service records unrelated to mail routing;
- phone or carrier endpoints;
- third-party HTTP verification APIs.

## 18. Error Model

### 18.1 Stable error codes

```ts
export type ContactVerificationErrorCode =
  | "INVALID_INPUT"
  | "LIMIT_EXCEEDED"
  | "AI_DISABLED"
  | "DNS_TIMEOUT"
  | "DNS_TEMPORARY_FAILURE"
  | "DNS_RESOLVER_FAILURE"
  | "DATA_LOAD_FAILURE"
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "INTERNAL_ERROR";
```

Per-item failures use codes and safe reasons. Top-level `success: false` is reserved for an invalid request, disabled AI access, or failure before any item can be classified.

### 18.2 DNS mapping

Map platform-specific DNS codes in one adapter. Unknown codes become `DNS_RESOLVER_FAILURE`, not `nxdomain`.

### 18.3 Cancellation

Cancellation rules:

- check `signal.aborted` before validation work, each DNS task, each retry, and final projection;
- stop scheduling new DNS work;
- retain completed items;
- mark unfinished items with safe uncertain statuses;
- clear all timers;
- never send a late worker result after the request collector has settled.

### 18.4 Error serialization

Use short user-facing messages. Do not return full stacks to the model for expected DNS or validation errors. Internal unexpected errors may use the existing short-stack mechanism only after contact values and filesystem paths are removed.

## 19. Performance Design

### 19.1 Expected cost

Phone checks and email syntax checks are CPU-local. DNS dominates latency.

For a typical five-URL extraction batch:

- duplicate email domains share one DNS lookup;
- up to eight unique domains resolve concurrently;
- verification runs per URL before its worker message;
- other browser jobs can continue while one URL performs DNS work.

### 19.2 Result size

Prevent result growth through:

- maximum 100 input values;
- maximum five reasons per contact;
- maximum 160 characters per reason;
- no echoed nearby-text block;
- summary counters at the top level;
- deduplicated domain checks;
- stable output ordering.

Do not drop per-contact checks merely to reduce tokens. If the result would exceed the tool-result limit, split direct verification into batches and return continuation metadata.

### 19.3 Browser impact

Verification must not open another browser or keep a page alive after evidence capture. `ContactEvidenceExtractor` runs before `page.close()`, copies only bounded strings, and releases DOM references immediately.

## 20. Observability

Emit privacy-safe structured events:

```text
contact_verification_started
contact_verification_completed
contact_verification_partial
contact_verification_cancelled
contact_verification_dns_failure
contact_extraction_verification_fallback
```

Common dimensions:

```text
source = direct_tool | extract_contact_info
email_count
phone_count
unique_domain_count
status_counts
cache_hits
duration_ms
partial
```

Do not include raw contacts or full URLs.

Track the product invariant:

```text
successful extraction results with email/phone
------------------------------------------------
successful extraction results with verification
```

Alert or test-fail when the denominator is nonzero and a result leaves the tool executor without `verificationPerformed: true`.

## 21. Testing Strategy

### 21.1 EmailVerifier unit tests

Use table-driven fixtures for:

- ordinary ASCII addresses;
- internationalized domain conversion;
- malformed local/domain parts;
- leading/trailing wrappers;
- `mailto:` input;
- placeholder and example addresses;
- role-based addresses;
- disposable domains;
- suspicious local parts;
- case-preserving output and case-insensitive deduplication;
- maximum lengths;
- IP literals and single-label domains.

### 21.2 DNS resolver tests

Inject a fake adapter. Cover:

- usable MX;
- multiple MX records;
- null MX;
- no MX plus IPv4 fallback;
- no MX plus IPv6 fallback;
- no route;
- `NXDOMAIN`;
- timeout;
- `SERVFAIL`;
- refusal;
- unknown error code;
- retry exactly once for temporary failures;
- timer cleanup;
- cache lifetime and eviction.

No automated test may depend on public DNS.

### 21.3 PhoneVerifier unit tests

Use deterministic fixtures from several numbering plans. Cover:

- `+` international format;
- `00` international format;
- national number with one strong country;
- same national string under different group evidence;
- conflicting strong countries;
- weak campaign/site/locale evidence only;
- no region evidence;
- extensions;
- Unicode digits;
- fixed-line, mobile, toll-free, VoIP, and unknown type mappings;
- possible but not valid values;
- impossible lengths;
- dates, timestamps, prices, postal codes, IDs, and repeated-digit placeholders.

### 21.4 Contact evidence tests

Test fixtures containing:

- two offices in different countries on one page;
- JSON-LD with separate `ContactPoint` objects;
- `tel:` links inside address blocks;
- one page-level headquarters address plus a foreign office number;
- footer contacts without a country;
- AI-returned values that can and cannot be matched back to rendered text;
- malicious instruction-like nearby text;
- overlong blocks that require truncation.

The main assertion is isolation: evidence from office A never appears on office B's number.

### 21.5 AI tool tests

Cover:

- AI-disabled return occurs before Zod parsing;
- email-only, phone-only, and mixed calls;
- batch limits;
- snake_case adapter mapping;
- progress emission;
- cancellation;
- partial results;
- permission-free execution;
- contact argument redaction in audit logs;
- no raw contacts in expected error logs.

### 21.6 Extraction integration tests

Cover:

- extraction with no email/phone skips verification;
- email-only result includes verification;
- phone-only result includes verification;
- multinational evidence stays isolated;
- verifier failure yields partial uncertain classifications without failing extraction;
- timeout partial snapshot contains verification;
- old-worker compatibility fallback;
- worker schema rejects malformed verification data;
- no direct database access is imported into the worker dependency graph.

### 21.7 Tool discovery tests

Cover:

- "verify these emails" promotes the tool;
- "normalize these phone numbers" promotes the tool;
- generic email questions do not promote it;
- catalog search finds verification synonyms;
- capabilities prompt names both extraction and verification;
- extraction description says completed results must not be re-verified.

### 21.8 Regression commands

Run at minimum:

```bash
yarn testmain
yarn vitest-puppeteer
yarn typecheck
yarn vue-typecheck
```

Run `yarn test:components` only if a renderer-facing change is introduced. Run focused Vitest files during implementation before the broader suites.

## 22. Implementation Sequence

### Phase 1: Contracts and local algorithms

1. Add direct dependencies and configuration constants.
2. Add Zod schemas and TypeScript result types.
3. Implement phone preprocessing and parsing.
4. Implement email cleanup, syntax checks, and local rule sets.
5. Implement the DNS adapter, timeout wrapper, and cache.
6. Add local algorithm tests.

Completion gate:

- all service tests pass;
- temporary DNS failures never map to invalid;
- weak phone-country evidence never produces E.164.

### Phase 2: Direct AI tool

1. Add `ContactVerificationAiTools` with the AI gate first.
2. Register the tool in both tool-definition surfaces.
3. Add ToolExecutor compatibility routing.
4. Add audit-log contact redaction.
5. Add contextual loading, search hints, and capabilities prompt.
6. Add tool and discovery tests.

Completion gate:

- direct calls work without a permission prompt;
- logs contain counts but no contacts;
- the tool is found from natural user phrasing.

### Phase 3: Extraction evidence and automatic composition

1. Add bounded contact evidence capture before browser close.
2. Extend extraction and worker protocol types.
3. Run shared verification in the URL-only worker branch.
4. Add main-process compatibility fallback.
5. Include verification in extraction summaries and partial snapshots.
6. Add multinational and timeout integration tests.

Completion gate:

- every successful URL result containing an email or phone has a verification result;
- no site-wide country inference exists;
- partial extraction results remain verified or explicitly uncertain.

### Phase 4: Packaging and rollout checks

1. Verify new dependencies and data modules are present in development and packaged workers.
2. Run packaged-child-process layout verification.
3. Test Windows, macOS, and Linux DNS error mappings.
4. Confirm no native rebuild is required for the new dependencies.
5. Enable privacy-safe counters.

## 23. Alternatives Considered

### 23.1 Prompt-only chaining

Rejected as the correctness mechanism.

Adding "always call verification" to both tool descriptions improves selection, but models can ignore it, local providers may not support tools consistently, and deferred loading can hide the verifier. Prompt text remains useful guidance but cannot guarantee the product invariant.

### 23.2 Query-loop forced second tool call

Not selected for the first release.

The query loop could force `verify_contact_info` after extraction, but it would need to synthesize or constrain a second OpenAI tool call, preserve exact tool-call IDs, handle providers that ignore `tool_choice`, prevent final text before verification, and resume correctly through permission and retry states. Worker composition is smaller and works across providers.

### 23.3 Main-process verification after the full extraction batch

Rejected.

This adds serial latency after scraping and leaves the current timeout partial-snapshot path with raw results. Per-URL worker verification overlaps work and keeps partial results classified.

### 23.4 SMTP probing

Rejected.

It is frequently blocked, can misclassify catch-all and protected servers, leaks more information, risks sender/IP reputation, and exceeds Standard verification.

### 23.5 Paid provider adapter

Deferred by product scope. The public result contract leaves room for future depth/provider metadata without adding a provider in this release.

### 23.6 Site-wide default country

Rejected.

Multinational sites commonly list several offices. Campaign, locale, headquarters, domain suffix, and page language are not safe evidence for a specific phone.

### 23.7 Brute-force every national number across all countries

Rejected.

Many strings satisfy multiple numbering plans. Returning one of those interpretations would create fabricated confidence and expensive candidate processing.

### 23.8 Database-backed verification cache

Deferred.

The first release does not need history, scheduling, or cross-session freshness. In-memory domain caching removes repeated DNS work without a migration or new personal-data retention surface.

### 23.9 New read-only-network permission category

Deferred.

It would be a cleaner description of DNS behavior, but it affects permission services, UI copy, translations, tests, and other tools. The first release uses `pure`, discloses DNS behavior, and performs no remote mutation.

## 24. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Contact data enters audit logs | Add key-aware redaction before tool registration and test serialized logs. |
| DNS error codes differ by OS | Centralize mapping, keep unknown failures uncertain, and test platform-shaped fixtures. |
| Worker bundle imports Electron accidentally | Keep verifier runtime-neutral and add dependency-graph/package smoke tests. |
| Disposable-domain data becomes stale | Version the list and make it a replaceable data module. |
| Phone metadata becomes stale | Expose metadata version and update the dependency through normal releases. |
| DOM evidence joins the wrong office | Require same JSON-LD object or bounded DOM container and test multi-office fixtures. |
| Existing worker/main bundles disagree | Accept missing verification temporarily and verify in main without using page-wide country evidence. |
| DNS slows browser completion | Limit concurrency/timeouts, cache by domain, and run verification per URL while other browser jobs continue. |
| Users read likely-valid as reachable | Include fixed limitations in every tool result and forbid deliverability language. |
| Result payload becomes large | Enforce item/reason limits and split direct bulk calls into batches. |

## 25. PRD Traceability

| PRD requirement | Technical implementation |
| --- | --- |
| FR-1 to FR-3: reusable tool and input | Shared Zod contract, `ContactVerificationAiTools`, registry and legacy tool definitions. |
| FR-4 to FR-7: email checks | `EmailVerifier`, versioned local rules, injected DNS resolver, and deterministic status precedence. |
| FR-8 to FR-11: phone checks | Unicode preprocessing, `libphonenumber-js/max`, strong evidence allowlist, and no global region. |
| FR-12: structured output | Stable internal interfaces plus a snake_case AI-result adapter. |
| FR-13 and FR-14: enforced extraction handoff | Runtime-managed worker composition completes verification before the extraction result is serialized. Because no raw result reaches the model, there is no required second model round. The standalone tool remains discoverable for every other contact source. |
| FR-15: repeat prevention | Completed marker, rules/data versions, and optional verification fingerprint. |
| FR-16: deferred discovery | Contextual intent rule, catalog hints, capabilities prompt, and synchronized descriptions. |
| FR-17: batch handling | Zod limits, stable deduplication, bounded DNS concurrency, progress, cancellation, and partial outcomes. |
| FR-18: AI gate | Caller-level `Token` and `USER_AI_ENABLED` checks before parsing or worker dispatch. |
| FR-19: errors | Stable codes, item isolation, temporary DNS mapping, and safe serialization. |

The FR-13 implementation uses the PRD's preferred runtime-managed execution option. It intentionally does not fabricate a second assistant tool call or unmatched OpenAI `tool` message.

## 26. Definition of Done

Implementation is complete when:

1. `verify_contact_info` is independently callable from AI Chat V2 and legacy-compatible tool paths.
2. The direct AI gate runs before argument parsing.
3. The tool performs Standard email and phone checks without paid services, SMTP, calls, or messages.
4. `extract_contact_info` returns verification for every successfully extracted email and phone.
5. Timeout partial snapshots contain verified or explicitly uncertain contact results.
6. National phones receive E.164 only from explicit international format or one strong same-contact-group country.
7. Weak country hints cannot authorize normalization.
8. Temporary DNS failures return `unknown`, never `invalid`.
9. Raw contacts and context do not appear in normal logs or telemetry.
10. The worker imports no Electron, TypeORM, Model, or database-path code through the verifier.
11. Tool descriptions, contextual promotion, catalog hints, and capabilities prompt agree on when to use the tool.
12. Existing contact extraction fields remain backward compatible.
13. No database migration or renderer change is introduced unless separately approved.
14. Focused tests, main-process tests, utility tests, TypeScript checks, and packaged-worker verification pass.

## 27. Related Documents

- [Contact Verification AI Tool PRD](./contact-verification-ai-tool-prd.md)
- [AI Tool List Management PRD](./ai-tool-list-management-prd.md)
- [AI Tool List Management Technical Design](./ai-tool-list-management-technical-design.md)
- [Contact Profile AI Enrichment PRD](../contact-profile-ai-enrichment-prd.md)
- [OpenAI-Compatible Chat V2 Technical Design](../openai-compatible-chat-v2-technical-design.md)
