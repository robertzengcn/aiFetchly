/**
 * Contact Extraction Worker Process
 *
 * This worker process handles contact extraction requests in isolation
 * from the main Electron process to prevent crashes from affecting the UI.
 *
 * Communication via IPC:
 * - Receives: extract-contact messages with batch data
 * - Sends: extraction-progress messages with results
 */

import {
  ExtractionJob,
  ExtractionProgress,
} from "@/entityTypes/contactExtractionTypes";
import { extractionQueue } from "./ExtractionQueue";
import { discoverAndExtractContactInfo } from "./ContactDiscovery";
import {
  contactExtractionWorkerInboundSchema,
  type ContactExtractionWorkerInbound,
} from "@/schemas/worker/contactExtraction";
import { mapWithConcurrency } from "@/utils/concurrency";

/**
 * Worker message types — derived from the shared zod schema.
 *
 * contactExtractionWorkerInboundSchema is the single source of truth:
 * main process must send shape-conformant messages, worker rejects
 * anything else at the boundary.
 */
type ExtractContactMessage = Extract<
  ContactExtractionWorkerInbound,
  { type: "extract-contact" }
>;
type ExtractContactFromUrlsMessage = Extract<
  ContactExtractionWorkerInbound,
  { type: "extract-contact-from-urls" }
>;

/**
 * Initialize the worker process
 */
function initializeWorker(): void {
  console.log("ContactExtractionWorker: Worker process initialized");

  // Listen for messages from main process — validated against the shared
  // inbound schema. Malformed messages are dropped with a warning, so a
  // buggy main process can never crash the worker with a bad payload.
  process.on("message", (raw: unknown) => {
    const parsed = contactExtractionWorkerInboundSchema().safeParse(raw);
    if (!parsed.success) {
      console.warn(
        "ContactExtractionWorker: dropped malformed inbound message:",
        parsed.error.message
      );
      return;
    }

    const message = parsed.data;
    if (message.type === "extract-contact") {
      handleExtractionRequest(message);
    } else if (message.type === "extract-contact-from-urls") {
      handleExtractContactFromUrls(message);
    }
    // 'shutdown' is a no-op at the schema level; the worker exits via
    // SIGTERM/SIGINT handlers (process signals), not via IPC.
  });

  // Handle worker errors — WS-4 R4.3: on fatal error, notify main + exit(1)
  // (mirrors LocalEmbeddingWorker / SkillWorker pattern).
  process.on("uncaughtException", (error) => {
    console.error("ContactExtractionWorker: Uncaught exception:", error);
    try {
      process.send?.({
        type: "worker-log",
        level: "error",
        args: [
          "[ContactExtractionWorker] Fatal: uncaughtException:",
          String(error),
        ],
      });
    } catch {
      /* main may already be gone */
    }
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error(
      "ContactExtractionWorker: Unhandled rejection at:",
      promise,
      "reason:",
      reason
    );
    try {
      process.send?.({
        type: "worker-log",
        level: "error",
        args: [
          "[ContactExtractionWorker] Fatal: unhandledRejection:",
          String(reason),
        ],
      });
    } catch {
      /* main may already be gone */
    }
    process.exit(1);
  });

  // WS-4 R4.3: graceful shutdown on SIGTERM/SIGINT
  process.on("SIGTERM", () => {
    console.log("ContactExtractionWorker: received SIGTERM, shutting down");
    process.exit(0);
  });
  process.on("SIGINT", () => {
    console.log("ContactExtractionWorker: received SIGINT, shutting down");
    process.exit(0);
  });

  // Notify parent that worker is ready
  if (process.send) {
    process.send({ type: "worker-ready" });
  }
}

/**
 * Handle extraction request from main process
 */
function handleExtractionRequest(message: ExtractContactMessage): void {
  const { batchId, resultIds, results, priority = 0 } = message;

  console.log(
    `ContactExtractionWorker: Received extraction request for batch ${batchId}`
  );
  console.log(`ContactExtractionWorker: Processing ${resultIds.length} URLs`);

  // Set up progress callback to send updates back to main process
  extractionQueue.setProgressCallback((progress: ExtractionProgress) => {
    if (process.send) {
      process.send({
        type: "extraction-progress",
        ...progress,
      });
    }
  });

  // Convert results to extraction jobs
  const jobs: ExtractionJob[] = results.map((result) => ({
    resultId: result.id,
    url: result.url,
    title: result.title,
    retryCount: 0,
    priority: priority,
  }));

  // Add jobs to queue
  extractionQueue.addBatch(jobs, batchId);

  console.log(
    `ContactExtractionWorker: Jobs added to queue (queue length: ${extractionQueue.getQueueLength()})`
  );
}

/**
 * Result sent to main process for URL-only extraction (no DB)
 */
interface UrlExtractionResultMessage {
  type: "extract-contact-url-result";
  requestId: string;
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

/**
 * Maximum number of URLs to extract concurrently. Matches the existing
 * ContactExtractionQueue (max 3) used by the DB-backed extract-contact flow,
 * so the URL-only AI-tool flow scales the same way instead of processing
 * URLs one at a time. Each URL launches its own browser via
 * discoverAndExtractContactInfo, so 3 concurrent = 3 browsers — the same
 * ceiling the worker already accepts for the DB flow.
 */
const URL_EXTRACTION_CONCURRENCY = 3;

/**
 * Handle extract-contact-from-urls: extract contact info from URLs and send results back (no DB).
 * Used by the AI tool extract_contact_info.
 *
 * URLs are processed with bounded concurrency (URL_EXTRACTION_CONCURRENCY)
 * rather than sequentially. Per-URL results are streamed back as each
 * completes; the main-process collector counts them against the expected
 * total, so out-of-order completion is fine.
 */
async function handleExtractContactFromUrls(
  message: ExtractContactFromUrlsMessage
): Promise<void> {
  const { requestId, urls } = message;
  const validUrls = urls.filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0
  );

  await mapWithConcurrency(
    validUrls,
    URL_EXTRACTION_CONCURRENCY,
    async (url: string): Promise<void> => {
      try {
        const result = await discoverAndExtractContactInfo(url);
        const payload: UrlExtractionResultMessage = {
          type: "extract-contact-url-result",
          requestId,
          url,
          success: result.success,
          ...(result.data && {
            data: {
              emails: result.data.emails,
              phones: result.data.phones,
              address: result.data.address ?? null,
              socialLinks: result.data.socialLinks ?? null,
            },
          }),
          ...(result.error && { error: result.error }),
        };
        if (process.send) {
          process.send(payload);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (process.send) {
          process.send({
            type: "extract-contact-url-result",
            requestId,
            url,
            success: false,
            error: errorMessage,
          } as UrlExtractionResultMessage);
        }
      }
    }
  );
}

/**
 * Worker startup
 */
if (
  require.main === module ||
  process.env.WORKER_TYPE === "contact-extraction"
) {
  initializeWorker();
}

export { initializeWorker };
