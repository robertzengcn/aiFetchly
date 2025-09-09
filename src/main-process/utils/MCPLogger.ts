import log from 'electron-log/main';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Enhanced logging utility for MCP server events
 * Provides structured logging with context and severity levels
 */
export class MCPLogger {
    private static instance: MCPLogger;
    private logDir: string;
    private mcpLogFile: string;

    private constructor() {
        // Set up MCP-specific log directory
        this.logDir = path.join(process.cwd(), 'logs', 'mcp');
        this.mcpLogFile = path.join(this.logDir, 'mcp-server.log');
        
        // Ensure log directory exists
        this.ensureLogDirectory();
        
        // Configure electron-log for MCP
        this.configureLogging();
    }

    public static getInstance(): MCPLogger {
        if (!MCPLogger.instance) {
            MCPLogger.instance = new MCPLogger();
        }
        return MCPLogger.instance;
    }

    private ensureLogDirectory(): void {
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        } catch (error) {
            console.error('Failed to create MCP log directory:', error);
        }
    }

    private configureLogging(): void {
        // Configure electron-log to write MCP-specific logs
        log.transports.file.fileName = this.mcpLogFile;
        log.transports.file.level = 'debug';
        log.transports.console.level = 'info';
    }

    /**
     * Log server startup event
     */
    public logServerStart(attempt: number, maxAttempts: number, serverPath: string): void {
        const context = {
            event: 'server_start',
            attempt,
            maxAttempts,
            serverPath,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.info('MCP Server Start', context);
    }

    /**
     * Log server startup success
     */
    public logServerStartSuccess(attempt: number, duration: number): void {
        const context = {
            event: 'server_start_success',
            attempt,
            duration,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.info('MCP Server Start Success', context);
    }

    /**
     * Log server startup failure
     */
    public logServerStartFailure(attempt: number, maxAttempts: number, error: any): void {
        const context = {
            event: 'server_start_failure',
            attempt,
            maxAttempts,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.error('MCP Server Start Failure', context);
    }

    /**
     * Log server restart event
     */
    public logServerRestart(attempt: number, maxAttempts: number, reason: string): void {
        const context = {
            event: 'server_restart',
            attempt,
            maxAttempts,
            reason,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.warn('MCP Server Restart', context);
    }

    /**
     * Log server restart success
     */
    public logServerRestartSuccess(attempt: number, duration: number): void {
        const context = {
            event: 'server_restart_success',
            attempt,
            duration,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.info('MCP Server Restart Success', context);
    }

    /**
     * Log server restart failure
     */
    public logServerRestartFailure(attempt: number, maxAttempts: number, error: any): void {
        const context = {
            event: 'server_restart_failure',
            attempt,
            maxAttempts,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.error('MCP Server Restart Failure', context);
    }

    /**
     * Log server crash event
     */
    public logServerCrash(code: number, signal: string, reason?: string): void {
        const context = {
            event: 'server_crash',
            code,
            signal,
            reason,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.error('MCP Server Crash', context);
    }

    /**
     * Log server stop event
     */
    public logServerStop(reason: string): void {
        const context = {
            event: 'server_stop',
            reason,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.info('MCP Server Stop', context);
    }

    /**
     * Log critical error
     */
    public logCriticalError(error: string, context?: any): void {
        const logContext = {
            event: 'critical_error',
            error,
            context,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.error('MCP Critical Error', logContext);
    }

    /**
     * Log authentication error
     */
    public logAuthError(tool: string, errorType: string, details?: any): void {
        const context = {
            event: 'auth_error',
            tool,
            errorType,
            details,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.warn('MCP Auth Error', context);
    }

    /**
     * Log communication error
     */
    public logCommunicationError(operation: string, error: any): void {
        const context = {
            event: 'communication_error',
            operation,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.error('MCP Communication Error', context);
    }

    /**
     * Log max restart attempts reached
     */
    public logMaxRestartAttemptsReached(maxAttempts: number): void {
        const context = {
            event: 'max_restart_attempts_reached',
            maxAttempts,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        log.error('MCP Max Restart Attempts Reached', context);
    }

    /**
     * Log server health check
     */
    public logHealthCheck(isHealthy: boolean, details?: any): void {
        const context = {
            event: 'health_check',
            isHealthy,
            details,
            timestamp: new Date().toISOString(),
            pid: process.pid
        };
        
        if (isHealthy) {
            log.debug('MCP Health Check', context);
        } else {
            log.warn('MCP Health Check Failed', context);
        }
    }

    /**
     * Get the MCP log file path
     */
    public getLogFilePath(): string {
        return this.mcpLogFile;
    }

    /**
     * Get the log directory path
     */
    public getLogDirectory(): string {
        return this.logDir;
    }
}

// Export singleton instance
export const mcpLogger = MCPLogger.getInstance();
