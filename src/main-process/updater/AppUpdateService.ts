/**
 * AppUpdateService — main-process adapter around `update-electron-app` that
 * owns product gating (packaged, platform, Microsoft Store channel) and logger
 * integration for GitHub Releases based auto-updates.
 *
 * The service is a thin policy layer. Release discovery, feed URL construction,
 * background download, and the restart prompt remain inside `update-electron-app`
 * and Electron's built-in auto-updater. The service never touches SQLite,
 * TypeORM, Models, Modules, or IPC handlers.
 *
 * See docs/prd/windows-macos-github-auto-upgrade-technical-design.md §7.
 */
import { app } from "electron";
import { log } from "@/modules/Logger";
import {
  updateElectronApp,
  UpdateSourceType,
  type ILogger,
} from "update-electron-app";

/**
 * `process.windowsStore` is set by Electron for Microsoft Store / MSIX builds.
 * It is not part of Node's typings, so declare the minimal structural shape.
 */
type ProcessWithWindowsStore = NodeJS.Process & {
  windowsStore?: boolean;
};

/** The public GitHub repository that owns the auto-update releases. */
const UPDATE_REPO = "robertzengcn/aiFetchly";

/** How often to poll update.electronjs.org once initialized. */
const DEFAULT_UPDATE_INTERVAL = "1 hour";

/**
 * Injectable options. Production callers omit this; tests and future build
 * channels pass explicit overrides so global process/app state is not mutated.
 */
export interface AppUpdateServiceOptions {
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  isWindowsStore?: boolean;
  updateInterval?: string;
}

export type AppUpdateInitializeReason =
  | "initialized"
  | "already-initialized"
  | "not-packaged"
  | "unsupported-platform"
  | "microsoft-store"
  | "initialization-error";

export interface AppUpdateInitializeResult {
  initialized: boolean;
  reason: AppUpdateInitializeReason;
  /** Stops periodic update checks. Undefined when initialization did not occur. */
  stopUpdates?: () => void;
}

/**
 * Cached handle returned by `updateElectronApp()`. Non-null means updates were
 * already initialized this main-process lifetime and a second call must no-op.
 */
let updateStopper: (() => void) | null = null;

/** Reads `app.isPackaged` without relying on the repo's narrowed `app` type. */
function readAppIsPackaged(): boolean {
  return (app as unknown as { isPackaged: boolean }).isPackaged;
}

/**
 * Bridge `update-electron-app`'s ILogger (single-string methods) into the
 * existing main-process logger, tagged so failures are diagnosable. No
 * credentials or tokens are ever passed through this logger.
 */
function createUpdateLogger(): ILogger {
  return {
    log: (message: string) => log.info("[auto-update]", message),
    info: (message: string) => log.info("[auto-update]", message),
    error: (message: string) => log.error("[auto-update]", message),
    warn: (message: string) => log.warn("[auto-update]", message),
  };
}

/**
 * Initialize GitHub Releases auto-updates exactly once per main-process
 * lifetime. Safe to call from packaged Windows and macOS GitHub builds only;
 * dev runs, unsupported platforms, and Microsoft Store builds skip early.
 *
 * Errors never block app startup — a failure is logged and reported as
 * `initialization-error`.
 */
export function initializeAppUpdates(
  options: AppUpdateServiceOptions = {}
): AppUpdateInitializeResult {
  if (updateStopper) {
    return {
      initialized: false,
      reason: "already-initialized",
      stopUpdates: updateStopper,
    };
  }

  // `app` is narrowed to a minimal shape by this repo's type setup (see
  // src/types/electron.d.ts and the pervasive `(app as any)` casts in
  // background.ts). Assert the packaged flag structurally instead of `any`.
  const isPackaged = options.isPackaged ?? readAppIsPackaged();
  if (!isPackaged) {
    return { initialized: false, reason: "not-packaged" };
  }

  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "darwin") {
    return { initialized: false, reason: "unsupported-platform" };
  }

  const isWindowsStore =
    options.isWindowsStore ??
    Boolean((process as ProcessWithWindowsStore).windowsStore);
  if (isWindowsStore) {
    log.info("[auto-update] Skipping GitHub updater for Microsoft Store build");
    return { initialized: false, reason: "microsoft-store" };
  }

  try {
    const updater = updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: UPDATE_REPO,
      },
      updateInterval: options.updateInterval ?? DEFAULT_UPDATE_INTERVAL,
      logger: createUpdateLogger(),
      notifyUser: true,
    });

    updateStopper = updater.stopUpdates;
    log.info("[auto-update] GitHub updater initialized");

    return {
      initialized: true,
      reason: "initialized",
      stopUpdates: updateStopper,
    };
  } catch (error: unknown) {
    log.error("[auto-update] Failed to initialize GitHub updater", error);
    return { initialized: false, reason: "initialization-error" };
  }
}
