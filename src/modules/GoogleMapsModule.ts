/**
 * Google Maps Module — orchestration layer shared by AI skill and UI page.
 *
 * Spawns a child process worker (GoogleMapsWorker) with IPC to perform Puppeteer-based
 * Google Maps scraping. Manages worker lifecycle, timeouts, and cancellation.
 *
 * Extends BaseModule for persistence.
 */

import { app } from "electron";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { BaseModule } from "@/modules/baseModule";
import {
  type GoogleMapsSearchInput,
  type GoogleMapsSearchResult,
  type GoogleMapsBusinessResult,
  type GoogleMapsProgressEvent,
  type GoogleMapsProgressStatus,
  GOOGLE_MAPS_DEFAULT_MAX_RESULTS,
  GOOGLE_MAPS_HARD_CAP,
} from "@/entityTypes/googleMapsTypes";
import { GoogleMapsSearchRecordModel } from "@/model/GoogleMapsSearchRecord.model";
import type { YellowPagesTaskProxyConfig } from "@/entityTypes/yellowPagesTaskProxyType";
import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { ModuleExecutionContext } from "@/entityTypes/skillTypes";
import { ToolExecutor } from "@/service/ToolExecutor";
import {
  getPackagedWorkerNodePath,
  getPackagedWorkerPathCandidates,
  resolvePackagedWorkerPath,
  type PackagedWorkerPathRuntime,
} from "@/utils/packagedWorkerPath";
import { formatGoogleMapsWorkerExitDiagnostic } from "@/utils/googleMapsWorkerDiagnostics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

function parseWorkerMessage(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return raw as Record<string, unknown>;
}

const GOOGLE_MAPS_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "validating",
  "launching",
  "navigating",
  "loading",
  "extracting",
  "completed",
  "cancelled",
  "failed",
  "timed_out",
]);

function parseGoogleMapsProgressEvent(
  data: Record<string, unknown>
): GoogleMapsProgressEvent | null {
  if (typeof data.requestId !== "string") {
    return null;
  }
  if (
    typeof data.status !== "string" ||
    !GOOGLE_MAPS_PROGRESS_STATUSES.has(data.status)
  ) {
    return null;
  }
  if (typeof data.current !== "number" || typeof data.total !== "number") {
    return null;
  }
  if (typeof data.message !== "string") {
    return null;
  }
  return {
    requestId: data.requestId,
    status: data.status as GoogleMapsProgressStatus,
    current: data.current,
    total: data.total,
    message: data.message,
  };
}

/** Messages sent to the Google Maps child process over IPC. */
type WorkerOutboundPayload =
  | {
      type: "start";
      requestId: string;
      query: string;
      location: string;
      maxResults: number;
      includeWebsite: boolean;
      includeReviews: boolean;
      showBrowser: boolean;
      cookies?: unknown[];
      proxies?: YellowPagesTaskProxyConfig[];
    }
  | { type: "cancel"; requestId: string };

/** Tracks an active search session. */
interface ActiveSearch {
  worker: ChildProcess;
  resolve: (result: GoogleMapsSearchResult) => void;
  reject: (error: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  progressCallback?: (event: GoogleMapsProgressEvent) => void;
}

// ---------------------------------------------------------------------------
// GoogleMapsModule
// ---------------------------------------------------------------------------

export class GoogleMapsModule extends BaseModule {
  private activeSearches = new Map<string, ActiveSearch>();
  private recordModel: GoogleMapsSearchRecordModel;
  private static readonly DEFAULT_TIMEOUT_MS = 600000; // 10 minutes

  constructor() {
    super();
    this.recordModel = new GoogleMapsSearchRecordModel(this.dbpath);
  }

  /**
   * Execute a Google Maps search synchronously (blocks until complete or timeout).
   * Used by ToolExecutor for AI skill invocation.
   *
   * @param input Search parameters
   * @param cookies Optional browser cookies
   * @param proxies Optional proxy configurations
   * @param externalRequestId Optional request ID from caller (e.g. IPC handler).
   *        When provided, this ID is used for activeSearches so cancelSearch()
   *        can find and kill the worker. When omitted, a new UUID is generated.
   * @param context Optional execution context for progress emission and
   *        partial-snapshot registration. When provided, worker `progress`
   *        messages are forwarded to `context.emitProgress` and the partial
   *        snapshot is kept up to date via `ToolExecutor.updatePartialSnapshot`.
   */
  async executeSearch(
    input: GoogleMapsSearchInput,
    cookies?: unknown[],
    proxies?: YellowPagesTaskProxyConfig[],
    externalRequestId?: string,
    context?: ModuleExecutionContext
  ): Promise<GoogleMapsSearchResult> {
    const maxResults = Math.min(
      Math.max(1, input.max_results ?? GOOGLE_MAPS_DEFAULT_MAX_RESULTS),
      GOOGLE_MAPS_HARD_CAP
    );

    return new Promise((resolve, reject) => {
      const requestId = externalRequestId ?? uuidv4();

      let worker: ChildProcess;
      try {
        const resolvedWorkerPath = this.resolveWorkerPath();
        if (!fs.existsSync(resolvedWorkerPath)) {
          throw new Error(
            `Google Maps worker not found at ${resolvedWorkerPath}. ` +
              `Run yarn make or restart yarn dev to rebuild GoogleMapsWorker.js.`
          );
        }
        // child_process.spawn + ipc stdio (utilityProcess.fork rejects piped stdin with ipc).
        // In packaged apps the worker lives under app.asar.unpacked/.vite/build/, which makes
        // Node's default module resolution walk the unpacked tree and miss deps that live
        // inside the packed app.asar/node_modules (e.g. puppeteer). getPackagedWorkerNodePath
        // appends app.asar/node_modules + app.asar.unpacked/node_modules as a NODE_PATH
        // fallback so bare `require("puppeteer")` resolves. Mirrors YellowPagesProcessManager.
        const electronProcess = process as NodeJS.Process & {
          resourcesPath?: string;
        };
        const workerNodePath = electronProcess.resourcesPath
          ? getPackagedWorkerNodePath(
              electronProcess.resourcesPath,
              process.env.NODE_PATH
            )
          : process.env.NODE_PATH;
        const workerEnv = {
          ...process.env,
          NODE_OPTIONS: "",
          NODE_PATH: workerNodePath,
          ELECTRON_RUN_AS_NODE: "1",
          ELECTRON_APP_NAME: app.getName(),
          ELECTRON_USER_DATA_PATH: app.getPath("userData"),
        };
        console.debug(
          `[GoogleMaps] Spawning worker: path=${resolvedWorkerPath}, cwd=${process.cwd()}, nodePath=${String(
            workerNodePath
          )}`
        );
        worker = spawn(process.execPath, [resolvedWorkerPath], {
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          env: workerEnv,
        });
      } catch (err) {
        reject(
          new Error(
            `Failed to spawn Google Maps worker: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
        return;
      }

      let workerStdout = "";
      let workerStderr = "";
      const appendWorkerOutput = (current: string, chunk: Buffer): string =>
        `${current}${chunk.toString("utf8")}`.slice(-8000);

      worker.stdout?.on("data", (chunk: Buffer) => {
        workerStdout = appendWorkerOutput(workerStdout, chunk);
        console.debug(
          `[GoogleMaps] Worker stdout (${requestId}): ${chunk
            .toString("utf8")
            .trimEnd()}`
        );
      });
      worker.stderr?.on("data", (chunk: Buffer) => {
        workerStderr = appendWorkerOutput(workerStderr, chunk);
        console.error(
          `[GoogleMaps] Worker stderr (${requestId}): ${chunk
            .toString("utf8")
            .trimEnd()}`
        );
      });

      console.debug(
        `[GoogleMaps] Worker spawned: requestId=${requestId}, pid=${String(
          worker.pid
        )}, execPath=${process.execPath}`
      );

      const timeoutTimer = setTimeout(() => {
        this.activeSearches.delete(requestId);
        console.error(
          `[GoogleMaps] Worker timed out: requestId=${requestId}, pid=${String(
            worker.pid
          )}`
        );
        worker.kill();
        reject(new Error("Google Maps search timed out after 10 minutes"));
      }, GoogleMapsModule.DEFAULT_TIMEOUT_MS);

      const search: ActiveSearch = {
        worker,
        resolve,
        reject,
        timeoutTimer,
      };
      this.activeSearches.set(requestId, search);

      worker.on("message", (raw: unknown) => {
        console.debug(
          `[GoogleMaps] Worker message (${requestId}): ${JSON.stringify(raw)}`
        );
        const data = parseWorkerMessage(raw);
        if (!data) {
          console.warn(
            `[GoogleMaps] Ignoring invalid worker message (${requestId})`
          );
          return;
        }
        if (data.type === "progress" && data.requestId === requestId) {
          const progress = parseGoogleMapsProgressEvent(data);
          if (search.progressCallback && progress) {
            search.progressCallback(progress);
          }
          // Forward to execution context (AI tool-progress pipeline)
          if (context && progress) {
            this.emitContextProgress(context, progress);
          }
          return;
        }
        if (data.type === "result" && data.requestId === requestId) {
          // Skip if already handled (e.g. cancelled)
          if (!this.activeSearches.has(requestId)) return;

          clearTimeout(timeoutTimer);
          this.activeSearches.delete(requestId);

          try {
            worker.kill();
          } catch {
            // Worker may already be dead
          }

          const result: GoogleMapsSearchResult =
            data.success && data.data
              ? (data.data as GoogleMapsSearchResult)
              : {
                  success: false,
                  query: input.query,
                  location: input.location,
                  totalResults: 0,
                  summary: `Search failed: ${
                    (data.error as string) ?? "Unknown error"
                  }`,
                  results: [],
                };

          this.saveSearchResult(
            result.query,
            result.location,
            result.success ? "completed" : "failed",
            result.totalResults,
            result.summary,
            result.results
          ).catch((saveErr: unknown) => {
            console.error(
              "[GoogleMaps] Failed to save search result:",
              saveErr
            );
          });

          resolve(result);
        }
      });

      worker.on("error", (err) => {
        console.error(
          `[GoogleMaps] Worker process error (${requestId}, pid=${String(
            worker.pid
          )}):`,
          err
        );
        clearTimeout(timeoutTimer);
        this.activeSearches.delete(requestId);
        reject(new Error(`Worker error: ${err.message}`));
      });

      worker.on("exit", (code, signal) => {
        if (this.activeSearches.has(requestId)) {
          const diagnostic = formatGoogleMapsWorkerExitDiagnostic({
            code,
            signal,
            stderr: workerStderr,
            stdout: workerStdout,
          });
          console.error(
            `[GoogleMaps] Worker exited unexpectedly (${requestId}, pid=${String(
              worker.pid
            )}): ${diagnostic}`
          );
          clearTimeout(timeoutTimer);
          this.activeSearches.delete(requestId);
          reject(
            new Error(
              `Worker exited unexpectedly with code ${String(
                code
              )}. ${diagnostic}`
            )
          );
        } else {
          console.debug(
            `[GoogleMaps] Worker exited after request completion (${requestId}): code=${String(
              code
            )}, signal=${String(signal)}`
          );
        }
      });

      // Send start command to worker
      this.sendToWorker(worker, {
        type: "start",
        requestId,
        query: input.query.trim(),
        location: input.location.trim(),
        maxResults,
        includeWebsite: input.include_website ?? true,
        includeReviews: input.include_reviews ?? false,
        showBrowser: input.show_browser ?? false,
        cookies,
        proxies,
      });
    });
  }

  /**
   * Cancel an active search by requestId.
   */
  async cancelSearch(requestId: string): Promise<void> {
    const search = this.activeSearches.get(requestId);
    if (!search) return;

    // Delete from map first to prevent double resolve/reject
    this.activeSearches.delete(requestId);
    clearTimeout(search.timeoutTimer);

    // Reject the promise so the caller knows it was cancelled
    search.reject(new Error("Search cancelled by user"));

    try {
      // Send cancel signal so worker can close browser and exit gracefully
      this.sendToWorker(search.worker, { type: "cancel", requestId });
    } catch {
      // Worker may already be dead
    }

    // Use SIGTERM (catchable) so the worker's SIGTERM handler can close
    // the Puppeteer Chrome process. SIGKILL is uncatchable and would
    // orphan the Chrome child process.
    try {
      const workerPid = search.worker.pid;
      search.worker.kill("SIGTERM");

      // Force-kill fallback if the worker doesn't exit within 3 seconds
      if (workerPid) {
        setTimeout(() => {
          try {
            process.kill(workerPid, 0); // check if alive
            process.kill(workerPid, "SIGKILL");
          } catch {
            // Already dead — good
          }
        }, 3000).unref();
      }
    } catch {
      // Already dead
    }
  }

  async saveSearchResult(
    query: string,
    location: string,
    status: string,
    totalResults: number,
    summary: string,
    results: GoogleMapsBusinessResult[]
  ): Promise<GoogleMapsSearchRecordEntity> {
    await this.ensureConnection();
    return await this.recordModel.create({
      query,
      location,
      status,
      totalResults,
      summary,
      results: JSON.stringify(results),
    });
  }

  async getSearchHistory(
    limit = 50,
    offset = 0
  ): Promise<[GoogleMapsSearchRecordEntity[], number]> {
    await this.ensureConnection();
    return await this.recordModel.findAll(limit, offset);
  }

  async getSearchRecord(
    id: number
  ): Promise<GoogleMapsSearchRecordEntity | null> {
    await this.ensureConnection();
    return await this.recordModel.findById(id);
  }

  async deleteSearchRecord(id: number): Promise<boolean> {
    await this.ensureConnection();
    return await this.recordModel.deleteById(id);
  }

  /**
   * Translate a worker progress event into the context's progress pipeline
   * and update the partial snapshot so the timeout branch can return
   * whatever was collected so far.
   */
  private emitContextProgress(
    context: ModuleExecutionContext,
    progress: GoogleMapsProgressEvent
  ): void {
    const phase = this.mapStatusToPhase(progress.status);
    context.emitProgress?.({
      phase,
      message: progress.message,
      partialCount: progress.current,
      expectedCount: progress.total,
    });
    if (progress.current > 0) {
      // NOTE: Worker files (src/childprocess/) do not yet stream incremental business
      // data in their `progress` IPC messages. Until they do (deferred Step 9.5),
      // `collectedCount` is accurate but `data.results` remains empty. The model
      // still receives a partial-success signal with the count.
      ToolExecutor.updatePartialSnapshot(context.toolCallId, {
        collectedCount: progress.current,
        expectedCount: progress.total,
        data: { results: [] }, // Worker fills data on result, not on progress
      });
    }
  }

  /** Map worker status string to the unified progress phase vocabulary. */
  private mapStatusToPhase(
    status: GoogleMapsProgressStatus
  ): "queued" | "running" | "fetching" | "extracting" | "finalizing" {
    switch (status) {
      case "idle":
      case "validating":
        return "queued";
      case "launching":
      case "navigating":
      case "loading":
        return "fetching";
      case "extracting":
        return "extracting";
      case "completed":
      case "cancelled":
      case "failed":
      case "timed_out":
        return "finalizing";
      default:
        return "running";
    }
  }

  /**
   * Resolve the Google Maps worker entry script (built by Forge / vite.googleMapsWorker).
   */
  private resolveWorkerPath(): string {
    const electronProcess = process as NodeJS.Process & {
      resourcesPath?: string;
    };
    const runtime: PackagedWorkerPathRuntime = {
      dirname: __dirname,
      cwd: process.cwd(),
      resourcesPath: electronProcess.resourcesPath,
      existsSync: fs.existsSync,
    };
    const options = {
      dirnameRelativePaths: [
        "GoogleMapsWorker.js",
        path.join("..", "childprocess", "google-maps", "GoogleMapsWorker.js"),
      ],
      cwdRelativePaths: [
        path.join(".vite", "build", "GoogleMapsWorker.js"),
        path.join(".vite", "build", "childprocess", "GoogleMapsWorker.js"),
        path.join("dist", "GoogleMapsWorker.js"),
        path.join("dist", "childprocess", "GoogleMapsWorker.js"),
        path.join("dist", "childprocess", "google-maps", "GoogleMapsWorker.js"),
      ],
    };
    const resolvedPath = resolvePackagedWorkerPath(runtime, options);
    if (resolvedPath) {
      return resolvedPath;
    }

    const candidates = getPackagedWorkerPathCandidates(runtime, options);
    throw new Error(
      `Google Maps worker file not found. Tried: ${candidates.join(", ")}`
    );
  }

  private sendToWorker(
    worker: ChildProcess,
    payload: WorkerOutboundPayload
  ): void {
    if (typeof worker.send === "function") {
      worker.send(payload);
      return;
    }
    throw new Error(
      "Google Maps worker IPC is unavailable. Restart the app after `yarn make` so the worker is built."
    );
  }
}
