import "reflect-metadata";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Environment variable that overrides the tool-output storage root.
 *
 * The E2E bootstrap sets this (in {@link E2EMain}) to a path DERIVED from the
 * validated E2E root — never to an arbitrary caller-supplied path — so test
 * artifacts isolate to the per-test temp root instead of leaking into the real
 * `~/.aifetchly/tool-outputs`. In production this variable is unset and the
 * home-directory default applies. The value is only honored when it points to
 * a path that already exists on disk (the bootstrap creates it before launch),
 * so a stale/malformed value never silently relocates outputs.
 */
export const TOOL_OUTPUT_ROOT_ENV = "AIFETCHLY_TOOL_OUTPUT_ROOT";

/**
 * Resolve the app-managed root for preserved tool outputs.
 *
 * Deliberately SEPARATE from the `USERSDBPATH` database location: file storage
 * and quotas are independent of where the SQLite file lives, and changing
 * profiles must select a different root without moving the database.
 *
 * The root is resolved in the main process and injected into the storage
 * service, so a test never has to touch the real user directory.
 *
 * In E2E the bootstrap redirects this root into the per-test temp tree by
 * setting {@link TOOL_OUTPUT_ROOT_ENV}; see {@link E2EMain}.
 */
export function getToolResultStorageRoot(): string {
  const override = process.env[TOOL_OUTPUT_ROOT_ENV];
  if (override) {
    // Only honor an override that resolves to an existing directory on disk.
    // The E2E bootstrap creates the directory before launching the app; a stale
    // or malformed value falls back to the home-directory default rather than
    // pointing storage at a nonexistent path (which would fail on first write).
    try {
      const stats = fs.statSync(override);
      if (stats.isDirectory()) {
        return path.resolve(override);
      }
    } catch {
      // fall through to the default
    }
  }
  return path.join(os.homedir(), ".aifetchly", "tool-outputs");
}
