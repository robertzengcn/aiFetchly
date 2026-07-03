"use strict";
import {
  DIAGNOSTICS_EXPORT_REPORT,
  DIAGNOSTICS_UPLOAD_REPORT,
  DIAGNOSTICS_OPEN_FOLDER,
  DIAGNOSTICS_GET_STATUS,
  DIAGNOSTICS_SET_DEBUG,
  DIAGNOSTICS_CLEAR_LOCAL,
  DIAGNOSTICS_LIST_CRASHES,
} from "@/config/channellist";

/** Shape returned by `diagnostics:get-status`. */
export interface DiagnosticStatus {
  storageBytes: number;
  budgetBytes: number;
  debugEnabled: boolean;
  debugExpiresAt: string | null;
  lastCrashId: string | null;
}

/** Single crash record returned by `diagnostics:list-crashes`. */
export interface DiagnosticCrashEntry {
  crashId: string;
  timestamp: string;
  crashType: string;
  message: string;
}

/**
 * Renderer-side diagnostics API.
 *
 * `reportRendererError` is exposed through a dedicated `window.diagnostics`
 * bridge (see `src/preload.ts`) so the renderer entry point can report errors
 * without referencing the channel name directly. All other methods go through
 * the existing `window.api.invoke` surface with whitelisted channel constants.
 *
 * Note: `window.api` is intentionally not re-declared here — it is already
 * in scope via the preload contextBridge with `send` / `receive` / `invoke`
 * / `removeListener` / `removeAllListeners` / `sendBinary` / `getPathForFile`.
 * Re-declaring it would narrow the existing shape and break other modules.
 */
declare global {
  interface Window {
    diagnostics?: {
      reportRendererError: (payload: unknown) => Promise<unknown>;
    };
  }
}

/** Local view of the `window.api.invoke` surface (avoids widening Window). */
type WindowApiInvoke = (channel: string, data?: unknown) => Promise<unknown>;

function apiInvoke(): WindowApiInvoke {
  const api = (window as unknown as { api?: { invoke: WindowApiInvoke } }).api;
  if (!api || typeof api.invoke !== "function") {
    throw new Error("window.api.invoke is not available (preload not loaded?)");
  }
  return api.invoke;
}

type RendererErrorInput = {
  message: string;
  stack?: string;
  feature?: string;
  level?: "warn" | "error";
  fatal?: boolean;
};

export const diagnosticsApi = {
  /**
   * Report an uncaught renderer error or unhandled rejection to the main
   * process. Uses the dedicated `window.diagnostics` bridge rather than the
   * generic `window.api.invoke` whitelist.
   */
  async reportRendererError(payload: RendererErrorInput): Promise<void> {
    await window.diagnostics?.reportRendererError(payload);
  },

  /** Export a diagnostic report to disk. Returns the absolute path or null. */
  exportReport(): Promise<{ path: string | null; error?: string }> {
    return apiInvoke()(DIAGNOSTICS_EXPORT_REPORT, {}) as Promise<{
      path: string | null;
      error?: string;
    }>;
  },

  /** Upload a previously-recorded crash report to the remote diagnostics server. */
  uploadReport(
    crashId: string,
    includeNativeDump = false
  ): Promise<{ reportId: string | null; error?: string }> {
    return apiInvoke()(DIAGNOSTICS_UPLOAD_REPORT, {
      crashId,
      includeNativeDump,
    }) as Promise<{ reportId: string | null; error?: string }>;
  },

  /** Open the diagnostics output folder in the OS file explorer. */
  openFolder(): Promise<void> {
    return apiInvoke()(DIAGNOSTICS_OPEN_FOLDER, {}) as Promise<void>;
  },

  /** Fetch the current diagnostic storage / debug status snapshot. */
  getStatus(): Promise<DiagnosticStatus> {
    return apiInvoke()(DIAGNOSTICS_GET_STATUS, {}) as Promise<DiagnosticStatus>;
  },

  /** Enable or disable verbose debug capture for a bounded window. */
  setDebug(enabled: boolean): Promise<void> {
    return apiInvoke()(DIAGNOSTICS_SET_DEBUG, { enabled }) as Promise<void>;
  },

  /** Delete all locally-stored diagnostic artifacts. */
  clearLocal(): Promise<void> {
    return apiInvoke()(DIAGNOSTICS_CLEAR_LOCAL, {}) as Promise<void>;
  },

  /** List recent local crash records (newest first). */
  listCrashes(): Promise<DiagnosticCrashEntry[]> {
    return apiInvoke()(DIAGNOSTICS_LIST_CRASHES, {}) as Promise<
      DiagnosticCrashEntry[]
    >;
  },
};

export const reportRendererError = diagnosticsApi.reportRendererError;
