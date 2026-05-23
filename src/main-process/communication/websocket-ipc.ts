"use strict";
import { ipcMain, BrowserWindow } from "electron";
import { WebSocketClient } from "@/modules/WebSocketClient";
import {
  WEBSOCKET_CONNECT,
  WEBSOCKET_DISCONNECT,
  WEBSOCKET_RECONNECT,
  WEBSOCKET_STATUS,
  WEBSOCKET_SEND,
} from "@/config/channellist";
import { log } from "@/modules/Logger";

/**
 * Register WebSocket IPC handlers
 * 
 * These handlers allow the renderer process to control and interact with
 * the WebSocket connection to the marketing server.
 * 
 * @param win - BrowserWindow instance for sending events
 */
export function registerWebSocketIpcHandlers(win: BrowserWindow): void {
  log.info("Registering WebSocket IPC handlers");

  /**
   * Connect to WebSocket server
   */
  ipcMain.handle(WEBSOCKET_CONNECT, async () => {
    try {
      const wsClient = WebSocketClient.getInstance();
      wsClient.connect(win);
      return { status: true, msg: "WebSocket connection initiated" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Failed to connect WebSocket:", error);
      return { status: false, msg: errorMessage };
    }
  });

  /**
   * Disconnect from WebSocket server
   */
  ipcMain.handle(WEBSOCKET_DISCONNECT, async () => {
    try {
      const wsClient = WebSocketClient.getInstance();
      wsClient.disconnect();
      return { status: true, msg: "WebSocket disconnected" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Failed to disconnect WebSocket:", error);
      return { status: false, msg: errorMessage };
    }
  });

  /**
   * Force reconnect to WebSocket server
   */
  ipcMain.handle(WEBSOCKET_RECONNECT, async () => {
    try {
      const wsClient = WebSocketClient.getInstance();
      wsClient.reconnect();
      return { status: true, msg: "WebSocket reconnection initiated" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Failed to reconnect WebSocket:", error);
      return { status: false, msg: errorMessage };
    }
  });

  /**
   * Get WebSocket connection status
   */
  ipcMain.handle(WEBSOCKET_STATUS, async () => {
    try {
      const wsClient = WebSocketClient.getInstance();
      return {
        status: true,
        data: {
          connectionStatus: wsClient.getStatus(),
          clientId: wsClient.getClientId(),
          isConnected: wsClient.isConnected(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Failed to get WebSocket status:", error);
      return { status: false, msg: errorMessage };
    }
  });

  /**
   * Send a message through WebSocket
   */
  ipcMain.handle(WEBSOCKET_SEND, async (_event, message: unknown) => {
    try {
      const wsClient = WebSocketClient.getInstance();
      const sent = wsClient.send(message as Record<string, unknown>);
      return {
        status: sent,
        msg: sent ? "Message sent" : "Failed to send message (not connected)",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Failed to send WebSocket message:", error);
      return { status: false, msg: errorMessage };
    }
  });

  log.info("WebSocket IPC handlers registered");
}

/**
 * Initialize WebSocket connection if user is logged in
 * 
 * This function should be called during app startup after checking
 * if the user has a valid authentication token.
 * 
 * @param win - BrowserWindow instance for sending events
 */
export async function initializeWebSocketConnection(win: BrowserWindow): Promise<void> {
  try {
    const wsClient = WebSocketClient.getInstance();
    wsClient.connect(win);
    log.info("WebSocket connection initialized on app startup");
  } catch (error) {
    log.error("Failed to initialize WebSocket connection:", error);
  }
}

/**
 * Cleanup WebSocket connection on app shutdown
 */
export function cleanupWebSocketConnection(): void {
  try {
    WebSocketClient.resetInstance();
    log.info("WebSocket connection cleaned up");
  } catch (error) {
    log.error("Failed to cleanup WebSocket connection:", error);
  }
}
