/**
 * Runtime probe worker — Zod IPC schemas (design §13.3).
 *
 * The probe worker is a short-lived Electron utilityProcess spawned during
 * local-AI-runtime install/repair. Its only job: load a staged runtime's native
 * addon and report whether the required exports are present, then exit.
 *
 * Per CLAUDE.md, cross-process IPC payloads are validated with Zod on the
 * receiving side. The worker validates the inbound `probe` request; the main
 * process validates the outbound `result`.
 */
import { z } from "zod/v4";

/** Bound on the number of export names the parent may ask the worker to check. */
export const RUNTIME_PROBE_MAX_EXPORTS = 32;
export const RUNTIME_PROBE_MAX_ID_LENGTH = 128;
export const RUNTIME_PROBE_MAX_PATH_LENGTH = 1024;

// Main -> Worker -----------------------------------------------------------

export const runtimeProbeRequestSchema = z.object({
  type: z.literal("probe"),
  requestId: z.string().min(1).max(RUNTIME_PROBE_MAX_ID_LENGTH),
  /** Staged runtime root to load the native addon from. */
  runtimeRoot: z.string().min(1).max(RUNTIME_PROBE_MAX_PATH_LENGTH),
  /** Native module name to require() relative to <runtimeRoot>/package.json. */
  entryModule: z.string().min(1).max(RUNTIME_PROBE_MAX_ID_LENGTH),
  /** Export names that must be function-typed for the runtime to be usable. */
  requiredExports: z
    .array(z.string().min(1).max(RUNTIME_PROBE_MAX_ID_LENGTH))
    .max(RUNTIME_PROBE_MAX_EXPORTS)
    .default([]),
});
export type RuntimeProbeRequest = z.infer<typeof runtimeProbeRequestSchema>;

// Worker -> Main -----------------------------------------------------------

const runtimeProbeExportSchema = z.object({
  name: z.string().min(1).max(RUNTIME_PROBE_MAX_ID_LENGTH),
  present: z.boolean(),
});

export const runtimeProbeResultSchema = z.object({
  type: z.literal("result"),
  requestId: z.string().min(1).max(RUNTIME_PROBE_MAX_ID_LENGTH),
  ok: z.boolean(),
  errorMessage: z.string().max(RUNTIME_PROBE_MAX_PATH_LENGTH).optional(),
  exports: z.array(runtimeProbeExportSchema).max(RUNTIME_PROBE_MAX_EXPORTS),
});
export type RuntimeProbeResult = z.infer<typeof runtimeProbeResultSchema>;
