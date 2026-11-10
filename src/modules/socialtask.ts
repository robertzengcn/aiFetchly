import { spawnOwned } from "@/main-process/lifecycle/ownedSpawn";
import * as os from "os";
import { WriteLog } from "@/modules/lib/function";
import { USERLOGPATH } from "@/config/usersetting";
import { Token } from "@/modules/token";
import { ownedSpawnAllowed, registerOwnedProcess } from "@/main-process/lifecycle/ownedSpawn";
import url from "url";
//import request from "@/modules/lib/request"
import { SocialTaskRun } from "@/modules/socialtaskrun";
//import { spawn } from 'node:child_process';
// import { Worker } from 'worker_threads';
// const os = require("os");
import {
  SocialTaskEntity,
  SocialTaskResponse,
  SocialTaskInfoResponse,
  SocialTaskTypeResponse,
  SaveSocialTaskResponse,
  TagResponse,
  SocialTaskRunEntity,
} from "@/entityTypes/socialtask-type";
import { utilityProcess, MessageChannelMain, app } from "electron";
import { log } from "@/modules/Logger";
import * as path from 'path';
// import { spawn } from 'node:child_process';
import * as fs from "fs";
import { HttpClient } from "@/modules/lib/httpclient";
import {
  buildPackagedWorkerEnv,
  getPackagedWorkerPathCandidates,
  resolvePackagedWorkerPath,
} from "@/utils/packagedWorkerPath";
// const fileLocation = path.join(__static, 'myText.txt')
/**
 * FR-06/AC-09: live social task runs (taskrun_num -> child pid), tracked
 * from spawn to child exit. SocialTask is instantiated per request, so this
 * registry is MODULE-level; the SocialTaskRun entity has no status column,
 * so at-exit reconciliation works from this map and logs an interruption
 * marker per run (the next run is a NEW taskrun row — nothing auto-retries).
 */
const activeSocialRuns = new Map<string, { childPid: number | null }>();

/** Record a live run; auto-removed when its child exits. */
function trackSocialRun(
  runNum: string,
  child: { pid?: number | null; once(event: string, cb: () => void): unknown }
): void {
  activeSocialRuns.set(runNum, { childPid: child.pid ?? null });
  try {
    child.once("exit", () => activeSocialRuns.delete(runNum));
  } catch {
    activeSocialRuns.delete(runNum);
  }
}

export class SocialTask {


  private _httpClient: HttpClient;
  //construct
  constructor() {
    this._httpClient = new HttpClient();
  }
  /**
   * get social task from remote servive
   */
  async getTaskbycampagin(
    campaignId: number,
    page: number,
    size: number
  ): Promise<SocialTaskResponse | null> {
    const queryParams = new URLSearchParams({
      campaiginId: campaignId.toString(),
      page: page.toString(),
      size: size.toString(),
    });
    const params = new url.URLSearchParams(queryParams);

    const tasklistres = await this._httpClient
      .get("/api/listsotask?" + params)
      .catch(function (error) {
        throw new Error(error.message);
        // console.error(error);
      });
    if (!tasklistres) {
      throw new Error("remote return social task is null");
    }
    // console.log("campaign list is following")
    // console.log(campignlistres.data)
    // const resp: SocialTaskResponse = {
    //     status: campignlistres.data.status,
    //     msg: campignlistres.data.msg,
    //     data: campignlistres.data.data,
    // }
    return tasklistres as SocialTaskResponse;
  }

  /**
   * get social task info by task id
   */
  async getTaskbyid(taskId: number): Promise<SocialTaskInfoResponse | null> {
    const queryParams = new URLSearchParams({ task_id: taskId.toString() });
    const params = new url.URLSearchParams(queryParams);

    const taskinfores = await this._httpClient
      .get("/api/getsocialtaskinfo?" + params)
      .catch(function (error) {
        throw new Error(error.message);
        // console.error(error);
      });
    if (!taskinfores) {
      throw new Error("remote return social task is null");
    }
    // console.log("campaign list is following")
    // console.log(campignlistres.data)
    // const resp: SocialTaskResponse = {
    //     status: campignlistres.data.status,
    //     msg: campignlistres.data.msg,
    //     data: campignlistres.data.data,
    // }
    return taskinfores as SocialTaskInfoResponse;
  }
  //get social task type list
  async getTasktype(): Promise<SocialTaskTypeResponse | null> {
    const tasktyperes = await this._httpClient
      .get("/api/socialtasktype")
      .catch(function (error) {
        throw new Error(error.message);
        // console.error(error);
      });
    if (!tasktyperes) {
      throw new Error("remote return social task type is null");
    }

    return tasktyperes as SocialTaskTypeResponse;
  }

  //get tag list
  async getTaglist(): Promise<TagResponse> {
    const tagres = await this._httpClient
      .get("/api/tag")
      .catch(function (error) {
        throw new Error(error.message);
        // console.error(error);
      });
    if (!tagres) {
      throw new Error("remote return tag is null");
    }

    return tagres as TagResponse;
  }
  //save social task
  async saveSocialTask(
    data: SocialTaskEntity
  ): Promise<SaveSocialTaskResponse> {
    const formData = new FormData();
    // Object.entries(data).forEach(([key, value]) => {
    //     formData.append(key, String(value));
    // });
    if (data.id) {
      formData.append("socialtask_id", String(data.id));
    }
    formData.append("campaign_id", String(data.campaign_id));
    formData.append("task_name", String(data.task_name));
    formData.append("type_id", String(data.type_id));
    if (data.tag) {
      formData.append("tags[]", String(data.tag));
    }
    if (data.keywords) {
      formData.append("keywords[]", String(data.keywords));
    }

    const tasktyperes = await this._httpClient
      .post("/api/savesocialtask", formData)
      .catch(function (error) {
        throw new Error(error.message);
        // console.error(error);
      });
    if (!tasktyperes) {
      throw new Error("remote return social task type is null");
    }

    return tasktyperes as SaveSocialTaskResponse;
  }

  async createsocialtask(
    socailtaskId: number,
    taskRunNum: string
  ): Promise<SocialTaskRunEntity> {
    const runModel = new SocialTaskRun();
    const socialTaskrun = runModel.createsocialtaskrun(
      socailtaskId,
      taskRunNum
    );
    // const result = await this.runsocialtask(socialTaskrun)
    return socialTaskrun;
  }

  public async runsocialtask(
    entity: SocialTaskRunEntity,
    callback: ((...args: unknown[]) => unknown) | undefined | null
  ) {
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
      dirnameRelativePaths: ["taskCode.js"],
      cwdRelativePaths: [path.join(".vite", "build", "taskCode.js")],
    };
    const childPath = resolvePackagedWorkerPath(runtime, options);
    if (!childPath) {
      const candidates = getPackagedWorkerPathCandidates(runtime, options);
      throw new Error(
        `child js path not exist. Tried: ${candidates.join(", ")}`
      );
    }
    const { port1, port2 } = new MessageChannelMain();

    const child = spawnOwned(
      "social-task",
      () =>
        utilityProcess.fork(
      childPath,
      ["-a", "runtask", "-t", entity.taskrun_num],
      {
        stdio: "pipe",
        execArgv: ["puppeteer-cluster:*"],
        env: buildPackagedWorkerEnv({
          extraEnv: {
            ELECTRON_APP_NAME: app.getName(),
            ELECTRON_USER_DATA_PATH: app.getPath("userData"),
          },
        }),
      }
    )
    );
    trackSocialRun(entity.taskrun_num, child);
    //console.log(path.join(__dirname, 'utilityCode.js'))

    // child.postMessage({ message: 'hello' }, [port1])
    child.on("spawn", () => {
      child.postMessage(JSON.stringify({ message: "hello" }), [port1]);
    });
    child.stdout?.on("data", (data) => {
      if (callback) {
        callback(data.toString());
      }
    });
    child.stderr?.on("data", (data) => {
      if (callback) {
        callback(data.toString());
      }
    });
    child.on("exit", () => {
      console.log(`child process exited `);
    });

    port2.on("message", (e) => {
      port2.postMessage("I receive your messages:");
    });
    port2.start();
    child.on("message", (e) => {
      // Intentionally no console logging here to avoid spamming terminal output.
    });
  }

}

/**
 * FR-06/AC-09 at-exit reconciliation: log an interruption marker for every
 * live run and clear the registry (the entity has no status column; the
 * marker + a fresh taskrun row on the next user-initiated run is the
 * durable semantics — nothing is auto-retried). Returns interrupted ids.
 */
export async function reconcileInterruptedSocialRuns(
  reason: string
): Promise<number[]> {
  const runModel = new SocialTaskRun();
  const interrupted: number[] = [];
  for (const runNum of Array.from(activeSocialRuns.keys())) {
    try {
      const id = await runModel.TaskidbytaskrunNum(runNum);
      if (!id) {
        // Unknown row: still remove the in-memory entry (nothing durable to
        // write to), but do not count it as reconciled.
        activeSocialRuns.delete(runNum);
        continue;
      }
      // T08: DURABLE interruption record — append the marker to the run's
      // own log file (the run entity's log_path), so restart exposes the
      // uncertainty. Only after a successful write do we clear the entry.
      const runLogPath = resolveSocialRunLogPath(runNum);
      WriteLog(
        runLogPath,
        `[INTERRUPTED ${new Date().toISOString()}] ${reason}`
      );
      activeSocialRuns.delete(runNum);
      interrupted.push(id.id);
      log.info(
        `[social] run ${runNum} (task ${id.task_id}) interrupted: ${reason}`
      );
    } catch (err) {
      log.warn(
        `[social] failed to reconcile run ${runNum}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return interrupted;
}

/**
 * T08: the run's durable log file. taskrun_num is unique per run; the runs
 * log lives under the user log path (same convention as the module's own
 * task logs). Falls back to the OS temp dir when no log path is set so the
 * write NEVER silently no-ops.
 */
function resolveSocialRunLogPath(runNum: string): string {
  let base = "";
  try {
    base = new Token().getValue(USERLOGPATH) || "";
  } catch {
    base = "";
  }
  if (!base) {
    base = path.join(os.tmpdir(), "aifetchly-social-runs");
    try {
      fs.mkdirSync(base, { recursive: true });
    } catch {
      /* best-effort dir creation */
    }
  }
  return path.join(base, `socialrun_${encodeURIComponent(runNum)}.log`);
}
