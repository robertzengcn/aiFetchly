#!/usr/bin/env node

import { StandaloneStreamableAiFetchlyMCPServer } from './streamable-standalone.js';

/**
 * Main entry point for the Streamable HTTP AiFetchly MCP Server
 * This server provides MCP tools for search engine scraping, yellow pages, website scraping, and email extraction
 * using Streamable HTTP transport for improved performance and reliability
 */
async function main() {
    try {
        console.log('Starting Streamable HTTP AiFetchly MCP Server...');
        console.log('Transport: Streamable HTTP (improved over SSE)');
        console.log('Features: Chunked transfer, compression, progress tracking');
        
        const server = new StandaloneStreamableAiFetchlyMCPServer();
        await server.start();
        
        // Log server information
        const status = server.getServerStatus();
        console.log('Server Status:', JSON.stringify(status, null, 2));
        
        // Setup graceful shutdown
        const gracefulShutdown = async (signal: string) => {
            console.log(`\nReceived ${signal}, shutting down gracefully...`);
            try {
                await server.stop();
                console.log('Server stopped successfully');
                process.exit(0);
            } catch (error) {
                console.error('Error during shutdown:', error);
                process.exit(1);
            }
        };
        
        // Handle shutdown signals
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            gracefulShutdown('uncaughtException');
        });
        
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            gracefulShutdown('unhandledRejection');
        });
        
    } catch (error) {
        console.error('Failed to start Streamable HTTP AiFetchly MCP Server:', error);
        process.exit(1);
    }
}

// Start the server
main().catch((error) => {
    console.error('Unhandled error in main:', error);
    process.exit(1);
});
