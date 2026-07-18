"use strict";
/**
 * Dev Browser Bridge request dispatcher (PRD FR-4, technical design §9 Option B).
 *
 * Implements explicit, reviewed handlers for each allowed invoke channel. Each
 * handler calls the SAME module/controller the corresponding `ipcMain.handle`
 * registration uses — never a raw repository / direct database access (FR-6.5,
 * NFR-3). The dispatcher is intentionally tiny: route to a handler, normalize
 * the result into the shared `{ status, msg, data }` contract, and convert any
 * thrown error into a safe failure response (FR-4.3) without rethrowing.
 *
 * Design note: handlers are injected via a `ReadonlyMap` so the routing logic
 * (unsupported channel, error isolation, normalization) is unit-testable in
 * isolation from the Electron-dependent modules the default handlers call.
 */
import type { CommonMessage } from "@/entityTypes/commonType";
import type { UserInfoType } from "@/entityTypes/userType";
import { GET_APP_INFO, GET_LOGIN_URL, QUERY_USER_INFO } from "@/config/channellist";
import { REFRESHTOKEN, TOKENNAME } from "@/config/usersetting";
import { MainProcessAppInfoModule } from "@/modules/MainProcessAppInfoModule";
import { UserController } from "@/controller/UserController";
import { log } from "@/modules/Logger";
import { Token } from "@/modules/token";
import { TokenRefreshService } from "@/modules/tokenRefresh";

/** A single channel handler. Returns a CommonMessage or a bare payload. */
export type DevBrowserHandler = (
  data: unknown
) => Promise<CommonMessage<unknown> | unknown> | CommonMessage<unknown> | unknown;

let activeDevBrowserLoginCancel: (() => void) | null = null;

function replaceActiveDevBrowserLogin(cancel: (() => void) | null): void {
  if (activeDevBrowserLoginCancel) {
    try {
      activeDevBrowserLoginCancel();
    } catch (error) {
      log.warn("[dev-browser-login] error aborting previous handoff", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  activeDevBrowserLoginCancel = cancel;
}

function attachDevBrowserLoginCompletion(
  cancel: () => void,
  done: Promise<{ ok: true } | { ok: false; reason: string; message: string }>
): void {
  done
    .then((result) => {
      if (activeDevBrowserLoginCancel === cancel) {
        activeDevBrowserLoginCancel = null;
      }
      if (!result.ok) {
        log.error("[dev-browser-login] callback processing failed", {
          reason: result.reason,
          message: result.message,
        });
      }
    })
    .catch((error: unknown) => {
      if (activeDevBrowserLoginCancel === cancel) {
        activeDevBrowserLoginCancel = null;
      }
      log.error("[dev-browser-login] callback processing rejected", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function hasUserProfile(info: UserInfoType): boolean {
  return info.email.length > 0 && info.name.length > 0;
}

async function resolveUserInfoFromStoredSession(
  controller: UserController
): Promise<UserInfoType> {
  let info = controller.getUserInfo();
  if (hasUserProfile(info)) {
    return info;
  }

  const tokenService = new Token();
  const accessToken = tokenService.getValue(TOKENNAME);
  const refreshToken = tokenService.getValue(REFRESHTOKEN);
  const hasAccessToken = accessToken.trim().length > 0;
  const hasRefreshToken = refreshToken.trim().length > 0;
  if (!hasAccessToken && !hasRefreshToken) {
    return info;
  }

  try {
    if (!hasAccessToken && hasRefreshToken) {
      await TokenRefreshService.refreshOnce();
    }
    await controller.updateUserInfo();
    info = controller.getUserInfo();
    if (hasUserProfile(info) && !TokenRefreshService.isAutoRefreshRunning()) {
      TokenRefreshService.startAutoRefresh();
    }
  } catch (error) {
    log.warn("[dev-browser] could not hydrate user info from stored tokens", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return info;
}

/** Coerce a handler return value into the canonical bridge response shape. */
function normalizeBridgeResult(raw: unknown): CommonMessage<unknown> {
  if (raw === null || raw === undefined) {
    return { status: false, msg: "Handler returned no result.", data: null };
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "status" in raw &&
    typeof (raw as { status: unknown }).status === "boolean"
  ) {
    const obj = raw as CommonMessage<unknown>;
    return {
      status: obj.status,
      msg: typeof obj.msg === "string" ? obj.msg : "",
      data: "data" in obj ? obj.data : null,
    };
  }
  // Bare payload: treat as a successful result and wrap it.
  return { status: true, msg: "", data: raw };
}

export class DevBrowserDispatcher {
  private readonly handlers: ReadonlyMap<string, DevBrowserHandler>;

  constructor(handlers?: ReadonlyMap<string, DevBrowserHandler>) {
    this.handlers = handlers ?? createDefaultHandlers();
  }

  /** True iff a reviewed handler exists for this channel. */
  isDispatchable(channel: string): boolean {
    return this.handlers.has(channel);
  }

  /**
   * Dispatch an invoke request. Never throws — handler errors and unsupported
   * channels both become `{ status: false }` responses.
   */
  async dispatch(
    channel: string,
    data: unknown
  ): Promise<CommonMessage<unknown>> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      return {
        status: false,
        msg: `Channel '${channel}' is not available through the dev browser bridge.`,
        data: null,
      };
    }
    try {
      const raw = await handler(data);
      return normalizeBridgeResult(raw);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        status: false,
        msg: `Dev browser bridge handler error: ${msg}`,
        data: null,
      };
    }
  }
}

/**
 * Default handler set — the reviewed MVP channels.
 *
 * Each entry calls the same module/controller layer the IPC handler uses, so
 * business logic stays in exactly one place. Add a channel here AND in
 * devBrowserChannels.ts when expanding coverage.
 */
export function createDefaultHandlers(): ReadonlyMap<string, DevBrowserHandler> {
  const handlers = new Map<string, DevBrowserHandler>();

  // GET_APP_INFO — read-only app metadata (package.json / Electron app info).
  handlers.set(GET_APP_INFO, async () => {
    const module = new MainProcessAppInfoModule();
    const info = module.getAppInfo();
    const result: CommonMessage<unknown> = {
      status: true,
      msg: "get app info success",
      data: info,
    };
    return result;
  });

  // QUERY_USER_INFO — read-only local user profile (Token-backed).
  handlers.set(QUERY_USER_INFO, async () => {
    const controller = new UserController();
    const info = await resolveUserInfoFromStoredSession(controller);
    const result: CommonMessage<unknown> = {
      status: true,
      msg: "",
      data: info,
    };
    return result;
  });

  // GET_LOGIN_URL — dev-browser desktop login bootstrap.
  handlers.set(GET_LOGIN_URL, async () => {
    replaceActiveDevBrowserLogin(null);
    const controller = new UserController();
    const prepared = await controller.prepareDesktopLogin();
    replaceActiveDevBrowserLogin(prepared.cancel);
    attachDevBrowserLoginCompletion(prepared.cancel, prepared.done);
    const result: CommonMessage<unknown> = {
      status: true,
      msg: "Login URL retrieved successfully",
      data: prepared.loginUrl,
    };
    return result;
  });

  return handlers;
}
