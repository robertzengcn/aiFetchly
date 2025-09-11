# MCP SSE Server Usage Guide

This guide explains how to use the AiFetchly MCP Server with Server-Sent Events (SSE) transport for web-based and remote client connections.

## Overview

The MCP SSE Server provides a web-based interface for the Model Context Protocol (MCP), allowing clients to connect over HTTP/HTTPS using Server-Sent Events for real-time communication. This enables:

- **Remote Access**: Connect from any web browser or HTTP client
- **Multiple Clients**: Support for concurrent connections
- **Real-time Communication**: Live updates via Server-Sent Events
- **Web Integration**: Easy integration with web applications
- **Cross-Platform**: Works on any platform that supports HTTP

## Quick Start

### 1. Start the Server

```bash
# Development mode
yarn mcp-sse

# Production mode
yarn mcp-sse:prod

# Custom port
MCP_SSE_PORT=3001 yarn mcp-sse

# Debug mode
yarn mcp-sse:debug
```

### 2. Test the Connection

Open your browser and navigate to:
- **Server Info**: http://localhost:3000/info
- **Health Check**: http://localhost:3000/health
- **Web Client**: Open `doc/examples/sse-client-example.html`

### 3. Connect a Client

```javascript
// Web client
const eventSource = new EventSource('http://localhost:3000/sse');

// Node.js client
const client = new MCPSSEClient('http://localhost:3000');
await client.connect();
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_SSE_PORT` | 3000 | Server port |
| `MCP_SSE_ENDPOINT` | /sse | SSE endpoint path |
| `MCP_MESSAGES_ENDPOINT` | /messages | Messages endpoint path |
| `MCP_CORS_ENABLED` | true | Enable CORS support |
| `MCP_CORS_ORIGINS` | * | Allowed CORS origins (comma-separated) |
| `MCP_SESSION_TIMEOUT` | 300000 | Session timeout in milliseconds |
| `MCP_MAX_CONNECTIONS` | 100 | Maximum concurrent connections |
| `MCP_ENABLE_LOGGING` | true | Enable request logging |
| `MCP_LOG_LEVEL` | info | Log level (debug, info, warn, error) |
| `MCP_ENABLE_HEALTH_CHECK` | true | Enable health check endpoint |
| `MCP_HEALTH_CHECK_ENDPOINT` | /health | Health check endpoint path |
| `MCP_ENABLE_SERVER_INFO` | true | Enable server info endpoint |
| `MCP_SERVER_INFO_ENDPOINT` | /info | Server info endpoint path |

### Configuration File

You can also configure the server programmatically:

```javascript
import { AiFetchlyMCPServer } from './src/mcp-server/AiFetchlyMCPServer.js';

const server = new AiFetchlyMCPServer({
    port: 3000,
    sseEndpoint: '/sse',
    messagesEndpoint: '/messages',
    corsEnabled: true,
    corsOrigins: ['http://localhost:3000', 'https://yourdomain.com'],
    sessionTimeout: 300000,
    maxConnections: 100,
    enableLogging: true,
    logLevel: 'info'
});

await server.start();
```

## API Endpoints

### SSE Endpoint
- **URL**: `GET /sse`
- **Description**: Establishes Server-Sent Events connection
- **Response**: Event stream with connection events

### Messages Endpoint
- **URL**: `POST /messages?sessionId=<sessionId>`
- **Description**: Handles MCP protocol messages
- **Content-Type**: `application/json`
- **Body**: JSON-RPC 2.0 message

### Health Check
- **URL**: `GET /health`
- **Description**: Server health and status information
- **Response**: JSON with server status

### Server Info
- **URL**: `GET /info`
- **Description**: Server configuration and capabilities
- **Response**: JSON with server information

## Client Integration

### Web Browser Client

```javascript
class MCPWebClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.eventSource = null;
        this.sessionId = null;
    }

    async connect() {
        this.eventSource = new EventSource(`${this.serverUrl}/sse`);
        
        this.eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'connected') {
                this.sessionId = data.sessionId;
            }
        };
    }

    async callTool(toolName, args = {}) {
        const response = await fetch(`${this.serverUrl}/messages?sessionId=${this.sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: Date.now(),
                method: "tools/call",
                params: { name: toolName, arguments: args }
            })
        });
        
        return response.json();
    }
}
```

### Node.js Client

```javascript
import { MCPSSEClient } from './doc/examples/sse-client-node.js';

const client = new MCPSSEClient('http://localhost:3000');

// Connect
await client.connect();

// Call tools
const result = await client.callTool('get_system_status');
console.log(result);

// Disconnect
client.disconnect();
```

## Available Tools

The MCP server provides these tools:

### System Tools
- `get_system_status` - Get server system status
- `test_connection` - Test the connection
- `get_server_info` - Get server information

### Search Engine Tools
- `create_search_task` - Create a search engine scraping task
- `list_search_tasks` - List all search engine tasks
- `get_search_task` - Get search task details by ID
- `get_search_results` - Get results from a search task
- `update_search_task` - Update an existing search task
- `delete_search_task` - Delete a search task

### Yellow Pages Tools
- `create_yellow_pages_task` - Create a yellow pages scraping task
- `list_yellow_pages_tasks` - List all yellow pages tasks
- `get_yellow_pages_task` - Get yellow pages task details by ID
- `get_yellow_pages_results` - Get results from a yellow pages task
- `update_yellow_pages_task` - Update an existing yellow pages task
- `delete_yellow_pages_task` - Delete a yellow pages task

### Website Scraping Tools
- `create_website_scraping_task` - Create a website scraping task
- `list_website_scraping_tasks` - List all website scraping tasks
- `get_website_scraping_task` - Get website scraping task details by ID
- `get_website_scraping_results` - Get results from a website scraping task
- `update_website_scraping_task` - Update an existing website scraping task
- `delete_website_scraping_task` - Delete a website scraping task

### Email Extraction Tools
- `create_email_extraction_task` - Create an email extraction task
- `list_email_extraction_tasks` - List all email extraction tasks
- `get_email_extraction_task` - Get email extraction task details by ID
- `get_email_extraction_results` - Get results from an email extraction task
- `update_email_extraction_task` - Update an existing email extraction task
- `delete_email_extraction_task` - Delete an email extraction task

### General Tools
- `get_task_statistics` - Get overall task statistics
- `export_results` - Export task results to various formats
- `get_user_profile` - Get current user profile information

## Error Handling

### Connection Errors
- **Connection Refused**: Server not running or wrong URL
- **CORS Error**: Server CORS not configured for your origin
- **Session Timeout**: Connection idle for too long
- **Max Connections**: Server at capacity

### Tool Call Errors
- **Authentication Required**: User not logged in
- **Invalid Tool**: Tool name not recognized
- **Invalid Arguments**: Tool arguments are malformed
- **Tool Execution Error**: Error during tool execution

### Error Response Format
```json
{
    "jsonrpc": "2.0",
    "id": 123,
    "error": {
        "code": -32601,
        "message": "Method not found",
        "data": {
            "tool": "invalid_tool",
            "availableTools": ["get_system_status", "test_connection"]
        }
    }
}
```

## Security Considerations

### CORS Configuration
Configure CORS origins to restrict access:
```javascript
const server = new AiFetchlyMCPServer({
    corsEnabled: true,
    corsOrigins: ['https://yourdomain.com', 'https://app.yourdomain.com']
});
```

### Session Management
- Sessions automatically timeout after inactivity
- Maximum connections limit prevents resource exhaustion
- Each session gets a unique ID for isolation

### Authentication
- Some tools require user authentication
- Login state is validated before tool execution
- Unauthenticated requests return appropriate errors

## Performance Tuning

### Connection Limits
```javascript
const server = new AiFetchlyMCPServer({
    maxConnections: 100,        // Maximum concurrent connections
    sessionTimeout: 300000      // 5 minutes timeout
});
```

### Logging Configuration
```javascript
const server = new AiFetchlyMCPServer({
    enableLogging: true,
    logLevel: 'info'            // debug, info, warn, error
});
```

### Resource Monitoring
Monitor server health via the health check endpoint:
```bash
curl http://localhost:3000/health
```

## Troubleshooting

### Common Issues

1. **Server won't start**
   - Check if port is already in use
   - Verify all dependencies are installed
   - Check server logs for errors

2. **Client can't connect**
   - Verify server is running
   - Check CORS configuration
   - Ensure correct URL and port

3. **Tools not working**
   - Check authentication status
   - Verify tool arguments format
   - Check server logs for errors

4. **Connection drops frequently**
   - Check network stability
   - Increase session timeout
   - Verify client reconnection logic

### Debug Mode
Enable debug logging for detailed information:
```bash
MCP_LOG_LEVEL=debug yarn mcp-sse
```

### Health Check
Monitor server status:
```bash
curl http://localhost:3000/health
```

## Examples

See the `doc/examples/` directory for complete working examples:
- `sse-client-example.html` - Web browser client
- `sse-client-node.js` - Node.js client
- `README.md` - Examples documentation

## Migration from StdioServerTransport

If you're migrating from the stdio-based server:

1. **Update client code** to use HTTP/SSE instead of stdin/stdout
2. **Configure CORS** for web clients
3. **Handle session management** for multiple clients
4. **Update deployment** to use HTTP server instead of process communication

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review server logs for error details
3. Test with the provided examples
4. Check the MCP protocol documentation

## License

This MCP SSE Server is part of the AiFetchly project and follows the same license terms.

