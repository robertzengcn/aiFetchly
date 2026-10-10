# PRD: Safe AI Email Variable Resolution Before Send

**Date:** 2026-09-03

**Status:** Draft

**Owner:** AiFetchly AI Chat and Email Marketing

**Related area:** AI Chat V2, outbound email tools, email identity profiles, email templates

**Primary tool:** `start_email_send_task`

## 1. Summary

AiFetchly can generate outbound email content and call `start_email_send_task`, but AI-generated content may contain unresolved placeholders such as `[Your Name]`, `[Your Phone]`, `[Your Email]`, or `[X]`. Sending that content damages sender credibility and may disclose that the message was generated from an unfinished template.

This feature guarantees that an outbound email cannot start while its subject or body contains an unresolved variable. AiFetchly will:

1. Give the AI verified sender identity and recipient context before it composes the email.
2. Standardize generated variables on AiFetchly's existing `{$variable_name}` format.
3. Resolve supported variables from trusted application data at send time.
4. Detect unsupported, legacy, or unresolved placeholders before creating the email task.
5. Ask the user for any missing business fact instead of letting the AI guess it.
6. Show the final resolved content in the existing tool confirmation experience before sending.
7. Apply the same validation to both inline AI-generated content and saved templates.

The AI remains responsible for writing the message. The application remains responsible for deciding whether the message is complete and safe to send.

## 2. Problem Statement

### 2.1 Current behavior

The AI outbound-email tool accepts either saved `template_ids` or inline `email_subject` and `email_html_content`. The current input schema verifies presence and length, but it does not verify that the content is final.

The existing email template system supports canonical variables such as:

- `{$sender}`
- `{$receiver_email}`
- `{$receiver_name}`
- `{$company_name}`
- `{$url}`
- `{$description}`
- `{$campaign_name}`
- `{$send_time}`

The send worker currently replaces only part of this registry. AI-generated free-form content can also use informal placeholders that the application does not recognize, including `[Your Name]`, `[your email]`, `[Your Phone]`, `[X]`, `{{name}}`, or `TBD`.

### 2.2 User impact

If unresolved text reaches a recipient:

- The sender appears careless or unprofessional.
- The recipient may recognize the message as an unfinished generated template.
- The user may send incorrect commercial terms if the AI invents values such as minimum order quantity.
- A bulk task can repeat the same mistake across many recipients.
- The existing confirmation step may not make the missing value sufficiently visible.

### 2.3 Example failure

An AI-generated email includes:

```text
My name is [Your Name]. Please contact me at [Your Email] or [Your Phone].
Our minimum order quantity starts at [X] units.
```

The first three values can come from a configured sender identity. `[X]` is an unknown business fact and must cause the send to stop until the user supplies a value.

## 3. Goals

1. Prevent every AI-initiated outbound email task from starting with unresolved placeholders in the subject or body.
2. Resolve sender details from trusted, email-service-specific settings rather than model inference.
3. Resolve recipient details separately for each recipient when recipient data is available.
4. Make missing values actionable by naming exactly what the user must provide.
5. Ensure the AI asks the user for missing facts and never invents personal, contact, pricing, quantity, legal, or commercial information.
6. Preserve the existing email template variable format and existing saved templates.
7. Ensure the user confirms final rendered content, not an unresolved draft.
8. Support direct-recipient sends and email-search-task sends consistently.
9. Keep validation in the main process and send path so prompt failures cannot bypass it.

## 4. Non-Goals

1. This feature does not redesign the email composer or template editor.
2. It does not let the AI infer missing facts from the public internet.
3. It does not automatically save one-time values supplied in chat to the sender profile.
4. It does not create arbitrary user-defined template variables in the first release.
5. It does not change SMTP delivery, filtering, deduplication, scheduling, or retry behavior.
6. It does not replace the existing tool confirmation requirement for `start_email_send_task`.
7. It does not guarantee that all prose is factually correct; it guarantees that recognized placeholder patterns are resolved or blocked.
8. It does not treat Markdown links, such as `[Tecnatel](https://tecnatel.com/)`, as placeholders.

## 5. Users and Use Cases

### 5.1 Primary user

A marketer or business operator who asks AiFetchly AI Chat to write and send outbound email to a lead, customer, or list of contacts.

### 5.2 Core use cases

1. The user has a complete sender identity. The AI drafts an email, sender variables resolve automatically, the user reviews the final message, and sending starts.
2. The user's phone number is missing. AiFetchly blocks the send and the AI asks for the phone number.
3. The draft contains an unknown commercial value such as `[X] units`. AiFetchly blocks the send and asks the user to provide the minimum order quantity.
4. A saved template contains `{$receiver_name}`. AiFetchly resolves a different recipient name for each email.
5. Recipient names are unavailable. AiFetchly blocks a template that requires `{$receiver_name}` rather than sending the literal variable or inventing a name.
6. An email contains a Markdown link. The validator allows the link and does not misclassify its label as a placeholder.
7. The AI attempts to bypass the rule by calling the tool directly with an unresolved legacy placeholder. Main-process validation rejects the call before any task or worker starts.

## 6. Product Principles

### 6.1 Trusted data beats model output

Identity and contact values must come from configured application data or explicit user input in the active conversation. The model must not guess them.

### 6.2 Validation must be deterministic

Prompt instructions reduce mistakes but do not provide enforcement. The send boundary must independently resolve variables and reject unresolved content.

### 6.3 Missing data stops sending

An unknown value is a user question, not a reason to substitute an empty string, remove the sentence silently, or invent a plausible answer.

### 6.4 Preview what will actually be sent

The user must see the resolved subject and resolved body in the confirmation step. Per-recipient variables must show at least one representative recipient and clearly state that values vary by recipient.

## 7. Variable Model

### 7.1 Canonical syntax

AI-generated and saved template variables must use the existing format:

```text
{$variable_name}
```

The AI must not introduce `{{variable}}`, `[Your Name]`, `<YOUR NAME>`, or other placeholder styles.

### 7.2 Supported variables for the first release

| Variable | Trusted source | Required behavior |
| --- | --- | --- |
| `{$sender}` | Selected email service display identity, falling back to its From address | Backward-compatible alias; must never be blank |
| `{$sender_name}` | Email identity profile `ownerName` | Block if referenced and missing |
| `{$sender_role}` | Email identity profile `ownerRole` | Block if referenced and missing |
| `{$sender_company}` | Email identity profile `companyName` | Block if referenced and missing |
| `{$sender_email}` | Selected email service From address | Block if referenced and missing or invalid |
| `{$sender_phone}` | New email identity profile phone field | Block if referenced and missing |
| `{$sender_website}` | New email identity profile website field | Block if referenced and missing or invalid |
| `{$sender_signature}` | Email identity profile `signature` | Block if referenced and missing |
| `{$receiver_email}` | Direct email input or resolved email-search-task recipient | Block if missing or invalid |
| `{$receiver_name}` | Recipient `title` or future structured recipient-name field | Block if referenced and missing |
| `{$company_name}` | Recipient company/contact data | Block if referenced and missing |
| `{$url}` | Recipient `source` or campaign context | Block if referenced and missing |
| `{$description}` | Campaign or recipient context | Block if referenced and missing |
| `{$campaign_name}` | Email task/campaign metadata | Block if referenced and missing |
| `{$send_time}` | Application-generated send timestamp | Always resolve at actual send time |

### 7.3 Unknown business facts

Values such as minimum order quantity, pricing, discount percentage, lead time, certification claims, and delivery promises are not generic identity variables. In the first release:

- The AI may use a literal value only when it comes from user-provided context or trusted campaign data.
- The AI must ask the user when the value is missing.
- The send validator must reject generic markers such as `[X]`, `TBD`, or an unknown canonical variable.
- A one-time answer supplied in chat applies only to the current draft unless the user separately asks to save it.

## 8. Sender Identity Requirements

### FR-001 Reuse the existing identity profile

Sender identity remains scoped to an email service. The system must reuse the existing email reply identity profile as the trusted source for outbound AI email identity instead of creating a second competing profile.

### FR-002 Add structured contact fields

The identity profile must support optional structured fields for:

- Phone number
- Website URL

The selected email service remains the authoritative source for the sender email address.

### FR-003 Profile completion experience

The identity settings UI must:

- Explain that these values can be inserted into AI-generated outgoing email.
- Validate required formats before saving.
- Show which email service the profile belongs to.
- Never expose SMTP passwords, tokens, or other secrets to the model.
- Provide translations in English, Chinese, Spanish, French, German, and Japanese.

## 9. AI Behavior Requirements

### FR-004 Inject verified context

Before the model composes or sends outbound email, the AI context must include only the non-secret sender fields associated with the selected email service and the available recipient/campaign fields.

The context must distinguish:

- Verified values that may be used literally.
- Supported variables that the send path can resolve.
- Missing values that must be requested from the user.

### FR-005 Model instruction

The outbound email tool guidance must state:

```text
Before calling start_email_send_task, make the subject and body ready to send.
Use only verified values supplied by AiFetchly or canonical {$variable_name}
variables supported by the email system. Never invent missing identity,
contact, pricing, quantity, legal, certification, or delivery information.
Never send legacy placeholders such as [Your Name], [Your Email], [Your Phone],
[X], {{variable}}, or TBD. If a required value is missing, do not call the send
tool. Ask the user for that value.
```

### FR-006 Clarification behavior

When validation reports missing values, the AI must:

1. Not retry the same send arguments.
2. Ask one concise question listing the missing values.
3. Incorporate the user's answer into the draft.
4. Run preflight validation again before requesting send confirmation.

The AI must not silently delete a sentence solely to avoid asking for a missing value when that sentence expresses an important user-requested offer or claim.

## 10. Send-Time Resolution and Validation

### FR-007 Shared preflight service

A main-process preflight service must be the single enforcement point for inline AI content and saved templates. It must:

1. Load the selected sender identity through the Module and Model layers.
2. Load only the non-secret fields required for resolution.
3. Resolve recipients through the existing email marketing service flow.
4. Parse canonical variables in the subject and body.
5. Resolve every supported variable for every recipient.
6. Detect unsupported canonical variables and recognized legacy placeholders.
7. Return a structured success result or a structured blocking result.

Database access must remain in Model and Module classes. The AI tool service and IPC layer must not query TypeORM repositories directly. The worker process must not load identity data from the database.

### FR-008 Validation timing

Preflight must complete before:

- The final tool confirmation is shown.
- A bulk email task record is created.
- A child process is spawned.
- Any SMTP connection or delivery attempt begins.

The start path must run the validation again after confirmation and immediately before task creation so stale or modified content cannot bypass the check.

### FR-009 Validation result

A blocking result must include machine-readable fields:

| Field | Meaning |
| --- | --- |
| `code` | Stable error code such as `UNRESOLVED_EMAIL_VARIABLES` |
| `missing_variables` | Supported variables that lack source data |
| `unknown_variables` | Canonical variables that are not registered |
| `legacy_placeholders` | Detected informal placeholders such as `[Your Name]` |
| `affected_fields` | `subject`, `body`, or both |
| `recipient_count` | Number of recipients affected |
| `sample_recipients` | Small sanitized sample that helps explain per-recipient gaps |
| `message` | User-safe summary suitable for the AI and UI |

The result must not include SMTP credentials or unrelated profile data.

### FR-010 No empty substitution

If a referenced variable has no value, the resolver must not replace it with an empty string. It must return a blocking result.

### FR-011 Per-recipient completeness

For multi-recipient tasks, preflight must validate every recipient, not only the first recipient. A task must not start if any recipient lacks a value required by the chosen content.

The result may aggregate failures by variable and report a bounded sample of affected recipients so large lists do not produce oversized tool results.

### FR-012 Consistent subject and body handling

The resolver must apply the same rules to:

- Inline email subject
- Inline HTML body
- Saved template title
- Saved template content

### FR-013 Markdown and HTML awareness

Detection must not treat valid formatting as a placeholder. In particular:

- `[label](https://example.com)` is a Markdown link, not a placeholder.
- HTML tags and attributes are not placeholders.
- Visible placeholder text inside rendered HTML remains subject to validation.
- Canonical variables inside URLs or HTML attributes are resolved and validated normally.

### FR-014 Legacy placeholder detection

The first release must detect, case-insensitively, common unfinished markers including:

- `[Your Name]`, `[Your Email]`, `[Your Phone]`, and variants with spacing or capitalization changes
- `[X]` when used as a standalone unknown value
- `{{variable}}`
- `<YOUR_NAME>`-style markers
- `TBD`, `TO BE FILLED`, and `INSERT ... HERE` when used as value markers

Detection must return the exact visible marker and its location without interpreting normal Markdown link labels as placeholders.

## 11. Confirmation Experience

### FR-015 Final-content confirmation

`start_email_send_task` must continue to require confirmation. The confirmation card must show:

- Selected sender identity and From address
- Recipient count and source
- Final resolved subject
- Final resolved body preview
- Any values that will vary per recipient
- A clear blocking state if preflight fails

The confirm action must remain disabled while blocking issues exist.

### FR-016 Representative preview for bulk sends

For a multi-recipient task, the confirmation experience must show the message rendered for the first eligible recipient and state that recipient-specific fields will change for each recipient. The system must still validate all recipients before enabling confirmation.

### FR-017 Missing-profile action

When sender profile fields are missing, the UI must offer a direct path to edit the identity profile for the selected email service. After the profile is saved, the user can return to chat and retry without reconstructing the whole request.

## 12. Error Handling

| Condition | Required behavior |
| --- | --- |
| Missing sender profile | Block; identify the selected service and request profile completion |
| Missing sender field | Block; name the field and offer profile editing |
| Missing recipient field | Block; report the affected count and sample recipients |
| Unknown canonical variable | Block; name the variable; do not guess a mapping |
| Legacy placeholder | Block; return the exact marker and location |
| Invalid sender email, phone, or URL | Block; request correction |
| Profile changes after confirmation | Re-run validation; require a new confirmation if rendered content changes |
| Recipient list changes after confirmation | Re-run validation; require a new confirmation |
| Preflight service failure | Fail closed; do not create the task or start the worker |

## 13. Security and Privacy Requirements

1. Only allowlisted non-secret identity fields may enter model context.
2. SMTP passwords, access tokens, refresh tokens, database paths, and encryption material must never enter prompts, previews, logs, or tool results.
3. Main-process validation remains authoritative; renderer-only validation is insufficient.
4. AI enable gating must remain at the start of affected AI IPC handlers using `Token` and `USER_AI_ENABLED`.
5. Tool argument and result sanitization must remain active.
6. Validation errors must avoid returning a full recipient list; return counts and a bounded sample.
7. Send confirmation and existing approval-mode safety rules remain in effect.
8. Workers receive already-approved task data and perform variable rendering only from values supplied by the main process; workers never access the database directly.

## 14. Compatibility and Migration

1. Existing `{$sender}` and other registered variables must remain supported.
2. Existing templates without variables continue to work unchanged.
3. Existing templates with newly enforced but unresolvable variables become blocked at preview/send time and require correction; they must not be modified silently.
4. Newly added sender fields are nullable so existing identity records remain valid.
5. AI-generated content should use the expanded canonical registry after launch.
6. The existing inline-content length limits remain unchanged: 500 characters for the subject and 50,000 characters for the body.
7. Validation applies regardless of tool approval mode, including full-access conversations and scheduled AI execution.

## 15. Functional Requirements Summary

| ID | Requirement |
| --- | --- |
| FR-001 | Reuse the existing email-service identity profile for outbound AI email. |
| FR-002 | Add structured phone and website identity fields. |
| FR-003 | Let users complete and validate sender identity settings. |
| FR-004 | Inject allowlisted verified sender and recipient context into the AI flow. |
| FR-005 | Instruct the AI to use canonical variables and never guess missing facts. |
| FR-006 | Require the AI to ask for missing values and retry preflight. |
| FR-007 | Use one main-process preflight service for inline and saved-template content. |
| FR-008 | Validate before confirmation, task creation, worker spawn, and SMTP activity. |
| FR-009 | Return structured, sanitized validation failures. |
| FR-010 | Never substitute a referenced missing value with an empty string. |
| FR-011 | Validate required variables for every recipient. |
| FR-012 | Apply identical rules to subjects, bodies, and saved templates. |
| FR-013 | Distinguish placeholders from valid Markdown and HTML. |
| FR-014 | Detect common legacy and informal placeholder styles. |
| FR-015 | Confirm the final resolved message before sending. |
| FR-016 | Show a representative bulk preview while validating every recipient. |
| FR-017 | Offer a direct identity-profile completion path when fields are missing. |

## 16. Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-001 | Preflight for 1,000 recipients should complete in under 1 second excluding database retrieval. |
| NFR-002 | Variable detection and resolution must produce deterministic results for the same content and context. |
| NFR-003 | Validation must be unit-testable without starting Electron, SMTP, or a worker process. |
| NFR-004 | Validation failures must be stable, typed, and suitable for UI rendering and model recovery. |
| NFR-005 | No new runtime dependency is required for placeholder parsing. |
| NFR-006 | Debug logging must record error codes and counts without logging secrets or full message bodies. |
| NFR-007 | All new user-facing text must be translated into all six supported languages. |

## 17. Acceptance Criteria

### AC-001 Complete sender profile

Given a selected email service with a complete identity profile, when the AI creates content containing supported sender variables, then preflight resolves every variable and confirmation shows the final values.

### AC-002 Missing phone number

Given content containing `{$sender_phone}` and a profile without a phone number, when the AI attempts to send, then no task is created, the tool returns `UNRESOLVED_EMAIL_VARIABLES`, and the AI asks the user for a phone number.

### AC-003 Legacy placeholders

Given content containing `[Your Name]`, `[your email]`, `[Your Phone]`, or `[X]`, when preflight runs, then sending is blocked and each marker is listed in `legacy_placeholders`.

### AC-004 Unknown canonical variable

Given content containing `{$minimum_order_quantity}` when that variable is not registered, when preflight runs, then sending is blocked and the AI asks the user for the value rather than inventing one.

### AC-005 Markdown link

Given content containing `[tecnatel.com](https://tecnatel.com/)` and no unresolved variables, when preflight runs, then the Markdown link does not cause a validation failure.

### AC-006 Multi-recipient completeness

Given 100 recipients and a template containing `{$receiver_name}`, when one recipient lacks a name, then the entire task remains blocked and the result reports one affected recipient without exposing all 100 addresses.

### AC-007 Bypass attempt

Given the AI ignores its prompt instruction and directly calls `start_email_send_task` with an unresolved placeholder, then main-process enforcement rejects it before task creation or worker spawn.

### AC-008 Saved template

Given a saved template containing supported variables, when the AI selects it for sending, then the same preflight and confirmation behavior applies as for inline content.

### AC-009 Stale confirmation

Given a user confirms a resolved message and the sender profile or recipient set changes before task creation, then the system re-runs validation and requires confirmation again if the rendered result changed.

### AC-010 No secret exposure

Given any success or failure path, then prompts, tool results, UI previews, and logs contain no SMTP password, token, encryption material, or database path.

## 18. Test Requirements

### 18.1 Unit tests

Cover:

- Canonical variable parsing and resolution
- Unknown canonical variables
- Legacy placeholder detection
- Markdown links and HTML false positives
- Subject and body validation
- Missing versus empty values
- Per-recipient aggregation
- Maximum-length content
- Sanitized error output
- Backward compatibility for `{$sender}`

### 18.2 Service and tool tests

Cover:

- Inline content preflight
- Saved-template preflight
- Direct recipients and email-search-task recipients
- No task creation when validation fails
- No worker spawn when validation fails
- Revalidation immediately before task creation
- AI tool result codes and recovery instructions
- Enforcement under every AI tool approval mode

### 18.3 Component tests

Any identity-profile or confirmation UI change must add or update tests in `test/vitest/main/components/`. Tests must cover missing-field display, disabled confirmation, final preview, navigation to identity settings, and translated labels.

### 18.4 End-to-end tests

Add a critical-flow test in `test/e2e/specs/` that verifies:

1. AI drafts an email with sender variables.
2. Missing profile data blocks sending.
3. The user completes the profile.
4. The resolved preview appears.
5. Confirmation starts the task.
6. No unresolved marker reaches the worker payload.

## 19. Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| AI-started outbound tasks containing unresolved placeholders | 0 | Validation and send-task audit sampling |
| Main-process placeholder bypass rate | 0% | Automated tests and blocked-call telemetry |
| Missing-value errors that lead to a successful corrected send | At least 70% | Anonymous error-code funnel, if telemetry is enabled |
| False-positive rate for ordinary Markdown/HTML | Below 1% in evaluation corpus | Fixed evaluation set of representative emails |
| Preflight P95 for 1,000 recipients | Under 1 second, excluding retrieval | Performance test |
| Secret exposure in validation logs/results | 0 incidents | Security test and log review |

## 20. Rollout

### Phase 1: Enforcement foundation

- Expand the canonical variable registry.
- Add sender phone and website fields.
- Implement shared resolution and detection.
- Enforce preflight in `start_email_send_task`.
- Return structured blocking results to the AI.
- Add unit and service tests.

### Phase 2: Final preview experience

- Show the resolved subject/body in the confirmation card.
- Add profile-completion navigation.
- Add all translations and component tests.
- Add the end-to-end recovery test.

### Phase 3: Evaluation and tightening

- Run a fixed corpus containing valid Markdown, HTML, legacy placeholders, and multilingual content.
- Measure false positives and missed placeholders.
- Expand the legacy marker list only from observed failures.
- Enable blocking for all AI-started outbound tasks after the evaluation gate passes.

## 21. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Prompt-only compliance fails | Unfinished email may be sent | Main-process validation is authoritative and fail-closed |
| Placeholder detector flags Markdown links | Valid email cannot send | Parse Markdown links before legacy bracket-marker detection and test representative content |
| Recipient data is incomplete in bulk lists | Entire campaign is blocked | Aggregate gaps, show samples, and let users choose content that does not require unavailable personalization |
| Multiple email services have different identities | Wrong person signs the email | Scope identity by selected service and resolve only after service selection |
| AI invents a commercial fact | Incorrect offer reaches recipient | Prompt prohibition plus unknown-marker and preflight blocking |
| Existing saved templates depend on empty substitution | Previously accepted sends become blocked | Show specific remediation; do not silently preserve unsafe behavior |
| Profile changes after user confirmation | Confirmed and sent content differ | Revalidate and require a new confirmation when rendered output changes |
| Full-content validation logs expose private data | Privacy leak | Log codes, variable names, and counts only; omit full content and secrets |

## 22. Resolved Product Decisions

1. AiFetchly will extend the existing `{$...}` variable system rather than add `{{...}}` syntax.
2. The existing email-service identity profile is the source of sender identity.
3. The selected SMTP service is the authoritative source of sender email.
4. Missing referenced values block the entire task; they are never replaced with empty strings.
5. Unknown business facts require a user answer and are not automatically persisted.
6. Every recipient is validated before a bulk task can start.
7. The final resolved content is what the user confirms.
8. Validation applies regardless of approval mode or execution origin.
9. The first release uses a fixed variable allowlist rather than arbitrary custom variables.

## 23. Related Existing Components

- `src/config/emailTemplateVariables.ts`: current canonical variable registry
- `src/views/utils/emailFun.ts`: current renderer-side template conversion
- `src/entity/EmailReplyIdentityProfile.entity.ts`: existing per-service identity data
- `src/modules/EmailReplyIdentityProfileModule.ts`: identity profile business layer
- `src/entityTypes/emailMarketingAiTypes.ts`: outbound AI email schemas
- `src/service/EmailMarketingAiTools.ts`: outbound email preview/start service functions
- `src/config/skillsRegistry.ts`: `start_email_send_task` definition and AI-facing guidance
- `src/childprocess/emailSend.ts`: worker-side final rendering and SMTP send flow
