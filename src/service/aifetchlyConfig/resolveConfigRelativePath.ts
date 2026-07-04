/**
 * STUB — RED phase of TDD for the config path-safety helper (CFG-05).
 *
 * The real implementation lands in the GREEN commit. This stub returns a
 * structured error so the happy-path assertions fail.
 */

export type ResolveConfigPathResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: string };

export function resolveConfigRelativePath(
  _rootPath: string,
  _relativePath: string
): ResolveConfigPathResult {
  return { ok: false, reason: "stub" };
}
