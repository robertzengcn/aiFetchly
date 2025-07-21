'use strict'
import 'reflect-metadata';
// import {ipcMain as ipc} from 'electron-better-ipc';
import { app, BrowserWindow, dialog,autoUpdater } from 'electron'
// import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
import { registerCommunicationIpcHandlers } from "./main-process/communication/";
import * as path from 'path';
import { Token } from "@/modules/token"
import { USERSDBPATH} from '@/config/usersetting';
import { SqliteDb } from "@/config/SqliteDb"
import log from 'electron-log/main';
import fs from 'fs';
import ProtocolRegistry from 'protocol-registry'
import { TOKENNAME } from '@/config/usersetting';
//import { RemoteSource } from '@/modules/remotesource'
import { UserController } from '@/controller/UserController';
import {NATIVATECOMMAND} from '@/config/channellist'
import {NativateDatatype} from '@/entityTypes/commonType'
import { ScheduleManager } from '@/modules/ScheduleManager';

// import { createProtocol } from 'electron';
const isDevelopment = process.env.NODE_ENV !== 'production'
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;
// import { safeStorage } from 'electron';

// const { ipcRenderer: ipc } = require('electron-better-ipc');
// const { ipcMain } = require("electron");

// Get app name for protocol
const appName = app.getName();
const protocolScheme = appName.replace(/-/g, ''); // Remove hyphens for protocol

// Configure log
log.initialize();

// Configure electron-log
log.transports.file.level = 'debug';
const logDir = path.join(app.getPath('userData'), 'logs');
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  log.info(`Log directory created/verified at: ${logDir}`);
} catch (err) {
  console.error('Failed to create log directory:', err);
}
log.transports.file.fileName = path.join(logDir, 'logs/main.log');

//override console.log
Object.assign(console, log.functions);
log.info('Application starting...');
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);

  // Show error dialog if possible
  if (app.isReady()) {
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
  console.log(import.meta.env.VITE_REMOTEADD)
  // protocol.registerSchemesAsPrivileged([

  //   { scheme: appName, privileges: { secure: true, 
  //     standard: true } }
  // ])
  if (app.isPackaged) {
    if (!app.isDefaultProtocolClient(protocolScheme)) {
      const registres = app.setAsDefaultProtocolClient(protocolScheme);
      console.log('registres:', registres)
    }

  } else {
    console.log('protocolScheme:', protocolScheme)
    console.log('process.execPath:', process.execPath)
    console.log('path.resolve(process.argv[1]):', path.resolve(process.argv[1]))
   // console.log('path:', path.resolve(process.argv[1]))
    ProtocolRegistry.register(protocolScheme, `"${process.execPath}" "${path.resolve(process.argv[1])}" "$_URL_"`,
      {
        override: true,
        appName: appName,
        terminal: true,
      }
    ).then(() => console.log('Successfully registered'))
      .catch(console.error);
    // app.setAsDefaultProtocolClient(protocolScheme);
  }
  makeSingleInstance()



  async function createWindow() {
    let hiddenMenuBar = true;
    if(isDevelopment){
      hiddenMenuBar = false;
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
    // In this example, only windows with the `about:blank` url will be created.
    // All other urls will be blocked.
    win.webContents.setWindowOpenHandler(({ url }) => {
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
      await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL as string)
      if (!process.env.IS_TEST) win.webContents.openDevTools()
    } else {
  //check update
  const server = import.meta.env.UPDATESERVER as string;
  if(server){
    const url = `${server}/update/${process.platform}/${app.getVersion()}`
    autoUpdater.setFeedURL({ url })
    autoUpdater.checkForUpdates()
  }
      // console.log('app://./index.html')
      // createProtocol('app')
      // Load the index.html when not in development
      await win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
    }
  }

  // Quit when all windows are closed.
  app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Handle application shutdown
  app.on('before-quit', async () => {
    try {
      const scheduleManager = ScheduleManager.getInstance();
      await scheduleManager.handleAppShutdown();
      log.info('ScheduleManager shutdown completed');
    } catch (error) {
      log.error('Failed to shutdown ScheduleManager:', error);
    }
  })

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('open-url', (event, url) => {

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
  app.whenReady().then(async () => {
    const tokenService = new Token()

    createWindow();

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
      
      // Initialize ScheduleManager with auto-start functionality
      try {
        const scheduleManager = ScheduleManager.getInstance();
        await scheduleManager.initializeWithDatabaseStatus();
        log.info('ScheduleManager initialized with auto-start functionality');
      } catch (error) {
        log.error('Failed to initialize ScheduleManager:', error);
      }
    }
    if(win){
    registerCommunicationIpcHandlers(win);
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
          app.quit()
        }
      })
    } else {
      process.on('SIGTERM', () => {
        app.quit()
      })
    }
  }


}







function makeSingleInstance() {

  if (process.mas) return

  const gotThelock = app.requestSingleInstanceLock()
  if (!gotThelock) {
    app.quit()
  } else {

    console.log('gotThelock:', gotThelock)

    app.on('second-instance', (event, argv, workingDirectory) => {
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }

      console.log("second-instance call")
      const url = argv.find(arg => arg.startsWith(`${protocolScheme}://`));
      if (url) {
        console.log(`App opened with URL on window: ${url}`);
        handleDeepLink(url)
      }

    })
  }

}

async function handleDeepLink(url: string) {
  try {
    const parsedUrl = new URL(url);
    const token = parsedUrl.searchParams.get('token'); // Example: Extract a token from the URL
    if (token) {
      console.log(`Token received: ${token}`);
      const tokenService = new Token();
      tokenService.setValue(TOKENNAME, token);
      // const remoteser = new RemoteSource()
      // const userInfo = await remoteser.GetUserInfo()
      // console.log('userInfo:', userInfo)
      const userController=new UserController()
      const userInfo = await userController.updateUserInfo();
      if (userInfo) {
        //login success
        
        if (win&& !win.isDestroyed()) {
          await win.webContents.send(NATIVATECOMMAND,{path:'Dashboard'} as NativateDatatype);
        }
      }else{
        log.error('Failed to get user info from remote source');
        dialog.showErrorBox('User Info Error',
          `Failed to get user info from remote source.`);
      }

    }

    // Perform other actions based on the URL

  } catch (error) {
    console.error('Failed to handle deep link:', error);
  }
}

// makeSingleInstance()
// createWindow()






initialize()





