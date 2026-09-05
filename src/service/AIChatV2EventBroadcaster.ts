import type { BrowserWindow } from "electron";
import {
  AI_CHAT_V2_PENDING_EVENT,
  AI_CHAT_V2_STREAM_CHUNK,
  AI_CHAT_V2_STREAM_COMPLETE,
} from "@/config/channellist";
import type {
  AIChatPendingMessageEvent,
  ChatV2StreamChunk,
} from "@/entityTypes/aiChatV2Types";

/**
 * Window-safe broadcast for interactive stream chunks and pending-message
 * lifecycle events (message-queue technical design §14.2).
 *
 * The legacy stream path attached renderer listeners only for the window
 * that started a turn. Queue-dispatched turns start in the main process, so
 * stream + pending events must reach every live window; renderer handlers
 * already filter by conversation id, preserving isolation.
 */
interface BroadcastWindow {
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): void;
  readonly webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

export class AIChatV2EventBroadcaster {
  private static instance: AIChatV2EventBroadcaster | null = null;
  private readonly windows = new Set<BroadcastWindow>();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): AIChatV2EventBroadcaster {
    if (!AIChatV2EventBroadcaster.instance) {
      AIChatV2EventBroadcaster.instance = new AIChatV2EventBroadcaster();
    }
    return AIChatV2EventBroadcaster.instance;
  }

  /** Register a window as a broadcast target (wired at IPC registration). */
  register(win: BrowserWindow): void {
    const view = win as unknown as BroadcastWindow;
    this.windows.add(view);
    view.once("closed", () => {
      this.windows.delete(view);
    });
  }

  /** Send an interactive stream chunk to all live windows. */
  emitStreamChunk(chunk: ChatV2StreamChunk): void {
    const payload = JSON.stringify(chunk);
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(AI_CHAT_V2_STREAM_CHUNK, payload);
      }
    }
  }

  /** Send a terminal stream event to all live windows. */
  emitStreamComplete(chunk: ChatV2StreamChunk): void {
    const payload = JSON.stringify(chunk);
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(AI_CHAT_V2_STREAM_COMPLETE, payload);
      }
    }
  }

  /**
   * Send a pending-message lifecycle event to all live windows. Events are
   * refreshable hints containing sanitized views only — no attachment
   * bytes, credentials, hidden reasoning, or unsanitized tool results.
   */
  emitPendingEvent(event: AIChatPendingMessageEvent): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(AI_CHAT_V2_PENDING_EVENT, event);
      }
    }
  }
}
