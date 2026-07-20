'use strict';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockIpcMain, setupElectronMocks, resetElectronMocks } from '../../../utils/electron-mocks';
import { EMAILEXTRACTIONAPI, EMAILEXTRACTIONMESSAGE } from '@/config/channellist';
import { EmailExtractionTypes } from '@/config/emailextraction';

// Hoisted mock fns so they are available inside vi.mock factories.
const mocks = vi.hoisted(() => ({
  mockSearchEmail: vi.fn().mockResolvedValue(undefined),
  mockGetGoogleRecord: vi.fn(),
  mockGetYandexRecord: vi.fn(),
}));

// Mock electron — ipcMain routes through mockIpcMain.
vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showSaveDialog: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}));

// Mock registerValidatedHandler so the 9 handle-handlers don't pull token/schemas/Logger.
vi.mock('@/main-process/communication/_shared/registerValidatedHandler', () => ({
  registerValidatedHandler: vi.fn(),
}));

// Mock the IPC schemas (only referenced inside the mocked registerValidatedHandler).
vi.mock('@/schemas/ipc/emailExtraction', () => ({
  emailExtractionListInputSchema: vi.fn(),
  emailExtractionTaskResultInputSchema: vi.fn(),
  emailExtractionByIdInputSchema: vi.fn(),
  emailExtractionUpdateInputSchema: vi.fn(),
  emailExtractionExportInputSchema: vi.fn(),
}));

vi.mock('@/controller/emailextractionController', () => ({
  EmailextractionController: vi.fn().mockImplementation(() => ({
    searchEmail: mocks.mockSearchEmail,
  })),
}));

vi.mock('@/modules/SearchResultModule', () => ({
  SearchResultModule: vi.fn().mockImplementation(() => ({
    getAllSearchResultsByTaskId: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/modules/EmailSearchTaskModule', () => ({
  EmailSearchTaskModule: vi.fn().mockImplementation(() => ({
    resetOrphanedProcessingTasks: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/modules/GoogleMapsModule', () => ({
  GoogleMapsModule: vi.fn().mockImplementation(() => ({
    getSearchRecord: mocks.mockGetGoogleRecord,
  })),
}));

vi.mock('@/modules/YandexMapsModule', () => ({
  YandexMapsModule: vi.fn().mockImplementation(() => ({
    getSearchRecord: mocks.mockGetYandexRecord,
  })),
}));

// Import AFTER mocks are registered.
import { registerEmailextractionIpcHandlers } from '@/main-process/communication/emailextraction-ipc';

function makeEvent(): { sender: { send: ReturnType<typeof vi.fn> } } {
  return { sender: { send: vi.fn() } };
}

const baseForm = {
  concurrency: 1,
  pagelength: 10,
  notShowBrowser: true,
  proxys: [],
  processTimeout: 60,
  maxPageNumber: 100,
};

describe('Email Extraction IPC — maps insight types', () => {
  beforeEach(() => {
    setupElectronMocks();
    mocks.mockSearchEmail.mockClear();
    mocks.mockGetGoogleRecord.mockReset();
    mocks.mockGetYandexRecord.mockReset();
    registerEmailextractionIpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
    vi.clearAllMocks();
  });

  test('GoogleMaps resolves website URLs and starts the task', async () => {
    mocks.mockGetGoogleRecord.mockResolvedValue({
      results: JSON.stringify([
        { name: 'A', website: 'https://a-example.com' },
        { name: 'B', website: 'no-protocol' },
        { name: 'C' },
      ]),
    });
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'GoogleMaps', searchTaskId: 5 })
    );

    expect(mocks.mockGetGoogleRecord).toHaveBeenCalledWith(5);
    expect(mocks.mockSearchEmail).toHaveBeenCalledTimes(1);
    const data = mocks.mockSearchEmail.mock.calls[0][0];
    expect(data.type).toBe(EmailExtractionTypes.GoogleMaps);
    expect(data.searchResultId).toBe(5);
    expect(data.validUrls).toEqual(['https://a-example.com']);
    const sent = JSON.parse(event.sender.send.mock.calls[0][1]);
    expect(sent.status).toBe(true);
    expect(sent.data.action).toBe('emailscrape.emailsearch_task_start');
  });

  test('GoogleMaps with missing record id emits searchTaskId_empty and does not start', async () => {
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'GoogleMaps', searchTaskId: 0 })
    );

    expect(mocks.mockSearchEmail).not.toHaveBeenCalled();
    const sent = JSON.parse(event.sender.send.mock.calls[0][1]);
    expect(sent.status).toBe(false);
    expect(sent.data.content).toBe('emailscrape.searchTaskId_empty');
  });

  test('GoogleMaps with no website URLs emits mapsResult_empty', async () => {
    mocks.mockGetGoogleRecord.mockResolvedValue({
      results: JSON.stringify([{ name: 'A' }, { name: 'B' }]),
    });
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'GoogleMaps', searchTaskId: 7 })
    );

    expect(mocks.mockSearchEmail).not.toHaveBeenCalled();
    const sent = JSON.parse(event.sender.send.mock.calls[0][1]);
    expect(sent.status).toBe(false);
    expect(sent.data.content).toBe('emailscrape.mapsResult_empty');
  });

  test('YandexMaps resolves website URLs and starts the task', async () => {
    mocks.mockGetYandexRecord.mockResolvedValue({
      results: JSON.stringify([{ name: 'Y', website: 'https://y-example.com' }]),
    });
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'YandexMaps', searchTaskId: 9 })
    );

    expect(mocks.mockGetYandexRecord).toHaveBeenCalledWith(9);
    const data = mocks.mockSearchEmail.mock.calls[0][0];
    expect(data.type).toBe(EmailExtractionTypes.YandexMaps);
    expect(data.validUrls).toEqual(['https://y-example.com']);
  });
});
