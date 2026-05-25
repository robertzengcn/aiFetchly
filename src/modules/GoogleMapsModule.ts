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
   */
  async executeSearch(
    input: GoogleMapsSearchInput,
    cookies?: unknown[],
    proxies?: YellowPagesTaskProxyConfig[]
  ): Promise<GoogleMapsSearchResult> {
    const maxResults = Math.min(
      Math.max(1, input.max_results ?? GOOGLE_MAPS_DEFAULT_MAX_RESULTS),
      GOOGLE_MAPS_HARD_CAP
    );

    return new Promise((resolve, reject) => {
      const requestId = uuidv4();

      let worker: ChildProcess;
      try {
        const resolvedWorkerPath = this.resolveWorkerPath();
        if (!fs.existsSync(resolvedWorkerPath)) {
          throw new Error(
            `Google Maps worker not found at ${resolvedWorkerPath}. ` +
              `Run \`yarn make\` or restart \`yarn dev\` to build dist/childprocess/google-maps/GoogleMapsWorker.js.`
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
            `Failed to spawn Google Maps worker: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
        return;
      }

      const timeoutTimer = setTimeout(() => {
        this.activeSearches.delete(requestId);
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
        const data = parseWorkerMessage(raw);
        if (!data) return;
        if (data.type === "progress" && data.requestId === requestId) {
          const progress = parseGoogleMapsProgressEvent(data);
          if (search.progressCallback && progress) {
            search.progressCallback(progress);
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
        console.error("[GoogleMaps] Worker process error:", err.message);
        clearTimeout(timeoutTimer);
        this.activeSearches.delete(requestId);
        reject(new Error(`Worker error: ${err.message}`));
      });

      worker.on("exit", (code) => {
        if (this.activeSearches.has(requestId)) {
          console.error(
            `[GoogleMaps] Worker exited unexpectedly with code ${code}`
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
      this.sendToWorker(search.worker, { type: "cancel", requestId });
    } catch {
      // Worker may already be dead
    }

    // Give worker 2 seconds to handle cancellation gracefully, then kill
    setTimeout(() => {
      try {
        search.worker.kill();
      } catch {
        // Already dead
      }
    }, 2000);
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
   * Resolve the Google Maps worker entry script (built by Forge / vite.googleMapsWorker).
   */
  private resolveWorkerPath(): string {
    const candidates = [
      path.join(__dirname, "../childprocess/google-maps/GoogleMapsWorker.js"),
      path.join(
        process.cwd(),
        "dist/childprocess/google-maps/GoogleMapsWorker.js"
      ),
      path.join(__dirname, "GoogleMapsWorker.js"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

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
