/**
 * sha256Hex — the one canonical content-hash incantation for the skill
 * subsystem (review D3 dedup): seven new files had grown private copies of
 * `crypto.createHash("sha256").update(x).digest("hex")`. Algorithm and
 * encoding changes (slice lengths, encoding) now have a single owner.
 */

import * as crypto from "crypto";

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** True when `candidate` resolves lexically at or under `root` (adds the
 *  trailing separator so a sibling like `<root>-evil` never matches).
 *  Platform-aware comparison is the CALLER's concern when case-insensitive
 *  filesystems matter; every current caller compares already-canonical
 *  paths. */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootWithSep = root.endsWith("/") || root.endsWith("\\")
    ? root
    : root + "/";
  return candidate === root || candidate.startsWith(rootWithSep);
}
