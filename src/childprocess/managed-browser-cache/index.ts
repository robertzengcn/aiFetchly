import { log } from "@/modules/Logger";
import {
  managedBrowserCacheInboundSchema,
  type ManagedBrowserCacheInboundMessage,
  type ManagedBrowserCacheOutboundMessage,
} from "@/schemas/worker/managedBrowserCache";
import { parseWorkerMessage } from "@/schemas/worker/_shared";
import {
  MANAGED_BROWSER_MESSAGE_LIMITS,
  MANAGED_BROWSER_PROTOCOL_VERSION,
} from "@/config/managedBrowser";
import {
  ManagedBrowserCacheMaintenanceWorker,
  type CacheMessageBase,
} from "@/childprocess/managed-browser-cache/ManagedBrowserCacheMaintenanceWorker";

/**
 * Managed-browser CACHE maintenance worker entry (technical design §13.9).
 *
 * Unlike the session worker, this is a SHARED SINGLETON forked with NO argv
 * contract: main sends an operation, the worker performs the bounded
 * scan/delete/plan, and replies. Boot contract is only the parent port.
 *
 *   1. sends WORKER_READY immediately;
 *   2. validates EVERY inbound message against the strict Zod union —
 *      malformed messages are dropped+counted, three stop the worker;
 *   3. performs no database access and never logs paths or identifiers.
 */

interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  once(event: "close", listener: () => void): void;
}

const parentPortRaw = (process as unknown as { parentPort?: ParentPortLike })
  .parentPort;

if (!parentPortRaw) {
  // Fatal boot contract violation — nothing to negotiate.
  process.exit(2);
}

/** Narrowed port handle — closures below capture this, never the optional. */
const parentPort: ParentPortLike = parentPortRaw;

let sequence = 0;
let malformedCount = 0;
let stopped = false;

function makeBase(requestId: string): CacheMessageBase {
  sequence += 1;
  return {
    protocolVersion: MANAGED_BROWSER_PROTOCOL_VERSION,
    requestId,
    sequence,
  };
}

const worker = new ManagedBrowserCacheMaintenanceWorker({
  send: (message: ManagedBrowserCacheOutboundMessage) => {
    parentPort.postMessage(JSON.stringify(message));
  },
  makeBase,
});

function sendWorkerError(
  requestId: string,
  code: string,
  message: string
): void {
  parentPort.postMessage(
    JSON.stringify({
      ...makeBase(requestId),
      type: "WORKER_ERROR",
      code,
      message: message.slice(0, 300),
    })
  );
}

// --- WORKER_READY (before any command) ---
parentPort.postMessage(
  JSON.stringify({
    ...makeBase("evt-cache-worker-ready"),
    type: "WORKER_READY",
    workerPid: process.pid,
  })
);

// --- Inbound dispatch. ---
parentPort.on("message", async (event: { data: unknown }) => {
  if (stopped) {
    return;
  }
  const raw =
    typeof event.data === "string"
      ? safeJsonParse(event.data)
      : (event.data as unknown);

  const parsed = parseWorkerMessage<ManagedBrowserCacheInboundMessage>(
    raw,
    managedBrowserCacheInboundSchema()
  );
  if (!parsed.success) {
    malformedCount++;
    log.warn(
      `[ManagedBrowserCacheWorker] dropped malformed message (${malformedCount}/${MANAGED_BROWSER_MESSAGE_LIMITS.maxMalformedMessages})`
    );
    if (malformedCount >= MANAGED_BROWSER_MESSAGE_LIMITS.maxMalformedMessages) {
      sendWorkerError(
        `evt-protocol-${malformedCount}`,
        "worker_protocol_violation",
        "too many malformed messages"
      );
      await gracefulExit("worker_protocol_violation");
    }
    return;
  }

  const message = parsed.data;
  try {
    switch (message.type) {
      case "SCAN_SCOPE":
        await worker.handleScanScope(message);
        return;
      case "SCAN_ALL":
        await worker.handleScanAll(message);
        return;
      case "DELETE_QUEUED_SCOPE":
        await worker.handleDeleteQueuedScope(message);
        return;
      case "PLAN_EVICTION":
        await worker.handlePlanEviction(message);
        return;
      case "CANCEL_BEFORE_DELETE":
        worker.handleCancelBeforeDelete(message);
        return;
      case "SHUTDOWN":
        worker.handleShutdown(message);
        await gracefulExit("shutdown");
        return;
      default:
        log.warn("[ManagedBrowserCacheWorker] unhandled message type");
    }
  } catch (error) {
    const message2 = error instanceof Error ? error.message : String(error);
    log.error(`[ManagedBrowserCacheWorker] handler error: ${message2}`);
    sendWorkerError("evt-handler", "internal_error", message2);
  }
});

// --- Termination. ---
async function gracefulExit(reason: string): Promise<void> {
  if (stopped) {
    return;
  }
  stopped = true;
  worker.dispose();
  // Give the final postMessage a chance to flush before exiting.
  setTimeout(() => process.exit(0), 50);
}

process.on("SIGTERM", () => {
  void gracefulExit("shutdown");
});

process.on("disconnect", () => {
  void gracefulExit("worker_exited");
});

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}
