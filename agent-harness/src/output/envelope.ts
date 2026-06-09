/**
 * JSON envelope for --json output mode.
 * All CLI commands produce this envelope when --json is set.
 */

import type { JsonEnvelope } from '../common/types';

export function createEnvelope<T>(data: T, command: string): JsonEnvelope<T> {
  return {
    status: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      command,
    },
  };
}

export function createErrorEnvelope(error: string, command: string): JsonEnvelope<null> {
  return {
    status: false,
    data: null,
    error,
    meta: {
      timestamp: new Date().toISOString(),
      command,
    },
  };
}

/** Print JSON envelope to stdout */
export function printJson<T>(data: T, command: string): void {
  const envelope = createEnvelope(data, command);
  console.log(JSON.stringify(envelope, null, 2));
}

/** Print error JSON envelope to stderr */
export function printErrorJson(error: string, command: string): void {
  const envelope = createErrorEnvelope(error, command);
  process.stderr.write(JSON.stringify(envelope, null, 2) + '\n');
}
