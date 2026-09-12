/**
 * WebSocket Client Tests
 */

import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { WebSocketClient } from '@/modules/WebSocketClient';
import { Token } from '@/modules/token';
import { TOKENNAME } from '@/config/usersetting';
import { BrowserWindow } from 'electron';
import WebSocket from 'ws';

/** Private members accessed by these tests. */
interface WebSocketClientInternals {
  hasValidToken(): boolean;
  messageQueue: Record<string, unknown>[];
  MAX_QUEUE_SIZE: number;
  maxReconnectAttempts: number;
  reconnectDelay: number;
  maxReconnectDelay: number;
  manualDisconnect: boolean;
  reconnectAttempts: number;
  ws: { readyState: number } | null;
  doConnect(): void;
}

function internals(client: WebSocketClient): WebSocketClientInternals {
  return client as unknown as WebSocketClientInternals;
}

describe('WebSocketClient', () => {
  let wsClient: WebSocketClient;
  let tokenGetValueStub: SinonStub;
  let browserWindowMock: BrowserWindow;

  beforeEach(() => {
    // Reset singleton instance
    (WebSocketClient as unknown as { instance: WebSocketClient | null }).instance = null;

    // Mock Token service
    tokenGetValueStub = sinon.stub(Token.prototype, 'getValue');
    tokenGetValueStub.withArgs(TOKENNAME).returns('valid.jwt.token');

    // Mock BrowserWindow
    browserWindowMock = {
      webContents: {
        send: sinon.stub(),
      },
      isDestroyed: sinon.stub().returns(false),
    } as unknown as BrowserWindow;

    // Set environment for development
    process.env.NODE_ENV = 'test';
    process.env.VITE_LOGIN_URL = 'http://localhost:3000';

    wsClient = WebSocketClient.getInstance();
  });

  afterEach(() => {
    sinon.restore();
    if (wsClient) {
      wsClient.disconnect();
    }
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = WebSocketClient.getInstance();
      const instance2 = WebSocketClient.getInstance();
      expect(instance1).to.equal(instance2);
    });

    it('should reset instance correctly', () => {
      const instance1 = WebSocketClient.getInstance();
      WebSocketClient.resetInstance();
      const instance2 = WebSocketClient.getInstance();
      expect(instance1).to.not.equal(instance2);
    });
  });

  describe('Connection Status', () => {
    it('should return initial status as disconnected', () => {
      expect(wsClient.getStatus()).to.equal('disconnected');
    });

    it('should return null for client ID when not connected', () => {
      expect(wsClient.getClientId()).to.be.null;
    });

    it('should return false for isConnected when not connected', () => {
      expect(wsClient.isConnected()).to.be.false;
    });
  });

  describe('Token Validation', () => {
    it('should validate token existence', () => {
      // Create a valid JWT token format
      const validPayload = {
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        user_id: 123,
      };
      const validToken = `header.${Buffer.from(JSON.stringify(validPayload)).toString('base64')}.signature`;

      tokenGetValueStub.withArgs(TOKENNAME).returns(validToken);
      const result = internals(wsClient).hasValidToken();
      expect(result).to.be.true;
    });

    it('should reject empty token', () => {
      tokenGetValueStub.withArgs(TOKENNAME).returns('');
      const result = internals(wsClient).hasValidToken();
      expect(result).to.be.false;
    });

    it('should reject null token', () => {
      tokenGetValueStub.withArgs(TOKENNAME).returns(null);
      const result = internals(wsClient).hasValidToken();
      expect(result).to.be.false;
    });

    it('should validate JWT token expiration', () => {
      // Create an expired token (exp in the past)
      const expiredPayload = {
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        user_id: 123,
      };
      const expiredToken = `header.${Buffer.from(JSON.stringify(expiredPayload)).toString('base64')}.signature`;

      tokenGetValueStub.withArgs(TOKENNAME).returns(expiredToken);
      const result = internals(wsClient).hasValidToken();
      expect(result).to.be.false;
    });

    it('should accept valid JWT token', () => {
      // Create a valid token (exp in the future)
      const validPayload = {
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        user_id: 123,
      };
      const validToken = `header.${Buffer.from(JSON.stringify(validPayload)).toString('base64')}.signature`;

      tokenGetValueStub.withArgs(TOKENNAME).returns(validToken);
      const result = internals(wsClient).hasValidToken();
      expect(result).to.be.true;
    });
  });

  describe('Message Queuing', () => {
    it('should queue messages when disconnected', () => {
      const result = wsClient.send({ type: 'test', data: 'message' });
      expect(result).to.be.false;

      const queueSize = internals(wsClient).messageQueue.length;
      expect(queueSize).to.be.greaterThan(0);
    });

    it('should not queue ping/pong messages', () => {
      wsClient.send({ type: 'ping' });
      wsClient.send({ type: 'pong' });

      const queueSize = internals(wsClient).messageQueue.length;
      expect(queueSize).to.equal(0);
    });

    it('should limit queue size', () => {
      const maxSize = internals(wsClient).MAX_QUEUE_SIZE;

      // Send more messages than max size
      for (let i = 0; i < maxSize + 10; i++) {
        wsClient.send({ type: 'test', id: i });
      }

      const queueSize = internals(wsClient).messageQueue.length;
      expect(queueSize).to.be.at.most(maxSize);
    });

    it('should clear message queue', () => {
      wsClient.send({ type: 'test', data: 'message1' });
      wsClient.send({ type: 'test', data: 'message2' });

      wsClient.clearMessageQueue();

      const queueSize = internals(wsClient).messageQueue.length;
      expect(queueSize).to.equal(0);
    });
  });

  describe('Configuration', () => {
    it('should use environment variables for configuration', () => {
      // Note: These tests check that the configuration constants are properly
      // initialized. Since WS_CONFIG is evaluated at module load time,
      // we need to check the default values here.

      // The actual values come from the WS_CONFIG constant
      expect(internals(wsClient).maxReconnectAttempts).to.be.a('number');
      expect(internals(wsClient).reconnectDelay).to.be.a('number');
      expect(internals(wsClient).maxReconnectDelay).to.be.a('number');
    });

    it('should use default values when env vars not set', () => {
      // Check that default configuration values are set
      // Default values are: MAX_RECONNECT_ATTEMPTS: 10, RECONNECT_DELAY: 3000, etc.
      expect(internals(wsClient).maxReconnectAttempts).to.be.greaterThan(0);
      expect(internals(wsClient).reconnectDelay).to.be.greaterThan(0);
      expect(internals(wsClient).maxReconnectDelay).to.be.greaterThan(0);
    });

    it('should throw error in production if VITE_LOGIN_URL not set', () => {
      WebSocketClient.resetInstance();
      delete process.env.VITE_LOGIN_URL;
      process.env.NODE_ENV = 'production';

      expect(() => {
        WebSocketClient.getInstance();
      }).to.throw('VITE_LOGIN_URL must be set in production environment');
    });
  });

  describe('Disconnect', () => {
    it('should set manualDisconnect flag', () => {
      wsClient.disconnect();
      expect(internals(wsClient).manualDisconnect).to.be.true;
    });

    it('should clear client ID', () => {
      wsClient.disconnect();
      expect(wsClient.getClientId()).to.be.null;
    });

    it('should reset reconnect attempts', () => {
      internals(wsClient).reconnectAttempts = 5;
      wsClient.disconnect();
      expect(internals(wsClient).reconnectAttempts).to.equal(0);
    });
  });

  describe('Reconnect', () => {
    it('should disconnect and clear manual flag', () => {
      internals(wsClient).manualDisconnect = true;
      wsClient.reconnect();
      expect(internals(wsClient).manualDisconnect).to.be.false;
    });
  });

  describe('retryConnectIfDisconnected', () => {
    it('should skip retry when token is still invalid', () => {
      tokenGetValueStub.withArgs(TOKENNAME).returns('');
      const result = wsClient.retryConnectIfDisconnected(browserWindowMock);
      expect(result).to.be.false;
    });

    it('should skip retry when no window is available', () => {
      const validPayload = {
        exp: Math.floor(Date.now() / 1000) + 3600,
        user_id: 123,
      };
      const validToken = `header.${Buffer.from(JSON.stringify(validPayload)).toString('base64')}.signature`;
      tokenGetValueStub.withArgs(TOKENNAME).returns(validToken);

      const result = wsClient.retryConnectIfDisconnected();
      expect(result).to.be.false;
    });

    it('should connect after token becomes valid and a window is provided', () => {
      const doConnectStub = sinon.stub(internals(wsClient), 'doConnect');
      const validPayload = {
        exp: Math.floor(Date.now() / 1000) + 3600,
        user_id: 123,
      };
      const validToken = `header.${Buffer.from(JSON.stringify(validPayload)).toString('base64')}.signature`;
      tokenGetValueStub.withArgs(TOKENNAME).returns(validToken);

      const result = wsClient.retryConnectIfDisconnected(browserWindowMock);

      expect(result).to.be.true;
      expect(doConnectStub.calledOnce).to.be.true;
    });

    it('should not open a second socket when already connected', () => {
      const doConnectStub = sinon.stub(internals(wsClient), 'doConnect');
      internals(wsClient).ws = { readyState: WebSocket.OPEN };

      const result = wsClient.retryConnectIfDisconnected(browserWindowMock);

      expect(result).to.be.true;
      expect(doConnectStub.called).to.be.false;
    });
  });
});
