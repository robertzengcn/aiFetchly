import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

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

type WorkerResponseMessage = PythonResultMessage | PythonErrorMessage;

interface PendingRequest {
  resolve: (value: PythonResultMessage) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class PythonRuntimeWorkerClient {
  private static instance: PythonRuntimeWorkerClient | null = null;

  private workerProcess: UtilityProcess | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private cachedWorkerPath: string | null = null;
  private startupPromise: Promise<UtilityProcess> | null = null;

  private constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  public static getInstance(): PythonRuntimeWorkerClient {
    if (PythonRuntimeWorkerClient.instance === null) {
      PythonRuntimeWorkerClient.instance = new PythonRuntimeWorkerClient();
    }
    return PythonRuntimeWorkerClient.instance;
  }

  public dispose(): void {
    this.rejectAllPending(new Error("Python runtime worker client disposed"));
    this.startupPromise = null;
    if (this.workerProcess) {
      try {
        this.workerProcess.kill();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[PythonRuntimeWorkerClient] Failed to kill worker: ${message}`
        );
      }
      this.workerProcess = null;
    }
  }

  public async execute(
    pythonBin: string,
    scriptPath: string,
    args: readonly string[],
    timeoutMs: number
  ): Promise<PythonResultMessage> {
    const worker = await this.ensureWorkerStarted();
    if (!this.workerProcess) {
      throw new Error("Python runtime worker became unavailable after startup");
    }

    const requestId = `py-runtime-${uuidv4()}-${Date.now()}`;
    const scriptLabel = path.basename(scriptPath);
    console.log(
      `[PythonRuntimeWorkerClient] Dispatching request ${requestId} to utility process for script=${scriptLabel}`
    );

    return await new Promise<PythonResultMessage>((resolve, reject) => {
      const effectiveTimeoutMs = Math.min(
        this.timeoutMs,
        Math.max(1, Math.round(timeoutMs))
      );
      const requestTimeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(
            `Python runtime worker timeout after ${effectiveTimeoutMs}ms (request ${Math.round(
              timeoutMs
            )}ms)`
          )
        );
      }, effectiveTimeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: requestTimeout,
      });

      const message: ExecutePythonMessage = {
        type: "EXECUTE_PYTHON",
        requestId,
        pythonBin,
        scriptPath,
        args,
        timeoutMs,
      };

      try {
        worker.postMessage(JSON.stringify(message));
      } catch (postError) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);
        }
        const errorMessage =
          postError instanceof Error ? postError.message : String(postError);
        reject(
          new Error(
            `Failed to post message to python runtime worker: ${errorMessage}`
          )
        );
      }
    });
  }

  private async ensureWorkerStarted(): Promise<UtilityProcess> {
    if (this.workerProcess) {
      return this.workerProcess;
    }
    if (this.startupPromise) {
      return this.startupPromise;
    }
    this.startupPromise = this.startWorker();
    try {
      return await this.startupPromise;
    } catch (startupError) {
      this.startupPromise = null;
      throw startupError;
    }
  }

  private async startWorker(): Promise<UtilityProcess> {
    const resolvedPath = this.resolveWorkerPath();
    console.log(
      `[PythonRuntimeWorkerClient] Starting utility process worker from ${resolvedPath}`
    );
    const worker = utilityProcess.fork(resolvedPath, [], {
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_OPTIONS: "",
      },
    });

    this.workerProcess = worker;
    this.startupPromise = null;
    const pidInfo =
      typeof worker.pid === "number" ? String(worker.pid) : "unknown";
    console.log(
      `[PythonRuntimeWorkerClient] Utility process worker started (pid=${pidInfo})`
    );
    worker.on("message", (rawMessage: unknown) => {
      this.handleWorkerMessage(rawMessage);
    });
    this.attachRuntimeHandlers(worker);
    return worker;
  }

  private attachRuntimeHandlers(worker: UtilityProcess): void {
    worker.on("error", (error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.rejectAllPending(
        new Error(`Python runtime worker process error: ${errorMessage}`)
      );
      this.workerProcess = null;
      this.startupPromise = null;
    });

    worker.on("exit", (code: number | null) => {
      const exitDetail = code === null ? "unknown" : String(code);
      this.rejectAllPending(
        new Error(`Python runtime worker exited unexpectedly (code: ${exitDetail})`)
      );
      this.workerProcess = null;
      this.startupPromise = null;
    });
  }

  private handleWorkerMessage(rawMessage: unknown): void {
    let message: WorkerResponseMessage;
    try {
      message =
        typeof rawMessage === "string"
          ? (JSON.parse(rawMessage) as WorkerResponseMessage)
          : (rawMessage as WorkerResponseMessage);
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      this.rejectAllPending(
        new Error(
          `Failed to parse python runtime worker message: ${errorMessage}`
        )
      );
      return;
    }

    if (
      typeof message !== "object" ||
      message === null ||
      typeof message.requestId !== "string"
    ) {
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.type === "PYTHON_RESULT") {
      console.log(
        `[PythonRuntimeWorkerClient] Request ${message.requestId} completed by utility process`
      );
      pending.resolve(message);
      return;
    }
    if (message.type === "PYTHON_ERROR") {
      console.warn(
        `[PythonRuntimeWorkerClient] Request ${message.requestId} failed in utility process: ${message.error}`
      );
      pending.reject(new Error(message.error));
      return;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private resolveWorkerPath(): string {
    if (this.cachedWorkerPath) {
      return this.cachedWorkerPath;
    }

    const candidates = [
      path.join(__dirname, "childprocess", "PythonRuntimeWorker.js"),
      path.join(__dirname, "../childprocess/PythonRuntimeWorker.js"),
      path.join(process.cwd(), "dist/childprocess/PythonRuntimeWorker.js"),
      path.join(process.cwd(), ".vite/build/childprocess/PythonRuntimeWorker.js"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.cachedWorkerPath = candidate;
        return candidate;
      }
    }

    throw new Error(
      `Python runtime worker file not found. Tried: ${candidates.join(", ")}`
    );
  }
}
