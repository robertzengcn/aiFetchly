import log from 'electron-log/main';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// Create and configure a logger instance for child processes or other modules
export function createLogger(moduleName: string) {
  const logDir = path.join(app.getPath('userData'), 'logs');
  
  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Configure global transports for this module's log file
  const moduleLogPath = path.join(logDir, `${moduleName}.log`);
  
  // Create a simple scoped logger that uses the main log transports
  const logger = log.scope(moduleName);
  
  // Note: Scoped loggers inherit transport configuration from main log instance
  // The main log is already configured in background.ts to save to the logs directory
  
  return logger;
}

// Utility function to redirect child process stdio to log files
export function redirectChildProcessOutput(childProcess: NodeJS.Process, processName: string) {
  const logger = createLogger(`child-${processName}`);
  
  if (childProcess.stdout) {
    childProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        logger.info(`[STDOUT] ${output}`);
      }
    });
  }
  
  if (childProcess.stderr) {
    childProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        logger.error(`[STDERR] ${output}`);
      }
    });
  }
  
  // Log when process exits
  childProcess.on('exit', (code, signal) => {
    logger.info(`Process exited with code ${code} and signal ${signal}`);
  });
  
  childProcess.on('error', (error) => {
    logger.error(`Process error: ${error.message}`);
  });
}

// Get the main log directory path
export function getLogDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

// Utility function to log all console output to a specific file
export function setupConsoleLogging(logFileName: string = 'console.log') {
  const logDir = getLogDir();
  const logFilePath = path.join(logDir, logFileName);
  
  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // Create a write stream for the console log file
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  
  // Override console methods
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug
  };
  
  const logToFile = (level: string, ...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    logStream.write(`${timestamp} [${level.toUpperCase()}] ${message}\n`);
  };
  
  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    logToFile('info', ...args);
  };
  
  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    logToFile('error', ...args);
  };
  
  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    logToFile('warn', ...args);
  };
  
  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    logToFile('info', ...args);
  };
  
  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    logToFile('debug', ...args);
  };
  
  // Return a cleanup function
  return () => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    logStream.end();
  };
}
