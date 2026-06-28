/**
 * Yandex Maps Scraper IPC Handlers
 *
 * All 5 handlers go through registerValidatedHandler, sharing schemas with
 * googleMaps-ipc via src/schemas/ipc/_shared/maps.ts.
 */

import { type IpcMainInvokeEvent } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  YandexMapsModule,
  type YandexMapsExecuteOptions,
} from "@/modules/YandexMapsModule";
import { AccountCookiesModule } from "@/modules/accountCookiesModule";
import { ProxyModel } from "@/model/Proxy.model";
import type { YellowPagesTaskProxyConfig } from "@/entityTypes/yellowPagesTaskProxyType";
import {
  YANDEX_MAPS_SEARCH_START,
  YANDEX_MAPS_SEARCH_CANCEL,
  YANDEX_MAPS_SEARCH_PROGRESS,
  YANDEX_MAPS_SEARCH_RESULT,
  YANDEX_MAPS_HISTORY_LIST,
  YANDEX_MAPS_HISTORY_DETAIL,
  YANDEX_MAPS_HISTORY_DELETE,
} from "@/config/channellist";
import type { YandexMapsSearchResult } from "@/entityTypes/yandexMapsTypes";
import { YANDEX_MAPS_HARD_CAP } from "@/entityTypes/yandexMapsTypes";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  mapsSearchStartInputSchema,
  mapsSearchCancelInputSchema,
  mapsHistoryListInputSchema,
  mapsHistoryByIdInputSchema,
} from "@/schemas/ipc/_shared/maps";

/** Tracks active search sessions so they can be cancelled. */
const activeModules = new Map<string, YandexMapsModule>();

/** Maximum concurrent Yandex Maps searches. */
const MAX_CONCURRENT_SEARCHES = 3;

export function registerYandexMapsHandlers(): void {
  // ── Start a search ──────────────────────────────────────────────────
  registerValidatedHandler(
    YANDEX_MAPS_SEARCH_START,
    mapsSearchStartInputSchema,
    async (input, event) => {
      if (activeModules.size >= MAX_CONCURRENT_SEARCHES) {
        throw new Error(
          "Too many concurrent searches. Please wait for one to finish.",
        );
      }

      const requestId = uuidv4();
      const module = new YandexMapsModule();
      activeModules.set(requestId, module);

      // Cap max_results to YANDEX_MAPS_HARD_CAP
      const maxResults = Math.min(
        Math.max(1, input.max_results ?? 20),
        YANDEX_MAPS_HARD_CAP,
      );

      // Resolve cookies if account_id is provided
      let cookies: unknown[] | undefined;
      if (input.account_id) {
        try {
          const cookiesModule = new AccountCookiesModule();
          const cookieRecord = await cookiesModule.getAccountCookies(input.account_id);
          if (cookieRecord?.cookies) {
            const parsed = JSON.parse(cookieRecord.cookies);
            cookies = Array.isArray(parsed) ? parsed : undefined;
          }
        } catch (err) {
          console.warn(
            "[YandexMaps] Failed to load cookies for account",
            input.account_id,
            err,
          );
        }
      }

      // Resolve proxy configs if proxy_ids are provided
      let proxies: YellowPagesTaskProxyConfig[] | undefined;
      if (input.proxy_ids && input.proxy_ids.length > 0) {
        try {
          const proxyModel = new ProxyModel(module["dbpath"]);
          const resolved: YellowPagesTaskProxyConfig[] = [];
          for (const pid of input.proxy_ids) {
            const entity = await proxyModel.getProxyById(pid);
            if (entity) {
              resolved.push({
                host: entity.host,
                port: parseInt(entity.port, 10),
                protocol: entity.protocol ?? "http",
                username: entity.user || undefined,
                password: entity.pass || undefined,
              });
            }
          }
          if (resolved.length > 0) {
            proxies = resolved;
          }
        } catch (err) {
          console.warn("[YandexMaps] Failed to load proxies:", err);
        }
      }

      const senderWebContents = (event as IpcMainInvokeEvent).sender;
      const trimmedQuery = input.query.trim().slice(0, 255);
      const trimmedLocation = input.location.trim().slice(0, 255);

      const executeOptions: YandexMapsExecuteOptions = {
        externalRequestId: requestId,
        cookies,
        proxies,
        onProgress: (progress) => {
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send(YANDEX_MAPS_SEARCH_PROGRESS, {
              requestId,
              progress,
            });
          }
        },
      };

      module
        .executeSearch(
          {
            query: trimmedQuery,
            location: trimmedLocation,
            max_results: maxResults,
            include_website: input.include_website ?? true,
            include_reviews: input.include_reviews ?? false,
            show_browser: input.show_browser ?? false,
            language: input.language,
            region: input.region,
          },
          executeOptions,
        )
        .then((result: YandexMapsSearchResult) => {
          if (!senderWebContents.isDestroyed()) {
            senderWebContents.send(YANDEX_MAPS_SEARCH_RESULT, { requestId, result });
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
                query: trimmedQuery,
                location: trimmedLocation,
                totalResults: 0,
                summary: `Search failed: ${errorMessage}`,
                results: [],
              },
            });
          }
          activeModules.delete(requestId);
        });

      return { requestId };
    },
  );

  // ── Cancel a search ─────────────────────────────────────────────────
  registerValidatedHandler(
    YANDEX_MAPS_SEARCH_CANCEL,
    mapsSearchCancelInputSchema,
    async (input) => {
      const activeModule = activeModules.get(input.requestId);
      if (!activeModule) {
        throw new Error("No active search found for this requestId");
      }
      await activeModule.cancelSearch(input.requestId);
      activeModules.delete(input.requestId);
      return null;
    },
  );

  // ── History list ────────────────────────────────────────────────────
  registerValidatedHandler(
    YANDEX_MAPS_HISTORY_LIST,
    mapsHistoryListInputSchema,
    async (input) => {
      const limit = Math.min(Math.max(1, input.limit ?? 50), 100);
      const offset = Math.max(0, input.offset ?? 0);
      const module = new YandexMapsModule();
      const [records, total] = await module.getSearchHistory(limit, offset);
      return { records, total };
    },
  );

  // ── History detail ──────────────────────────────────────────────────
  registerValidatedHandler(
    YANDEX_MAPS_HISTORY_DETAIL,
    mapsHistoryByIdInputSchema,
    async (input) => {
      const module = new YandexMapsModule();
      const record = await module.getSearchRecord(input.id);
      if (!record) {
        throw new Error("Record not found");
      }
      return record;
    },
  );

  // ── History delete ──────────────────────────────────────────────────
  registerValidatedHandler(
    YANDEX_MAPS_HISTORY_DELETE,
    mapsHistoryByIdInputSchema,
    async (input) => {
      const module = new YandexMapsModule();
      const deleted = await module.deleteSearchRecord(input.id);
      if (!deleted) {
        throw new Error("Record not found");
      }
      return null;
    },
  );
}
