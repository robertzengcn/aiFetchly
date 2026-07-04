// src/views/api/slashCommands.ts
// Renderer-side wrappers for the slash-command + AiFetchly-config IPC surface
// (Phase 13 — Plans 03b/04). Mirrors the flat windowInvoke pattern of
// src/views/api/workspace.ts (research-resolved Q2: flat, NOT namespaced).
//
// Trust boundary (TRS-07): this file MUST NOT import fs/path/os or touch the
// filesystem — it is a thin typed wrapper over the preload invoke whitelist.
// Plan 13-05 enforces this with a boundary grep test.

import {
  windowInvoke,
  windowReceive,
  windowRemoveListener,
} from "@/views/utils/apirequest";
import {
  SLASH_COMMAND_LIST,
  SLASH_COMMAND_DISPATCH,
  AIFETCHLY_CONFIG_RELOAD,
  AIFETCHLY_CONFIG_STATUS,
  AIFETCHLY_CONFIG_CHANGED,
} from "@/config/channellist";
import type {
  SlashCommandDispatchRequest,
  SlashCommandDispatchResponse,
  SlashCommandListResponse,
} from "@/entityTypes/slashCommandTypes";
import type {
  AIFetchlyConfigReloadSummary,
  AIFetchlyConfigStatus,
} from "@/service/aifetchlyConfig/AIFetchlyConfigManager";

/**
 * Optional filters accepted by {@link listSlashCommands}. Both fields are
 * optional — empty input returns all commands in registry order.
 */
export interface ListSlashCommandsRequest {
  readonly conversationId?: string;
  readonly query?: string;
}

/**
 * Optional context accepted by reload/status. Phase 13 takes no parameters;
 * the conversationId is accepted for forward-compat with phase 14+ workspace
 * trust resolution.
 */
export interface AifetchlyConfigContextRequest {
  readonly conversationId?: string;
}

/**
 * Payload delivered to {@link onAifetchlyConfigChanged} subscribers. Mirrors
 * the JSON-stringified shape emitted by slash-command-ipc.ts emitConfigChanged
 * (counts + diff metadata only — never raw file bodies or prompt content;
 * T-13-Leak mitigation).
 */
export interface AifetchlyConfigChangedEvent {
  readonly source: string;
  readonly summary: AIFetchlyConfigReloadSummary;
}

/**
 * List renderer-safe slash commands, optionally filtered/ranked by query.
 * The response carries {@link SlashCommandView} projections only — the raw
 * prompt body and arbitrary metadata are stripped on the main-process side
 * (design §5.5/§14.2, T-13-Leak mitigation).
 */
export async function listSlashCommands(
  req: ListSlashCommandsRequest = {}
): Promise<SlashCommandListResponse> {
  return windowInvoke(SLASH_COMMAND_LIST, req) as Promise<SlashCommandListResponse>;
}

/**
 * Dispatch a single composer submission (CMD-04). `rawInput` is the full
 * composer text (e.g. "/status", "/review Acme"); the main-process dispatcher
 * parses it internally and resolves the name through the CommandRegistry.
 *
 * Returns the CMD-04 discriminated union:
 *   - `submit_prompt`: renderer submits the returned prompt via the existing
 *     AI_CHAT_V2_STREAM channel (gated downstream — TRS-05 Strategy A).
 *   - `show_result`: built-in/local result; renderer renders the content.
 *   - `{status:false, msg}`: unknown / disabled / boundary-case failure.
 */
export async function dispatchSlashCommand(
  req: SlashCommandDispatchRequest
): Promise<SlashCommandDispatchResponse> {
  return windowInvoke(
    SLASH_COMMAND_DISPATCH,
    req
  ) as Promise<SlashCommandDispatchResponse>;
}

/**
 * Force a config rescan (DX-02 + success criterion 3). On the main-process
 * side, a successful reload emits AIFETCHLY_CONFIG_CHANGED to the renderer
 * so any subscribed cache refreshes.
 */
export async function reloadAifetchlyConfig(
  req: AifetchlyConfigContextRequest = {}
): Promise<AIFetchlyConfigReloadSummary> {
  return windowInvoke(
    AIFETCHLY_CONFIG_RELOAD,
    req
  ) as Promise<AIFetchlyConfigReloadSummary>;
}

/**
 * Read the current AiFetchly config status (DX-02). Surfaces command/agent/
 * hook/skill/diagnostic counts + the phase-14 watcher placeholder.
 */
export async function getAifetchlyConfigStatus(
  req: AifetchlyConfigContextRequest = {}
): Promise<AIFetchlyConfigStatus> {
  return windowInvoke(
    AIFETCHLY_CONFIG_STATUS,
    req
  ) as Promise<AIFetchlyConfigStatus>;
}

/**
 * Subscribe to main->renderer AIFETCHLY_CONFIG_CHANGED events (design §16.3,
 * §18.2). The renderer refreshes its local command cache when the event fires.
 *
 * @returns An unsubscribe function that removes the listener. The caller
 *          MUST call it on unmount to avoid leaking listeners across
 *          AiChatV2 instance re-mounts.
 */
export function onAifetchlyConfigChanged(
  callback: (event: AifetchlyConfigChangedEvent) => void
): () => void {
  // The main process emits a JSON-stringified payload; parse it back into
  // the typed shape before handing it to the caller. Defensive: if the
  // payload is not a string or fails to parse, drop the event silently
  // rather than throwing inside the listener (non-fatal — the renderer
  // will simply not refresh this once).
  const listener = (raw: unknown): void => {
    if (typeof raw !== "string") return;
    try {
      const parsed = JSON.parse(raw) as AifetchlyConfigChangedEvent;
      callback(parsed);
    } catch {
      // Ignore malformed payloads — fail closed.
    }
  };
  windowReceive(AIFETCHLY_CONFIG_CHANGED, listener);
  return () => {
    windowRemoveListener(AIFETCHLY_CONFIG_CHANGED, listener);
  };
}
