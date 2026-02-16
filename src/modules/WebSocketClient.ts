"use strict";
import { Token } from "@/modules/token";
import { TOKENNAME } from "@/config/usersetting";
import { BrowserWindow } from "electron";
import { log } from "@/modules/Logger";
import WebSocket from "ws";
import { UserController } from "@/controller/UserController";
import type { WSConnectionStatus, WSMessage, WSClientEvent } from "@/entityTypes/websocketType";

// Export types from shared file
export type { WSConnectionStatus, WSMessage, WSClientEvent };

/**
 * Subscription notification types from the marketing server
 */
export const SubscriptionNotificationTypes = {
  ACTIVATED: "subscription_activated",
  CANCELLED: "subscription_cancelled",
  UPDATED: "subscription_updated",
  PAYMENT_FAILED: "payment_failed",
} as const;

/**
 * WebSocket configuration constants
 */
const WS_CONFIG = {
  MAX_RECONNECT_ATTEMPTS: parseInt(process.env.WS_MAX_RECONNECT || "10", 10),
  RECONNECT_DELAY: parseInt(process.env.WS_RECONNECT_DELAY || "3000", 10),
  MAX_RECONNECT_DELAY: parseInt(process.env.WS_MAX_RECONNECT_DELAY || "60000", 10),
  HEARTBEAT_INTERVAL: parseInt(process.env.WS_HEARTBEAT_INTERVAL || "30000", 10),
} as const;

/**
 * WebSocket client for connecting to the marketing server
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat/ping-pong mechanism
 * - Authentication via JWT token
 * - IPC message forwarding to renderer process
 * 
 * @example
 * ```typescript
 * const wsClient = WebSocketClient.getInstance();
 * wsClient.connect(mainWindow);
 * 
 * // Later, to disconnect
 * wsClient.disconnect();
 * ```
 */
export class WebSocketClient {
  private static instance: WebSocketClient | null = null;

  private ws: WebSocket | null = null;
  private win: BrowserWindow | null = null;
  private baseUrl: string;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = WS_CONFIG.MAX_RECONNECT_ATTEMPTS;
  private readonly reconnectDelay = WS_CONFIG.RECONNECT_DELAY;
  private readonly maxReconnectDelay = WS_CONFIG.MAX_RECONNECT_DELAY;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionStatus: WSConnectionStatus = "disconnected";
  private clientId: string | null = null;
  private manualDisconnect = false;

  // Message queue for offline scenarios
  private messageQueue: Array<{ message: Record<string, unknown>; timestamp: number }> = [];
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly QUEUE_MESSAGE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    // Get base URL from environment
    let loginUrl: string | undefined = process.env.VITE_LOGIN_URL;

    if (!loginUrl || loginUrl.trim() === "") {
      // In production, fail fast if URL is not configured
      if (process.env.NODE_ENV === "production") {
        throw new Error("VITE_LOGIN_URL must be set in production environment");
      }
      // In development, use localhost as fallback
      loginUrl = "http://localhost:3000";
      log.warn("VITE_LOGIN_URL not set, using localhost fallback for development");
    }

    // Convert HTTP URL to WebSocket URL
    // http:// -> ws://, https:// -> wss://
    if (loginUrl.startsWith("https://")) {
      this.baseUrl = loginUrl.replace("https://", "wss://");
    } else {
      this.baseUrl = loginUrl.replace("http://", "ws://");
    }

    // Append the WebSocket endpoint path (through the /apis proxy)
    this.baseUrl = this.baseUrl + "/apis/api/ws/connect";
  }

  /**
   * Get the singleton instance of WebSocketClient
   */
  public static getInstance(): WebSocketClient {
    if (!WebSocketClient.instance) {
      WebSocketClient.instance = new WebSocketClient();
    }
    return WebSocketClient.instance;
  }

  /**
   * Reset the singleton instance (useful for testing or cleanup)
   */
  public static resetInstance(): void {
    if (WebSocketClient.instance) {
      WebSocketClient.instance.disconnect();
      WebSocketClient.instance = null;
    }
  }

  /**
   * Get the current connection status
   */
  public getStatus(): WSConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * Get the client ID assigned by the server
   */
  public getClientId(): string | null {
    return this.clientId;
  }

  /**
   * Check if the user is logged in (has a valid token)
   * Also validates JWT expiration
   */
  private hasValidToken(): boolean {
    try {
      const tokenService = new Token();
      const token = tokenService.getValue(TOKENNAME);

      if (!token || token.trim().length === 0) {
        return false;
      }

      // Validate JWT expiration
      try {
        // JWT tokens have 3 parts separated by dots
        const parts = token.split(".");
        if (parts.length !== 3) {
          log.warn("Invalid JWT token format");
          return false;
        }

        // Decode the payload (second part)
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());

        // Check expiration time
        if (payload.exp && typeof payload.exp === "number") {
          const currentTime = Math.floor(Date.now() / 1000);
          if (payload.exp < currentTime) {
            log.info("JWT token has expired");
            return false;
          }
        }

        return true;
      } catch (error) {
        log.error("Failed to validate JWT token:", error);
        return false;
      }
    } catch (error) {
      log.error("Failed to check token validity:", error);
      return false;
    }
  }

  /**
   * Get the JWT token for authentication
   */
  private getToken(): string | null {
    try {
      const tokenService = new Token();
      const token = tokenService.getValue(TOKENNAME);
      return token && token.trim().length > 0 ? token : null;
    } catch (error) {
      log.error("Failed to get token:", error);
      return null;
    }
  }

  /**
   * Connect to the WebSocket server
   * 
   * @param win - BrowserWindow instance for sending IPC messages
   */
  public connect(win: BrowserWindow): void {
    this.win = win;
    this.manualDisconnect = false;

    // Check if already connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      log.info("WebSocket already connected");
      return;
    }

    // Check for valid token
    if (!this.hasValidToken()) {
      log.info("No valid token found, skipping WebSocket connection");
      return;
    }

    this.doConnect();
  }

  /**
   * Perform the actual WebSocket connection
   */
  private doConnect(): void {
    const token = this.getToken();
    if (!token) {
      log.warn("Cannot connect WebSocket: No token available");
      return;
    }

    this.updateStatus("connecting");

    try {
      // Create WebSocket connection with Authorization header
      this.ws = new WebSocket(this.baseUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      this.setupEventHandlers();
    } catch (error) {
      log.error("Failed to create WebSocket connection:", error);
      this.scheduleReconnect();
    }
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on("open", () => {
      log.info("WebSocket connected to marketing server");
      this.reconnectAttempts = 0;
      this.updateStatus("connected");
      this.startHeartbeat();
      // Process any queued messages
      this.processMessageQueue();
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        this.handleMessage(message);
      } catch (error) {
        log.error("Failed to parse WebSocket message:", error);
      }
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      log.info(`WebSocket closed: ${code} - ${reason.toString()}`);
      this.cleanup();

      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (error: Error) => {
      log.error("WebSocket error:", error);
      this.sendToRenderer({
        type: "error",
        data: { error: error.message },
      });
    });

    this.ws.on("pong", () => {
      // Server responded to ping
      log.debug("WebSocket pong received");
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: WSMessage): void {
    log.debug("WebSocket message received:", message.type);

    switch (message.type) {
      case "connected":
        // Store client ID from welcome message
        if (message.payload && typeof message.payload.client_id === "string") {
          this.clientId = message.payload.client_id;
        }
        log.info(`WebSocket connected with client ID: ${this.clientId}`);
        break;

      case "pong":
        // Application-level pong response
        break;

      case "notification":
        // Check if this is a subscription-related notification
        this.handleNotification(message);
        // Forward to renderer
        this.sendToRenderer({
          type: "message",
          data: message,
        });
        break;

      case "update":
      case "status":
        // Forward these messages to the renderer
        this.sendToRenderer({
          type: "message",
          data: message,
        });
        break;

      default:
        // Forward unknown message types as well
        this.sendToRenderer({
          type: "message",
          data: message,
        });
    }
  }

  /**
   * Handle notification messages, especially subscription-related ones
   */
  private handleNotification(message: WSMessage): void {
    const notificationType = message.payload?.notification_type;

    if (!notificationType) {
      log.debug("Notification received without notification_type");
      return;
    }

    log.info(`WebSocket notification received: ${notificationType}`);

    // Check if this is a subscription-related notification
    const subscriptionNotificationTypes = [
      SubscriptionNotificationTypes.ACTIVATED,
      SubscriptionNotificationTypes.CANCELLED,
      SubscriptionNotificationTypes.UPDATED,
      SubscriptionNotificationTypes.PAYMENT_FAILED,
    ];

    if (subscriptionNotificationTypes.includes(notificationType as typeof subscriptionNotificationTypes[number])) {
      log.info(`Subscription change detected (${notificationType}), refreshing user info...`);
      this.refreshUserInfoOnSubscriptionChange(notificationType);
    }
  }

  /**
   * Refresh user info when subscription status changes
   * This updates the user's plan and AI enabled flag in the token service
   */
  private async refreshUserInfoOnSubscriptionChange(notificationType: string): Promise<void> {
    try {
      const userController = new UserController();

      // First, refresh user info from the server
      const jwtUser = await userController.updateUserInfo();

      if (jwtUser) {
        // After updateUserInfo() refreshes from server, get the updated local data
        const userInfo = userController.getUserInfo();

        log.info(`User info refreshed after ${notificationType}:`, {
          email: userInfo.email,
          plansCount: userInfo.plans?.length || 0,
          aiEnabled: userInfo.aiEnabled,
        });

        // Notify renderer that user info has been updated due to subscription change
        this.sendToRenderer({
          type: "message",
          data: {
            type: "user_info_updated",
            payload: {
              reason: notificationType,
              plans: userInfo.plans,
              aiEnabled: userInfo.aiEnabled,
            },
          } as WSMessage,
        });
      } else {
        log.warn(`Failed to refresh user info after ${notificationType}: jwtUser is null`);
      }
    } catch (error) {
      log.error(`Failed to refresh user info after ${notificationType}:`, error);
    }
  }

  /**
   * Send an event to the renderer process via IPC
   */
  private sendToRenderer(event: WSClientEvent): void {
    if (this.win && !(this.win as any).isDestroyed()) {
      try {
        (this.win as any).webContents.send("websocket:event", event);
      } catch (error) {
        log.error("Failed to send WebSocket event to renderer:", error);
      }
    }
  }

  /**
   * Update connection status and notify renderer
   */
  private updateStatus(status: WSConnectionStatus): void {
    this.connectionStatus = status;
    this.sendToRenderer({
      type: "status",
      data: { status },
    });
  }

  /**
   * Start the heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    // Send ping at configured interval
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send application-level ping
        this.send({ type: "ping" });
      }
    }, WS_CONFIG.HEARTBEAT_INTERVAL);
  }

  /**
   * Stop the heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.manualDisconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error("Max WebSocket reconnection attempts reached");
      this.updateStatus("disconnected");
      return;
    }

    // Check if token is still valid before reconnecting
    if (!this.hasValidToken()) {
      log.info("Token no longer valid, stopping reconnection");
      this.updateStatus("disconnected");
      return;
    }

    this.updateStatus("reconnecting");

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    log.info(`WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.doConnect();
    }, delay);
  }

  /**
   * Clean up connection resources
   */
  private cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.connectionStatus !== "reconnecting") {
      this.updateStatus("disconnected");
      // Clear message queue when fully disconnected (not reconnecting)
      this.clearMessageQueue();
    }
  }

  /**
   * Send a message through the WebSocket connection
   * If disconnected, queues the message for later delivery
   *
   * @param message - Message to send
   */
  public send(message: Record<string, unknown>): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        log.error("Failed to send WebSocket message:", error);
        // Queue message for retry
        this.queueMessage(message);
        return false;
      }
    }

    // Connection not ready, queue the message
    this.queueMessage(message);
    return false;
  }

  /**
   * Queue a message for later delivery when connection is established
   */
  private queueMessage(message: Record<string, unknown>): void {
    // Don't queue ping/pong messages
    if (message.type === "ping" || message.type === "pong") {
      return;
    }

    // Check queue size limit
    if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
      // Remove oldest message
      this.messageQueue.shift();
      log.warn("WebSocket message queue full, removed oldest message");
    }

    this.messageQueue.push({
      message,
      timestamp: Date.now(),
    });

    log.debug(`Message queued (queue size: ${this.messageQueue.length})`);
  }

  /**
   * Process queued messages and send them
   */
  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    log.info(`Processing ${this.messageQueue.length} queued WebSocket messages`);

    const now = Date.now();
    const processedMessages: Array<{ message: Record<string, unknown>; timestamp: number }> = [];

    for (const queued of this.messageQueue) {
      // Check if message has expired
      if (now - queued.timestamp > this.QUEUE_MESSAGE_TTL) {
        log.debug("Skipping expired queued message");
        continue;
      }

      // Try to send the message
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify(queued.message));
          processedMessages.push(queued);
        } catch (error) {
          log.error("Failed to send queued message:", error);
        }
      }
    }

    // Remove successfully sent messages from queue
    if (processedMessages.length > 0) {
      this.messageQueue = this.messageQueue.filter(
        (m) => !processedMessages.includes(m)
      );
      log.info(`Sent ${processedMessages.length} queued messages, ${this.messageQueue.length} remaining`);
    }
  }

  /**
   * Clear all queued messages
   */
  public clearMessageQueue(): void {
    const count = this.messageQueue.length;
    this.messageQueue = [];
    log.info(`Cleared ${count} queued WebSocket messages`);
  }

  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
    this.manualDisconnect = true;
    this.cleanup();

    if (this.ws) {
      try {
        this.ws.close(1000, "Client disconnecting");
      } catch (error) {
        log.error("Error closing WebSocket:", error);
      }
      this.ws = null;
    }

    this.clientId = null;
    this.reconnectAttempts = 0;
    this.updateStatus("disconnected");
    log.info("WebSocket disconnected");
  }

  /**
   * Reconnect to the WebSocket server (force reconnection)
   */
  public reconnect(): void {
    this.disconnect();
    this.manualDisconnect = false;
    
    if (this.win && this.hasValidToken()) {
      this.doConnect();
    }
  }

  /**
   * Check if connected to WebSocket server
   */
  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export default WebSocketClient;
