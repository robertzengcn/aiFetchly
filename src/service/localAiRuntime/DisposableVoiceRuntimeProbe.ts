/**
 * Local AI Runtime — disposable voice health probe (design §19).
 *
 * Spawns a short-lived Electron utilityProcess (`RuntimeProbeWorker`) that
 * loads the staged runtime's native addon and verifies its exports. The probe
 * resolves ONLY after the worker process EXITS — not merely when the result
 * message arrives — because on Windows a require()'d native `.node` addon is
 * file-locked for the host process's lifetime. Letting the child (not the main
 * process) hold that lock, and awaiting its exit, lets the caller safely
 * `fs.rename(staging -> versionRoot)` afterward (fix for the install-time
 * EPERM on Windows). Mirrors the fork/exit/timeout shape of
 * `SherpaVoiceWorkerClient` so the probe is unit-testable via an injected fork.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { utilityProcess } from "electron";
import {
  resolvePackagedWorkerPath,
  buildPackagedWorkerEnv,
} from "@/utils/packagedWorkerPath";
import {
  runtimeProbeResultSchema,
  type RuntimeProbeResult,
} from "@/schemas/worker/runtimeProbe";
import type {
  HealthProbeOutcome,
  RuntimeHealthProbe,
} from "./LocalAiRuntimeHealthService";
import type {
  LocalAiRuntimeId,
  ResolvedLocalAiRuntime,
} from "@/entityTypes/localAiRuntimeTypes";

const RUNTIME_PROBE_WORKER_FILE = "RuntimeProbeWorker.js";
/** Default probe round-trip budget (fork + native load + export check + exit). */
const RUNTIME_PROBE_TIMEOUT_MS = 60_000;

/** Minimal Electron UtilityProcess surface used by the probe. */
export interface ProbeUtilityProcess {
  on(event: "error", handler: (error: unknown) => void): unknown;
  on(event: "exit", handler: (code: number | null) => void): unknown;
  on(event: "message", handler: (message: unknown) => void): unknown;
  postMessage(message: string): unknown;
  kill(): unknown;
}

/** Injectable fork for tests (mirrors SherpaVoiceWorkerClient.ForkFn). */
export type ProbeForkFn = (workerPath: string) => ProbeUtilityProcess;

/**
 * Required native exports per runtime id. The probe reports `ok: false` when
 * any listed name is not a function on the loaded module.
 */
const REQUIRED_EXPORTS_BY_RUNTIME: Record<LocalAiRuntimeId, readonly string[]> =
  {
    "voice-sherpa": ["OfflineRecognizer", "OfflineTts", "GenerationConfig"],
    "embedding-xenova": [],
  };

/** Resolve the built probe worker file across dev / packaged layouts. */
export function resolveRuntimeProbeWorkerPath(
  runtime: {
    dirname: string;
    cwd: string;
    resourcesPath?: string;
    existsSync: (candidate: string) => boolean;
  },
  workerFile: string = RUNTIME_PROBE_WORKER_FILE
): string {
  const resolved = resolvePackagedWorkerPath(runtime, {
    // dev (.vite/build + dist/childprocess) and packaged (app.asar[/unpacked])
    // layouts. resolvePackagedWorkerPath mirrors app.asar ahead of its
    // unpacked disk mirror so require() can still reach app.asar/node_modules.
    dirnameRelativePaths: [workerFile, `childprocess/${workerFile}`],
    cwdRelativePaths: [
      `dist/childprocess/${workerFile}`,
      `.vite/build/${workerFile}`,
      `.vite/build/childprocess/${workerFile}`,
    ],
  });
  if (resolved) return resolved;
  throw new Error(
    `Runtime probe worker not found. Build ${workerFile} via yarn dev/yarn make.`
  );
}

/** Default production fork: Electron utilityProcess with packaged-worker env. */
const defaultFork: ProbeForkFn = (workerPath): ProbeUtilityProcess => {
  const proc = utilityProcess.fork(workerPath, [], {
    stdio: "pipe",
    env: buildPackagedWorkerEnv({
      extraEnv: { WORKER_TYPE: "runtime-probe" },
    }),
  });
  return proc as unknown as ProbeUtilityProcess;
};

/**
 * Drives the disposable probe worker. Constructed once in the main-process
 * composition root and bound as the `voice-sherpa` probe on
 * `LocalAiRuntimeHealthService`. Forking is lazy (per `run`); the constructor
 * has no side effects, so it is safe to instantiate in any process.
 */
export class DisposableVoiceRuntimeProbe {
  constructor(
    private readonly timeoutMs: number = RUNTIME_PROBE_TIMEOUT_MS,
    private readonly forkImpl: ProbeForkFn = defaultFork,
    private readonly workerPathOverride: string | null = null
  ) {}

  /** `RuntimeHealthProbe` entry point. */
  run: RuntimeHealthProbe = (
    runtime: ResolvedLocalAiRuntime,
    _mode: "runtime_only" | "full",
    signal: AbortSignal
  ): Promise<HealthProbeOutcome> => this.probe(runtime, signal);

  private async probe(
    runtime: ResolvedLocalAiRuntime,
    signal: AbortSignal
  ): Promise<HealthProbeOutcome> {
    const entryModule = runtime.manifest.entryModule;
    if (!entryModule) {
      return {
        ok: false,
        errorMessage: "Runtime manifest has no entryModule to probe.",
      };
    }
    const requiredExports =
      REQUIRED_EXPORTS_BY_RUNTIME[runtime.runtimeId] ?? [];

    let worker: ProbeUtilityProcess;
    try {
      worker = this.forkImpl(this.resolveWorkerPath());
    } catch (forkError) {
      return {
        ok: false,
        errorMessage: `Failed to start probe worker: ${
          forkError instanceof Error ? forkError.message : String(forkError)
        }`,
      };
    }

    return new Promise<HealthProbeOutcome>((resolve) => {
      let settled = false;
      let resultOutcome: HealthProbeOutcome | null = null;

      const finish = (outcome: HealthProbeOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          worker.kill();
        } catch {
          // Worker may have already exited.
        }
        resolve(outcome);
      };

      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            errorMessage: `Runtime probe timed out after ${this.timeoutMs}ms.`,
          }),
        this.timeoutMs
      );

      const onAbort = (): void =>
        finish({ ok: false, errorMessage: "Runtime probe aborted." });
      if (signal.aborted) {
        finish({ ok: false, errorMessage: "Runtime probe aborted." });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      const detach = (): void => signal.removeEventListener("abort", onAbort);

      worker.on("message", (raw: unknown) => {
        const outcome = interpretProbeMessage(raw);
        if (outcome === null) return; // malformed; keep waiting for exit/error
        resultOutcome = outcome;
        // Do NOT resolve here: wait for exit so the native lock is released.
      });
      worker.on("exit", (code: number | null) => {
        detach();
        finish(
          resultOutcome ?? {
            ok: false,
            errorMessage: `Probe worker exited (code ${
              code === null ? "unknown" : code
            }) without a result.`,
          }
        );
      });
      worker.on("error", (error: unknown) => {
        detach();
        finish({
          ok: false,
          errorMessage: `Probe worker error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      });

      try {
        worker.postMessage(
          JSON.stringify({
            type: "probe",
            requestId: `probe-${randomUUID()}`,
            runtimeRoot: runtime.runtimeRoot,
            entryModule,
            requiredExports,
          })
        );
      } catch (postError) {
        detach();
        finish({
          ok: false,
          errorMessage: `Failed to post probe message: ${
            postError instanceof Error ? postError.message : String(postError)
          }`,
        });
      }
    });
  }

  private resolveWorkerPath(): string {
    if (this.workerPathOverride) return this.workerPathOverride;
    const electronProcess = process as NodeJS.Process & {
      resourcesPath?: string;
    };
    return resolveRuntimeProbeWorkerPath({
      dirname: __dirname,
      cwd: process.cwd(),
      resourcesPath: electronProcess.resourcesPath,
      existsSync: fs.existsSync,
    });
  }
}

/**
 * Parse + Zod-validate the worker's `result` message into a probe outcome.
 * Returns null for non-JSON / malformed payloads so the caller keeps waiting
 * for the exit/error event rather than silently passing.
 */
export function interpretProbeMessage(raw: unknown): HealthProbeOutcome | null {
  let parsedJson: unknown;
  try {
    parsedJson = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, errorMessage: "Probe returned non-JSON message." };
  }
  const parsed = runtimeProbeResultSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, errorMessage: "Probe returned malformed result." };
  }
  return resultToOutcome(parsed.data);
}

function resultToOutcome(data: RuntimeProbeResult): HealthProbeOutcome {
  const details: Record<string, boolean> = {};
  for (const entry of data.exports) details[entry.name] = entry.present;
  return {
    ok: data.ok,
    details,
    ...(data.ok
      ? {}
      : { errorMessage: data.errorMessage ?? "Probe reported failure." }),
  };
}
