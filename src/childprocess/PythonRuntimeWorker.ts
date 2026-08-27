import { spawn } from "child_process";
import { log } from "@/modules/Logger";
import {
  pythonRuntimeWorkerInboundSchema,
  type PythonRuntimeWorkerInbound,
} from "@/schemas/worker/pythonRuntime";
import { parseWorkerMessage } from "@/schemas/worker/_shared";

interface ExecutePythonMessage {
  type: "EXECUTE_PYTHON";
  requestId: string;
  pythonBin: string;
  scriptPath: string;
  args: readonly string[];
  timeoutMs: number;
}

interface PythonResultMessage {
  type: "PYTHON_RESULT";
  requestId: string;
  stdout: string;
  stderr: string;
}

interface PythonErrorMessage {
  type: "PYTHON_ERROR";
  requestId: string;
  error: string;
}

interface ParentPortMessageEvent {
  data: string;
}

interface WorkerParentPort {
  on: (
    event: "message",
    handler: (event: ParentPortMessageEvent) => void | Promise<void>
  ) => void;
  postMessage: (message: string) => void;
}

const parentPort = (process as unknown as { parentPort?: WorkerParentPort })
  .parentPort;

const activeRequestIds = new Set<string>();
const MAX_STDIO = 400_000;

function trimOutput(text: string): string {
  if (text.length <= MAX_STDIO) return text;
  return `${text.slice(0, MAX_STDIO)}...[truncated]`;
}

function postMessageSafe(
  message: PythonResultMessage | PythonErrorMessage
): void {
  if (!parentPort) return;
  try {
    parentPort.postMessage(JSON.stringify(message));
  } catch (postError) {
    const errorMessage =
      postError instanceof Error ? postError.message : String(postError);
    log.error(`[PythonRuntimeWorker] Failed to post message: ${errorMessage}`);
  }
}

function sendFatalErrorToActiveRequests(error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  for (const requestId of activeRequestIds) {
    postMessageSafe({
      type: "PYTHON_ERROR",
      requestId,
      error: errorMessage,
    });
  }
}


async function executePython(
  message: ExecutePythonMessage
): Promise<{ stdout: string; stderr: string }> {
  const pythonEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };

  return await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        message.pythonBin,
        ["-I", message.scriptPath, ...message.args],
        {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: pythonEnv,
        }
      );

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(
          new Error(
            `Python runtime timed out after ${Math.round(message.timeoutMs)}ms`
          )
        );
      }, message.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
        if (stdout.length > MAX_STDIO * 2) {
          stdout = stdout.slice(-MAX_STDIO * 2);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
        if (stderr.length > MAX_STDIO * 2) {
          stderr = stderr.slice(-MAX_STDIO * 2);
        }
      });

      child.on("error", (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      child.on("close", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(
            new Error(
              `Python script exited with code ${String(
                code
              )}. stderr: ${trimOutput(stderr)}`
            )
          );
          return;
        }
        resolve({ stdout: trimOutput(stdout), stderr: trimOutput(stderr) });
      });
    }
  );
}

if (parentPort) {
  log.info(
    `[PythonRuntimeWorker] Utility process worker online (pid=${process.pid})`
  );
  parentPort.on("message", async (event: ParentPortMessageEvent) => {
    let requestId = "unknown";
    try {
      const parsed = JSON.parse(event.data) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "requestId" in parsed &&
        typeof (parsed as { requestId?: unknown }).requestId === "string"
      ) {
        requestId = (parsed as { requestId: string }).requestId;
      }
      const validation = parseWorkerMessage<PythonRuntimeWorkerInbound>(
        parsed,
        pythonRuntimeWorkerInboundSchema()
      );
      if (!validation.success) {
        log.warn(
          "[PythonRuntimeWorker] dropped malformed EXECUTE_PYTHON:",
          validation.error
        );
        postMessageSafe({
          type: "PYTHON_ERROR",
          requestId,
          error: "Invalid EXECUTE_PYTHON message payload",
        });
        return;
      }
      const message = validation.data;
      requestId = message.requestId;
      activeRequestIds.add(requestId);
      const scriptLabel = message.scriptPath.split(/[\\/]/).pop() || "unknown";
      log.info(
        `[PythonRuntimeWorker] Executing request ${requestId} (script=${scriptLabel}, pid=${process.pid})`
      );

      const result = await executePython(message);
      postMessageSafe({
        type: "PYTHON_RESULT",
        requestId,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      log.info(
        `[PythonRuntimeWorker] Completed request ${requestId} (pid=${process.pid})`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.warn(
        `[PythonRuntimeWorker] Request ${requestId} failed: ${errorMessage}`
      );
      postMessageSafe({
        type: "PYTHON_ERROR",
        requestId,
        error: errorMessage,
      });
    } finally {
      activeRequestIds.delete(requestId);
    }
  });
}

process.on("uncaughtException", (error: unknown) => {
  log.error("[PythonRuntimeWorker] Uncaught exception:", error);
  sendFatalErrorToActiveRequests(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("[PythonRuntimeWorker] Unhandled rejection:", reason);
  sendFatalErrorToActiveRequests(reason);
  process.exit(1);
});
