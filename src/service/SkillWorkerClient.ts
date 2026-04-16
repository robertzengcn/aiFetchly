import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { SandboxedResult } from "@/service/SandboxedSkillExecutor";

interface ExecuteSkillMessage {
  type: "EXECUTE_SKILL";
  requestId: string;
  code: string;
  args: Record<string, unknown>;
  context: SkillExecutionContext;
}

interface SkillResultMessage {
  type: "SKILL_RESULT";
  requestId: string;
  result: SandboxedResult;
}

interface SkillErrorMessage {
  type: "SKILL_ERROR";
  requestId: string;
  error: string;
}

type WorkerResponseMessage = SkillResultMessage | SkillErrorMessage;

interface PendingRequest {
  resolve: (value: SandboxedResult) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class SkillWorkerClient {
  private static instance: SkillWorkerClient | null = null;

  private workerProcess: UtilityProcess | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private cachedWorkerPath: string | null = null;

  /**
   * A single promise shared across all concurrent callers during worker
   * startup.  Eliminates the polling-based approach that could miss the
   * started state or resolve with null during a race.
   */
  private startupPromise: Promise<UtilityProcess> | null = null;

  private constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  public static getInstance(): SkillWorkerClient {
    if (SkillWorkerClient.instance === null) {
      SkillWorkerClient.instance = new SkillWorkerClient();
    }
    return SkillWorkerClient.instance;
  }

  public dispose(): void {
    this.rejectAllPending(new Error("Skill worker client disposed"));
    this.startupPromise = null;
    if (this.workerProcess) {
      try {
        this.workerProcess.kill();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[SkillWorkerClient] Failed to kill worker: ${message}`);
      }
      this.workerProcess = null;
    }
  }

  public async execute(
    code: string,
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<SandboxedResult> {
    const worker = await this.ensureWorkerStarted();

    // Double-check the worker didn't crash between await resolution and here.
    if (!this.workerProcess) {
      throw new Error("Skill worker became unavailable after startup");
    }

    const requestId = `skill-${uuidv4()}-${Date.now()}`;

    return new Promise<SandboxedResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Skill worker timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      const message: ExecuteSkillMessage = {
        type: "EXECUTE_SKILL",
        requestId,
        code,
        args,
        context,
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
          new Error(`Failed to post message to skill worker: ${errorMessage}`)
        );
      }
    });
  }

  /**
   * Returns a promise that resolves to a live UtilityProcess.
   *
   * Uses a single shared startup promise so that concurrent callers all await
   * the same fork operation. If the worker crashes immediately after fork,
   * the promise is rejected (not resolved with null).
   */
  private async ensureWorkerStarted(): Promise<UtilityProcess> {
    if (this.workerProcess) {
      return this.workerProcess;
    }

    // If a startup is already in flight, piggyback on the same promise.
    if (this.startupPromise) {
      return this.startupPromise;
    }

    this.startupPromise = this.startWorker();

    try {
      return await this.startupPromise;
    } catch (startupError) {
      // Allow the next caller to retry.
      this.startupPromise = null;
      throw startupError;
    }
  }

  /**
   * Forks the worker process and returns once it is ready to receive messages.
   *
   * Electron's `utilityProcess.fork` is synchronous — the UtilityProcess
   * object is returned immediately and the child starts in the background.
   * We attach handlers *before* assigning to `this.workerProcess` so that
   * the `exit`/`error` events during early startup can reject the promise.
   */
  private async startWorker(): Promise<UtilityProcess> {
    const resolvedPath = this.resolveWorkerPath();

    const worker = utilityProcess.fork(resolvedPath, [], {
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_OPTIONS: "",
      },
    });

    // Attach lifecycle handlers before exposing the worker to callers.
    let settled = false;

    const onExitOrError = (detail: string): void => {
      if (settled) return;
      settled = true;
      this.workerProcess = null;
      this.startupPromise = null;
      cleanup();
      throw new Error(`Skill worker failed during startup: ${detail}`);
    };

    const onError = (error: unknown): void => {
      const msg = error instanceof Error ? error.message : String(error);
      onExitOrError(`process error: ${msg}`);
    };

    const onExit = (code: number | null): void => {
      const detail = code === null ? "unknown" : String(code);
      onExitOrError(`exit code: ${detail}`);
    };

    const onMessage = (rawMessage: unknown): void => {
      this.handleWorkerMessage(rawMessage);
    };

    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.on("message", onMessage);

    const cleanup = (): void => {
      worker.removeListener("error", onError);
      worker.removeListener("exit", onExit);
      // Keep the message handler for normal operation — only remove
      // the startup-specific error/exit handlers and replace them
      // with the long-lived versions below.
    };

    // Worker is alive — publish it.  After this point the startup-specific
    // error/exit handlers remain attached but `settled = true` prevents
    // them from throwing. The long-lived handlers below take over via
    // `attachWorkerHandlers` for any later crashes.
    this.workerProcess = worker;
    this.startupPromise = null;
    settled = true;
    cleanup();

    // Now attach the permanent lifecycle handlers for runtime crashes.
    this.attachRuntimeHandlers(worker);

    return worker;
  }

  /**
   * Permanent handlers for a running worker process.  These deal with
   * crashes that happen *after* startup succeeds — they reject all pending
   * requests and reset state so the next execute() call re-forks.
   */
  private attachRuntimeHandlers(worker: UtilityProcess): void {
    worker.on("error", (error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.rejectAllPending(
        new Error(`Skill worker process error: ${errorMessage}`)
      );
      this.workerProcess = null;
      this.startupPromise = null;
    });

    worker.on("exit", (code: number | null) => {
      const exitDetail = code === null ? "unknown" : String(code);
      this.rejectAllPending(
        new Error(`Skill worker exited unexpectedly (code: ${exitDetail})`)
      );
      this.workerProcess = null;
      this.startupPromise = null;
    });
  }

  private handleWorkerMessage(rawMessage: unknown): void {
    let message: WorkerResponseMessage;
    try {
      if (typeof rawMessage === "string") {
        message = JSON.parse(rawMessage) as WorkerResponseMessage;
      } else {
        message = rawMessage as WorkerResponseMessage;
      }
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      this.rejectAllPending(
        new Error(`Failed to parse skill worker message: ${errorMessage}`)
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
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.type === "SKILL_RESULT") {
      pending.resolve(message.result);
      return;
    }

    if (message.type === "SKILL_ERROR") {
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
      path.join(__dirname, "childprocess", "SkillWorker.js"),
      path.join(__dirname, "../childprocess/SkillWorker.js"),
      path.join(process.cwd(), "dist/childprocess/SkillWorker.js"),
      path.join(process.cwd(), ".vite/build/childprocess/SkillWorker.js"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.cachedWorkerPath = candidate;
        return candidate;
      }
    }

    throw new Error(
      `Skill worker file not found. Tried: ${candidates.join(", ")}`
    );
  }
}
