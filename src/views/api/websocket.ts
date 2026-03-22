/**
 * WebSocket API for renderer process
 *
 * This module provides a Vue composable and utility functions for interacting
 * with the WebSocket connection to the marketing server.
 *
 * @example
 * ```typescript
 * import { useWebSocket } from '@/views/api/websocket';
 *
 * // In your Vue component setup
 * const {
 *   connectionStatus,
 *   notifications,
 *   connect,
 *   disconnect
 * } = useWebSocket();
 * ```
 */

import { ref, onMounted, readonly } from 'vue';
import {
  WEBSOCKET_EVENT,
  WEBSOCKET_CONNECT,
  WEBSOCKET_DISCONNECT,
  WEBSOCKET_RECONNECT,
  WEBSOCKET_STATUS,
  WEBSOCKET_SEND,
} from '@/config/channellist';
import type {
  WSConnectionStatus,
  WSMessage,
  WSClientEvent,
  NotificationPayload,
  UpdatePayload,
  StatusPayload,
} from '@/entityTypes/websocketType';

// Re-export types for convenience
export type {
  WSConnectionStatus,
  WSMessage,
  WSClientEvent,
  NotificationPayload,
  UpdatePayload,
  StatusPayload,
};

declare const window: Window & {
  api: {
    receive: (channel: string, func: (...args: unknown[]) => void) => void;
    invoke: (channel: string, data?: unknown) => Promise<unknown>;
  };
};

/**
 * WebSocket status response
 */
export interface WSStatusResponse {
  status: boolean;
  data?: {
    connectionStatus: WSConnectionStatus;
    clientId: string | null;
    isConnected: boolean;
  };
  msg?: string;
}

/**
 * Connect to WebSocket server
 */
export async function connectWebSocket(): Promise<{ status: boolean; msg: string }> {
  try {
    const result = await window.api.invoke(WEBSOCKET_CONNECT);
    return result as { status: boolean; msg: string };
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    return { status: false, msg: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Disconnect from WebSocket server
 */
export async function disconnectWebSocket(): Promise<{ status: boolean; msg: string }> {
  try {
    const result = await window.api.invoke(WEBSOCKET_DISCONNECT);
    return result as { status: boolean; msg: string };
  } catch (error) {
    console.error('Failed to disconnect WebSocket:', error);
    return { status: false, msg: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Force reconnect to WebSocket server
 */
export async function reconnectWebSocket(): Promise<{ status: boolean; msg: string }> {
  try {
    const result = await window.api.invoke(WEBSOCKET_RECONNECT);
    return result as { status: boolean; msg: string };
  } catch (error) {
    console.error('Failed to reconnect WebSocket:', error);
    return { status: false, msg: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Get WebSocket connection status
 */
export async function getWebSocketStatus(): Promise<WSStatusResponse> {
  try {
    const result = await window.api.invoke(WEBSOCKET_STATUS);
    return result as WSStatusResponse;
  } catch (error) {
    console.error('Failed to get WebSocket status:', error);
    return { status: false, msg: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Send a message through WebSocket
 */
export async function sendWebSocketMessage(message: Record<string, unknown>): Promise<{ status: boolean; msg: string }> {
  try {
    const result = await window.api.invoke(WEBSOCKET_SEND, message);
    return result as { status: boolean; msg: string };
  } catch (error) {
    console.error('Failed to send WebSocket message:', error);
    return { status: false, msg: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Vue composable for WebSocket functionality
 * 
 * Provides reactive state and methods for managing the WebSocket connection.
 * 
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useWebSocket } from '@/views/api/websocket';
 * 
 * const { 
 *   connectionStatus, 
 *   isConnected,
 *   notifications,
 *   updates,
 *   connect, 
 *   disconnect,
 *   reconnect 
 * } = useWebSocket();
 * 
 * // Watch for notifications
 * watch(notifications, (newNotifications) => {
 *   if (newNotifications.length > 0) {
 *     const latest = newNotifications[newNotifications.length - 1];
 *     // Handle notification
 *   }
 * });
 * </script>
 * 
 * <template>
 *   <div>
 *     <p>Status: {{ connectionStatus }}</p>
 *     <button @click="connect" :disabled="isConnected">Connect</button>
 *     <button @click="disconnect" :disabled="!isConnected">Disconnect</button>
 *   </div>
 * </template>
 * ```
 */
export function useWebSocket() {
  const connectionStatus = ref<WSConnectionStatus>('disconnected');
  const isConnected = ref(false);
  const clientId = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const notifications = ref<WSMessage[]>([]);
  const updates = ref<WSMessage[]>([]);
  const statusMessages = ref<WSMessage[]>([]);

  // Maximum number of messages to keep in memory
  const MAX_MESSAGES = 100;

  /**
   * Handle incoming WebSocket events from main process
   */
  const handleWebSocketEvent = (event: WSClientEvent) => {
    switch (event.type) {
      case 'status':
        if ('status' in event.data) {
          connectionStatus.value = event.data.status;
          isConnected.value = event.data.status === 'connected';
        }
        break;

      case 'message': {
        const message = event.data as WSMessage;
        switch (message.type) {
          case 'notification':
            notifications.value = [...notifications.value.slice(-MAX_MESSAGES + 1), message];
            break;
          case 'update':
            updates.value = [...updates.value.slice(-MAX_MESSAGES + 1), message];
            break;
          case 'status':
            statusMessages.value = [...statusMessages.value.slice(-MAX_MESSAGES + 1), message];
            break;
          case 'connected':
            if (message.payload && typeof message.payload.client_id === 'string') {
              clientId.value = message.payload.client_id;
            }
            break;
        }
        break;
      }

      case 'error':
        if ('error' in event.data) {
          lastError.value = event.data.error;
        }
        break;
    }
  };

  /**
   * Connect to WebSocket server
   */
  const connect = async () => {
    lastError.value = null;
    const result = await connectWebSocket();
    if (!result.status) {
      lastError.value = result.msg;
    }
    return result;
  };

  /**
   * Disconnect from WebSocket server
   */
  const disconnect = async () => {
    const result = await disconnectWebSocket();
    if (!result.status) {
      lastError.value = result.msg;
    }
    return result;
  };

  /**
   * Force reconnect to WebSocket server
   */
  const reconnect = async () => {
    lastError.value = null;
    const result = await reconnectWebSocket();
    if (!result.status) {
      lastError.value = result.msg;
    }
    return result;
  };

  /**
   * Send a custom message through WebSocket
   */
  const send = async (message: Record<string, unknown>) => {
    const result = await sendWebSocketMessage(message);
    if (!result.status) {
      lastError.value = result.msg;
    }
    return result;
  };

  /**
   * Refresh status from main process
   */
  const refreshStatus = async () => {
    const result = await getWebSocketStatus();
    if (result.status && result.data) {
      connectionStatus.value = result.data.connectionStatus;
      isConnected.value = result.data.isConnected;
      clientId.value = result.data.clientId;
    }
    return result;
  };

  /**
   * Clear all stored messages
   */
  const clearMessages = () => {
    notifications.value = [];
    updates.value = [];
    statusMessages.value = [];
  };

  /**
   * Clear the last error
   */
  const clearError = () => {
    lastError.value = null;
  };

  // Set up event listener on mount
  onMounted(() => {
    window.api.receive(WEBSOCKET_EVENT, (event: unknown) => {
      handleWebSocketEvent(event as WSClientEvent);
    });

    // Get initial status
    refreshStatus();
  });

  return {
    // State (readonly to prevent direct mutation)
    connectionStatus: readonly(connectionStatus),
    isConnected: readonly(isConnected),
    clientId: readonly(clientId),
    lastError: readonly(lastError),
    notifications: readonly(notifications),
    updates: readonly(updates),
    statusMessages: readonly(statusMessages),

    // Actions
    connect,
    disconnect,
    reconnect,
    send,
    refreshStatus,
    clearMessages,
    clearError,
  };
}

export default useWebSocket;
