import {
  AI_CHAT_WORKSPACE_DETAIL_EVENT,
  AI_CHAT_WORKSPACE_SUMMARY_EVENT,
} from "@/config/channellist";
import type {
  ChatRunDetailEvent,
  ConversationSummaryEvent,
} from "@/entityTypes/aiChatWorkspaceTypes";

/** Numeric Electron webContents id. */
export type WebContentsId = number;

/**
 * Minimal structural view of an Electron `webContents` the router needs.
 * Keeps the service testable without a real BrowserWindow.
 */
export interface RoutableWebContents {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: string): void;
}

interface RendererSubscription {
  readonly webContents: RoutableWebContents;
  selectedConversationId: string | null;
  generation: number;
}

/** Diagnostics counters (design §24.2) — identifiers only, never content. */
export interface EventRouterStats {
  readonly detailEventsSent: number;
  readonly detailEventsDroppedStale: number;
  readonly summaryEventsSent: number;
  readonly droppedDestroyedWebContents: number;
}

/**
 * Main-process subscription router for the redesigned chat workspace
 * (technical-design §7.5, §18).
 *
 * Replaces direct `event.sender` ownership of stream sinks: one selected
 * detailed subscription per live window (guarded by a selection generation),
 * redacted summary events to every live window, and nothing sent to destroyed
 * webContents. Detailed events are routed ONLY to windows whose current
 * selection matches the event's conversation — inactive conversations never
 * receive token-by-token traffic.
 */
export class AIChatEventRouter {
  private readonly subscriptions = new Map<
    WebContentsId,
    RendererSubscription
  >();

  private statsCounters = {
    detailEventsSent: 0,
    detailEventsDroppedStale: 0,
    summaryEventsSent: 0,
    droppedDestroyedWebContents: 0,
  };

  /**
   * Register (or refresh) a window's webContents. Called on first contact;
   * idempotent. The initial selection is empty — the selection handshake
   * (`select`) establishes it.
   */
  register(webContents: RoutableWebContents): void {
    this.pruneDestroyed();
    // Idempotent: keep the original object — it may already carry a live
    // selection from the selection handshake.
    if (this.subscriptions.has(webContents.id)) return;
    this.subscriptions.set(webContents.id, {
      webContents,
      selectedConversationId: null,
      generation: 0,
    });
  }

  /**
   * Selection handshake (design §11.6): atomically establish the window's
   * detailed subscription with a monotonically increasing generation. Returns
   * the accepted generation. An asynchronous response for an earlier
   * selection can never become active after a later `select` because the
   * renderer only applies snapshots matching its current generation.
   */
  select(
    webContentsId: WebContentsId,
    conversationId: string | null,
    requestedGeneration: number
  ): number {
    const sub = this.subscriptions.get(webContentsId);
    if (!sub) return -1;
    const generation = Math.max(requestedGeneration, sub.generation + 1);
    sub.selectedConversationId = conversationId;
    sub.generation = generation;
    return generation;
  }

  /** Clear the detailed selection for a window (teardown / deselect). */
  clearSelection(webContentsId: WebContentsId): void {
    const sub = this.subscriptions.get(webContentsId);
    if (sub) {
      sub.selectedConversationId = null;
      sub.generation += 1;
    }
  }

  /** Remove a destroyed renderer's subscription entirely. */
  destroy(webContentsId: WebContentsId): void {
    this.subscriptions.delete(webContentsId);
  }

  getSelection(
    webContentsId: WebContentsId
  ): { conversationId: string | null; generation: number } | null {
    const sub = this.subscriptions.get(webContentsId);
    if (!sub) return null;
    return {
      conversationId: sub.selectedConversationId,
      generation: sub.generation,
    };
  }

  /**
   * Send a detailed run event to every live window currently selecting the
   * event's conversation. Payload is the JSON-serialized envelope — the
   * preload bridge parses it before handing typed data to the renderer.
   */
  sendDetailEvent(event: ChatRunDetailEvent): void {
    this.pruneDestroyed();
    let sent = 0;
    for (const sub of this.subscriptions.values()) {
      if (sub.selectedConversationId !== event.conversationId) continue;
      sub.webContents.send(
        AI_CHAT_WORKSPACE_DETAIL_EVENT,
        JSON.stringify(event)
      );
      sent += 1;
    }
    if (sent > 0) {
      this.statsCounters.detailEventsSent += sent;
    } else {
      this.statsCounters.detailEventsDroppedStale += 1;
    }
  }

  /**
   * Broadcast a redacted summary event to every live window. Callers must
   * ensure the event contains status metadata only — never prompts, assistant
   * bodies, tool results, secrets, or artifact bodies (PRD §18.3, §29).
   */
  broadcastSummary(event: ConversationSummaryEvent): void {
    this.pruneDestroyed();
    for (const sub of this.subscriptions.values()) {
      sub.webContents.send(
        AI_CHAT_WORKSPACE_SUMMARY_EVENT,
        JSON.stringify(event)
      );
      this.statsCounters.summaryEventsSent += 1;
    }
  }

  /** Whether any live window currently selects the conversation. */
  hasDetailSubscriber(conversationId: string): boolean {
    this.pruneDestroyed();
    for (const sub of this.subscriptions.values()) {
      if (sub.selectedConversationId === conversationId) return true;
    }
    return false;
  }

  stats(): EventRouterStats {
    return { ...this.statsCounters };
  }

  /** Drop subscriptions whose webContents died without a destroyed event. */
  private pruneDestroyed(): void {
    for (const [id, sub] of this.subscriptions) {
      if (sub.webContents.isDestroyed()) {
        this.subscriptions.delete(id);
        this.statsCounters.droppedDestroyedWebContents += 1;
      }
    }
  }
}
