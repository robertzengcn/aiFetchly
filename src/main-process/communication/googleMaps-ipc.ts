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

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { v4 as uuidv4 } from "uuid";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
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

/** Maximum concurrent Google Maps searches. */
const MAX_CONCURRENT_SEARCHES = 3;

/**
 * Register all Google Maps scraper IPC handlers.
 * Must be called once during app initialization.
 */
export function registerGoogleMapsHandlers(): void {
  // ── Start a search ──────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_SEARCH_START,
    async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const raw = args[0];
      const data = (
        typeof raw === "string" ? JSON.parse(raw) : raw ?? {}
      ) as Record<string, unknown>;
      const query = typeof data.query === "string" ? data.query : "";
      const location = typeof data.location === "string" ? data.location : "";

      if (!query.trim() || !location.trim()) {
        return {
          status: false,
          msg: "query and location are required",
          data: null,
        };
      }

      // Enforce concurrent search limit
      if (activeModules.size >= MAX_CONCURRENT_SEARCHES) {
        return {
          status: false,
          msg: "Too many concurrent searches. Please wait for one to finish.",
          data: null,
        };
      }

      const requestId = uuidv4();
      const module = new GoogleMapsModule();
      activeModules.set(requestId, module);

      const input: GoogleMapsSearchInput = {
        query: query.trim().slice(0, 255),
        location: location.trim().slice(0, 255),
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

      // Resolve cookies if account_id is provided
      let cookies: unknown[] | undefined;
      const accountId =
        typeof data.account_id === "number" ? data.account_id : undefined;
      if (accountId) {
        try {
          const cookiesModule = new AccountCookiesModule();
          const cookieRecord = await cookiesModule.getAccountCookies(accountId);
          if (cookieRecord?.cookies) {
            const parsed = JSON.parse(cookieRecord.cookies);
            cookies = Array.isArray(parsed) ? parsed : undefined;
          }
        } catch (err) {
          console.warn(
            "[GoogleMaps] Failed to load cookies for account",
            accountId,
            err
          );
        }
      }

      const senderWebContents = event.sender;

      // Execute search asynchronously; push result via webContents.send
      module
        .executeSearch(input, cookies)
        .then((result: GoogleMapsSearchResult) => {
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send(GOOGLE_MAPS_SEARCH_RESULT, {
              requestId,
              result,
            });
          }
          activeModules.delete(requestId);
        })
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error("[GoogleMaps] Search failed:", errorMessage);
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send(GOOGLE_MAPS_SEARCH_RESULT, {
              requestId,
              result: {
                success: false,
                query: input.query,
                location: input.location,
                totalResults: 0,
                summary: `Search failed: ${errorMessage}`,
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
    async (_event, ...args: unknown[]) => {
      const raw = args[0];
      const data = (
        typeof raw === "string" ? JSON.parse(raw) : raw ?? {}
      ) as Record<string, unknown>;
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
        return { status: true, msg: "Search cancelled", data: null };
      }

      return {
        status: false,
        msg: "No active search found for this requestId",
        data: null,
      };
    }
  );

  // ── History list ────────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_HISTORY_LIST,
    async (_event, ...args: unknown[]) => {
      try {
        const raw = args[0];
        const data = (
          typeof raw === "string" ? JSON.parse(raw) : raw ?? {}
        ) as Record<string, unknown>;
        const rawLimit = typeof data.limit === "number" ? data.limit : 50;
        const rawOffset = typeof data.offset === "number" ? data.offset : 0;
        const limit = Math.min(Math.max(1, rawLimit), 100);
        const offset = Math.max(0, rawOffset);
        const module = new GoogleMapsModule();
        const [records, total] = await module.getSearchHistory(limit, offset);
        return { status: true, msg: "OK", data: { records, total } };
      } catch (err) {
        console.error("[GoogleMaps] History list error:", err);
        return {
          status: false,
          msg: `Failed to load history: ${
            err instanceof Error ? err.message : String(err)
          }`,
          data: null,
        };
      }
    }
  );

  // ── History detail ──────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_HISTORY_DETAIL,
    async (_event, ...args: unknown[]) => {
      try {
        const raw = args[0];
        const data = (
          typeof raw === "string" ? JSON.parse(raw) : raw ?? {}
        ) as Record<string, unknown>;
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
      } catch (err) {
        console.error("[GoogleMaps] History detail error:", err);
        return {
          status: false,
          msg: `Failed to load record: ${
            err instanceof Error ? err.message : String(err)
          }`,
          data: null,
        };
      }
    }
  );

  // ── History delete ──────────────────────────────────────────────────
  ipcMain.handle(
    GOOGLE_MAPS_HISTORY_DELETE,
    async (_event, ...args: unknown[]) => {
      try {
        const raw = args[0];
        const data = (
          typeof raw === "string" ? JSON.parse(raw) : raw ?? {}
        ) as Record<string, unknown>;
        const id = typeof data.id === "number" ? data.id : 0;
        if (!id) {
          return { status: false, msg: "id is required", data: null };
        }
        const module = new GoogleMapsModule();
        const deleted = await module.deleteSearchRecord(id);
        if (!deleted) {
          return { status: false, msg: "Record not found", data: null };
        }
        return { status: true, msg: "Deleted", data: null };
      } catch (err) {
        console.error("[GoogleMaps] History delete error:", err);
        return {
          status: false,
          msg: `Failed to delete record: ${
            err instanceof Error ? err.message : String(err)
          }`,
          data: null,
        };
      }
    }
  );
}
