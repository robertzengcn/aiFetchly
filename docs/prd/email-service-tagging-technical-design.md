# Email Service Tagging - Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Implemented
- **Created**: 2026-09-26
- **Owner**: AiFetchly Desktop Engineering
- **Product requirements**: `docs/prd/email-service-tagging-prd.md`

## 1. Design Summary

Add reusable email-service tags through a normalized `email_service_tag` table and a nullable `tagId` foreign key on `email_service`. The camel-case column name follows the existing TypeORM relation-column convention.

The first release models a one-to-many relationship:

```text
EmailServiceTag 1 ──────── * EmailService
```

A tag may be shared by multiple services. AI lookup must reject multiple matches and require an explicit service ID; uniqueness of the tag record does not imply uniqueness of its assigned service.

The user-facing tag is an alias. The numeric `EmailServiceEntity.id` remains the canonical execution identifier. AI tools may accept a tag as input, but the resolved ID is used for the existing send pipeline.

The implementation follows the existing architecture:

```text
Vue UI / AI tool
  -> preload IPC bridge
  -> validated IPC handler
  -> Controller or AI service
  -> Module
  -> Model
  -> TypeORM / SQLite
```

No renderer code should access TypeORM, SQLite, or credentials directly.

## 2. Existing Integration Points

### 2.1 Persistence

Current email-service persistence is centered on:

- `src/entity/EmailService.entity.ts`
- `src/model/EmailService.model.ts`
- `src/modules/emailServiceModule.ts`
- `src/modules/interface/EmailServiceModuleInterface.ts`
- `src/sql/scraperdb/email_service.sql`

`EmailServiceModule` encrypts credentials before persistence and decrypts services when they are read for runtime use. Tag operations must never alter this credential flow.

### 2.2 Desktop CRUD

Current desktop CRUD paths are:

- `src/views/api/emailservice.ts`
- `src/views/pages/emailservice/widgets/EmailServiceTable.vue`
- `src/views/pages/emailservice/servicedetail.vue`
- `src/controller/emailMarketingController.ts`
- `src/main-process/communication/emailMarketingIpc.ts`
- `src/schemas/ipc/emailMarketing.ts`
- `src/config/channellist.ts`

The new tag API should be registered through the same preload and validated IPC path.

### 2.3 AI Tools

Current AI email-service tools are defined in:

- `src/service/emailMarketingAiTools.ts`
- `src/config/skillsRegistry.ts`
- `src/entityTypes/emailMarketingAiTypes.ts`

The current list/configuration tools use numeric service IDs. The send pipeline eventually receives `EmailServicelist`/service IDs and the lower-level worker uses those IDs to load SMTP configuration.

## 3. Data Model

### 3.1 `EmailServiceTagEntity`

Create `src/entity/EmailServiceTag.entity.ts`:

```ts
@Entity("email_service_tag")
export class EmailServiceTagEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 64 })
  name: string;

  @Column({ type: "varchar", length: 64, unique: true })
  normalizedName: string;
}
```

The actual project style for audit columns and indexes should be followed when implementing the entity. If the TypeORM version or SQLite driver does not reliably enforce the column-level unique option in every initialization path, add an explicit unique index.

### 3.2 `EmailServiceEntity` Extension

Add a nullable foreign key to `src/entity/EmailService.entity.ts`:

```ts
@Column({ type: "integer", nullable: true })
tagId: number | null;
```

Optionally add the TypeORM relation only if the project consistently uses relation decorators for this database layer. The initial implementation can avoid eager relations and load tag data explicitly in Model queries to keep list performance and serialization predictable.

Recommended behavior:

- `tagId = NULL` means untagged.
- `ON DELETE SET NULL` prevents deleting a tag from deleting an email service.
- Email-service IDs remain stable.

### 3.3 SQL Shape

For fresh database initialization, add:

```sql
CREATE TABLE IF NOT EXISTS email_service_tag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(64) NOT NULL,
  normalizedName VARCHAR(64) NOT NULL UNIQUE,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
);
```

Add the nullable column and index to `email_service` through the repository's supported schema-upgrade mechanism. Do not assume that editing only the legacy SQL file upgrades existing user databases.

The implementation uses the existing TypeORM `synchronize: true` initialization in `src/config/SqliteDb.ts`. Registering the tag entity and service relation creates the nullable column, foreign key, and `idx_email_service_tag_id` index on both fresh and existing databases. The legacy SQL definitions cover fresh initialization only. Integration tests exercise an existing pre-tag table and repeated synchronization while checking service IDs and encrypted values.

### 3.4 Normalization

Use one shared pure function in a utility module, for example:

```ts
export function normalizeEmailServiceTag(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
```

Validation must reject:

- Empty values after trimming.
- Values longer than 64 characters.
- CR, LF, null bytes, and other control characters.

Do not use locale-sensitive behavior that causes inconsistent database lookups across machines. If the project already has a canonical ASCII/lowercase normalization helper, reuse it.

## 4. Layered API Design

### 4.1 Tag Model

Create `src/model/EmailServiceTag.model.ts` with methods such as:

```ts
create(entity: EmailServiceTagEntity): Promise<number>;
read(id: number): Promise<EmailServiceTagEntity | undefined>;
update(id: number, entity: EmailServiceTagEntity): Promise<void>;
delete(id: number): Promise<void>;
list(search?: string): Promise<EmailServiceTagEntity[]>;
findByNormalizedName(normalizedName: string): Promise<EmailServiceTagEntity | undefined>;
countServices(id: number): Promise<number>;
```

The Model owns TypeORM queries only. It should not contain UI or AI behavior.

### 4.2 Tag Module

Create `src/modules/emailServiceTagModule.ts` with methods such as:

```ts
listTags(search?: string): Promise<EmailServiceTagSummary[]>;
createTag(name: string): Promise<number>;
updateTag(id: number, name: string): Promise<void>;
deleteTag(id: number): Promise<{ affectedServiceCount: number }>;
resolveTag(name: string): Promise<EmailServiceTagEntity | undefined>;
```

The Module should:

- Normalize and validate names.
- Translate uniqueness violations to stable domain errors.
- Ensure the database connection before querying.
- Use the existing Token/USERSDBPATH path resolution through `BaseModule`.
- Keep tag deletion and service unassignment atomic where the existing database abstraction permits transactions.

### 4.3 Email Service Module Changes

Extend `EmailServiceModule` with:

```ts
findEmailServiceByTag(tag: string): Promise<EmailServiceEntity | undefined>;
listEmailServicesByTag(
  tagId: number | null,
  options?: EmailServiceListOptions
): Promise<EmailServiceEntity[]>;
```

For AI resolution, prefer a dedicated method that returns a sanitized, deterministic result rather than exposing a broad decrypted entity:

```ts
resolveEmailServiceSelector(selector: {
  serviceId?: number;
  tag?: string;
}): Promise<EmailServiceEntity | undefined>;
```

This method must enforce exactly one selector and must not return passwords to the AI layer.

### 4.4 Controller Changes

Add tag methods to `EmailMarketingController` or a dedicated `EmailServiceTagController` if the existing controller is already large. A dedicated controller is preferable for separation, but either option is compatible with the current IPC organization.

Suggested methods:

```ts
getEmailServiceTags(search?: string): Promise<EmailServiceTagSummary[]>;
createEmailServiceTag(name: string): Promise<number>;
updateEmailServiceTag(id: number, name: string): Promise<void>;
deleteEmailServiceTag(id: number): Promise<{ affectedServiceCount: number }>;
```

## 5. IPC Contract

### 5.1 Channels

Add channel constants in `src/config/channellist.ts`:

```ts
export const EMAILSERVICETAGLIST = "email:service:tag:list";
export const EMAILSERVICETAGCREATE = "email:service:tag:create";
export const EMAILSERVICETAGUPDATE = "email:service:tag:update";
export const EMAILSERVICETAGDELETE = "email:service:tag:delete";
```

### 5.2 Schemas

Add strict schemas in `src/schemas/ipc/emailMarketing.ts`:

```ts
const emailServiceTagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !/[\u0000\r\n]/.test(value), {
    message: "Tag contains an invalid control character",
  });

export const emailServiceTagCreateInputSchema = z.strictObject({
  name: emailServiceTagNameSchema,
});

export const emailServiceTagUpdateInputSchema = z.strictObject({
  id: z.number().int().positive(),
  name: emailServiceTagNameSchema,
});

export const emailServiceTagDeleteInputSchema = z.strictObject({
  id: z.number().int().positive(),
});
```

The email-service update schema should add:

```ts
tagId: z.number().int().positive().nullable().optional()
```

The handler must reject unknown fields and must verify that a provided tag ID exists before persisting the service.

### 5.3 Preload and Renderer API

Expose the new channels through the existing preload allowlist and add wrappers in `src/views/api/emailservice.ts`:

```ts
export async function getEmailServiceTags(
  search?: string
): Promise<EmailServiceTagSummary[]>;

export async function createEmailServiceTag(
  name: string
): Promise<number>;

export async function updateEmailServiceTag(
  id: number,
  name: string
): Promise<void>;

export async function deleteEmailServiceTag(
  id: number
): Promise<{ affectedServiceCount: number }>;
```

## 6. Email-Service List Query

### 6.1 Response Shape

Extend `EmailServiceListdata` and the safe AI summary types with:

```ts
tagId: number | null;
tag: string | null;
```

The UI list can use a left join or a second bounded lookup depending on the current pagination implementation. Prefer a single query with a left join for the paginated list:

```sql
SELECT
  email_service.*,
  email_service_tag.id AS tagId,
  email_service_tag.name AS tag
FROM email_service
LEFT JOIN email_service_tag
  ON email_service.tagId = email_service_tag.id
WHERE ...
ORDER BY ...
LIMIT ? OFFSET ?;
```

Do not decrypt passwords for list rows unless the existing implementation already requires it. Tag list and service list responses must remain safe for renderer and AI consumption.

### 6.2 Filtering

Add an optional `tagId` filter and an explicit `untagged` filter state. Avoid overloading `tagId = 0` as a sentinel; use a typed request field such as:

```ts
tagId?: number;
untagged?: boolean;
```

Reject requests that provide both a concrete `tagId` and `untagged: true`.

## 7. AI Tool Design

### 7.1 Input Schema

Update `getEmailServiceConfigInputSchema` to accept exactly one selector:

```ts
export const getEmailServiceConfigInputSchema = z
  .strictObject({
    service_id: emailMarketingIdSchema.optional(),
    tag: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (value) =>
      (value.service_id !== undefined) !== (value.tag !== undefined),
    {
      message: "Provide exactly one of service_id or tag",
    }
  );
```

Normalize the tag in the service layer. Do not rely on the model to normalize casing correctly.

### 7.2 `list_email_services`

Extend the list result type:

```ts
export interface SanitizedEmailService {
  id: number;
  name: string;
  tag: string | null;
  address: string;
  source: string;
  port: string;
  ssl: number;
  status: number;
}
```

The list tool description in `src/config/skillsRegistry.ts` should state:

- Tags are exact user-defined aliases.
- Tags are case-insensitive for lookup.
- Tags must not be guessed.
- The assistant must clarify if a tag is not found.
- The returned ID is the value to pass to the existing send tool.

### 7.3 `get_email_service_config`

Resolution flow:

```text
validate args
  -> enforce exactly one selector
  -> if service_id: load by ID
  -> if tag: normalize and query by tag
  -> verify service exists and is usable
  -> sanitize response
  -> return id, name, tag, sender metadata
```

Failure messages should distinguish:

- Invalid input.
- Tag not found.
- Service ID not found.
- Service exists but is disabled.
- Internal data inconsistency.

Do not reveal encrypted or decrypted credentials in any failure response.

### 7.4 Send-Task Compatibility

Do not change the final SMTP worker contract. If future send-tool input supports tags, resolve them before calling the existing task-start method:

```text
AI input { service_tags: ["marketing-us"] }
  -> resolve tags
  -> obtain [7]
  -> existing start_email_send_task({ service_ids: [7], ... })
```

This preserves the current behavior in:

- `src/service/emailMarketingAiTools.ts`
- `src/modules/buckEmailTaskModule.ts`
- `src/childprocess/emailSend.ts`

## 8. UI Design

### 8.1 Components

Modify:

- `src/views/pages/emailservice/widgets/EmailServiceTable.vue`
- `src/views/pages/emailservice/servicedetail.vue`

Add:

- `src/views/pages/emailservice/widgets/EmailServiceTagDialog.vue`

The tag dialog should not own email-service persistence. It should call the renderer API wrappers and emit a refresh event after mutations.

### 8.2 Detail Form State

The form model should include:

```ts
tagId: number | null;
```

On load:

1. Fetch service detail.
2. Fetch tag options, preferably in parallel.
3. Set `tagId` from the service response.

On save:

1. Validate the email-service form.
2. Send `tagId` with the existing save payload.
3. Preserve the current password sentinel behavior.
4. Refresh the service list after success.

### 8.3 Table Filter State

Use a typed state model:

```ts
type EmailServiceTagFilter =
  | { kind: "all" }
  | { kind: "tag"; tagId: number }
  | { kind: "untagged" };
```

Map this state to the IPC request without using magic values.

### 8.4 Accessibility and Interaction

- Tag selector has a visible localized label.
- Keyboard users can open, search, select, and clear tags.
- Delete confirmation identifies the tag name and affected service count.
- Duplicate-name errors are associated with the input.
- Chips must remain readable in light and dark themes.

## 9. Import and Export

### 9.1 Export

Add `tag` to:

- `SafeEmailServiceExportRow` in `src/entityTypes/emailmarketingType.ts`.
- JSON export payload.
- CSV headers and rows.

The export should contain the display name, not `tagId`, because it is intended for user portability.

### 9.2 Import

For each imported row:

1. Read optional `tag`.
2. Normalize it.
3. Resolve an existing tag.
4. If not found, apply the explicit import policy.
5. Set `candidate.tagId` before create/update.

Recommended first-release policy: add a `createMissingTags` option to the import command/UI and default it to false. When false, an unknown tag should produce a row-level validation error rather than silently creating records.

## 10. Migration Strategy

### 10.1 Existing Databases

Existing services receive `tagId = NULL`. No tags are generated automatically from service names, hosts, or sender addresses.

### 10.2 Fresh Databases

The tag table and nullable service column are created as part of the normal database initialization path.

### 10.3 Upgrade Safety

The migration must:

- Detect whether the tag table already exists.
- Detect whether `email_service.tagId` already exists.
- Preserve all existing service rows and encrypted values.
- Preserve existing indexes and foreign keys.
- Be safe to retry after an interrupted startup.

After migration, run a bounded verification query:

```sql
SELECT COUNT(*) FROM email_service;
SELECT COUNT(*) FROM email_service_tag;
```

The service count must remain unchanged.

## 11. Error Model

Use stable domain errors or error codes that can be localized at the UI boundary:

| Error | Suggested code | Behavior |
| --- | --- | --- |
| Empty tag | `EMAIL_SERVICE_TAG_REQUIRED` | Reject create/update |
| Tag too long | `EMAIL_SERVICE_TAG_TOO_LONG` | Reject create/update |
| Invalid control character | `EMAIL_SERVICE_TAG_INVALID_CHARACTERS` | Reject create/update |
| Duplicate tag | `EMAIL_SERVICE_TAG_DUPLICATE` | Keep dialog open |
| Tag not found | `EMAIL_SERVICE_TAG_NOT_FOUND` | Reject assignment/AI lookup |
| Service not found | `EMAIL_SERVICE_NOT_FOUND` | Return normal service error |
| Tag has assignments | `EMAIL_SERVICE_TAG_ASSIGNMENTS_EXIST` | Return count for confirmation |
| Ambiguous lookup | `EMAIL_SERVICE_TAG_AMBIGUOUS` | Fail closed |

Avoid exposing raw TypeORM or SQLite error text to the renderer or AI.

## 12. Security and Privacy

- Never include SMTP or receive passwords in tag APIs.
- Never include tag values in metrics if tags may contain sensitive business information.
- Validate tags before persistence and before SQL lookup.
- Use parameterized TypeORM queries; do not interpolate tag text into SQL.
- Keep AI responses limited to the existing sanitized service fields plus tag.
- Do not permit the AI to create, rename, or delete tags.
- Keep AI enablement checks before any AI tool work.
- Preserve existing IPC strict schemas and preload allowlists.

## 13. Testing Strategy

### 13.1 Model and Module Tests

Add coverage for:

- Create and read.
- Case-insensitive uniqueness.
- Trim normalization.
- Rename propagation through `tagId` references.
- Delete and unassignment.
- Tag lookup.
- Usage count.
- Existing untagged services.

### 13.2 IPC Tests

Cover:

- Strict schema rejection.
- Unknown tag IDs.
- Duplicate names.
- Delete response with affected-service count.
- Tag filter and untagged filter.
- Preload channel registration.

### 13.3 AI Tool Tests

Extend `test/service/emailMarketingAiTools.test.ts` with:

- `list_email_services` includes tags.
- `get_email_service_config({ tag })` resolves the expected service.
- Tag matching is case-insensitive and trimmed.
- Unknown tag returns `success: false`.
- Both selectors are rejected.
- Passwords remain absent.
- Existing `{ service_id }` behavior remains unchanged.

### 13.4 Component Tests

Add or extend tests under `test/vitest/main/components/` for:

- Tag column rendering.
- Tag filter selection.
- Detail-form assignment and clearing.
- Create-tag validation.
- Rename flow.
- Delete confirmation and affected count.
- Loading and error states.

Run the required component suite with `yarn test:components`.

### 13.5 End-to-End Tests

Add an E2E scenario only if the current test harness can reliably seed the local database:

1. Create a tag.
2. Create an email service assigned to the tag.
3. Filter the service list.
4. Resolve the service using the AI tool seam.
5. Confirm the resulting send request still contains the numeric service ID.

## 14. Observability

Add low-cardinality counters if the existing metrics framework supports them:

- `email_service_tag_create_total`
- `email_service_tag_update_total`
- `email_service_tag_delete_total`
- `email_service_tag_lookup_success_total`
- `email_service_tag_lookup_not_found_total`
- `email_service_tag_lookup_ambiguous_total`

Allowed labels should be outcome or operation type only. Do not use tag names, email addresses, hosts, or service IDs as metric labels.

## 15. Implementation File Plan

### New Files

- `src/entity/EmailServiceTag.entity.ts`
- `src/model/EmailServiceTag.model.ts`
- `src/modules/emailServiceTagModule.ts`
- `src/views/pages/emailservice/widgets/EmailServiceTagDialog.vue`
- Relevant migration/schema file according to the existing database mechanism
- Model/module/IPC/component tests

### Modified Files

- `src/entity/EmailService.entity.ts`
- `src/entityTypes/emailmarketingType.ts`
- `src/entityTypes/emailMarketingAiTypes.ts`
- `src/model/EmailService.model.ts`
- `src/modules/emailServiceModule.ts`
- `src/modules/interface/EmailServiceModuleInterface.ts`
- `src/controller/emailMarketingController.ts`
- `src/main-process/communication/emailMarketingIpc.ts`
- `src/schemas/ipc/emailMarketing.ts`
- `src/config/channellist.ts`
- `src/config/skillsRegistry.ts`
- `src/service/emailMarketingAiTools.ts`
- `src/views/api/emailservice.ts`
- `src/views/pages/emailservice/widgets/EmailServiceTable.vue`
- `src/views/pages/emailservice/servicedetail.vue`
- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`
- Export/import tests and email-service integration tests

## 16. Delivery Sequence

1. Confirm one-tag-per-service scope and import policy.
2. Verify the project's database migration/upgrade mechanism.
3. Implement entity, schema, migration, Model, and Module.
4. Add tag CRUD IPC and preload exposure.
5. Add service list/detail tag support.
6. Add tag-management UI and translations.
7. Add AI list/configuration resolution.
8. Add optional tag selector support to send-task input.
9. Run focused tests, component tests, type checks, and relevant E2E tests.
10. Verify fresh-install and upgrade-database paths.

## 17. Future Extension: Multiple Tags

If product requirements later change to multiple tags per email service, replace `email_service.tagId` with:

```text
email_service_tag_relation
- email_service_id
- tag_id
- unique(email_service_id, tag_id)
```

The tag entity and AI exact-lookup behavior can remain. Tags can already be shared by several services in the first release; multiple tags per service changes assignment cardinality only. AI lookup must continue to require explicit selection whenever more than one service matches.

## 18. Implementation Notes and Verification

- Main-process tag CRUD uses `EmailServiceTagModule` and `EmailServiceTagModel`; all four IPC channels are validated and included in the preload allowlist.
- Assignment uses nullable `tagId`; omitted values preserve the assignment on updates, and explicit null clears it. Deleting a tag uses the SQLite foreign key's `ON DELETE SET NULL`, preserving service rows and credential ciphertext.
- Lookup trims and lowercases exact tag names. Existing ID lookups remain supported; simultaneous ID and tag selectors are rejected. Lookup results and service listings expose a tag display name with the existing sanitized fields.
- The detail form provides a searchable selector and tag management. The table includes tag chips, all/tag/untagged filtering, matching totals, and refresh after rename, delete, or import.
- Import defaults to resolving existing tags. The optional `createMissingTags` checkbox explicitly enables tag creation. Missing columns preserve assignments on update; blank values clear them. CSV/JSON exports and the download template include the display-name field `tag`.
- New UI strings and errors are translated into English, Chinese, Spanish, French, German, and Japanese.
- Privacy-safe operation and lookup counters use the existing email-service metrics helper without tag names or credentials.

Verification entry points:

```sh
yarn typecheck
yarn vue-typecheck
yarn test:components
yarn vitest --config vite.main.config.mjs run test/vitest/main/EmailServiceTags.test.ts test/vitest/main/ipc/emailMarketingIpc.test.ts test/vitest/main/EmailMarketingControllerImport.test.ts
yarn build:e2e
yarn playwright test test/e2e/specs/emailServiceTags.test.ts --workers=1
```

The integration suite checks pre-tag database upgrades, repeated schema initialization, duplicate and concurrent creation, rename propagation, deletion without credential changes, combined list filters and totals, AI ambiguity and secret exclusion, assignment validation, and import/export behavior. The Electron scenario drives create, assign, filter, rename, and delete through the renderer and production IPC bridge using isolated test data.

Verified on 2026-09-27:

| Check | Result |
| --- | --- |
| TypeScript and Vue type checks | Passed |
| Component suite | 63 files, 377 tests passed |
| Tag persistence, AI, import and IPC suites | 3 files, 49 tests passed |
| Existing controller, credential encryption and validation regressions | 82 tests passed |
| Electron E2E build | Passed |
| Tag create/assign/filter/rename/delete Electron scenario | 1 test passed |
| Git whitespace check | Passed |

The focused module regressions ran with the existing Node-compatible SQLite dependency using:

```sh
NODE_OPTIONS='--import tsx' yarn mocha --require tsconfig-paths/register test/modules/emailMarketingController.test.ts test/modules/emailServiceModule.cipher.test.ts test/modules/emailServiceModule.validation.test.ts
```
