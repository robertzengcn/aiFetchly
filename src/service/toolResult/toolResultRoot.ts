import "reflect-metadata";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Resolve the app-managed root for preserved tool outputs.
 *
 * Deliberately SEPARATE from the `USERSDBPATH` database location: file storage
 * and quotas are independent of where the SQLite file lives, and changing
 * profiles must select a different root without moving the database.
 *
 * The root is resolved in the main process and injected into the storage
 * service, so a test never has to touch the real user directory.
 */
export function getToolResultStorageRoot(): string {
  return path.join(os.homedir(), ".aifetchly", "tool-outputs");
}
