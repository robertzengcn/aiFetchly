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
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

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

  // WS-1 R1.5: migrated to registerValidatedHandler. The renderer reads
  // result.status / result.msg (on error) / result.data — the same envelope
  // registerValidatedHandler emits — so no renderer change is needed. Errors
  // now throw (caught by the wrapper -> {status:false,msg}); success returns
  // the inner data (wrapper -> {status:true,msg:"ok",data}).

  /** Connect to WebSocket server */
  registerValidatedHandler(WEBSOCKET_CONNECT, noInputSchema, async () => {
    const wsClient = WebSocketClient.getInstance();
    wsClient.connect(win);
  });

  /** Disconnect from WebSocket server */
  registerValidatedHandler(WEBSOCKET_DISCONNECT, noInputSchema, async () => {
    const wsClient = WebSocketClient.getInstance();
    wsClient.disconnect();
  });

  /** Force reconnect to WebSocket server */
  registerValidatedHandler(WEBSOCKET_RECONNECT, noInputSchema, async () => {
    const wsClient = WebSocketClient.getInstance();
    wsClient.reconnect();
  });

  /** Get WebSocket connection status */
  registerValidatedHandler(WEBSOCKET_STATUS, noInputSchema, async () => {
    const wsClient = WebSocketClient.getInstance();
    return {
      connectionStatus: wsClient.getStatus(),
      clientId: wsClient.getClientId(),
      isConnected: wsClient.isConnected(),
    };
  });

  /**
   * Send a message through WebSocket.
   * TODO(WS-1): migrate to registerValidatedHandler — its `status` field is the
   * send result (true/false), not error/success, so the renderer must read
   * result.data instead of result.status (a renderer change).
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
