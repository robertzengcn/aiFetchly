export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
}

/**
 * Acquire the process lock before registering application services.
 *
 * This must run in development too. Skipping it lets a second Electron
 * process open the same user profile and register a second set of IPC and
 * background services.
 */
export function acquireSingleInstanceLock(app: SingleInstanceApp): boolean {
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) {
    app.quit();
  }
  return acquired;
}
