# Email Service List Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user import email services into the email service list (`src/views/pages/emailservice/list.vue` → `EmailServiceTable.vue`) from a CSV or JSON file chosen via the native open-file dialog, with partial-import upsert-by-name semantics and per-row error reporting.

**Architecture:** Mirrors the existing export stack end-to-end, in reverse: the renderer calls a new `EMAILSERVICEIMPORT` IPC channel carrying an empty Zod-validated payload (no renderer-supplied data crosses the boundary); a `registerValidatedHandler` in `emailMarketingIpc.ts` opens the OS open-file dialog through `getNativeDialogService()`, reads the file in the main process, and delegates parsing + per-row validation + upsert to `EmailMarketingController.importEmailServices(content, format)`. The controller parses with `papaparse` (CSV) / `JSON.parse` (JSON), maps each row to a strict whitelist of `EmailServiceEntity` fields (including `password` — which export deliberately omits), validates each row via the module's existing `validateEmailService`, and upserts by name (match ⇒ `updateEmailService`, else `createEmailService`). It returns `{ imported, skipped, errors[] }`; the renderer shows a snackbar and reloads the list.

**Tech Stack:** Electron IPC + Zod v4 strict schema (`zod/v4`), TypeORM module/model layer, `papaparse` (`import Papa from "papaparse"`), Vue 3 + Vuetify + vue-i18n, Vitest (IPC + component) and Mocha+Sinon (controller).

**Worktree:** `.claude/worktrees/email-service-import` (branch `worktree-email-service-import`, based on `test` tip — the export feature lives on `test`; `master` is an ancestor of `test` HEAD).

**i18n:** `common.import` already exists in all 6 language files (verified in en/zh). New `common.import_*` keys are added in Task 5 to all 6 files (en, zh, es, fr, de, ja).

**No AI gate:** this is not an AI feature (uses `registerValidatedHandler`, not `registerAiValidatedHandler`).

---

## File Structure

| Layer | File | Change |
|---|---|---|
| Channel | `src/config/channellist.ts` | Add `EMAILSERVICEIMPORT` constant |
| Schema | `src/schemas/ipc/emailMarketing.ts` | Add `emailServiceImportInputSchema` |
| Controller | `src/controller/emailMarketingController.ts` | Add `importEmailServices(content, format)` |
| Types | `src/entityTypes/emailmarketingType.ts` | Add `EmailServiceImportResult` type |
| IPC handler | `src/main-process/communication/emailMarketingIpc.ts` | Register import handler + open dialog + fs read |
| Preload | `src/preload.ts` | Allowlist the new channel (2 spots: import + invoke list) |
| Frontend API | `src/views/api/emailservice.ts` | Add `importEmailServices()` + `EmailServiceImportResult` type |
| UI | `src/views/pages/emailservice/widgets/EmailServiceTable.vue` | Import button + loading + NoticeSnackbar feedback + list reload |
| i18n | `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add `common.import_*` keys (8 new) |
| Tests | `test/modules/emailMarketingController.test.ts` | Controller import parse/validate/upsert tests (Mocha+Sinon) |
| Tests | `test/vitest/main/ipc/emailMarketingIpc.test.ts` | IPC handler import tests (extend) |
| Tests | `test/vitest/main/components/EmailServiceTable.test.ts` | Component import tests (extend) |

**Note on controller test placement:** CLAUDE.md's test-placement rule says "Controller tests: `test/modules/`". The export feature put its controller tests in the Mocha file `test/modules/emailMarketingController.test.ts`, and the controller constructor instantiates real Modules (which read `Token`/`USERSDBPATH` and the SQLite DB) — so vitest-main tests that instantiate the real controller would need heavy electron/DB mocking. We follow the export precedent: controller import tests go in the Mocha file with Sinon-stubbed `emailServiceModule`, matching existing `createEmailService` tests.

---

### Task 1: Controller — `importEmailServices(content, format)` + result type

**Files:**
- Modify: `src/entityTypes/emailmarketingType.ts`
- Modify: `src/controller/emailMarketingController.ts`
- Test: `test/modules/emailMarketingController.test.ts`

- [ ] **Step 1.1: Add the `EmailServiceImportResult` type**

In `src/entityTypes/emailmarketingType.ts`, after the `EmailServiceExportPayload` type:

```typescript
/** Result envelope for email service import (counts + per-row errors). */
export type EmailServiceImportResult = {
  imported: number;
  skipped: number;
  errors: string[]; // capped at first 10, e.g. "row 4: password is required"
};
```

- [ ] **Step 1.2: Write the failing controller tests (Mocha, TDD)**

Append inside `describe("EmailMarketingController", () => { ... })` in `test/modules/emailMarketingController.test.ts` — after the `exportEmailServices` describe block (or after `createEmailService` if the export block doesn't exist on this branch yet; place it as the last `describe` inside the outer block). The controller's `emailServiceModule` is stubbed per-test so no DB is touched.

```typescript
  describe("importEmailServices", () => {
    // Build a stubbed module with sensible defaults; individual tests override
    // the methods they care about.
    const makeStubModule = (overrides: Partial<
      Record<
        "findEmailServiceByName" | "createEmailService" | "updateEmailService" | "validateEmailService",
        unknown
      >
    > = {}) => {
      const existing: EmailServiceEntity | undefined = undefined;
      return {
        findEmailServiceByName:
          overrides.findEmailServiceByName ??
          sinon.stub().resolves(existing),
        createEmailService: overrides.createEmailService ?? sinon.stub().resolves(1),
        updateEmailService: overrides.updateEmailService ?? sinon.stub().resolves(),
        validateEmailService:
          overrides.validateEmailService ??
          sinon.stub().resolves({ valid: true, errors: [] }),
      } as unknown as EmailServiceModuleInterface;
    };

    it("parses a valid CSV and upserts each row (create when no name match)", async () => {
      const create = sinon.stub().resolves(5);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password,receiveProtocol\n" +
        "Primary,user1@example.com,smtp.example.com,465,1,secret1,imap\n" +
        "Secondary,user2@example.com,smtp2.example.com,587,0,secret2,imap\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(2);
      expect(result.skipped).to.equal(0);
      expect(create.calledTwice).to.equal(true);
      expect(create.firstCall.args[0].name).to.equal("Primary");
      expect(create.firstCall.args[0].password).to.equal("secret1");
      expect(create.secondCall.args[0].name).to.equal("Secondary");
    });

    it("updates an existing service when the name matches (no create)", async () => {
      const existing = new EmailServiceEntity();
      existing.id = 7;
      existing.name = "Primary SMTP";
      const update = sinon.stub().resolves();
      const create = sinon.stub().resolves(99);
      emailMarketingController.emailServiceModule = makeStubModule({
        findEmailServiceByName: sinon.stub().resolves(existing),
        updateEmailService: update,
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "Primary SMTP,sender@example.com,smtp.example.com,465,1,newpass\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(update.calledOnce).to.equal(true);
      expect(update.firstCall.args[0]).to.equal(7); // existing id
      expect(update.firstCall.args[1].password).to.equal("newpass"); // overwritten
      expect(create.called).to.equal(false);
    });

    it("skips rows with a missing password and reports the file row number", async () => {
      // validateEmailService returns errors for the passwordless row.
      const validate = sinon.stub();
      validate.onCall(0).resolves({ valid: false, errors: ["Password is required"] });
      validate.onCall(1).resolves({ valid: true, errors: [] });
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        validateEmailService: validate,
        createEmailService: create,
      });

      const csv =
        "name,from,host,port,ssl,password\n" +
        "NoPass,user@example.com,smtp.example.com,465,1,\n" + // row 2
        "WithPass,user2@example.com,smtp2.example.com,465,1,secret\n"; // row 3

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(result.skipped).to.equal(1);
      expect(result.errors.some((e) => /row 2/.test(e))).to.equal(true);
      expect(result.errors.some((e) => /password/i.test(e))).to.equal(true);
      expect(create.calledOnce).to.equal(true);
      expect(create.firstCall.args[0].name).to.equal("WithPass");
    });

    it("parses JSON in export-shape ({total,services,exportDate}) and imports", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const json = JSON.stringify({
        total: 1,
        services: [
          {
            name: "Primary SMTP",
            from: "sender@example.com",
            host: "smtp.example.com",
            port: "465",
            ssl: 1,
            password: "secret",
            receiveProtocol: "imap",
          },
        ],
        exportDate: "2026-09-04T00:00:00.000Z",
      });

      const result = (await emailMarketingController.importEmailServices(
        json,
        "json"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
      expect(create.firstCall.args[0].from).to.equal("sender@example.com");
    });

    it("parses JSON in bare-array shape and imports", async () => {
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });

      const json = JSON.stringify([
        { name: "A", from: "a@example.com", host: "h", port: "25", ssl: 1, password: "p" },
      ]);

      const result = (await emailMarketingController.importEmailServices(
        json,
        "json"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(1);
    });

    it("returns 0 imported and a skipped count for a CSV with no data rows", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      const csv = "name,from,host,port,ssl,password\n";

      const result = (await emailMarketingController.importEmailServices(
        csv,
        "csv"
      )) as EmailServiceImportResult;

      expect(result.imported).to.equal(0);
      expect(result.skipped).to.equal(0);
    });

    it("throws on malformed JSON (invalid-file signal to the IPC layer)", async () => {
      emailMarketingController.emailServiceModule = makeStubModule();
      let threw = false;
      try {
        await emailMarketingController.importEmailServices("{ not json ", "json");
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });

    it("applies defaults: ssl=1, receiveProtocol=imap when columns absent", async () => {
      // A minimal CSV with only required columns — ssl/receiveProtocol columns omitted.
      const create = sinon.stub().resolves(1);
      emailMarketingController.emailServiceModule = makeStubModule({
        createEmailService: create,
      });
      const csv =
        "name,from,host,port,password\n" +
        "Minimal,m@example.com,smtp.example.com,465,pw\n";

      await emailMarketingController.importEmailServices(csv, "csv");

      expect(create.firstCall.args[0].ssl).to.equal(1);
      expect(create.firstCall.args[0].receiveProtocol).to.equal("imap");
    });
  });
```

Add these imports at the top of the test file if not already present (they are present in the existing file — `EmailServiceEntity`, `EmailServiceModuleInterface` are already imported; add `EmailServiceImportResult`):

```typescript
import type { EmailServiceImportResult } from "@/entityTypes/emailmarketingType";
```

- [ ] **Step 1.3: Run the tests to verify they FAIL**

Run: `yarn test test/modules/emailMarketingController.test.ts`
Expected: FAIL — `emailMarketingController.importEmailServices is not a function` (the new `describe` block's tests fail; existing tests still pass).

- [ ] **Step 1.4: Implement `importEmailServices` in the controller**

In `src/controller/emailMarketingController.ts`:

(a) Add imports at the top of the file. `papaparse` follows the project's established `import Papa from "papaparse"` pattern (see `proxy-controller.ts:3`, `SpreadsheetConversionService.ts:3`):

```typescript
import Papa from "papaparse";
```

Add `EmailServiceImportResult` to the existing `@/entityTypes/emailmarketingType` import block:

```typescript
import {
  EmailFilterdata,
  EmailServiceListdata,
  EmailServiceEntitydata,
  EmailSendParam,
  EmailServiceExportPayload,
  EmailServiceImportResult,
} from "@/entityTypes/emailmarketingType";
```

(b) Add the method after `exportEmailServices` (before `escapeCsvField` if present, or before the closing brace of the class). The method maps each row to a strict whitelist of entity fields, validates each row via the module, and upserts by name. `id` and `create_time` from the file are read but **ignored** on write (the DB assigns ids). Use a `for` loop with `await` inside (NOT `forEach` — `forEach` does not await its callback, so the counts would all read 0 when the function returns).

```typescript
  // Import email services from raw file content. format: "csv" | "json".
  // Parses, maps each row to a strict field whitelist (including password),
  // validates each row, and upserts by name. id / create_time are read but
  // ignored on write. Returns counts + per-row errors with file row numbers.
  public async importEmailServices(
    content: string,
    format: "csv" | "json"
  ): Promise<EmailServiceImportResult> {
    const rows: Record<string, string>[] = this.parseImportContent(content, format);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let index = 0; index < rows.length; index++) {
      // File row number: CSV header is row 1, data starts row 2; JSON array
      // index + 1 (so a single-element file reports "row 1").
      const rowNumber = index + (format === "csv" ? 2 : 1);
      const entity = this.mapImportRowToEntity(rows[index]);
      const name = entity.name ?? "";

      // validateEmailService covers email format, port numeric, required
      // fields (incl. password), and receive-protocol-specific rules.
      const validation =
        await this.emailServiceModule.validateEmailService(entity);
      if (!validation.valid) {
        skipped++;
        errors.push(`row ${rowNumber}: ${validation.errors.join("; ")}`);
        continue;
      }
      try {
        const existing = name
          ? await this.emailServiceModule.findEmailServiceByName(name)
          : undefined;
        if (existing?.id && existing.id > 0) {
          // Password is always overwritten by the imported value (import is
          // an explicit act; the file carries the password).
          await this.emailServiceModule.updateEmailService(existing.id, entity);
        } else {
          await this.emailServiceModule.createEmailService(entity);
        }
        imported++;
      } catch (rowError) {
        skipped++;
        const reason =
          rowError instanceof Error ? rowError.message : String(rowError);
        errors.push(`row ${rowNumber}: ${reason}`);
      }
    }

    // Cap reported errors to the first 10 to keep the snackbar readable.
    const cappedErrors = errors.slice(0, 10);
    return { imported, skipped, errors: cappedErrors };
  }

  /** Parse raw import content into a list of row records. Throws on malformed input. */
  private parseImportContent(
    content: string,
    format: "csv" | "json"
  ): Record<string, string>[] {
    if (format === "json") {
      const parsed: unknown = JSON.parse(content);
      // Export shape { total, services, exportDate } or bare array.
      if (Array.isArray(parsed)) {
        return parsed as Record<string, string>[];
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { services?: unknown }).services)
      ) {
        return (parsed as { services: Record<string, string>[] }).services;
      }
      throw new Error("Invalid JSON structure for import");
    }

    // CSV — header row, case-insensitive columns.
    const result = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim().toLowerCase(),
    });
    if (result.errors && result.errors.length > 0) {
      // Papa reports structural parse errors (quote mismatches, etc.).
      throw new Error(`CSV parse error: ${result.errors[0].message}`);
    }
    return (result.data as Record<string, string>[]).filter(
      (row) => row && Object.keys(row).length > 0
    );
  }

  /** Map a parsed row record to an EmailServiceEntity (strict whitelist). */
  private mapImportRowToEntity(row: Record<string, string>): EmailServiceEntity {
    const entity = new EmailServiceEntity();
    entity.name = (row.name ?? "").trim();
    entity.from = (row.from ?? "").trim();
    entity.host = (row.host ?? "").trim();
    entity.port = (row.port ?? "").trim();
    entity.password = (row.password ?? "").trim();
    // ssl defaults to 1 when absent/blank.
    const sslRaw = (row.ssl ?? "").trim();
    entity.ssl = sslRaw.length === 0 ? 1 : Number(sslRaw);
    // receiveProtocol defaults to "imap" when absent/blank.
    const protocolRaw = (row.receiveProtocol ?? "").trim().toLowerCase();
    entity.receiveProtocol =
      protocolRaw.length === 0 ? "imap" : (protocolRaw as EmailServiceEntity["receiveProtocol"]);
    // id and create_time are read but intentionally ignored on write.
    return entity;
  }
```

- [ ] **Step 1.5: Run the controller tests to verify they PASS**

Run: `yarn test test/modules/emailMarketingController.test.ts`
Expected: all passing — the existing `createEmailService`/`exportEmailServices` tests plus the 8 new `importEmailServices` tests.

- [ ] **Step 1.6: Type-check the two changed source files**

Run: `npx tsc --noEmit 2>&1 | grep -E "emailMarketingController|emailmarketingType" | head -20`
Expected: no errors mentioning these files (the IPC layer will still fail until Task 2 — that's fine; this gate only checks these two files).

- [ ] **Step 1.7: Commit**

```bash
git add src/entityTypes/emailmarketingType.ts src/controller/emailMarketingController.ts test/modules/emailMarketingController.test.ts
git commit -m "feat: add EmailMarketingController.importEmailServices with CSV/JSON parse, validate, and upsert-by-name"
```

---

### Task 2: IPC handler — `EMAILSERVICEIMPORT`

**Files:**
- Modify: `src/config/channellist.ts`
- Modify: `src/schemas/ipc/emailMarketing.ts`
- Modify: `src/main-process/communication/emailMarketingIpc.ts`
- Modify: `src/preload.ts`
- Test: `test/vitest/main/ipc/emailMarketingIpc.test.ts`

- [ ] **Step 2.1: Add the channel constant**

In `src/config/channellist.ts`, after `EMAILSERVICEEXPORT` (line 57):

```typescript
export const EMAILSERVICEIMPORT = "email:service:import";
```

- [ ] **Step 2.2: Add the Zod schema**

In `src/schemas/ipc/emailMarketing.ts`, after `emailServiceExportInputSchema`:

```typescript
/**
 * EMAILSERVICEIMPORT: the renderer sends no data — the file path is chosen
 * via the native open dialog in the main process. An empty strict object
 * validates that no unexpected payload crosses the boundary.
 */
export const emailServiceImportInputSchema = lazySchema(() =>
  z.strictObject({})
);
```

- [ ] **Step 2.3: Register the IPC handler**

In `src/main-process/communication/emailMarketingIpc.ts`:

(a) Add `EMAILSERVICEIMPORT` to the `@/config/channellist` import block (alongside `EMAILSERVICEEXPORT`).

(b) Add `emailServiceImportInputSchema` to the `@/schemas/ipc/emailMarketing` import block (alongside `emailServiceExportInputSchema`). `app`, `ipcMain`, `fs`, `path`, and `getNativeDialogService` are already imported by the export handler — no new imports needed.

(c) Add the handler inside `registerEmailMarketingIpcHandlers()`, after the `EMAILSERVICEEXPORT` handler block (before the `SENDTESTEMAIL` `ipcMain.on` block):

```typescript
  // ── Service import ────────────────────────────────────────────────────

  registerValidatedHandler(
    EMAILSERVICEIMPORT,
    emailServiceImportInputSchema,
    async () => {
      const dialogService = await getNativeDialogService();
      const dialogResult = await dialogService.showOpenDialog({
        title: "Import Email Services",
        defaultPath: app.getPath("documents"),
        filters: [
          { name: "CSV Files", extensions: ["csv"] },
          { name: "JSON Files", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
        properties: ["openFile"],
      });
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        throw new Error("Import cancelled by user");
      }
      const filePath = dialogResult.filePaths[0];
      const ext = path.extname(filePath).toLowerCase().replace(".", "");
      const format: "csv" | "json" = ext === "json" ? "json" : "csv";
      const content = fs.readFileSync(filePath, "utf-8");

      const controller = new EmailMarketingController();
      let result;
      try {
        result = await controller.importEmailServices(content, format);
      } catch (parseError) {
        // Malformed CSV/JSON or wrong structure — nothing was written.
        // Map to the import_invalid_file message key (per spec error table).
        throw new Error(
          `import_invalid_file${
            parseError instanceof Error ? `: ${parseError.message}` : ""
          }`
        );
      }

      // Empty file / zero valid rows: surface as a failure envelope so the
      // renderer shows the "no valid rows" message instead of a silent reload.
      if (result.imported === 0 && result.skipped === 0) {
        throw new Error("import_no_valid_rows");
      }
      return result;
    }
  );
```

- [ ] **Step 2.4: Preload allowlist**

In `src/preload.ts`:
1. Add `EMAILSERVICEIMPORT,` to the channellist import block (after `EMAILSERVICEEXPORT,` — line 44).
2. Add `EMAILSERVICEIMPORT,` to the `invoke` allowlist (after `EMAILSERVICEEXPORT,` — line 785).

- [ ] **Step 2.5: Extend the IPC tests**

In `test/vitest/main/ipc/emailMarketingIpc.test.ts`:

(a) Add `mockImportEmailServices` and `mockShowOpenDialog` hoisted mocks near the existing `mockExportEmailServices`/`mockShowSaveDialog`:

```typescript
const mockImportEmailServices = vi.hoisted(() => vi.fn());
const mockShowOpenDialog = vi.hoisted(() => vi.fn());
```

(b) Extend the `EmailMarketingController` mock factory to expose `importEmailServices`:

```typescript
vi.mock('@/controller/emailMarketingController', () => ({
  EmailMarketingController: vi.fn().mockImplementation(() => ({
    exportEmailServices: mockExportEmailServices,
    importEmailServices: mockImportEmailServices,
  })),
}));
```

(c) Extend the `getNativeDialogService` mock factory so `showOpenDialog` uses the hoisted mock (replace the existing `showOpenDialog: vi.fn()`):

```typescript
vi.mock('@/service/dialogs/NativeDialogServiceProvider', () => ({
  getNativeDialogService: vi.fn().mockImplementation(() =>
    Promise.resolve({
      showSaveDialog: mockShowSaveDialog,
      showOpenDialog: mockShowOpenDialog,
      showMessageBox: vi.fn(),
    })
  ),
}));
```

(d) Add `EMAILSERVICEIMPORT` to the channellist import (alongside `EMAILSERVICEEXPORT`) and add a tmp import-path constant near `tmpExportPath`:

```typescript
import { EMAILSERVICEEXPORT, EMAILSERVICEIMPORT } from '@/config/channellist';
```

```typescript
  const tmpImportCsvPath = path.join(os.tmpdir(), 'email_services_import_test.csv');
  const tmpImportJsonPath = path.join(os.tmpdir(), 'email_services_import_test.json');
```

(e) Add a new `describe('import', ...)` block inside the existing top-level `describe('Email Marketing IPC Handlers', ...)`, after the existing export tests. Write real CSV/JSON files to tmp so `fs.readFileSync` reads them:

```typescript
  describe('import', () => {
    afterEach(() => {
      for (const file of [tmpImportCsvPath, tmpImportJsonPath]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    });

    test('registers the import channel', () => {
      expect(mockIpcMain.getRegisteredChannels()).toContain(EMAILSERVICEIMPORT);
    });

    test('reads a CSV file, calls the controller, and returns the result', async () => {
      const csv =
        'name,from,host,port,ssl,password\nPrimary,user@example.com,smtp.example.com,465,1,secret\n';
      fs.writeFileSync(tmpImportCsvPath, csv, 'utf-8');
      mockImportEmailServices.mockResolvedValue({
        imported: 1,
        skipped: 0,
        errors: [],
      });
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpImportCsvPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        {}
      )) as CommonMessage<{ imported: number; skipped: number; errors: string[] }>;

      expect(result.status).toBe(true);
      expect(result.data.imported).toBe(1);
      expect(mockImportEmailServices).toHaveBeenCalledWith(csv, 'csv');
    });

    test('reads a JSON file and passes json format to the controller', async () => {
      const json = JSON.stringify({
        total: 1,
        services: [{ name: 'Primary', from: 'a@example.com' }],
      });
      fs.writeFileSync(tmpImportJsonPath, json, 'utf-8');
      mockImportEmailServices.mockResolvedValue({
        imported: 1,
        skipped: 0,
        errors: [],
      });
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpImportJsonPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        {}
      )) as CommonMessage<{ imported: number; skipped: number; errors: string[] }>;

      expect(result.status).toBe(true);
      expect(mockImportEmailServices).toHaveBeenCalledWith(json, 'json');
    });

    test('returns status:false when the user cancels the open dialog', async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        {}
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toContain('cancelled');
      expect(mockImportEmailServices).not.toHaveBeenCalled();
    });

    test('returns status:false with import_no_valid_rows when nothing imported', async () => {
      fs.writeFileSync(tmpImportCsvPath, 'name,from\n', 'utf-8');
      mockImportEmailServices.mockResolvedValue({
        imported: 0,
        skipped: 0,
        errors: [],
      });
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpImportCsvPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        {}
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toContain('import_no_valid_rows');
    });

    test('returns partial result (imported + skipped + errors) as success', async () => {
      fs.writeFileSync(
        tmpImportCsvPath,
        'name,from,host,port,ssl,password\nBad,,h,465,1,\nGood,g@x.com,h,465,1,pw\n',
        'utf-8'
      );
      mockImportEmailServices.mockResolvedValue({
        imported: 1,
        skipped: 1,
        errors: ['row 2: Password is required'],
      });
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpImportCsvPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        {}
      )) as CommonMessage<{ imported: number; skipped: number; errors: string[] }>;

      expect(result.status).toBe(true);
      expect(result.data.imported).toBe(1);
      expect(result.data.skipped).toBe(1);
      expect(result.data.errors[0]).toContain('row 2');
    });

    test('returns status:false with import_invalid_file when the file is malformed JSON', async () => {
      const malformed = '{ not json ';
      fs.writeFileSync(tmpImportJsonPath, malformed, 'utf-8');
      // The controller rejects malformed JSON; the handler maps it to
      // import_invalid_file. (mock rejects to simulate JSON.parse throwing.)
      mockImportEmailServices.mockRejectedValue(new SyntaxError('Unexpected token'));
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpImportJsonPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        {}
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toContain('import_invalid_file');
    });
  });
```

- [ ] **Step 2.6: Run the IPC tests**

Run: `yarn testmain test/vitest/main/ipc/emailMarketingIpc.test.ts`
Expected: all passing — the existing export tests plus the 6 new import tests.

- [ ] **Step 2.7: Commit**

```bash
git add src/config/channellist.ts src/schemas/ipc/emailMarketing.ts src/main-process/communication/emailMarketingIpc.ts src/preload.ts test/vitest/main/ipc/emailMarketingIpc.test.ts
git commit -m "feat: add EMAILSERVICEIMPORT IPC handler with open dialog and zod schema"
```

---

### Task 3: Frontend API — `importEmailServices()`

**Files:**
- Modify: `src/views/api/emailservice.ts`

- [ ] **Step 3.1: Add the API function and result type**

In `src/views/api/emailservice.ts`:

(a) Add `EMAILSERVICEIMPORT` to the channellist import block (after `EMAILSERVICEEXPORT`):

```typescript
import {
  EMAILSERVICEUPDATE,
  EMAILSERVICEDETAIL,
  EMAILSERVICELIST,
  EMAILSERVICEDELETE,
  EMAILSERVICEEXPORT,
  EMAILSERVICEIMPORT,
  SENDTESTEMAIL,
  RECEIVESENDTESTEMAILMESSAGE,
} from "@/config/channellist";
```

(b) Add the type and function after `exportEmailServices` (before `sendTestemail`):

```typescript
/** Result envelope for email service import (counts + per-row errors). */
export interface EmailServiceImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// import email services from a file chosen via the native open dialog.
// Resolves with the import summary; rejects (Error) on cancel/failure so the
// component's try/catch can pick the snackbar type.
export async function importEmailServices(): Promise<EmailServiceImportResult> {
  const resp = await windowInvoke(EMAILSERVICEIMPORT, {});
  if (!resp) {
    throw new Error("unknow error");
  }
  return resp as EmailServiceImportResult;
}
```

- [ ] **Step 3.2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "emailservice.ts" | head -10`
Expected: no errors (the component isn't wired yet, but the API file compiles on its own).

- [ ] **Step 3.3: Commit**

```bash
git add src/views/api/emailservice.ts
git commit -m "feat: add importEmailServices frontend API function"
```

---

### Task 4: UI — import button with snackbar feedback + list reload

**Files:**
- Modify: `src/views/pages/emailservice/widgets/EmailServiceTable.vue`
- Test: `test/vitest/main/components/EmailServiceTable.test.ts`

- [ ] **Step 4.1: Extend the component test FIRST (TDD)**

In `test/vitest/main/components/EmailServiceTable.test.ts`:

(a) Add `importEmailServices` to the hoisted `apiMocks`:

```typescript
const apiMocks = vi.hoisted(() => ({
  getEmailServiceList: vi.fn(),
  deleteEmailService: vi.fn(),
  exportEmailServices: vi.fn(),
  importEmailServices: vi.fn(),
}));
```

(b) Add `importEmailServices` to the `vi.mock('@/views/api/emailservice', ...)` factory:

```typescript
vi.mock('@/views/api/emailservice', () => ({
  getEmailServiceList: (...args: unknown[]) => apiMocks.getEmailServiceList(...args),
  deleteEmailService: (...args: unknown[]) => apiMocks.deleteEmailService(...args),
  exportEmailServices: (...args: unknown[]) => apiMocks.exportEmailServices(...args),
  importEmailServices: (...args: unknown[]) => apiMocks.importEmailServices(...args),
}));
```

(c) Add the import i18n keys to the `en` `common` block in the test's `messages`:

```typescript
      common: {
        export: 'Export',
        export_success: 'Export successful',
        export_failed: 'Export failed',
        export_cancelled: 'Export cancelled',
        import: 'Import',
        import_success: 'Import successful',
        import_partial: 'Imported {imported}, skipped {skipped} invalid rows',
        import_partial_skipped: ': {errors}',
        import_cancelled: 'Import cancelled',
        import_failed: 'Import failed',
        import_no_valid_rows: 'No valid services found in file',
        import_invalid_file: 'Invalid file format',
        actions: 'Actions',
        created_time: 'created time',
      },
```

(d) Add a new `describe('EmailServiceTable import', ...)` block after the existing export block:

```typescript
describe('EmailServiceTable import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getEmailServiceList.mockResolvedValue({ data: SAMPLE, total: 1 });
  });

  it('renders an import button (standalone list mode)', () => {
    const wrapper = mountTable();
    expect(
      wrapper.find('[data-testid="email-service-import-btn"]').exists()
    ).toBe(true);
  });

  it('hides the import button in selection mode (isSelectedtable=true)', () => {
    const wrapper = mountTable({ isSelectedtable: true });
    expect(
      wrapper.find('[data-testid="email-service-import-btn"]').exists()
    ).toBe(false);
  });

  it('shows a success snackbar and reloads the list on full success', async () => {
    apiMocks.importEmailServices.mockResolvedValue({
      imported: 3,
      skipped: 0,
      errors: [],
    });
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-import-btn"]').trigger('click');
    await vi.waitFor(() => {
      expect(apiMocks.importEmailServices).toHaveBeenCalled();
    });

    const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
    expect(snackbar.exists()).toBe(true);
    expect(snackbar.attributes('data-type')).toBe('success');
    expect(snackbar.attributes('data-message')).toContain('3');
  });

  it('shows a warning snackbar on partial import', async () => {
    apiMocks.importEmailServices.mockResolvedValue({
      imported: 1,
      skipped: 2,
      errors: ['row 2: password is required'],
    });
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-import-btn"]').trigger('click');
    await vi.waitFor(() => {
      const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
      expect(snackbar.exists()).toBe(true);
      expect(snackbar.attributes('data-type')).toBe('warning');
      expect(snackbar.attributes('data-message')).toContain('1');
      expect(snackbar.attributes('data-message')).toContain('2');
    });
  });

  it('shows a cancelled notice when the user cancels the open dialog', async () => {
    apiMocks.importEmailServices.mockRejectedValue(
      new Error('Import cancelled by user')
    );
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-import-btn"]').trigger('click');
    await vi.waitFor(() => {
      const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
      expect(snackbar.exists()).toBe(true);
      expect(snackbar.attributes('data-message')).toContain('Import cancelled');
    });
  });

  it('shows an error notice when the import fails for another reason', async () => {
    apiMocks.importEmailServices.mockRejectedValue(
      new Error('import_no_valid_rows')
    );
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-import-btn"]').trigger('click');
    await vi.waitFor(() => {
      const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
      expect(snackbar.exists()).toBe(true);
      expect(snackbar.attributes('data-message')).toContain('Import failed');
    });
  });
});
```

- [ ] **Step 4.2: Run the test to verify it FAILS (import button does not exist yet)**

Run: `yarn test:components test/vitest/main/components/EmailServiceTable.test.ts`
Expected: FAIL — `[data-testid="email-service-import-btn"]` not found (new tests fail; existing export tests still pass).

- [ ] **Step 4.3: Add the Import button to the template**

In `src/views/pages/emailservice/widgets/EmailServiceTable.vue`, add the Import button **after the Export button** (inside the `search_tool` div, after the `v-btn` with `data-testid="email-service-export-btn"`):

```html
            <v-btn
                v-if="!isSelectedtable"
                class="btn ml-3" variant="flat" prepend-icon="mdi-import" color="secondary"
                :loading="importing"
                data-testid="email-service-import-btn"
                @click="handleImport"
            >
                {{ t('common.import') }}
            </v-btn>
```

Add a second NoticeSnackbar for import (after the export `notice-snackbar`, so import feedback doesn't fight the export snackbar's `v-model`):

```html
    <notice-snackbar
        v-model="importNotice.show"
        :message="importNotice.message"
        :type="importNotice.type"
    />
```

- [ ] **Step 4.4: Add the import logic to the script section**

In the `<script setup lang="ts">` block:

(a) Add `importEmailServices` to the existing api import (line 55):

```typescript
import { getEmailServiceList, deleteEmailService, exportEmailServices, importEmailServices } from '@/views/api/emailservice'
```

(b) Add the importing state + notice ref + handler after the `handleExport` function (before `const emit = defineEmits`):

```typescript
const importing = ref(false);
const importNotice = ref<{
    show: boolean;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
}>({
    show: false,
    type: 'info',
    message: '',
});

async function handleImport() {
    if (importing.value) return;
    importing.value = true;
    try {
        const result = await importEmailServices();
        if (result.skipped > 0) {
            // Partial import — warning with imported/skipped counts + errors.
            const errs = result.errors.join(', ');
            importNotice.value = {
                show: true,
                type: 'warning',
                message: `${t('common.import_partial', { imported: result.imported, skipped: result.skipped })}${errs ? t('common.import_partial_skipped', { errors: errs }) : ''}`,
            };
        } else {
            importNotice.value = {
                show: true,
                type: 'success',
                message: `${t('common.import_success')}: ${result.imported}`,
            };
        }
        // Reload the list to reflect imported services.
        loadItems({ page: 1, itemsPerPage: itemsPerPage.value, sortBy: [] });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const cancelled = /cancel/i.test(msg);
        const noRows = /import_no_valid_rows/i.test(msg);
        const invalidFile = /import_invalid_file/i.test(msg);
        importNotice.value = {
            show: true,
            type: 'error',
            message: cancelled
                ? t('common.import_cancelled')
                : noRows
                    ? t('common.import_no_valid_rows')
                    : invalidFile
                        ? t('common.import_invalid_file')
                        : `${t('common.import_failed')}: ${msg}`,
        };
        console.error('Email service import failed:', error);
    } finally {
        importing.value = false;
    }
}
```

- [ ] **Step 4.5: Run the component test to verify PASS**

Run: `yarn test:components test/vitest/main/components/EmailServiceTable.test.ts`
Expected: all passing — the existing export tests plus the 6 new import tests.

- [ ] **Step 4.6: Full component suite (no regressions)**

Run: `yarn test:components`
Expected: all passing (the baseline count on the `test` branch + 6 new import tests).

- [ ] **Step 4.7: Vue type-check**

Run: `yarn vue-check`
Expected: no errors (or no NEW errors vs. baseline).

- [ ] **Step 4.8: Commit**

```bash
git add src/views/pages/emailservice/widgets/EmailServiceTable.vue test/vitest/main/components/EmailServiceTable.test.ts
git commit -m "feat: add email service import button with snackbar feedback and component tests"
```

---

### Task 5: i18n — add `common.import_*` keys to all 6 languages

**Files:**
- Modify: `src/views/lang/en.ts`
- Modify: `src/views/lang/zh.ts`
- Modify: `src/views/lang/es.ts`
- Modify: `src/views/lang/fr.ts`
- Modify: `src/views/lang/de.ts`
- Modify: `src/views/lang/ja.ts`

`common.import` already exists in all 6 files (verified: en.ts:62, zh.ts:54). We add 7 new keys next to it.

- [ ] **Step 5.1: Add keys to English (`src/views/lang/en.ts`)**

Find the `common` block (around line 62, where `import: "Import"` sits). Add immediately after `import: "Import",`:

```typescript
    import_success: "Import successful",
    import_partial: "Imported {imported}, skipped {skipped} invalid rows",
    import_partial_skipped: ": {errors}",
    import_cancelled: "Import cancelled",
    import_failed: "Import failed",
    import_no_valid_rows: "No valid services found in file",
    import_invalid_file: "Invalid file format",
```

- [ ] **Step 5.2: Add keys to Chinese (`src/views/lang/zh.ts`)**

Find the `common` block (around line 54, where `import: "导入"` sits). Add immediately after `import: "导入",`:

```typescript
    import_success: "导入成功",
    import_partial: "已导入 {imported} 个，跳过 {skipped} 个无效行",
    import_partial_skipped: "：{errors}",
    import_cancelled: "导入已取消",
    import_failed: "导入失败",
    import_no_valid_rows: "文件中未找到有效的邮件服务",
    import_invalid_file: "文件格式无效",
```

- [ ] **Step 5.3: Add keys to Spanish (`src/views/lang/es.ts`)**

Find the `common` block's `import:` line. Add immediately after it:

```typescript
    import_success: "Importación exitosa",
    import_partial: "Importados {imported}, omitidas {skipped} filas inválidas",
    import_partial_skipped: ": {errors}",
    import_cancelled: "Importación cancelada",
    import_failed: "Importación fallida",
    import_no_valid_rows: "No se encontraron servicios válidos en el archivo",
    import_invalid_file: "Formato de archivo no válido",
```

- [ ] **Step 5.4: Add keys to French (`src/views/lang/fr.ts`)**

Find the `common` block's `import:` line. Add immediately after it:

```typescript
    import_success: "Importation réussie",
    import_partial: "Importés {imported}, ignorées {skipped} lignes invalides",
    import_partial_skipped: " : {errors}",
    import_cancelled: "Importation annulée",
    import_failed: "Importation échouée",
    import_no_valid_rows: "Aucun service valide trouvé dans le fichier",
    import_invalid_file: "Format de fichier non valide",
```

- [ ] **Step 5.5: Add keys to German (`src/views/lang/de.ts`)**

Find the `common` block's `import:` line. Add immediately after it:

```typescript
    import_success: "Import erfolgreich",
    import_partial: "{imported} importiert, {skipped} ungültige Zeilen übersprungen",
    import_partial_skipped: ": {errors}",
    import_cancelled: "Import abgebrochen",
    import_failed: "Import fehlgeschlagen",
    import_no_valid_rows: "Keine gültigen Dienste in der Datei gefunden",
    import_invalid_file: "Ungültiges Dateiformat",
```

- [ ] **Step 5.6: Add keys to Japanese (`src/views/lang/ja.ts`)**

Find the `common` block's `import:` line. Add immediately after it:

```typescript
    import_success: "インポート成功",
    import_partial: "{imported}件インポート、{skipped}件の無効な行をスキップ",
    import_partial_skipped: "：{errors}",
    import_cancelled: "インポートはキャンセルされました",
    import_failed: "インポート失敗",
    import_no_valid_rows: "ファイルに有効なメールサービスが見つかりません",
    import_invalid_file: "無効なファイル形式",
```

- [ ] **Step 5.7: Verify the component test still passes with real keys**

Run: `yarn test:components test/vitest/main/components/EmailServiceTable.test.ts`
Expected: PASS (the test uses its own `en` messages block, so it's unaffected by the lang files — but this confirms no syntax errors were introduced in `en.ts` that would break the suite's import).

- [ ] **Step 5.8: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat: add email service import i18n keys for all 6 supported languages"
```

---

### Task 6: Full verification

- [ ] **Step 6.1: Type-check whole project**

Run: `npx tsc --noEmit`
Expected: no errors (or no NEW errors vs. the `test`-branch baseline — record baseline first if the branch tip has pre-existing ones).

- [ ] **Step 6.2: All targeted suites**

```bash
yarn test test/modules/emailMarketingController.test.ts
yarn testmain test/vitest/main/ipc/emailMarketingIpc.test.ts
yarn test:components
```

Expected: Mocha controller tests passing (existing + 8 new), vitest IPC tests passing (existing + 6 new), component tests passing (existing + 6 new).

- [ ] **Step 6.3: Lint all changed source files (pre-commit hook runs this too)**

```bash
npx eslint src/entityTypes/emailmarketingType.ts src/controller/emailMarketingController.ts src/config/channellist.ts src/schemas/ipc/emailMarketing.ts src/main-process/communication/emailMarketingIpc.ts src/views/api/emailservice.ts src/views/pages/emailservice/widgets/EmailServiceTable.vue src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
```

Expected: clean.

---

## Security Summary

- **No passwords logged or returned.** The import result envelope carries only counts and row-number messages (`"row 4: password is required"`); the imported password values are encrypted on write via the module's existing `FieldCipher` path (`encryptCredentialsForStorage` in `createEmailService`/`updateEmailService`) and never appear in logs or the response.
- **File parsing happens in the main process.** Untrusted file content never enters the renderer — `fs.readFileSync` runs in the IPC handler, and only the summary `{ imported, skipped, errors }` crosses back.
- **Input validated with a strict Zod schema** (`z.strictObject({})` — the renderer sends nothing; the file path is chosen via the native dialog in main). Malformed payloads get `status:false` envelopes without reaching the controller.
- **Row validation reuses the module's `validateEmailService`** (email format, port numeric, required fields incl. password, receive-protocol rules). No new validation surface area to audit.
- **DB access stays in Model/Module**; the IPC handler only orchestrates dialog + fs + controller (CLAUDE.md three-layer rule). The controller calls module methods — no direct repository access.
- **Idempotent upsert.** Name-match ⇒ update (password overwritten); no-match ⇒ create. Mid-import DB errors become per-row errors; earlier rows stay imported (no rollback needed — re-running import is safe).

## Self-Review (per writing-plans skill)

1. **Spec coverage:** Import from the email service list page ✅ (button in `EmailServiceTable.vue`, the widget used by `list.vue`); native open dialog ✅; CSV+JSON ✅; partial import ✅; upsert by name ✅; password required ✅; tests at all 3 layers (controller Mocha, IPC vitest, component vitest) ✅; i18n for all 6 languages ✅; `import_no_valid_rows` / `import_invalid_file` handled ✅ (IPC handler catches parse errors and maps to `import_invalid_file`; component detects the key and shows the `import_invalid_file` message); three-layer architecture + Zod-at-boundary ✅.
2. **Placeholders:** none — every step shows complete code. Task 1's implementation uses a `for` loop with `await` (the comment explicitly warns against `forEach`, which does not await its callback and would leave the counts at 0).
3. **Type consistency:** `EmailServiceImportResult` (entityTypes) — `{ imported, skipped, errors }` — used identically by the controller return type, the IPC handler's `data`, the frontend API `importEmailServices()` return type, and the component's `result` variable. `importEmailServices(content, format)` (controller) vs `importEmailServices()` (frontend API) — same name, different signatures per layer, consistent with the codebase convention (`exportEmailServices(format)` controller vs `exportEmailServices(format)` API share names too). `EMAILSERVICEIMPORT` / `emailServiceImportInputSchema` / `email-service-import-btn` all consistently named and symmetric with export. `data-testid="email-service-import-btn"` matches the test selectors.
