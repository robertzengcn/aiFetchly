'use strict';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let cachedDir: string | null = null;

/**
 * Resolve the diagnostics directory. Test override via $AIFETCHLY_DIAGNOSTICS_DIR.
 * Falls back to Electron's userData()/diagnostics when Electron is available,
 * otherwise to os.tmpdir()/aifetchly-diagnostics.
 */
export function getDiagnosticsDir(): string {
  if (cachedDir) return cachedDir;
  const override = process.env.AIFETCHLY_DIAGNOSTICS_DIR;
  if (override) {
    cachedDir = override;
    return cachedDir;
  }
  let base: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    const app = electron?.app;
    if (app && typeof app.getPath === 'function') {
      base = app.getPath('userData');
    } else {
      base = os.tmpdir();
    }
  } catch {
    base = os.tmpdir();
  }
  cachedDir = path.join(base, 'diagnostics');
  return cachedDir;
}

export function ensureDiagnosticsDirs(): void {
  const dir = getDiagnosticsDir();
  const sub = path.join(dir, 'native-dumps');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(sub)) fs.mkdirSync(sub, { recursive: true });
}

export function getCrashLogPath(): string {
  return path.join(getDiagnosticsDir(), 'crash.jsonl');
}

export function getErrorLogPath(): string {
  return path.join(getDiagnosticsDir(), 'error.jsonl');
}

export function getStartupMarkerPath(): string {
  return path.join(getDiagnosticsDir(), '.startup-marker');
}

export function getInstallIdPath(): string {
  return path.join(getDiagnosticsDir(), 'install-id.txt');
}

export function getNativeDumpsDir(): string {
  return path.join(getDiagnosticsDir(), 'native-dumps');
}

/**
 * Test-only: force a directory override (also settable via env).
 * Pass an empty string to clear the cache and re-read from env/auto-detect.
 */
export function __setDiagnosticsDirForTests(dir: string): void {
  cachedDir = dir || null;
}
