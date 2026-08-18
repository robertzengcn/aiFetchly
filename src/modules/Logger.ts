import * as path from "path";
import * as os from "os";
import fs from "fs";
import { randomUUID } from "crypto";
import { getCrashReporterFromGlobal } from "@/modules/diagnostics/CrashReporterGlobal";
import { redactString } from "@/modules/diagnostics/DiagnosticRedactor";
import type { ErrorRecord } from "@/modules/diagnostics/DiagnosticSchemas";

/** True when running in a worker/child process that has process.send (e.g. contact-extraction worker). */
const isWorker =
  typeof process !== "undefined" &&
  !!process.env?.WORKER_TYPE &&
  typeof process.send === "function";

/** True outside production builds. Used to gate dev-only behavior like console mirroring. */
const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * Returns true when verbose "debug-level" file logging should be active.
 *
 * Enabled via either:
 *   - env var AIFETCHLY_DEBUG_LOGS=true (manual override), or
 *   - a diagnostics/.debug-enabled file inside Electron's userData dir containing an ISO
 *     timestamp in the future (written by the diagnostics IPC handler).
 *
 * In production without either signal, this returns false and the file transport
 * stays at 'warn', preventing debug/test chatter from polluting app.log.
 */
function isDebugLoggingEnabled(): boolean {
  if (process.env.AIFETCHLY_DEBUG_LOGS === "true") return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as typeof import("electron");
    const app = electron?.app;
    if (!app) return false;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const debugPath = require("path").join(
      app.getPath("userData"),
      "diagnostics",
      ".debug-enabled"
    );
    if (!fs.existsSync(debugPath)) return false;
    const expiry = fs.readFileSync(debugPath, "utf8").trim();
    return expiry.length > 0 && Date.parse(expiry) > Date.now();
  } catch {
    return false;
  }
}

type GlobalLoggerState = typeof globalThis & {
  __aifetchlyLoggerInstance?: Logger;
  __aifetchlyLoggerInitialized?: boolean;
};

/**
 * Worker-only: log proxy that forwards to main process via process.send.
 * Worker code must not use Electron or electron-log; main process handles actual logging.
 */
function createWorkerLogProxy(): {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
} {
  const send = (level: string, ...args: unknown[]) => {
    try {
      if (typeof process.send === "function") {
        process.send({ type: "worker-log", level, args });
      }
    } catch (_) {
      // ignore send errors (e.g. channel closed)
    }
  };
  return {
    info: (...args: unknown[]) => send("info", ...args),
    error: (...args: unknown[]) => send("error", ...args),
    warn: (...args: unknown[]) => send("warn", ...args),
    debug: (...args: unknown[]) => send("debug", ...args),
  };
}

/**
 * Worker-only: stub logger so code that uses logger.getLogDir() etc. does not break.
 */
function createWorkerLoggerStub(
  workerLog: ReturnType<typeof createWorkerLogProxy>
): {
  getLogDir: () => string;
  getLogger: () => ReturnType<typeof createWorkerLogProxy>;
  scheduleLogCleanup: () => void;
  stopLogCleanup: () => void;
} {
  return {
    getLogDir: () => "",
    getLogger: () => workerLog,
    scheduleLogCleanup: () => {
      // Worker process stub - no-op
    },
    stopLogCleanup: () => {
      // Worker process stub - no-op
    },
  };
}

/** Main process only: get log directory; uses Electron app when available. */
function getLogDirectory(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron") as typeof import("electron");
    const app = electron?.app;
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("userData"), "logs");
    }
  } catch {
    // electron not available (e.g. worker process)
  }
  return path.join(os.tmpdir(), "aifetchly-logs");
}

/**
 * Main process only: Logger that uses electron-log and Electron app.
 * Do not instantiate in worker; use createWorkerLoggerStub there.
 */
export class Logger {
  private static instance: Logger;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private logDir: string;
  private electronLog: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };

  private constructor() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronLogModule = require("electron-log/main");
    // Ensure electron-log has the required methods, fall back to console if not
    if (electronLogModule && typeof electronLogModule.info === "function") {
      this.electronLog = electronLogModule;
    } else {
      // Fallback to console if electron-log is not available
      this.electronLog = {
        info: console.log.bind(console),
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        debug: console.debug.bind(console),
      };
    }
    this.logDir = getLogDirectory();
    this.initialize();
  }

  public static getInstance(): Logger {
    const globalState = globalThis as GlobalLoggerState;
    if (globalState.__aifetchlyLoggerInstance) {
      Logger.instance = globalState.__aifetchlyLoggerInstance;
      return Logger.instance;
    }

    if (!Logger.instance) {
      Logger.instance = new Logger();
      globalState.__aifetchlyLoggerInstance = Logger.instance;
    }
    return Logger.instance;
  }

  private initialize(): void {
    const globalState = globalThis as GlobalLoggerState;
    if (globalState.__aifetchlyLoggerInitialized) {
      return;
    }

    const elog = this.electronLog;
    if (
      typeof (elog as unknown as { initialize?: () => void }).initialize ===
      "function"
    ) {
      (elog as unknown as { initialize: () => void }).initialize();
    }
    globalState.__aifetchlyLoggerInitialized = true;

    // File transport: 'warn' in production by default, 'debug' only when
    // explicit diagnostic/debug logging is enabled (PRD acceptance criterion:
    // production startup must not write debug/test messages to app.log).
    const fileTransport = (
      elog as unknown as { transports?: { file?: { level?: string } } }
    ).transports?.file;
    if (fileTransport) {
      fileTransport.level = isDebugLoggingEnabled() ? "debug" : "warn";
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateFolder = `${year}-${month}-${day}`;
    const dailyLogDir = path.join(this.logDir, dateFolder);

    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      if (!fs.existsSync(dailyLogDir)) {
        fs.mkdirSync(dailyLogDir, { recursive: true });
      }
      // Intentionally no startup info log: production startup must stay quiet.
    } catch (err) {
      console.error("Failed to create log directory:", err);
    }

    const logTransports = (
      elog as unknown as {
        transports?: {
          file?: {
            fileName?: string;
            resolvePathFn?: () => string;
            maxSize?: number;
          };
        };
      }
    ).transports;
    if (logTransports?.file) {
      logTransports.file.fileName = "main.log";
      const currentLogDir = this.logDir;
      logTransports.file.resolvePathFn = () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        const currentDateFolder = `${y}-${m}-${d}`;
        const currentDailyLogDir = path.join(currentLogDir, currentDateFolder);
        if (!fs.existsSync(currentDailyLogDir)) {
          try {
            fs.mkdirSync(currentDailyLogDir, { recursive: true });
          } catch (err) {
            console.error("Failed to create daily log directory:", err);
          }
        }
        return path.join(currentDailyLogDir, "main.log");
      };
      logTransports.file.maxSize = 1000000;
    }

    // Console transport: 'debug' in development so devs still see logs in the
    // terminal; disabled entirely ('false') in production to keep stdout clean
    // and ensure console.* calls do not echo through electron-log.
    const logTransportsWithConsole = logTransports as {
      file?: unknown;
      console?: { level?: string | false };
    };
    if (logTransportsWithConsole?.console) {
      logTransportsWithConsole.console.level = isDevelopment ? "debug" : false;
    }

    // Only monkey-patch console.* to mirror into electron-log during development.
    // In production we leave the global console untouched (PRD acceptance
    // criterion: calling console.log must not write to app.log in production).
    if (isDevelopment) {
      this.setupConsoleOverrides();
    }
  }

  private setupConsoleOverrides(): void {
    const elog = this.electronLog;
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug,
    };

    console.log = (...args: unknown[]) => {
      originalConsole.log(...args);
      elog.info(...args);
    };
    console.error = (...args: unknown[]) => {
      originalConsole.error(...args);
      elog.error(...args);
    };
    console.warn = (...args: unknown[]) => {
      originalConsole.warn(...args);
      elog.warn(...args);
    };
    console.info = (...args: unknown[]) => {
      originalConsole.info(...args);
      elog.info(...args);
    };
    console.debug = (...args: unknown[]) => {
      originalConsole.debug(...args);
      elog.debug(...args);
    };
  }

  private cleanupOldLogs(): void {
    try {
      if (!fs.existsSync(this.logDir)) return;
      const entries = fs.readdirSync(this.logDir, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
        .sort()
        .reverse();
      if (directories.length > 30) {
        const toDelete = directories.slice(30);
        toDelete.forEach((dir) => {
          const dirPath = path.join(this.logDir, dir);
          try {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`Cleaned up old log directory: ${dir}`);
          } catch (err) {
            console.error(`Failed to delete log directory ${dir}:`, err);
          }
        });
      }
    } catch (err) {
      console.error("Failed to cleanup old logs:", err);
    }
  }

  public scheduleLogCleanup(): void {
    setTimeout(() => this.cleanupOldLogs(), 5000);
    this.cleanupInterval = setInterval(
      () => this.cleanupOldLogs(),
      24 * 60 * 60 * 1000
    );
  }

  public stopLogCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  public getLogDir(): string {
    return this.logDir;
  }

  public getLogger(): typeof this.electronLog {
    return this.electronLog;
  }
}

// Export singleton or worker stub; main process never runs getInstance() when isWorker
let log: {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};
let logger: {
  getLogDir: () => string;
  getLogger: () => typeof log;
  scheduleLogCleanup: () => void;
  stopLogCleanup: () => void;
};

/** Render a log argument as a string without ever throwing. */
function argToString(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack ?? a.message;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

/**
 * Wrap a log method so each call also feeds the diagnostics buffers: one
 * breadcrumb (category "log") and one ErrorRecord in the recent-errors ring.
 * Best-effort — failures are swallowed so diagnostics can never break
 * logging. No-ops while the crash reporter is not yet initialised (very
 * early startup) and is entirely inactive in worker processes.
 */
function bridgeLogLevel(
  original: (...args: unknown[]) => void,
  level: "warn" | "error"
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    original(...args);
    try {
      const reporter = getCrashReporterFromGlobal();
      if (!reporter) return;
      const message = redactString(args.map(argToString).join(" "));
      if (!message) return;
      const timestamp = new Date().toISOString();
      reporter.addBreadcrumb({
        timestamp,
        category: "log",
        // Breadcrumb message cap (wire contract caps at 1024).
        message: message.slice(0, 1024),
        level,
      });
      const rec: ErrorRecord = {
        schemaVersion: 1,
        timestamp,
        errorId: randomUUID(),
        sessionId: reporter.sessionId,
        level,
        processType: "main",
        // ErrorRecord message cap (schema max 8 KB).
        message: message.slice(0, 8 * 1024),
      };
      reporter.pushError(rec);
    } catch {
      // never throw from diagnostics
    }
  };
}

if (isWorker) {
  const workerLog = createWorkerLogProxy();
  log = workerLog;
  logger = createWorkerLoggerStub(workerLog);
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronLogModule = require("electron-log/main");
  // Ensure electron-log has the required methods, fall back to console if not
  let resolved: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  if (electronLogModule && typeof electronLogModule.info === "function") {
    resolved = electronLogModule;
  } else {
    // Fallback to console if electron-log is not available
    resolved = {
      info: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      debug: console.debug.bind(console),
    };
  }
  logger = Logger.getInstance();
  // Diagnostics bridge: every warn/error log also feeds the crash reporter's
  // breadcrumb + recent-error buffers so crash uploads carry pre-crash
  // context. Methods are wrapped explicitly (not spread) because electron-log
  // method enumerability is not guaranteed. info/debug stay unbridged.
  log = {
    info: (...args: unknown[]) => resolved.info(...args),
    debug: (...args: unknown[]) => resolved.debug(...args),
    error: bridgeLogLevel(resolved.error, "error"),
    warn: bridgeLogLevel(resolved.warn, "warn"),
  };
}

export { log, logger };
