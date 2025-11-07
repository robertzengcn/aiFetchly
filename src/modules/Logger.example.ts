// Example usage of the Logger module
import { logger, log } from './Logger';

// Example 1: Using the singleton logger instance
const loggerInstance = logger;

// Example 2: Using the exported log object directly
log.info('This is an info message');
log.error('This is an error message');
log.warn('This is a warning message');
log.debug('This is a debug message');

// Example 3: Using console methods (they are automatically overridden)
console.log('This will appear in both console and log file');
console.error('This will appear in both console and log file');

// Example 4: Getting the log directory path
const logDir = logger.getLogDir();
console.log('Log directory:', logDir);

// Example 5: Getting the raw electron-log instance
const electronLog = logger.getLogger();
electronLog.info('Using raw electron-log instance');

// Example 6: Scheduling cleanup (usually done in main process)
logger.scheduleLogCleanup();

// Example 7: Stopping cleanup (usually done on app shutdown)
logger.stopLogCleanup();
