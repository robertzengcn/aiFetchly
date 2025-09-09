#!/usr/bin/env node

import { StandaloneAiFetchlyMCPServer } from './standalone.js';

/**
 * Main entry point for the AiFetchly MCP Server
 * This server provides MCP tools for search engine scraping, yellow pages, website scraping, and email extraction
 */
async function main() {
    try {
        const server = new StandaloneAiFetchlyMCPServer();
        await server.start();
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
