import { StreamableAiFetchlyMCPServer } from './StreamableAiFetchlyMCPServer.js';
import { StreamableHttpConfigOptions } from './config/StreamableHttpConfig.js';

/**
 * Standalone Streamable HTTP AiFetchly MCP Server
 * 
 * This is a completely standalone MCP server that uses Streamable HTTP transport for HTTP-based communication.
 * It provides full MCP functionality with improved performance and reliability compared to SSE.
 */
export class StandaloneStreamableAiFetchlyMCPServer {
    private mcpServer: StreamableAiFetchlyMCPServer;
    
    constructor(options: Partial<StreamableHttpConfigOptions> = {}) {
        // Use environment variables or defaults
        const config: Partial<StreamableHttpConfigOptions> = {
            port: parseInt(process.env.MCP_HTTP_PORT || '3000', 10),
            streamEndpoint: process.env.MCP_STREAM_ENDPOINT || '/stream',
            requestEndpoint: process.env.MCP_REQUEST_ENDPOINT || '/stream/request',
            chunkSize: parseInt(process.env.MCP_CHUNK_SIZE || '8192', 10),
            compression: process.env.MCP_COMPRESSION !== 'false',
            maxConcurrentStreams: parseInt(process.env.MCP_MAX_CONCURRENT_STREAMS || '100', 10),
            streamTimeout: parseInt(process.env.MCP_STREAM_TIMEOUT || '300000', 10),
            bufferSize: parseInt(process.env.MCP_BUFFER_SIZE || '65536', 10),
            enableProgress: process.env.MCP_ENABLE_PROGRESS !== 'false',
            corsEnabled: process.env.MCP_CORS_ENABLED !== 'false',
            enableLogging: process.env.MCP_ENABLE_LOGGING !== 'false',
            logLevel: (process.env.MCP_LOG_LEVEL as any) || 'info',
            enableHealthCheck: process.env.MCP_ENABLE_HEALTH_CHECK !== 'false',
            healthCheckEndpoint: process.env.MCP_HEALTH_CHECK_ENDPOINT || '/health',
            enableServerInfo: process.env.MCP_ENABLE_SERVER_INFO !== 'false',
            serverInfoEndpoint: process.env.MCP_SERVER_INFO_ENDPOINT || '/info',
            chunkedTransfer: process.env.MCP_CHUNKED_TRANSFER !== 'false',
            compressionLevel: parseInt(process.env.MCP_COMPRESSION_LEVEL || '6', 10),
            maxChunkSize: parseInt(process.env.MCP_MAX_CHUNK_SIZE || '16384', 10),
            minChunkSize: parseInt(process.env.MCP_MIN_CHUNK_SIZE || '1024', 10),
            enableMetrics: process.env.MCP_ENABLE_METRICS !== 'false',
            metricsEndpoint: process.env.MCP_METRICS_ENDPOINT || '/metrics',
            ...options
        };
        
        this.mcpServer = new StreamableAiFetchlyMCPServer(config);
    }
    
    /**
     * Start the MCP server
     */
    public async start(): Promise<void> {
        try {
            await this.mcpServer.start();
            console.log('Standalone Streamable HTTP AiFetchly MCP Server started successfully');
            console.log('Transport: Streamable HTTP');
            console.log('Performance: Improved over SSE with better reliability');
        } catch (error) {
            console.error('Failed to start MCP server:', error);
            throw error;
        }
    }

    /**
     * Stop the MCP server
     */
    public async stop(): Promise<void> {
        try {
            await this.mcpServer.stop();
            console.log('Standalone Streamable HTTP AiFetchly MCP Server stopped successfully');
        } catch (error) {
            console.error('Failed to stop MCP server:', error);
            throw error;
        }
    }
    
    /**
     * Get server status
     */
    public getServerStatus() {
        return this.mcpServer.getServerStatus();
    }

    /**
     * Get server configuration
     */
    public getConfig() {
        return this.mcpServer.getConfig();
    }

    /**
     * Update server configuration
     */
    public updateConfig(updates: Partial<StreamableHttpConfigOptions>): void {
        this.mcpServer.updateConfig(updates);
    }

    /**
     * Get active streams
     */
    public getActiveStreams(): string[] {
        return this.mcpServer.getActiveStreams();
    }

    /**
     * Disconnect a specific stream
     */
    public disconnectStream(streamId: string): boolean {
        return this.mcpServer.disconnectStream(streamId);
    }

    /**
     * Get performance metrics
     */
    public getMetrics() {
        return this.mcpServer.getMetrics();
    }

    /**
     * Send streaming response to a specific stream
     */
    public async sendStreamingResponse(streamId: string, data: any, progressCallback?: (progress: number) => void): Promise<void> {
        return this.mcpServer.sendStreamingResponse(streamId, data, progressCallback);
    }

    /**
     * Send progress update to a specific stream
     */
    public async sendProgress(streamId: string, progress: number, message?: string): Promise<void> {
        return this.mcpServer.sendProgress(streamId, progress, message);
    }

    /**
     * Send error to a specific stream
     */
    public async sendError(streamId: string, error: Error | string, code?: number): Promise<void> {
        return this.mcpServer.sendError(streamId, error, code);
    }
}
