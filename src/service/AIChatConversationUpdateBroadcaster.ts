import type { BrowserWindow } from "electron";
import { AI_CHAT_V2_CONVERSATION_UPDATED } from "@/config/channellist";
import type { ChatV2ConversationUpdatedEvent } from "@/entityTypes/aiChatScheduledLoopTypes";

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
  private readonly windows = new Set<BrowserWindow>();

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
    this.windows.add(win);
    win.once("closed", () => {
      this.windows.delete(win);
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
}
