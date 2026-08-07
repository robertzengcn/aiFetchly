/**
 * Resolve the packaged renderer index.html path for BrowserWindow.loadFile.
 *
 * Workers prefer the app.asar virtual path (require resolution). Chromium's
 * loadFile does the opposite: when a file was asar-unpacked, loading via the
 * app.asar virtual URL fails with ERR_FAILED (-2) even though Node fs.existsSync
 * still returns true. Prefer the real app.asar.unpacked disk path when present.
 */

import * as path from "path";
import { mirrorAppAsarUnpackedPath } from "@/utils/packagedWorkerPath";

export interface PackagedRendererPathRuntime {
  dirname: string;
  resourcesPath?: string;
  existsSync: (candidate: string) => boolean;
}

/**
 * Prefer the asar.unpacked mirror when it exists on disk; otherwise keep the
 * primary (usually app.asar) path so packed renderer builds still load.
 */
export function preferUnpackedRendererPath(
  candidate: string,
  existsSync: (path: string) => boolean
): string {
  const normalized = path.normalize(candidate);
  const unpacked = mirrorAppAsarUnpackedPath(normalized);
  if (unpacked !== normalized && existsSync(unpacked)) {
    return unpacked;
  }
  return normalized;
}

/**
 * Build ordered HTML path candidates for the main window renderer.
 * First existing candidate (after unpacked preference) should be tried by
 * loadFile; callers may still fall back through the full list on failure.
 */
export function getPackagedRendererHtmlCandidates(
  runtime: PackagedRendererPathRuntime,
  viteName: string
): string[] {
  const resourcesPath = runtime.resourcesPath;
  const rawCandidates = [
    path.join(runtime.dirname, `../renderer/${viteName}/index.html`),
    path.join(runtime.dirname, `../.vite/renderer/${viteName}/index.html`),
    path.join(runtime.dirname, "./index.html"),
  ];

  if (resourcesPath) {
    rawCandidates.push(
      path.join(
        resourcesPath,
        "app.asar",
        ".vite",
        "renderer",
        viteName,
        "index.html"
      ),
      path.join(
        resourcesPath,
        "app.asar.unpacked",
        ".vite",
        "renderer",
        viteName,
        "index.html"
      ),
      path.join(resourcesPath, ".vite", "renderer", viteName, "index.html")
    );
  }

  const ordered: string[] = [];
  const add = (candidate: string): void => {
    const preferred = preferUnpackedRendererPath(candidate, runtime.existsSync);
    if (!ordered.includes(preferred)) {
      ordered.push(preferred);
    }
    const normalized = path.normalize(candidate);
    if (!ordered.includes(normalized)) {
      ordered.push(normalized);
    }
  };

  for (const candidate of rawCandidates) {
    add(candidate);
  }

  return ordered;
}

/**
 * Pick the first candidate that exists for loadFile.
 */
export function resolvePackagedRendererHtmlPath(
  runtime: PackagedRendererPathRuntime,
  viteName: string
): string | null {
  for (const candidate of getPackagedRendererHtmlCandidates(
    runtime,
    viteName
  )) {
    if (runtime.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
