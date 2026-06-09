/**
 * CLI config - resolves database directory path without Electron dependency.
 *
 * Resolution order:
 * 1. --db CLI flag (explicit)
 * 2. AIFETCHLY_DB environment variable
 * 3. Auto-detect platform default paths
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Resolve the database directory containing scraper.db */
export function resolveDbPath(explicitPath?: string): string {
  // 1. Explicit --db flag
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Database directory not found: ${resolved}`);
    }
    const dbFile = path.join(resolved, 'scraper.db');
    if (!fs.existsSync(dbFile)) {
      throw new Error(`Database file not found: ${dbFile}. Ensure aiFetchly has been run at least once.`);
    }
    return resolved;
  }

  // 2. Environment variable
  const envPath = process.env.AIFETCHLY_DB;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (fs.existsSync(path.join(resolved, 'scraper.db'))) {
      return resolved;
    }
    throw new Error(`AIFETCHLY_DB points to invalid path: ${resolved}`);
  }

  // 3. Auto-detect platform defaults
  const candidates = getPlatformDefaultPaths();
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'scraper.db'))) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find aiFetchly database. Use --db <path> or set AIFETCHLY_DB env var.\n' +
    'Searched: ' + candidates.join(', ')
  );
}

/** Get platform-specific default database paths */
function getPlatformDefaultPaths(): string[] {
  const home = os.homedir();
  const platform = process.platform;

  switch (platform) {
    case 'win32': {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return [
        path.join(appData, 'aiFetchly'),
        path.join(appData, 'AiFetchly'),
      ];
    }
    case 'darwin':
      return [
        path.join(home, 'Library', 'Application Support', 'aiFetchly'),
        path.join(home, 'Library', 'Application Support', 'AiFetchly'),
      ];
    default: // linux
      return [
        path.join(home, '.config', 'aiFetchly'),
        path.join(home, '.config', 'AiFetchly'),
        path.join(home, '.local', 'share', 'aiFetchly'),
      ];
  }
}

/** Check if the Electron app is likely running (database WAL file exists) */
export function isDatabaseInUse(dbDir: string): boolean {
  const walPath = path.join(dbDir, 'scraper.db-wal');
  const shmPath = path.join(dbDir, 'scraper.db-shm');
  return fs.existsSync(walPath) || fs.existsSync(shmPath);
}

/** Get database file stats */
export function getDatabaseStats(dbDir: string): {
  dbSize: number;
  walSize: number;
  lastModified: Date;
} | null {
  const dbPath = path.join(dbDir, 'scraper.db');
  if (!fs.existsSync(dbPath)) return null;

  const stat = fs.statSync(dbPath);
  const walPath = path.join(dbDir, 'scraper.db-wal');
  const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;

  return {
    dbSize: stat.size,
    walSize,
    lastModified: stat.mtime,
  };
}
