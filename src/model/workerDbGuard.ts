/**
 * Worker-process database-access guard (CLAUDE.md
 * "Child/Worker Process Database Access - MANDATORY RULE").
 *
 * Worker processes must never access scheduled-loop tables directly. They
 * communicate results to the main process via IPC, which performs all CRUD
 * through Models/Modules. Models call this guard before repository work so a
 * mistaken worker import fails loudly instead of silently corrupting state.
 */
export function assertNotWorker(operation: string): void {
  if (process.env.WORKER_TYPE) {
    throw new Error(
      `Direct database access from worker process is not allowed (${operation}). ` +
        "Send data to the main process via IPC instead."
    );
  }
}
