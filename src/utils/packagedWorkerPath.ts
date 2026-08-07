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

export interface BuildPackagedWorkerEnvOptions {
  /**
   * Extra env vars merged on top of process.env (e.g. WORKER_TYPE, tokens).
   * Cannot override NODE_PATH / NODE_OPTIONS / ELECTRON_RUN_AS_NODE — those are
   * forced by this helper so packaged workers always resolve app.asar deps.
   */
  extraEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /**
   * When true, set ELECTRON_RUN_AS_NODE=1 for child_process.spawn workers that
   * run Electron's binary as plain Node (GoogleMaps, ContactExtraction, etc.).
   */
  runAsNode?: boolean;
  /** Injectable for unit tests. Defaults to process.resourcesPath. */
  resourcesPath?: string;
  /** Injectable for unit tests. Defaults to process.env.NODE_PATH. */
  existingNodePath?: string;
  /** Injectable for unit tests. Defaults to process.env. */
  processEnv?: NodeJS.ProcessEnv;
}

/**
 * Best-effort Electron app defaults for worker env.
 *
 * Utility/taskCode workers construct Token → ElectronStoreService. That path
 * needs ELECTRON_APP_NAME / ELECTRON_USER_DATA_PATH when ipcMain is absent
 * (utilityProcess), otherwise electron-store/conf cannot locate the main
 * process store. Call sites may still override via extraEnv.
 */
function tryGetElectronWorkerEnvDefaults(): {
  ELECTRON_APP_NAME?: string;
  ELECTRON_USER_DATA_PATH?: string;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require("electron") as {
      app?: {
        getName?: () => string;
        getPath?: (name: string) => string;
      };
    };
    if (!app) {
      return {};
    }
    const defaults: {
      ELECTRON_APP_NAME?: string;
      ELECTRON_USER_DATA_PATH?: string;
    } = {};
    if (typeof app.getName === "function") {
      const name = app.getName();
      if (typeof name === "string" && name.trim().length > 0) {
        defaults.ELECTRON_APP_NAME = name;
      }
    }
    if (typeof app.getPath === "function") {
      try {
        const userData = app.getPath("userData");
        if (typeof userData === "string" && userData.trim().length > 0) {
          defaults.ELECTRON_USER_DATA_PATH = userData;
        }
      } catch {
        // Some process types expose app without a working getPath.
      }
    }
    return defaults;
  } catch {
    return {};
  }
}

/**
 * Canonical env for every packaged child/utility worker spawn/fork.
 *
 * Unpacked workers under app.asar.unpacked cannot resolve bare requires for
 * deps that only live in app.asar/node_modules (classic Windows
 * MODULE_NOT_FOUND for puppeteer). Always set NODE_PATH via
 * getPackagedWorkerNodePath. Call sites must use this helper — see
 * PackagedWorkerEnvGuard.test.ts.
 *
 * Also fills ELECTRON_APP_NAME / ELECTRON_USER_DATA_PATH from electron.app
 * when missing so Token/electron-store works in utilityProcess workers
 * (e.g. taskCode search scraper + AiSupportBridge).
 */
export function buildPackagedWorkerEnv(
  options: BuildPackagedWorkerEnvOptions = {}
): NodeJS.ProcessEnv {
  const processEnv = options.processEnv ?? process.env;
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };
  const resourcesPath = options.resourcesPath ?? electronProcess.resourcesPath;
  const existingNodePath =
    options.existingNodePath !== undefined
      ? options.existingNodePath
      : processEnv.NODE_PATH;
  const packagedNodePath = resourcesPath
    ? getPackagedWorkerNodePath(resourcesPath, existingNodePath)
    : existingNodePath;

  const env: NodeJS.ProcessEnv = {
    ...processEnv,
    ...options.extraEnv,
    NODE_OPTIONS: "",
    NODE_PATH: packagedNodePath,
  };

  if (options.runAsNode) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }

  const electronDefaults = tryGetElectronWorkerEnvDefaults();
  if (
    (!env.ELECTRON_APP_NAME || env.ELECTRON_APP_NAME.trim() === "") &&
    electronDefaults.ELECTRON_APP_NAME
  ) {
    env.ELECTRON_APP_NAME = electronDefaults.ELECTRON_APP_NAME;
  }
  if (
    (!env.ELECTRON_USER_DATA_PATH ||
      env.ELECTRON_USER_DATA_PATH.trim() === "") &&
    electronDefaults.ELECTRON_USER_DATA_PATH
  ) {
    env.ELECTRON_USER_DATA_PATH = electronDefaults.ELECTRON_USER_DATA_PATH;
  }

  return env;
}
