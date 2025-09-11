import express, { Request, Response, Application } from 'express';
import { Server as HttpServer } from 'http';
import { StreamableHttpTransport } from './transport/StreamableHttpTransport.js';
import { StreamableHttpConfig, StreamableHttpConfigOptions } from './config/StreamableHttpConfig.js';

/**
 * Streamable HTTP Server Wrapper for MCP Transport Management
 * 
 * Manages Express HTTP server and streaming connections for MCP clients.
 * Provides simplified connection management without session complexity.
 */
export class StreamableHttpServerWrapper {
    private app: Application;
    private server: HttpServer | null = null;
    private activeStreams: Map<string, StreamableHttpTransport> = new Map();
    private config: StreamableHttpConfig;
    private isRunning: boolean = false;
    private streamCounter: number = 0;

    constructor(options: Partial<StreamableHttpConfigOptions> = {}) {
        this.config = new StreamableHttpConfig(options);
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
                    activeStreams: this.activeStreams.size,
                    uptime: process.uptime(),
                    config: {
                        port: this.config.getPort(),
                        maxConcurrentStreams: this.config.getMaxConcurrentStreams(),
                        streamTimeout: this.config.getStreamTimeout(),
                        chunkSize: this.config.getChunkSize(),
                        compression: this.config.isCompressionEnabled()
                    }
                });
            });
        }

        // Stream endpoint for client connections
        this.app.get(this.config.getStreamEndpoint(), (req: Request, res: Response) => {
            this.handleStreamConnection(req, res);
        });

        // Request endpoint for incoming MCP requests
        this.app.post(this.config.getRequestEndpoint(), (req: Request, res: Response) => {
            this.handleRequest(req, res);
        });

        // Server info endpoint
        if (this.config.isServerInfoEnabled()) {
            this.app.get(this.config.getServerInfoEndpoint(), (req: Request, res: Response) => {
                res.json({
                    name: 'AiFetchly MCP Server',
                    version: '1.0.0',
                    transport: 'Streamable HTTP',
                    endpoints: {
                        stream: this.config.getStreamEndpoint(),
                        request: this.config.getRequestEndpoint(),
                        health: this.config.getHealthCheckEndpoint(),
                        info: this.config.getServerInfoEndpoint()
                    },
                    activeStreams: this.activeStreams.size,
                    config: {
                        port: this.config.getPort(),
                        maxConcurrentStreams: this.config.getMaxConcurrentStreams(),
                        streamTimeout: this.config.getStreamTimeout(),
                        chunkSize: this.config.getChunkSize(),
                        compression: this.config.isCompressionEnabled(),
                        chunkedTransfer: this.config.isChunkedTransferEnabled(),
                        corsEnabled: this.config.isCORSEnabled(),
                        loggingEnabled: this.config.isLoggingEnabled(),
                        logLevel: this.config.getLogLevel()
                    }
                });
            });
        }

        // Metrics endpoint
        if (this.config.isMetricsEnabled()) {
            this.app.get(this.config.getMetricsEndpoint(), (req: Request, res: Response) => {
                res.json({
                    timestamp: new Date().toISOString(),
                    activeStreams: this.activeStreams.size,
                    totalStreamsCreated: this.streamCounter,
                    config: this.config.getPerformanceConfig(),
                    memory: process.memoryUsage(),
                    uptime: process.uptime()
                });
            });
        }
    }

    /**
     * Handle stream connection establishment
     */
    private handleStreamConnection(req: Request, res: Response): void {
        try {
            // Check max concurrent streams limit
            if (this.activeStreams.size >= this.config.getMaxConcurrentStreams()) {
                res.status(503).json({ 
                    error: 'Server at maximum capacity',
                    maxConcurrentStreams: this.config.getMaxConcurrentStreams(),
                    currentStreams: this.activeStreams.size
                });
                return;
            }

            // Generate unique stream ID
            const streamId = `stream_${++this.streamCounter}_${Date.now()}`;
            
            // Create streamable HTTP transport
            const transport = new StreamableHttpTransport(res, {
                chunkSize: this.config.getChunkSize(),
                compression: this.config.isCompressionEnabled(),
                bufferSize: this.config.getBufferSize(),
                enableProgress: this.config.isProgressEnabled(),
                streamTimeout: this.config.getStreamTimeout(),
                chunkedTransfer: this.config.isChunkedTransferEnabled()
            });

            // Store transport
            this.activeStreams.set(streamId, transport);

            // Setup event handlers
            transport.onclose = () => {
                this.activeStreams.delete(streamId);
                if (this.config.isLoggingEnabled()) {
                    console.log(`Stream connection closed: ${streamId}`);
                }
            };

            transport.onerror = (error) => {
                this.activeStreams.delete(streamId);
                if (this.config.isLoggingEnabled()) {
                    console.error(`Stream connection error for ${streamId}:`, error);
                }
            };

            // Start the transport
            transport.start().then(() => {
                if (this.config.isLoggingEnabled()) {
                    console.log(`New stream connection established: ${streamId} (${this.activeStreams.size}/${this.config.getMaxConcurrentStreams()})`);
                }
            }).catch((error) => {
                this.activeStreams.delete(streamId);
                if (this.config.isLoggingEnabled()) {
                    console.error(`Failed to start stream connection ${streamId}:`, error);
                }
                res.status(500).json({ error: 'Failed to establish stream connection' });
            });

        } catch (error) {
            if (this.config.isLoggingEnabled()) {
                console.error('Error establishing stream connection:', error);
            }
            res.status(500).json({ error: 'Failed to establish stream connection' });
        }
    }

    /**
     * Handle incoming MCP requests
     */
    private handleRequest(req: Request, res: Response): void {
        try {
            const streamId = req.query.streamId as string;
            
            if (!streamId) {
                res.status(400).json({ error: 'Stream ID is required' });
                return;
            }

            const transport = this.activeStreams.get(streamId);
            if (!transport) {
                res.status(404).json({ error: 'No stream found for stream ID' });
                return;
            }

            // Handle the message using the transport
            transport.handleMessage(req.body)
                .then(() => {
                    res.json({ success: true, streamId });
                })
                .catch((error) => {
                    console.error(`Error handling request for stream ${streamId}:`, error);
                    res.status(500).json({ error: 'Failed to handle request' });
                });

        } catch (error) {
            console.error('Error handling request:', error);
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
                this.server = server;
                
                if (this.config.isLoggingEnabled()) {
                    console.log(this.config.getSummary());
                    console.log(`Stream endpoint: http://localhost:${this.config.getPort()}${this.config.getStreamEndpoint()}`);
                    console.log(`Request endpoint: http://localhost:${this.config.getPort()}${this.config.getRequestEndpoint()}`);
                    
                    if (this.config.isHealthCheckEnabled()) {
                        console.log(`Health check: http://localhost:${this.config.getPort()}${this.config.getHealthCheckEndpoint()}`);
                    }
                    
                    if (this.config.isServerInfoEnabled()) {
                        console.log(`Server info: http://localhost:${this.config.getPort()}${this.config.getServerInfoEndpoint()}`);
                    }

                    if (this.config.isMetricsEnabled()) {
                        console.log(`Metrics: http://localhost:${this.config.getPort()}${this.config.getMetricsEndpoint()}`);
                    }
                }
                resolve();
            });

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

            // Close all active streams
            this.activeStreams.forEach((transport, streamId) => {
                console.log(`Closing stream: ${streamId}`);
                transport.close();
            });
            this.activeStreams.clear();

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
     * Get active streams count
     */
    public getActiveStreamsCount(): number {
        return this.activeStreams.size;
    }

    /**
     * Get all active stream IDs
     */
    public getActiveStreamIds(): string[] {
        return Array.from(this.activeStreams.keys());
    }

    /**
     * Get transport by stream ID
     */
    public getTransport(streamId: string): StreamableHttpTransport | undefined {
        return this.activeStreams.get(streamId);
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
            activeStreams: this.activeStreams.size
        };
    }

    /**
     * Update server configuration (requires restart to take effect)
     */
    public updateConfig(updates: Partial<StreamableHttpConfigOptions>): void {
        this.config.updateConfig(updates);
    }

    /**
     * Get configuration summary
     */
    public getConfigSummary(): string {
        return this.config.getSummary();
    }

    /**
     * Get performance metrics
     */
    public getMetrics() {
        return {
            activeStreams: this.activeStreams.size,
            totalStreamsCreated: this.streamCounter,
            config: this.config.getPerformanceConfig(),
            memory: process.memoryUsage(),
            uptime: process.uptime()
        };
    }

    /**
     * Close a specific stream
     */
    public closeStream(streamId: string): boolean {
        const transport = this.activeStreams.get(streamId);
        if (transport) {
            transport.close();
            this.activeStreams.delete(streamId);
            return true;
        }
        return false;
    }
}
