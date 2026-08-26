/**
 * Desktop login completion — post-token-storage orchestration.
 *
 * After the new secure handoff mints an authorization code and the desktop
 * exchanges it for tokens via /api/desktop-auth/exchange, the resulting
 * tokens need to be persisted and a cascade of side-effects triggered
 * (device registration, DB path reset, WebSocket init, auto-refresh,
 * navigate to Dashboard).
 *
 * This module isolates that cascade so it can be invoked from:
 *   - The loopback-callback path (primary flow)
 *   - The custom-scheme fallback path
 *   - The existing deep-link handler during the transition window
 *
 * Accepts a minimal Window-like interface rather than importing Electron
 * directly, so the module remains unit-testable.
 */

import { BrowserWindow } from "electron";
import { Token } from "@/modules/token";
import {
  USERSDBPATH,
  TOKENNAME,
  REFRESHTOKEN,
  TOKENEXPIRY,
  REFRESHTOKENEXPIRY,
} from "@/config/usersetting";
import { UserController } from "@/controller/UserController";
import { SubscriptionEntitlementService } from "@/service/SubscriptionEntitlementService";
import { DeviceFingerprintService } from "@/modules/deviceFingerprint";
import { DeviceApi } from "@/api/deviceApi";
import { SqliteDb } from "@/config/SqliteDb";
import { getMainWindow } from "@/main-process/mainWindowRegistry";
import { ScheduleManager } from "@/modules/ScheduleManager";
import { SearchController } from "@/controller/SearchController";
import { YellowPagesController } from "@/controller/YellowPagesController";
import { YellowPagesProcessManager } from "@/modules/YellowPagesProcessManager";
import { initializeWebSocketConnection } from "@/main-process/communication/websocket-ipc";
import { resetAiChatV2RuntimeForDatabaseSwitch } from "@/main-process/communication/ai-chat-v2-ipc";
import { TokenRefreshService } from "@/modules/tokenRefresh";
import { WebSocketClient } from "@/modules/WebSocketClient";
import { VectorDatabasePool } from "@/modules/factories/VectorDatabasePool";
import { NATIVATECOMMAND } from "@/config/channellist";
import { NativateDatatype } from "@/entityTypes/commonType";
import { log } from "@/modules/Logger";
import { dialog } from "electron";
import { refreshChatSchedulerForUserPath } from "@/main-process/chatSchedulerLifecycleRegistry";

/** Token data required to complete login. Mirrors ExchangeSuccessResponse. */
export type LoginTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn?: number;
};

/**
 * Narrow guard for BrowserWindow liveness. Electron's type declarations
 * omit `isDestroyed()` from the BrowserWindow/BaseWindow interface (a
 * known typings quirk), but the method exists at runtime. We confine the
 * cast here so the rest of the module uses the clean type.
 */
function isWindowAlive(win: BrowserWindow | null): win is BrowserWindow {
  if (!win) return false;
  return (
    (win as unknown as { isDestroyed?: () => boolean }).isDestroyed?.() !== true
  );
}

/**
 * Resolve a usable window for post-login IPC. The caller may pass a stale
 * reference (window was recreated mid-login — e.g. crash recovery), so if
 * it is dead fall back to the main-window registry, which tracks the live
 * window. Returns null only when no live window exists at all.
 */
function resolveTargetWindow(win: BrowserWindow | null): BrowserWindow | null {
  if (isWindowAlive(win)) return win;
  const liveFromRegistry = getMainWindow();
  return isWindowAlive(liveFromRegistry) ? liveFromRegistry : null;
}

/** Typed result so callers can branch without touching error internals. */
export type CompleteDesktopLoginResult =
  | { ok: true }
  | {
      ok: false;
      reason: "storage" | "user_info" | "internal";
      message: string;
    };

/**
 * Persists tokens, fetches user info, registers device, resets DB singletons,
 * initializes WebSocket, starts auto-refresh, and navigates to Dashboard.
 *
 * Non-fatal errors (device registration, DB init, WebSocket) are logged but
 * do not fail the overall result — login is considered successful once the
 * tokens are stored and user info is fetched.
 *
 * @param win  - BrowserWindow to receive navigation events; may be null
 *               if the window has been destroyed.
 * @param data - Token payload from the exchange endpoint.
 */
export async function completeDesktopLogin(
  win: BrowserWindow | null,
  data: LoginTokens
): Promise<CompleteDesktopLoginResult> {
  const { accessToken, refreshToken, expiresIn, refreshExpiresIn } = data;

  // --- 1. Persist tokens -----------------------------------------------
  const tokenService = new Token();
  try {
    tokenService.setValue(TOKENNAME, accessToken);
    log.info("Access token saved successfully");

    if (typeof expiresIn === "number" && !Number.isNaN(expiresIn)) {
      const expiryTime = Date.now() + expiresIn * 1000;
      tokenService.setValue(TOKENEXPIRY, expiryTime.toString());
      log.info("Token expiry time saved:", new Date(expiryTime).toISOString());
    }

    if (refreshToken) {
      tokenService.setValue(REFRESHTOKEN, refreshToken);
      log.info("Refresh token saved successfully");

      // Default to 30 days if not provided by server.
      const effectiveRefreshExpiresIn =
        typeof refreshExpiresIn === "number" && !Number.isNaN(refreshExpiresIn)
          ? refreshExpiresIn
          : 2592000;
      const refreshExpiryTime = Date.now() + effectiveRefreshExpiresIn * 1000;
      tokenService.setValue(REFRESHTOKENEXPIRY, refreshExpiryTime.toString());
      log.info(
        "Refresh token expiry time saved:",
        new Date(refreshExpiryTime).toISOString()
      );
    } else {
      log.warn("No refresh token provided by exchange endpoint");
    }
  } catch (storageError) {
    const errorMessage =
      storageError instanceof Error
        ? storageError.message
        : String(storageError);
    log.error("Failed to store tokens:", storageError);
    dialog.showErrorBox(
      "Authentication Error",
      `Failed to store authentication tokens: ${errorMessage}`
    );
    return { ok: false, reason: "storage", message: errorMessage };
  }

  // --- 2. Fetch user info ----------------------------------------------
  // FR-2.2: route through the entitlement service so the first layout paint
  // can receive USER_INFO_UPDATED if it is already mounted. The service calls
  // UserController.updateUserInfo() internally, compares the snapshot, and
  // broadcasts on change. On GET failure it keeps the cache and returns
  // ok:false (we surface that as a login error here).
  const userController = new UserController();
  let reconcileOk = false;
  try {
    const result = await SubscriptionEntitlementService.getInstance().reconcile(
      "login"
    );
    reconcileOk = result.ok;
  } catch (userError) {
    const errorMessage =
      userError instanceof Error ? userError.message : String(userError);
    log.error("Error updating user info:", userError);
    dialog.showErrorBox(
      "User Info Update Error",
      `Failed to update user information: ${errorMessage}`
    );
    return { ok: false, reason: "user_info", message: errorMessage };
  }

  if (!reconcileOk) {
    log.error("Failed to get user info from remote source");
    dialog.showErrorBox(
      "User Info Error",
      "Failed to get user info from remote source."
    );
    return {
      ok: false,
      reason: "user_info",
      message: "remote source returned no user info",
    };
  }
  // Local read of the just-written cache (both paths required: layout that is
  // already mounted gets USER_INFO_UPDATED; layout that mounts next reads this).
  userController.getUserInfo();

  // --- 3. Register device (non-blocking) -------------------------------
  try {
    const deviceFingerprintService = new DeviceFingerprintService();
    const deviceApi = new DeviceApi();

    const deviceIdHash = deviceFingerprintService.getDeviceIdHash();
    const deviceName = deviceFingerprintService.getDeviceName();

    deviceFingerprintService.storeDeviceIdHash(deviceIdHash);

    if (refreshToken) {
      await deviceApi.registerDevice(deviceName, deviceIdHash, refreshToken);
      log.info("Device registered successfully:", deviceIdHash);
    } else {
      await deviceApi.registerDevice(deviceName, deviceIdHash);
      log.info(
        "Device registered successfully (without refresh token):",
        deviceIdHash
      );
    }
  } catch (deviceError) {
    // Log but don't block login flow.
    log.error("Device registration failed (non-blocking):", deviceError);
  }

  // --- 4. Reset DB singletons to user path (non-blocking) -------------
  try {
    const freshTokens = new Token();
    const newDbPath = freshTokens.getValue(USERSDBPATH);
    if (newDbPath && newDbPath.length > 0) {
      // Reset ScheduleManager first so it stops cleanly before the DB
      // connection is destroyed.
      await ScheduleManager.resetInstance();
      log.info("ScheduleManager reset to new path after login");

      const newDbInstance = await SqliteDb.resetInstance(newDbPath);
      log.info("SqliteDb reset to new path after login:", newDbPath);

      SearchController.resetInstance();
      YellowPagesController.resetInstance();
      YellowPagesProcessManager.resetInstance();
      resetAiChatV2RuntimeForDatabaseSwitch();
      WebSocketClient.resetInstance();
      await VectorDatabasePool.clearAllInstances();
      log.info("Controller singletons reset after SqliteDb path change");

      // Refresh the Chat V2 interval scheduler against the new user path. Its
      // cached ScheduleTaskModel/AiMessageTaskRunModel repositories point at
      // the connection just destroyed; the registry hook drops and rebuilds
      // them and restarts the scheduler if it was running. Without this, the
      // 30s interval poll keeps querying the closed connection and throws
      // "The database connection is not open" after login. Invoked through the
      // lifecycle registry so this module never imports Electron-only
      // `background.ts` (which would break the pure-Node vitest suites).
      try {
        await refreshChatSchedulerForUserPath();
        log.info("Chat scheduled background scheduler refreshed after login");
      } catch (schedError) {
        log.error(
          "Failed to refresh chat scheduled background scheduler after login:",
          schedError
        );
      }

      if (!newDbInstance.connection.isInitialized) {
        let retries = 3;
        let lastError: unknown = null;
        while (retries > 0) {
          try {
            await SqliteDb.ensureInitialized();
            log.info("New SqliteDb connection initialized");
            break;
          } catch (initError) {
            lastError = initError;
            retries--;
            if (retries > 0) {
              const errorMessage =
                initError instanceof Error
                  ? initError.message
                  : String(initError);
              if (
                errorMessage.includes("locked") ||
                errorMessage.includes("database is locked")
              ) {
                log.warn(
                  `Database locked during initialization, retrying... (${retries} retries left)`
                );
                await new Promise((resolve) => setTimeout(resolve, 200));
              } else {
                // Not a lock error; surface and stop retrying.
                throw initError;
              }
            }
          }
        }
        if (retries === 0 && lastError) {
          log.error(
            "Failed to initialize new SqliteDb connection after retries:",
            lastError
          );
          // Don't throw — connection will initialize on first use.
        }
      }
    }
  } catch (dbResetError) {
    log.error(
      "Failed to reset database singletons after login (non-blocking):",
      dbResetError
    );
  }

  // --- 5. Initialize WebSocket (non-blocking) -------------------------
  const targetWin = resolveTargetWindow(win);
  if (targetWin) {
    try {
      await initializeWebSocketConnection(targetWin);
      log.info("WebSocket connection initialized after login");
    } catch (wsError) {
      log.error(
        "Failed to initialize WebSocket after login (non-blocking):",
        wsError
      );
    }
  }

  // --- 6. Start token auto-refresh ------------------------------------
  if (!TokenRefreshService.isAutoRefreshRunning()) {
    TokenRefreshService.startAutoRefresh();
  }

  // --- 7. Navigate to Dashboard --------------------------------------
  // Resolve lazily (not the step-5 capture) in case the window changed
  // while the WebSocket init above was awaited.
  const navWin = resolveTargetWindow(win);
  if (navWin) {
    navWin.webContents.send(NATIVATECOMMAND, {
      path: "Dashboard",
    } as NativateDatatype);
  } else {
    log.error(
      "No live window available, cannot send navigation command after login"
    );
  }

  return { ok: true };
}
