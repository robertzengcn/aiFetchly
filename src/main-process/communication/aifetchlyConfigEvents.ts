// src/main-process/communication/aifetchlyConfigEvents.ts
// Shared broadcaster for the AIFETCHLY_CONFIG_CHANGED main->renderer event.
//
// Several surfaces mutate the AiFetchly command/agent/skill/hook set and must
// notify the renderer so subscribed caches — notably the AiChatV2 slash-
// suggestion dropdown — live-refresh without a manual reload or app restart
// (PRD Problem 2). This module is the single chokepoint for that broadcast so
// every emitter agrees on payload shape, destroyed-window guarding, and JSON
// stringification (T-13-Leak: counts/diff metadata only — never raw file
// bodies or prompt content).
//
// See slashCommands.ts:onAifetchlyConfigChanged for the renderer subscriber.

import { BrowserWindow } from "electron";
import { AIFETCHLY_CONFIG_CHANGED } from "@/config/channellist";

/**
 * Payload broadcast on AIFETCHLY_CONFIG_CHANGED. Mirrors the shape the
 * existing slash-command-ipc / workspace-watch-ipc emitters already send, so
 * the renderer's {@link AifetchlyConfigChangedEvent} parses it unchanged.
 * Every field except `source` is optional metadata; subscribers MUST treat
 * absence as "no detail available, refresh everything".
 */
export interface AifetchlyConfigChangedPayload {
  /**
   * Origin of the change — bare string for backward compatibility with the
   * Phase 13 subscriber: "user" | "workspace" | "plugin".
   */
  readonly source: string;
  readonly summary?: unknown;
  /** Present when `source === "workspace"`. */
  readonly workspaceId?: string;
  readonly diff?: unknown;
  readonly diagnostic?: unknown;
  readonly message?: string;
}

/**
 * Send the event to a single window. No-op when the window or its webContents
 * is gone — defensive against mid-reload / shutdown destruction. Mirrors the
 * guard the per-file emitters in slash-command-ipc / workspace-watch-ipc use.
 */
export function emitAifetchlyConfigChangedTo(
  win: BrowserWindow | null | undefined,
  payload: AifetchlyConfigChangedPayload
): void {
  if (!win) return;
  const contents = win.webContents;
  if (!contents) return;
  // Defensive: real Electron's webContents has isDestroyed(); test mocks may
  // not. Guard the typeof so a missing method never throws during shutdown.
  if (
    typeof (contents as unknown as { isDestroyed?: () => boolean })
      .isDestroyed === "function" &&
    (contents as unknown as { isDestroyed: () => boolean }).isDestroyed()
  ) {
    return;
  }
  contents.send(AIFETCHLY_CONFIG_CHANGED, JSON.stringify(payload));
}

/**
 * Broadcast the event to every live BrowserWindow. Used by IPC handlers that
 * do not carry a specific window reference (the plugin lifecycle handlers are
 * registered without one). In the single-window app this reaches the main
 * window; the renderer-side gate (only refresh while slash suggestions are
 * open) keeps the cost negligible.
 */
export function broadcastAifetchlyConfigChanged(
  payload: AifetchlyConfigChangedPayload
): void {
  // The project's electron types type getAllWindows() loosely (the existing
  // contactExtraction-ipc broadcaster casts each element too); cast here so
  // the per-window emitter receives the typed BrowserWindow it guards on.
  const windows = BrowserWindow.getAllWindows() as BrowserWindow[];
  for (const win of windows) {
    emitAifetchlyConfigChangedTo(win, payload);
  }
}
