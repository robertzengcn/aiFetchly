import { ipcMain, shell } from "electron";
import {
  QUERY_USER_INFO,
  OPENLOGINPAGE,
  GET_LOGIN_URL,
  CANCEL_DESKTOP_LOGIN,
  USER_SIGNOUT,
} from "@/config/channellist";
import { UserController } from "@/controller/UserController";
import { User } from "@/modules/user";
import { UserInfoType } from "@/entityTypes/userType";
import { CommonMessage } from "@/entityTypes/commonType";
import { log } from "@/modules/Logger";
import { clearPendingDesktopAuth } from "@/modules/pendingDesktopAuth";

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

export function registerUserIpcHandlers() {
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
   * The renderer's subsequent OPENLOGINPAGE call is a no-op (the browser
   * is already opened here); calling prepareDesktopLogin() twice would
   * invalidate the first handoff.
   */
  ipcMain.handle(GET_LOGIN_URL, async (event, data) => {
    try {
      const userControll = new UserController();
      const prepared = await userControll.prepareDesktopLogin();
      setActiveDesktopLoginCancel(prepared.cancel);

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
   * is already opened by GET_LOGIN_URL. Calling prepareDesktopLogin() here
   * would invalidate the prior handoff, so we simply return success.
   */
  ipcMain.on(OPENLOGINPAGE, async (event, data) => {
    return {
      status: true,
      msg: "Login page already opened via GET_LOGIN_URL",
      data: null,
    } as CommonMessage<null>;
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
        console.log(err);
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
