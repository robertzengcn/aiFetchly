import log from 'electron-log/main';
import * as path from 'path';
import { app } from 'electron';
import fs from 'fs';

export class Logger {
  private static instance: Logger;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private logDir: string;

  private constructor() {
    this.logDir = path.join(app.getPath('userData'), 'logs');
    this.initialize();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private initialize(): void {
    // Configure electron-log
    log.initialize();

    // Configure electron-log with date-based folder structure
    // Logs will be organized as: userData/logs/YYYY-MM-DD/main.log
    // This prevents the main.log file from becoming too large
    log.transports.file.level = 'debug';

    // Create date-based log directory structure
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateFolder = `${year}-${month}-${day}`;

    const dailyLogDir = path.join(this.logDir, dateFolder);

    // Create log directories if they don't exist
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      if (!fs.existsSync(dailyLogDir)) {
        fs.mkdirSync(dailyLogDir, { recursive: true });
      }
      log.info(`Log directory created/verified at: ${this.logDir}`);
      log.info(`Daily log directory created/verified at: ${dailyLogDir}`);
    } catch (err) {
      console.error('Failed to create log directory:', err);
    }

    // Configure file transport with date-based path
    log.transports.file.fileName = 'main.log'; // Only the filename, not the full path
    log.transports.file.resolvePathFn = () => {
      // Get current date for dynamic path resolution
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const currentDateFolder = `${year}-${month}-${day}`;
      
      const currentDailyLogDir = path.join(this.logDir, currentDateFolder);
      
      // Ensure the daily log directory exists
      if (!fs.existsSync(currentDailyLogDir)) {
        try {
          fs.mkdirSync(currentDailyLogDir, { recursive: true });
        } catch (err) {
          console.error('Failed to create daily log directory:', err);
        }
      }
      
      return path.join(currentDailyLogDir, 'main.log');
    };
    log.transports.file.maxSize = 1000000; // 1MB max file size

    // Enable console transport as well to ensure all logs appear in both places
    log.transports.console.level = 'debug';

    // Override console methods to also log to file
    this.setupConsoleOverrides();

    // Test the console override
    console.log('Console override test - this should appear in both terminal and log file');

    // Verify log file is writable
    this.verifyLogFile();
  }

  private setupConsoleOverrides(): void {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug
    };

    console.log = (...args: unknown[]) => {
      originalConsole.log(...args);
      log.info(...args);
    };

    console.error = (...args: unknown[]) => {
      originalConsole.error(...args);
      log.error(...args);
    };

    console.warn = (...args: unknown[]) => {
      originalConsole.warn(...args);
      log.warn(...args);
    };

    console.info = (...args: unknown[]) => {
      originalConsole.info(...args);
      log.info(...args);
    };

    console.debug = (...args: unknown[]) => {
      originalConsole.debug(...args);
      log.debug(...args);
    };
  }

  private verifyLogFile(): void {
    try {
      const logFilePath = path.join(this.logDir, 'main.log');
      console.log(`Log file path: ${logFilePath}`);
      console.log(`Log file exists: ${fs.existsSync(logFilePath)}`);
      
      // Test write to ensure the file is writable
      log.info('Testing log file write capability...');
      console.log('Log file write test completed');
    } catch (err) {
      console.error('Error checking log file:', err);
    }
  }

  // Function to clean up old log directories (keep only last 30 days)
  private cleanupOldLogs(): void {
    try {
      if (!fs.existsSync(this.logDir)) return;

      const entries = fs.readdirSync(this.logDir, { withFileTypes: true });
      const directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)) // Match YYYY-MM-DD format
        .sort()
        .reverse(); // Most recent first

      // Keep only the last 30 days
      if (directories.length > 30) {
        const toDelete = directories.slice(30);
        toDelete.forEach(dir => {
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

  // Schedule log cleanup to run periodically (every 24 hours)
  public scheduleLogCleanup(): void {
    // Run cleanup immediately after a short delay (non-blocking)
    setTimeout(() => {
      this.cleanupOldLogs();
    }, 5000); // 5 seconds delay

    // Schedule periodic cleanup every 24 hours
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldLogs();
    }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
  }

  // Clean up interval when app is about to quit
  public stopLogCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // Get the log directory path
  public getLogDir(): string {
    return this.logDir;
  }

  // Get the logger instance for direct use
  public getLogger() {
    return log;
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
export { log };
