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
import { shell } from "electron";
// const packageJson = require('../../../package.json');
import { app } from "electron";
// import {Token} from "@/modules/token"
import { resolveViteLoginBase } from "@/config/viteLoginUrl";

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
   * Check if a plan is a Plus plan (enables AI features)
   * Plus plans have planName containing "aifetch-plus" (e.g. aifetch-plus-monthly)
   */
  private isPlusPlan(plan: UserPlan): boolean {
    if (!plan || !plan.planName) return false;
    const planNameLower = plan.planName.toLowerCase();
    return planNameLower.includes("aifetch-plus");
  }

  /**
   * Check if user has any active Plus plan
   */
  private hasActivePlusPlan(plans: Array<UserPlan>): boolean {
    if (!plans || plans.length === 0) return false;
    return plans.some(
      (plan) => plan.status === "active" && this.isPlusPlan(plan)
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
  public getLoginPageUrl(): string {
    const envLoginUrlRaw = process.env.VITE_LOGIN_URL;
    const metaLoginUrlRaw =
      typeof import.meta !== "undefined" && import.meta.env
        ? (import.meta.env.VITE_LOGIN_URL as string | undefined)
        : undefined;
    const metaLoginUrlTestRaw =
      typeof import.meta !== "undefined" && import.meta.env
        ? (import.meta.env.VITE_LOGIN_URL_TEST as string | undefined)
        : undefined;

    const resolved = resolveViteLoginBase();
    const loginUrlRaw = resolved?.value;

    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/a8010ee7-485a-4897-a54e-df8f89390712", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "6f1b64",
      },
      body: JSON.stringify({
        sessionId: "6f1b64",
        location: "UserController.ts:getLoginPageUrl",
        message: "resolveViteLoginBase",
        data: {
          hypothesisId: "H1",
          hasResolved: resolved !== undefined,
          source: resolved?.source,
          valueLen: resolved?.value.length,
          firstCharCode:
            resolved && resolved.value.length > 0
              ? resolved.value.charCodeAt(0)
              : null,
        },
        timestamp: Date.now(),
      }),
    }).catch((_err: unknown) => {
      /* telemetry send failure is non-critical */
    });
    // #endregion

    if (loginUrlRaw === undefined) {
      const msg =
        "VITE_LOGIN_URL is not set or is empty after trim. Set VITE_LOGIN_URL (or VITE_LOGIN_URL_TEST) in .env at build time; CI should map secret VITE_LOGIN_URL_TEST to VITE_LOGIN_URL in .env.";
      log.error("[getLoginPageUrl] " + msg, {
        hasProcessEnv: envLoginUrlRaw !== undefined,
        hasMetaEnv: metaLoginUrlRaw !== undefined,
        hasMetaTestEnv: metaLoginUrlTestRaw !== undefined,
      });
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

    const appName = app.getName() || "";
    const finalapp = appName.replace(/-/g, "");

    let finalloginUrl: string;
    try {
      const u = new URL("/", baseUrl);
      u.pathname = "/login";
      u.searchParams.set("app", finalapp);
      finalloginUrl = u.href;
    } catch (error: unknown) {
      log.error(
        "[getLoginPageUrl] failed to compose /login URL from base (pathname/searchParams)",
        {
          hypothesisId: "H3",
          baseHrefLen: baseUrl.href.length,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        }
      );
      throw new Error(
        "Could not build login URL from VITE_LOGIN_URL; check it is a full origin (e.g. https://host.com)."
      );
    }

    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/a8010ee7-485a-4897-a54e-df8f89390712", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "6f1b64",
      },
      body: JSON.stringify({
        sessionId: "6f1b64",
        location: "UserController.ts:getLoginPageUrl",
        message: "finalloginUrl built",
        data: {
          hypothesisId: "H3",
          ok: true,
          resultLen: finalloginUrl.length,
        },
        timestamp: Date.now(),
      }),
    }).catch((_err: unknown) => {
      /* telemetry send failure is non-critical */
    });
    // #endregion

    log.debug("[getLoginPageUrl] Build login URL", {
      envLoginUrlRaw,
      metaLoginUrlRaw,
      loginUrlRaw,
      loginUrl,
      appName,
      finalapp,
      finalloginUrl,
    });

    return finalloginUrl;
  }

  public openLoginPage() {
    // Open login page with shell
    // const loginUrl = import.meta.env.VITE_LOGIN_URL as string;
    // // Get app name from package.json
    // const appName = app.getName() || "";
    // const finalapp=appName.replace(/-/g, '');
    // // try {
    // //     appName = packageJson.name || "";
    // //     console.log(`Using app name from package.json: ${appName}`);
    // // } catch (error) {
    // //     console.error("Could not read package.json:", error);
    // // }

    // // Build the login URL with app name
    // const finalloginUrl=loginUrl.replace(/\/$/, '') + '/login?app='+finalapp
    // if (!finalloginUrl) {
    //     throw new Error("Login URL is not defined in environment variables");
    // }

    // // Check URL is valid
    // const urlPattern = new RegExp(
    //     '^(https?:\\/\\/)?' + // protocol
    //     '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
    //     '((\\d{1,3}\\.){3}\\d{1,3})|' + // OR ip (v4) address
    //     'localhost|' + // OR localhost
    //     '127\\.0\\.0\\.1)' + // OR 127.0.0.1
    //     '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
    //     '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
    //     '(\\#[-a-z\\d_]*)?$', // fragment locator
    //     'i'
    // );

    // if (!urlPattern.test(finalloginUrl)) {
    //     throw new Error(`Invalid login URL format: ${finalloginUrl}`);
    // }
    const finalloginUrl = this.getLoginPageUrl();

    try {
      // Open the URL in default browser
      shell.openExternal(finalloginUrl);
    } catch (error) {
      log.error("Failed to open browser:", error);
      throw new Error(
        `Failed to open browser: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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

              // Check if user has Plus plan and enable AI features
              const userController = new UserController();
              const hasPlusPlan = userController.hasActivePlusPlan(res.plans);
              tokenService.setValue(
                USER_AI_ENABLED,
                hasPlusPlan ? "true" : "false"
              );
              log.info("AI features enabled:", hasPlusPlan);
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
                await appDataSource.connection.initialize();
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
