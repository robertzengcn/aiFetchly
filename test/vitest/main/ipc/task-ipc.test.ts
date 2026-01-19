'use strict';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerTaskIpcHandlers } from '@/main-process/communication/task-ipc';
import { MockBrowserWindow, mockIpcMain, setupElectronMocks, resetElectronMocks } from '../../../utils/electron-mocks';
import { TaskController } from '@/controller/taskController';
import type { BrowserWindow } from 'electron';

// Mock TaskController
vi.mock('@/controller/taskController', () => {
  return {
    TaskController: vi.fn().mockImplementation(() => ({
      createTask: vi.fn().mockResolvedValue(1),
      updateTask: vi.fn().mockResolvedValue(true),
      deleteTask: vi.fn().mockResolvedValue(true),
      getTaskList: vi.fn().mockResolvedValue({
        tasks: [],
        total: 0,
        page: 1,
        size: 10,
      }),
      getTaskDetail: vi.fn().mockResolvedValue({
        task: {
          id: 1,
          name: 'Test Task',
          status: 'pending',
        },
      }),
      runTask: vi.fn().mockResolvedValue(true),
      cancelTask: vi.fn().mockResolvedValue(true),
      getTaskResults: vi.fn().mockResolvedValue({
        results: [],
        total: 0,
        page: 1,
        size: 10,
      }),
    })),
  };
});

describe('Task IPC Handlers', () => {
  let mockWindow: MockBrowserWindow;

  beforeEach(() => {
    setupElectronMocks();
    mockWindow = new MockBrowserWindow();
    registerTaskIpcHandlers(mockWindow as unknown as BrowserWindow);
  });

  afterEach(() => {
    resetElectronMocks();
    vi.clearAllMocks();
  });

  describe('task:create handler', () => {
    test('should register task:create handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:create');
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

      const result = await mockIpcMain.callHandler('task:create', taskData);
      expect(result).toBe(1);
    });

    test('should propagate errors', async () => {
      // Mock controller to throw error - re-register handler with error-throwing controller
      const MockedTaskController = vi.mocked(TaskController);
      MockedTaskController.mockImplementationOnce(() => ({
        createTask: vi.fn().mockRejectedValue(new Error('Creation failed')),
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        getTaskList: vi.fn(),
        getTaskDetail: vi.fn(),
        runTask: vi.fn(),
        cancelTask: vi.fn(),
        getTaskResults: vi.fn(),
      }) as unknown as TaskController);

      // Re-register handlers to use the new mock
      mockIpcMain.clearHandlers();
      registerTaskIpcHandlers(mockWindow as unknown as BrowserWindow);

      const taskData = { name: 'Test Task' };
      await expect(mockIpcMain.callHandler('task:create', taskData)).rejects.toThrow('Creation failed');
    });
  });

  describe('task:update handler', () => {
    test('should register task:update handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:update');
    });

    test('should handle task update request', async () => {
      const taskData = {
        id: 1,
        name: 'Updated Task',
      };

      const result = await mockIpcMain.callHandler('task:update', taskData);
      expect(result).toBe(true);
    });
  });

  describe('task:delete handler', () => {
    test('should register task:delete handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:delete');
    });

    test('should handle task deletion request', async () => {
      const taskData = { id: 1 };
      const result = await mockIpcMain.callHandler('task:delete', taskData);
      expect(result).toBe(true);
    });
  });

  describe('task:list handler', () => {
    test('should register task:list handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:list');
    });

    test('should handle task list request', async () => {
      const params = { page: 1, size: 10, search: undefined };
      const result = await mockIpcMain.callHandler('task:list', params);
      
      expect(result).to.have.property('tasks');
      expect(result).to.have.property('total');
      expect(result).to.have.property('page');
      expect(result).to.have.property('size');
    });
  });

  describe('task:detail handler', () => {
    test('should register task:detail handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:detail');
    });

    test('should handle task detail request', async () => {
      const params = { id: 1 };
      const result = await mockIpcMain.callHandler('task:detail', params) as { task: { id: number; name: string; status: string } };
      
      expect(result).to.have.property('task');
      expect(result.task.id).toBe(1);
    });
  });

  describe('task:run handler', () => {
    test('should register task:run handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:run');
    });

    test('should handle task run request', async () => {
      const params = { id: 1 };
      const result = await mockIpcMain.callHandler('task:run', params);
      expect(result).toBe(true);
    });
  });

  describe('task:cancel handler', () => {
    test('should register task:cancel handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:cancel');
    });

    test('should handle task cancellation request', async () => {
      const params = { id: 1 };
      const result = await mockIpcMain.callHandler('task:cancel', params);
      expect(result).toBe(true);
    });
  });

  describe('task:results handler', () => {
    test('should register task:results handler', () => {
      const channels = mockIpcMain.getRegisteredChannels();
      expect(channels).toContain('task:results');
    });

    test('should handle task results request', async () => {
      const params = { id: 1, page: 1, size: 10 };
      const result = await mockIpcMain.callHandler('task:results', params);
      
      expect(result).to.have.property('results');
      expect(result).to.have.property('total');
      expect(result).to.have.property('page');
      expect(result).to.have.property('size');
    });
  });
});
