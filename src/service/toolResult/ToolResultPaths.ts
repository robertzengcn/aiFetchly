import "reflect-metadata";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  TOOL_OUTPUT_FILE_EXTENSIONS,
  TOOL_OUTPUT_MEDIA_TYPES,
} from "@/config/toolResultConfig";
import type { ToolOutputFormat } from "@/entityTypes/toolResultTypes";

/**
 * Private, app-managed storage paths for preserved tool outputs
 * (technical design §5.2).
 *
 * Layout:
 *   <root>/tool-results/<profile-key>/<conversation-epoch>/<output-id>/
 *       payload.txt | payload.json | payload.jsonl | payload.bin
 *       manifest.json
 *
 * EVERY path segment is generated internally. Producer names, model
 * arguments, conversation titles, and requested filenames are never
 * interpolated, so a tool cannot choose where its output lands and a hostile
 * title cannot escape the root. Profile keys are hashed for the same reason.
 *
 * File storage is deliberately SEPARATE from the `USERSDBPATH` database
 * location: switching profiles selects a different root and registry scope
 * without moving the database.
 */

/** Hash an arbitrary identity into a filesystem-safe, non-reversible segment. */
export function pathSegmentFor(identity: string): string {
  return crypto
    .createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/** File name for a captured format. Fixed mapping, never producer input. */
export function payloadFileName(format: ToolOutputFormat): string {
  const ext = TOOL_OUTPUT_FILE_EXTENSIONS[format] ?? "txt";
  return `payload.${ext}`;
}

/** Media type for a captured format. */
export function mediaTypeFor(format: ToolOutputFormat): string {
  return TOOL_OUTPUT_MEDIA_TYPES[format] ?? "text/plain; charset=utf-8";
}

/** Absolute directory for one artifact. */
export function artifactDirectory(input: {
  root: string;
  profileId: string;
  outputEpoch: string;
  outputId: string;
}): string {
  return path.join(
    input.root,
    "tool-results",
    pathSegmentFor(input.profileId),
    pathSegmentFor(input.outputEpoch),
    pathSegmentFor(input.outputId)
  );
}

/** Storage key stored in the registry: always relative to the managed root. */
export function storageKeyFor(input: {
  profileId: string;
  outputEpoch: string;
  outputId: string;
  format: ToolOutputFormat;
}): string {
  return path.join(
    "tool-results",
    pathSegmentFor(input.profileId),
    pathSegmentFor(input.outputEpoch),
    pathSegmentFor(input.outputId),
    payloadFileName(input.format)
  );
}

/** Resolve a stored key to an absolute path, refusing any escape. */
export function resolveStorageKey(root: string, storageKey: string): string {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, storageKey);
  // A traversal or absolute key must not resolve outside the managed root.
  if (resolved !== absoluteRoot && !resolved.startsWith(absoluteRoot + path.sep)) {
    throw new Error("storage key escapes the app-managed tool-result root");
  }
  return resolved;
}

/** Manifest file name inside an artifact directory. */
export const MANIFEST_FILE_NAME = "manifest.json";

/**
 * Verify that a resolved artifact path is a REGULAR FILE inside the managed
 * root. Rejects directories, devices, and symlink escapes — a symlink is
 * resolved first and then re-checked against the root, so a link pointing
 * outside the root cannot be served.
 */
export async function assertReadableRegularFile(
  root: string,
  storageKey: string
): Promise<string> {
  const resolved = resolveStorageKey(root, storageKey);
  let real: string;
  try {
    real = await fs.promises.realpath(resolved);
  } catch {
    throw new Error("artifact payload is missing");
  }
  const absoluteRoot = await fs.promises.realpath(root).catch(() => path.resolve(root));
  if (real !== absoluteRoot && !real.startsWith(absoluteRoot + path.sep)) {
    throw new Error("artifact payload escapes the app-managed tool-result root");
  }
  const stat = await fs.promises.stat(real);
  if (!stat.isFile()) {
    throw new Error("artifact payload is not a regular file");
  }
  return real;
}
