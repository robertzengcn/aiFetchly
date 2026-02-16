/**
 * Shared logger utility for the application
 * Provides consistent logging format across all modules
 */

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR'
}

export class Logger {
    private prefix: string;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    private log(level: LogLevel, message: string, ...args: unknown[]): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] [${level}] [${this.prefix}] ${message}`;

        switch (level) {
            case LogLevel.DEBUG:
            case LogLevel.INFO:
                console.log(formattedMessage, ...args);
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage, ...args);
                break;
            case LogLevel.ERROR:
                console.error(formattedMessage, ...args);
                break;
        }
    }

    public debug(message: string, ...args: unknown[]): void {
        this.log(LogLevel.DEBUG, message, ...args);
    }

    public info(message: string, ...args: unknown[]): void {
        this.log(LogLevel.INFO, message, ...args);
    }

    public warn(message: string, ...args: unknown[]): void {
        this.log(LogLevel.WARN, message, ...args);
    }

    public error(message: string, ...args: unknown[]): void {
        this.log(LogLevel.ERROR, message, ...args);
    }
}

/**
 * Create a logger instance with a specific prefix
 */
export function createLogger(prefix: string): Logger {
    return new Logger(prefix);
}
