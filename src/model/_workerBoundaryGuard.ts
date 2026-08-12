/**
 * Worker-process database boundary guard (CLAUDE.md "Child/Worker Process
 * Database Access — MANDATORY RULE").
 *
 * New Models MUST reject direct database access when running inside a worker
 * process. Worker processes have no Electron `app` / Token context and must
 * route all CRUD through the main process via IPC. Calling this from a Model
 * constructor (or any repository accessor) keeps that contract enforced at the
 * data-access layer rather than relying on callers to remember it.
 */
export function rejectDatabaseAccessFromWorker(context: string): void {
  if (process.env.WORKER_TYPE) {
    throw new Error(
      `Direct database access from worker process is not allowed (${context}). ` +
        "Worker should send data to the main process via IPC; the main process " +
        "persists it through Modules/Models."
    );
  }
}
