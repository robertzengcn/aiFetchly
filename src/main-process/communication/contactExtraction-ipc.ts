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
import {
  contactExtractionWorkerOutboundSchema,
  type ContactExtractionWorkerOutbound,
} from "@/schemas/worker/contactExtraction";

// Type for IPC request with resultIds
interface ContactExtractionRequest {
  resultIds: number[];
}

// Type for worker messages (from worker to main) — replaced by shared schema.
// The discriminated union in contactExtractionWorkerOutboundSchema narrows
// automatically inside switch(msg.type), eliminating the loose index-signature
// that previously allowed silent field drift.

/** Result item for URL-only contact extraction (AI tool) */
export interface UrlContactExtractionResult {
  url: string;
  success: boolean;
  data?: {
    emails?: string[];
    phones?: string[];
    address?: string | null;
    socialLinks?: string[] | null;
  };
  error?: string;
}

/** Pending URL extraction requests: requestId -> resolver and collected results */
const pendingUrlExtractions = new Map<
  string,
  {
    resolve: (results: UrlContactExtractionResult[]) => void;
    reject: (err: Error) => void;
    results: UrlContactExtractionResult[];
    total: number;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();

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
  const pending = pendingUrlExtractions.get(message.requestId);
  if (!pending) return;

  pending.results.push({
    url: message.url,
    success: message.success,
    data: message.data,
    error: message.error,
  });
  if (pending.results.length >= pending.total) {
    clearTimeout(pending.timeoutId);
    pendingUrlExtractions.delete(message.requestId);
    pending.resolve(pending.results);
  }
}

/**
 * Extract contact information from URLs via the worker (no DB write).
 * Used by the AI tool extract_contact_info. Returns when all URLs are processed or timeout.
 */
export async function extractContactFromUrls(
  urls: string[]
): Promise<UrlContactExtractionResult[]> {
  const validUrls = urls.filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );
  if (validUrls.length === 0) {
    return [];
  }

  const requestId = uuidv4();
  return new Promise<UrlContactExtractionResult[]>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (pendingUrlExtractions.has(requestId)) {
        pendingUrlExtractions.delete(requestId);
        reject(
          new Error(
            `Contact extraction timed out after ${
              URL_EXTRACTION_TIMEOUT_MS / 60000
            } minutes`
          )
        );
      }
    }, URL_EXTRACTION_TIMEOUT_MS);

    pendingUrlExtractions.set(requestId, {
      resolve,
      reject,
      results: [],
      total: validUrls.length,
      timeoutId,
    });

    ensureWorkerStarted();
    if (contactExtractionWorker?.send) {
      contactExtractionWorker.send({
        type: "extract-contact-from-urls",
        requestId,
        urls: validUrls,
      });
    } else {
      clearTimeout(timeoutId);
      pendingUrlExtractions.delete(requestId);
      reject(new Error("Contact extraction worker is not available"));
    }
  });
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
  ipcMain.handle(START_CONTACT_EXTRACTION, async (event, request: unknown) => {
    try {
      // console.log(request);
      // Parse JSON string if needed (frontend sends JSON.stringify)
      const parsedRequest =
        typeof request === "string" ? JSON.parse(request) : request;
      const { resultIds } = parsedRequest as ContactExtractionRequest;
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
  ipcMain.handle(GET_CONTACT_INFO, async (event, request: unknown) => {
    try {
      // Parse JSON string if needed (frontend sends JSON.stringify)
      const parsedRequest =
        typeof request === "string" ? JSON.parse(request) : request;
      const { resultIds } = parsedRequest as ContactExtractionRequest;

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
  ipcMain.handle(RETRY_CONTACT_EXTRACTION, async (event, request: unknown) => {
    try {
      // Parse JSON string if needed (frontend sends JSON.stringify)
      const parsedRequest =
        typeof request === "string" ? JSON.parse(request) : request;
      const { resultIds } = parsedRequest as ContactExtractionRequest;

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
