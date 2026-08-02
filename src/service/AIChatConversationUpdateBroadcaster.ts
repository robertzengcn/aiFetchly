import type { BrowserWindow } from "electron";
import {
  AI_CHAT_V2_CONVERSATION_UPDATED,
  AI_CHAT_V2_SCHEDULED_STREAM,
} from "@/config/channellist";
import type {
  ChatV2ConversationUpdatedEvent,
  ChatV2ScheduledStreamEvent,
} from "@/entityTypes/aiChatScheduledLoopTypes";

/**
 * Structural view of the BrowserWindow surface this broadcaster uses. Electron's
 * type declarations omit `isDestroyed()`/`once()` on BrowserWindow (a typings
 * quirk documented in userIpc.ts), so we cast through this minimal shape.
 */
interface BroadcastWindow {
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): void;
  readonly webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

/**
 * Abstraction over the renderer broadcast so the scheduled runner does not need
 * to import BrowserWindow directly (technical-design §18.1).
 *
 * `registerCommunicationIpcHandlers(win)` registers the current window's
 * webContents with this broadcaster; the runner emits narrow refresh-hint events
 * through it after durable persistence. Events contain identifiers only — never
 * prompt text, assistant content, tool output, or secrets.
 */
export interface AIChatConversationUpdateSink {
  emit(event: ChatV2ConversationUpdatedEvent): void;
}

export class AIChatConversationUpdateBroadcaster
  implements AIChatConversationUpdateSink
{
  private static instance: AIChatConversationUpdateBroadcaster | null = null;
  private readonly windows = new Set<BroadcastWindow>();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): AIChatConversationUpdateBroadcaster {
    if (!AIChatConversationUpdateBroadcaster.instance) {
      AIChatConversationUpdateBroadcaster.instance =
        new AIChatConversationUpdateBroadcaster();
    }
    return AIChatConversationUpdateBroadcaster.instance;
  }

  /** Register a window's webContents as a broadcast target. */
  register(win: BrowserWindow): void {
    const view = win as unknown as BroadcastWindow;
    this.windows.add(view);
    view.once("closed", () => {
      this.windows.delete(view);
    });
  }

  /** Send a narrow conversation-update event to all live windows. */
  emit(event: ChatV2ConversationUpdatedEvent): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(AI_CHAT_V2_CONVERSATION_UPDATED, event);
      }
    }
  }

  /**
   * Forward a live scheduled-turn stream chunk to all live windows. Strict
   * routing (by conversation + run id) is enforced renderer-side: only the
   * window viewing the originating conversation renders it, and never into an
   * active interactive bubble (technical-design §13.2).
   */
  emitScheduledStream(event: ChatV2ScheduledStreamEvent): void {
    for (const win of this.windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(AI_CHAT_V2_SCHEDULED_STREAM, event);
      }
    }
  }
}
