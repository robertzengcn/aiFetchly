/**
 * Google Maps Scraper IPC Handlers
 *
 * Handles IPC communication between renderer process and main process
 * for Google Maps business search functionality.
 *
 * Start: validates input, creates GoogleMapsModule, runs async search,
 *        pushes results via webContents.send
 * Cancel: cancels an active search by requestId
 */

import { ipcMain, BrowserWindow } from "electron";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import {
  GOOGLE_MAPS_SEARCH_START,
  GOOGLE_MAPS_SEARCH_CANCEL,
  GOOGLE_MAPS_SEARCH_RESULT,
  GOOGLE_MAPS_HISTORY_LIST,
  GOOGLE_MAPS_HISTORY_DETAIL,
  GOOGLE_MAPS_HISTORY_DELETE,
} from "@/config/channellist";
import type {
  GoogleMapsSearchInput,
  GoogleMapsSearchResult,
} from "@/entityTypes/googleMapsTypes";

/** Tracks active search sessions so they can be cancelled. */
const activeModules = new Map<string, GoogleMapsModule>();

/**
 * Register all Google Maps scraper IPC handlers.
 * Must be called once during app initialization.
 */
export function registerGoogleMapsHandlers(): void {
  // ── Start a search ──────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_SEARCH_START,
    async (_event, data: Record<string, unknown>) => {
      const query = typeof data.query === "string" ? data.query : "";
      const location = typeof data.location === "string" ? data.location : "";

      if (!query.trim() || !location.trim()) {
        return {
          status: false,
          msg: "query and location are required",
          data: null,
        };
      }

      const requestId = `gm-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const module = new GoogleMapsModule();
      activeModules.set(requestId, module);

      const input: GoogleMapsSearchInput = {
        query: query.trim(),
        location: location.trim(),
        max_results:
          typeof data.max_results === "number" ? data.max_results : 20,
        include_website:
          typeof data.include_website === "boolean"
            ? data.include_website
            : true,
        include_reviews:
          typeof data.include_reviews === "boolean"
            ? data.include_reviews
            : false,
        show_browser:
          typeof data.show_browser === "boolean" ? data.show_browser : false,
      };

      // Execute search asynchronously; push result via webContents.send
      module
        .executeSearch(input)
        .then((result: GoogleMapsSearchResult) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send(GOOGLE_MAPS_SEARCH_RESULT, {
              requestId,
              result,
            });
          }
          activeModules.delete(requestId);
        })
        .catch((error: unknown) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send(GOOGLE_MAPS_SEARCH_RESULT, {
              requestId,
              result: {
                success: false,
                query: input.query,
                location: input.location,
                totalResults: 0,
                summary: `Search failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                results: [],
              },
            });
          }
          activeModules.delete(requestId);
        });

      return { status: true, msg: "Search started", data: { requestId } };
    }
  );

  // ── Cancel a search ─────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_SEARCH_CANCEL,
    async (_event, data: Record<string, unknown>) => {
      const requestId =
        typeof data.requestId === "string" ? data.requestId : "";
      if (!requestId) {
        return {
          status: false,
          msg: "requestId is required",
          data: null,
        };
      }

      const activeModule = activeModules.get(requestId);
      if (activeModule) {
        await activeModule.cancelSearch(requestId);
        activeModules.delete(requestId);
      }

      return { status: true, msg: "Search cancelled", data: null };
    }
  );

  // ── History list ────────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_HISTORY_LIST,
    async (_event, data: Record<string, unknown>) => {
      const limit = typeof data.limit === "number" ? data.limit : 50;
      const offset = typeof data.offset === "number" ? data.offset : 0;
      const module = new GoogleMapsModule();
      const [records, total] = await module.getSearchHistory(limit, offset);
      return { status: true, msg: "OK", data: { records, total } };
    }
  );

  // ── History detail ──────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_HISTORY_DETAIL,
    async (_event, data: Record<string, unknown>) => {
      const id = typeof data.id === "number" ? data.id : 0;
      if (!id) {
        return { status: false, msg: "id is required", data: null };
      }
      const module = new GoogleMapsModule();
      const record = await module.getSearchRecord(id);
      if (!record) {
        return { status: false, msg: "Record not found", data: null };
      }
      return { status: true, msg: "OK", data: record };
    }
  );

  // ── History delete ──────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_HISTORY_DELETE,
    async (_event, data: Record<string, unknown>) => {
      const id = typeof data.id === "number" ? data.id : 0;
      if (!id) {
        return { status: false, msg: "id is required", data: null };
      }
      const module = new GoogleMapsModule();
      const deleted = await module.deleteSearchRecord(id);
      return {
        status: true,
        msg: deleted ? "Deleted" : "Not found",
        data: null,
      };
    }
  );
}
