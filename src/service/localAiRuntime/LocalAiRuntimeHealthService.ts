/**
 * Local AI Runtime — health checks (design §19).
 *
 * Runs bounded smoke tests against a resolved (or staged) runtime. The actual
 * native probes (scoped sherpa-onnx require, embedding worker fork + 384-dim
 * embed) are injectable so the service stays unit-testable and so Phase 7/8
 * wire the real probes when the voice/embedding workers land. A default voice
 * probe verifies the sherpa-onnx-node exports from the runtime root.
 */
import { createRequire } from "node:module";
import path from "node:path";
import type {
  LocalAiRuntimeId,
  LocalAiRuntimeErrorCode,
  ResolvedLocalAiRuntime,
} from "@/entityTypes/localAiRuntimeTypes";

export interface RuntimeHealthCheckContext {
  runtime: ResolvedLocalAiRuntime;
  mode: "runtime_only" | "full";
  timeoutMs: number;
}

export interface RuntimeHealthCheckResult {
  ok: boolean;
  runtimeId: LocalAiRuntimeId;
  runtimeVersion: string;
  durationMs: number;
  details: Record<string, string | number | boolean>;
  errorCode?: LocalAiRuntimeErrorCode;
  errorMessage?: string;
}

export interface HealthProbeOutcome {
  ok: boolean;
  details?: Record<string, string | number | boolean>;
  errorMessage?: string;
}

export type RuntimeHealthProbe = (
  runtime: ResolvedLocalAiRuntime,
  mode: "runtime_only" | "full",
  signal: AbortSignal,
) => Promise<HealthProbeOutcome>;

/** Default voice probe: scoped require + required export check. */
async function defaultVoiceProbe(
  runtime: ResolvedLocalAiRuntime,
  _mode: "runtime_only" | "full",
  _signal: AbortSignal,
): Promise<HealthProbeOutcome> {
  try {
    const runtimeRequire = createRequire(path.join(runtime.runtimeRoot, "package.json"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (runtimeRequire(runtime.manifest.entryModule ?? "sherpa-onnx-node") as Record<string, unknown>) ?? {};
    const hasRecognizer = typeof mod.OfflineRecognizer === "function";
    const hasTts = typeof mod.OfflineTts === "function";
    const hasConfig = typeof mod.GenerationConfig === "function";
    const ok = hasRecognizer && hasTts && hasConfig;
    return {
      ok,
      details: {
        offlineRecognizer: hasRecognizer,
        offlineTts: hasTts,
        generationConfig: hasConfig,
      },
      errorMessage: ok ? undefined : "Missing required sherpa-onnx-node exports.",
    };
  } catch (error) {
    return { ok: false, errorMessage: `Voice native load failed: ${(error as Error).message}` };
  }
}

/** Default embedding probe: verify the worker entry exists (full fork wired in Phase 8). */
async function defaultEmbeddingProbe(
  runtime: ResolvedLocalAiRuntime,
  _mode: "runtime_only" | "full",
  _signal: AbortSignal,
): Promise<HealthProbeOutcome> {
  const entry = runtime.entryPath ?? runtime.manifest.entryPoint;
  if (!entry) {
    return { ok: false, errorMessage: "No embedding worker entry point." };
  }
  // The real check forks worker.js and imports Transformers.js without loading
  // weights (Phase 8). For now, confirm the entry exists beneath the root.
  const { access } = await import("node:fs/promises");
  try {
    await access(entry);
    return { ok: true, details: { entryPresent: true } };
  } catch {
    return { ok: false, errorMessage: `Embedding worker entry missing: ${entry}` };
  }
}

export class LocalAiRuntimeHealthService {
  private readonly probes: Map<LocalAiRuntimeId, RuntimeHealthProbe>;

  constructor(probes?: Partial<Record<LocalAiRuntimeId, RuntimeHealthProbe>>) {
    this.probes = new Map<LocalAiRuntimeId, RuntimeHealthProbe>([
      ["voice-sherpa", probes?.["voice-sherpa"] ?? defaultVoiceProbe],
      ["embedding-xenova", probes?.["embedding-xenova"] ?? defaultEmbeddingProbe],
    ]);
  }

  async check(ctx: RuntimeHealthCheckContext): Promise<RuntimeHealthCheckResult> {
    const start = Date.now();
    const probe = this.probes.get(ctx.runtime.runtimeId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
    try {
      if (!probe) {
        return {
          ok: false,
          runtimeId: ctx.runtime.runtimeId,
          runtimeVersion: ctx.runtime.runtimeVersion,
          durationMs: Date.now() - start,
          details: {},
          errorCode: "runtime_health_check_failed",
          errorMessage: `No health probe registered for ${ctx.runtime.runtimeId}.`,
        };
      }
      const outcome = await probe(ctx.runtime, ctx.mode, controller.signal);
      return {
        ok: outcome.ok,
        runtimeId: ctx.runtime.runtimeId,
        runtimeVersion: ctx.runtime.runtimeVersion,
        durationMs: Date.now() - start,
        details: outcome.details ?? {},
        errorCode: outcome.ok ? undefined : "runtime_health_check_failed",
        errorMessage: outcome.errorMessage,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          ok: false,
          runtimeId: ctx.runtime.runtimeId,
          runtimeVersion: ctx.runtime.runtimeVersion,
          durationMs: Date.now() - start,
          details: {},
          errorCode: "runtime_health_check_failed",
          errorMessage: "Health check timed out.",
        };
      }
      return {
        ok: false,
        runtimeId: ctx.runtime.runtimeId,
        runtimeVersion: ctx.runtime.runtimeVersion,
        durationMs: Date.now() - start,
        details: {},
        errorCode: "runtime_health_check_failed",
        errorMessage: (error as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
