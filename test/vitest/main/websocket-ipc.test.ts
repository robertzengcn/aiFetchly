/**
 * WebSocket IPC Handler Tests
 * 
 * Tests the WebSocket IPC handlers by capturing the handlers registered
 * via ipcMain.handle and testing them directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';

// Store captured handlers
const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {};

// Mock WebSocketClient
const mockWsClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  getStatus: vi.fn((): string => 'disconnected'),
  getClientId: vi.fn((): string | null => null),
  isConnected: vi.fn((): boolean => false),
  send: vi.fn((): boolean => true),
  clearMessageQueue: vi.fn(),
};

// Mock Electron's ipcMain - capture handlers when registered
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      capturedHandlers[channel] = handler;
    }),
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

// Mock Logger
vi.mock('@/modules/Logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks are set up
import { registerWebSocketIpcHandlers } from '@/main-process/communication/websocket-ipc';
import {
  WEBSOCKET_CONNECT,
  WEBSOCKET_DISCONNECT,
  WEBSOCKET_RECONNECT,
  WEBSOCKET_STATUS,
  WEBSOCKET_SEND,
} from '@/config/channellist';

describe('WebSocket IPC Handlers', () => {
  let mockMainWindow: {
    webContents: { send: Mock };
    isDestroyed: Mock;
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Clear captured handlers
    Object.keys(capturedHandlers).forEach(key => delete capturedHandlers[key]);

    // Create mock main window
    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };

    (BrowserWindow as unknown as { getAllWindows: Mock }).getAllWindows.mockReturnValue([mockMainWindow]);

    // Register handlers with the mock window
    registerWebSocketIpcHandlers(mockMainWindow as unknown as BrowserWindow);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('websocketConnectHandler (WEBSOCKET_CONNECT)', () => {
    it('should connect to WebSocket server', async () => {
      mockWsClient.connect.mockReturnValue(undefined);

      const handler = capturedHandlers[WEBSOCKET_CONNECT];
      expect(handler).toBeDefined();
      
      const result = await handler();

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

      const handler = capturedHandlers[WEBSOCKET_CONNECT];
      const result = await handler();

      expect(result).toEqual({
        status: false,
        msg: 'Connection failed',
      });
    });
  });

  describe('websocketDisconnectHandler (WEBSOCKET_DISCONNECT)', () => {
    it('should disconnect from WebSocket server', async () => {
      const handler = capturedHandlers[WEBSOCKET_DISCONNECT];
      expect(handler).toBeDefined();
      
      const result = await handler();

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

      const handler = capturedHandlers[WEBSOCKET_DISCONNECT];
      const result = await handler();

      expect(result).toEqual({
        status: false,
        msg: 'Disconnect error',
      });
    });
  });

  describe('websocketReconnectHandler (WEBSOCKET_RECONNECT)', () => {
    it('should force reconnect to WebSocket server', async () => {
      const handler = capturedHandlers[WEBSOCKET_RECONNECT];
      expect(handler).toBeDefined();
      
      const result = await handler();

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

      const handler = capturedHandlers[WEBSOCKET_RECONNECT];
      const result = await handler();

      expect(result).toEqual({
        status: false,
        msg: 'Reconnect error',
      });
    });
  });

  describe('websocketStatusHandler (WEBSOCKET_STATUS)', () => {
    it('should return current WebSocket status', async () => {
      mockWsClient.getStatus.mockReturnValue('connected');
      mockWsClient.getClientId.mockReturnValue('client-123');
      mockWsClient.isConnected.mockReturnValue(true);

      const handler = capturedHandlers[WEBSOCKET_STATUS];
      expect(handler).toBeDefined();
      
      const result = await handler();

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

      const handler = capturedHandlers[WEBSOCKET_STATUS];
      const result = await handler();

      expect(result).toEqual({
        status: false,
        msg: 'Status error',
      });
    });
  });

  describe('websocketSendHandler (WEBSOCKET_SEND)', () => {
    it('should send message through WebSocket', async () => {
      const message = { type: 'test', data: 'hello' };
      mockWsClient.send.mockReturnValue(true);

      const handler = capturedHandlers[WEBSOCKET_SEND];
      expect(handler).toBeDefined();
      
      // The handler receives (event, message) but we only care about the message
      const result = await handler({}, message);

      expect(result).toEqual({
        status: true,
        msg: 'Message sent',
      });
      expect(mockWsClient.send).toHaveBeenCalledWith(message);
    });

    it('should handle message sending failure', async () => {
      const message = { type: 'test', data: 'hello' };
      mockWsClient.send.mockReturnValue(false);

      const handler = capturedHandlers[WEBSOCKET_SEND];
      const result = await handler({}, message);

      expect(result).toEqual({
        status: false,
        msg: 'Failed to send message (not connected)',
      });
    });

    it('should handle send errors', async () => {
      const message = { type: 'test', data: 'hello' };
      mockWsClient.send.mockImplementation(() => {
        throw new Error('Send error');
      });

      const handler = capturedHandlers[WEBSOCKET_SEND];
      const result = await handler({}, message);

      expect(result).toEqual({
        status: false,
        msg: 'Send error',
      });
    });
  });
});
