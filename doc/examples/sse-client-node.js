#!/usr/bin/env node

/**
 * Node.js SSE Client Example for AiFetchly MCP Server
 * 
 * This example demonstrates how to connect to the MCP server using Server-Sent Events
 * from a Node.js application.
 */

const EventSource = require('eventsource');
const fetch = require('node-fetch');

class MCPSSEClient {
    constructor(serverUrl = 'http://localhost:3000') {
        this.serverUrl = serverUrl;
        this.sseUrl = `${serverUrl}/sse`;
        this.messagesUrl = `${serverUrl}/messages`;
        this.eventSource = null;
        this.sessionId = null;
        this.requestId = 0;
        this.isConnected = false;
    }

    /**
     * Connect to the MCP server
     */
    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to ${this.sseUrl}...`);
            
            this.eventSource = new EventSource(this.sseUrl);

            this.eventSource.onopen = () => {
                console.log('✅ SSE connection opened');
                this.isConnected = true;
                resolve();
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 Received:', JSON.stringify(data, null, 2));
                    
                    if (data.type === 'connected') {
                        this.sessionId = data.sessionId;
                        console.log(`🔑 Session ID: ${this.sessionId}`);
                    }
                } catch (error) {
                    console.error('❌ Error parsing message:', error.message);
                }
            };

            this.eventSource.addEventListener('error', (event) => {
                console.error('❌ SSE error:', event.type);
                this.isConnected = false;
                reject(new Error('SSE connection error'));
            });

            this.eventSource.onerror = (error) => {
                console.error('❌ SSE connection error:', error);
                this.isConnected = false;
                reject(error);
            };
        });
    }

    /**
     * Disconnect from the MCP server
     */
    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            this.sessionId = null;
            this.isConnected = false;
            console.log('🔌 Disconnected from server');
        }
    }

    /**
     * Call an MCP tool
     */
    async callTool(toolName, args = {}) {
        if (!this.isConnected || !this.sessionId) {
            throw new Error('Not connected to server');
        }

        const requestId = ++this.requestId;
        const mcpRequest = {
            jsonrpc: "2.0",
            id: requestId,
            method: "tools/call",
            params: {
                name: toolName,
                arguments: args
            }
        };

        console.log(`🔧 Calling tool: ${toolName} with args:`, args);

        try {
            const response = await fetch(`${this.messagesUrl}?sessionId=${this.sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(mcpRequest)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('✅ Tool response:', JSON.stringify(data, null, 2));
            return data;

        } catch (error) {
            console.error('❌ Tool call error:', error.message);
            throw error;
        }
    }

    /**
     * Get server status
     */
    async getServerStatus() {
        try {
            const response = await fetch(`${this.serverUrl}/info`);
            const data = await response.json();
            console.log('📊 Server status:', JSON.stringify(data, null, 2));
            return data;
        } catch (error) {
            console.error('❌ Error getting server status:', error.message);
            throw error;
        }
    }

    /**
     * Test the connection
     */
    async testConnection() {
        return this.callTool('test_connection', { 
            message: 'Hello from Node.js SSE client' 
        });
    }

    /**
     * Get system status
     */
    async getSystemStatus() {
        return this.callTool('get_system_status');
    }

    /**
     * Get server info
     */
    async getServerInfo() {
        return this.callTool('get_server_info');
    }

    /**
     * Create a search task
     */
    async createSearchTask(query, options = {}) {
        return this.callTool('create_search_task', {
            query,
            ...options
        });
    }

    /**
     * Create a yellow pages task
     */
    async createYellowPagesTask(query, location, options = {}) {
        return this.callTool('create_yellow_pages_task', {
            query,
            location,
            ...options
        });
    }
}

/**
 * Example usage
 */
async function main() {
    const client = new MCPSSEClient();

    try {
        // Connect to server
        await client.connect();

        // Get server status
        await client.getServerStatus();

        // Test connection
        await client.testConnection();

        // Get system status
        await client.getSystemStatus();

        // Get server info
        await client.getServerInfo();

        // Example: Create a search task
        console.log('\n🔍 Creating search task...');
        await client.createSearchTask('AI marketing tools', {
            maxResults: 10,
            searchEngine: 'google'
        });

        // Example: Create a yellow pages task
        console.log('\n📞 Creating yellow pages task...');
        await client.createYellowPagesTask('restaurants', 'New York, NY', {
            maxResults: 5
        });

        console.log('\n✅ All tests completed successfully!');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        // Disconnect
        client.disconnect();
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Run the example
if (require.main === module) {
    main().catch(console.error);
}

module.exports = MCPSSEClient;

