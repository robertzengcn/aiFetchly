/**
 * Yandex Maps Module -- orchestration layer shared by AI skill and UI page.
 *
 * Spawns a child process worker (YandexMapsWorker) with IPC to perform Puppeteer-based
 * Yandex Maps scraping. Manages worker lifecycle, timeouts, and cancellation.
 *
 * Extends BaseModule for consistency, though v1.2 has no database persistence.
 */

import { app } from "electron";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { BaseModule } from "@/modules/baseModule";
import {
  type YandexMapsSearchInput,
  type YandexMapsSearchResult,
  type YandexMapsProgressEvent,
  type YandexMapsProgressStatus,
  type YandexMapsBusinessResult,
  YANDEX_MAPS_DEFAULT_MAX_RESULTS,
  YANDEX_MAPS_HARD_CAP,
} from "@/entityTypes/yandexMapsTypes";
import type { YellowPagesTaskProxyConfig } from "@/entityTypes/yellowPagesTaskProxyType";
import { YandexMapsSearchRecordModel } from "@/model/YandexMapsSearchRecord.model";
import type { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import type { ModuleExecutionContext } from "@/entityTypes/skillTypes";
import { ToolExecutor } from "@/service/ToolExecutor";

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

const YANDEX_MAPS_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "validating",
  "launching",
  "loading",
  "extracting",
  "completed",
  "cancelled",
  "failed",
  "captcha",
  "timed_out",
]);

function parseYandexMapsProgressEvent(
  data: Record<string, unknown>
): YandexMapsProgressEvent | null {
  if (typeof data.requestId !== "string") {
    return null;
  }
  if (
    typeof data.status !== "string" ||
    !YANDEX_MAPS_PROGRESS_STATUSES.has(data.status)
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
    status: data.status as YandexMapsProgressStatus,
    current: data.current,
    total: data.total,
    message: data.message,
  };
}

/** Messages sent to the Yandex Maps child process over IPC. */
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
      language?: string;
      region?: string;
      cookies?: unknown[];
      proxies?: YellowPagesTaskProxyConfig[];
    }
  | { type: "cancel"; requestId: string };

/** Tracks an active search session. */
interface ActiveSearch {
  worker: ChildProcess;
  resolve: (result: YandexMapsSearchResult) => void;
  reject: (error: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  progressCallback?: (event: YandexMapsProgressEvent) => void;
}

/** Options for customizing executeSearch behavior (used by IPC handler). */
export interface YandexMapsExecuteOptions {
  /** External request ID to use instead of generating one internally. */
  externalRequestId?: string;
  /** Callback invoked on each progress event from the worker. */
  onProgress?: (event: YandexMapsProgressEvent) => void;
  /** Optional browser cookies for authenticated scraping. */
  cookies?: unknown[];
  /** Optional proxy configs for IP rotation. */
  proxies?: YellowPagesTaskProxyConfig[];
  /**
   * Optional execution context for progress emission and partial-snapshot
   * registration. When provided, worker `progress` messages are forwarded
   * to `context.emitProgress` and the partial snapshot is kept up to date
   * via `ToolExecutor.updatePartialSnapshot`.
   */
  context?: ModuleExecutionContext;
}

// ---------------------------------------------------------------------------
// YandexMapsModule
// ---------------------------------------------------------------------------

export class YandexMapsModule extends BaseModule {
  private activeSearches = new Map<string, ActiveSearch>();
  private recordModel: YandexMapsSearchRecordModel;
  private static readonly DEFAULT_TIMEOUT_MS = 600000; // 10 minutes

  constructor() {
    super();
    this.recordModel = new YandexMapsSearchRecordModel(this.dbpath);
  }

  /**
   * Execute a Yandex Maps search synchronously (blocks until complete or timeout).
   * Used by ToolExecutor for AI skill invocation.
   */
  async executeSearch(
    input: YandexMapsSearchInput,
    options?: YandexMapsExecuteOptions
  ): Promise<YandexMapsSearchResult> {
    const maxResults = Math.min(
      Math.max(1, input.max_results ?? YANDEX_MAPS_DEFAULT_MAX_RESULTS),
      YANDEX_MAPS_HARD_CAP
    );

    return new Promise((resolve, reject) => {
      const requestId = options?.externalRequestId ?? uuidv4();

      let worker: ChildProcess;
      try {
        const resolvedWorkerPath = this.resolveWorkerPath();
        if (!fs.existsSync(resolvedWorkerPath)) {
          throw new Error(
            `Yandex Maps worker not found at ${resolvedWorkerPath}. ` +
              `Run \`yarn make\` or restart \`yarn dev\` to build dist/childprocess/yandex-maps/YandexMapsWorker.js.`
          );
        }
        // child_process.spawn + ipc stdio (utilityProcess.fork rejects piped stdin with ipc)
        worker = spawn(process.execPath, [resolvedWorkerPath], {
          stdio: ["pipe", "pipe", "pipe", "ipc"],
          env: {
            ...process.env,
            NODE_OPTIONS: "",
            ELECTRON_RUN_AS_NODE: "1",
            ELECTRON_APP_NAME: app.getName(),
            ELECTRON_USER_DATA_PATH: app.getPath("userData"),
          },
        });
      } catch (err) {
        reject(
          new Error(
            `Failed to spawn Yandex Maps worker: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
        return;
      }

      const timeoutTimer = setTimeout(() => {
        this.activeSearches.delete(requestId);
        worker.kill();
        reject(new Error("Yandex Maps search timed out after 10 minutes"));
      }, YandexMapsModule.DEFAULT_TIMEOUT_MS);

      const search: ActiveSearch = {
        worker,
        resolve,
        reject,
        timeoutTimer,
        progressCallback: options?.onProgress,
      };
      this.activeSearches.set(requestId, search);

      worker.on("message", (raw: unknown) => {
        const data = parseWorkerMessage(raw);
        if (!data) return;
        if (data.type === "progress" && data.requestId === requestId) {
          const progress = parseYandexMapsProgressEvent(data);
          if (search.progressCallback && progress) {
            search.progressCallback(progress);
          }
          // Forward to execution context (AI tool-progress pipeline)
          if (options?.context && progress) {
            this.emitContextProgress(options.context, progress);
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

          const result: YandexMapsSearchResult =
            data.success && data.data
              ? (data.data as YandexMapsSearchResult)
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
              "[YandexMaps] Failed to save search result:",
              saveErr
            );
          });

          resolve(result);
        }
      });

      worker.on("error", (err) => {
        console.error("[YandexMaps] Worker process error:", err.message);
        clearTimeout(timeoutTimer);
        this.activeSearches.delete(requestId);
        reject(new Error(`Worker error: ${err.message}`));
      });

      worker.on("exit", (code) => {
        if (this.activeSearches.has(requestId)) {
          console.error(
            `[YandexMaps] Worker exited unexpectedly with code ${code}`
          );
          clearTimeout(timeoutTimer);
          this.activeSearches.delete(requestId);
          reject(new Error(`Worker exited unexpectedly with code ${code}`));
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
        language: input.language,
        region: input.region,
        cookies: options?.cookies,
        proxies: options?.proxies,
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
    // the Puppeteer Chrome process. Then force-kill if it doesn't exit.
    try {
      const workerPid = search.worker.pid;
      search.worker.kill("SIGTERM");

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
    results: YandexMapsBusinessResult[]
  ): Promise<YandexMapsSearchRecordEntity> {
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
  ): Promise<[YandexMapsSearchRecordEntity[], number]> {
    await this.ensureConnection();
    return await this.recordModel.findAll(limit, offset);
  }

  async getSearchRecord(
    id: number
  ): Promise<YandexMapsSearchRecordEntity | null> {
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
    progress: YandexMapsProgressEvent
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
        data: { results: [] },
      });
    }
  }

  /** Map worker status string to the unified progress phase vocabulary. */
  private mapStatusToPhase(
    status: YandexMapsProgressStatus
  ): "queued" | "running" | "fetching" | "extracting" | "finalizing" {
    switch (status) {
      case "idle":
      case "validating":
        return "queued";
      case "launching":
      case "loading":
        return "fetching";
      case "extracting":
        return "extracting";
      case "completed":
      case "cancelled":
      case "failed":
      case "captcha":
      case "timed_out":
        return "finalizing";
      default:
        return "running";
    }
  }

  /**
   * Resolve the Yandex Maps worker entry script (built by Forge / vite.yandexMapsWorker).
   */
  private resolveWorkerPath(): string {
    const candidates = [
      path.join(__dirname, "../childprocess/yandex-maps/YandexMapsWorker.js"),
      path.join(
        process.cwd(),
        "dist/childprocess/yandex-maps/YandexMapsWorker.js"
      ),
      path.join(__dirname, "YandexMapsWorker.js"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `Yandex Maps worker file not found. Tried: ${candidates.join(", ")}`
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
      "Yandex Maps worker IPC is unavailable. Restart the app after `yarn make` so the worker is built."
    );
  }
}
