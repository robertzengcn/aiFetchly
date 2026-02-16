/**
 * WebSocket-related type definitions
 * Shared between main process and renderer process
 */

/**
 * WebSocket connection status
 */
export type WSConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

/**
 * WebSocket message structure from the marketing server
 */
export interface WSMessage {
  type: string;
  payload: Record<string, unknown> & {
    notification_type?: string;
    data?: Record<string, unknown>;
  };
  user_id?: number;
  time?: number;
}

/**
 * WebSocket client events that can be emitted to the renderer
 */
export interface WSClientEvent {
  type: "status" | "message" | "error";
  data: WSMessage | { status: WSConnectionStatus } | { error: string };
}

/**
 * Notification payload from the server
 */
export interface NotificationPayload {
  notification_type: string;
  data: Record<string, unknown>;
}

/**
 * Update payload from the server
 */
export interface UpdatePayload {
  update_type: string;
  data: Record<string, unknown>;
}

/**
 * Status payload from the server
 */
export interface StatusPayload {
  status: string;
  details: Record<string, unknown>;
}
