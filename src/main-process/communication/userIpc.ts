import { ipcMain, shell, dialog, BrowserWindow } from "electron";
import {
  QUERY_USER_INFO,
  OPENLOGINPAGE,
  GET_LOGIN_URL,
  CANCEL_DESKTOP_LOGIN,
  USER_SIGNOUT,
  LOGIN_STATUS,
} from "@/config/channellist";
import { UserController } from "@/controller/UserController";
import { User } from "@/modules/user";
import { UserInfoType } from "@/entityTypes/userType";
import { CommonMessage } from "@/entityTypes/commonType";
import { log } from "@/modules/Logger";
import { clearPendingDesktopAuth } from "@/modules/pendingDesktopAuth";
import { Token } from "@/modules/token";
import {
  TOKENNAME,
  REFRESHTOKEN,
  TOKENEXPIRY,
  REFRESHTOKENEXPIRY,
} from "@/config/usersetting";
import { TokenRefreshService } from "@/modules/tokenRefresh";

/**
 * Holds the `cancel` callback for the currently-active desktop login
 * handoff, if any. The renderer can invoke CANCEL_DESKTOP_LOGIN to abort.
 */
let activeDesktopLoginCancel: (() => void) | null = null;

function setActiveDesktopLoginCancel(cancel: (() => void) | null): void {
  // If we're replacing an existing handoff, abort it first so the old
  // loopback server is closed and old pending state is cleared.
  if (activeDesktopLoginCancel) {
    try {
      activeDesktopLoginCancel();
    } catch (err) {
      log.warn("[desktop-login] error aborting previous handoff", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  activeDesktopLoginCancel = cancel;
}

/**
 * The main BrowserWindow, resolved lazily. Set by registerUserIpcHandlers
 * via the winProvider passed in from background.ts.
 */
let _winProvider: () => BrowserWindow | null = () => null;

function resolveMainWindow(): BrowserWindow | null {
  try {
    return _winProvider();
  } catch {
    return null;
  }
}

/**
 * Narrow guard for BrowserWindow liveness. Electron's type declarations
 * omit `isDestroyed()` from the BrowserWindow interface (a typings quirk),
 * but the method exists at runtime.
 */
function isWindowAlive(win: BrowserWindow | null): win is BrowserWindow {
  if (!win) return false;
  return (
    (win as unknown as { isDestroyed?: () => boolean }).isDestroyed?.() !== true
  );
}

function sendLoginStatus(
  win: BrowserWindow | null,
  status: "processing" | "error" | "success",
  message?: string
): void {
  if (isWindowAlive(win)) {
    win.webContents.send(LOGIN_STATUS, { status, message });
  }
}

function clearAllTokens(): void {
  try {
    TokenRefreshService.stopAutoRefresh();
    const tokenService = new Token();
    tokenService.setValue(TOKENNAME, "");
    tokenService.setValue(REFRESHTOKEN, "");
    tokenService.setValue(TOKENEXPIRY, "");
    tokenService.setValue(REFRESHTOKENEXPIRY, "");
  } catch (err) {
    log.error("[desktop-login] failed to clear tokens", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Attaches UI-facing side-effects to the loopback callback outcome.
 *
 * On success: sends LOGIN_STATUS:processing (the completion module
 * navigates to Dashboard separately).
 *
 * On failure: sends LOGIN_STATUS:error to the renderer, shows an error
 * dialog, and clears any partially-stored tokens.
 *
 * On abort/timeout (done promise rejects): logs and surfaces a generic
 * error. The user most likely closed the browser without completing
 * login; no need to clear tokens since none were stored.
 *
 * Safe to call fire-and-forget — swallows the rejection so it does not
 * become an unhandled rejection.
 */
function attachLoopbackCompletionHandlers(
  done: Promise<{ ok: true } | { ok: false; reason: string; message: string }>
): void {
  done
    .then((result) => {
      const win = resolveMainWindow();
      if (result.ok) {
        sendLoginStatus(win, "processing");
        log.info("[desktop-login] loopback callback completed successfully");
        return;
      }
      log.error("[desktop-login] loopback callback failed", {
        reason: result.reason,
        message: result.message,
      });
      sendLoginStatus(win, "error", result.message);
      dialog.showErrorBox("Login Failed", result.message);
      clearAllTokens();
      clearPendingDesktopAuth();
    })
    .catch((err: unknown) => {
      // Promise rejected — abort(), timeout, or an unexpected throw.
      // Extract the kind if available (loopback CallbackError shapes).
      const kind =
        err && typeof err === "object" && "kind" in err
          ? String((err as { kind: unknown }).kind)
          : "unknown";
      if (kind === "aborted") {
        log.info("[desktop-login] handoff aborted by user");
        return;
      }
      if (kind === "timeout") {
        const win = resolveMainWindow();
        const message = "Login timed out. Please try again.";
        sendLoginStatus(win, "error", message);
        dialog.showErrorBox("Login Timed Out", message);
        return;
      }
      // For any other rejection (state mismatch, listen error, unexpected
      // throw), use the kind as the message for non-Error values to avoid
      // "[object Object]".
      const message = err instanceof Error ? err.message : kind;
      log.error("[desktop-login] unexpected error during callback processing", {
        error: message,
      });
      const win = resolveMainWindow();
      sendLoginStatus(win, "error", `Login failed: ${message}`);
    });
}

export function registerUserIpcHandlers(
  winProvider: () => BrowserWindow | null = () => null
) {
  _winProvider = winProvider;
  // UserController.prepareDesktopLogin uses this to resolve the target
  // window for the post-login navigation cascade. Set it once here so the
  // controller does not import the IPC layer (avoids circular deps).
  UserController.setMainWindowProvider(winProvider);

  ipcMain.handle(QUERY_USER_INFO, async (event, data) => {
    const userControll = new UserController();
    const res = userControll.getUserInfo();
    const result: CommonMessage<UserInfoType> = {
      status: true,
      msg: "",
      data: res,
    };
    return result;
  });

  /**
   * Starts a secure desktop login handoff: generates PKCE, starts the
   * loopback callback server, stores pending auth state, composes the
   * login URL, AND opens it in the user's default browser. Returns the
   * URL for display/copy.
   *
   * In parallel, attaches UI-facing side-effects to the loopback callback
   * processing: on failure, sends LOGIN_STATUS:error to the renderer,
   * shows a dialog, and clears tokens. On success, the completion module
   * already navigates to Dashboard.
   *
   * The renderer's subsequent OPENLOGINPAGE call is a no-op (the browser
   * is already opened here); calling prepareDesktopLogin() twice would
   * invalidate the first handoff.
   */
  ipcMain.handle(GET_LOGIN_URL, async (event, data) => {
    try {
      // Abort any previous handoff BEFORE creating the new one. The old
      // cancel() closes the old loopback server and clears old pending
      // state. If we did this AFTER prepareDesktopLogin(), the old cancel
      // would wipe the fresh pending auth (global singleton) and the new
      // callback would arrive to find "no pending auth".
      setActiveDesktopLoginCancel(null);

      const userControll = new UserController();
      const prepared = await userControll.prepareDesktopLogin();
      setActiveDesktopLoginCancel(prepared.cancel);

      // Attach UI side-effects to the loopback callback outcome. This is
      // fire-and-forget — we do NOT await it here so the handler can
      // return the URL immediately for the renderer to display.
      attachLoopbackCompletionHandlers(prepared.done);

      // Open the browser here so OPENLOGINPAGE doesn't need to restart
      // the handoff.
      try {
        await shell.openExternal(prepared.loginUrl);
      } catch (openErr) {
        // Abort the pending handoff if the browser could not be opened.
        prepared.cancel();
        setActiveDesktopLoginCancel(null);
        const message =
          openErr instanceof Error ? openErr.message : String(openErr);
        log.error("[GET_LOGIN_URL] shell.openExternal failed", {
          error: message,
        });
        return {
          status: false,
          msg: `Failed to open browser: ${message}`,
          data: prepared.loginUrl,
        } as CommonMessage<string>;
      }

      return {
        status: true,
        msg: "Login URL retrieved successfully",
        data: prepared.loginUrl,
      } as CommonMessage<string>;
    } catch (error) {
      log.error("[GET_LOGIN_URL] Error preparing desktop login", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      setActiveDesktopLoginCancel(null);
      return {
        status: false,
        msg:
          error instanceof Error
            ? error.message
            : "Failed to prepare desktop login",
        data: "",
      } as CommonMessage<string>;
    }
  });

  /**
   * Renderer→Main no-op retained for backward compatibility. The browser
   * is already opened by GET_LOGIN_URL; ipcMain.on discards any return
   * value, so we simply do nothing here. Calling prepareDesktopLogin()
   * again would invalidate the active handoff.
   */
  ipcMain.on(OPENLOGINPAGE, (_event, _data) => {
    /* no-op — browser already opened by GET_LOGIN_URL */
  });

  /**
   * Aborts the currently-active desktop login handoff (closes the loopback
   * server, clears pending state). Safe to call when no handoff is active.
   */
  ipcMain.handle(CANCEL_DESKTOP_LOGIN, async (event, data) => {
    if (activeDesktopLoginCancel) {
      try {
        activeDesktopLoginCancel();
      } catch (err) {
        log.warn("[CANCEL_DESKTOP_LOGIN] error during cancel", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      activeDesktopLoginCancel = null;
    } else {
      // Defensive: also clear any pending state directly in case the cancel
      // callback was lost (e.g. after a renderer reload).
      clearPendingDesktopAuth();
    }
    return { status: true, msg: "Desktop login cancelled", data: null };
  });

  ipcMain.handle(USER_SIGNOUT, async (event, data) => {
    const userModel = new User();

    const res = await userModel
      .Signout()
      .then(function () {
        return {
          status: true,
          msg: "login out success",
        };
      })
      .catch(function (err) {
        log.error("[USER_SIGNOUT] signout failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof Error) {
          return {
            status: false,
            msg: err.message,
          };
        } else {
          return {
            status: false,
            msg: "unknow error",
          };
        }
      });
    return res;
  });
}
