"use strict";
import "reflect-metadata";
// import {ipcMain as ipc} from 'electron-better-ipc';
import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  protocol,
  net,
} from "electron";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const globalShortcut = require("electron").globalShortcut;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const session = require("electron").session;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crashReporter = require("electron").crashReporter;
// import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from "electron-devtools-installer";
import { patchSessionExtensionsApi } from "@/main-process/devtools/patchSessionExtensionsApi";
import { registerCommunicationIpcHandlers } from "./main-process/communication/";
import { initializeAppUpdates } from "@/main-process/updater/AppUpdateService";
import { SkillImportService } from "@/service/SkillImportService";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import { getWorkspaceWatchManager } from "@/service/workspaceWatch/WorkspaceWatchManagerSingleton";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { FileOperationTracker } from "@/service/FileOperationTracker";
import { registerBuiltinHooks } from "@/service/hooks/builtinHooks";
import { isAppTrustedOrigin } from "@/service/OriginTrust";
import { buildAppContentSecurityPolicy } from "@/service/AppContentSecurityPolicy";
import { PasteStoreService } from "@/service/pastedText/PasteStoreService";
import * as path from "path";
import { pathToFileURL } from "url";
import { Token } from "@/modules/token";
import { MenuManager } from "@/main-process/menu/MenuManager";
import {
  USERSDBPATH,
  TOKENNAME,
  REFRESHTOKEN,
  TOKENEXPIRY,
  REFRESHTOKENEXPIRY,
} from "@/config/usersetting";
import { SqliteDb } from "@/config/SqliteDb";
import { logger, log } from "@/modules/Logger";
import { CrashReporterService } from "@/modules/diagnostics/CrashReporterService";
import {
  ensureDiagnosticsDirs,
  getStartupMarkerPath,
  getNativeDumpsDir,
} from "@/modules/diagnostics/DiagnosticPaths";
import {
  newSessionId,
  getOrCreateInstallId,
} from "@/modules/diagnostics/DiagnosticIdentity";
import { DiagnosticRetentionService } from "@/modules/diagnostics/DiagnosticRetentionService";
import fs from "fs";
import ProtocolRegistry from "protocol-registry";
//import { RemoteSource } from '@/modules/remotesource'
import { LOGIN_STATUS } from "@/config/channellist";
import { ScheduleManager } from "@/modules/ScheduleManager";
import { BackgroundScheduler } from "@/modules/BackgroundScheduler";
import { runafterbootup } from "@/modules/bootuprun";
import { YellowPagesController } from "./controller/YellowPagesController";
import {
  initializeWebSocketConnection,
  cleanupWebSocketConnection,
} from "@/main-process/communication/websocket-ipc";
import { TokenRefreshService } from "@/modules/tokenRefresh";
import { getDefaultToolJobRegistry } from "@/service/ToolJobRegistry";
import {
  getPendingDesktopAuth,
  clearPendingDesktopAuth,
} from "@/modules/pendingDesktopAuth";
import { consumeDesktopAuthCode } from "@/modules/desktopAuthExchange";
import {
  urlContainsTokenParams as deepLinkUrlContainsTokenParams,
  isValidDeepLinkOrigin as deepLinkIsValidDeepLinkOrigin,
} from "@/modules/deepLinkSecurity";
import {
  AI_CHAT_GENERATED_IMAGE_PROTOCOL,
  resolveGeneratedImageProtocolPath,
} from "@/service/AIChatGeneratedImageProtocol";
import { acquireSingleInstanceLock } from "@/main-process/singleInstanceGuard";
import type { SingleInstanceApp } from "@/main-process/singleInstanceGuard";

let chatScheduledBackgroundScheduler: BackgroundScheduler | null = null;
// import { RAGIpcHandlers } from '@/main-process/ragIpcHandlers';
// import { createProtocol } from 'electron';
const isDevelopment = process.env.NODE_ENV !== "production";
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
// import { safeStorage } from 'electron';

if (!app.isReady()) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AI_CHAT_GENERATED_IMAGE_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

// const { ipcRenderer: ipc } = require('electron-better-ipc');
// const { ipcMain } = require("electron");

// Handle Windows Squirrel install/update/uninstall/obsolete events first.
// These launch the app with special args; quit immediately so installer
// events don't run normal startup code or open extra windows.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (require("electron-squirrel-startup")) {
  (app as unknown as { quit: () => void }).quit();
}

// Get app name for protocol
const appName = app.getName();
const protocolScheme = appName.replace(/-/g, "").toLowerCase(); // Remove hyphens for protocol and convert to lowercase
// const protocolScheme = appName.replace(/-/g, ''); // Remove hyphens for protocol
(app as any).userAgentFallback = (app as any).userAgentFallback.replace(
  "Electron/" + process.versions.electron,
  ""
);
// Initialize logger (handles all logging configuration)
const logDir = logger.getLogDir();

// Console override and log verification are now handled by the Logger module

// Diagnostics: crash reporter, breadcrumb buffer, retention service.
// Initialized before any other code so uncaught exceptions during startup
// are captured. The diagnostics handlers are installed first; a separate
// user-facing dialog handler is registered below.
ensureDiagnosticsDirs();
const __sessionId = newSessionId();
const __diagnosticsRetention = new DiagnosticRetentionService();
const __crashReporter = new CrashReporterService({
  sessionId: __sessionId,
  installId: getOrCreateInstallId(),
  appVersion: (app as any).getVersion(),
  platform: process.platform,
  arch: process.arch,
});
(
  globalThis as unknown as {
    __aifetchlyCrashReporter: CrashReporterService;
  }
).__aifetchlyCrashReporter = __crashReporter;
__crashReporter.installProcessHandlers(process);
__diagnosticsRetention.schedule();

// Unclean shutdown detection: read previous session's startup marker (if any)
// and record an unclean shutdown record, then write this session's marker.
//
// PRODUCTION ONLY. During development (electron-forge start, the Cursor/VS Code
// debugger) the process is killed and restarted repeatedly without a graceful
// `before-quit`, so the marker would survive and surface a spurious "send
// crash report" prompt on every launch. In dev we neither consult nor write the
// marker, and clear any stale one so a later production launch can't misread a
// dev kill as a real unclean shutdown. `app.isPackaged` is the reliable signal
// here (NODE_ENV is not auto-set to "production" in packaged Electron builds).
const __startupMarker = getStartupMarkerPath();
if ((app as any).isPackaged) {
  let __previousSessionId: string | undefined;
  if (fs.existsSync(__startupMarker)) {
    try {
      const prev = JSON.parse(fs.readFileSync(__startupMarker, "utf8")) as {
        sessionId?: string;
      };
      __previousSessionId = prev.sessionId;
      __crashReporter.recordUncleanShutdown(__previousSessionId);
    } catch {
      __crashReporter.recordUncleanShutdown();
    }
  }
  fs.writeFileSync(
    __startupMarker,
    JSON.stringify({ sessionId: __sessionId, ts: Date.now() })
  );
} else {
  // Dev: clear any stale marker left by a previous (killed) run.
  try {
    fs.rmSync(__startupMarker, { force: true });
  } catch {
    /* ignore */
  }
}

log.info("Application starting...");

// Puppeteer registers process "exit" listeners per launched browser, and
// electron-store historically stacked ipcMain "electron-store-get-data"
// listeners when multiple Store copies were constructed. Raise the default
// limit early so legitimate multi-browser / store usage does not spam
// MaxListenersExceededWarning (store instances are also singleton-cached).
process.setMaxListeners(50);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ipcMain } = require("electron") as {
    ipcMain?: { setMaxListeners?: (n: number) => void };
  };
  ipcMain?.setMaxListeners?.(50);
} catch {
  // electron ipcMain unavailable in non-Electron test hosts
}

if (
  isDevelopment &&
  process.platform === "linux" &&
  process.env.LIBGL_ALWAYS_INDIRECT === "1"
) {
  log.info("[dev] Disabling GPU acceleration for indirect GL session");
  const appWithGpuControls = app as typeof app & {
    disableHardwareAcceleration: () => void;
    commandLine: {
      appendSwitch: (switchName: string) => void;
    };
  };
  appWithGpuControls.disableHardwareAcceleration();
  appWithGpuControls.commandLine.appendSwitch("disable-gpu");
}

// Handle uncaught exceptions — user-facing dialog only.
// Crash record persistence is handled by __crashReporter (registered above,
// which runs first as it was registered earlier).
process.on("uncaughtException", (error) => {
  if ((app as any).isReady()) {
    dialog.showErrorBox(
      "Application Error",
      `An unexpected error occurred: ${error.message}\n\nDetails have been logged.`
    );
  }
});

let win: BrowserWindow | null;

/**
 * Dev browser bridge instance (dev-only). Null in production or when the
 * bridge is disabled. Held at module scope so `before-quit` can stop it.
 * Typed structurally to avoid importing the bridge module at the top level
 * (NFR-1: keep bridge code out of production startup paths via dynamic import).
 */
let devBrowserBridge: { stop(): Promise<void> } | null = null;
let generatedImageProtocolHandlerRegistered = false;

function isGeneratedImageProtocolUrl(url: string): boolean {
  try {
    return new URL(url).protocol === `${AI_CHAT_GENERATED_IMAGE_PROTOCOL}:`;
  } catch {
    return false;
  }
}

function registerGeneratedImageProtocolHandler(): void {
  if (generatedImageProtocolHandlerRegistered) {
    return;
  }
  protocol.handle(AI_CHAT_GENERATED_IMAGE_PROTOCOL, async (request) => {
    const filePath = resolveGeneratedImageProtocolPath(
      request.url,
      app.getPath("userData")
    );
    if (!filePath) {
      return new Response("Generated image not found.", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
  generatedImageProtocolHandlerRegistered = true;
}

function registerMenuBarShortcuts(mainWindow: BrowserWindow): void {
  if (process.platform === "darwin") {
    return;
  }

  const setMenuBarHidden = (hidden: boolean): void => {
    // When autoHideMenuBar is true, the menu can still be revealed by Alt.
    // We additionally control visibility so it starts hidden by default.
    (mainWindow as any).setAutoHideMenuBar(hidden);
    (mainWindow as any).setMenuBarVisibility(!hidden);
  };

  // Default: hidden (callers may call this again later, it's idempotent)
  setMenuBarHidden(true);

  // Toggle menu bar visibility
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    if ((mainWindow as any).isDestroyed()) {
      return;
    }
    const currentlyVisible = (mainWindow as any).isMenuBarVisible();
    setMenuBarHidden(currentlyVisible);
  });

  // Show menu bar (quick access)
  globalShortcut.register("Alt+M", () => {
    if ((mainWindow as any).isDestroyed()) {
      return;
    }
    setMenuBarHidden(false);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isConnectionRefusedError(error: unknown): boolean {
  if (
    error instanceof Error &&
    error.message.includes("ERR_CONNECTION_REFUSED")
  ) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeElectronError = error as { code?: unknown; errno?: unknown };
  return (
    maybeElectronError.code === "ERR_CONNECTION_REFUSED" ||
    maybeElectronError.errno === -102
  );
}

function isBrowserWindowDestroyed(mainWindow: BrowserWindow): boolean {
  const destroyableWindow = mainWindow as BrowserWindow & {
    isDestroyed?: () => boolean;
  };

  return (
    typeof destroyableWindow.isDestroyed === "function" &&
    destroyableWindow.isDestroyed()
  );
}

async function loadDevServerUrl(
  mainWindow: BrowserWindow,
  devServerUrl: string
): Promise<void> {
  const maxAttempts = 20;
  const retryDelayMs = 250;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (isBrowserWindowDestroyed(mainWindow)) {
        return;
      }

      await mainWindow.loadURL(devServerUrl);
      return;
    } catch (error) {
      const shouldRetry =
        attempt < maxAttempts && isConnectionRefusedError(error);

      if (!shouldRetry) {
        throw error;
      }

      console.warn(
        `Vite dev server is not ready at ${devServerUrl}; retrying ` +
          `${attempt}/${maxAttempts}`
      );
      await delay(retryDelayMs);
    }
  }
}

function initialize() {
  // HMR guard: prevent re-initialization on Vite hot reload
  if ((globalThis as any).__aifetchlyAppInitialized) {
    log.info("[HMR] App already initialized, skipping re-init");
    return;
  }
  (globalThis as any).__aifetchlyAppInitialized = true;
  // protocol.registerSchemesAsPrivileged([

  //   { scheme: appName, privileges: { secure: true,
  //     standard: true } }
  // ])
  if ((app as any).isPackaged) {
    if (!(app as any).isDefaultProtocolClient(protocolScheme)) {
      const registres = (app as any).setAsDefaultProtocolClient(protocolScheme);
      //console.log('registres:', registres)
    }
  } else {
    console.log("protocolScheme:", protocolScheme);
    console.log("process.execPath:", process.execPath);
    console.log(
      "path.resolve(process.argv[1]):",
      path.resolve(process.argv[1])
    );
    console.log("path:", path.resolve(process.argv[1]));
    ProtocolRegistry.register(
      protocolScheme,
      `"${process.execPath}" "${path.resolve(process.argv[1])}" "$_URL_"`,
      {
        override: true,
        appName: appName,
        terminal: true,
      }
    )
      .then(() => console.log("Successfully registered"))
      .catch((e) => console.error(e));
    // app.setAsDefaultProtocolClient(protocolScheme);
  }
  makeSingleInstance();

  // Helper function to try alternative HTML file paths with detailed error handling
  async function tryAlternativePaths(
    win: BrowserWindow,
    originalPath: string,
    log: any,
    dialog: any
  ): Promise<void> {
    const alternativePaths = [
      path.join(__dirname, "../.vite/renderer/main_window/index.html"),
      path.join(__dirname, "../renderer/main_window/index.html"),
      path.join(__dirname, "./index.html"),
      path.join(
        (process as NodeJS.Process & { resourcesPath: string }).resourcesPath,
        "app.asar",
        ".vite",
        "renderer",
        "main_window",
        "index.html"
      ),
      path.join(
        (process as NodeJS.Process & { resourcesPath: string }).resourcesPath,
        ".vite",
        "renderer",
        "main_window",
        "index.html"
      ),
    ];

    //console.log('Trying alternative paths for HTML file...');
    // log.info('Trying alternative paths for HTML file. Original path was:', originalPath);

    let loaded = false;
    let lastError: Error | null = null;

    for (let i = 0; i < alternativePaths.length; i++) {
      const altPath = alternativePaths[i];
      console.log(
        `Trying alternative path ${i + 1}/${alternativePaths.length}:`,
        altPath
      );
      // log.info(`Trying alternative path ${i + 1}/${alternativePaths.length}:`, altPath);

      try {
        // Check if window is still valid before attempting to load
        if (win && !(win as any).isDestroyed()) {
          if (fs.existsSync(altPath)) {
            //console.log('Alternative path exists, attempting to load...');
            // log.info('Alternative path exists, attempting to load:', altPath);

            await (win as any).loadFile(altPath);
            console.log(
              "Successfully loaded HTML file from alternative path:",
              altPath
            );
            // log.info('Successfully loaded HTML file from alternative path:', altPath);
            loaded = true;
            break;
          } else {
            console.log("Alternative path does not exist:", altPath);
            // log.warn('Alternative path does not exist:', altPath);
          }
        } else {
          console.error("Window has been destroyed, cannot load file");
          // log.error('Window has been destroyed, cannot load file');
          lastError = new Error("Window has been destroyed");
          break;
        }
      } catch (error) {
        //console.error(`Failed to load from alternative path ${i + 1}:`, altPath);
        console.error("Error details:", error);
        // log.error(`Failed to load from alternative path ${i + 1}:`, altPath);
        // log.error('Error details:', error);
        lastError = error as Error;

        // If the error is "Object has been destroyed", break out of the loop
        if (
          error instanceof Error &&
          error.message.includes("Object has been destroyed")
        ) {
          console.error(
            "Window was destroyed during loading, stopping alternative path attempts"
          );
          // log.error('Window was destroyed during loading, stopping alternative path attempts');
          break;
        }
      }
    }

    if (!loaded) {
      const errorMsg = `Could not load HTML file from any path. Tried:\nOriginal: ${originalPath}\nAlternatives:\n${alternativePaths
        .map((p, i) => `${i + 1}. ${p}`)
        .join("\n")}`;
      console.error(errorMsg);
      // log.error(errorMsg);

      if (lastError) {
        console.error("Last error encountered:", lastError);
        // log.error('Last error encountered:', lastError);
      }

      dialog.showErrorBox(
        "Application Error",
        "Could not load the application interface. This may be due to a corrupted installation.\n\nPlease try:\n1. Reinstalling the application\n2. Running as administrator\n3. Checking antivirus software\n\nError details have been logged."
      );
      (app as any).quit();
    }
  }

  /** Prevents concurrent createWindow() races (e.g. whenReady + activate) that double-register ipcMain handlers. */
  let createWindowInFlight: Promise<void> | null = null;

  async function createWindow(): Promise<void> {
    const existingWindows = BrowserWindow.getAllWindows() as any[];
    if (existingWindows.length > 0) {
      const existing = existingWindows[0];
      if (!existing.isDestroyed()) {
        console.log("Window already exists and is valid, focusing...");
        if (!win) win = existing;
        existing.focus();
        return;
      }
    }
    if (createWindowInFlight) {
      await createWindowInFlight;
      const existingWindows2 = BrowserWindow.getAllWindows() as any[];
      if (existingWindows2.length > 0) {
        const existing = existingWindows2[0];
        if (!existing.isDestroyed()) {
          if (!win) win = existing;
          existing.focus();
        }
      }
      return;
    }
    createWindowInFlight = createWindowBody();
    try {
      await createWindowInFlight;
    } finally {
      createWindowInFlight = null;
    }
  }

  async function createWindowBody(): Promise<void> {
    // Create the browser window.
    win = new BrowserWindow({
      // Hide by default on Windows/Linux. (macOS uses the system menu bar.)
      autoHideMenuBar: process.platform !== "darwin",
      icon: path.join(__dirname, "/icon.png"),
      width: 800,
      height: 600,
      webPreferences: {
        // Use pluginOptions.nodeIntegration, leave this alone
        // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
        // nodeIntegration: (process.env
        //   .ELECTRON_NODE_INTEGRATION as unknown) as boolean,
        //  contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,

        // contextIsolation:false,
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname + "/preload.js"),
      },
    });

    if (win) {
      // Ensure menu bar is hidden by default + register shortcuts to show/toggle.
      registerMenuBarShortcuts(win);

      console.log(
        "Window exist, prepare to register communication ipc handlers"
      );
      // Check if USERSDBPATH is empty, create temp db path if needed
      const tokenService = new Token();
      let userdataPath = tokenService.getValue(USERSDBPATH);

      if (!userdataPath || userdataPath.length === 0) {
        // Create temporary database path
        const tempDbPath = path.join(app.getPath("userData"), "temp_db");
        try {
          // Ensure the directory exists
          if (!fs.existsSync(tempDbPath)) {
            fs.mkdirSync(tempDbPath, { recursive: true });
            log.info(`Created temporary database directory at: ${tempDbPath}`);
          }
          // Set the temporary path
          tokenService.setValue(USERSDBPATH, tempDbPath);
          userdataPath = tempDbPath;
          log.info(`Set temporary USERSDBPATH to: ${tempDbPath}`);
        } catch (err) {
          log.error(`Failed to create temporary database path: ${err}`);
          const errorMessage = err instanceof Error ? err.message : String(err);
          dialog.showErrorBox(
            "Configuration Error",
            `Failed to create temporary database directory: ${errorMessage}`
          );
        }
      }
      //if (userdataPath){//register communication ipc handlers
      registerCommunicationIpcHandlers(win);

      // INIT-01: Wire FileOperationTracker to the window's webContents
      FileOperationTracker.setWebContents(win.webContents);

      // Start the dev browser bridge (dev-only; no-op in production or when
      // disabled). Fire-and-forget so a bridge failure never blocks app startup.
      void startDevBrowserBridge(win).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[dev-browser] failed to start bridge: ${msg}`);
      });

      // Load persisted skills into runtime registry
      SkillImportService.loadPersistedSkills().catch((err: unknown) => {
        console.warn("[Startup] Failed to load persisted skills:", err);
      });
      PluginComponentRegistryService.applyLoadedPlugins().catch(
        (err: unknown) => {
          console.warn("[Startup] Failed to load persisted plugins:", err);
        }
      );

      // Phase 13 (Plan 03b): fire-and-forget the global ~/.aifetchly scan.
      // Never blocks app launch (Pitfall 6) and never throws synchronously —
      // manager.initialize() is idempotent and the scan degrades to an
      // empty snapshot on any IO error. Built-in slash commands and the
      // config-changed IPC handlers were registered above via
      // registerCommunicationIpcHandlers -> registerSlashCommandHandlers.
      //
      // Phase 14 (Plan 14-03): the watcher manager singleton was constructed
      // inside registerCommunicationIpcHandlers → initWorkspaceWatchManager.
      // Wire it into the config manager so /status reflects real watcher
      // state (DX-02). Non-fatal if the watcher is absent (defensive).
      const phase14ConfigManager = getAIFetchlyConfigManager();
      const phase14WatcherManager = getWorkspaceWatchManager();
      if (phase14WatcherManager) {
        phase14ConfigManager.setWorkspaceWatchManager(phase14WatcherManager);
      }
      phase14ConfigManager.initialize().catch((err: unknown) => {
        console.warn("[Startup] AIFetchly config scan failed:", err);
      });
      //}
    }

    // Add event listener for window destruction
    (win as any).on("closed", () => {
      console.log("Window closed event triggered");
      // INIT-02: Clear tracker webContents reference when window closes
      FileOperationTracker.clear();
      win = null;
    });
    // In this example, only windows with the `about:blank` url will be created.
    // All other urls will be blocked.
    (win as any).webContents.setWindowOpenHandler(({ url }) => {
      // F9 fix — only attach the privileged preload bridge to trusted app
      // origins. Untrusted child windows (any external URL, including
      // attacker-controlled pages opened via window.open from a compromised
      // renderer) must NOT receive window.api or any other privileged
      // surface, otherwise they can read or delete AI chat history, drive
      // shell/file tools, etc.
      //
      // The trusted set (about:/file:/app: schemes + the Vite dev-server
      // origin) is defined once in OriginTrust and shared with privileged
      // IPC handlers (e.g. MCP_TOOL_TRUST). Anything else is forwarded to
      // the OS browser via shell.openExternal and the in-app child
      // BrowserWindow is denied.
      const isTrustedOrigin = isAppTrustedOrigin(url);

      if (!isTrustedOrigin) {
        if (isGeneratedImageProtocolUrl(url)) {
          return { action: "deny" };
        }
        // Open externally WITHOUT preload. Never expose the IPC bridge to
        // arbitrary web content.
        // F9 fix (bypass) — validate scheme before handing the URL to the
        // OS handler. shell.openExternal will happily dispatch file://,
        // smb://, custom protocol handlers, etc., which can launch
        // arbitrary applications. Restrict to http/https.
        try {
          const parsed = new URL(url);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            shell.openExternal(url).catch(() => {
              /* ignore — best-effort external open */
            });
          } else {
            console.warn(
              `Refusing to open external URL with unsafe scheme: ${parsed.protocol}`
            );
          }
        } catch {
          /* ignore malformed URL */
        }
        return { action: "deny" };
      }

      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          backgroundColor: "black",
          webPreferences: {
            preload: path.join(__dirname + "/preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    });

    // console.log(process.env.WEBPACK_DEV_SERVER_UR)
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      // Load the url of the dev server if in development mode
      try {
        if (win && !(win as any).isDestroyed()) {
          await loadDevServerUrl(win, MAIN_WINDOW_VITE_DEV_SERVER_URL);
          if (!process.env.IS_TEST) (win as any).webContents.openDevTools();
        }
      } catch (error) {
        console.error("Failed to load URL:", error);
      }
    } else {
      // Initialize GitHub Releases auto-updater for packaged desktop builds.
      // The service self-gates on packaging state, platform, and Microsoft
      // Store channel, and is idempotent across repeated window creation.
      initializeAppUpdates();
      // console.log('app://./index.html')
      // createProtocol('app')
      // Load the index.html when not in development
      // In production, the renderer files are in .vite/renderer/main_window/
      const htmlPath = path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`
      );

      // console.log('=== HTML File Loading Debug Info ===');
      // console.log('App is packaged:', app.isPackaged);
      // console.log('MAIN_WINDOW_VITE_NAME:', MAIN_WINDOW_VITE_NAME);
      // console.log('__dirname:', __dirname);
      // console.log('process.resourcesPath:', process.resourcesPath);
      // console.log('Loading HTML from:', htmlPath);
      // log.info('=== HTML File Loading Debug Info ===');
      // log.info('App is packaged:', app.isPackaged);
      // log.info('MAIN_WINDOW_VITE_NAME:', MAIN_WINDOW_VITE_NAME);
      // log.info('__dirname:', __dirname);
      // log.info('process.resourcesPath:', process.resourcesPath);
      // log.info('Loading HTML from:', htmlPath);

      // Check if file exists before loading
      if (fs.existsSync(htmlPath)) {
        //console.log('HTML file exists, loading...');
        log.info("Attempting to load HTML file from:", htmlPath);

        try {
          // Check if window is still valid before attempting to load
          if (win && !(win as any).isDestroyed()) {
            await (win as any).loadFile(htmlPath);
            console.log("Successfully loaded HTML file from:", htmlPath);
            //log.info('Successfully loaded HTML file from:', htmlPath);
          } else {
            console.error("Window has been destroyed, cannot load file");
            //log.error('Window has been destroyed, cannot load file');
            dialog.showErrorBox(
              "Application Error",
              "The application window was destroyed before it could load. Please restart the application."
            );
            (app as any).quit();
            return;
          }
        } catch (error) {
          console.error(
            "Failed to load HTML file from primary path:",
            htmlPath
          );
          console.error("Error details:", error);
          // log.error('Failed to load HTML file from primary path:', htmlPath);
          // log.error('Error details:', error);

          // Check if the error is due to window destruction
          if (
            error instanceof Error &&
            error.message.includes("Object has been destroyed")
          ) {
            console.error("Window was destroyed during loading");
            //log.error('Window was destroyed during loading');
            dialog.showErrorBox(
              "Application Error",
              "The application window was destroyed during loading. Please restart the application."
            );
            (app as any).quit();
            return;
          }

          // Try alternative paths with detailed error handling
          //await tryAlternativePaths(win, htmlPath, log, dialog);
        }
      } else {
        console.error("HTML file not found at:", htmlPath);
        //log.error('HTML file not found at:', htmlPath);

        // Try alternative paths with detailed error handling
        await tryAlternativePaths(win, htmlPath, log, dialog);
      }
    }
  }

  // Quit when all windows are closed.
  (app as any).on("window-all-closed", () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== "darwin") {
      (app as any).quit();
    }
  });

  // Handle application shutdown
  (app as any).on("before-quit", async () => {
    // Remove startup marker on clean shutdown so the next launch does not
    // mistake a graceful exit for a crash.
    try {
      const __startupMarker = getStartupMarkerPath();
      if (fs.existsSync(__startupMarker)) fs.rmSync(__startupMarker);
    } catch {
      /* ignore */
    }

    // Stop the dev browser bridge (no-op if it never started).
    try {
      await devBrowserBridge?.stop();
    } catch (err) {
      log.warn("[dev-browser] bridge stop failed", err);
    }
    devBrowserBridge = null;

    // Stop periodic diagnostics retention cleanup timer immediately.
    __diagnosticsRetention.stop();

    // Terminate running async tool jobs first so workers are signalled early
    try {
      getDefaultToolJobRegistry().shutdown();
    } catch (err) {
      console.error("[shutdown] ToolJobRegistry shutdown failed", err);
    }

    // Clear any in-flight desktop auth handoff so the PKCE verifier does
    // not outlive the session.
    try {
      clearPendingDesktopAuth();
    } catch (err) {
      log.warn("[shutdown] clearPendingDesktopAuth failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const tokenService = new Token();
      const userdataPath = tokenService.getValue(USERSDBPATH);
      if (userdataPath && userdataPath.length > 0) {
        const scheduleManager = ScheduleManager.getInstance();
        await scheduleManager.handleAppShutdown();
        if (chatScheduledBackgroundScheduler) {
          await chatScheduledBackgroundScheduler.stop();
          chatScheduledBackgroundScheduler = null;
        }
        log.info("Schedulers shutdown completed");
      }
    } catch (error) {
      log.error("Failed to shutdown ScheduleManager:", error);
    }

    // Cleanup WebSocket connection
    try {
      cleanupWebSocketConnection();
      log.info("WebSocket connection cleanup completed");
    } catch (error) {
      log.error("Failed to cleanup WebSocket connection:", error);
    }

    // Phase 14 (Plan 14-03 WAT-07): gracefully shut down the workspace
    // watcher worker. The manager sends the shutdown command, awaits up to
    // 2s for clean exit, then SIGKILLs the worker if still alive — no
    // orphan workers persist after Electron exits. Non-fatal if the manager
    // was never constructed (defensive — early-shutdown edge case).
    try {
      const watcherManager = getWorkspaceWatchManager();
      if (watcherManager) {
        await watcherManager.shutdown();
        log.info("WorkspaceWatchManager shutdown completed");
      }
    } catch (error) {
      log.error("Failed to shutdown WorkspaceWatchManager:", error);
    }

    // Stop log cleanup interval
    logger.stopLogCleanup();
  });

  (app as any).on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  (app as any).on("open-url", (event, url) => {
    event.preventDefault();
    // Log only that a deep link arrived — never the URL itself, which now
    // carries the authorization code.
    log.info("[open-url] received deep link");
    handleDeepLink(url);
  });
  // app.on('second-instance', (event, argv) => {
  //   console.log("second-instance call")
  //   const url = argv.find(arg => arg.startsWith(`${protocolScheme}://`));
  //   if (url) {
  //     console.log(`App opened with URL on window: ${url}`);
  //     handleDeepLink(url)
  //   }
  //   if (win) {
  //     if (win.isMinimized()) win.restore();
  //     win.focus();
  //   }
  // })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  (app as any).whenReady().then(async () => {
    registerGeneratedImageProtocolHandler();

    // Configure Content Security Policy (must be called after app is ready)
    configureContentSecurityPolicy();

    // Install Electron app-level crash handlers (render-process-gone, etc.).
    __crashReporter.installAppHandlers(app as any);

    // Start Electron's native crashReporter to capture minidumps for the main
    // and render processes. Dumps stay local (no upload) and are routed to
    // the diagnostics folder for later inclusion in exported reports.
    try {
      crashReporter.start({
        uploadToServer: false,
        compress: true,
      });
      (app as any).setPath("crashDumps", getNativeDumpsDir());
    } catch (e) {
      log.warn("Failed to start Electron crashReporter", e);
    }

    // Register built-in lifecycle hooks (disabled by default; flip
    // them on at runtime via HookRegistry for manual QA). See
    // src/service/hooks/builtinHooks.ts.
    try {
      registerBuiltinHooks();
    } catch (err) {
      log.error(`Failed to register built-in hooks: ${err}`);
    }

    const tokenService = new Token();

    // Initialize and set application menu
    const menuManager = new MenuManager();
    const menu = menuManager.createMenu();
    Menu.setApplicationMenu(menu);

    createWindow();

    // Show crash prompt if there was an unclean shutdown (no-op otherwise).
    // Fire-and-forget so it never blocks app startup.
    void maybeShowCrashPrompt();

    // Schedule log cleanup (runs after 5 seconds delay, then every 24 hours)
    logger.scheduleLogCleanup();

    const userdataPath = tokenService.getValue(USERSDBPATH);
    if (userdataPath && userdataPath.length > 0) {
      console.log("userdataPath:", userdataPath);
      // Check if the user data path exists, create it if not
      try {
        if (!fs.existsSync(userdataPath)) {
          fs.mkdirSync(userdataPath, { recursive: true });
          log.info(`Created user data directory at: ${userdataPath}`);
        }
      } catch (err) {
        log.error(`Failed to create user data path: ${err}`);
        const errorMessage = err instanceof Error ? err.message : String(err);
        dialog.showErrorBox(
          "Configuration Error",
          `Failed to create user data directory: ${errorMessage}`
        );
      }
      const appDataSource = SqliteDb.getInstance(userdataPath);
      if (!appDataSource.connection.isInitialized) {
        await SqliteDb.ensureInitialized();
      }

      // Best-effort cache cleanup so stale paste expansions do not grow
      // without bound. Fire-and-forget so it never blocks startup.
      try {
        const pasteCacheRoot = path.join(userdataPath, "paste-cache");
        void new PasteStoreService(pasteCacheRoot).cleanupOldPastes();
      } catch (err) {
        log.warn(
          "[paste-cache] cleanupOldPastes init failed:",
          err instanceof Error ? err.message : String(err)
        );
      }

      // Seed built-in agent definitions (marketing subagent system).
      try {
        const { AgentDefinitionModule } = await import(
          "@/modules/AgentDefinitionModule"
        );
        const defModule = new AgentDefinitionModule();
        await defModule.ensureBuiltIns();
      } catch (err) {
        log.error("Failed to seed built-in agent definitions:", err);
      }

      // Phase 4: load persisted user hooks into the registry and
      // hydrate HookCommandTrustService from the DB. Must run AFTER
      // SqliteDb is initialized and AFTER builtin hooks are registered
      // (which happens via builtinHooks.ts at module init).
      try {
        const { HookModule } = await import("@/modules/HookModule");
        const hookModule = new HookModule();
        await hookModule.loadUserHooksIntoRegistry();

        // Activate the persistent audit logger now that the module is ready.
        const { HookAuditModule } = await import("@/modules/HookAuditModule");
        const { PersistentHookAuditLogger, setHookAuditLogger } = await import(
          "@/service/hooks/HookAuditService"
        );
        PersistentHookAuditLogger.setModule(new HookAuditModule());
        setHookAuditLogger(PersistentHookAuditLogger);

        log.info(
          "Hook subsystem loaded user hooks and persistent audit logger"
        );
      } catch (err) {
        log.error("Failed to load hook subsystem:", err);
      }

      // Initialize RAG IPC handlers
      // try {
      //   const ragHandlers = new RAGIpcHandlers(appDataSource);
      //   log.info('RAG IPC handlers initialized successfully');
      // } catch (error) {
      //   log.error('Failed to initialize RAG IPC handlers:', error);
      // }

      // Initialize the legacy scheduler and the interval-based Chat V2 scheduler.
      try {
        await runafterbootup();
        const scheduleManager = ScheduleManager.getInstance();
        await scheduleManager.initializeWithDatabaseStatus();
        chatScheduledBackgroundScheduler = new BackgroundScheduler(
          userdataPath
        );
        await chatScheduledBackgroundScheduler.start();
        log.info("Schedulers initialized with auto-start functionality");
      } catch (error) {
        log.error("Failed to initialize schedulers:", error);
      }

      // Check for orphaned Yellow Pages processes on startup
      try {
        const yellowPagesCtrl = YellowPagesController.getInstance();

        // Handle tasks from previous session first
        const previousSessionCount =
          await yellowPagesCtrl.handleTasksFromPreviousSession();
        log.info(
          `Yellow Pages previous session tasks handled: ${previousSessionCount} tasks marked as failed`
        );

        // Then check for orphaned processes
        const orphanedCheckResult =
          await yellowPagesCtrl.checkForOrphanedProcesses();
        log.info(
          "Yellow Pages orphaned process check completed:",
          orphanedCheckResult
        );
      } catch (error) {
        log.error(
          "Failed to check for orphaned Yellow Pages processes:",
          error
        );
      }

      // Initialize WebSocket connection to marketing server
      // This enables real-time notifications and updates
      if (win) {
        try {
          await initializeWebSocketConnection(win);
          log.info("WebSocket connection to marketing server initialized");
        } catch (error) {
          log.error("Failed to initialize WebSocket connection:", error);
        }
      }

      // Start background token auto-refresh for already-logged-in user (only if not already running)
      if (!TokenRefreshService.isAutoRefreshRunning()) {
        TokenRefreshService.startAutoRefresh();
      }
    }

    if (isDevelopment && !process.env.IS_TEST) {
      // Install Vue Devtools (route Session.* through session.extensions)
      try {
        patchSessionExtensionsApi(session.defaultSession);
        await installExtension(VUEJS3_DEVTOOLS);
      } catch (e) {
        if (e instanceof Error) {
          console.error("Vue Devtools failed to install:", e.toString());
        }
      }
    }
  });

  (app as any).on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  // Exit cleanly on request from parent process in development mode.
  if (isDevelopment) {
    if (process.platform === "win32") {
      process.on("message", (data) => {
        if (data === "graceful-exit") {
          (app as any).quit();
        }
      });
    } else {
      process.on("SIGTERM", () => {
        (app as any).quit();
      });
    }
  }
}

/**
 * Configure Content Security Policy for the application
 * This prevents the Electron security warning about missing CSP
 */
function configureContentSecurityPolicy() {
  const defaultSession = session.defaultSession;

  // Voice feature (PRD §16): allow microphone (audio) capture; deny camera
  // (video). Other permissions use a minimal allowlist instead of blanket-
  // approving, so unexpected requests (geolocation, midi, etc.) are denied.
  const ALLOWED_PERMISSIONS = new Set([
    "clipboard-sanitized",
    "clipboard-read",
    "fullscreen",
    "window-management",
    "openExternal",
  ]);
  defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback, details) => {
      if (permission === "media") {
        const wantsVideo =
          (
            details as { mediaTypes?: string[] } | undefined
          )?.mediaTypes?.includes("video") ?? false;
        callback(!wantsVideo);
        return;
      }
      callback(ALLOWED_PERMISSIONS.has(permission));
    }
  );

  // Set CSP based on environment. In development, Vite HMR needs a looser
  // script/connect policy; production keeps those restrictive.
  const cspDirectives = buildAppContentSecurityPolicy(isDevelopment);

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [cspDirectives],
      },
    });
  });

  log.info(
    `Content Security Policy configured for ${
      isDevelopment ? "development" : "production"
    } mode`
  );
}

function makeSingleInstance(): void {
  if ((process as NodeJS.Process & { mas: boolean }).mas) return;

  const gotThelock = acquireSingleInstanceLock(
    app as unknown as SingleInstanceApp
  );
  if (!gotThelock) {
    return;
  } else {
    // console.log('gotThelock:', gotThelock)

    (app as any).on("second-instance", (event, argv, workingDirectory) => {
      if (win) {
        if ((win as any).isMinimized()) (win as any).restore();
        (win as any).focus();
      }

      // console.log("second-instance call")
      // console.log('protocolScheme:', protocolScheme)
      // argv = argv.map(arg => typeof arg === 'string' ? arg.toLowerCase() : arg);
      const urlIndex = argv.findIndex(
        (arg) =>
          typeof arg === "string" &&
          arg.toLowerCase().startsWith(`${protocolScheme}://`)
      );
      if (urlIndex !== -1) {
        // Reconstruct URL if it was split by shell at '&' character
        // When shell splits at '&', the parts after become separate argv elements
        let url = argv[urlIndex];
        // Check if URL looks incomplete (missing query params that might have been split)
        // Reconstruct by joining subsequent argv elements that look like URL fragments
        for (let i = urlIndex + 1; i < argv.length; i++) {
          const nextArg = argv[i];
          // If next arg looks like a URL parameter (contains '=' and no path separators),
          // it's likely a continuation of the URL that was split at '&'
          if (
            nextArg.includes("=") &&
            !nextArg.includes("/") &&
            !nextArg.startsWith("-")
          ) {
            url += "&" + nextArg;
          } else {
            // Stop if we hit something that doesn't look like a URL fragment
            break;
          }
        }

        // Log only that a deep link arrived — the URL contains the
        // authorization code and must not be logged.
        log.info("[second-instance] received deep link on windows");
        handleDeepLink(url);
      } else {
        log.warn("[second-instance] no deep link URL found in argv");
      }
    });
  }
}

/**
 * Validate deep link URL origin to prevent malicious token injection.
 *
 * Thin wrapper around the shared validator in deepLinkSecurity.ts so the
 * protocolScheme (computed at module load from app.getName()) is bound in.
 */
function isValidDeepLinkOrigin(parsedUrl: URL): boolean {
  const ok = deepLinkIsValidDeepLinkOrigin(parsedUrl, protocolScheme);
  if (!ok) {
    log.error(
      "Invalid deep link origin:",
      parsedUrl.protocol,
      parsedUrl.host,
      parsedUrl.pathname
    );
  }
  return ok;
}

/**
 * Returns true iff `url` contains any of the bearer-token query keys that
 * the legacy insecure handoff used. The new flow only ever carries `code`
 * and `state`; presence of any token key is a hard reject.
 *
 * Delegated to deepLinkSecurity.ts so the rule is unit-tested in isolation.
 */
function urlContainsTokenParams(url: string): boolean {
  return deepLinkUrlContainsTokenParams(url);
}

/**
 * Clear all authentication tokens from storage
 */
function clearTokens(): void {
  try {
    // Stop background auto-refresh before clearing tokens
    TokenRefreshService.stopAutoRefresh();

    const tokenService = new Token();
    tokenService.setValue(TOKENNAME, "");
    tokenService.setValue(REFRESHTOKEN, "");
    tokenService.setValue(TOKENEXPIRY, "");
    tokenService.setValue(REFRESHTOKENEXPIRY, "");
    log.info("All tokens cleared successfully");
  } catch (error) {
    log.error("Failed to clear tokens:", error);
  }
}

async function handleDeepLink(url: string) {
  try {
    // Notify frontend that login processing has started
    if (win && !(win as any).isDestroyed()) {
      (win as any).webContents.send(LOGIN_STATUS, {
        status: "processing",
      });
    }

    // SECURITY: reject any deep link that carries bearer-token query keys.
    // The secure handoff transports ONLY an authorization code + state.
    if (urlContainsTokenParams(url)) {
      log.error(
        "Rejected deep link carrying bearer-token params (legacy/insecure shape)"
      );
      sendLoginError(
        "This login link is no longer supported. Please sign in again."
      );
      dialog.showErrorBox(
        "Login Link Expired",
        "This login link uses an outdated format and cannot be used. Please sign in again from the app."
      );
      clearPendingDesktopAuth();
      return;
    }

    const parsedUrl = new URL(url);

    // Validate deep link origin to prevent malicious token injection.
    if (!isValidDeepLinkOrigin(parsedUrl)) {
      log.error(
        "Invalid deep link origin:",
        parsedUrl.protocol,
        parsedUrl.host
      );
      sendLoginError("Invalid deep link origin. This link may be malicious.");
      dialog.showErrorBox(
        "Security Error",
        "Invalid deep link origin. This link may be malicious."
      );
      clearPendingDesktopAuth();
      return;
    }

    // Only `code` and `state` are ever read from the URL. Any other parameter
    // is treated as suspicious and the link is rejected.
    const code = parsedUrl.searchParams.get("code");
    const state = parsedUrl.searchParams.get("state");
    const allKeys = Array.from(parsedUrl.searchParams.keys());
    const forbiddenExtras = allKeys.filter(
      (k) => k !== "code" && k !== "state"
    );

    if (!code || !state) {
      log.error("Deep link missing code or state");
      sendLoginError("Login link is missing required parameters.");
      clearPendingDesktopAuth();
      return;
    }
    if (forbiddenExtras.length > 0) {
      log.error("Deep link contains unexpected query parameters");
      sendLoginError("Login link contains unexpected parameters.");
      clearPendingDesktopAuth();
      return;
    }

    // Delegate the rest (state validation, device fingerprint, exchange,
    // completion, pending cleanup) to the shared pipeline used by both
    // the loopback and custom-scheme paths. The pipeline clears pending
    // state before the async network exchange to close the TOCTOU window.
    const result = await consumeDesktopAuthCode({ code, state, win });

    if (!result.ok) {
      log.error("Desktop auth code consumption failed:", {
        reason: result.reason,
        message: result.message,
      });
      sendLoginError(result.message);
      if (result.reason === "state_mismatch") {
        dialog.showErrorBox("Security Error", result.message);
      } else if (
        result.reason === "invalid_grant" ||
        result.reason === "completion_failed"
      ) {
        dialog.showErrorBox("Login Failed", result.message);
        clearTokens();
      }
      return;
    }

    // Success — the pipeline navigates to Dashboard via completeDesktopLogin.
  } catch (error) {
    log.error("Failed to handle deep link:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Deep link handling error:", errorMessage);
    sendLoginError(`Failed to process authentication link: ${errorMessage}`);

    // Show error dialog to user
    if ((app as any).isReady()) {
      dialog.showErrorBox(
        "Deep Link Error",
        `Failed to process authentication link: ${errorMessage}`
      );
    }
    clearTokens();
    clearPendingDesktopAuth();
  }
}

function sendLoginError(message: string): void {
  if (win && !(win as any).isDestroyed()) {
    (win as any).webContents.send(LOGIN_STATUS, {
      status: "error",
      message,
    });
  }
}

/**
 * Show the "report crash" prompt if the previous session ended in an
 * unclean shutdown. No-op when there is no `unclean-shutdown` record on
 * disk (e.g. first launch or after a clean exit). The function is wrapped
 * in a try/catch so a failure in the diagnostics layer can never block
 * app startup — `maybeShowCrashPrompt` is invoked fire-and-forget via
 * `void` from `app.whenReady`.
 *
 * v1 note: this is not throttled by `lastPromptedCrashId`. The prompt
 * shows at most once per session that has an unread unclean-shutdown
 * record. Throttling is a P2 follow-up.
 */
async function maybeShowCrashPrompt(): Promise<void> {
  // Production only (see startup-marker logic above). Dev builds are killed
  // repeatedly without graceful shutdown, so prompting would be noise.
  if (!(app as any).isPackaged) return;
  try {
    const { CrashLogSink } = await import("@/modules/diagnostics/CrashLogSink");
    const records = CrashLogSink.readAll();
    const latest = records.find((r) => r.crashType === "unclean-shutdown");
    if (!latest) return;
    const choice = await dialog.showMessageBox({
      type: "question",
      title: "AiFetchly",
      message: "The app closed unexpectedly last time.",
      detail:
        "Send a diagnostics report to help us fix this? You can review what gets sent before sending.",
      buttons: ["Send report", "Export report", "Dismiss"],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice.response === 0) {
      const { uploadLatestUncleanShutdown } = await import(
        "@/main-process/communication/diagnostics-ipc"
      );
      await uploadLatestUncleanShutdown(latest.crashId);
    } else if (choice.response === 1) {
      const { exportLatestReport } = await import(
        "@/main-process/communication/diagnostics-ipc"
      );
      await exportLatestReport(latest.crashId);
    }
  } catch (e) {
    log.warn("[crash-prompt] failed", e);
  }
}

/**
 * Start the dev browser bridge if activation rules permit (PRD FR-1; design §4).
 *
 * Production isolation (NFR-1): the bridge modules are loaded via dynamic
 * import ONLY when the activation gate is satisfied, so packaged builds never
 * parse or load bridge code. The gate requires !app.isPackaged, the explicit
 * AIFETCHLY_DEV_BROWSER_BRIDGE=1 flag, a loopback host, and a derivable
 * allowed origin. When enabled, also taps webContents.send so main->renderer
 * events mirror to subscribed browser clients (FR-5).
 */
async function startDevBrowserBridge(mainWindow: BrowserWindow): Promise<void> {
  if (devBrowserBridge) return; // start once even across re-createWindow
  const { resolveDevBrowserActivation } = await import(
    "@/main-process/devtools/DevBrowserActivation"
  );
  const activation = resolveDevBrowserActivation({
    isPackaged: (app as any).isPackaged,
    env: process.env,
    devServerUrl:
      typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string"
        ? MAIN_WINDOW_VITE_DEV_SERVER_URL
        : undefined,
  });
  if (!activation.enabled || !activation.config) {
    // Diagnostic in dev only; the gate above already guarantees no production log.
    if (!(app as any).isPackaged) {
      log.info(`[dev-browser] ${activation.reason}`);
    }
    return;
  }

  const { DevBrowserBridge } = await import(
    "@/main-process/devtools/DevBrowserBridge"
  );
  const bridge = new DevBrowserBridge({ config: activation.config });
  const info = await bridge.start();
  bridge.attachEventRelay(
    mainWindow.webContents as unknown as { send: (...args: unknown[]) => void }
  );
  devBrowserBridge = bridge;

  log.info(
    `[dev-browser] bridge listening on ${info.baseUrl} (allowed origin: ${info.allowedOrigin})`
  );
  log.info(`[dev-browser] per-session token: ${info.token}`);
  log.info(
    `[dev-browser] open the app in a browser at ${info.allowedOrigin} (the Vite renderer URL); the renderer fetches its token from ${info.baseUrl}/__aifetchly_dev_bridge/config.`
  );
}

// makeSingleInstance()
// createWindow()
initialize();

//import { registerTaskIpcHandlers } from './main-process/communication/task-ipc'
