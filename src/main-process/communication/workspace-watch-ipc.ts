// src/main-process/communication/workspace-watch-ipc.ts
// Phase 14 (Plan 14-03) — workspace-watcher invoke handlers + AIFETCHLY_CONFIG_CHANGED
// event adapter.
//
// Registers four Renderer->Main invoke channels:
//   AIFETCHLY_WORKSPACE_WATCH_ACQUIRE  — chat-open acquire (CFG-02)
//   AIFETCHLY_WORKSPACE_WATCH_RELEASE  — chat-close release
//   AIFETCHLY_WORKSPACE_TRUST_PREVIEW  — main-side AGENTS.md preview (TRS-07)
//   AIFETCHLY_WORKSPACE_TRUST_SET      — approve + rescan (TRS-03)
//
// All four use the NON-AI-gated wrapper (`registerValidatedHandler`). The
// watcher is not AI-serving — it loads local config files. CLAUDE.md's
// AI-feature rule (USER_AI_ENABLED check) does not apply here.
//
// Trust boundary (CFG-02): the IPC handler NEVER trusts a renderer-provided
// workspaceRoot. The zod schemas accept only conversationId + workspaceId,
// and WorkspaceWatchModule.acquire re-resolves the approved root via
// WorkspaceResolver before forwarding to the manager.
//
// Manager event adapter: the manager emits WorkspaceWatchManagerEvent via
// its injected configChangedEmitter. This file wires that callback to
// emit AIFETCHLY_CONFIG_CHANGED on the BrowserWindow, additive over the
// Phase 13 `{source: "user", summary}` shape (D-04 — the existing source
// field stays a bare string; the workspace event adds workspaceId + diff).

import type { BrowserWindow } from "electron";
import { z } from "zod";
import { registerValidatedHandler } from "./_shared/registerValidatedHandler";
import { lazySchema } from "@/utils/lazySchema";
import { WorkspaceWatchModule } from "@/modules/WorkspaceWatchModule";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { WorkspaceModule } from "@/modules/WorkspaceModule";
import { markWorkspaceApproved } from "@/service/workspaceWatch/WorkspaceWatchManagerSingleton";
import { log } from "@/modules/Logger";
import {
  AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
  AIFETCHLY_WORKSPACE_WATCH_RELEASE,
  AIFETCHLY_WORKSPACE_TRUST_PREVIEW,
  AIFETCHLY_WORKSPACE_TRUST_SET,
  AIFETCHLY_CONFIG_CHANGED,
} from "@/config/channellist";
import type { WorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManager";
import type { WorkspaceWatchManagerEvent } from "@/service/workspaceWatch/WorkspaceWatchManager";

// --- Schemas (zod, lazySchema-cached) ---------------------------------------

const acquireRequestSchema = lazySchema(() =>
  z.object({
    conversationId: z.string().min(1),
    workspaceId: z.string().optional(),
  })
);

const releaseRequestSchema = lazySchema(() =>
  z.object({
    conversationId: z.string().min(1),
    workspaceId: z.string().optional(),
  })
);

const previewRequestSchema = lazySchema(() =>
  z.object({
    workspaceId: z.string().min(1),
  })
);

const setTrustRequestSchema = lazySchema(() =>
  z.object({
    workspaceId: z.string().min(1),
    scope: z.enum(["instructions", "all"]),
  })
);

// --- Helpers ----------------------------------------------------------------

/**
 * Emit AIFETCHLY_CONFIG_CHANGED to the renderer. Guards against the window's
 * webContents being destroyed between the manager emitting an event and the
 * main loop reaching here. Mirrors slash-command-ipc.ts emitConfigChanged.
 *
 * Payload is a JSON-stringified object — counts/diff/workspaceId metadata
 * only, never raw file bodies (T-13-Leak / T-14-Leak-v2 mitigation).
 */
function emitConfigChanged(
  win: BrowserWindow,
  payload: {
    source: string;
    workspaceId?: string;
    summary?: unknown;
    diff?: unknown;
    diagnostic?: unknown;
    message?: string;
  }
): void {
  if (!win) return;
  const contents = win.webContents;
  if (!contents) return;
  if (
    typeof (contents as unknown as { isDestroyed?: () => boolean })
      .isDestroyed === "function" &&
    (contents as unknown as { isDestroyed: () => boolean }).isDestroyed()
  ) {
    return;
  }
  contents.send(AIFETCHLY_CONFIG_CHANGED, JSON.stringify(payload));
}

// --- Handler registration ---------------------------------------------------

/**
 * Register the four Phase-14 workspace-watcher invoke handlers and wire the
 * manager's configChangedEmitter to the AIFETCHLY_CONFIG_CHANGED event
 * (D-04). Idempotent: re-calling overwrites existing handlers (Electron
 * ipcMain.handle dedupes by channel).
 *
 * @param win The BrowserWindow used to emit main->renderer events.
 * @param manager The singleton WorkspaceWatchManager. Its
 *                configChangedEmitter is replaced with a callback that
 *                forwards to win.webContents.send — supply the manager
 *                BEFORE acquiring watches so the wiring is in place.
 */
export function registerWorkspaceWatchHandlers(
  win: BrowserWindow,
  manager: WorkspaceWatchManager
): void {
  // Per-request factory: the collaborators are cheap to construct. Module
  // holds no state of its own. The approval sink wires the module's
  // approval updates into the singleton's sync cache (backs the manager's
  // trustResolver — see WorkspaceWatchManagerSingleton.ts).
  const newModule = (): WorkspaceWatchModule =>
    new WorkspaceWatchModule(
      manager,
      new WorkspaceResolver(),
      new WorkspaceModule(),
      markWorkspaceApproved
    );

  // 1. acquire — chat-open: resolve approved root, then manager.acquire.
  registerValidatedHandler(
    AIFETCHLY_WORKSPACE_WATCH_ACQUIRE,
    acquireRequestSchema,
    async (input) => {
      return newModule().acquire(input);
    }
  );

  // 2. release — chat-close: release this consumer's claim.
  registerValidatedHandler(
    AIFETCHLY_WORKSPACE_WATCH_RELEASE,
    releaseRequestSchema,
    async (input) => {
      await newModule().release(input);
      return null;
    }
  );

  // 3. preview — return the AGENTS.md content body (TRS-07 — never a path).
  registerValidatedHandler(
    AIFETCHLY_WORKSPACE_TRUST_PREVIEW,
    previewRequestSchema,
    async (input) => {
      return newModule().previewAgents(input);
    }
  );

  // 4. setTrust — approve + rescan (TRS-03 prompt actions). The module
  //    throws on invalid workspaceId (caught by registerValidatedHandler →
  //    status:false envelope). Returns {ok:true} on success or {ok:false}
  //    when the underlying approveWorkspace write returned null (concurrent
  //    revoke) — the renderer keeps the trust card visible for retry.
  registerValidatedHandler(
    AIFETCHLY_WORKSPACE_TRUST_SET,
    setTrustRequestSchema,
    async (input) => {
      return newModule().setTrust(input);
    }
  );
}

/**
 * Adapt a {@link WorkspaceWatchManagerEvent} to the AIFETCHLY_CONFIG_CHANGED
 * renderer payload (D-04). Called from the IPC layer's emitter wiring.
 *
 * Exported for use by background.ts (or wherever the manager singleton is
 * constructed) so the emitter closure can call it without re-implementing
 * the shape.
 */
export function forwardManagerEvent(
  win: BrowserWindow,
  event: WorkspaceWatchManagerEvent
): void {
  switch (event.type) {
    case "changed": {
      emitConfigChanged(win, {
        source: event.source,
        workspaceId: event.workspaceId,
        summary: event.summary,
      });
      return;
    }
    case "diagnostic": {
      // Diagnostics carry no summary counts; forward the diagnostic so the
      // renderer can surface a toast/badge if it wishes. Keep the source
      // channel single — D-04 reuses AIFETCHLY_CONFIG_CHANGED.
      emitConfigChanged(win, {
        source: event.source,
        workspaceId: event.workspaceId,
        diagnostic: event.diagnostic,
      });
      return;
    }
    case "error": {
      log.warn(
        `[workspace-watch] manager emitted error: ${event.message} (forwarded to renderer)`
      );
      emitConfigChanged(win, {
        source: event.source,
        message: event.message,
      });
      return;
    }
    default: {
      // Exhaustiveness — never match reaches here.
      const _exhaustive: never = event;
      void _exhaustive;
      return;
    }
  }
}
