import electronLog from "electron-log/main";

// Exercise the runtime shape taskCode's Logger relies on so the bundle must
// inline a working module, not a bare require that fails from app.asar.unpacked.
if (typeof electronLog.info !== "function") {
  throw new Error("electron-log bundle failed: info is not a function");
}
electronLog.transports.file.level = false;
electronLog.transports.console.level = false;
electronLog.info("electron-log-taskcode-ok");
