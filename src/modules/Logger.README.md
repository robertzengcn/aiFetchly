# Logger Module

A centralized logging module for the Electron application that provides date-based log organization and automatic cleanup.

## Features

- **Date-based log organization**: Logs are organized in folders by date (YYYY-MM-DD)
- **Automatic cleanup**: Old log directories are automatically cleaned up (keeps last 30 days)
- **Console integration**: All console methods are automatically logged to files
- **Singleton pattern**: Single instance across the application
- **Non-blocking**: Cleanup runs in the background without blocking app startup

## Usage

### Basic Usage

```typescript
import { logger, log } from '@/modules/Logger';

// Using the exported log object
log.info('Application started');
log.error('Something went wrong');
log.warn('Warning message');
log.debug('Debug information');

// Using console methods (automatically logged)
console.log('This will appear in both console and log file');
console.error('This will appear in both console and log file');
```

### Advanced Usage

```typescript
import { logger } from '@/modules/Logger';

// Get the logger instance
const loggerInstance = logger;

// Get log directory path
const logDir = logger.getLogDir();

// Get raw electron-log instance
const electronLog = logger.getLogger();

// Schedule cleanup (usually done in main process)
logger.scheduleLogCleanup();

// Stop cleanup (usually done on app shutdown)
logger.stopLogCleanup();
```

## Log Directory Structure

```
userData/logs/
├── 2024-01-13/
│   ├── main.log
│   ├── main.1.log
│   └── main.2.log
├── 2024-01-14/
│   ├── main.log
│   └── main.1.log
└── 2024-01-15/
    └── main.log
```

## Configuration

- **Max file size**: 1MB per log file
- **Retention period**: 30 days
- **Cleanup schedule**: Every 24 hours
- **Initial cleanup delay**: 5 seconds after app start

## Integration

The Logger module is automatically initialized when imported and integrates with:
- Console methods (log, error, warn, info, debug)
- Electron's main process
- Application lifecycle events

## Benefits

- **Organized logs**: Easy to find logs by date
- **Prevents large files**: Each day gets separate files
- **Automatic maintenance**: No manual cleanup needed
- **Performance**: Non-blocking operations
- **Centralized**: Single place for all logging configuration
