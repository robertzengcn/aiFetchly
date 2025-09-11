# MCP SSE Client Examples

This directory contains example clients for connecting to the AiFetchly MCP Server using Server-Sent Events (SSE).

## Files

### `sse-client-example.html`
A web-based client example that demonstrates:
- Connecting to the MCP server via SSE
- Calling MCP tools through the web interface
- Real-time message handling
- Error handling and reconnection logic
- Interactive tool testing

**Usage:**
1. Start the MCP server: `yarn mcp-sse`
2. Open `sse-client-example.html` in a web browser
3. Click "Connect" to establish SSE connection
4. Use the interface to test different MCP tools

### `sse-client-node.js`
A Node.js client example that demonstrates:
- Programmatic connection to the MCP server
- Tool calling from Node.js applications
- Error handling and connection management
- Example usage patterns

**Usage:**
1. Start the MCP server: `yarn mcp-sse`
2. Install dependencies: `npm install eventsource node-fetch`
3. Run the client: `node sse-client-node.js`

## Features Demonstrated

### Connection Management
- SSE connection establishment
- Session ID handling
- Automatic reconnection on connection loss
- Graceful disconnection

### Tool Calling
- MCP protocol compliance
- JSON-RPC 2.0 message format
- Error handling and response parsing
- Multiple tool examples

### Error Handling
- Connection error recovery
- Tool call error handling
- Network error management
- User-friendly error messages

## Available Tools

The examples demonstrate calling these MCP tools:

- `get_system_status` - Get server system status
- `test_connection` - Test the connection
- `get_server_info` - Get server information
- `create_search_task` - Create a search engine scraping task
- `create_yellow_pages_task` - Create a yellow pages scraping task

## Configuration

### Server Configuration
The examples connect to `http://localhost:3000` by default. You can change this by:

**Web Client:**
- Modify the "Server URL" input field

**Node.js Client:**
- Pass a different URL to the constructor: `new MCPSSEClient('http://your-server:port')`
- Set environment variable: `MCP_SERVER_URL=http://your-server:port`

### Environment Variables
- `MCP_SERVER_URL` - Server URL (default: http://localhost:3000)
- `MCP_SSE_PORT` - Server port (default: 3000)
- `MCP_LOG_LEVEL` - Log level (debug, info, warn, error)

## Troubleshooting

### Connection Issues
1. Ensure the MCP server is running: `yarn mcp-sse`
2. Check the server URL is correct
3. Verify CORS is enabled on the server
4. Check browser console for errors

### Tool Call Issues
1. Ensure you're connected before calling tools
2. Check tool arguments are valid JSON
3. Verify the tool name is correct
4. Check server logs for detailed error messages

### Common Errors
- **"Session ID is required"** - Not connected to server
- **"No transport found for session ID"** - Session expired or invalid
- **"CORS error"** - Server CORS not configured properly
- **"Connection refused"** - Server not running or wrong URL

## Development

### Adding New Tools
To add support for new MCP tools:

1. **Web Client:** Add new options to the tool select dropdown
2. **Node.js Client:** Add new methods to the `MCPSSEClient` class
3. **Both:** Update the tool arguments input as needed

### Customizing the Interface
The web client uses vanilla HTML/CSS/JavaScript and can be easily customized:
- Modify the HTML structure in `sse-client-example.html`
- Update styles in the `<style>` section
- Add new functionality in the `<script>` section

### Extending the Node.js Client
The Node.js client is designed to be extensible:
- Add new tool methods to the `MCPSSEClient` class
- Implement custom error handling
- Add connection pooling or other advanced features

## API Reference

### MCPSSEClient Class

#### Constructor
```javascript
new MCPSSEClient(serverUrl = 'http://localhost:3000')
```

#### Methods
- `connect()` - Connect to the MCP server
- `disconnect()` - Disconnect from the server
- `callTool(toolName, args)` - Call an MCP tool
- `getServerStatus()` - Get server status information
- `testConnection()` - Test the connection
- `getSystemStatus()` - Get system status
- `getServerInfo()` - Get server information

#### Events
- `onopen` - Connection opened
- `onmessage` - Message received
- `onerror` - Connection error
- `onclose` - Connection closed

## License

These examples are part of the AiFetchly project and follow the same license terms.

