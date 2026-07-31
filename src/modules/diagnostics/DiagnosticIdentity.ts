'use strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { getInstallIdPath, ensureDiagnosticsDirs } from './DiagnosticPaths';

/**
 * Generate a new RFC 4122 v4 session id.
 */
export function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Returns a stable install id, persisting it on first call. Never throws; on
 * any IO failure, returns a transient random id so callers stay alive.
 */
export function getOrCreateInstallId(): string {
  try {
    ensureDiagnosticsDirs();
    const p = getInstallIdPath();
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v.length > 0 && v.length <= 128) return v;
    }
    const id = crypto.randomUUID();
    fs.writeFileSync(p, id, { encoding: 'utf8' });
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
