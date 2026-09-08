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

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue(os.tmpdir()) },
  ipcMain: mockIpcMain,
  BrowserWindow: MockBrowserWindow,
}));

vi.mock("@/controller/emailMarketingController", () => ({
  EmailMarketingController: vi.fn().mockImplementation(() => ({
    exportEmailServices: mockExportEmailServices,
    importEmailServices: mockImportEmailServices,
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
import { EMAILSERVICEEXPORT, EMAILSERVICEIMPORT } from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";

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

    test("returns status:false with import_invalid_file when the controller rejects", async () => {
      const malformed = "{ not json ";
      fs.writeFileSync(tmpImportJsonPath, malformed, "utf-8");
      mockImportEmailServices.mockRejectedValue(
        new SyntaxError("Unexpected token")
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
      expect(result.msg).toContain("import_invalid_file");
    });
  });
});
