/**
 * WebSocket IPC Handler Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import {
  websocketConnectHandler,
  websocketDisconnectHandler,
  websocketReconnectHandler,
  websocketStatusHandler,
  websocketSendHandler,
} from '@/main-process/communication/websocket-ipc';
import { WebSocketClient } from '@/modules/WebSocketClient';
import { BrowserWindow } from 'electron';

// Mock Electron's ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock WebSocketClient
vi.mock('@/modules/WebSocketClient', () => ({
  WebSocketClient: {
    getInstance: vi.fn(() => mockWsClient),
  },
}));

const mockWsClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  getStatus: vi.fn(() => 'disconnected'),
  getClientId: vi.fn(() => null),
  isConnected: vi.fn(() => false),
  send: vi.fn(() => true),
  clearMessageQueue: vi.fn(),
};

describe('WebSocket IPC Handlers', () => {
  let mockEvent: any;
  let mockMainWindow: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock IPC event
    mockEvent = {
      sender: {
        send: vi.fn(),
      },
    };

    // Create mock main window
    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };

    (BrowserWindow as any).getAllWindows.mockReturnValue([mockMainWindow]);
  });

  describe('websocketConnectHandler', () => {
    it('should connect to WebSocket server', async () => {
      mockWsClient.connect.mockReturnValue(true);

      const result = await websocketConnectHandler(mockEvent);

      expect(result).toEqual({
        status: true,
        msg: 'WebSocket connection initiated',
      });
      expect(mockWsClient.connect).toHaveBeenCalledWith(mockMainWindow);
    });

    it('should handle connection failure', async () => {
      mockWsClient.connect.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      const result = await websocketConnectHandler(mockEvent);

      expect(result).toEqual({
        status: false,
        msg: 'Connection failed',
      });
    });

    it('should return error when no main window available', async () => {
      (BrowserWindow as any).getAllWindows.mockReturnValue([]);

      const result = await websocketConnectHandler(mockEvent);

      expect(result).toEqual({
        status: false,
        msg: 'No main window available',
      });
    });
  });

  describe('websocketDisconnectHandler', () => {
    it('should disconnect from WebSocket server', async () => {
      const result = await websocketDisconnectHandler();

      expect(result).toEqual({
        status: true,
        msg: 'WebSocket disconnected',
      });
      expect(mockWsClient.disconnect).toHaveBeenCalled();
    });

    it('should handle disconnection errors', async () => {
      mockWsClient.disconnect.mockImplementation(() => {
        throw new Error('Disconnect error');
      });

      const result = await websocketDisconnectHandler();

      expect(result).toEqual({
        status: false,
        msg: 'Disconnect error',
      });
    });
  });

  describe('websocketReconnectHandler', () => {
    it('should force reconnect to WebSocket server', async () => {
      const result = await websocketReconnectHandler();

      expect(result).toEqual({
        status: true,
        msg: 'WebSocket reconnection initiated',
      });
      expect(mockWsClient.reconnect).toHaveBeenCalled();
    });

    it('should handle reconnection errors', async () => {
      mockWsClient.reconnect.mockImplementation(() => {
        throw new Error('Reconnect error');
      });

      const result = await websocketReconnectHandler();

      expect(result).toEqual({
        status: false,
        msg: 'Reconnect error',
      });
    });
  });

  describe('websocketStatusHandler', () => {
    it('should return current WebSocket status', async () => {
      mockWsClient.getStatus.mockReturnValue('connected');
      mockWsClient.getClientId.mockReturnValue('client-123');
      mockWsClient.isConnected.mockReturnValue(true);

      const result = await websocketStatusHandler();

      expect(result).toEqual({
        status: true,
        data: {
          connectionStatus: 'connected',
          clientId: 'client-123',
          isConnected: true,
        },
      });
    });

    it('should handle status retrieval errors', async () => {
      mockWsClient.getStatus.mockImplementation(() => {
        throw new Error('Status error');
      });

      const result = await websocketStatusHandler();

      expect(result).toEqual({
        status: false,
        msg: 'Status error',
      });
    });
  });

  describe('websocketSendHandler', () => {
    it('should send message through WebSocket', async () => {
      const message = { type: 'test', data: 'hello' };
      mockWsClient.send.mockReturnValue(true);

      const result = await websocketSendHandler(mockEvent, message);

      expect(result).toEqual({
        status: true,
        msg: 'Message sent',
      });
      expect(mockWsClient.send).toHaveBeenCalledWith(message);
    });

    it('should handle message sending failure', async () => {
      const message = { type: 'test', data: 'hello' };
      mockWsClient.send.mockReturnValue(false);

      const result = await websocketSendHandler(mockEvent, message);

      expect(result).toEqual({
        status: false,
        msg: 'Failed to send message or not connected',
      });
    });

    it('should handle send errors', async () => {
      const message = { type: 'test', data: 'hello' };
      mockWsClient.send.mockImplementation(() => {
        throw new Error('Send error');
      });

      const result = await websocketSendHandler(mockEvent, message);

      expect(result).toEqual({
        status: false,
        msg: 'Send error',
      });
    });

    it('should handle missing message parameter', async () => {
      const result = await websocketSendHandler(mockEvent);

      expect(result).toEqual({
        status: false,
        msg: 'No message provided',
      });
    });
  });
});
