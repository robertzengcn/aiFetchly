/**
 * Contact Extraction IPC Handlers
 *
 * Handles IPC communication between renderer process and main process
 * for contact extraction functionality.
 */

import { ipcMain, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { ContactInfoModule } from "@/modules/ContactInfoModule";
import {
  START_CONTACT_EXTRACTION,
  CONTACT_EXTRACTION_PROGRESS,
  GET_CONTACT_INFO,
  RETRY_CONTACT_EXTRACTION,
} from "@/config/channellist";
import { log } from "@/modules/Logger";
import { Token } from "@/modules/token";
import { TOKENNAME, USER_AI_ENABLED } from "@/config/usersetting";
import type { ModuleExecutionContext } from "@/entityTypes/skillTypes";
import { ToolExecutor } from "@/service/ToolExecutor";
import {
  contactExtractionWorkerOutboundSchema,
  type ContactExtractionWorkerOutbound,
} from "@/schemas/worker/contactExtraction";
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

// WS-1 R1.5: Zod schema for the {resultIds} request (replaces JSON.parse + as).
const contactExtractionRequestSchema = lazySchema(() =>
  z.object({ resultIds: z.array(z.number()).min(1) })
);
import {
  UrlExtractionCollector,
  type UrlContactExtractionOutcome,
  type UrlContactExtractionResult,
} from "./urlExtractionCollector";

// Re-export the URL-extraction result/outcome types so existing import sites
// (`@/main-process/communication/contactExtraction-ipc`) keep resolving. The
// canonical definitions now live in urlExtractionCollector.ts so the
// settlement logic can be unit-tested in isolation.
export type { UrlContactExtractionResult, UrlContactExtractionOutcome };

// Type for IPC request with resultIds
interface ContactExtractionRequest {
  resultIds: number[];
}

// Type for worker messages (from worker to main) — replaced by shared schema.
// The discriminated union in contactExtractionWorkerOutboundSchema narrows
// automatically inside switch(msg.type), eliminating the loose index-signature
// that previously allowed silent field drift.

/** Result item for URL-only contact extraction (AI tool) — defined in
 * urlExtractionCollector.ts and re-exported above. */

/** Pending URL extraction requests: requestId -> collector that gathers
 * per-URL results and settles (resolve-with-partials on timeout, or reject
 * only when zero results were collected). */
const pendingUrlExtractions = new Map<string, UrlExtractionCollector>();

const URL_EXTRACTION_TIMEOUT_MS = 300000; // 5 minutes total for all URLs

// Worker process reference
let contactExtractionWorker: ChildProcess | null = null;

/**
 * Spawn the contact extraction worker process
 */
function spawnWorker(): ChildProcess {
  // Use compiled JS file from .vite/build directory
  // __dirname already points to .vite/build, so just append the filename
  const workerPath = path.join(__dirname, "ContactExtractionWorker.js");

  console.log("Spawning contact extraction worker...");

  // Read auth token and AI-enabled flag from main process context
  // and pass to worker via env vars. Worker processes cannot access
  // Electron's app API (used by ElectronStoreService/Token), so we
  // must provide these values from the main process.
  let workerAuthToken = "";
  let workerAiEnabled = "false";
  try {
    const tokenService = new Token();
    workerAuthToken = tokenService.getValue(TOKENNAME) || "";
    workerAiEnabled = tokenService.getValue(USER_AI_ENABLED) || "false";
  } catch (error) {
    console.warn("Failed to read token for worker:", error);
  }

  const worker = spawn("node", [workerPath], {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      WORKER_TYPE: "contact-extraction",
      WORKER_AUTH_TOKEN: workerAuthToken,
      WORKER_AI_ENABLED: workerAiEnabled,
    },
  });

  // Handle worker output
  worker.stdout?.on("data", (data) => {
    console.log(`Worker stdout: ${data}`);
  });

  worker.stderr?.on("data", (data) => {
    console.error(`Worker stderr: ${data}`);
  });

  // Handle worker crashes
  worker.on("exit", (code, signal) => {
    console.log(`Worker exited with code ${code}, signal ${signal}`);
    if (code !== 0 && code !== null && contactExtractionWorker) {
      console.error("Contact extraction worker crashed, restarting...");
      setTimeout(() => {
        contactExtractionWorker = spawnWorker();
        setupWorkerHandlers();
      }, 5000);
    }
  });

  // Handle worker messages — validated against the shared outbound schema.
  // Malformed messages are dropped with a warn log. The discriminated union
  // narrows message.type automatically inside each branch, eliminating the
  // previous `as any` casts on resultId/status/data/etc.
  worker.on("message", async (raw: unknown) => {
    const parsed = contactExtractionWorkerOutboundSchema().safeParse(raw);
    if (!parsed.success) {
      log.warn(
        `[contact-extraction-worker] dropped malformed outbound message: ${parsed.error.message}`
      );
      return;
    }

    const message = parsed.data;
    switch (message.type) {
      case "worker-ready":
        console.log("Contact extraction worker is ready");
        break;
      case "worker-log": {
        // level/args have .default() in schema so they're always present here
        const logMethod = log[message.level];
        if (typeof logMethod === "function") {
          logMethod(...message.args);
        }
        break;
      }
      case "extraction-progress":
        await handleWorkerProgress(message);
        break;
      case "extract-contact-url-result":
        handleUrlExtractionResult(message);
        break;
    }
  });

  return worker;
}

/**
 * Setup worker message handlers
 */
function setupWorkerHandlers(): void {
  if (!contactExtractionWorker) return;

  // Worker message handling is done in the spawnWorker function
}

/**
 * Ensure worker is started (lazy initialization)
 */
function ensureWorkerStarted(): void {
  if (!contactExtractionWorker || contactExtractionWorker.killed) {
    console.log("Lazy-initializing contact extraction worker...");
    contactExtractionWorker = spawnWorker();
  }
}

/**
 * Handle a single URL extraction result from worker (AI tool flow).
 *
 * Narrowed variant of ContactExtractionWorkerOutbound. Worker emits one
 * message per URL (not a batch); all messages sharing a requestId resolve
 * the same pending promise when the count reaches `total`.
 */
function handleUrlExtractionResult(
  message: Extract<
    ContactExtractionWorkerOutbound,
    { type: "extract-contact-url-result" }
  >
): void {
  const collector = pendingUrlExtractions.get(message.requestId);
  if (!collector) return;

  const done = collector.addResult({
    url: message.url,
    success: message.success,
    data: message.data,
    error: message.error,
  });
  if (done) {
    pendingUrlExtractions.delete(message.requestId);
  }
}

/**
 * Extract contact information from URLs via the worker (no DB write).
 * Used by the AI tool extract_contact_info.
 *
 * Settles when every URL has reported, the 5-minute deadline fires, or the
 * worker is unavailable. On a partial deadline (some URLs reported), the
 * promise RESOLVES with the partial set (outcome.timedOut === true) so the
 * model still receives the contacts that were collected — instead of the
 * opaque "Contact extraction timed out" error that previously discarded
 * everything. Only a zero-result deadline rejects.
 */
export async function extractContactFromUrls(
  urls: string[],
  context?: ModuleExecutionContext
): Promise<UrlContactExtractionOutcome> {
  const validUrls = urls.filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  if (validUrls.length === 0) {
    return { results: [], expectedTotal: 0, timedOut: false };
  }

  const requestId = uuidv4();
  const collector = new UrlExtractionCollector({
    total: validUrls.length,
    timeoutMs: URL_EXTRACTION_TIMEOUT_MS,
    onResult: (_result, accumulated, collected, expected) => {
      // Forward progress + a partial snapshot to the execution context. The
      // snapshot is the sync-path timeout recovery path: if the outer 240s
      // browser ceiling fires before this collector settles, the query loop
      // reads it and returns whatever was collected instead of a hard error.
      if (!context) return;
      const phase = collected >= expected ? "finalizing" : "extracting";
      context.emitProgress?.({
        phase,
        message: `Extracted ${collected} of ${expected} contacts`,
        partialCount: collected,
        expectedCount: expected,
      });
      if (context.toolCallId) {
        ToolExecutor.updatePartialSnapshot(context.toolCallId, {
          collectedCount: collected,
          expectedCount: expected,
          data: {
            success: true,
            partial: true,
            collectedCount: collected,
            expectedCount: expected,
            results: accumulated,
            message: `Collected ${collected} of ${expected} contact results before the timeout ceiling fired.`,
          },
        });
      }
    },
  });
  pendingUrlExtractions.set(requestId, collector);

  // Drop the registry entry on settlement (success, partial, or reject) so
  // the map cannot leak. Late worker results for this requestId are ignored.
  const cleanup = (): void => {
    pendingUrlExtractions.delete(requestId);
  };
  collector.promise.then(cleanup, cleanup);

  ensureWorkerStarted();
  if (contactExtractionWorker?.send) {
    contactExtractionWorker.send({
      type: "extract-contact-from-urls",
      requestId,
      urls: validUrls,
    });
  } else {
    pendingUrlExtractions.delete(requestId);
    collector.rejectWithError(
      new Error("Contact extraction worker is not available")
    );
  }

  return collector.promise;
}

/**
 * Handle worker progress updates and save to database.
 *
 * Narrowed variant of ContactExtractionWorkerOutbound. The schema's status
 * enum is 'running'|'completed'|'failed'; the DB layer accepts the wider
 * 'pending'|'analyzing'|'completed'|'failed' union, so we cast through
 * unknown at the call site.
 */
async function handleWorkerProgress(
  progress: Extract<
    ContactExtractionWorkerOutbound,
    { type: "extraction-progress" }
  >
): Promise<void> {
  const { resultId, status, data } = progress;
  const dataTyped = data as
    | {
        emails?: string[];
        phones?: string[];
        address?: string;
        socialLinks?: string[];
      }
    | undefined;
  const error = (progress as { error?: string }).error;

  try {
    // Use ContactInfoModule to save/update data in database
    const module = new ContactInfoModule();

    // Update status (and extraction_error when failed)
    await module.updateExtractionStatus(
      resultId,
      status as "pending" | "analyzing" | "completed" | "failed",
      error
    );

    // If extraction completed and we have data, save it
    if (status === "completed" && dataTyped) {
      await module.saveContactExtractionResult(resultId, {
        email: dataTyped.emails?.[0] || null,
        phone: dataTyped.phones?.[0] || null,
        address: dataTyped.address || null,
        socialLinks: dataTyped.socialLinks || null,
        extractionStatus: "completed",
      });
    }

    // Forward progress to renderer
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows[0];
    if (
      mainWindow &&
      !(mainWindow as { isDestroyed: () => boolean }).isDestroyed()
    ) {
      (
        mainWindow as {
          webContents: { send: (channel: string, payload: unknown) => void };
        }
      ).webContents.send(CONTACT_EXTRACTION_PROGRESS, progress);
    }
  } catch (err) {
    console.error("Failed to handle worker progress:", err);
  }
}

/**
 * Fetch search results from database
 * Uses ContactInfoModule for business logic
 */
async function fetchSearchResults(resultIds: number[]): Promise<any[]> {
  const module = new ContactInfoModule();
  return await module.getSearchResults(resultIds);
}

/**
 * Register IPC handlers for contact extraction
 */
export function registerContactExtractionHandlers(): void {
  console.log("Registering contact extraction IPC handlers...");

  // Worker will be spawned lazily when first needed (not at startup)

  /**
   * Handler: Start contact extraction
   */
  registerValidatedHandler(START_CONTACT_EXTRACTION, contactExtractionRequestSchema, async (input) => {
    try {
      // console.log(request);
      // Parse JSON string if needed (frontend sends JSON.stringify)
      const { resultIds } = input;
      // console.log(resultIds);
      // Validate input
      if (!Array.isArray(resultIds) || resultIds.length === 0) {
        return {
          success: false,
          message: "Invalid result IDs: must be non-empty array",
        };
      }

      // Limit batch size
      if (resultIds.length > 50) {
        return {
          success: false,
          message: "Batch size too large: maximum 50 items per request",
        };
      }

      // console.log(`Starting contact extraction for ${resultIds.length} results`);

      // Use ContactInfoModule for business logic
      const module = new ContactInfoModule();

      // Fetch search results from database
      const results = await module.getSearchResults(resultIds);

      if (results.length === 0) {
        return {
          success: false,
          message: "No search results found for given IDs",
        };
      }

      // Create pending contact info records for all results
      await module.createPendingContactInfo(resultIds);

      // Ensure worker is started (lazy initialization)
      ensureWorkerStarted();

      // Generate batch ID
      const batchId = uuidv4();

      // Send to worker process
      if (contactExtractionWorker && contactExtractionWorker.send) {
        contactExtractionWorker.send({
          type: "extract-contact",
          batchId,
          resultIds,
          results,
          priority: 0,
        });
      } else {
        return {
          success: false,
          message: "Worker process not available",
        };
      }

      return {
        success: true,
        batchId,
        message: `Extraction started for ${resultIds.length} results`,
      };
    } catch (error) {
      console.error("Error starting contact extraction:", error);
      return {
        success: false,
        message: `Failed to start extraction: ${error}`,
      };
    }
  });

  /**
   * Handler: Get contact info
   */
  registerValidatedHandler(GET_CONTACT_INFO, contactExtractionRequestSchema, async (input) => {
    try {
      // Parse JSON string if needed (frontend sends JSON.stringify)
      const { resultIds } = input;

      // Use ContactInfoModule for business logic
      const module = new ContactInfoModule();
      const contactInfoList = await module.getContactInfoByResultIds(resultIds);

      return {
        success: true,
        data: contactInfoList,
      };
    } catch (error) {
      console.error("Error getting contact info:", error);
      return {
        success: false,
        message: `Failed to get contact info: ${error}`,
      };
    }
  });

  /**
   * Handler: Retry contact extraction
   */
  registerValidatedHandler(RETRY_CONTACT_EXTRACTION, contactExtractionRequestSchema, async (input) => {
    try {
      // Parse JSON string if needed (frontend sends JSON.stringify)
      const { resultIds } = input;

      // Validate input
      if (!Array.isArray(resultIds) || resultIds.length === 0) {
        return {
          success: false,
          message: "Invalid result IDs: must be non-empty array",
        };
      }

      console.log(
        `Retrying contact extraction for ${resultIds.length} results`
      );

      // Use ContactInfoModule for business logic
      const module = new ContactInfoModule();

      // Reset contact info for retry
      await module.resetContactInfoForRetry(resultIds);

      // Fetch search results
      const results = await module.getSearchResults(resultIds);

      if (results.length === 0) {
        return {
          success: false,
          message: "No search results found for given IDs",
        };
      }

      // Ensure worker is started (lazy initialization)
      ensureWorkerStarted();

      // Generate batch ID
      const batchId = uuidv4();

      // Send to worker with higher priority
      if (contactExtractionWorker && contactExtractionWorker.send) {
        contactExtractionWorker.send({
          type: "extract-contact",
          batchId,
          resultIds,
          results,
          priority: 10, // Higher priority for retries
        });
      } else {
        return {
          success: false,
          message: "Worker process not available",
        };
      }

      return {
        success: true,
        batchId,
        message: `Retry initiated for ${resultIds.length} results`,
      };
    } catch (error) {
      console.error("Error retrying contact extraction:", error);
      return {
        success: false,
        message: `Failed to retry extraction: ${error}`,
      };
    }
  });

  console.log("Contact extraction IPC handlers registered successfully");
}

/**
 * Cleanup function to close worker process
 */
export function cleanupContactExtractionWorker(): void {
  if (contactExtractionWorker) {
    console.log("Closing contact extraction worker...");
    contactExtractionWorker.kill();
    contactExtractionWorker = null;
  }
}
