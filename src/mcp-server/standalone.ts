import { AiFetchlyMCPServer } from './AiFetchlyMCPServer.js';
import { SSEServerConfigOptions } from './config/SSEServerConfig.js';

/**
 * Standalone AiFetchly MCP Server
 * 
 * This is a completely standalone MCP server that uses SSE transport for HTTP-based communication.
 * It provides full MCP functionality with web client support.
 */
export class StandaloneAiFetchlyMCPServer {
    private mcpServer: AiFetchlyMCPServer;
    
    constructor(options: Partial<SSEServerConfigOptions> = {}) {
        // Use environment variables or defaults
        const config: Partial<SSEServerConfigOptions> = {
            port: parseInt(process.env.MCP_SSE_PORT || '3000', 10),
            sseEndpoint: process.env.MCP_SSE_ENDPOINT || '/sse',
            messagesEndpoint: process.env.MCP_MESSAGES_ENDPOINT || '/messages',
            corsEnabled: process.env.MCP_CORS_ENABLED !== 'false',
            enableLogging: process.env.MCP_ENABLE_LOGGING !== 'false',
            logLevel: (process.env.MCP_LOG_LEVEL as any) || 'info',
            ...options
        };
        
        this.mcpServer = new AiFetchlyMCPServer(config);
    }
    
    /**
     * Start the MCP server
     */
    public async start(): Promise<void> {
        try {
            await this.mcpServer.start();
            console.log('Standalone AiFetchly MCP Server started successfully');
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
            console.log('Standalone AiFetchly MCP Server stopped successfully');
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
    public updateConfig(updates: Partial<SSEServerConfigOptions>): void {
        this.mcpServer.updateConfig(updates);
    }

    /**
     * Get active sessions
     */
    public getActiveSessions(): string[] {
        return this.mcpServer.getActiveSessions();
    }

    /**
     * Disconnect a specific session
     */
    public disconnectSession(sessionId: string): boolean {
        return this.mcpServer.disconnectSession(sessionId);
    }
}
