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
  const tmpExportPath = path.join(os.tmpdir(), 'email_services_export_test.csv');
  const tmpExportJsonPath = path.join(
    os.tmpdir(),
    'email_services_export_test.json'
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
      JSON.stringify({ format: 'csv' })
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
      JSON.stringify({ format: 'json' })
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
      JSON.stringify({})
    )) as CommonMessage<string>;

    expect(result.status).toBe(true);
    expect(mockExportEmailServices).toHaveBeenCalledWith('csv');
  });

  test('denies an invalid format without calling the controller', async () => {
    const result = (await mockIpcMain.callHandler(
      EMAILSERVICEEXPORT,
      {},
      JSON.stringify({ format: 'pdf' })
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
      JSON.stringify({})
    )) as CommonMessage<null>;

    expect(result.status).toBe(false);
    expect(result.msg).toContain('cancelled');
    expect(fs.existsSync(tmpExportPath)).toBe(false);
  });
});