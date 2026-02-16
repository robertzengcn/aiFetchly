import * as path from 'path';
import * as os from 'os';
import fs from 'fs';

/** True when running in a worker/child process that has process.send (e.g. contact-extraction worker). */
const isWorker =
  typeof process !== 'undefined' &&
  !!process.env?.WORKER_TYPE &&
  typeof process.send === 'function';

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
      if (typeof process.send === 'function') {
        process.send({ type: 'worker-log', level, args });
      }
    } catch (_) {
      // ignore send errors (e.g. channel closed)
    }
  };
  return {
    info: (...args: unknown[]) => send('info', ...args),
    error: (...args: unknown[]) => send('error', ...args),
    warn: (...args: unknown[]) => send('warn', ...args),
    debug: (...args: unknown[]) => send('debug', ...args),
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
    getLogDir: () => '',
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
    const electron = require('electron') as typeof import('electron');
    const app = electron?.app;
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'logs');
    }
  } catch {
    // electron not available (e.g. worker process)
  }
  return path.join(os.tmpdir(), 'aifetchly-logs');
}

/**
 * Main process only: Logger that uses electron-log and Electron app.
 * Do not instantiate in worker; use createWorkerLoggerStub there.
 */
export class Logger {
  private static instance: Logger;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private logDir: string;
  private electronLog: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; debug: (...args: unknown[]) => void };

  private constructor() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electronLogModule = require('electron-log/main');
    // Ensure electron-log has the required methods, fall back to console if not
    if (electronLogModule && typeof electronLogModule.info === 'function') {
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
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private initialize(): void {
    const elog = this.electronLog;
    if (typeof (elog as unknown as { initialize?: () => void }).initialize === 'function') {
      (elog as unknown as { initialize: () => void }).initialize();
    }

    if ((elog as unknown as { transports?: { file?: { level?: string } } }).transports?.file) {
      (elog as unknown as { transports: { file: { level: string } } }).transports.file.level = 'debug';
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateFolder = `${year}-${month}-${day}`;
    const dailyLogDir = path.join(this.logDir, dateFolder);

    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      if (!fs.existsSync(dailyLogDir)) {
        fs.mkdirSync(dailyLogDir, { recursive: true });
      }
      elog.info(`Log directory created/verified at: ${this.logDir}`);
      elog.info(`Daily log directory created/verified at: ${dailyLogDir}`);
    } catch (err) {
      console.error('Failed to create log directory:', err);
    }

    const logTransports = (elog as unknown as {
      transports?: {
        file?: {
          fileName?: string;
          resolvePathFn?: () => string;
          maxSize?: number;
        };
      };
    }).transports;
    if (logTransports?.file) {
      logTransports.file.fileName = 'main.log';
      const currentLogDir = this.logDir;
      logTransports.file.resolvePathFn = () => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const currentDateFolder = `${y}-${m}-${d}`;
        const currentDailyLogDir = path.join(currentLogDir, currentDateFolder);
        if (!fs.existsSync(currentDailyLogDir)) {
          try {
            fs.mkdirSync(currentDailyLogDir, { recursive: true });
          } catch (err) {
            console.error('Failed to create daily log directory:', err);
          }
        }
        return path.join(currentDailyLogDir, 'main.log');
      };
      logTransports.file.maxSize = 1000000;
    }

    const logTransportsWithConsole = logTransports as { file?: unknown; console?: { level?: string } };
    if (logTransportsWithConsole?.console) {
      logTransportsWithConsole.console.level = 'debug';
    }

    this.setupConsoleOverrides();
    elog.info('Console override test - this should appear in both terminal and log file');
    this.verifyLogFile();
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

  private verifyLogFile(): void {
    try {
      const logFilePath = path.join(this.logDir, 'main.log');
      console.log(`Log file path: ${logFilePath}`);
      console.log(`Log file exists: ${fs.existsSync(logFilePath)}`);
      this.electronLog.info('Testing log file write capability...');
      console.log('Log file write test completed');
    } catch (err) {
      console.error('Error checking log file:', err);
    }
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
      console.error('Failed to cleanup old logs:', err);
    }
  }

  public scheduleLogCleanup(): void {
    setTimeout(() => this.cleanupOldLogs(), 5000);
    this.cleanupInterval = setInterval(() => this.cleanupOldLogs(), 24 * 60 * 60 * 1000);
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

if (isWorker) {
  const workerLog = createWorkerLogProxy();
  log = workerLog;
  logger = createWorkerLoggerStub(workerLog);
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronLogModule = require('electron-log/main');
  // Ensure electron-log has the required methods, fall back to console if not
  if (electronLogModule && typeof electronLogModule.info === 'function') {
    log = electronLogModule;
  } else {
    // Fallback to console if electron-log is not available
    log = {
      info: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      debug: console.debug.bind(console),
    };
  }
  logger = Logger.getInstance();
}

export { log, logger };
