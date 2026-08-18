"use strict";

// ContactExtractionWorker runs with ELECTRON_RUN_AS_NODE=1. Electron's
// renderer/main-process module is unavailable there, but electron-store has a
// top-level require("electron"). An empty shim lets electron-store use its
// explicit cwd option without exposing Electron APIs to the worker.
const app = {
  getName: () => process.env.ELECTRON_APP_NAME ?? "aiFetchly",
  getPath: () => process.env.ELECTRON_USER_DATA_PATH ?? process.cwd(),
  getVersion: () => "0.0.0",
};

class BrowserWindow {}
class Notification {}
class MessageChannelMain {}
const utilityProcess = {};

export { app, BrowserWindow, MessageChannelMain, Notification, utilityProcess };
