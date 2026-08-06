import * as path from "path";

export function getPackagedWorkerNodePath(
  resourcesPath: string,
  existingNodePath?: string
): string {
  const nodeModulePaths = [
    path.join(resourcesPath, "app.asar", "node_modules"),
    path.join(resourcesPath, "app.asar.unpacked", "node_modules"),
    existingNodePath,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return nodeModulePaths.join(path.delimiter);
}

export interface PackagedWorkerPathRuntime {
  dirname: string;
  cwd: string;
  resourcesPath?: string;
  existsSync: (candidate: string) => boolean;
}

export interface PackagedWorkerPathOptions {
  dirnameRelativePaths: readonly string[];
  cwdRelativePaths: readonly string[];
  resourcesRelativePaths?: readonly string[];
}

export function mirrorAppAsarUnpackedPath(candidate: string): string {
  return candidate.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

export function getPackagedWorkerPathCandidates(
  runtime: PackagedWorkerPathRuntime,
  options: PackagedWorkerPathOptions
): string[] {
  const candidates: string[] = [];
  const addCandidate = (candidate: string): void => {
    const normalized = path.normalize(candidate);
    const unpacked = mirrorAppAsarUnpackedPath(normalized);

    // Prefer the app.asar virtual path over the app.asar.unpacked disk mirror.
    // When a script is loaded through the virtual asar path, Electron patches
    // fs/module resolution so `require()` walks up through app.asar and finds
    // app.asar/node_modules. Loading the unpacked disk mirror breaks that
    // fallback and hides deps shipped inside the packed asar (e.g. puppeteer).
    // See contactExtractionWorkerPath.ts for the canonical ordering.
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
    if (unpacked !== normalized && !candidates.includes(unpacked)) {
      candidates.push(unpacked);
    }
  };

  for (const relativePath of options.dirnameRelativePaths) {
    addCandidate(path.join(runtime.dirname, relativePath));
  }
  for (const relativePath of options.cwdRelativePaths) {
    addCandidate(path.join(runtime.cwd, relativePath));
  }

  if (runtime.resourcesPath) {
    for (const relativePath of options.resourcesRelativePaths ??
      options.cwdRelativePaths) {
      // addCandidate normalizes the asar path ahead of its unpacked mirror,
      // so passing the virtual path first is the documented preferred order.
      addCandidate(path.join(runtime.resourcesPath, "app.asar", relativePath));
      addCandidate(
        path.join(runtime.resourcesPath, "app.asar.unpacked", relativePath)
      );
    }
  }

  return candidates;
}

export function resolvePackagedWorkerPath(
  runtime: PackagedWorkerPathRuntime,
  options: PackagedWorkerPathOptions
): string | null {
  const candidates = getPackagedWorkerPathCandidates(runtime, options);

  for (const candidate of candidates) {
    if (runtime.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
