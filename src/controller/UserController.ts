import { RemoteSource, jwtUser } from "@/modules/remotesource";
// import Store,{ Schema } from 'electron-store';
import {
  getUserpath,
  checkAndCreatePath,
  getApplogspath,
} from "@/modules/lib/function";
import { log } from "@/modules/Logger";
//import { Scraperdb } from "@/model/scraperdb";
// import {SequelizeConfig} from "@/config/SequelizeConfig"
// import * as fs from 'fs';
// import * as path from 'path';
import {
  USERSDBPATH,
  USERLOGPATH,
  USEREMAIL,
  USERNAME,
  USERPLANS,
  USER_AI_ENABLED,
} from "@/config/usersetting";
import { UserPlan } from "@/modules/remotesource";
import { Token } from "@/modules/token";
//import {runAfterTableCreate} from "@/modules/lib/databaseinit"
import { SqliteDb } from "@/config/SqliteDb";
// import { runafterbootup } from "@/modules/bootuprun"
import { UserInfoType } from "@/entityTypes/userType";
//import { CommonMessage } from "@/entityTypes/commonType";
import { shell, BrowserWindow } from "electron";
// const packageJson = require('../../../package.json');
// import {Token} from "@/modules/token"
import { resolveViteLoginBase } from "@/config/viteLoginUrl";
import {
  generateCodeVerifier,
  deriveCodeChallenge,
  generateState,
} from "@/modules/pkce";
import {
  setPendingDesktopAuth,
  clearPendingDesktopAuth,
  getPendingDesktopAuth,
} from "@/modules/pendingDesktopAuth";
import {
  startLoopbackCallbackServer,
  type LoopbackServerHandle,
} from "@/modules/loopbackCallbackServer";
import { consumeDesktopAuthCode } from "@/modules/desktopAuthExchange";

// const debug = require('debug')('user-controller');
export type userlogin = {
  user: string;
  pass: string;
};
export type userResponse = {
  status: boolean;
  msg: string;
  data?: jwtUser;
};
// interface SchemaData {
//     userPath: string;
//   }
export class UserController {
  // private user: string;
  // private pass: string;

  /**
   * Returns the main BrowserWindow for the desktop-login completion cascade
   * (navigation to Dashboard, etc). The IPC layer sets this at app startup
   * via setMainWindowProvider so the controller does not import background.ts
   * (which would create a circular dependency).
   *
   * Defaults to () => null so the controller is usable in contexts without
   * a window (tests, worker processes).
   */
  private static _mainWindowProvider: () => BrowserWindow | null = () => null;

  public static setMainWindowProvider(
    provider: () => BrowserWindow | null
  ): void {
    UserController._mainWindowProvider = provider;
  }

  private _windowProvider(): BrowserWindow | null {
    return UserController._mainWindowProvider();
  }

  /**
   * Check if a plan enables AI features.
   */
  private isAiEnabledPlan(plan: UserPlan): boolean {
    if (!plan) return false;

    const planNameLower = (plan.planName || "").toLowerCase();
    const planIdUpper = (plan.planId || "").toUpperCase();
    const isFreePlan =
      planNameLower.includes("community") || planNameLower.includes("free");

    if (isFreePlan) return false;

    return (
      planNameLower.includes("aifetch-plus") ||
      planNameLower.includes("aifetch-pro") ||
      planNameLower.includes("aifetch-go") ||
      ["BASE", "PLUS", "PRO"].includes(planIdUpper)
    );
  }

  /**
   * Check if user has any active AI-enabled plan.
   */
  private hasActiveAiPlan(plans: Array<UserPlan>): boolean {
    if (!plans || plans.length === 0) return false;
    return plans.some(
      (plan) =>
        plan.status.toLowerCase() === "active" && this.isAiEnabledPlan(plan)
    );
  }

  /**
   * Check if AI features are enabled for the current user
   */
  public isAIEnabled(): boolean {
    const tokenService = new Token();
    const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
    return aiEnabled === "true";
  }

  //defined login function which will call remote source with request
  //and return the result
  // public async login(data: userlogin): Promise<jwtUser> {

  //     const remoteSourmodel = new RemoteSource;
  //    // console.log(data)
  //     const jwtuser = await remoteSourmodel.Login(data.user, data.pass).then(async function (res) {
  //         //console.log(res);
  //         res as jwtUser
  //         if (res.email.length > 0) {

  //             //check db exist, create one if not exist

  //             const userdataPath = getUserpath(res.email)
  //             //console.log(userdataPath)

  //             //     // type: 'object',
  //             const logPath = getApplogspath(res.email)

  //             await checkAndCreatePath(userdataPath)
  //             await checkAndCreatePath(logPath)
  //             const tokenService = new Token()
  //             console.log(res)
  //             //tokenService.setValue('useremail',res.email)
  //             tokenService.setValue(USEREMAIL, res.email)
  //             tokenService.setValue(USERNAME, res.name)
  //             tokenService.setValue(USERSDBPATH, userdataPath)
  //             tokenService.setValue(USERLOGPATH, logPath)
  //             //tokenService.setValue(USERROLES, JSON.stringify(res.roles))
  //             //const scraperModel = Scraperdb.getInstance(userdataPath);
  //             //const dbdatapath=scraperModel.getdbpath(userdataPath)
  //             // console.log(dbdatapath)
  //             try {
  //             //scraperModel.init()
  //             const appDataSource = SqliteDb.getInstance(userdataPath)
  //             if(!appDataSource.connection.isInitialized){
  //             await appDataSource.connection.initialize()
  //             }
  //             } catch (error) {
  //                 console.error('Failed to initialize database connection:', error)

  //                 // Log detailed error information
  //                 if (error instanceof Error) {
  //                     console.error(`Error name: ${error.name}`)
  //                     console.error(`Error message: ${error.message}`)
  //                     console.error(`Error stack: ${error.stack}`)

  //                     // Handle specific error types
  //                     if (error.message === 'SQLITE_CANTOPEN') {
  //                         console.error('Could not open SQLite database file. Check path and permissions.')
  //                     } else if (error.name === 'SQLITE_CORRUPT') {
  //                         console.error('SQLite database file is corrupted.')
  //                     } else if (error.name === 'CannotConnectAlreadyConnectedError') {
  //                         console.log('SQLite database file is already connected.')
  //                     }else if(error.name==='CannotConnectAlreadyConnectedError2'){
  //                         console.log('SQLite database file is already connected.')

  //                     } else {
  //                         // Throw a more descriptive error or return a specific error response
  //                        throw new Error(`Database initialization failed: ${error.message}`)
  //                     }

  //                 }
  //             }
  //             console.log('initialize')
  //             // const sequelize=SequelizeConfig.getInstance(userdataPath);
  //             // await sequelize.sync({ force: true,alter: true });
  //             // Insert some sample data after the sync completes
  //             //  runAfterTableCreate()

  //            // await runafterbootup()
  //         }
  //         return res;
  //     }).catch(function (error) {
  //         console.log(error.stack)
  //         //debug(error);
  //         throw new Error(error.message);
  //     });
  //     return jwtuser;
  // }
  /**
   * Returns the bare login origin (e.g. "https://marketing.example.com")
   * with no query string and no `?app=` parameter. Used as the base for
   * prepareDesktopLogin()'s composed URL.
   *
   * Throws if VITE_LOGIN_URL is missing, literally "undefined"/"null",
   * or fails whatwg URL parsing.
   */
  public getLoginPageUrl(): string {
    const resolved = resolveViteLoginBase();
    const loginUrlRaw = resolved?.value;

    if (loginUrlRaw === undefined) {
      const msg =
        "VITE_LOGIN_URL is not set or is empty. Set VITE_LOGIN_URL in .env at build time; CI maps secret VITE_LOGIN_URL_TEST to VITE_LOGIN_URL in .env.";
      log.error("[getLoginPageUrl] " + msg);
      throw new Error(msg);
    }
    if (loginUrlRaw === "undefined" || loginUrlRaw === "null") {
      throw new Error(
        "VITE_LOGIN_URL must not be the literal text 'undefined' or 'null'; fix .env / CI secret value."
      );
    }

    const ensureProtocol = (raw: string): string => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return trimmed;
      if (/^https?:\/\//i.test(trimmed)) return trimmed;

      // If user configured "example.com" (missing scheme), URL() will throw in Node.
      // Choose http for localhost/ip, otherwise https.
      const hostLike = trimmed.replace(/^\/+/, "").split(/[/?#]/)[0] || "";
      const isLocal =
        hostLike.startsWith("localhost") ||
        hostLike.startsWith("127.0.0.1") ||
        /^\d{1,3}(\.\d{1,3}){3}/.test(hostLike);
      const withScheme = `${isLocal ? "http" : "https"}://${trimmed}`;
      log.warn("[getLoginPageUrl] Base URL missing protocol, auto-fixing", {
        input: trimmed,
        output: withScheme,
      });
      return withScheme;
    };

    const loginUrl = ensureProtocol(loginUrlRaw);
    const baseStr = loginUrl.trim();

    let baseUrl: URL;
    try {
      baseUrl = new URL(baseStr);
    } catch (error: unknown) {
      log.error(
        "[getLoginPageUrl] VITE_LOGIN_URL is not a valid absolute URL (whatwg URL parse failed)",
        {
          loginUrlRawLen: loginUrlRaw.length,
          baseLen: baseStr.length,
          hasHttpScheme: /^https?:\/\//i.test(baseStr),
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        }
      );
      throw new Error(
        "VITE_LOGIN_URL must be a valid absolute URL (e.g. https://your-marketing-host.com)."
      );
    }

    // Return the bare origin. prepareDesktopLogin() composes the full URL
    // with desktop_auth, client_id, redirect_uri, state, code_challenge,
    // and code_challenge_method.
    return baseUrl.origin;
  }

  /**
   * Prepares a secure desktop login handoff.
   *
   * Steps:
   *   1. Generate PKCE verifier + challenge + state.
   *   2. Start loopback callback server on 127.0.0.1 (random port).
   *   3. Store pending auth (verifier, challenge, state, redirectUri, expiry).
   *   4. Build login URL:
   *        <origin>/login?desktop_auth=1&client_id=aifetchly-desktop
   *          &redirect_uri=<loopback>&state=<state>
   *          &code_challenge=<challenge>&code_challenge_method=S256
   *   5. Attach a consumer to the loopback callback that validates state,
   *      exchanges the code for tokens, and completes the login cascade.
   *
   * Returns:
   *   - loginUrl: the URL to open in the browser.
   *   - cancel(): aborts the loopback server and clears pending state.
   *   - done: a promise that resolves with the outcome of the loopback
   *     callback processing. The caller (IPC layer) attaches UI-facing
   *     side-effects (dialogs, error messages, token cleanup) via
   *     done.then(...). Resolves on both success and failure — always
   *     check result.ok.
   *
   * If the browser never redirects back to the loopback URL, `done`
   * rejects with the loopback server's timeout/abort error. The caller
   * should attach a rejection handler.
   */
  public async prepareDesktopLogin(): Promise<{
    loginUrl: string;
    cancel: () => void;
    done: Promise<
      { ok: true } | { ok: false; reason: string; message: string }
    >;
  }> {
    const origin = this.getLoginPageUrl();

    // 1. PKCE + state.
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);
    const state = generateState();

    // 2. Loopback callback server.
    let server: LoopbackServerHandle;
    try {
      server = await startLoopbackCallbackServer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("[prepareDesktopLogin] failed to start loopback server", {
        error: message,
      });
      throw new Error(`Could not start login callback server: ${message}`);
    }

    // 3. Store pending auth.
    setPendingDesktopAuth({
      codeVerifier,
      codeChallenge,
      state,
      redirectUri: server.redirectUri,
    });

    // 4. Compose URL.
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("desktop_auth", "1");
    loginUrl.searchParams.set("client_id", "aifetchly-desktop");
    loginUrl.searchParams.set("redirect_uri", server.redirectUri);
    loginUrl.searchParams.set("state", state);
    loginUrl.searchParams.set("code_challenge", codeChallenge);
    loginUrl.searchParams.set("code_challenge_method", "S256");

    log.debug("[prepareDesktopLogin] Composed secure desktop login URL", {
      origin,
      port: server.port,
      redirectUri: server.redirectUri,
      // state and challenge are intentionally NOT logged.
    });

    // 5. Attach the callback consumer. The promise resolves/rejects with
    //    the outcome of the loopback callback processing; the caller
    //    surfaces it to the UI. The BrowserWindow is resolved lazily via
    //    windowProvider so tests can inject a mock.
    const done = server
      .waitForCallback()
      .then(async ({ code, state: returnedState }) =>
        consumeDesktopAuthCode({
          code,
          state: returnedState,
          win: this._windowProvider(),
        })
      )
      .then((result) => {
        if (result.ok) return { ok: true as const };
        return {
          ok: false as const,
          reason: result.reason,
          message: result.message,
        };
      });

    const cancel = (): void => {
      server.abort();
      // Only clear if the current pending auth is still ours — a newer
      // prepareDesktopLogin() may have already replaced the pending state.
      // Without this guard, an old cancel() (triggered by
      // setActiveDesktopLoginCancel replacing the handoff) would wipe the
      // fresh pending auth, causing the loopback callback to reject with
      // "no_pending_auth".
      const current = getPendingDesktopAuth();
      if (current && current.state === state) {
        clearPendingDesktopAuth();
      }
    };

    return { loginUrl: loginUrl.toString(), cancel, done };
  }

  /**
   * @deprecated Use prepareDesktopLogin() + shell.openExternal from the IPC
   *   layer. This thin wrapper is retained for direct callers but simply
   *   delegates to the same pipeline. Does NOT wait for the loopback
   *   callback — callers that need completion should await the `done`
   *   promise returned by prepareDesktopLogin().
   */
  public async openLoginPage(): Promise<void> {
    const prepared = await this.prepareDesktopLogin();
    try {
      await shell.openExternal(prepared.loginUrl);
    } catch (error) {
      prepared.cancel();
      const message = error instanceof Error ? error.message : String(error);
      log.error("[openLoginPage] failed to open browser:", error);
      throw new Error(`Failed to open browser: ${message}`);
    }
  }

  //get user email
  public getUserInfo(): UserInfoType {
    const tokenService = new Token();
    const email = tokenService.getValue(USEREMAIL);
    const name = tokenService.getValue(USERNAME);
    const plansStr = tokenService.getValue(USERPLANS);
    const aiEnabled = this.isAIEnabled();
    // const listroles = tokenService.getValue(USERROLES)
    // console.log(listroles)
    // const roles = JSON.parse(tokenService.getValue(USERROLES)) || []

    // Parse plans from stored JSON string
    let plans = undefined;
    if (plansStr) {
      try {
        plans = JSON.parse(plansStr);
      } catch (error) {
        log.error("Failed to parse user plans:", error);
      }
    }

    const data: UserInfoType = {
      name: name,
      email: email,
      plans: plans,
      aiEnabled: aiEnabled,
      //roles:roles
    };
    return data;
  }
  //check user login status
  public async checklogin(): Promise<jwtUser | null> {
    const remoteSourmodel = new RemoteSource();
    const userInfo = await remoteSourmodel
      .GetUserInfo()
      .then(function (res) {
        log.debug("User info retrieved:", res);
        return res;
      })
      .catch(function (error) {
        log.error("Failed to get user info:", error);
        //debug(error);
        //throw new Error(error.message);
        return null;
      });
    return userInfo;
  }
  //update user info by token
  public async updateUserInfo(): Promise<jwtUser | null> {
    const remoteSourmodel = new RemoteSource();

    const userInfo = await remoteSourmodel
      .GetUserInfo()
      .then(async function (res) {
        if (res) {
          if (res.email.length > 0) {
            //check db exist, create one if not exist

            const userdataPath = getUserpath(res.email);
            log.debug("User data path:", userdataPath);

            //     // type: 'object',
            const logPath = getApplogspath(res.email);

            await checkAndCreatePath(userdataPath);
            await checkAndCreatePath(logPath);
            const tokenService = new Token();
            log.debug("User info from remote:", res);
            //tokenService.setValue('useremail',res.email)
            tokenService.setValue(USEREMAIL, res.email);
            tokenService.setValue(USERNAME, res.name);
            // tokenService.setValue(USERID, res.id.toString())
            tokenService.setValue(USERSDBPATH, userdataPath);
            tokenService.setValue(USERLOGPATH, logPath);
            // Save user's subscription plans
            if (res.plans && res.plans.length > 0) {
              tokenService.setValue(USERPLANS, JSON.stringify(res.plans));
              log.info("Saved user plans:", res.plans);

              // Check if user has an AI-enabled subscription plan.
              const userController = new UserController();
              const hasAiPlan = userController.hasActiveAiPlan(res.plans);
              tokenService.setValue(
                USER_AI_ENABLED,
                hasAiPlan ? "true" : "false"
              );
              log.info("AI features enabled:", hasAiPlan);
            } else {
              // Set default Community plan if no plans returned
              const defaultPlans = [
                { planName: "Community", status: "active" },
              ];
              tokenService.setValue(USERPLANS, JSON.stringify(defaultPlans));
              // Community plan does not have AI features
              tokenService.setValue(USER_AI_ENABLED, "false");
              log.info("Saved default Community plan, AI features disabled");
            }
            //const scraperModel = Scraperdb.getInstance(userdataPath);
            //const dbdatapath=scraperModel.getdbpath(userdataPath)
            // console.log(dbdatapath)
            try {
              //scraperModel.init()
              const appDataSource = SqliteDb.getInstance(userdataPath);
              if (!appDataSource.connection.isInitialized) {
                await SqliteDb.ensureInitialized();
              }
              //await runafterbootup()
            } catch (error) {
              log.error("Failed to initialize database connection:", error);

              // Log detailed error information
              if (error instanceof Error) {
                log.error(`Error name: ${error.name}`);
                log.error(`Error message: ${error.message}`);
                log.error(`Error stack: ${error.stack}`);

                // Handle specific error types
                if (error.message === "SQLITE_CANTOPEN") {
                  log.error(
                    "Could not open SQLite database file. Check path and permissions."
                  );
                } else if (error.name === "SQLITE_CORRUPT") {
                  log.error("SQLite database file is corrupted.");
                } else if (
                  error.name === "CannotConnectAlreadyConnectedError"
                ) {
                  log.info("SQLite database file is already connected.");
                } else if (
                  error.name === "CannotConnectAlreadyConnectedError2"
                ) {
                  log.info("SQLite database file is already connected.");
                } else {
                  // Throw a more descriptive error or return a specific error response
                  throw new Error(
                    `Database initialization failed: ${error.message}`
                  );
                }
              }
            }
          } else {
            throw new Error("User email is empty in remote source");
          }
        } else {
          throw new Error("User info not found in remote source");
        }
        return res;
      })
      .catch(function (error) {
        log.error("Failed to get user info:", error);
        //debug(error);
        throw new Error(error.message);
        // return null;
      });
    return userInfo;
  }
}
