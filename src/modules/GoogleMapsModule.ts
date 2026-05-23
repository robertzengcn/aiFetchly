/**
 * Google Maps Module — orchestration layer shared by AI skill and UI page.
 *
 * Spawns a child process worker (GoogleMapsWorker) to perform Puppeteer-based
 * Google Maps scraping. Manages worker lifecycle, timeouts, and cancellation.
 *
 * Extends BaseModule for future persistence (Phase 4).
 */

import { fork, type ChildProcess } from "child_process";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { BaseModule } from "@/modules/baseModule";
import {
  type GoogleMapsSearchInput,
  type GoogleMapsSearchResult,
  type GoogleMapsBusinessResult,
  type GoogleMapsProgressEvent,
  GOOGLE_MAPS_DEFAULT_MAX_RESULTS,
  GOOGLE_MAPS_HARD_CAP,
} from "@/entityTypes/googleMapsTypes";
import { GoogleMapsSearchRecordModel } from "@/model/GoogleMapsSearchRecord.model";
import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    input: GoogleMapsSearchInput
  ): Promise<GoogleMapsSearchResult> {
    const maxResults = Math.min(
      Math.max(1, input.max_results ?? GOOGLE_MAPS_DEFAULT_MAX_RESULTS),
      GOOGLE_MAPS_HARD_CAP
    );

    return new Promise((resolve, reject) => {
      const requestId = uuidv4();
      const workerPath = this.getWorkerPath();

      let worker: ChildProcess;
      try {
        worker = fork(workerPath, [], {
          stdio: ["inherit", "inherit", "inherit", "ipc"],
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
        worker.kill();
        this.activeSearches.delete(requestId);
        reject(new Error("Google Maps search timed out after 10 minutes"));
      }, GoogleMapsModule.DEFAULT_TIMEOUT_MS);

      const search: ActiveSearch = {
        worker,
        resolve,
        reject,
        timeoutTimer,
      };
      this.activeSearches.set(requestId, search);

      worker.on("message", (msg: Record<string, unknown>) => {
        if (msg.type === "result" && msg.requestId === requestId) {
          clearTimeout(timeoutTimer);
          this.activeSearches.delete(requestId);

          try {
            worker.kill();
          } catch {
            // Worker may already be dead
          }

          const result: GoogleMapsSearchResult =
            msg.success && msg.data
              ? (msg.data as GoogleMapsSearchResult)
              : {
                  success: false,
                  query: input.query,
                  location: input.location,
                  totalResults: 0,
                  summary: `Search failed: ${
                    (msg.error as string) ?? "Unknown error"
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
        clearTimeout(timeoutTimer);
        this.activeSearches.delete(requestId);
        reject(new Error(`Worker error: ${err.message}`));
      });

      worker.on("exit", (code) => {
        if (this.activeSearches.has(requestId)) {
          clearTimeout(timeoutTimer);
          this.activeSearches.delete(requestId);
          reject(new Error(`Worker exited unexpectedly with code ${code}`));
        }
      });

      // Send start command to worker
      worker.send({
        type: "start",
        requestId,
        query: input.query.trim(),
        location: input.location.trim(),
        maxResults,
        includeWebsite: input.include_website ?? true,
        includeReviews: input.include_reviews ?? false,
        showBrowser: input.show_browser ?? false,
      });
    });
  }

  /**
   * Cancel an active search by requestId.
   */
  async cancelSearch(requestId: string): Promise<void> {
    const search = this.activeSearches.get(requestId);
    if (!search) return;

    clearTimeout(search.timeoutTimer);

    try {
      search.worker.send({ type: "cancel", requestId });
    } catch {
      // Worker may already be dead
    }

    // Give worker 2 seconds to handle cancellation gracefully
    setTimeout(() => {
      try {
        search.worker.kill();
      } catch {
        // Already dead
      }
      this.activeSearches.delete(requestId);
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
   * Get the path to the Google Maps worker entry point.
   * In production, the worker is built to the output directory.
   */
  private getWorkerPath(): string {
    return path.join(__dirname, "google-maps", "GoogleMapsWorker.js");
  }
}
