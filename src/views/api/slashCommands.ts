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
import type { AIFetchlyConfigDiff } from "@/entityTypes/aifetchlyConfigTypes";

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
 *
 * Phase 14 (Plan 14-03 D-04): the payload is additively extended with
 * optional `workspaceId` + `diff` for workspace-originated changes. The
 * existing `{source: "user", summary}` shape is preserved; the `source`
 * field stays a bare string so the Phase 13-04 subscriber that ignores
 * the payload arg (AiChatV2.vue onAifetchlyConfigChanged callback) keeps
 * working without modification. Plan 14-04's renderer filters on
 * `workspaceId` to scope refreshes to the active conversation.
 */
export interface AifetchlyConfigChangedEvent {
  /** Bare string — backward compatible with Phase 13. */
  readonly source: string;
  readonly summary: AIFetchlyConfigReloadSummary;
  /**
   * Present when `source === "workspace"`. The active conversation filters
   * on this id to decide whether to refresh its local cache.
   */
  readonly workspaceId?: string;
  /**
   * Forward-compat diff payload. The Phase-13 path leaves this absent; the
   * workspace event may carry it once Plan 14-04 consumes it for selective
   * invalidation. Optional on the wire — subscribers MUST treat absence as
   * "no diff available, refresh everything".
   */
  readonly diff?: AIFetchlyConfigDiff;
  /**
   * Forwarded diagnostic (workspace events only). Absent on the user-reload
   * path and on workspace `changed` events.
   */
  readonly diagnostic?: unknown;
  /**
   * Forwarded error message (workspace `error` events only — restart cap
   * exceeded, etc.). Absent on the normal paths.
   */
  readonly message?: string;
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
  return windowInvoke(
    SLASH_COMMAND_LIST,
    req
  ) as Promise<SlashCommandListResponse>;
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
