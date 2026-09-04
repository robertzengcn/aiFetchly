# Email Service List Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user export the email service list (from `src/views/pages/emailservice/list.vue` → `EmailServiceTable.vue`) to a CSV or JSON file chosen via the native save dialog.

**Architecture:** Follows the established export pattern (`EXPORT_SEARCH_RESULTS` in `search-ipc.ts`): the renderer calls a new `EMAILSERVICEEXPORT` IPC channel; a `registerValidatedHandler` in `emailMarketingIpc.ts` asks `EmailMarketingController` for the export payload, opens the OS save dialog through `getNativeDialogService()`, writes the file, and returns the saved path. The controller whitelists only non-secret fields (`id, name, from, host, port, ssl, receiveProtocol, create_time`) — passwords are never in the export.

**Tech Stack:** Electron IPC + Zod v4 strict schemas (`zod/v4`), TypeORM module/model layer, Vue 3 + Vuetify + vue-i18n, Vitest (IPC + component) and Mocha+Sinon (controller).

**Worktree:** `.claude/worktrees/email-service-export` (branch `worktree-email-service-export`, based on `test` tip `ba47e38c`).

**No i18n changes needed:** `common.export`, `common.export_success`, `common.export_failed`, `common.export_cancelled` exist in all 6 language files (verified in en/zh/es/fr/de/ja).

**No AI gate:** this is not an AI feature (uses `registerValidatedHandler`, not `registerAiValidatedHandler`).

---

## File Structure

| Layer | File | Change |
|---|---|---|
| Channel | `src/config/channellist.ts` | Add `EMAILSERVICEEXPORT` constant |
| Schema | `src/schemas/ipc/emailMarketing.ts` | Add `emailServiceExportInputSchema` |
| Module iface | `src/modules/interface/EmailServiceModuleInterface.ts` | Add `exportEmailServicesList()` |
| Module | `src/modules/emailServiceModule.ts` | Implement `exportEmailServicesList()` |
| Controller | `src/controller/emailMarketingController.ts` | Add `exportEmailServices(format)` |
| IPC handler | `src/main-process/communication/emailMarketingIpc.ts` | Register export handler + save dialog + fs write |
| Preload | `src/preload.ts` | Allowlist the new channel (2 spots: import + invoke list) |
| Frontend API | `src/views/api/emailservice.ts` | Add `exportEmailServices(format)` |
| UI | `src/views/pages/emailservice/widgets/EmailServiceTable.vue` | Export button + loading + NoticeSnackbar feedback |
| Tests | `test/modules/emailMarketingController.test.ts` | Controller export tests (Mocha+Sinon) |
| Tests | `test/vitest/main/ipc/emailMarketingIpc.test.ts` | IPC handler export tests |
| Tests | `test/vitest/main/components/EmailServiceTable.test.ts` | New component test |

---

### Task 1: Module layer — `exportEmailServicesList`

**Files:**
- Modify: `src/modules/interface/EmailServiceModuleInterface.ts`
- Modify: `src/modules/emailServiceModule.ts`

- [ ] **Step 1.1: Add the method to the interface**

In `src/modules/interface/EmailServiceModuleInterface.ts`, append before the closing brace (after the `validateEmailService` method):

```typescript
    /**
     * List ALL email services for export (no pagination, no search filter).
     * Intended for the export feature; callers must project to non-secret
     * fields before the data leaves the main process.
     * @returns Array of email service entities
     */
    exportEmailServicesList(): Promise<EmailServiceEntity[]>;
```

- [ ] **Step 1.2: Implement it in `EmailServiceModule`**

In `src/modules/emailServiceModule.ts`, add this method after `getActiveEmailServices()`:

```typescript
  /**
   * List ALL email services for export (no pagination, no search filter).
   * The controller projects the result down to non-secret fields; passwords
   * never leave the main process as part of an export.
   */
  async exportEmailServicesList(): Promise<EmailServiceEntity[]> {
    try {
      await this.ensureConnection();
      return await this.decryptServiceCredentialsList(
        await this.emailServiceModel.listEmailServices(0, 100000)
      );
    } catch (error) {
      console.error("Error listing all email services for export:", error);
      throw error;
    }
  }
```

- [ ] **Step 1.3: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no NEW errors mentioning `emailServiceModule` / `EmailServiceModuleInterface` / `emailMarketingController` (emailMarketingController will fail with "not a function" until Task 2 — only check that the interface and module files compile; alternatively defer full tsc until Task 2 and only run eslint on these two files here).

- [ ] **Step 1.4: Commit**

```bash
git add src/modules/interface/EmailServiceModuleInterface.ts src/modules/emailServiceModule.ts
git commit -m "feat: add EmailServiceModule.exportEmailServicesList for export"
```

---

### Task 2: Controller — `exportEmailServices(format)`

**Files:**
- Modify: `src/controller/emailMarketingController.ts`
- Test: `test/modules/emailMarketingController.test.ts`

- [ ] **Step 2.1: Write the failing tests (Mocha, TDD)**

Append inside `describe("EmailMarketingController", () => { ... })` in `test/modules/emailMarketingController.test.ts` — after the `createEmailService` describe block:

```typescript
  describe("exportEmailServices", () => {
    const makeService = (id: number, name: string): EmailServiceEntity => {
      const entity = new EmailServiceEntity();
      entity.id = id;
      entity.name = name;
      entity.from = `user${id}@example.com`;
      entity.password = "SECRET-smtp-password";
      entity.host = "smtp.example.com";
      entity.port = "465";
      entity.ssl = 1;
      entity.status = 1;
      entity.receiveProtocol = "imap";
      entity.createdAt = new Date("2026-01-15T10:30:00.000Z");
      return entity;
    };

    it("exports CSV with header and safe fields only (no password)", async () => {
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon.stub().resolves([
          makeService(1, "Primary SMTP"),
          makeService(2, 'Secondary, SMTP "quoted"'),
        ]),
      } as unknown as EmailServiceModuleInterface;

      const csv = (await emailMarketingController.exportEmailServices(
        "csv"
      )) as string;

      expect(csv).to.contain(
        "id,name,from,host,port,ssl,receiveProtocol,create_time"
      );
      expect(csv).to.contain("Primary SMTP");
      expect(csv).to.contain("user1@example.com");
      expect(csv).to.contain('"Secondary, SMTP ""quoted"""');
      expect(csv).to.not.contain("SECRET-smtp-password");
    });

    it("exports JSON with safe fields only (no password)", async () => {
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon
          .stub()
          .resolves([makeService(1, "Primary SMTP")]),
      } as unknown as EmailServiceModuleInterface;

      const payload = (await emailMarketingController.exportEmailServices(
        "json"
      )) as { total: number; services: unknown[]; exportDate: string };

      expect(payload.total).to.equal(1);
      expect(JSON.stringify(payload)).to.not.contain("SECRET-smtp-password");
      expect(JSON.stringify(payload)).to.not.contain("user1@example.com");
    });

    it("returns a header-only CSV when there are no services", async () => {
      emailMarketingController.emailServiceModule = {
        exportEmailServicesList: sinon.stub().resolves([]),
      } as unknown as EmailServiceModuleInterface;

      const csv = (await emailMarketingController.exportEmailServices(
        "csv"
      )) as string;

      expect(csv).to.equal(
        "id,name,from,host,port,ssl,receiveProtocol,create_time\n"
      );
    });
  });
```

- [ ] **Step 2.2: Run the tests to verify they FAIL**

Run: `yarn test test/modules/emailMarketingController.test.ts`
Expected: FAIL — `emailMarketingController.exportEmailServices is not a function`.

- [ ] **Step 2.3: Implement in the controller**

In `src/controller/emailMarketingController.ts`, add the method after `deleteEmailService` (before `sendEmail`):

```typescript
  // Export email services (safe fields only). format: "csv" | "json"
  public async exportEmailServices(
    format: "csv" | "json" = "csv"
  ): Promise<string | EmailServiceExportPayload> {
    const entities = await this.emailServiceModule.exportEmailServicesList();

    if (format === "json") {
      const rows: EmailServiceListdata[] = entities.map((item) => ({
        id: item.id,
        name: item.name,
        from: item.from,
        host: item.host,
        receiveProtocol: item.receiveProtocol,
        create_time: item.createdAt?.toISOString() || "",
      }));
      return {
        total: rows.length,
        services: rows,
        exportDate: new Date().toISOString(),
      };
    }

    const headers = [
      "id",
      "name",
      "from",
      "host",
      "port",
      "ssl",
      "receiveProtocol",
      "create_time",
    ];
    const csvRows = entities.map((item) => [
      item.id?.toString() ?? "",
      this.escapeCsvField(item.name ?? ""),
      this.escapeCsvField(item.from ?? ""),
      this.escapeCsvField(item.host ?? ""),
      item.port ?? "",
      item.ssl?.toString() ?? "",
      item.receiveProtocol ?? "",
      item.createdAt?.toISOString() ?? "",
    ]);
    const csv = [
      headers.join(","),
      ...csvRows.map((row) => row.join(",")),
    ].join("\n");
    return csv.length > 0 ? `${csv}\n` : `${headers.join(",")}\n`;
  }

  /** Quote/escape a CSV field when it contains `,`, `"`, or newline. */
  private escapeCsvField(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
```

Add the export payload type above the class (or in `emailmarketingType.ts` — prefer the entityTypes file since `EmailServiceListdata` lives there):

In `src/entityTypes/emailmarketingType.ts`, after `EmailServiceListdata`:

```typescript
/** JSON export envelope for the email service list (safe fields only). */
export type EmailServiceExportPayload = {
  total: number;
  services: EmailServiceListdata[];
  exportDate: string;
};
```

And import it in the controller: add `EmailServiceExportPayload` to the existing `@/entityTypes/emailmarketingType` import list.

- [ ] **Step 2.4: Run tests to verify they PASS**

Run: `yarn test test/modules/emailMarketingController.test.ts`
Expected: 6 passing (3 existing + 3 new).

- [ ] **Step 2.5: Commit**

```bash
git add src/controller/emailMarketingController.ts src/entityTypes/emailmarketingType.ts test/modules/emailMarketingController.test.ts
git commit -m "feat: add EmailMarketingController.exportEmailServices with safe-field whitelist"
```

---

### Task 3: IPC handler — `EMAILSERVICEEXPORT`

**Files:**
- Modify: `src/config/channellist.ts`
- Modify: `src/schemas/ipc/emailMarketing.ts`
- Modify: `src/main-process/communication/emailMarketingIpc.ts`
- Modify: `src/preload.ts`
- Test: `test/vitest/main/ipc/emailMarketingIpc.test.ts`

- [ ] **Step 3.1: Add the channel constant**

In `src/config/channellist.ts`, after `EMAILSERVICEDELETE` (line 56):

```typescript
export const EMAILSERVICEEXPORT = "email:service:export";
```

- [ ] **Step 3.2: Add the Zod schema**

In `src/schemas/ipc/emailMarketing.ts`, after `emailMarketingListInputSchema`:

```typescript
/**
 * EMAILSERVICEEXPORT: optional format enum; renderer may send {}.
 */
export const emailServiceExportInputSchema = lazySchema(() =>
  z.strictObject({
    format: z.enum(["csv", "json"]).optional(),
  }),
)
```

- [ ] **Step 3.3: Register the IPC handler**

In `src/main-process/communication/emailMarketingIpc.ts`:

(a) Extend imports:

```typescript
import { app, ipcMain } from "electron";   // was: import { ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { getNativeDialogService } from "@/service/dialogs/NativeDialogServiceProvider";
```

Add `EMAILSERVICEEXPORT` to the channellist import block, and `emailServiceExportInputSchema` to the `@/schemas/ipc/emailMarketing` import block.

(b) Add the handler inside `registerEmailMarketingIpcHandlers()`, after the `EMAILSERVICEDELETE` handler block (before the `SENDTESTEMAIL` `ipcMain.on` block):

```typescript
  // ── Service export ────────────────────────────────────────────────────

  registerValidatedHandler(
    EMAILSERVICEEXPORT,
    emailServiceExportInputSchema,
    async (input) => {
      const controller = new EmailMarketingController();
      const format = input.format ?? "csv";
      const exportData = await controller.exportEmailServices(format);
      const fileExtension = format === "csv" ? "csv" : "json";
      const defaultFilename = `email_services_export_${
        new Date().toISOString().split("T")[0]
      }.${fileExtension}`;

      const dialogService = await getNativeDialogService();
      const dialogResult = await dialogService.showSaveDialog({
        title: "Export Email Services",
        defaultPath: path.join(app.getPath("documents"), defaultFilename),
        filters: [
          {
            name: format === "csv" ? "CSV Files" : "JSON Files",
            extensions: [fileExtension],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        throw new Error("Export cancelled by user");
      }
      const filePath = dialogResult.filePaths[0];
      const content =
        format === "csv"
          ? (exportData as string)
          : JSON.stringify(exportData, null, 2);
      fs.writeFileSync(filePath, content, "utf-8");
      return filePath;
    }
  );
```

- [ ] **Step 3.4: Preload allowlist**

In `src/preload.ts`:
1. Add `EMAILSERVICEEXPORT,` to the channellist import block (after `EMAILSERVICEDELETE,` — around line 43).
2. Add `EMAILSERVICEEXPORT,` to the `invoke` allowlist (after `EMAILSERVICEDELETE,` — around line 783).

- [ ] **Step 3.5: Write the IPC tests**

Replace the placeholder body of `test/vitest/main/ipc/emailMarketingIpc.test.ts` (keep the existing imports, add the new ones) with the full file:

```typescript
'use strict';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  MockBrowserWindow,
  mockIpcMain,
  setupElectronMocks,
  resetElectronMocks,
} from '../../../utils/electron-mocks';

// Controller + dialog are mocked so the handler test stays off the DB and
// away from a real OS dialog.
const mockExportEmailServices = vi.hoisted(() => vi.fn());
const mockShowSaveDialog = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue(os.tmpdir()) },
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
}));

vi.mock('@/controller/emailMarketingController', () => ({
  EmailMarketingController: vi.fn().mockImplementation(() => ({
    exportEmailServices: mockExportEmailServices,
  })),
}));

vi.mock('@/service/dialogs/NativeDialogServiceProvider', () => ({
  getNativeDialogService: vi.fn().mockImplementation(() =>
    Promise.resolve({
      showSaveDialog: mockShowSaveDialog,
      showOpenDialog: vi.fn(),
      showMessageBox: vi.fn(),
    })
  ),
}));

import { registerEmailMarketingIpcHandlers } from '@/main-process/communication/emailMarketingIpc';
import { EMAILSERVICEEXPORT } from '@/config/channellist';
import type { CommonMessage } from '@/entityTypes/commonType';

describe('Email Marketing IPC Handlers', () => {
  const win = new MockBrowserWindow();
  const tmpExportPath = path.join(os.tmpdir(), 'email_services_export_test.csv');
  const tmpExportJsonPath = path.join(os.tmpdir(), 'email_services_export_test.json');

  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    registerEmailMarketingIpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
    for (const file of [tmpExportPath, tmpExportJsonPath]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  test('registers the export channel', () => {
    expect(mockIpcMain.getRegisteredChannels()).toContain(EMAILSERVICEEXPORT);
    expect(mockIpcMain.getRegisteredChannels()).toContain('email:service:list');
  });

  test('writes a CSV file when the user confirms the save dialog', async () => {
    const sampleCsv = 'id,name,from\n1,Primary,primary@example.com\n';
    mockExportEmailServices.mockResolvedValue(sampleCsv);
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePaths: [tmpExportPath],
    });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      { format: 'csv' }
    )) as CommonMessage<string>;

    expect(result.status).toBe(true);
    expect(result.data).toBe(tmpExportPath);
    expect(mockExportEmailServices).toHaveBeenCalledWith('csv');
    expect(fs.readFileSync(tmpExportPath, 'utf-8')).toBe(sampleCsv);
  });

  test('writes a pretty-printed JSON file when format is json', async () => {
    const payload = {
      total: 1,
      services: [{ id: 1, name: 'Primary SMTP' }],
      exportDate: '2026-09-04T00:00:00.000Z',
    };
    mockExportEmailServices.mockResolvedValue(payload);
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePaths: [tmpExportJsonPath],
    });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      { format: 'json' }
    )) as CommonMessage<string>;

    expect(result.status).toBe(true);
    expect(mockExportEmailServices).toHaveBeenCalledWith('json');
    expect(JSON.parse(fs.readFileSync(tmpExportJsonPath, 'utf-8'))).toEqual(
      payload
    );
  });

  test('defaults to csv when no format is sent', async () => {
    mockExportEmailServices.mockResolvedValue('id,name\n');
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePaths: [tmpExportPath],
    });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      {}
    )) as CommonMessage<string>;

    expect(result.status).toBe(true);
    expect(mockExportEmailServices).toHaveBeenCalledWith('csv');
  });

  test('denies an invalid format without calling the controller', async () => {
    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      { format: 'pdf' }
    )) as CommonMessage<null>;

    expect(result.status).toBe(false);
    expect(mockExportEmailServices).not.toHaveBeenCalled();
  });

  test('returns status:false when the user cancels the save dialog', async () => {
    mockExportEmailServices.mockResolvedValue('id,name\n');
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      {}
    )) as CommonMessage<null>;

    expect(result.status).toBe(false);
    expect(result.msg).toContain('cancelled');
    expect(fs.existsSync(tmpExportPath)).toBe(false);
  });
});
```

- [ ] **Step 3.6: Run the tests**

Run: `yarn testmain test/vitest/main/ipc/emailMarketingIpc.test.ts`
Expected: 6 passing.

- [ ] **Step 3.7: Commit**

```bash
git add src/config/channellist.ts src/schemas/ipc/emailMarketing.ts src/main-process/communication/emailMarketingIpc.ts src/preload.ts test/vitest/main/ipc/emailMarketingIpc.test.ts
git commit -m "feat: add EMAILSERVICEEXPORT IPC handler with save dialog and zod schema"
```

---

### Task 4: Frontend API + UI — export button with feedback

**Files:**
- Modify: `src/views/api/emailservice.ts`
- Modify: `src/views/pages/emailservice/widgets/EmailServiceTable.vue`
- Test: `test/vitest/main/components/EmailServiceTable.test.ts` (new)

- [ ] **Step 4.1: Frontend API function**

In `src/views/api/emailservice.ts`, add `EMAILSERVICEEXPORT` to the channellist import (line 2) and append:

```typescript
// export email service list to a file chosen via the native save dialog
export async function exportEmailServices(
  format: 'csv' | 'json' = 'csv'
): Promise<string> {
  const resp = await windowInvoke(EMAILSERVICEEXPORT, { format });
  if (!resp) {
    throw new Error('unknow error');
  }
  return resp as string;
}
```

- [ ] **Step 4.2: Write the component test FIRST (TDD)**

Create `test/vitest/main/components/EmailServiceTable.test.ts`:

```typescript
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmailServiceTable from '@/views/pages/emailservice/widgets/EmailServiceTable.vue';
import type { EmailServiceListdata } from '@/entityTypes/emailmarketingType';

// Mock the emailservice API so no IPC is invoked.
const apiMocks = vi.hoisted(() => ({
  getEmailServiceList: vi.fn(),
  deleteEmailService: vi.fn(),
  exportEmailServices: vi.fn(),
}));

vi.mock('@/views/api/emailservice', () => ({
  getEmailServiceList: (...args: unknown[]) => apiMocks.getEmailServiceList(...args),
  deleteEmailService: (...args: unknown[]) => apiMocks.deleteEmailService(...args),
  exportEmailServices: (...args: unknown[]) => apiMocks.exportEmailServices(...args),
}));

// Stub vue-router's useRouter — component pushes routes on edit/create.
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      common: {
        export: 'Export',
        export_success: 'Export successful',
        export_failed: 'Export failed',
        export_cancelled: 'Export cancelled',
        actions: 'Actions',
        created_time: 'created time',
      },
      emailservice: {
        id: 'id',
        name: 'name',
        from: 'sender account',
        create_service: 'create email service',
      },
    },
  },
});

const stubs = {
  VTextField: { template: '<input />' },
  VBtn: {
    props: ['loading', 'prependIcon', 'variant', 'color'],
    emits: ['click'],
    template:
      '<button :data-loading="loading ? \'true\' : \'false\'" @click="$emit(\'click\')"><slot /></button>',
  },
  VDataTableServer: {
    props: [
      'items',
      'itemsLength',
      'loading',
      'headers',
      'itemsPerPage',
      'search',
      'itemValue',
      'showSelect',
      'modelValue',
    ],
    emits: ['update:options', 'update:modelValue'],
    template: '<div data-testid="v-data-table-server" />',
  },
  VIcon: true,
  DeleteDialog: true,
  NoticeSnackbar: {
    props: ['modelValue', 'message', 'type'],
    emits: ['update:modelValue'],
    template:
      '<div data-testid="notice-snackbar" :data-message="message" :data-type="type" v-if="modelValue" />',
  },
};

const SAMPLE: EmailServiceListdata[] = [
  {
    id: 1,
    name: 'Primary SMTP',
    from: 'a@example.com',
    host: 'smtp.example.com',
    receiveProtocol: 'imap',
    create_time: '2026-01-01T00:00:00.000Z',
  },
];

function mountTable(props: Record<string, unknown> = {}) {
  return mount(EmailServiceTable, {
    props,
    global: { plugins: [i18n], stubs },
  });
}

describe('EmailServiceTable export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getEmailServiceList.mockResolvedValue({ data: SAMPLE, total: 1 });
  });

  it('renders an export button (standalone list mode)', () => {
    const wrapper = mountTable();
    expect(
      wrapper.find('[data-testid="email-service-export-btn"]').exists()
    ).toBe(true);
  });

  it('hides the export button in selection mode (isSelectedtable=true)', () => {
    const wrapper = mountTable({ isSelectedtable: true });
    expect(
      wrapper.find('[data-testid="email-service-export-btn"]').exists()
    ).toBe(false);
  });

  it('calls exportEmailServices and shows a success notice on success', async () => {
    apiMocks.exportEmailServices.mockResolvedValue('/tmp/export.csv');
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-export-btn"]').trigger('click');
    await vi.waitFor(() => {
      expect(apiMocks.exportEmailServices).toHaveBeenCalledWith('csv');
    });

    const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
    expect(snackbar.exists()).toBe(true);
    expect(snackbar.attributes('data-type')).toBe('success');
    expect(snackbar.attributes('data-message')).toContain('/tmp/export.csv');
  });

  it('shows a cancelled notice when the user cancels the save dialog', async () => {
    apiMocks.exportEmailServices.mockRejectedValue(
      new Error('Export cancelled by user')
    );
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-export-btn"]').trigger('click');
    await vi.waitFor(() => {
      const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
      expect(snackbar.exists()).toBe(true);
      expect(snackbar.attributes('data-message')).toContain('Export cancelled');
    });
  });

  it('shows an error notice when the export fails for another reason', async () => {
    apiMocks.exportEmailServices.mockRejectedValue(new Error('disk full'));
    const wrapper = mountTable();

    await wrapper.find('[data-testid="email-service-export-btn"]').trigger('click');
    await vi.waitFor(() => {
      const snackbar = wrapper.find('[data-testid="notice-snackbar"]');
      expect(snackbar.exists()).toBe(true);
      expect(snackbar.attributes('data-message')).toContain('disk full');
    });
  });
});
```

- [ ] **Step 4.3: Run the test to verify it FAILS (export button does not exist yet)**

Run: `yarn test:components test/vitest/main/components/EmailServiceTable.test.ts`
Expected: FAIL — `[data-testid="email-service-export-btn"]` not found.

- [ ] **Step 4.4: Add the button to EmailServiceTable.vue template**

In the `search_tool` div, after the Create button:

```html
            <v-btn
                v-if="!isSelectedtable"
                class="btn ml-3" variant="flat" prepend-icon="mdi-export" color="secondary"
                :loading="exporting"
                data-testid="email-service-export-btn"
                @click="handleExport"
            >
                {{ t('common.export') }}
            </v-btn>
```

And after `<delete-dialog ...>`, add:

```html
    <notice-snackbar
        v-model="exportNotice.show"
        :message="exportNotice.message"
        :type="exportNotice.type"
    />
```

- [ ] **Step 4.5: Add the export logic to the script section**

```typescript
import NoticeSnackbar from '@/views/components/widgets/noticeSnackbar.vue';
import { exportEmailServices } from '@/views/api/emailservice';

const exporting = ref(false);
const exportNotice = ref<{
    show: boolean;
    type: 'success' | 'error' | 'info';
    message: string;
}>({
    show: false,
    type: 'info',
    message: '',
});

async function handleExport() {
    if (exporting.value) return;
    exporting.value = true;
    try {
        const filePath = await exportEmailServices('csv');
        exportNotice.value = {
            show: true,
            type: 'success',
            message: filePath
                ? `${t('common.export_success')}: ${filePath}`
                : t('common.export_success'),
        };
    } catch (error) {
        const cancelled =
            error instanceof Error && /cancel/i.test(error.message);
        exportNotice.value = {
            show: true,
            type: 'error',
            message: cancelled
                ? t('common.export_cancelled')
                : `${t('common.export_failed')}: ${
                      error instanceof Error ? error.message : String(error)
                  }`,
        };
        console.error('Email service export failed:', error);
    } finally {
        exporting.value = false;
    }
}
```

- [ ] **Step 4.6: Run the component test to verify PASS**

Run: `yarn test:components test/vitest/main/components/EmailServiceTable.test.ts`
Expected: 5 passing.

- [ ] **Step 4.7: Full component suite (no regressions)**

Run: `yarn test:components`
Expected: 201 passing (196 baseline + 5 new).

- [ ] **Step 4.8: Commit**

```bash
git add src/views/api/emailservice.ts src/views/pages/emailservice/widgets/EmailServiceTable.vue test/vitest/main/components/EmailServiceTable.test.ts
git commit -m "feat: add email service export button with snackbar feedback and component tests"
```

---

### Task 5: Full verification

- [ ] **Step 5.1: Type-check whole project**

Run: `npx tsc --noEmit`
Expected: no errors (or no NEW errors vs. baseline — record baseline first if the branch tip has pre-existing ones).

- [ ] **Step 5.2: All targeted suites**

```bash
yarn test test/modules/emailMarketingController.test.ts
yarn testmain test/vitest/main/ipc/emailMarketingIpc.test.ts
yarn test:components
```

Expected: 6 mocha passing, 6 vitest IPC passing, 201 component tests passing.

- [ ] **Step 5.3: Lint staged files (pre-commit hook runs this too)**

```bash
npx eslint src/modules/emailServiceModule.ts src/modules/interface/EmailServiceModuleInterface.ts src/controller/emailMarketingController.ts src/config/channellist.ts src/schemas/ipc/emailMarketing.ts src/main-process/communication/emailMarketingIpc.ts src/views/api/emailservice.ts src/views/pages/emailservice/widgets/EmailServiceTable.vue
```

Expected: clean.

---

## Security Summary

- Export payload is a strict whitelist: `id, name, from, host, port, ssl, receiveProtocol, create_time`. `password` / `receivePassword` / `receiveUsername` never appear in CSV, JSON, renderer memory, or the written file.
- Save path is chosen by the user through the native save dialog (`getNativeDialogService()` — the E2E-substitutable abstraction, per its own doc comment "new dialog call sites should depend on this interface").
- Input validated with a strict Zod schema (`format: 'csv' | 'json'` optional enum); malformed payloads get `status:false` envelopes without reaching the controller.
- DB access stays in Model/Module; IPC handler only orchestrates controller + dialog + fs (CLAUDE.md three-layer rule).

## Self-Review (per writing-plans skill)

1. **Spec coverage:** export from the email service list page ✅ (button in `EmailServiceTable.vue`, the widget used by `list.vue`); native save dialog ✅; CSV+JSON ✅; tests at all 3 layers ✅; safe fields ✅; i18n reuses existing keys ✅.
2. **Placeholders:** none — every step shows complete code.
3. **Type consistency:** `exportEmailServicesList()` (module) / `exportEmailServices(format)` (controller + frontend API share the name, different signatures per layer — consistent with codebase convention like `deleteEmailService`); `EmailServiceExportPayload` defined in entityTypes and imported once; `emailServiceExportInputSchema` named per file convention.
