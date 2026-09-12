"use strict";
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  MockBrowserWindow,
  mockIpcMain,
  setupElectronMocks,
  resetElectronMocks,
} from "../../../utils/electron-mocks";

// Controller + dialog are mocked so the handler test stays off the DB and
// away from a real OS dialog.
const mockExportEmailServices = vi.hoisted(() => vi.fn());
const mockShowSaveDialog = vi.hoisted(() => vi.fn());
const mockImportEmailServices = vi.hoisted(() => vi.fn());
const mockShowOpenDialog = vi.hoisted(() => vi.fn());
// EMAILSERVICEUPDATE handler deps.
const mockGetEmailServiceEntity = vi.hoisted(() => vi.fn());
const mockFindEmailServiceByName = vi.hoisted(() => vi.fn());
const mockValidateEmailServiceForSave = vi.hoisted(() => vi.fn());
const mockUpdateEmailService = vi.hoisted(() => vi.fn());
const mockCreateEmailService = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue(os.tmpdir()) },
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
}));

vi.mock("@/controller/emailMarketingController", () => ({
  EmailMarketingController: vi.fn().mockImplementation(() => ({
    exportEmailServices: mockExportEmailServices,
    importEmailServices: mockImportEmailServices,
    getEmailServiceEntity: mockGetEmailServiceEntity,
    findEmailServiceByName: mockFindEmailServiceByName,
    validateEmailServiceForSave: mockValidateEmailServiceForSave,
    updateEmailService: mockUpdateEmailService,
    createEmailService: mockCreateEmailService,
  })),
}));

vi.mock("@/service/dialogs/NativeDialogServiceProvider", () => ({
  getNativeDialogService: vi.fn().mockImplementation(() =>
    Promise.resolve({
      showSaveDialog: mockShowSaveDialog,
      showOpenDialog: mockShowOpenDialog,
      showMessageBox: vi.fn(),
    })
  ),
}));

import { registerEmailMarketingIpcHandlers } from "@/main-process/communication/emailMarketingIpc";
import {
  EMAILSERVICEEXPORT,
  EMAILSERVICEIMPORT,
  EMAILSERVICEUPDATE,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import { EmailServiceEntity } from "@/entity/EmailService.entity";

describe("Email Marketing IPC Handlers", () => {
  const tmpExportPath = path.join(
    os.tmpdir(),
    "email_services_export_test.csv"
  );
  const tmpExportJsonPath = path.join(
    os.tmpdir(),
    "email_services_export_test.json"
  );
  const tmpImportCsvPath = path.join(
    os.tmpdir(),
    "email_services_import_test.csv"
  );
  const tmpImportJsonPath = path.join(
    os.tmpdir(),
    "email_services_import_test.json"
  );

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

  test("registers the export channel", () => {
    expect(mockIpcMain.getRegisteredChannels()).toContain(EMAILSERVICEEXPORT);
    expect(mockIpcMain.getRegisteredChannels()).toContain("email:service:list");
  });

  test("writes a CSV file when the user confirms the save dialog", async () => {
    const sampleCsv = "id,name,from\n1,Primary,primary@example.com\n";
    mockExportEmailServices.mockResolvedValue(sampleCsv);
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePaths: [tmpExportPath],
    });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      JSON.stringify({ format: "csv" })
    )) as CommonMessage<string>;

    expect(result.status).toBe(true);
    expect(result.data).toBe(tmpExportPath);
    expect(mockExportEmailServices).toHaveBeenCalledWith("csv");
    expect(fs.readFileSync(tmpExportPath, "utf-8")).toBe(sampleCsv);
  });

  test("writes a pretty-printed JSON file when format is json", async () => {
    const payload = {
      total: 1,
      services: [{ id: 1, name: "Primary SMTP" }],
      exportDate: "2026-09-04T00:00:00.000Z",
    };
    mockExportEmailServices.mockResolvedValue(payload);
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePaths: [tmpExportJsonPath],
    });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      JSON.stringify({ format: "json" })
    )) as CommonMessage<string>;

    expect(result.status).toBe(true);
    expect(mockExportEmailServices).toHaveBeenCalledWith("json");
    expect(JSON.parse(fs.readFileSync(tmpExportJsonPath, "utf-8"))).toEqual(
      payload
    );
  });

  test("defaults to csv when no format is sent", async () => {
    mockExportEmailServices.mockResolvedValue("id,name\n");
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePaths: [tmpExportPath],
    });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      JSON.stringify({})
    )) as CommonMessage<string>;

    expect(result.status).toBe(true);
    expect(mockExportEmailServices).toHaveBeenCalledWith("csv");
  });

  test("denies an invalid format without calling the controller", async () => {
    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      JSON.stringify({ format: "pdf" })
    )) as CommonMessage<null>;

    expect(result.status).toBe(false);
    expect(mockExportEmailServices).not.toHaveBeenCalled();
  });

  test("returns status:false when the user cancels the save dialog", async () => {
    mockExportEmailServices.mockResolvedValue("id,name\n");
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      JSON.stringify({})
    )) as CommonMessage<null>;

    expect(result.status).toBe(false);
    expect(result.msg).toContain("cancelled");
    expect(fs.existsSync(tmpExportPath)).toBe(false);
  });

  describe("import", () => {
    afterEach(() => {
      for (const file of [tmpImportCsvPath, tmpImportJsonPath]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    });

    test("registers the import channel", () => {
      expect(mockIpcMain.getRegisteredChannels()).toContain(EMAILSERVICEIMPORT);
    });

    test("reads a CSV file, calls the controller, and returns the result", async () => {
      const csv =
        "name,from,host,port,ssl,password\nPrimary,user@example.com,smtp.example.com,465,1,secret\n";
      fs.writeFileSync(tmpImportCsvPath, csv, "utf-8");
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
        JSON.stringify({})
      )) as CommonMessage<{
        imported: number;
        skipped: number;
        errors: string[];
      }>;

      expect(result.status).toBe(true);
      expect(result.data!.imported).toBe(1);
      expect(mockImportEmailServices).toHaveBeenCalledWith(csv, "csv");
    });

    test("reads a JSON file and passes json format to the controller", async () => {
      const json = JSON.stringify({
        total: 1,
        services: [{ name: "Primary", from: "a@example.com" }],
      });
      fs.writeFileSync(tmpImportJsonPath, json, "utf-8");
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
        JSON.stringify({})
      )) as CommonMessage<{
        imported: number;
        skipped: number;
        errors: string[];
      }>;

      expect(result.status).toBe(true);
      expect(mockImportEmailServices).toHaveBeenCalledWith(json, "json");
    });

    test("returns status:false when the user cancels the open dialog", async () => {
      mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        JSON.stringify({})
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toContain("cancelled");
      expect(mockImportEmailServices).not.toHaveBeenCalled();
    });

    test("returns status:false with import_no_valid_rows when nothing imported", async () => {
      fs.writeFileSync(tmpImportCsvPath, "name,from\n", "utf-8");
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
        JSON.stringify({})
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toContain("import_no_valid_rows");
    });

    test("returns partial result (imported + skipped + errors) as success", async () => {
      fs.writeFileSync(
        tmpImportCsvPath,
        "name,from,host,port,ssl,password\nBad,,h,465,1,\nGood,g@x.com,h,465,1,pw\n",
        "utf-8"
      );
      mockImportEmailServices.mockResolvedValue({
        imported: 1,
        skipped: 1,
        errors: ["row 2: Password is required"],
      });
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpImportCsvPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        JSON.stringify({})
      )) as CommonMessage<{
        imported: number;
        skipped: number;
        errors: string[];
      }>;

      expect(result.status).toBe(true);
      expect(result.data!.imported).toBe(1);
      expect(result.data!.skipped).toBe(1);
      expect(result.data!.errors[0]).toContain("row 2");
    });

    test("returns status:false with exactly the import_invalid_file key (no parse detail) when the controller rejects", async () => {
      const malformed = "{ not json ";
      fs.writeFileSync(tmpImportJsonPath, malformed, "utf-8");
      // V8 embeds raw source snippets in JSON.parse errors — e.g. an
      // unquoted password value would echo into the message. The envelope
      // must carry ONLY the stable key, never the parse detail.
      mockImportEmailServices.mockRejectedValue(
        new SyntaxError(
          'Unexpected token \'s\', ..."assword": mysecret}" is not valid JSON'
        )
      );
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpImportJsonPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        JSON.stringify({})
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toBe("import_invalid_file");
    });

    test("rejects a non-empty payload without opening the dialog (strict schema)", async () => {
      // Pin: the import schema is z.strictObject({}) — any extra field must
      // be rejected at the boundary before the dialog opens. Locks the
      // boundary against future schema relaxation.
      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        JSON.stringify({ foo: 1 })
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(mockShowOpenDialog).not.toHaveBeenCalled();
      expect(mockImportEmailServices).not.toHaveBeenCalled();
    });

    test("returns status:false with import_failed when the file cannot be read", async () => {
      // Delete/permission race between the dialog and the read: the raw
      // ENOENT/EACCES message (with the full path) must not leak — surface
      // the stable import_failed key instead.
      const missingPath = path.join(
        os.tmpdir(),
        "email_services_import_missing_test.csv"
      );
      if (fs.existsSync(missingPath)) fs.unlinkSync(missingPath);
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [missingPath],
      });

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEIMPORT,
        {},
        JSON.stringify({})
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toBe("import_failed");
      expect(mockImportEmailServices).not.toHaveBeenCalled();
    });
  });

  describe("update (EMAILSERVICEUPDATE)", () => {
    /** Existing row the update handler resolves + merges into. */
    function makeExistingEntity(): EmailServiceEntity {
      const entity = new EmailServiceEntity();
      entity.id = 5;
      entity.name = "Primary";
      entity.from = "sender@example.com";
      entity.smtpUsername = "legacy-login@example.com";
      entity.replyTo = "replies@example.com";
      entity.password = "stored-secret";
      entity.host = "smtp.example.com";
      entity.port = "465";
      entity.ssl = 1;
      return entity;
    }

    beforeEach(() => {
      mockGetEmailServiceEntity.mockResolvedValue(makeExistingEntity());
      mockFindEmailServiceByName.mockResolvedValue(
        Object.assign(makeExistingEntity(), { id: 5 })
      );
      mockValidateEmailServiceForSave.mockResolvedValue(undefined);
      mockUpdateEmailService.mockResolvedValue(undefined);
      mockCreateEmailService.mockResolvedValue(9);
    });

    test("registers the update channel", () => {
      expect(mockIpcMain.getRegisteredChannels()).toContain(EMAILSERVICEUPDATE);
    });

    test("updates by id: merges smtpUsername/replyTo, keeps stored password when incoming is blank, validates before persist", async () => {
      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          id: 5,
          name: "Primary",
          from: "sender@example.com",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
          // Blank incoming values clear the identity fields to null.
          smtpUsername: "   ",
          replyTo: "",
          // Blank password = keep existing (credential sentinel).
          password: "",
        })
      )) as CommonMessage<{ id: number }>;

      expect(result.status).toBe(true);
      expect(result.data!.id).toBe(5);

      // The handler resolved the raw entity and validated the MERGED shape
      // BEFORE the update call (§7.2 pre-persistence gate).
      expect(mockGetEmailServiceEntity).toHaveBeenCalledWith(5);
      expect(mockValidateEmailServiceForSave).toHaveBeenCalledTimes(1);
      const [entityArg, modeArg, existingIdArg] =
        mockValidateEmailServiceForSave.mock.calls[0] as [
          EmailServiceEntity,
          "update" | "create",
          number | undefined
        ];
      expect(modeArg).toBe("update");
      expect(existingIdArg).toBe(5);
      expect(entityArg.smtpUsername).toBeNull();
      expect(entityArg.replyTo).toBeNull();
      // Blank password preserved the stored credential.
      expect(entityArg.password).toBe("stored-secret");
      // Untouched identity fields preserved from the existing row.
      expect(entityArg.from).toBe("sender@example.com");

      expect(mockUpdateEmailService).toHaveBeenCalledTimes(1);
      const [updatedId, updatedEntity] = mockUpdateEmailService.mock
        .calls[0] as [number, EmailServiceEntity];
      expect(updatedId).toBe(5);
      expect(updatedEntity.smtpUsername).toBeNull();
      expect(updatedEntity.replyTo).toBeNull();
      expect(mockCreateEmailService).not.toHaveBeenCalled();
    });

    test("preserves existing smtpUsername/replyTo when the fields are absent from the payload", async () => {
      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          id: 5,
          name: "Primary",
          from: "sender@example.com",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
          // smtpUsername/replyTo omitted entirely → preserve existing row.
        })
      )) as CommonMessage<{ id: number }>;

      expect(result.status).toBe(true);
      const [entityArg] = mockValidateEmailServiceForSave.mock.calls[0] as [
        EmailServiceEntity
      ];
      expect(entityArg.smtpUsername).toBe("legacy-login@example.com");
      expect(entityArg.replyTo).toBe("replies@example.com");
      expect(mockUpdateEmailService).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          smtpUsername: "legacy-login@example.com",
          replyTo: "replies@example.com",
        })
      );
    });

    test("trims non-blank smtpUsername/replyTo before persisting", async () => {
      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          id: 5,
          name: "Primary",
          from: "sender@example.com",
          smtpUsername: "  api-login@example.com  ",
          replyTo: "  replies@example.com  ",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
        })
      )) as CommonMessage<{ id: number }>;

      expect(result.status).toBe(true);
      const [updatedId, updatedEntity] = mockUpdateEmailService.mock
        .calls[0] as [number, EmailServiceEntity];
      expect(updatedId).toBe(5);
      expect(updatedEntity.smtpUsername).toBe("api-login@example.com");
      expect(updatedEntity.replyTo).toBe("replies@example.com");
    });

    test("rejects CR/LF in smtpUsername via validateEmailServiceForSave and never persists (§7.2 header injection)", async () => {
      // The controller's validation gate throws for header-break input; the
      // handler must surface status:false and skip the update entirely.
      mockValidateEmailServiceForSave.mockRejectedValue(
        new Error("SMTP username must not contain CR or LF characters")
      );

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          id: 5,
          name: "Primary",
          from: "sender@example.com",
          smtpUsername: "evil\r\nBcc: victim@example.com",
          replyTo: "replies@example.com",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
        })
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toContain("CR or LF");
      expect(mockValidateEmailServiceForSave).toHaveBeenCalledTimes(1);
      expect(mockUpdateEmailService).not.toHaveBeenCalled();
    });

    test("falls back to name lookup when the payload has no usable id", async () => {
      mockGetEmailServiceEntity.mockClear();
      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          name: "Primary",
          from: "sender@example.com",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
        })
      )) as CommonMessage<{ id: number }>;

      expect(result.status).toBe(true);
      // No id → resolved by name, then the same update path.
      expect(mockFindEmailServiceByName).toHaveBeenCalledWith("Primary");
      expect(mockGetEmailServiceEntity).toHaveBeenCalledWith(5);
      expect(mockUpdateEmailService).toHaveBeenCalledTimes(1);
    });

    test("creates (validates a representative entity) when no existing service matches", async () => {
      mockFindEmailServiceByName.mockResolvedValue(undefined);

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          name: "Brand New",
          from: "new@example.com",
          smtpUsername: "new-login@example.com",
          replyTo: null,
          password: "fresh-secret",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
        })
      )) as CommonMessage<{ id: number }>;

      expect(result.status).toBe(true);
      expect(result.data!.id).toBe(9);

      // The create path validated a representative entity BEFORE writing.
      const [createEntity, createMode, createExistingId] =
        mockValidateEmailServiceForSave.mock.calls[0] as [
          EmailServiceEntity,
          "update" | "create",
          number | undefined
        ];
      expect(createMode).toBe("create");
      expect(createExistingId).toBeUndefined();
      expect(createEntity.smtpUsername).toBe("new-login@example.com");
      expect(createEntity.replyTo).toBeNull();
      expect(createEntity.password).toBe("fresh-secret");
      expect(mockCreateEmailService).toHaveBeenCalledTimes(1);
      expect(mockUpdateEmailService).not.toHaveBeenCalled();
    });

    test("returns status:false when the resolved service no longer exists", async () => {
      mockGetEmailServiceEntity.mockResolvedValue(undefined);

      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          id: 404,
          name: "Primary",
          from: "sender@example.com",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
        })
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(result.msg).toBe("Email service not found");
      expect(mockUpdateEmailService).not.toHaveBeenCalled();
    });

    test("denies a payload failing the schema (missing required from) without touching the controller", async () => {
      const result = (await mockIpcMain.callHandler(
        EMAILSERVICEUPDATE,
        {},
        JSON.stringify({
          id: 5,
          name: "Primary",
          host: "smtp.example.com",
          port: "465",
          ssl: 1,
          // `from` is required by emailServiceUpdateInputSchema.
        })
      )) as CommonMessage<null>;

      expect(result.status).toBe(false);
      expect(mockGetEmailServiceEntity).not.toHaveBeenCalled();
      expect(mockValidateEmailServiceForSave).not.toHaveBeenCalled();
      expect(mockUpdateEmailService).not.toHaveBeenCalled();
    });
  });
});
