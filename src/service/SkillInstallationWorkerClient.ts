/**
 * SkillInstallationWorkerClient — dispatches bounded staging work to the
 * skill-installation utility process (design §15.2), with a validated
 * protocol in both directions.
 *
 * Behavior:
 *   - forks the bundled worker entry via Electron utilityProcess when
 *     available (main process, packaged/dev), reusing one long-lived worker;
 *   - validates every response against the zod protocol before use;
 *   - falls back to INLINE staging (the same shared stagePackage module)
 *     when the worker cannot be forked (tests, non-Electron contexts) or
 *     dies mid-request — identical limits, identical hashes;
 *   - one in-flight request at a time; unexpected exit surfaces as a
 *     structured error and the worker is re-forked on the next call.
 */

import * as crypto from "crypto";
import * as path from "path";
import { buildPackagedWorkerEnv } from "@/utils/packagedWorkerPath";
import {
  stagePackageResponseSchema,
  type StagePackageRequest,
  type StagePackageResponse,
} from "@/childprocess/skill-installation/SkillInstallationWorkerProtocol";
import {
  stagePackage,
  type StageLimits,
  type StageResult,
} from "@/childprocess/skill-installation/stagePackage";

/** Structural handle for the worker process (utilityProcess transport). */
export interface WorkerHandle {
  postMessage: (msg: unknown) => void;
  on: (event: string, cb: (arg: unknown) => void) => void;
  kill: () => boolean;
}

export type ForkFn = (
  modulePath: string,
  args: readonly string[],
  opts: { env?: NodeJS.ProcessEnv }
) => WorkerHandle;

function defaultFork(): ForkFn | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { utilityProcess } = require("electron") as typeof import("electron");
    return (modulePath, args, opts) =>
      utilityProcess.fork(modulePath, [...args], {
        env: opts.env,
      }) as unknown as WorkerHandle;
  } catch {
    return null;
  }
}

/**
 * Bundled worker entry. Dev resolves via .vite/build output; packaged via
 * the asar-unpacked workers directory (same layout as the hook worker).
 */
export function defaultSkillInstallationWorkerEntry(): string {
  const devEntry = path.join(
    process.cwd(),
    ".vite",
    "build",
    "SkillInstallationWorker.js"
  );
  return devEntry;
}

export interface StageViaWorkerOptions {
  readonly fork?: ForkFn | null;
  readonly workerEntry?: string;
  /** Per-request timeout; the caller's acquisition timeout governs overall. */
  readonly timeoutMs?: number;
}

export type StageOutcome =
  | {
      readonly ok: true;
      readonly result: StageResult;
      readonly viaWorker: boolean;
    }
  | {
      readonly ok: false;
      readonly code: "SOURCE_LIMIT_EXCEEDED" | "STAGE_IO_FAILED";
      readonly message: string;
    };

export class SkillInstallationWorkerClient {
  private worker: WorkerHandle | null = null;
  private pending: {
    requestId: string;
    resolve: (response: StagePackageResponse) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  private readonly fork: ForkFn | null;
  private readonly workerEntry: string;
  private readonly timeoutMs: number;

  constructor(options: StageViaWorkerOptions = {}) {
    this.fork =
      options.fork === undefined
        ? defaultFork()
        : options.fork === null
        ? null
        : options.fork;
    this.workerEntry =
      options.workerEntry ?? defaultSkillInstallationWorkerEntry();
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /**
   * Stage one acquired package. Uses the worker when forking succeeded;
   * otherwise (or after a worker death) stages inline. Limits and hashes
   * are identical either way — the worker is a scheduling optimization,
   * never a policy boundary.
   */
  async stage(
    sourceRoot: string,
    targetRoot: string,
    limits: StageLimits
  ): Promise<StageOutcome> {
    if (this.fork) {
      try {
        const viaWorker = await this.stageViaWorker(
          sourceRoot,
          targetRoot,
          limits
        );
        return {
          ok: true,
          result: viaWorker,
          viaWorker: true,
        };
      } catch (err) {
        // Worker unavailable/died/timed out — recycle and fall back inline
        // so acquisition never fails purely because of worker plumbing.
        this.recycleWorker();
      }
    }
    try {
      const inline = stagePackage(sourceRoot, targetRoot, limits);
      return { ok: true, result: inline, viaWorker: false };
    } catch (err) {
      return {
        ok: false,
        code: isLimitError(err) ? "SOURCE_LIMIT_EXCEEDED" : "STAGE_IO_FAILED",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  dispose(): void {
    this.recycleWorker();
  }

  private recycleWorker(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    if (this.worker) {
      try {
        this.worker.kill();
      } catch {
        /* already dead */
      }
      this.worker = null;
    }
  }

  private ensureWorker(): WorkerHandle {
    if (this.worker) return this.worker;
    const worker = this.fork?.(this.workerEntry, [], {
      // buildPackagedWorkerEnv sets NODE_PATH so the unpacked worker bundle
      // resolves its deps in packaged builds (PackagedWorkerEnvGuard gate).
      env: buildPackagedWorkerEnv({
        extraEnv: { WORKER_TYPE: "skill-installation" },
      }),
    });
    if (!worker) {
      throw new Error("worker fork unavailable");
    }
    worker.on("message", (raw: unknown) => {
      const envelope = raw as { data?: unknown } | undefined;
      const payload = envelope && "data" in envelope ? envelope.data : raw;
      const parsed = stagePackageResponseSchema.safeParse(payload);
      if (!parsed.success || !this.pending) return;
      if (parsed.data.requestId !== this.pending.requestId) return;
      clearTimeout(this.pending.timer);
      const resolve = this.pending.resolve;
      this.pending = null;
      resolve(parsed.data);
    });
    worker.on("exit", () => {
      // A dead worker must never orphan an in-flight stage: REJECT it so
      // stage() falls back to inline staging instead of hanging.
      if (this.pending) {
        clearTimeout(this.pending.timer);
        const reject = this.pending.reject;
        this.pending = null;
        reject(new Error("skill-installation worker exited mid-request"));
      }
      this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  private stageViaWorker(
    sourceRoot: string,
    targetRoot: string,
    limits: StageLimits
  ): Promise<StageResult> {
    return new Promise<StageResult>((resolve, reject) => {
      let worker: WorkerHandle;
      try {
        worker = this.ensureWorker();
      } catch (err) {
        reject(err);
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error("skill-installation worker timed out"));
      }, this.timeoutMs);
      this.pending = {
        requestId,
        timer,
        reject,
        resolve: (response) => {
          if (response.type === "staged") {
            resolve({
              fileCount: response.fileCount,
              totalBytes: response.totalBytes,
              contentHash: response.contentHash,
            });
          } else if (response.code === "SOURCE_LIMIT_EXCEEDED") {
            reject(limitFailure(response.message));
          } else {
            reject(new Error(response.message));
          }
        },
      };
      const request: StagePackageRequest = {
        type: "stage-package",
        requestId,
        sourceRoot,
        targetRoot,
        limits,
      };
      try {
        worker.postMessage(request);
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}

class LimitFailure extends Error {}
function limitFailure(message: string): Error {
  const err = new LimitFailure(message);
  err.name = "StageLimitError";
  return err;
}
function isLimitError(err: unknown): boolean {
  return err instanceof Error && err.name === "StageLimitError";
}
