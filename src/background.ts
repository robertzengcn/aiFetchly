'use strict'
import 'reflect-metadata';
// import {ipcMain as ipc} from 'electron-better-ipc';
import { app, BrowserWindow, Menu, dialog } from 'electron';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const autoUpdater = require('electron').autoUpdater;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const session = require('electron').session;
// import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
import { registerCommunicationIpcHandlers } from "./main-process/communication/";
import * as path from 'path';
import { Token } from "@/modules/token"
import { MenuManager } from "@/main-process/menu/MenuManager";
import { USERSDBPATH, TOKENNAME, REFRESHTOKEN, TOKENEXPIRY, REFRESHTOKENEXPIRY } from '@/config/usersetting';
import { DeviceFingerprintService } from '@/modules/deviceFingerprint';
import { DeviceApi } from '@/api/deviceApi';
import { SqliteDb } from "@/config/SqliteDb"
import { logger, log } from '@/modules/Logger';
import fs from 'fs';
import ProtocolRegistry from 'protocol-registry'
//import { RemoteSource } from '@/modules/remotesource'
import { UserController } from '@/controller/UserController';
import { NATIVATECOMMAND } from '@/config/channellist'
import { NativateDatatype } from '@/entityTypes/commonType'
import { ScheduleManager } from '@/modules/ScheduleManager';
import { runafterbootup } from "@/modules/bootuprun"
import { YellowPagesController } from './controller/YellowPagesController';
import { initializeWebSocketConnection, cleanupWebSocketConnection } from '@/main-process/communication/websocket-ipc';
import { TokenRefreshService } from '@/modules/tokenRefresh';
// import { RAGIpcHandlers } from '@/main-process/ragIpcHandlers';
// import { createProtocol } from 'electron';
const isDevelopment = process.env.NODE_ENV !== 'production'
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
// import { safeStorage } from 'electron';

// const { ipcRenderer: ipc } = require('electron-better-ipc');
// const { ipcMain } = require("electron");

// Get app name for protocol
const appName = app.getName();
const protocolScheme = appName.replace(/-/g, '').toLowerCase(); // Remove hyphens for protocol and convert to lowercase
// const protocolScheme = appName.replace(/-/g, ''); // Remove hyphens for protocol
(app as any).userAgentFallback = (app as any).userAgentFallback.replace('Electron/' + process.versions.electron, '');
// Initialize logger (handles all logging configuration)
const logDir = logger.getLogDir();

// Console override and log verification are now handled by the Logger module

log.info('Application starting...');

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);

  // Show error dialog if possible
  if ((app as any).isReady()) {
    dialog.showErrorBox('Application Error',
      `An unexpected error occurred: ${error.message}\n\nDetails have been logged.`);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Promise Rejection:', reason);
});

let win: BrowserWindow | null;
function initialize() {
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
  console.log('protocolScheme:', protocolScheme)
   console.log('process.execPath:', process.execPath)
   console.log('path.resolve(process.argv[1]):', path.resolve(process.argv[1]))
    console.log('path:', path.resolve(process.argv[1]))
    ProtocolRegistry.register(protocolScheme, `"${process.execPath}" "${path.resolve(process.argv[1])}" "$_URL_"`,
      {
        override: true,
        appName: appName,
        terminal: true,
      }
    ).then(() => console.log('Successfully registered'))
      .catch(e => console.error(e));
    // app.setAsDefaultProtocolClient(protocolScheme);
  }
  makeSingleInstance()

  // Helper function to try alternative HTML file paths with detailed error handling
  async function tryAlternativePaths(win: BrowserWindow, originalPath: string, log: any, dialog: any): Promise<void> {
    const alternativePaths = [
      path.join(__dirname, '../.vite/renderer/main_window/index.html'),
      path.join(__dirname, '../renderer/main_window/index.html'),
      path.join(__dirname, './index.html'),
      path.join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, 'app.asar', '.vite', 'renderer', 'main_window', 'index.html'),
      path.join((process as NodeJS.Process & { resourcesPath: string }).resourcesPath, '.vite', 'renderer', 'main_window', 'index.html')
    ];

    //console.log('Trying alternative paths for HTML file...');
    // log.info('Trying alternative paths for HTML file. Original path was:', originalPath);

    let loaded = false;
    let lastError: Error | null = null;

    for (let i = 0; i < alternativePaths.length; i++) {
      const altPath = alternativePaths[i];
      console.log(`Trying alternative path ${i + 1}/${alternativePaths.length}:`, altPath);
      // log.info(`Trying alternative path ${i + 1}/${alternativePaths.length}:`, altPath);

      try {
        // Check if window is still valid before attempting to load
        if (win && !(win as any).isDestroyed()) {
          if (fs.existsSync(altPath)) {
            //console.log('Alternative path exists, attempting to load...');
            // log.info('Alternative path exists, attempting to load:', altPath);

            await (win as any).loadFile(altPath);
            console.log('Successfully loaded HTML file from alternative path:', altPath);
            // log.info('Successfully loaded HTML file from alternative path:', altPath);
            loaded = true;
            break;
          } else {
            console.log('Alternative path does not exist:', altPath);
            // log.warn('Alternative path does not exist:', altPath);
          }
        } else {
          console.error('Window has been destroyed, cannot load file');
          // log.error('Window has been destroyed, cannot load file');
          lastError = new Error('Window has been destroyed');
          break;
        }
      } catch (error) {
        //console.error(`Failed to load from alternative path ${i + 1}:`, altPath);
        console.error('Error details:', error);
        // log.error(`Failed to load from alternative path ${i + 1}:`, altPath);
        // log.error('Error details:', error);
        lastError = error as Error;

        // If the error is "Object has been destroyed", break out of the loop
        if (error instanceof Error && error.message.includes('Object has been destroyed')) {
          console.error('Window was destroyed during loading, stopping alternative path attempts');
          // log.error('Window was destroyed during loading, stopping alternative path attempts');
          break;
        }
      }
    }

    if (!loaded) {
      const errorMsg = `Could not load HTML file from any path. Tried:\nOriginal: ${originalPath}\nAlternatives:\n${alternativePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      console.error(errorMsg);
      // log.error(errorMsg);

      if (lastError) {
        console.error('Last error encountered:', lastError);
        // log.error('Last error encountered:', lastError);
      }

      dialog.showErrorBox(
        'Application Error',
        'Could not load the application interface. This may be due to a corrupted installation.\n\nPlease try:\n1. Reinstalling the application\n2. Running as administrator\n3. Checking antivirus software\n\nError details have been logged.'
      );
      (app as any).quit();
    }
  }

  async function createWindow() {
    let hiddenMenuBar = true;
    if (isDevelopment) {
      hiddenMenuBar = false;
    }

    // Check if window already exists and is not destroyed
    if (win && !(win as any).isDestroyed()) {
      console.log('Window already exists and is valid, focusing...');
      (win as any).focus();
      return;
    }

    // Create the browser window.
    win = new BrowserWindow({
      autoHideMenuBar: hiddenMenuBar,
      icon: path.join(__dirname, '/icon.png'),
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
        preload: path.join(__dirname + '/preload.js')
      }
    })

    if (win) {
      console.log("Window exist, prepare to register communication ipc handlers")
      // Check if USERSDBPATH is empty, create temp db path if needed
      const tokenService = new Token();
      let userdataPath = tokenService.getValue(USERSDBPATH);
      
      if (!userdataPath || userdataPath.length === 0) {
        // Create temporary database path
        const tempDbPath = path.join(app.getPath('userData'), 'temp_db');
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
          dialog.showErrorBox('Configuration Error',
            `Failed to create temporary database directory: ${errorMessage}`);
        }
      }
      //if (userdataPath){//register communication ipc handlers
        registerCommunicationIpcHandlers(win);
      //}
     
    }

    // Add event listener for window destruction
    (win as any).on('closed', () => {
      console.log('Window closed event triggered');
      win = null;
    });
    // In this example, only windows with the `about:blank` url will be created.
    // All other urls will be blocked.
    (win as any).webContents.setWindowOpenHandler(({ url }) => {
      // console.log(url)
      //if (url === '_blank') {

      //   const url = new URL(req.url);
      //   const filePath = url.pathname;

      // if (url.startsWith(`${protocolScheme}://`)) {   // Handle token data if it's in the URL
      //   if (url.searchParams.has('token')) {
      //     const tokenService = new Token()
      //     const token = url.searchParams.get('token');
      //     if (token) {
      //       log.info('Token received, setting USERSDBPATH');
      //       tokenService.setValue(USERSDBPATH, token);
      //     }
      //   }
      // }

      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          // frame: false,
          // fullscreenable: false,
          backgroundColor: 'black',
          webPreferences: {
            preload: path.join(__dirname + '/preload.js')
          }
        }
      }
      // }
      // return { action: 'deny' }
    })

    // console.log(process.env.WEBPACK_DEV_SERVER_UR)
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      // Load the url of the dev server if in development mode
      try {
        if (win && !(win as any).isDestroyed()) {
          await (win as any).loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL as string)
          if (!process.env.IS_TEST) (win as any).webContents.openDevTools()
        }
      } catch (error) {

        console.error('Failed to load URL:', error);
      }
    } else {
      //check update
      const server = import.meta.env.UPDATESERVER as string;
      if (server) {
        const url = `${server}/update/${process.platform}/${(app as any).getVersion()}`
        autoUpdater.setFeedURL({ url })
        autoUpdater.checkForUpdates()
      }
      // console.log('app://./index.html')
      // createProtocol('app')
      // Load the index.html when not in development
      // In production, the renderer files are in .vite/renderer/main_window/
      const htmlPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);

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
        log.info('Attempting to load HTML file from:', htmlPath);

        try {
          // Check if window is still valid before attempting to load
          if (win && !(win as any).isDestroyed()) {
            await (win as any).loadFile(htmlPath);
            console.log('Successfully loaded HTML file from:', htmlPath);
            //log.info('Successfully loaded HTML file from:', htmlPath);
          } else {
            console.error('Window has been destroyed, cannot load file');
            //log.error('Window has been destroyed, cannot load file');
            dialog.showErrorBox(
              'Application Error',
              'The application window was destroyed before it could load. Please restart the application.'
            );
            (app as any).quit();
            return;
          }
        } catch (error) {
          console.error('Failed to load HTML file from primary path:', htmlPath);
          console.error('Error details:', error);
          // log.error('Failed to load HTML file from primary path:', htmlPath);
          // log.error('Error details:', error);

          // Check if the error is due to window destruction
          if (error instanceof Error && error.message.includes('Object has been destroyed')) {
            console.error('Window was destroyed during loading');
            //log.error('Window was destroyed during loading');
            dialog.showErrorBox(
              'Application Error',
              'The application window was destroyed during loading. Please restart the application.'
            );
            (app as any).quit();
            return;
          }

          // Try alternative paths with detailed error handling
          //await tryAlternativePaths(win, htmlPath, log, dialog);
        }
      } else {
        console.error('HTML file not found at:', htmlPath);
        //log.error('HTML file not found at:', htmlPath);

        // Try alternative paths with detailed error handling
        await tryAlternativePaths(win, htmlPath, log, dialog);
      }
    }
  }

  // Quit when all windows are closed.
  (app as any).on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      (app as any).quit()
    }
  });

  // Handle application shutdown
  (app as any).on('before-quit', async () => {
    try {
      const tokenService = new Token()
      const userdataPath = tokenService.getValue(USERSDBPATH)
      if (userdataPath && userdataPath.length > 0) {
        const scheduleManager = ScheduleManager.getInstance();
        await scheduleManager.handleAppShutdown();
        log.info('ScheduleManager shutdown completed');
      }
    } catch (error) {
      log.error('Failed to shutdown ScheduleManager:', error);
    }

    // Cleanup WebSocket connection
    try {
      cleanupWebSocketConnection();
      log.info('WebSocket connection cleanup completed');
    } catch (error) {
      log.error('Failed to cleanup WebSocket connection:', error);
    }

    // Stop log cleanup interval
    logger.stopLogCleanup();
  });

  (app as any).on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  });

  (app as any).on('open-url', (event, url) => {

    console.log("open url call")
    event.preventDefault();
    console.log(`App opened with URL on mac: ${url}`);
    handleDeepLink(url)

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
    // Configure Content Security Policy (must be called after app is ready)
    configureContentSecurityPolicy()

    const tokenService = new Token()

    // Initialize and set application menu
    const menuManager = new MenuManager();
    const menu = menuManager.createMenu();
    Menu.setApplicationMenu(menu);

    createWindow();

    // Schedule log cleanup (runs after 5 seconds delay, then every 24 hours)
    logger.scheduleLogCleanup();



    const userdataPath = tokenService.getValue(USERSDBPATH)
    if (userdataPath && userdataPath.length > 0) {
      console.log('userdataPath:', userdataPath)
      // Check if the user data path exists, create it if not
      try {
        if (!fs.existsSync(userdataPath)) {
          fs.mkdirSync(userdataPath, { recursive: true });
          log.info(`Created user data directory at: ${userdataPath}`);
        }
      } catch (err) {
        log.error(`Failed to create user data path: ${err}`);
        const errorMessage = err instanceof Error ? err.message : String(err);
        dialog.showErrorBox('Configuration Error',
          `Failed to create user data directory: ${errorMessage}`);
      }
      const appDataSource = SqliteDb.getInstance(userdataPath)
      if (!appDataSource.connection.isInitialized) {
        await appDataSource.connection.initialize()
      }

      // Initialize RAG IPC handlers
      // try {
      //   const ragHandlers = new RAGIpcHandlers(appDataSource);
      //   log.info('RAG IPC handlers initialized successfully');
      // } catch (error) {
      //   log.error('Failed to initialize RAG IPC handlers:', error);
      // }

      // Initialize ScheduleManager with auto-start functionality
      try {
        await runafterbootup()
        const scheduleManager = ScheduleManager.getInstance();
        await scheduleManager.initializeWithDatabaseStatus();
        log.info('ScheduleManager initialized with auto-start functionality');
      } catch (error) {
        log.error('Failed to initialize ScheduleManager:', error);
      }

      // Check for orphaned Yellow Pages processes on startup
      try {
        const yellowPagesCtrl = YellowPagesController.getInstance();

        // Handle tasks from previous session first
        const previousSessionCount = await yellowPagesCtrl.handleTasksFromPreviousSession();
        log.info(`Yellow Pages previous session tasks handled: ${previousSessionCount} tasks marked as failed`);

        // Then check for orphaned processes
        const orphanedCheckResult = await yellowPagesCtrl.checkForOrphanedProcesses();
        log.info('Yellow Pages orphaned process check completed:', orphanedCheckResult);
      } catch (error) {
        log.error('Failed to check for orphaned Yellow Pages processes:', error);
      }

      // Initialize WebSocket connection to marketing server
      // This enables real-time notifications and updates
      if (win) {
        try {
          await initializeWebSocketConnection(win);
          log.info('WebSocket connection to marketing server initialized');
        } catch (error) {
          log.error('Failed to initialize WebSocket connection:', error);
        }
      }

      // Start background token auto-refresh for already-logged-in user (only if not already running)
      if (!TokenRefreshService.isAutoRefreshRunning()) {
        TokenRefreshService.startAutoRefresh();
      }
    }


    if (isDevelopment && !process.env.IS_TEST) {
      // Install Vue Devtools
      try {
        await installExtension(VUEJS3_DEVTOOLS)
      } catch (e) {
        if (e instanceof Error) {
          console.error('Vue Devtools failed to install:', e.toString())
        }
      }
    }
  })

  // Exit cleanly on request from parent process in development mode.
  if (isDevelopment) {
    if (process.platform === 'win32') {
      process.on('message', (data) => {
        if (data === 'graceful-exit') {
          (app as any).quit()
        }
      })
    } else {
      process.on('SIGTERM', () => {
        (app as any).quit()
      })
    }
  }


}







/**
 * Configure Content Security Policy for the application
 * This prevents the Electron security warning about missing CSP
 */
function configureContentSecurityPolicy() {
  const defaultSession = session.defaultSession;

  // Set CSP based on environment
  // In development, we need 'unsafe-eval' for Vite's HMR
  // In production, we can be more restrictive
  const cspDirectives = isDevelopment
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:* https://localhost:*",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https: http:",
        "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
        "connect-src 'self' http://localhost:* https://localhost:* https: http: https://fonts.googleapis.com https://fonts.gstatic.com",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https:",
        "font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com",
        "connect-src 'self' https: https://fonts.googleapis.com https://fonts.gstatic.com",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
      ].join('; ');

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspDirectives]
      }
    });
  });

  log.info(`Content Security Policy configured for ${isDevelopment ? 'development' : 'production'} mode`);
}

function makeSingleInstance() {

  if ((process as NodeJS.Process & { mas: boolean }).mas) return

  const gotThelock = (app as any).requestSingleInstanceLock()
  if (!gotThelock) {
    (app as any).quit()
  } else {

    // console.log('gotThelock:', gotThelock)

    (app as any).on('second-instance', (event, argv, workingDirectory) => {
      if (win) {
        if ((win as any).isMinimized()) (win as any).restore();
        (win as any).focus();
      }

      // console.log("second-instance call")
      // console.log('protocolScheme:', protocolScheme)
     // argv = argv.map(arg => typeof arg === 'string' ? arg.toLowerCase() : arg);
      const urlIndex = argv.findIndex(arg => typeof arg === 'string' && arg.toLowerCase().startsWith(`${protocolScheme}://`));
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
          if (nextArg.includes('=') && !nextArg.includes('/') && !nextArg.startsWith('-')) {
            url += '&' + nextArg;
          } else {
            // Stop if we hit something that doesn't look like a URL fragment
            break;
          }
        }
        
        console.log('app opened with url on window')
        //console.log(`App opened with URL on window: ${url}`);
        handleDeepLink(url)
      }else{
        console.error('no url found')
      }

    })
  }

}

/**
 * Validate deep link URL origin to prevent malicious token injection
 */
function isValidDeepLinkOrigin(parsedUrl: URL): boolean {
  // Check if the URL protocol matches our app's protocol scheme (case-insensitive)
  const urlProtocol = parsedUrl.protocol.toLowerCase();
  if (!urlProtocol.includes(protocolScheme)) {
    log.error('Invalid deep link protocol:', parsedUrl.protocol);
    return false;
  }

  // Additional validation: ensure URL has the expected structure
  if (!parsedUrl.hostname) {
    log.error('Invalid deep link hostname:', parsedUrl.hostname);
    return false;
  }

  return true;
}

/**
 * Clear all authentication tokens from storage
 */
function clearTokens(): void {
  try {
    // Stop background auto-refresh before clearing tokens
    TokenRefreshService.stopAutoRefresh();

    const tokenService = new Token();
    tokenService.setValue(TOKENNAME, '');
    tokenService.setValue(REFRESHTOKEN, '');
    tokenService.setValue(TOKENEXPIRY, '');
    tokenService.setValue(REFRESHTOKENEXPIRY, '');
    log.info('All tokens cleared successfully');
  } catch (error) {
    log.error('Failed to clear tokens:', error);
  }
}

async function handleDeepLink(url: string) {
  try {
    const parsedUrl = new URL(url);

    // Validate deep link origin to prevent malicious token injection
    if (!isValidDeepLinkOrigin(parsedUrl)) {
      log.error('Invalid deep link origin:', url);
      dialog.showErrorBox('Security Error',
        'Invalid deep link origin. This link may be malicious.');
      return;
    }

    // Extract token parameters
    // Use searchParams if available, otherwise parse manually (for custom protocols)
    let token: string | null = null;
    let refreshToken: string | null = null;
    let expiresIn: string | null = null;
    let refreshExpiresIn: string | null = null;

    if (parsedUrl.searchParams) {
      // Standard URL parsing
      token = parsedUrl.searchParams.get('token');
      refreshToken = parsedUrl.searchParams.get('refreshToken') || parsedUrl.searchParams.get('refresh_token');
      expiresIn = parsedUrl.searchParams.get('expiresIn') || parsedUrl.searchParams.get('expires_in');
      refreshExpiresIn = parsedUrl.searchParams.get('refreshExpiresIn') || parsedUrl.searchParams.get('refresh_expires_in');
    }

    // Fallback: Manual parsing if searchParams didn't work (common with custom protocols)
    // Also trigger fallback if token exists but refreshToken is missing AND url ends with token (suggesting truncation)
    const urlEndsWithTokenValue = token && url.endsWith(token);
    if (!token || (!refreshToken && (url.includes('refresh_token') || urlEndsWithTokenValue))) {
      const queryString = url.includes('?') ? url.split('?')[1] : '';
      const params = new URLSearchParams(queryString);
      token = token || params.get('token');
      refreshToken = refreshToken || params.get('refreshToken') || params.get('refresh_token');
      expiresIn = expiresIn || params.get('expiresIn') || params.get('expires_in');
      refreshExpiresIn = refreshExpiresIn || params.get('refreshExpiresIn') || params.get('refresh_expires_in');
    }

    // Debug logging
    log.info('Extracted tokens from deep link:', {
      hasToken: !!token,
      hasRefreshToken: !!refreshToken,
      tokenLength: token?.length || 0,
      refreshTokenLength: refreshToken?.length || 0
    });

    if (!token) {
      log.error('No token found in deep link');
      return;
    }

    // Store tokens with error handling
    const tokenService = new Token();
    try {
      tokenService.setValue(TOKENNAME, token);
      log.info('Access token saved successfully');

      // Calculate and store token expiry time
      if (expiresIn) {
        const expiryTime = Date.now() + (parseInt(expiresIn) * 1000);
        tokenService.setValue(TOKENEXPIRY, expiryTime.toString());
        log.info('Token expiry time saved:', new Date(expiryTime).toISOString());
      }

      // Save refresh token if provided
      if (refreshToken) {
        tokenService.setValue(REFRESHTOKEN, refreshToken);
        log.info('Refresh token saved successfully');

        // Calculate and store refresh token expiry time
        if (refreshExpiresIn) {
          const refreshExpiryTime = Date.now() + (parseInt(refreshExpiresIn) * 1000);
          tokenService.setValue(REFRESHTOKENEXPIRY, refreshExpiryTime.toString());
          log.info('Refresh token expiry time saved:', new Date(refreshExpiryTime).toISOString());
        }
      } else {
        log.warn('No refresh token found in deep link URL');
      }
    } catch (storageError) {
      log.error('Failed to store tokens:', storageError);
      const errorMessage = storageError instanceof Error ? storageError.message : String(storageError);
      dialog.showErrorBox('Authentication Error',
        `Failed to store authentication tokens: ${errorMessage}`);
      return;
    }

    // Fetch user information
    const userController = new UserController();
    try {
      const userInfo = await userController.updateUserInfo();
      if (userInfo) {
        // Login successful - Register device with backend (non-blocking)
        try {
          const deviceFingerprintService = new DeviceFingerprintService();
          const deviceApi = new DeviceApi();

          const deviceIdHash = deviceFingerprintService.getDeviceIdHash();
          const deviceName = deviceFingerprintService.getDeviceName();

          // Store deviceIdHash for future use
          deviceFingerprintService.storeDeviceIdHash(deviceIdHash);

          // Register device with backend
          if (refreshToken) {
            await deviceApi.registerDevice(deviceName, deviceIdHash, refreshToken);
            log.info('Device registered successfully:', deviceIdHash);
          } else {
            // Register without refresh token (backend will generate one)
            await deviceApi.registerDevice(deviceName, deviceIdHash);
            log.info('Device registered successfully (without refresh token):', deviceIdHash);
          }
        } catch (deviceError) {
          // Log error but don't block login flow
          log.error('Device registration failed (non-blocking):', deviceError);
          const errorMessage = deviceError instanceof Error ? deviceError.message : String(deviceError);
          console.error('Device registration error:', errorMessage);
        }

        // After successful login, USERSDBPATH may have changed
        // Reset database singletons to use the new path
        try {
          const tokenService = new Token();
          const newDbPath = tokenService.getValue(USERSDBPATH);
          if (newDbPath && newDbPath.length > 0) {
            // Reset ScheduleManager first (before destroying DB connection)
            // This allows it to stop cleanly without trying to use a destroyed connection
            await ScheduleManager.resetInstance();
            log.info('ScheduleManager reset to new path after login');
            
            // Reset SqliteDb instance to use new path
            const newDbInstance = await SqliteDb.resetInstance(newDbPath);
            log.info('SqliteDb reset to new path after login:', newDbPath);
            
            // Ensure the new connection is initialized with retry logic for database locks
            if (!newDbInstance.connection.isInitialized) {
              let retries = 3;
              let lastError: unknown = null;
              while (retries > 0) {
                try {
                  await newDbInstance.connection.initialize();
                  log.info('New SqliteDb connection initialized');
                  break;
                } catch (initError) {
                  lastError = initError;
                  retries--;
                  if (retries > 0) {
                    const errorMessage = initError instanceof Error ? initError.message : String(initError);
                    if (errorMessage.includes('locked') || errorMessage.includes('database is locked')) {
                      log.warn(`Database locked during initialization, retrying... (${retries} retries left)`);
                      // Wait a bit longer before retrying
                      await new Promise(resolve => setTimeout(resolve, 200));
                    } else {
                      // Not a lock error, don't retry
                      throw initError;
                    }
                  }
                }
              }
              if (retries === 0 && lastError) {
                log.error('Failed to initialize new SqliteDb connection after retries:', lastError);
                // Don't throw - allow login to continue, connection will be initialized on first use
              }
            }
          }
        } catch (dbResetError) {
          // Log but don't block login flow
          log.error('Failed to reset database singletons after login (non-blocking):', dbResetError);
        }

        // Initialize WebSocket connection after successful login
        if (win && !(win as any).isDestroyed()) {
          try {
            await initializeWebSocketConnection(win);
            log.info('WebSocket connection initialized after login');
          } catch (wsError) {
            log.error('Failed to initialize WebSocket after login (non-blocking):', wsError);
          }
        }

        // Start background token auto-refresh (only if not already running)
        if (!TokenRefreshService.isAutoRefreshRunning()) {
          TokenRefreshService.startAutoRefresh();
        }

        // Navigate to dashboard
        if (win && !(win as any).isDestroyed()) {
          (win as any).webContents.send(NATIVATECOMMAND, { path: 'Dashboard' } as NativateDatatype);
        } else {
          console.error('Window has been destroyed, cannot send navigation command');
          log.error('Window has been destroyed, cannot send navigation command');
        }
      } else {
        log.error('Failed to get user info from remote source');
        dialog.showErrorBox('User Info Error',
          'Failed to get user info from remote source.');

        // Clear tokens on authentication failure
        clearTokens();
      }
    } catch (userError) {
      log.error('Error updating user info:', userError);
      const errorMessage = userError instanceof Error ? userError.message : String(userError);
      dialog.showErrorBox('User Info Update Error',
        `Failed to update user information: ${errorMessage}`);

      // Clear tokens on authentication failure
      clearTokens();
    }

  } catch (error) {
    log.error('Failed to handle deep link:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Deep link handling error:', errorMessage);

    // Show error dialog to user
    if ((app as any).isReady()) {
      dialog.showErrorBox('Deep Link Error',
        `Failed to process authentication link: ${errorMessage}`);
    }
  }
}

// makeSingleInstance()
// createWindow()
initialize()





//import { registerTaskIpcHandlers } from './main-process/communication/task-ipc'
