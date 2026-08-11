/**
 * Runtime probe worker — protocol types.
 *
 * Shared between the worker entry (`RuntimeProbeWorker.ts`) and the main-process
 * probe driver (`DisposableVoiceRuntimeProbe.ts`). The wire types are derived
 * from the Zod schemas in `src/schemas/worker/runtimeProbe.ts` (CLAUDE.md:
 * derive TS types from schemas, validate at the process boundary).
 *
 * WHY THIS WORKER EXISTS — a require()'d native `.node` addon is memory-mapped
 * into its host process and file-locked for the process lifetime on Windows.
 * Loading the voice runtime's native addon in the *main* process during install
 * made the subsequent `fs.rename(staging -> versionRoot)` fail with EPERM. This
 * disposable worker performs that load in a child process; when the worker
 * exits, the OS releases the lock so the main process can complete the rename.
 *
 * Boundary rule (CLAUDE.md): worker-process code. No SQLite / TypeORM / Model /
 * Module imports, no token or chat-history access.
 */
export type {
  RuntimeProbeRequest,
  RuntimeProbeResult,
} from "@/schemas/worker/runtimeProbe";
