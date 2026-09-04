# Email Service Import — Design

**Date:** 2026-09-04
**Branch base:** `test` (the export feature lives on `test`; `master` is an ancestor of `test` HEAD)
**Status:** Approved

## Summary

Add an **Import** function to the Email Service list page, symmetric with the existing **Export** function. Users select a CSV or JSON file via a native open-file dialog; the main process parses, validates, and upserts each row, returning a summary of imported / skipped rows with per-row error messages. The renderer shows a snackbar and reloads the list.

## Goals

- Import email services from a file produced by hand or by the existing export.
- Accept **both CSV and JSON** formats.
- **Partial import:** valid rows import even when some rows are invalid.
- **Upsert by name:** an imported service whose `name` matches an existing service updates it; otherwise a new service is created.
- **Password required:** rows without a password are skipped with a row-number error.
- Honor the project's mandatory architecture rules: three-layer DB access (Module/Controller/IPC), Zod validation at the IPC boundary, file I/O in the main process only.

## Non-Goals

- Matching by host + from (name-only upsert — avoids surprising users who intentionally add a second account on the same host).
- Importing `id` / `create_time` values into the DB (read only for context; the DB assigns ids).
- A preview/parse dialog with paste-text tabs (the export uses a direct file pick; import mirrors it).
- A template-download link.
- Transactional rollback on DB errors mid-import (import is idempotent; the user can re-run).

## Architecture & Data Flow

```
[Renderer] Import button (EmailServiceTable.vue)
    → importEmailServices() in views/api/emailservice.ts
    → windowInvoke(EMAILSERVICEIMPORT, {})
        ↓  (zod: strictObject({}) — no renderer-supplied data crosses the boundary)
[Main] emailMarketingIpc.ts handler:
    1. showOpenDialog (csv/json filter) via getNativeDialogService
       (E2E-safe — same provider as export)
       cancel ⇒ "Import cancelled by user"
    2. fs.readFileSync(filePath, "utf-8"); extension decides parser
    3. controller.importEmailServices(rawContent, format)
[Controller] emailMarketingController.ts:
    4. Parse: Papa.parse (csv) | JSON.parse (json)
    5. Map each row → EmailServiceEntity (whitelist + password;
       id/create_time ignored — used for matching context only)
    6. Per-row validation via module.validateEmailService()
    7. Upsert each valid row via module (name-match ⇒ update; else create)
    8. Collect per-row errors with original file row numbers
[Renderer] receives { imported, skipped, errors[] }
    → snackbar + loadItems({ page: 1, ... }) reload
```

### New channel

`EMAILSERVICEIMPORT = "email:service:import"` (symmetric with `EMAILSERVICEEXPORT = "email:service:export"`).

Whitelisted in three places (same as export):
- `src/config/channellist.ts`
- `src/preload.ts` import block
- `src/preload.ts` invoke whitelist

### File formats

CSV and JSON are both accepted; the file extension selects the parser.

**CSV** — header row with columns (case-insensitive):
```
id, name, from, host, port, ssl, receiveProtocol, create_time, password
```
- `name`, `from`, `host`, `port`, `password` are **required** (blank ⇒ row error).
- `ssl` defaults to `1` when absent/blank.
- `receiveProtocol` defaults to `"imap"` when absent/blank.
- `id`, `create_time` are read but **ignored** on write (DB assigns ids).
- Extra columns are ignored (forward-compatible with re-exported files).

**JSON** — two accepted shapes:
1. Export shape: `{ total: number, services: [...], exportDate: string }`
2. Bare array: `[ { ... }, ... ]`

Each service object uses the same column names as the CSV. Missing `password` ⇒ row error.

**Malformed file** (parse error, wrong JSON shape, no valid header) ⇒ `status: false` with `import_invalid_file`; nothing is written.

## Upsert & Validation Semantics

### Row → entity mapping (strict whitelist)

| Column | Required | Default | Notes |
|---|---|---|---|
| `name` | yes | — | upsert key |
| `from` | yes | — | email format validated |
| `host` | yes | — | SMTP host |
| `port` | yes | — | numeric, validated |
| `password` | yes | — | encrypted via FieldCipher on write |
| `ssl` | no | `1` | |
| `receiveProtocol` | no | `"imap"` | `imap` \| `pop3` |
| `id` | no | — | **ignored** on write |
| `create_time` | no | — | **ignored** on write |

Extra columns ignored.

### Duplicate handling (upsert, name-only)

1. `module.findEmailServiceByName(name)` → match ⇒ `updateEmailService(existing.id, entity)`.
   - Password is **always overwritten** by the imported value. (Import is an explicit act; unlike the edit form's "blank = keep existing" sentinel, import carries the password in the file.)
2. No match ⇒ `createEmailService(entity)`.

### Validation per row

- Reuses the module's existing `validateEmailService` (email format, port numeric, required fields, receive-protocol-specific rules when receive is enabled).
- Plus **password required** (the module's `validateEmailService` already enforces this for create).
- Errors carry the **original file row number**: CSV row index (header is row 1, data starts row 2); JSON array index + 1.

### Result envelope

```typescript
interface EmailServiceImportResult {
  imported: number;
  skipped: number;
  errors: string[]; // capped at first 10, e.g. "row 4: password is required"
}
```

- Empty file / zero valid rows ⇒ `status: false`, message `import_no_valid_rows`, nothing written.

### Security

- Passwords are accepted in, encrypted via the module's existing `FieldCipher` path on write (same as create).
- Passwords are **never logged** and **never returned** in the result envelope (only counts + row-number messages).
- File parsing happens in the **main process**; untrusted file content never enters the renderer.

## UI

`EmailServiceTable.vue` — an Import button mirroring the Export button:

- Placed between "Create" and "Export".
- Same conditional: `v-if="!isSelectedtable"`.
- `prepend-icon="mdi-import"`, `color="secondary"`, `data-testid="email-service-import-btn"`, `:loading="importing"`.
- Click → `importEmailServices()` → on result: snackbar + `loadItems({ page: 1, itemsPerPage, sortBy: [] })` reload.
- On cancel: info-type "Import cancelled".
- On failure: error snackbar with message (same try/catch shape as `handleExport`).

### Snackbar messages

- **Full success** (success type): `Import successful: {imported} imported`.
- **Partial** (warning type): `Imported {imported}, skipped {skipped} invalid rows: {errors.join(", ")}` (errors capped).
- **Cancel** (info type): `Import cancelled`.
- **Failure** (error type): `Import failed: {message}`.

### API layer (`src/views/api/emailservice.ts`)

```typescript
export interface EmailServiceImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importEmailServices(): Promise<EmailServiceImportResult>
```

Errors surface through the existing envelope (`status:false` → wrapper rejects → component catch), same as export.

## i18n

New `common.*` keys in all 6 language files (`src/views/lang/{en,zh,es,fr,de,ja}.ts`):

- `import` — already exists ✓
- `import_success` — `Import successful`
- `import_partial` — `Imported {imported}, skipped {skipped} invalid rows`
- `import_partial_skipped` — row-list suffix template
- `import_cancelled` — `Import cancelled`
- `import_failed` — `Import failed`
- `import_no_valid_rows` — `No valid services found in file`
- `import_invalid_file` — `Invalid file format`

All user-facing strings go through `t('common.xxx') || 'English fallback'`.

## Error Handling

| Layer | Failure | Behavior |
|---|---|---|
| Dialog | user cancels | typed "cancelled" error, no file read, `status:false` |
| File | unreadable | catch, `status:false` + `import_failed` |
| Parse | malformed CSV/JSON, wrong shape | `status:false` + `import_invalid_file`, nothing written |
| Row | missing/invalid field | collected; valid rows still import (partial) |
| DB | error mid-import | failing row becomes a row error; earlier rows stay imported (no rollback — idempotent, re-runnable) |

No silent swallows at any layer.

## Testing

Mirrors the export feature's two test files.

### IPC handler tests (`test/vitest/main/ipc/emailMarketingIpc.test.ts` — extend)

- registers the channel
- valid CSV file → `imported` count, controller called with content + format
- valid JSON file → same
- invalid rows mixed with valid → partial result (`skipped` + `errors`)
- cancel → `status:false`, controller not called
- malformed file → `import_invalid_file` error, controller returns 0 imported

Mocks: `getNativeDialogService` (adds `showOpenDialog`), controller's `importEmailServices`.

### Component tests (`test/vitest/main/components/EmailServiceTable.test.ts` — extend)

- import button renders (standalone list mode)
- hidden in selection mode (`isSelectedtable=true`)
- success snackbar with count
- partial-warning snackbar
- cancel snackbar
- failure snackbar
- list reload (`loadItems`) called after success/partial

### Controller parsing/validation unit tests (new test file under `test/vitest/main/`)

- CSV parse → row mapping
- JSON (export-shape and bare-array) parse → row mapping
- missing password → row error
- name-match → update (not create)
- unknown columns ignored
- malformed input → invalid-file result

### Gates

- `yarn test:components` must pass (hard CI gate).
- `yarn testmain` must pass (vitest main-process suite, incl. `tsc --noEmit` type-check gate).
- `yarn vue-check` for Vue type checking.

## Implementation Notes

- The new channel, preload entries, zod schema, IPC handler, controller method, and module method form one logical unit; the UI button + tests form another. Commits follow conventional `feat:` messages, one logical unit per commit (per CLAUDE.md auto-commit rule).
- Work is done in a git worktree off the `test` branch (export feature base).
- `papaparse` is already a dependency (`^5.4.1` + `@types/papaparse`).
- `getNativeDialogService` already exposes `showOpenDialog`; the mock in the export test already stubs it as `vi.fn()` — extend the same mock.
