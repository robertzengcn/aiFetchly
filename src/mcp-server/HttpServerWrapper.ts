import express, { Request, Response, Application } from 'express';
import { Server as HttpServer } from 'http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { v4 as uuidv4 } from 'uuid';
import { SSEServerConfig, SSEServerConfigOptions } from './config/SSEServerConfig.js';

/**
 * HTTP Server Wrapper for MCP SSE Transport Management
 * 
 * Manages Express HTTP server and multiple SSE connections for MCP clients.
 * Provides session management and connection lifecycle handling.
 */
export class HttpServerWrapper {
    private app: Application;
    private server: HttpServer | null = null;
    private transports: Map<string, SSEServerTransport> = new Map();
    private config: SSEServerConfig;
    private isRunning: boolean = false;

    constructor(options: Partial<SSEServerConfigOptions> = {}) {
        this.config = new SSEServerConfig(options);
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    /**
     * Setup Express middleware
     */
    private setupMiddleware(): void {
        // JSON parsing
        this.app.use(express.json());
        
        // CORS support
        if (this.config.isCORSEnabled()) {
            this.app.use((req: Request, res: Response, next) => {
                const origins = this.config.getCORSOrigins();
                const origin = req.headers.origin;
                
                if (origins.includes('*') || (origin && origins.includes(origin))) {
                    res.header('Access-Control-Allow-Origin', origin || '*');
                }
                
                res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
                res.header('Access-Control-Allow-Credentials', 'true');
                
                if (req.method === 'OPTIONS') {
                    res.sendStatus(200);
                    return;
                }
                next();
            });
        }

        // Request logging
        if (this.config.isLoggingEnabled()) {
            this.app.use((req: Request, res: Response, next) => {
                const logLevel = this.config.getLogLevel();
                const timestamp = new Date().toISOString();
                const message = `${timestamp} - ${req.method} ${req.path}`;
                
                switch (logLevel) {
                    case 'debug':
                        console.debug(message);
                        break;
                    case 'info':
                        console.log(message);
                        break;
                    case 'warn':
                        console.warn(message);
                        break;
                    case 'error':
                        console.error(message);
                        break;
                }
                next();
            });
        }
    }

    /**
     * Setup Express routes
     */
    private setupRoutes(): void {
        // Health check endpoint
        if (this.config.isHealthCheckEnabled()) {
            this.app.get(this.config.getHealthCheckEndpoint(), (req: Request, res: Response) => {
                res.json({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    activeConnections: this.transports.size,
                    uptime: process.uptime(),
                    config: {
                        port: this.config.getPort(),
                        maxConnections: this.config.getMaxConnections(),
                        sessionTimeout: this.config.getSessionTimeout()
                    }
                });
            });
        }

        // SSE endpoint for client connections
        this.app.get(this.config.getSSEEndpoint(), (req: Request, res: Response) => {
            this.handleSSEConnection(req, res);
        });

        // Messages endpoint for incoming MCP requests
        this.app.post(this.config.getMessagesEndpoint(), (req: Request, res: Response) => {
            this.handleMessage(req, res);
        });

        // Server info endpoint
        if (this.config.isServerInfoEnabled()) {
            this.app.get(this.config.getServerInfoEndpoint(), (req: Request, res: Response) => {
                res.json({
                    name: 'AiFetchly MCP Server',
                    version: '1.0.0',
                    transport: 'SSE',
                    endpoints: {
                        sse: this.config.getSSEEndpoint(),
                        messages: this.config.getMessagesEndpoint(),
                        health: this.config.getHealthCheckEndpoint(),
                        info: this.config.getServerInfoEndpoint()
                    },
                    activeConnections: this.transports.size,
                    config: {
                        port: this.config.getPort(),
                        maxConnections: this.config.getMaxConnections(),
                        sessionTimeout: this.config.getSessionTimeout(),
                        corsEnabled: this.config.isCORSEnabled(),
                        loggingEnabled: this.config.isLoggingEnabled(),
                        logLevel: this.config.getLogLevel()
                    }
                });
            });
        }
    }

    /**
     * Handle SSE connection establishment
     */
    private handleSSEConnection(req: Request, res: Response): void {
        try {
            // Check max connections limit
            if (this.transports.size >= this.config.getMaxConnections()) {
                res.status(503).json({ 
                    error: 'Server at maximum capacity',
                    maxConnections: this.config.getMaxConnections(),
                    currentConnections: this.transports.size
                });
                return;
            }

            // Generate unique session ID
            const sessionId = uuidv4();
            
            // Set SSE headers
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Cache-Control'
            });

            // Create SSE transport
            const transport = new SSEServerTransport(this.config.getMessagesEndpoint(), res);
            this.transports.set(sessionId, transport);

            if (this.config.isLoggingEnabled()) {
                console.log(`New SSE connection established: ${sessionId} (${this.transports.size}/${this.config.getMaxConnections()})`);
            }

            // Send initial connection event
            res.write(`data: ${JSON.stringify({
                type: 'connected',
                sessionId: sessionId,
                timestamp: new Date().toISOString(),
                config: {
                    sessionTimeout: this.config.getSessionTimeout(),
                    maxConnections: this.config.getMaxConnections()
                }
            })}\n\n`);

            // Set up session timeout
            const timeout = setTimeout(() => {
                if (this.transports.has(sessionId)) {
                    if (this.config.isLoggingEnabled()) {
                        console.log(`SSE connection timeout: ${sessionId}`);
                    }
                    this.transports.delete(sessionId);
                    res.end();
                }
            }, this.config.getSessionTimeout());

            // Handle client disconnect
            req.on('close', () => {
                clearTimeout(timeout);
                if (this.config.isLoggingEnabled()) {
                    console.log(`SSE connection closed: ${sessionId}`);
                }
                this.transports.delete(sessionId);
            });

            req.on('error', (error) => {
                clearTimeout(timeout);
                if (this.config.isLoggingEnabled()) {
                    console.error(`SSE connection error for ${sessionId}:`, error);
                }
                this.transports.delete(sessionId);
            });

        } catch (error) {
            if (this.config.isLoggingEnabled()) {
                console.error('Error establishing SSE connection:', error);
            }
            res.status(500).json({ error: 'Failed to establish SSE connection' });
        }
    }

    /**
     * Handle incoming MCP messages
     */
    private handleMessage(req: Request, res: Response): void {
        try {
            const sessionId = req.query.sessionId as string;
            
            if (!sessionId) {
                res.status(400).json({ error: 'Session ID is required' });
                return;
            }

            const transport = this.transports.get(sessionId);
            if (!transport) {
                res.status(404).json({ error: 'No transport found for session ID' });
                return;
            }

            // Handle the message using the transport
            transport.handlePostMessage(req, res)
                .catch((error) => {
                    console.error(`Error handling message for session ${sessionId}:`, error);
                    res.status(500).json({ error: 'Failed to handle message' });
                });

        } catch (error) {
            console.error('Error handling message:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Start the HTTP server
     */
    public async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.isRunning) {
                if (this.config.isLoggingEnabled()) {
                    console.log('HTTP server is already running');
                }
                resolve();
                return;
            }

            const server = this.app.listen(this.config.getPort(), () => {
                this.isRunning = true;
                
                if (this.config.isLoggingEnabled()) {
                    console.log(this.config.getSummary());
                    console.log(`SSE endpoint: http://localhost:${this.config.getPort()}${this.config.getSSEEndpoint()}`);
                    console.log(`Messages endpoint: http://localhost:${this.config.getPort()}${this.config.getMessagesEndpoint()}`);
                    
                    if (this.config.isHealthCheckEnabled()) {
                        console.log(`Health check: http://localhost:${this.config.getPort()}${this.config.getHealthCheckEndpoint()}`);
                    }
                    
                    if (this.config.isServerInfoEnabled()) {
                        console.log(`Server info: http://localhost:${this.config.getPort()}${this.config.getServerInfoEndpoint()}`);
                    }
                }
                resolve();
            });
            this.server = server;

            server.on('error', (error) => {
                if (this.config.isLoggingEnabled()) {
                    console.error('HTTP server error:', error);
                }
                reject(error);
            });
        });
    }

    /**
     * Stop the HTTP server
     */
    public async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.isRunning || !this.server) {
                console.log('HTTP server is not running');
                resolve();
                return;
            }

            // Close all SSE connections
            this.transports.forEach((transport, sessionId) => {
                console.log(`Closing SSE connection: ${sessionId}`);
                this.transports.delete(sessionId);
            });

            // Close the HTTP server
            this.server.close(() => {
                this.isRunning = false;
                this.server = null;
                console.log('HTTP server stopped');
                resolve();
            });
        });
    }

    /**
     * Get active connections count
     */
    public getActiveConnectionsCount(): number {
        return this.transports.size;
    }

    /**
     * Get all active session IDs
     */
    public getActiveSessionIds(): string[] {
        return Array.from(this.transports.keys());
    }

    /**
     * Get transport by session ID
     */
    public getTransport(sessionId: string): SSEServerTransport | undefined {
        return this.transports.get(sessionId);
    }

    /**
     * Check if server is running
     */
    public isServerRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Get server configuration
     */
    public getConfig() {
        return {
            ...this.config.getConfig(),
            isRunning: this.isRunning,
            activeConnections: this.transports.size
        };
    }

    /**
     * Update server configuration (requires restart to take effect)
     */
    public updateConfig(updates: Partial<SSEServerConfigOptions>): void {
        this.config.updateConfig(updates);
    }

    /**
     * Get configuration summary
     */
    public getConfigSummary(): string {
        return this.config.getSummary();
    }
}
