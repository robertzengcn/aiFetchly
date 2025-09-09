#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { stdin, stdout } from "process";

/**
 * Simple MCP Server for testing
 */
async function main() {
    try {
        // Create server
        const server = new Server({
            name: "aifetchly-mcp-server",
            version: "1.0.0"
        });

        // Create transport
        const transport = new StdioServerTransport(stdin, stdout);

        // Register a simple tool
        server.setRequestHandler("tools/call" as any, async (request) => {
            const { name } = (request as any).params || request;
            console.log("Received tool call:", name);
            
            if (name === "get_system_status") {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            data: {
                                timestamp: new Date().toISOString(),
                                status: 'healthy',
                                version: '1.0.0',
                                uptime: process.uptime()
                            }
                        })
                    }]
                };
            }
            
            throw new Error(`Unknown tool: ${name}`);
        });

        // Connect and start
        await server.connect(transport);
        console.log('AiFetchly MCP Server started successfully');
        
    } catch (error) {
        console.error('Failed to start AiFetchly MCP Server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Start the server
main().catch((error) => {
    console.error('Unhandled error in main:', error);
    process.exit(1);
});
