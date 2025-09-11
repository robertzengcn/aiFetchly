import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHttpTransport } from "./transport/StreamableHttpTransport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AiFetchlyController } from './AiFetchlyController';
import { LoginStateMonitor } from './LoginStateMonitor';
import { StreamableHttpServerWrapper } from './StreamableHttpServerWrapper';
import { StreamableHttpConfigOptions } from './config/StreamableHttpConfig.js';

/**
 * AiFetchly MCP Server with Streamable HTTP Transport
 * 
 * Provides MCP tools for aiFetchly functionality including:
 * - Search engine scraping (Google, Bing)
 * - Yellow pages scraping
 * - Website scraping
 * - Email extraction
 * - General task and result management
 * 
 * Uses Streamable HTTP transport for improved performance and reliability
 */
export class StreamableAiFetchlyMCPServer {
    private server: Server;
    private aiFetchlyController: AiFetchlyController;
    private loginStateMonitor: LoginStateMonitor;
    private httpServerWrapper: StreamableHttpServerWrapper;
    private activeTransports: Map<string, StreamableHttpTransport> = new Map();
    
    constructor(options: Partial<StreamableHttpConfigOptions> = {}) {
        this.server = new Server({
            name: "aifetchly-mcp-server",
            version: "1.0.0"
        }, {
            capabilities: {
                tools: {}
            }
        });
        
        this.aiFetchlyController = new AiFetchlyController();
        this.loginStateMonitor = new LoginStateMonitor();
        this.httpServerWrapper = new StreamableHttpServerWrapper(options);
        
        this.setupHandlers();
        this.registerTools();
        this.setupStreamHandlers();
    }
    
    /**
     * Start the MCP server
     */
    public async start(): Promise<void> {
        try {
            // Start the HTTP server
            await this.httpServerWrapper.start();
            console.log('AiFetchly MCP Server started successfully with Streamable HTTP transport');
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
            // Close all active transports
            this.activeTransports.forEach((transport, streamId) => {
                console.log(`Closing transport: ${streamId}`);
                transport.close();
            });
            this.activeTransports.clear();

            // Stop the HTTP server
            await this.httpServerWrapper.stop();
            console.log('AiFetchly MCP Server stopped successfully');
        } catch (error) {
            console.error('Failed to stop MCP server:', error);
            throw error;
        }
    }
    
    /**
     * Setup request handlers
     */
    private setupHandlers(): void {
        // Handle list tools request
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: this.getToolsList()
            };
        });
        
        // Handle call tool request
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            
            try {
                switch (name) {
                    // Search Engine Tools
                    case "create_search_task":
                    case "list_search_tasks":
                    case "get_search_task":
                    case "get_search_results":
                    case "update_search_task":
                    case "delete_search_task":
                        await this.validateLoginState();
                        return await this.aiFetchlyController.handleSearchEngine(name, args);
                    
                    // Yellow Pages Tools
                    case "create_yellow_pages_task":
                    case "list_yellow_pages_tasks":
                    case "get_yellow_pages_task":
                    case "get_yellow_pages_results":
                    case "update_yellow_pages_task":
                    case "delete_yellow_pages_task":
                        await this.validateLoginState();
                        return await this.aiFetchlyController.handleYellowPages(name, args);
                    
                    // Website Scraping Tools
                    case "create_website_scraping_task":
                    case "list_website_scraping_tasks":
                    case "get_website_scraping_task":
                    case "get_website_scraping_results":
                    case "update_website_scraping_task":
                    case "delete_website_scraping_task":
                        await this.validateLoginState();
                        return await this.aiFetchlyController.handleWebsiteScraping(name, args);
                    
                    // Email Extraction Tools
                    case "create_email_extraction_task":
                    case "list_email_extraction_tasks":
                    case "get_email_extraction_task":
                    case "get_email_extraction_results":
                    case "update_email_extraction_task":
                    case "delete_email_extraction_task":
                        await this.validateLoginState();
                        return await this.aiFetchlyController.handleEmailExtraction(name, args);
                    
                    // General Tools
                    case "get_system_status":
                        return await this.aiFetchlyController.getSystemStatus();
                    
                    case "get_task_statistics":
                        await this.validateLoginState();
                        return await this.aiFetchlyController.getTaskStatistics(args);
                    
                    case "export_results":
                        await this.validateLoginState();
                        return await this.aiFetchlyController.exportResults(args);
                    
                    case "get_user_profile":
                        await this.validateLoginState();
                        return await this.aiFetchlyController.getUserProfile();
                    
                    default:
                        throw new Error(`Unknown tool: ${name}`);
                }
            } catch (error) {
                console.error(`Error calling tool ${name}:`, error);
                throw error;
            }
        });
    }
    
    /**
     * Setup stream-specific handlers
     */
    private setupStreamHandlers(): void {
        // Override the HTTP server's request handler to connect MCP server to stream transport
        const originalHandleRequest = this.httpServerWrapper['handleRequest'].bind(this.httpServerWrapper);
        
        this.httpServerWrapper['handleRequest'] = async (req: any, res: any) => {
            try {
                const streamId = req.query.streamId as string;
                
                if (!streamId) {
                    res.status(400).json({ error: 'Stream ID is required' });
                    return;
                }

                // Get or create transport for this stream
                let transport = this.activeTransports.get(streamId);
                if (!transport) {
                    // Get the transport from the server wrapper
                    transport = this.httpServerWrapper.getTransport(streamId);
                    if (!transport) {
                        res.status(404).json({ error: 'No stream found for stream ID' });
                        return;
                    }
                    
                    // Connect the MCP server to this transport
                    await this.server.connect(transport);
                    this.activeTransports.set(streamId, transport);
                    console.log(`MCP server connected to stream transport: ${streamId}`);
                }

                // Handle the message using the transport
                await transport.handleMessage(req.body);

            } catch (error) {
                console.error('Error handling stream request:', error);
                res.status(500).json({ error: 'Failed to handle request' });
            }
        };
    }

    /**
     * Register all MCP tools
     */
    private registerTools(): void {
        // Tools are now handled in setupHandlers via CallToolRequestSchema
    }
    
    /**
     * Get the list of available tools
     */
    private getToolsList(): any[] {
        return [
            // Search Engine Tools
            { name: "create_search_task", description: "Create a new search engine scraping task" },
            { name: "list_search_tasks", description: "List all search engine tasks" },
            { name: "get_search_task", description: "Get search task details by ID" },
            { name: "get_search_results", description: "Get results from a search task" },
            { name: "update_search_task", description: "Update an existing search task" },
            { name: "delete_search_task", description: "Delete a search task" },
            // Yellow Pages Tools
            { name: "create_yellow_pages_task", description: "Create a new yellow pages scraping task" },
            { name: "list_yellow_pages_tasks", description: "List all yellow pages tasks" },
            { name: "get_yellow_pages_task", description: "Get yellow pages task details by ID" },
            { name: "get_yellow_pages_results", description: "Get results from a yellow pages task" },
            { name: "update_yellow_pages_task", description: "Update an existing yellow pages task" },
            { name: "delete_yellow_pages_task", description: "Delete a yellow pages task" },
            // Website Scraping Tools
            { name: "create_website_scraping_task", description: "Create a new website scraping task" },
            { name: "list_website_scraping_tasks", description: "List all website scraping tasks" },
            { name: "get_website_scraping_task", description: "Get website scraping task details by ID" },
            { name: "get_website_scraping_results", description: "Get results from a website scraping task" },
            { name: "update_website_scraping_task", description: "Update an existing website scraping task" },
            { name: "delete_website_scraping_task", description: "Delete a website scraping task" },
            // Email Extraction Tools
            { name: "create_email_extraction_task", description: "Create a new email extraction task" },
            { name: "list_email_extraction_tasks", description: "List all email extraction tasks" },
            { name: "get_email_extraction_task", description: "Get email extraction task details by ID" },
            { name: "get_email_extraction_results", description: "Get results from an email extraction task" },
            { name: "update_email_extraction_task", description: "Update an existing email extraction task" },
            { name: "delete_email_extraction_task", description: "Delete an email extraction task" },
            // General Tools
            { name: "get_system_status", description: "Get system status and health information" },
            { name: "get_task_statistics", description: "Get overall task statistics" },
            { name: "export_results", description: "Export task results to various formats" },
            { name: "get_user_profile", description: "Get current user profile information" }
        ];
    }
    
    /**
     * Validate login state before processing requests
     */
    private async validateLoginState(): Promise<void> {
        const isLoggedIn = await this.loginStateMonitor.isLoggedIn();
        if (!isLoggedIn) {
            throw new Error('User not logged in. Please log in to aiFetchly first.');
        }
    }

    /**
     * Get server status information
     */
    public getServerStatus() {
        return {
            name: 'AiFetchly MCP Server',
            version: '1.0.0',
            transport: 'Streamable HTTP',
            isRunning: this.httpServerWrapper.isServerRunning(),
            activeStreams: this.activeTransports.size,
            config: this.httpServerWrapper.getConfig()
        };
    }

    /**
     * Get active stream IDs
     */
    public getActiveStreams(): string[] {
        return Array.from(this.activeTransports.keys());
    }

    /**
     * Disconnect a specific stream
     */
    public disconnectStream(streamId: string): boolean {
        if (this.activeTransports.has(streamId)) {
            const transport = this.activeTransports.get(streamId);
            if (transport) {
                transport.close();
            }
            this.activeTransports.delete(streamId);
            console.log(`Disconnected stream: ${streamId}`);
            return true;
        }
        return false;
    }

    /**
     * Update server configuration
     */
    public updateConfig(updates: Partial<StreamableHttpConfigOptions>): void {
        this.httpServerWrapper.updateConfig(updates);
    }

    /**
     * Get server configuration
     */
    public getConfig() {
        return this.httpServerWrapper.getConfig();
    }

    /**
     * Get performance metrics
     */
    public getMetrics() {
        return this.httpServerWrapper.getMetrics();
    }

    /**
     * Send streaming response to a specific stream
     */
    public async sendStreamingResponse(streamId: string, data: any, progressCallback?: (progress: number) => void): Promise<void> {
        const transport = this.activeTransports.get(streamId);
        if (!transport) {
            throw new Error(`No active stream found for ID: ${streamId}`);
        }

        await transport.sendStreamingResponse(data, progressCallback);
    }

    /**
     * Send progress update to a specific stream
     */
    public async sendProgress(streamId: string, progress: number, message?: string): Promise<void> {
        const transport = this.activeTransports.get(streamId);
        if (!transport) {
            throw new Error(`No active stream found for ID: ${streamId}`);
        }

        await transport.sendProgress(progress, message);
    }

    /**
     * Send error to a specific stream
     */
    public async sendError(streamId: string, error: Error | string, code?: number): Promise<void> {
        const transport = this.activeTransports.get(streamId);
        if (!transport) {
            throw new Error(`No active stream found for ID: ${streamId}`);
        }

        await transport.sendError(error, code);
    }
}
