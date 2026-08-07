// import * as path from "path"
import * as fs from "fs";
import Papa from "papaparse";
import fetch from "node-fetch";
// import { fetch as undicifetch,Agent } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";
import {
  ProxyParseItem,
  ProxyCheckres,
  ProxylistResp,
} from "@/entityTypes/proxyType";
import {
  runWithConcurrency,
  type ProxyCheckBatchOptions,
  type ProxyCheckBatchResult,
  type ProxyCheckItemInternal,
  type ProxyCheckMode,
} from "@/entityTypes/proxyAiToolTypes";
import * as http from "http";
import * as https from "https";
import * as url from "url";
// import { socksDispatcher } from "fetch-socks";
import {
  ProxyCheckModel,
  proxyCheckStatus,
  googlePassStatus,
} from "@/model/ProxyCheck.model";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";
//import { ProxyApi } from "@/api/proxyApi"
import { SocksProxyAgent } from "socks-proxy-agent";
// import { Request, Response } from "express";
// import { ProxyModel } from "@/model/Proxy.model";
// import { getRecorddatetime } from "@/modules/lib/function";
// import { ProxyEntity } from "@/entity/Proxy.entity";
import { ProxyCheckEntity } from "@/entity/ProxyCheck.entity";
import { IProxyApi } from "@/modules/interface/IProxyApi";
import { ProxyModule } from "@/modules/ProxyModule";
import { utilityProcess } from "electron";
import * as path from "path";
import {
  getPackagedWorkerPathCandidates,
  resolvePackagedWorkerPath,
  buildPackagedWorkerEnv,
} from "@/utils/packagedWorkerPath";
export class ProxyController {
  //import proxy from csv file
  // public async importProxyfile(filename: string) {
  //     //check filename is csv and exist
  //     if (!(path.extname(filename) === '.csv')) {
  //         throw new Error('File is not a csv');
  //     }
  //     fs.access(filename, fs.constants.F_OK, async (err) => {
  //         if (err) {
  //             throw new Error('File does not exist');
  //         } else {

  //         }
  //     });
  private proxyCheckdb: ProxyCheckModel;
  private proxyapi: IProxyApi;
  constructor() {
    const tokenService = new Token();
    let dbpath = tokenService.getValue(USERSDBPATH);
    if (!dbpath) {
      // For testing environments, use a temp directory
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const os = require("os") as typeof import("os");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require("path") as typeof import("path");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("fs") as typeof import("fs");
      const tmpDir = path.join(os.tmpdir(), "aifetchly-test");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }
      dbpath = tmpDir;
    }

    this.proxyCheckdb = new ProxyCheckModel(dbpath);
    this.proxyapi = new ProxyModule();
  }
  //     //return proxy list
  //     const response = await fetch(filename);
  //     return response;
  // }
  //handle csv file
  public async handleCsvdata(filename: string) {
    const response = await fetch(filename);
    const csvData = await response.text();
    const results = Papa.parse(csvData, { header: true });
    return results.data;
  }
  //convert proxy entity to url

  // Helper method to check HTTP proxy using CONNECT method
  private async checkHttpProxy(
    proxyHost: string,
    proxyPort: string,
    username?: string,
    password?: string,
    testUrl = "https://httpbin.org/ip",
    timeout = 5000
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const options: any = {
        host: proxyHost,
        port: parseInt(proxyPort),
        method: "CONNECT",
        path: new URL(testUrl).host + ":443",
        timeout,
      };

      // Add authentication if provided
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        options.headers = {
          "Proxy-Authorization": `Basic ${auth}`,
        };
      }

      const req = http.request(options);
      req.on("connect", (res, socket) => {
        socket.on("error", (socketError) => {
          console.log(
            `HTTP proxy socket error after connect: ${socketError.message}`
          );
          resolve(false);
        });
        socket.end();
        resolve(res.statusCode === 200);
      });

      req.on("error", (error) => {
        console.log(`HTTP proxy error: ${error.message}`);
        resolve(false);
      });

      req.on("timeout", () => {
        console.log(`HTTP proxy timeout after ${timeout}ms`);
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  // Helper method to check SOCKS proxy
  private async checkSocksProxy(
    proxyHost: string,
    proxyPort: string,
    username?: string,
    password?: string,
    testUrl = "https://httpbin.org/ip",
    timeout = 5000
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const options: any = {
        host: proxyHost,
        port: parseInt(proxyPort),
        method: "CONNECT",
        path: new URL(testUrl).host + ":443",
        timeout,
      };

      // Add authentication if provided
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        options.headers = {
          "Proxy-Authorization": `Basic ${auth}`,
        };
      }

      const req = http.request(options);
      req.on("connect", (res, socket) => {
        socket.on("error", (socketError) => {
          console.log(
            `SOCKS proxy socket error after connect: ${socketError.message}`
          );
          resolve(false);
        });
        socket.end();
        resolve(res.statusCode === 200);
      });

      req.on("error", (error) => {
        console.log(`SOCKS proxy error: ${error.message}`);
        resolve(false);
      });

      req.on("timeout", () => {
        console.log(`SOCKS proxy timeout after ${timeout}ms`);
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  //check proxy valid
  public async checkProxy(
    proxyEntity: ProxyParseItem,
    timeout = 5000
  ): Promise<ProxyCheckres> {
    try {
      if (!proxyEntity.protocol) {
        throw new Error("protocol is required");
      }

      let isValid = false;

      if (proxyEntity.protocol.includes("http")) {
        // For HTTP/HTTPS proxies, use CONNECT method
        console.log(
          `Checking HTTP proxy: ${proxyEntity.host}:${proxyEntity.port}`
        );
        isValid = await this.checkHttpProxy(
          proxyEntity.host,
          proxyEntity.port,
          proxyEntity.user,
          proxyEntity.pass,
          "https://httpbin.org/ip",
          timeout
        );
      } else if (proxyEntity.protocol.includes("socks")) {
        // For SOCKS proxies, use CONNECT method
        console.log(
          `Checking SOCKS proxy: ${proxyEntity.host}:${proxyEntity.port}`
        );
        isValid = await this.checkSocksProxy(
          proxyEntity.host,
          proxyEntity.port,
          proxyEntity.user,
          proxyEntity.pass,
          "https://httpbin.org/ip",
          timeout
        );
      } else {
        throw new Error("protocol is not valid");
      }

      if (isValid) {
        console.log(`Proxy ${proxyEntity.host}:${proxyEntity.port} is valid`);
        return { status: true, msg: "", data: true };
      } else {
        console.log(`Proxy ${proxyEntity.host}:${proxyEntity.port} is invalid`);
        return { status: false, msg: "proxy check failure", data: false };
      }
    } catch (error) {
      let message = "";
      if (error instanceof Error) {
        message = error.message;
      }
      console.log(`Proxy check error: ${message}`);
      throw new Error("Proxy is not valid, " + message);
    }
  }

  /**
   * Check if proxy can pass Google's bot detection using child process
   * @param proxyEntity Proxy details to check
   * @param timeout Timeout in milliseconds (default: 15000)
   * @returns Promise<boolean> true if proxy passes Google check, false otherwise
   */
  public async checkGooglePass(
    proxyEntity: ProxyParseItem,
    timeout = 15000
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const electronProcess = process as NodeJS.Process & {
        resourcesPath?: string;
      };
      const runtime = {
        dirname: __dirname,
        cwd: process.cwd(),
        resourcesPath: electronProcess.resourcesPath,
        existsSync: fs.existsSync,
      };
      const options = {
        dirnameRelativePaths: [
          "googleProxyCheck.js",
          path.join("childprocess", "googleProxyCheck.js"),
          path.join("..", "childprocess", "googleProxyCheck.js"),
        ],
        cwdRelativePaths: [
          path.join("dist", "childprocess", "googleProxyCheck.js"),
          path.join(".vite", "build", "googleProxyCheck.js"),
          path.join(".vite", "build", "childprocess", "googleProxyCheck.js"),
        ],
      };
      const childPath = resolvePackagedWorkerPath(runtime, options);
      if (!childPath) {
        const candidates = getPackagedWorkerPathCandidates(runtime, options);
        const errorMsg = `Google proxy check child process not found. Tried: ${candidates.join(
          ", "
        )}. Please rebuild the application.`;
        console.error(errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      const requestId = `google-check-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      const child = utilityProcess.fork(childPath, [], {
        stdio: "pipe",
        execArgv: [],
        env: buildPackagedWorkerEnv(),
      });

      // Set timeout to kill child process if it hangs
      const timeoutId = setTimeout(() => {
        try {
          child.kill();
        } catch (error) {
          console.error("Error killing child process:", error);
        }
        reject(new Error("Google check timeout"));
      }, timeout + 5000); // Add buffer to timeout

      // Handle child process spawn
      child.on("spawn", () => {
        // Send message to child process
        child.postMessage(
          JSON.stringify({
            type: "CHECK_GOOGLE_PASS",
            proxy: proxyEntity,
            timeout,
            requestId,
          })
        );
      });

      // Handle messages from child process
      const messageHandler = (message: unknown) => {
        try {
          // Electron utility process messages can come in different formats
          let messageData: string;

          if (typeof message === "string") {
            // Message is a string directly
            messageData = message;
          } else if (
            message &&
            typeof message === "object" &&
            "data" in message
          ) {
            // Message has data property
            const msg = message as { data: unknown };
            if (typeof msg.data === "string") {
              messageData = msg.data;
            } else {
              console.error(
                "Invalid message data type from child process:",
                message
              );
              clearTimeout(timeoutId);
              child.removeListener("message", messageHandler);
              try {
                child.kill();
              } catch (killError) {
                console.error("Error killing child process:", killError);
              }
              reject(new Error("Invalid message format from child process"));
              return;
            }
          } else {
            console.error(
              "Invalid message format from child process:",
              message
            );
            clearTimeout(timeoutId);
            child.removeListener("message", messageHandler);
            try {
              child.kill();
            } catch (killError) {
              console.error("Error killing child process:", killError);
            }
            reject(new Error("Invalid message format from child process"));
            return;
          }

          const response = JSON.parse(messageData);
          if (
            response.type === "CHECK_GOOGLE_PASS_RESULT" &&
            response.requestId === requestId
          ) {
            clearTimeout(timeoutId);
            child.removeListener("message", messageHandler);
            try {
              child.kill();
            } catch (error) {
              console.error("Error killing child process:", error);
            }
            if (response.success) {
              resolve(response.passed);
            } else {
              reject(new Error(response.error || "Google check failed"));
            }
          }
        } catch (error) {
          clearTimeout(timeoutId);
          try {
            child.kill();
          } catch (killError) {
            console.error("Error killing child process:", killError);
          }
          reject(error);
        }
      };

      child.on("message", messageHandler as (message: unknown) => void);

      // Handle child process exit
      child.on("exit", (code) => {
        clearTimeout(timeoutId);
        if (code !== 0 && code !== null) {
          reject(new Error(`Child process exited with code ${code}`));
        }
      });

      // Handle child process errors
      child.on("error", (error) => {
        clearTimeout(timeoutId);
        try {
          child.kill();
        } catch (killError) {
          console.error("Error killing child process:", killError);
        }
        reject(error);
      });

      // Capture stderr from child process for debugging
      child.stderr?.on("data", (data) => {
        console.error(`Child process stderr: ${data}`);
      });

      // Capture stdout from child process for debugging
      child.stdout?.on("data", (data) => {
        console.log(`Child process stdout: ${data}`);
      });
    });
  }

  //check user's proxy and update db
  public async updateProxyStatus(
    proxyEntity: ProxyParseItem,
    proxyID: number,
    timeout?: number
  ): Promise<void> {
    // Redacted log: never print raw credentials.
    console.log("updateProxyStatus", {
      host: proxyEntity.host,
      port: proxyEntity.port,
      protocol: proxyEntity.protocol,
      hasPassword: Boolean(proxyEntity.pass),
    });
    await this.checkProxy(proxyEntity, timeout)
      .then(async (res) => {
        if (res.status) {
          //update success status to db
          await this.proxyCheckdb.updateProxyCheck(
            proxyID,
            proxyCheckStatus.Success
          );

          // If basic check passes, also check Google pass (async, non-blocking)
          this.checkGooglePass(proxyEntity, timeout)
            .then((googlePassed) => {
              const googleStatus = googlePassed
                ? googlePassStatus.Pass
                : googlePassStatus.Fail;
              this.proxyCheckdb
                .updateGooglePassStatus(proxyID, googleStatus)
                .catch((error) => {
                  console.error(
                    `Error updating Google pass status for proxy ${proxyID}:`,
                    error
                  );
                });
            })
            .catch((error) => {
              console.error(
                `Error checking Google pass for proxy ${proxyID}:`,
                error
              );
              // Mark as fail if check fails
              this.proxyCheckdb
                .updateGooglePassStatus(proxyID, googlePassStatus.Fail)
                .catch((updateError) => {
                  console.error(
                    `Error updating Google pass status for proxy ${proxyID}:`,
                    updateError
                  );
                });
            });
        } else {
          //update failure status to db
          await this.proxyCheckdb.updateProxyCheck(
            proxyID,
            proxyCheckStatus.Failure
          );
        }
      })
      .catch(async (error) => {
        console.log(error);
        //update status to db
        await this.proxyCheckdb.updateProxyCheck(
          proxyID,
          proxyCheckStatus.Failure
        );
      });
  }
  public async checkAllproxy(
    callback?: (arg: number, totalNum: number) => void,
    finishcall?: () => void,
    timeout?: number,
    proxyIds?: number[]
  ): Promise<void> {
    // Thin wrapper over checkProxyBatch so the UI path and the AI tool path
    // share one reliable, awaited, concurrency-limited implementation.
    const useIds = proxyIds !== undefined && proxyIds.length > 0;
    await this.checkProxyBatch({
      ...(useIds ? { proxyIds } : { checkAll: true }),
      mode: "both",
      timeoutMs: timeout ?? 15000,
      concurrency: 3,
      onProgress: (progress) => {
        if (callback) {
          callback(progress.checked, progress.total);
        }
      },
    });
    if (finishcall) {
      finishcall();
    }
  }

  /**
   * Check a batch of proxies with controlled concurrency. Replaces the old
   * async-forEach "check all" path that could report completion before all
   * checks settled. Per-proxy failures do not abort the batch; only setup
   * errors (e.g. child process missing) throw. Database status updates happen
   * in the main process via ProxyCheckModel.
   */
  public async checkProxyBatch(
    options: ProxyCheckBatchOptions
  ): Promise<ProxyCheckBatchResult> {
    const { mode, timeoutMs, concurrency, onProgress } = options;

    let targetIds: number[];
    if (options.proxyIds !== undefined && options.proxyIds.length > 0) {
      targetIds = [...options.proxyIds];
    } else if (options.checkAll) {
      targetIds = await this.collectAllProxyIds();
    } else {
      targetIds = [];
    }
    const total = targetIds.length;

    interface DetailedTarget {
      id: number;
      proxy: ProxyParseItem;
    }
    const detailed: DetailedTarget[] = [];
    const setupErrors: ProxyCheckItemInternal[] = [];
    // Batch-load all target proxies in one query instead of one getProxyDetail
    // round-trip per id. Missing/unloadable ids become per-item setup errors.
    const loadedProxies = await this.proxyapi.getProxiesByIds(targetIds);
    const proxyById = new Map<number, ProxyParseItem>();
    for (const proxy of loadedProxies) {
      if (proxy.id !== undefined) {
        proxyById.set(proxy.id, {
          host: proxy.host,
          port: proxy.port,
          protocol: proxy.protocol,
          user: proxy.user,
          pass: proxy.pass,
        });
      }
    }
    for (const id of targetIds) {
      const proxy = proxyById.get(id);
      if (proxy && proxy.host && proxy.port && proxy.protocol) {
        detailed.push({ id, proxy });
      } else {
        setupErrors.push({
          proxyId: id,
          error: "proxy not found or missing host/port/protocol",
        });
      }
    }

    let checked = 0;
    const workerResults = await runWithConcurrency(
      detailed,
      concurrency,
      async (item): Promise<ProxyCheckItemInternal> => {
        const result = await this.runProxyCheck(
          item.proxy,
          item.id,
          mode,
          timeoutMs
        );
        checked += 1;
        if (onProgress) {
          onProgress({
            checked,
            total,
            proxyId: item.id,
            ...(result.basic !== undefined ? { basic: result.basic } : {}),
            ...(result.googlePass !== undefined
              ? { googlePass: result.googlePass }
              : {}),
            ...(result.error !== undefined ? { error: result.error } : {}),
          });
        }
        const internal: ProxyCheckItemInternal = {
          proxyId: item.id,
          ...(result.basic !== undefined ? { basic: result.basic } : {}),
          ...(result.googlePass !== undefined
            ? { googlePass: result.googlePass }
            : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
        };
        return internal;
      }
    );

    const checkedResults = workerResults.filter(
      (r): r is ProxyCheckItemInternal => r !== undefined
    );
    return {
      total,
      checked: checkedResults.length + setupErrors.length,
      results: [...setupErrors, ...checkedResults],
    };
  }

  /**
   * Run a single proxy check according to mode and persist status.
   * - basic: reachability only.
   * - google: Google pass only.
   * - both: reachability first; Google only if basic passes.
   * Never throws — network/browser failures become per-item error results.
   */
  private async runProxyCheck(
    proxy: ProxyParseItem,
    proxyId: number,
    mode: ProxyCheckMode,
    timeoutMs: number
  ): Promise<ProxyCheckItemInternal> {
    type MutableCheckItem = {
      proxyId: number;
      basic?: "pass" | "failure";
      googlePass?: "pass" | "fail";
      error?: string;
    };
    const result: MutableCheckItem = { proxyId };

    const runBasic = mode === "basic" || mode === "both";
    const runGoogle = mode === "google" || mode === "both";

    let basicPassed = false;
    if (runBasic) {
      try {
        const res = await this.checkProxy(proxy, timeoutMs);
        if (res.status) {
          result.basic = "pass";
          basicPassed = true;
          await this.proxyCheckdb.updateProxyCheck(
            proxyId,
            proxyCheckStatus.Success
          );
        } else {
          result.basic = "failure";
          await this.proxyCheckdb.updateProxyCheck(
            proxyId,
            proxyCheckStatus.Failure
          );
        }
      } catch (error) {
        result.basic = "failure";
        result.error =
          error instanceof Error ? error.message : "basic check failed";
        await this.proxyCheckdb.updateProxyCheck(
          proxyId,
          proxyCheckStatus.Failure
        );
      }
    }

    const shouldCheckGoogle = runGoogle && (mode === "google" || basicPassed);
    if (shouldCheckGoogle) {
      try {
        const passed = await this.checkGooglePass(proxy, timeoutMs);
        result.googlePass = passed ? "pass" : "fail";
        await this.proxyCheckdb.updateGooglePassStatus(
          proxyId,
          passed ? googlePassStatus.Pass : googlePassStatus.Fail
        );
      } catch (error) {
        result.googlePass = "fail";
        result.error =
          error instanceof Error ? error.message : "google check failed";
        await this.proxyCheckdb.updateGooglePassStatus(
          proxyId,
          googlePassStatus.Fail
        );
      }
    }

    return result;
  }

  /** Collect every stored proxy ID using correct 1-based pagination. */
  private async collectAllProxyIds(): Promise<number[]> {
    const count = await this.proxyapi.getProxycount();
    const ids: number[] = [];
    const size = 100;
    for (let page = 1; (page - 1) * size < count; page += 1) {
      const res = await this.proxyapi.getProxylist(page, size, "");
      if (!res.status || !res.data || res.data.records.length === 0) {
        break;
      }
      for (const record of res.data.records) {
        if (record.id !== undefined) {
          ids.push(record.id);
        }
      }
      if (res.data.records.length < size) {
        break;
      }
    }
    return ids;
  }

  /**
   * Return IDs of proxies whose latest check matches the failure type:
   * - basic: latest basic reachability check failed
   * - google: latest Google pass check failed
   * - either: union of both
   * Used by the AI remove-failed tool to enumerate cleanup candidates.
   */
  public async getFailedProxyCandidateIds(
    failureType: "basic" | "google" | "either"
  ): Promise<number[]> {
    const ids = new Set<number>();
    if (failureType === "basic" || failureType === "either") {
      const basic = await this.proxyCheckdb.getProxyByStatus(
        proxyCheckStatus.Failure
      );
      basic.forEach((p) => ids.add(p.proxy_id));
    }
    if (failureType === "google" || failureType === "either") {
      const google = await this.proxyCheckdb.getProxyByGooglePassStatus(
        googlePassStatus.Fail
      );
      google.forEach((p) => ids.add(p.proxy_id));
    }
    return [...ids];
  }
  public async getProxylist(
    page: number,
    size: number,
    search: string
  ): Promise<ProxylistResp["data"]> {
    const checkDb = this.proxyCheckdb;
    // Unwrap the module envelope: registerValidatedHandler already wraps the
    // handler return in {status,msg,data}, so the controller must return the
    // bare {records,total} payload here to avoid double-wrapping.
    const res = await this.proxyapi.getProxylist(page, size, search);
    if (!res.status) {
      throw new Error(res.msg ?? "Failed to get proxy list");
    }
    if (res.data && res.data.records && res.data.records.length > 0) {
      // Batch-load check status for the whole page in one query instead of
      // one getProxyCheck round-trip per record.
      const ids = res.data.records
        .map((r) => r.id)
        .filter((id): id is number => id != null);
      const checkMap = await checkDb.getProxyChecksByIds(ids);
      for (const record of res.data.records) {
        if (record.id == null) {
          continue;
        }
        const checkInfo = checkMap.get(record.id);
        if (!checkInfo) {
          continue;
        }
        record.status = checkInfo.status;
        record.checktime = checkInfo.check_time;
        record.googlePass = checkInfo.google_pass ?? undefined;

        // Map to display name
        if (checkInfo.google_pass === googlePassStatus.Pass) {
          record.googlePassName = "Pass";
        } else if (checkInfo.google_pass === googlePassStatus.Fail) {
          record.googlePassName = "Fail";
        } else {
          record.googlePassName = "Not Checked";
        }
      }
    }
    return { total: res.data?.total ?? 0, records: res.data?.records ?? [] };
  }
  //remove failure proxy
  public async removeFailureProxy(callback?: () => void): Promise<void> {
    //get all failure proxy
    const failureProxy = await this.proxyCheckdb.getProxyByStatus(
      proxyCheckStatus.Failure
    );
    if (failureProxy) {
      console.log(failureProxy);
      //    const proxycheckres=this.proxyCheckdb
      //remove all failure proxy
      failureProxy.map(async (item) => {
        const res = await this.proxyapi.deleteProxy(item.proxy_id);
        if (res.status) {
          //delete from db
          this.proxyCheckdb.deleteProxyCheck(item.proxy_id);
        }
      });
    }

    if (callback) {
      callback();
    }
  }

  /**
   * Delete a single proxy and its check record. Used by the AI delete tool
   * so the proxy_check row does not become an orphan. Best-effort cleanup:
   * a failure to delete the check record is logged but does not undo the
   * proxy deletion.
   */
  public async deleteProxyWithCheck(proxyId: number): Promise<boolean> {
    const res = await this.proxyapi.deleteProxy(proxyId);
    const deleted = Boolean(res && (res as { status?: boolean }).status);
    try {
      await this.proxyCheckdb.deleteProxyCheck(proxyId);
    } catch (error) {
      console.error(`Failed to clean proxy_check for proxy ${proxyId}:`, error);
    }
    return deleted;
  }
}
