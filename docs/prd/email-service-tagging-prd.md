# Email Service Tagging - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Implemented; validation recorded in the technical design
- **Created**: 2026-09-26
- **Owner**: AiFetchly Desktop Engineering
- **Related technical design**: `docs/prd/email-service-tagging-technical-design.md`
- **Primary implementation areas**:
  - `src/entity/EmailService.entity.ts`
  - `src/modules/emailServiceModule.ts`
  - `src/service/emailMarketingAiTools.ts`
  - `src/config/skillsRegistry.ts`
  - `src/views/pages/emailservice/servicedetail.vue`
  - `src/views/pages/emailservice/widgets/EmailServiceTable.vue`

## 1. Executive Summary

AiFetchly should add user-managed tags to email services so users can identify and select SMTP sending services with meaningful names such as `marketing-us`, `transactional`, or `customer-support`.

The feature has two connected goals:

1. Users can create, rename, assign, filter, and delete email-service tags from the email-service UI.
2. AI email tools can resolve an email service by an exact tag, while the existing numeric email-service ID remains the internal execution and audit identifier.

The first release supports **zero or one tag per email service**. Tags are persisted as reusable records rather than as an unstructured string on each email-service row. This supports tag CRUD, uniqueness, rename behavior, safe deletion, and future expansion to multiple tags without coupling tag management to SMTP credentials.

The feature must preserve all current ID-based flows. Existing email send tasks, task relations, audit logs, retries, and historical records continue to use `emailServiceId`.

## 2. Problem Statement

Email services are currently selected by numeric IDs and human-readable names. Numeric IDs are reliable for the application but are poor user-facing identifiers, especially when the AI is asked to choose a sender during a natural-language request.

Current limitations:

- Users must remember or inspect an internal service ID.
- Similar service names are difficult for users and the AI to distinguish.
- AI tool calls can select a service by ID but cannot use a stable user-defined alias.
- Users cannot organize email services by business purpose, region, brand, or environment.
- A free-form string field would not provide safe tag rename, uniqueness, or deletion behavior.

## 3. Goals

### 3.1 Product Goals

- Allow users to manage reusable email-service tags.
- Allow each email service to have zero or one tag in the first release.
- Display tags in the email-service list and detail screens.
- Allow filtering the email-service list by tag.
- Allow AI tools to resolve an email service by an exact tag.
- Keep internal sending and audit behavior ID-based.
- Preserve existing email-service records and existing AI tool contracts where possible.
- Prevent ambiguous AI selections from silently sending through the wrong SMTP account.

### 3.2 Engineering Goals

- Follow the repository's Model → Module → Controller/IPC architecture.
- Keep renderer code free of database access.
- Validate all tag input at IPC boundaries with strict schemas.
- Keep tags and email-service metadata password-free in all AI responses.
- Make schema migration safe for existing installations.
- Add unit, IPC, component, and AI-tool coverage for the new behavior.

## 4. Non-Goals

The first release does not include:

- Multiple tags per email service.
- Nested tags or tag groups.
- Tag-based access control.
- Tag-specific SMTP credentials or configuration.
- Automatically generated tags for existing services.
- Changing the lower-level SMTP send worker to accept tags.
- Replacing `emailServiceId` in task relations, send logs, audit records, or retry records.
- AI-created, renamed, or deleted tags.
- Fuzzy tag matching during a send operation.

## 5. User Personas and User Stories

### 5.1 Marketing Operator

As a marketing operator, I want to assign `marketing-us` to the US marketing sender so that I can recognize it without memorizing its database ID.

### 5.2 Operations User

As an operations user, I want to filter email services by tag so that I can quickly inspect all senders for a particular purpose.

### 5.3 AI Chat User

As an AI chat user, I want to say “send this campaign through the transactional service” so that the AI can resolve the correct sender without asking me for an internal numeric ID.

### 5.4 Administrator

As an administrator, I want to rename or delete tags without deleting email services or credentials.

### 5.5 Safety-Conscious User

As a user, I want the AI to stop and ask for clarification when a tag is ambiguous rather than silently selecting a sender.

## 6. Functional Requirements

### FR-001: Create Tag

The user can create a tag from the email-service tag-management UI.

Rules:

- Display name is required.
- Leading and trailing whitespace is removed.
- Empty names are rejected.
- Maximum display-name length is 64 characters.
- Control characters and line breaks are rejected.
- Tag names are unique case-insensitively after trimming.
- The normalized lookup value is generated by the main process, not trusted from the renderer.

### FR-002: Rename Tag

The user can rename an existing tag.

Rules:

- Existing email services continue to reference the same tag ID.
- Renaming immediately changes the value returned by list and AI tools.
- A rename that conflicts with another normalized tag is rejected.
- Historical send logs do not need to be rewritten because they remain ID-based.

### FR-003: Delete Tag

The user can delete a tag.

Rules:

- Deleting a tag never deletes email services.
- Services assigned to the tag become untagged.
- The UI shows the number of affected services before confirmation.
- Deleting an unused tag is allowed without an additional impact warning.

### FR-004: Assign Tag

The user can assign an existing tag while creating or editing an email service.

Rules:

- A service may have zero or one tag.
- The user can clear the current tag.
- Assignment is persisted atomically with the email-service update.
- A nonexistent tag ID is rejected.

### FR-005: Display Tags

The email-service list displays the assigned tag as a chip or equivalent compact label.

The service-detail form displays the current tag and allows selecting or creating a tag.

### FR-006: Filter by Tag

The email-service list supports filtering by tag.

The filter must support:

- A specific tag.
- Untagged services.
- All services.

The existing name/sender search remains available and can be combined with the tag filter.

### FR-007: List Tags

The UI can retrieve all tags in deterministic order. The default ordering is case-insensitive display name ascending, with usage count included for management views.

### FR-008: AI Tag Resolution

The AI can resolve a sender using an exact tag.

Supported inputs:

```json
{ "tag": "marketing-us" }
```

or, for backward compatibility:

```json
{ "service_id": 7 }
```

Exactly one selector is required. If both are provided, the tool returns a validation error.

### FR-009: AI Service Listing

`list_email_services` returns the assigned tag when present, without exposing passwords or other secrets.

Example:

```json
{
  "id": 7,
  "name": "US Marketing SMTP",
  "tag": "marketing-us",
  "address": "sender@example.com",
  "port": "465",
  "ssl": 1,
  "status": 1
}
```

### FR-010: AI Ambiguity Handling

Normalized tag names identify one tag record, but several services may share that tag. AI resolution succeeds only when exactly one service is assigned. With zero matches it returns a not-found error; with multiple matches it returns an ambiguity error and requires an explicit service ID.

The AI must never choose the first result silently.

### FR-011: Internal ID Preservation

When the AI resolves a tag, the resolved service ID is passed into the existing send-task flow. All task relations, send logs, delivery outcomes, audit records, and retries continue to store numeric IDs.

### FR-012: Import and Export

Email-service CSV and JSON export includes the tag display name.

Import behavior:

- Existing tags are resolved by normalized name.
- Missing tags may be created only when the import operation explicitly enables “create missing tags.”
- The default import behavior should not silently create tags.
- Password and credential handling remains unchanged.

### FR-013: Localization

All new user-facing strings are added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

### FR-014: AI Permission Gating

The existing AI enablement check remains mandatory for AI tool execution. Tag lookup must not bypass the current `Token` and `USER_AI_ENABLED` policy.

## 7. User Experience

### 7.1 Email-Service List

Add:

- `Tag` column.
- Tag chip for tagged services.
- `Untagged` presentation for services without a tag.
- Tag filter control.
- “Manage tags” action.

The existing service search should continue to search service name and sender identity. Tag matching can be handled by the dedicated filter rather than overloading the free-text search in the first release.

### 7.2 Email-Service Detail

Add a tag selector near the service name:

- Searchable existing-tag selection.
- Clear selection action.
- Create-new-tag action.
- Inline duplicate-name error.
- Loading and disabled states while tags are being loaded or saved.

The selector should show the tag display name, not its database ID.

### 7.3 Tag Management Dialog

The tag-management dialog should include:

| Action | Behavior |
| --- | --- |
| Create | Opens a name field and creates a tag after validation |
| Rename | Updates the tag name and refreshes all affected services |
| Delete | Shows usage count and clears assignments after confirmation |
| Search | Filters tag names locally or through a bounded API |
| Usage count | Shows how many email services use each tag |

Suggested component: `src/views/pages/emailservice/widgets/EmailServiceTagDialog.vue`.

### 7.4 AI Conversation Behavior

For a request such as:

> Send the campaign using the marketing-us sender.

The AI should:

1. Call `list_email_services` if it does not already have a current service list.
2. Match `marketing-us` exactly after normalization.
3. Use the resolved numeric ID in `start_email_send_task`.
4. Report the selected service name and tag before a confirmation-sensitive send action when the existing send policy requires confirmation.

If the tag does not exist, the AI should ask the user to choose an existing tag or identify the sender by name. It must not create a tag.

## 8. Acceptance Criteria

### Tag Management

- A user can create a valid tag.
- Duplicate tags are rejected case-insensitively.
- A user can rename a tag without editing each service.
- A user can assign and clear a tag on an email service.
- Deleting a tag clears assignments and preserves services.
- The management view shows usage counts.

### Email-Service UI

- List rows show the correct tag.
- Tag filtering returns tagged and untagged services correctly.
- The detail form loads and saves the tag.
- Loading, validation, and error states are visible and localized.
- Existing email-service create/edit/delete behavior remains intact.

### AI Tools

- `list_email_services` includes tags and never includes passwords.
- `get_email_service_config` accepts either `service_id` or `tag`.
- Unknown tags return a clear failure without invoking SMTP.
- Tag resolution produces the same internal service ID used by current send flows.
- Existing ID-based calls continue to pass unchanged.
- Ambiguous or inconsistent results fail closed.

### Data and Migration

- Existing installations start with all services untagged.
- Database initialization works on a fresh database.
- Upgrade works on a database containing existing email services.
- CSV and JSON round trips preserve tags when configured.

## 9. Success Metrics

The first release should measure:

- Percentage of email services with a tag assigned.
- Number of successful AI service resolutions by tag.
- Number of unknown-tag failures.
- Number of ambiguous-tag failures.
- Number of tag create, rename, and delete operations.
- Time from AI tool invocation to resolved service ID.

Metrics must not include tag values, email addresses, SMTP hosts, or credentials. Use counts and outcome labels only.

## 10. Rollout and Compatibility

### Phase 1: Data and Service Layer

- Add tag table and nullable `tagId`.
- Add Model and Module operations.
- Add migration and validation tests.

### Phase 2: Desktop UI

- Add list display/filter.
- Add detail assignment.
- Add tag-management dialog.
- Add translations and component tests.

### Phase 3: AI Integration

- Include tags in sanitized service summaries.
- Add exact tag selector support.
- Update tool schemas and descriptions.
- Add AI-tool tests and prompt regression coverage.

### Rollback

If AI tag resolution is disabled, ID-based AI tools remain available. If the UI is rolled back, the nullable database column and unused tag records are harmless. A destructive rollback that drops tag tables is not recommended without a separate data-export step.

## 11. Open Decisions

The following decisions should be confirmed before implementation begins:

1. Should the first release allow exactly one tag or multiple tags per service?
2. Should import create missing tags, or require tags to exist first?
3. Should tag names allow spaces, or should the UI enforce slug-like values such as `marketing-us`?
4. Should deleting a tag require confirmation when it is unused, or only when it has assignments?
5. Should the AI send tool accept `tag` directly, or should only the discovery/configuration tool support tag lookup in the first increment?

Recommended defaults are: one tag, no implicit tag creation during import, allow spaces but normalize case, confirm only when assignments exist, and support tag resolution before sending while retaining ID-based execution.
