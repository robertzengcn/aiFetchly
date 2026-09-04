import { log } from "@/modules/Logger";
import {
  managedBrowserInboundSchema,
  type ManagedBrowserInboundMessage,
} from "@/schemas/worker/managedBrowser";
import { parseWorkerMessage } from "@/schemas/worker/_shared";
import {
  MANAGED_BROWSER_MESSAGE_LIMITS,
  MANAGED_BROWSER_TIMEOUTS,
} from "@/config/managedBrowser";
import { WorkerSession } from "@/childprocess/managed-browser/WorkerSession";

/**
 * Managed-browser worker entry (technical design §4/§8).
 *
 * Boot contract: the main process forks this file with
 * `utilityProcess.fork(path, [sessionId, sessionNonce])`. The worker:
 *   1. sends WORKER_READY immediately (FR-RUNTIME-002);
 *   2. validates EVERY inbound message against the strict Zod union —
 *      malformed messages are dropped+counted, three stop the session as
 *      `worker_protocol_violation` (FR-RUNTIME-004);
 *   3. emits WORKER_HEARTBEAT every 5s from a timer independent of page
 *      navigation and handoff (FR-RUNTIME-011);
 *   4. never logs cookie payloads.
 */

interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  once(event: "close", listener: () => void): void;
}

const parentPortRaw = (process as unknown as { parentPort?: ParentPortLike })
  .parentPort;

const sessionId = process.argv[2] ?? "";
const sessionNonce = process.argv[3] ?? "";

if (!parentPortRaw || !sessionId.startsWith("mb_") || !sessionNonce) {
  // Fatal boot contract violation — nothing to negotiate.
  process.exit(2);
}

/** Narrowed port handle — closures below capture this, never the optional. */
const parentPort: ParentPortLike = parentPortRaw;

let sequence = 0;
let malformedCount = 0;
let stopped = false;

const session = new WorkerSession({
  sessionId,
  sessionNonce,
  send: (message) => {
    parentPort.postMessage(JSON.stringify(message));
  },
});

function baseMessage(requestId: string): {
  protocolVersion: 1;
  sessionId: string;
  requestId: string;
  sequence: number;
} {
  sequence += 1;
  return {
    protocolVersion: 1,
    sessionId,
    requestId,
    sequence,
  };
}

function sendWorkerError(
  requestId: string,
  code: string,
  message: string
): void {
  parentPort.postMessage(
    JSON.stringify({
      ...baseMessage(requestId),
      type: "WORKER_ERROR",
      code,
      message: message.slice(0, 300),
    })
  );
}

// --- WORKER_READY (before any command; FR-RUNTIME-002) ---
parentPort.postMessage(
  JSON.stringify({
    ...baseMessage("evt-worker-ready"),
    type: "WORKER_READY",
    sessionId,
    workerPid: process.pid,
  })
);

// --- Heartbeat: independent timer, always fires (§8.5). ---
let lastHeartbeatSentAt = Date.now();
setInterval(() => {
  if (stopped) {
    return;
  }
  const drift =
    Date.now() -
    lastHeartbeatSentAt -
    MANAGED_BROWSER_TIMEOUTS.heartbeatIntervalMs;
  const lagBucket = drift > 3_000 ? "high" : drift > 1_000 ? "medium" : "low";
  lastHeartbeatSentAt = Date.now();
  parentPort.postMessage(
    JSON.stringify({
      ...baseMessage(`evt-hb-${lastHeartbeatSentAt}`),
      type: "WORKER_HEARTBEAT",
      sessionId,
      state: session.state,
      lagBucket,
      ts: lastHeartbeatSentAt,
    })
  );
}, MANAGED_BROWSER_TIMEOUTS.heartbeatIntervalMs);

// --- Inbound dispatch. ---
parentPort.on("message", async (event: { data: unknown }) => {
  if (stopped) {
    return;
  }
  const raw =
    typeof event.data === "string"
      ? safeJsonParse(event.data)
      : (event.data as unknown);

  const parsed = parseWorkerMessage<ManagedBrowserInboundMessage>(
    raw,
    managedBrowserInboundSchema()
  );
  if (!parsed.success) {
    malformedCount++;
    log.warn(
      `[ManagedBrowserWorker] dropped malformed message (${malformedCount}/${MANAGED_BROWSER_MESSAGE_LIMITS.maxMalformedMessages})`
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
  if (message.sessionId !== sessionId) {
    // Stale-session message: drop, fail closed (FR-RUNTIME-004).
    log.warn("[ManagedBrowserWorker] dropped message for a foreign session");
    return;
  }

  try {
    switch (message.type) {
      case "START_SESSION":
        await session.startSession(message);
        return;
      case "OBSERVE":
        await session.observe(message.requestId);
        return;
      case "RUN_ACTIONS":
        await session.runActions(message.requestId, message.program);
        return;
      case "CAPTURE_SCREENSHOT":
        await session.captureScreenshot(message.requestId);
        return;
      case "BEGIN_HANDOFF":
        session.beginHandoff(message.requestId, message.reason);
        return;
      case "RESUME_HANDOFF":
        await session.resumeFromHandoff(message.requestId);
        return;
      case "VERIFY_MANUAL_LOGIN":
        await session.verifyManualLogin(message.requestId);
        return;
      case "CANCEL_REQUEST":
        session.cancelCurrent();
        parentPort.postMessage(
          JSON.stringify({
            ...baseMessage(message.requestId),
            type: "SESSION_STATE_CHANGED",
            state: session.state,
            reasonCode: "cancelled",
          })
        );
        return;
      case "STOP_SESSION":
        await session.stop(message.requestId, message.reason);
        await gracefulExit(message.reason);
        return;
      default:
        log.warn("[ManagedBrowserWorker] unhandled message type");
    }
  } catch (error) {
    const message2 = error instanceof Error ? error.message : String(error);
    log.error(`[ManagedBrowserWorker] handler error: ${message2}`);
    sendWorkerError("evt-handler", "internal_error", message2);
  }
});

// --- Termination. ---
async function gracefulExit(reason: string): Promise<void> {
  if (stopped) {
    return;
  }
  stopped = true;
  await session.dispose(reason);
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
