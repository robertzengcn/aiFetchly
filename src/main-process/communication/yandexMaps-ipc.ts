/**
 * Yandex Maps Scraper IPC Handlers
 *
 * Handles IPC communication between renderer process and main process
 * for Yandex Maps business search functionality.
 *
 * Start: validates input, creates YandexMapsModule, runs async search,
 *        pushes progress and results via webContents.send
 * Cancel: cancels an active search by requestId
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  YandexMapsModule,
  type YandexMapsExecuteOptions,
} from "@/modules/YandexMapsModule";
import {
  YANDEX_MAPS_SEARCH_START,
  YANDEX_MAPS_SEARCH_CANCEL,
  YANDEX_MAPS_SEARCH_PROGRESS,
  YANDEX_MAPS_SEARCH_RESULT,
} from "@/config/channellist";
import type {
  YandexMapsSearchInput,
  YandexMapsSearchResult,
} from "@/entityTypes/yandexMapsTypes";
import { YANDEX_MAPS_HARD_CAP } from "@/entityTypes/yandexMapsTypes";

/** Tracks active search sessions so they can be cancelled. */
const activeModules = new Map<string, YandexMapsModule>();

/** Maximum concurrent Yandex Maps searches. */
const MAX_CONCURRENT_SEARCHES = 3;

/**
 * Register all Yandex Maps scraper IPC handlers.
 * Must be called once during app initialization.
 */
export function registerYandexMapsHandlers(): void {
  // ── Start a search ──────────────────────────────────────────────────
  ipcMain.handle(
    YANDEX_MAPS_SEARCH_START,
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
      const module = new YandexMapsModule();
      activeModules.set(requestId, module);

      const maxResultsRaw =
        typeof data.max_results === "number" ? data.max_results : 20;
      const maxResults = Math.min(
        Math.max(1, maxResultsRaw),
        YANDEX_MAPS_HARD_CAP
      );

      const input: YandexMapsSearchInput = {
        query: query.trim().slice(0, 255),
        location: location.trim().slice(0, 255),
        max_results: maxResults,
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
        language: typeof data.language === "string" ? data.language : undefined,
        region: typeof data.region === "string" ? data.region : undefined,
      };

      const senderWebContents = event.sender;

      const executeOptions: YandexMapsExecuteOptions = {
        externalRequestId: requestId,
        onProgress: (progress) => {
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send(YANDEX_MAPS_SEARCH_PROGRESS, {
              requestId,
              progress,
            });
          }
        },
      };

      // Execute search asynchronously; push result via webContents.send
      module
        .executeSearch(input, executeOptions)
        .then((result: YandexMapsSearchResult) => {
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send(YANDEX_MAPS_SEARCH_RESULT, {
              requestId,
              result,
            });
          }
          activeModules.delete(requestId);
        })
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error("[YandexMaps] Search failed:", errorMessage);
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send(YANDEX_MAPS_SEARCH_RESULT, {
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
    YANDEX_MAPS_SEARCH_CANCEL,
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
}
