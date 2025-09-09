import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import log from 'electron-log/main';
import { LoginStateMonitor } from '../mcp-server/LoginStateMonitor';
import { mcpLogger } from './utils/MCPLogger';

/**
 * MCP Integration Class
 * 
 * Manages the MCP server process lifecycle within the Electron main process.
 * Handles spawning, monitoring, and communication with the MCP server.
 */
export class MCPIntegration extends EventEmitter {
    private mcpProcess: ChildProcess | null = null;
    private isRunning: boolean = false;
    private serverPath: string;
    private restartAttempts: number = 0;
    private maxRestartAttempts: number = 3;
    private restartDelay: number = 5000; // 5 seconds
    private initialStartupAttempts: number = 0;
    private maxInitialStartupAttempts: number = 3;
    private initialStartupDelays: number[] = [2000, 4000, 8000]; // Exponential backoff delays
    private loginStateMonitor: LoginStateMonitor;
    
    constructor() {
        super();
        
        // Determine the path to the built MCP server
        const isDevelopment = process.env.NODE_ENV !== 'production';
        if (isDevelopment) {
            this.serverPath = path.join(__dirname, '../../dist/mcp-server/index.js');
        } else {
            this.serverPath = path.join(process.resourcesPath, 'dist/mcp-server/index.js');
        }
        
        // Initialize login state monitor
        this.loginStateMonitor = new LoginStateMonitor();
        this.setupLoginStateListener();
        
        log.info(`MCP Integration initialized. Server path: ${this.serverPath}`);
        mcpLogger.logServerStart(0, 0, this.serverPath);
    }
    
    /**
     * Start the MCP server process with retry logic
     */
    public async startServer(): Promise<boolean> {
        if (this.isRunning) {
            log.warn('MCP server is already running');
            return true;
        }
        
        // Check if the server file exists
        if (!fs.existsSync(this.serverPath)) {
            log.error(`MCP server file not found at: ${this.serverPath}`);
            this.emit('error', new Error(`MCP server file not found at: ${this.serverPath}`));
            return false;
        }
        
        return await this.startServerWithRetry();
    }

    /**
     * Start the MCP server with retry logic and exponential backoff
     */
    private async startServerWithRetry(): Promise<boolean> {
        for (let attempt = 0; attempt < this.maxInitialStartupAttempts; attempt++) {
            this.initialStartupAttempts = attempt + 1;
            
            try {
                const startTime = Date.now();
                log.info(`Starting MCP server (attempt ${this.initialStartupAttempts}/${this.maxInitialStartupAttempts})...`);
                mcpLogger.logServerStart(this.initialStartupAttempts, this.maxInitialStartupAttempts, this.serverPath);
                
                // Spawn the MCP server process
                this.mcpProcess = spawn('node', [this.serverPath], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        NODE_ENV: process.env.NODE_ENV || 'production'
                    }
                });
                
                // Set up event handlers
                this.setupProcessHandlers();
                
                // Wait for the process to start
                await this.waitForServerStart();
                
                this.isRunning = true;
                this.restartAttempts = 0;
                this.initialStartupAttempts = 0; // Reset on success
                
                const duration = Date.now() - startTime;
                log.info('MCP server started successfully');
                mcpLogger.logServerStartSuccess(this.initialStartupAttempts, duration);
                this.emit('started');
                
                return true;
                
            } catch (error) {
                log.error(`Failed to start MCP server (attempt ${this.initialStartupAttempts}):`, error);
                mcpLogger.logServerStartFailure(this.initialStartupAttempts, this.maxInitialStartupAttempts, error);
                
                // Clean up the failed process
                if (this.mcpProcess) {
                    this.mcpProcess.kill('SIGTERM');
                    this.mcpProcess = null;
                }
                
                // If this was the last attempt, emit error and return false
                if (attempt === this.maxInitialStartupAttempts - 1) {
                    log.error(`Failed to start MCP server after ${this.maxInitialStartupAttempts} attempts`);
                    mcpLogger.logMaxRestartAttemptsReached(this.maxInitialStartupAttempts);
                    this.emit('error', new Error(`Failed to start MCP server after ${this.maxInitialStartupAttempts} attempts: ${error}`));
                    return false;
                }
                
                // Wait before retrying with exponential backoff
                const delay = this.initialStartupDelays[attempt] || this.initialStartupDelays[this.initialStartupDelays.length - 1];
                log.info(`Retrying MCP server startup in ${delay}ms...`);
                await this.delay(delay);
            }
        }
        
        return false;
    }

    /**
     * Utility method to create a delay
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if an error message indicates a critical error that requires restart
     */
    private isCriticalError(errorMessage: string): boolean {
        const criticalErrorPatterns = [
            /FATAL ERROR/i,
            /Out of memory/i,
            /Maximum call stack exceeded/i,
            /Cannot find module/i,
            /EADDRINUSE/i,
            /ECONNREFUSED/i,
            /ENOENT.*mcp-server/i,
            /SyntaxError/i,
            /ReferenceError/i,
            /TypeError.*Cannot read property/i
        ];

        return criticalErrorPatterns.some(pattern => pattern.test(errorMessage));
    }

    /**
     * Check if a process error indicates a startup failure
     */
    private isProcessStartupError(error: Error): boolean {
        const startupErrorPatterns = [
            /spawn.*ENOENT/i,
            /spawn.*EACCES/i,
            /spawn.*EMFILE/i,
            /ENOENT.*node/i,
            /Cannot find module.*mcp-server/i
        ];

        return startupErrorPatterns.some(pattern => pattern.test(error.message));
    }
    
    /**
     * Stop the MCP server process
     */
    public async stopServer(): Promise<boolean> {
        try {
            if (!this.isRunning || !this.mcpProcess) {
                log.warn('MCP server is not running');
                return true;
            }
            
            log.info('Stopping MCP server...');
            
            // Send SIGTERM to gracefully shutdown
            this.mcpProcess.kill('SIGTERM');
            
            // Wait for the process to exit
            await this.waitForProcessExit();
            
            this.isRunning = false;
            this.mcpProcess = null;
            
            log.info('MCP server stopped successfully');
            this.emit('stopped');
            
            return true;
        } catch (error) {
            log.error('Failed to stop MCP server:', error);
            this.emit('error', error);
            return false;
        }
    }
    
    /**
     * Restart the MCP server process
     */
    public async restartServer(): Promise<boolean> {
        log.info('Restarting MCP server...');
        
        await this.stopServer();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        return await this.startServer();
    }
    
    /**
     * Check if the MCP server is running
     */
    public isServerRunning(): boolean {
        return this.isRunning && this.mcpProcess !== null && !this.mcpProcess.killed;
    }
    
    /**
     * Get server process information
     */
    public getServerInfo(): any {
        if (!this.mcpProcess) {
            return null;
        }
        
        return {
            pid: this.mcpProcess.pid,
            isRunning: this.isRunning,
            restartAttempts: this.restartAttempts,
            serverPath: this.serverPath
        };
    }
    
    /**
     * Setup login state change listener
     */
    private setupLoginStateListener(): void {
        this.loginStateMonitor.on('loginStateChanged', (loginState) => {
            log.info('Login state changed, sending to MCP server:', loginState);
            this.sendLoginStateToServer(loginState);
        });
    }
    
    /**
     * Send login state to MCP server
     */
    private sendLoginStateToServer(loginState: any): void {
        const message = {
            type: 'loginStateChange',
            data: loginState,
            timestamp: new Date().toISOString()
        };
        
        this.sendToServer(message);
    }
    
    /**
     * Send data to the MCP server via stdin
     */
    public sendToServer(data: any): boolean {
        if (!this.isServerRunning() || !this.mcpProcess) {
            log.warn('Cannot send data to MCP server: server not running');
            return false;
        }
        
        try {
            const jsonData = JSON.stringify(data) + '\n';
            this.mcpProcess.stdin?.write(jsonData);
            log.debug('Sent data to MCP server:', jsonData.trim());
            return true;
        } catch (error) {
            log.error('Failed to send data to MCP server:', error);
            
            // If the write failed, it might be because the server crashed
            // Check if the process is still running
            if (this.mcpProcess && this.mcpProcess.killed) {
                log.warn('MCP server process appears to have died during write operation');
                mcpLogger.logCommunicationError('write', error);
                this.isRunning = false;
                this.emit('serverDiedDuringWrite', error);
            } else {
                mcpLogger.logCommunicationError('write', error);
            }
            
            return false;
        }
    }

    /**
     * Manually restart the MCP server
     */
    public async manualRestart(): Promise<boolean> {
        log.info('Manual MCP server restart requested');
        this.restartAttempts = 0; // Reset restart attempts for manual restart
        return await this.restartServer();
    }
    
    /**
     * Set up process event handlers
     */
    private setupProcessHandlers(): void {
        if (!this.mcpProcess) return;
        
        // Handle stdout
        this.mcpProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            log.debug('MCP Server stdout:', output);
            this.emit('stdout', output);
        });
        
        // Handle stderr
        this.mcpProcess.stderr?.on('data', (data) => {
            const error = data.toString();
            log.error('MCP Server stderr:', error);
            this.emit('stderr', error);
            
            // Check for critical errors that might indicate the server is in a bad state
            if (this.isCriticalError(error)) {
                log.error('Critical error detected in MCP server, considering restart...');
                mcpLogger.logCriticalError(error, { source: 'stderr' });
                this.emit('criticalError', error);
                
                // If we detect a critical error, we might want to restart the server
                // But only if it's not already in the process of restarting
                if (this.restartAttempts === 0) {
                    log.warn('Critical error detected, scheduling restart...');
                    this.scheduleRestart();
                }
            }
        });
        
        // Handle process exit
        this.mcpProcess.on('exit', (code, signal) => {
            log.info(`MCP server exited with code ${code} and signal ${signal}`);
            this.isRunning = false;
            this.emit('exit', { code, signal });
            
            // Attempt to restart if it was an unexpected exit (non-zero code)
            // Only restart if the server was running successfully before the crash
            if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
                log.warn(`MCP server crashed unexpectedly (code: ${code}, signal: ${signal}). Scheduling restart...`);
                mcpLogger.logServerCrash(code ?? -1, signal ?? 'unknown', 'unexpected exit');
                this.scheduleRestart();
            } else if (code !== 0) {
                log.error(`MCP server crashed and max restart attempts (${this.maxRestartAttempts}) reached. Giving up.`);
                mcpLogger.logServerCrash(code ?? -1, signal ?? 'unknown', 'max restart attempts reached');
                this.emit('maxRestartAttemptsReached', { code, signal });
            } else {
                log.info('MCP server exited normally (code: 0)');
                mcpLogger.logServerStop('normal exit');
            }
        });
        
        // Handle process error
        this.mcpProcess.on('error', (error) => {
            log.error('MCP server process error:', error);
            this.isRunning = false;
            this.emit('error', error);
            
            // If the process error indicates the server can't be started,
            // we should try to restart it
            if (this.isProcessStartupError(error)) {
                log.warn('Process startup error detected, scheduling restart...');
                if (this.restartAttempts === 0) {
                    this.scheduleRestart();
                }
            }
        });
    }
    
    /**
     * Wait for the server to start
     */
    private async waitForServerStart(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.mcpProcess) {
                reject(new Error('Process not started'));
                return;
            }
            
            const timeout = setTimeout(() => {
                reject(new Error('MCP server start timeout'));
            }, 10000); // 10 second timeout
            
            let hasResolved = false;
            
            // Listen for the server ready message
            const onStdout = (data: Buffer) => {
                if (hasResolved) return;
                
                const output = data.toString();
                if (output.includes('AiFetchly MCP Server started successfully')) {
                    hasResolved = true;
                    clearTimeout(timeout);
                    this.mcpProcess?.stdout?.off('data', onStdout);
                    this.mcpProcess?.stderr?.off('data', onStderr);
                    resolve();
                }
            };
            
            // Listen for startup errors
            const onStderr = (data: Buffer) => {
                if (hasResolved) return;
                
                const error = data.toString();
                if (this.isCriticalError(error)) {
                    hasResolved = true;
                    clearTimeout(timeout);
                    this.mcpProcess?.stdout?.off('data', onStdout);
                    this.mcpProcess?.stderr?.off('data', onStderr);
                    reject(new Error(`MCP server startup failed with critical error: ${error}`));
                }
            };
            
            this.mcpProcess.stdout?.on('data', onStdout);
            this.mcpProcess.stderr?.on('data', onStderr);
            
            // Also resolve if the process is running after a short delay
            setTimeout(() => {
                if (hasResolved) return;
                
                if (this.mcpProcess && !this.mcpProcess.killed) {
                    hasResolved = true;
                    clearTimeout(timeout);
                    this.mcpProcess.stdout?.off('data', onStdout);
                    this.mcpProcess.stderr?.off('data', onStderr);
                    resolve();
                }
            }, 2000);
        });
    }
    
    /**
     * Wait for the process to exit
     */
    private async waitForProcessExit(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.mcpProcess) {
                resolve();
                return;
            }
            
            const timeout = setTimeout(() => {
                log.warn('MCP server did not exit gracefully, forcing kill');
                this.mcpProcess?.kill('SIGKILL');
                resolve();
            }, 5000); // 5 second timeout
            
            this.mcpProcess.on('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
    
    /**
     * Schedule a restart attempt for runtime crashes
     */
    private scheduleRestart(): void {
        this.restartAttempts++;
        log.warn(`Scheduling MCP server restart attempt ${this.restartAttempts}/${this.maxRestartAttempts} in ${this.restartDelay}ms`);
        mcpLogger.logServerRestart(this.restartAttempts, this.maxRestartAttempts, 'scheduled');
        
        setTimeout(async () => {
            if (this.restartAttempts <= this.maxRestartAttempts) {
                const startTime = Date.now();
                log.info(`Attempting MCP server restart ${this.restartAttempts}/${this.maxRestartAttempts}...`);
                
                try {
                    // Use the direct restart method instead of startServer to avoid initial startup retry logic
                    const success = await this.restartServerInternal();
                    if (success) {
                        const duration = Date.now() - startTime;
                        log.info(`MCP server restart attempt ${this.restartAttempts} successful`);
                        mcpLogger.logServerRestartSuccess(this.restartAttempts, duration);
                        this.restartAttempts = 0; // Reset on successful restart
                        this.emit('restarted');
                    } else {
                        log.error(`MCP server restart attempt ${this.restartAttempts} failed`);
                        mcpLogger.logServerRestartFailure(this.restartAttempts, this.maxRestartAttempts, 'restart failed');
                        this.emit('restartFailed', { attempt: this.restartAttempts });
                    }
                } catch (error) {
                    log.error(`MCP server restart attempt ${this.restartAttempts} failed with error:`, error);
                    mcpLogger.logServerRestartFailure(this.restartAttempts, this.maxRestartAttempts, error);
                    this.emit('restartFailed', { attempt: this.restartAttempts, error });
                }
            } else {
                log.error(`Max restart attempts (${this.maxRestartAttempts}) reached, giving up on MCP server`);
                mcpLogger.logMaxRestartAttemptsReached(this.maxRestartAttempts);
                this.emit('maxRestartAttemptsReached');
            }
        }, this.restartDelay);
    }

    /**
     * Restart the MCP server (for runtime crashes, not initial startup)
     */
    private async restartServerInternal(): Promise<boolean> {
        try {
            // Clean up the existing process if it exists
            if (this.mcpProcess) {
                this.mcpProcess.kill('SIGTERM');
                this.mcpProcess = null;
            }
            
            // Wait a moment for cleanup
            await this.delay(1000);
            
            // Check if the server file still exists
            if (!fs.existsSync(this.serverPath)) {
                log.error(`MCP server file not found during restart: ${this.serverPath}`);
                return false;
            }
            
            log.info('Restarting MCP server...');
            
            // Spawn the MCP server process
            this.mcpProcess = spawn('node', [this.serverPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    NODE_ENV: process.env.NODE_ENV || 'production'
                }
            });
            
            // Set up event handlers
            this.setupProcessHandlers();
            
            // Wait for the process to start
            await this.waitForServerStart();
            
            this.isRunning = true;
            
            log.info('MCP server restarted successfully');
            return true;
            
        } catch (error) {
            log.error('Failed to restart MCP server:', error);
            this.isRunning = false;
            return false;
        }
    }
    
    /**
     * Clean up resources
     */
    public destroy(): void {
        if (this.mcpProcess) {
            this.mcpProcess.kill('SIGKILL');
            this.mcpProcess = null;
        }
        this.isRunning = false;
        this.removeAllListeners();
    }
}
