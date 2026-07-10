'use strict';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { MockBrowserWindow } from '../../../utils/electron-mocks';

/**
 * task-ipc handlers are registered via registerValidatedHandler, which wraps
 * ipcMain.handle. Under vitest the `electron` module is NOT aliased, so
 * ipcMain would resolve to undefined; capture registrations into a handlers map.
 *
 * Handlers return the CommonMessage envelope { status, msg, data } (errors are
 * caught into { status:false, msg, data:null }, never thrown).
 */
const handlers: Record<string, (event: unknown, raw: unknown) => Promise<unknown>> = {};
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      chan: string,
      h: (event: unknown, raw: unknown) => Promise<unknown>
    ) => {
      handlers[chan] = h;
    },
  },
}));

// Mock TaskController (the handlers' collaborator).
vi.mock('@/controller/taskController', () => {
  return {
    TaskController: vi.fn().mockImplementation(() => ({
      createTask: vi.fn().mockResolvedValue(1),
      updateTask: vi.fn().mockResolvedValue(true),
      deleteTask: vi.fn().mockResolvedValue(true),
      getTaskList: vi
        .fn()
        .mockResolvedValue({ tasks: [], total: 0, page: 1, size: 10 }),
      getTaskDetail: vi
        .fn()
        .mockResolvedValue({ task: { id: 1, name: 'Test Task', status: 'pending' } }),
      runTask: vi.fn().mockResolvedValue(true),
      cancelTask: vi.fn().mockResolvedValue(true),
      getTaskResults: vi
        .fn()
        .mockResolvedValue({ results: [], total: 0, page: 1, size: 10 }),
    })),
  };
});

import { TaskController } from '@/controller/taskController';
import { registerTaskIpcHandlers } from '@/main-process/communication/task-ipc';

type Envelope<T> = { status: boolean; msg: string; data: T };
const EVENT = {} as unknown;
const call = (channel: string, raw: unknown): Promise<Envelope<unknown>> =>
  handlers[channel](EVENT, raw) as Promise<Envelope<unknown>>;

describe('Task IPC Handlers', () => {
  let mockWindow: MockBrowserWindow;

  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
    mockWindow = new MockBrowserWindow();
    registerTaskIpcHandlers(mockWindow as unknown as BrowserWindow);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('task:create handler', () => {
    test('should register task:create handler', () => {
      expect(Object.keys(handlers)).toContain('task:create');
    });

    test('should handle task creation request', async () => {
      const taskData = {
        name: 'Test Task',
        platform: 'youtube',
        keywords: ['test'],
        numPages: 10,
        concurrency: 3,
        showBrowser: true,
      };
      const r = await call('task:create', taskData);
      expect(r.status).toBe(true);
      expect(r.data).toBe(1);
    });

    test('should return a failure envelope on error (not throw)', async () => {
      vi.mocked(TaskController).mockImplementationOnce(
        () =>
          ({
            createTask: vi.fn().mockRejectedValue(new Error('Creation failed')),
            updateTask: vi.fn(),
            deleteTask: vi.fn(),
            getTaskList: vi.fn(),
            getTaskDetail: vi.fn(),
            runTask: vi.fn(),
            cancelTask: vi.fn(),
            getTaskResults: vi.fn(),
          }) as unknown as TaskController
      );
      const r = await call('task:create', { name: 'boom' });
      expect(r.status).toBe(false);
      expect(r.msg).toContain('Creation failed');
      expect(r.data).toBeNull();
    });
  });

  describe('task:update handler', () => {
    test('should register task:update handler', () => {
      expect(Object.keys(handlers)).toContain('task:update');
    });

    test('should handle task update request', async () => {
      const r = await call('task:update', { id: 1, name: 'Updated Task' });
      expect(r.status).toBe(true);
      expect(r.data).toBe(true);
    });
  });

  describe('task:delete handler', () => {
    test('should register task:delete handler', () => {
      expect(Object.keys(handlers)).toContain('task:delete');
    });

    test('should handle task deletion request', async () => {
      const r = await call('task:delete', { id: 1 });
      expect(r.status).toBe(true);
      expect(r.data).toBe(true);
    });
  });

  describe('task:list handler', () => {
    test('should register task:list handler', () => {
      expect(Object.keys(handlers)).toContain('task:list');
    });

    test('should handle task list request', async () => {
      const r = await call('task:list', { page: 1, size: 10 });
      expect(r.status).toBe(true);
      expect(r.data).toHaveProperty('tasks');
      expect(r.data).toHaveProperty('total');
      expect(r.data).toHaveProperty('page');
      expect(r.data).toHaveProperty('size');
    });

    test('should reject invalid list params (missing size)', async () => {
      const r = await call('task:list', { page: 1 });
      expect(r.status).toBe(false);
      expect(r.data).toBeNull();
    });
  });

  describe('task:detail handler', () => {
    test('should register task:detail handler', () => {
      expect(Object.keys(handlers)).toContain('task:detail');
    });

    test('should handle task detail request', async () => {
      const r = await call('task:detail', { id: 1 });
      expect(r.status).toBe(true);
      const data = r.data as { task: { id: number } };
      expect(data.task.id).toBe(1);
    });
  });

  describe('task:run handler', () => {
    test('should register task:run handler', () => {
      expect(Object.keys(handlers)).toContain('task:run');
    });

    test('should handle task run request', async () => {
      const r = await call('task:run', { id: 1 });
      expect(r.status).toBe(true);
      expect(r.data).toBe(true);
    });
  });

  describe('task:cancel handler', () => {
    test('should register task:cancel handler', () => {
      expect(Object.keys(handlers)).toContain('task:cancel');
    });

    test('should handle task cancellation request', async () => {
      const r = await call('task:cancel', { id: 1 });
      expect(r.status).toBe(true);
      expect(r.data).toBe(true);
    });
  });

  describe('task:results handler', () => {
    test('should register task:results handler', () => {
      expect(Object.keys(handlers)).toContain('task:results');
    });

    test('should handle task results request', async () => {
      const r = await call('task:results', { id: 1, page: 1, size: 10 });
      expect(r.status).toBe(true);
      expect(r.data).toHaveProperty('results');
      expect(r.data).toHaveProperty('total');
      expect(r.data).toHaveProperty('page');
      expect(r.data).toHaveProperty('size');
    });
  });
});
