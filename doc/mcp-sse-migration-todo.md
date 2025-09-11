# MCP Server Migration: StdioServerTransport → SSEServerTransport

## Overview
This document outlines the migration plan for converting the aiFetchly MCP server from using `StdioServerTransport` to `SSEServerTransport` to enable remote client connections and better web integration.

## Current Architecture
- **Transport**: `StdioServerTransport` for process-to-process communication
- **Communication**: Direct stdin/stdout handling
- **Clients**: Single client connection model
- **Access**: Local process communication only

## Target Architecture
- **Transport**: `SSEServerTransport` with HTTP server
- **Communication**: Server-Sent Events (SSE) over HTTP/HTTPS
- **Clients**: Multiple concurrent client connections
- **Access**: Remote access via web endpoints

## Migration Todo List

### Phase 1: Dependencies and Infrastructure
- [x] **Add Express.js dependency for HTTP server support**
  - Add `express` to package.json dependencies
  - Add `@types/express` to devDependencies
  - Express is needed to create the HTTP server that will handle SSE connections

- [x] **Create HTTP server wrapper class for SSE transport management**
  - Create `src/mcp-server/HttpServerWrapper.ts`
  - Manage Express server instance
  - Handle multiple SSE connections
  - Provide session management

- [x] **Add configuration options for server port and endpoints**
  - Add server configuration to existing config system
  - Make port, endpoints, and CORS settings configurable
  - Support different environments (dev, prod, test)

### Phase 2: Core MCP Server Updates
- [x] **Update AiFetchlyMCPServer to support SSEServerTransport instead of StdioServerTransport**
  - Modify `src/mcp-server/AiFetchlyMCPServer.ts`
  - Replace `StdioServerTransport` with `SSEServerTransport`
  - Update constructor and connection logic
  - Maintain existing tool registration and handlers

- [x] **Update standalone.ts to use HTTP server instead of stdio**
  - Modify `src/mcp-server/standalone.ts`
  - Replace stdio-based startup with HTTP server startup
  - Integrate with new HttpServerWrapper

- [x] **Add session management for multiple client connections**
  - Track active SSE connections by session ID
  - Handle connection lifecycle (connect, disconnect, reconnect)
  - Manage per-session state if needed

### Phase 3: SSE Endpoints Implementation
- [x] **Implement SSE endpoint (/sse) for client connections**
  - Create `/sse` endpoint for establishing SSE connections
  - Handle client connection requests
  - Generate unique session IDs for each connection
  - Set up proper SSE headers and event streaming

- [x] **Implement message handling endpoint (/messages) for incoming client messages**
  - Create `/messages` endpoint for receiving MCP requests
  - Handle POST requests with MCP protocol messages
  - Route messages to appropriate SSE transport based on session ID
  - Return responses via SSE connection

- [x] **Add CORS support for web client connections**
  - Configure CORS middleware for Express
  - Allow cross-origin requests from web clients
  - Set appropriate headers for SSE and API endpoints

### Phase 4: Connection Management
- [x] **Add error handling and reconnection logic for SSE connections**
  - Handle connection drops gracefully
  - Implement automatic reconnection for clients
  - Add timeout handling for idle connections
  - Log connection errors for debugging

- [x] **Implement graceful shutdown for HTTP server and SSE connections**
  - Handle SIGINT and SIGTERM signals
  - Close all active SSE connections
  - Stop HTTP server gracefully
  - Clean up resources and sessions

- [x] **Add logging for SSE connection events and debugging**
  - Log connection events (connect, disconnect, error)
  - Add debug logging for message flow
  - Monitor connection health and performance
  - Create connection statistics

### Phase 5: Testing and Documentation
- [x] **Create client example for testing SSE connection**
  - Create `doc/examples/sse-client-example.html`
  - Simple web client to test SSE connection
  - Demonstrate MCP tool calls via SSE
  - Include error handling and reconnection

- [x] **Update package.json scripts for SSE server mode**
  - Add `start:sse` script for SSE server mode
  - Add `dev:sse` script for development with SSE
  - Update existing scripts to support both modes
  - Add build scripts for SSE server

- [x] **Update documentation for SSE server usage**
  - Update `doc/mcp-server-prd.md` with SSE information
  - Create `doc/mcp-sse-usage-guide.md`
  - Document API endpoints and connection process
  - Add troubleshooting guide for SSE connections

## Key Benefits of SSEServerTransport

### Remote Access
- Clients can connect over HTTP/HTTPS instead of requiring local process communication
- Enables cloud deployment and distributed architectures
- Better integration with web-based applications

### Multiple Clients
- Support for multiple concurrent client connections
- Session-based connection management
- Scalable for multiple users

### Web Integration
- Easier integration with web-based applications
- Standard HTTP/HTTPS protocols
- Browser-compatible communication

### Real-time Communication
- Server-sent events provide real-time updates to clients
- Better user experience for long-running operations
- Live status updates and progress monitoring

### Better Scalability
- More suitable for distributed or cloud deployments
- Horizontal scaling capabilities
- Load balancing support

## Implementation Notes

### File Structure Changes
```
src/mcp-server/
├── AiFetchlyMCPServer.ts          # Updated for SSE
├── HttpServerWrapper.ts           # New HTTP server wrapper
├── standalone.ts                  # Updated for HTTP server
├── index.ts                       # Updated entry point
└── examples/
    └── sse-client-example.html    # Client example
```

### Configuration Changes
- Add server port configuration
- Add CORS settings
- Add SSE endpoint configuration
- Add session timeout settings

### Dependencies
- `express` - HTTP server framework
- `@types/express` - TypeScript definitions
- Existing MCP SDK (already installed)

## Testing Strategy

### Unit Tests
- Test HTTP server wrapper functionality
- Test SSE connection management
- Test message routing and handling

### Integration Tests
- Test full MCP protocol over SSE
- Test multiple client connections
- Test error handling and reconnection

### Manual Testing
- Use provided client example
- Test with different browsers
- Test connection stability and performance

## Migration Timeline

1. **Week 1**: Phase 1 & 2 - Infrastructure and core updates
2. **Week 2**: Phase 3 - SSE endpoints implementation
3. **Week 3**: Phase 4 - Connection management and error handling
4. **Week 4**: Phase 5 - Testing, documentation, and refinement

## Risk Mitigation

### Backward Compatibility
- Keep existing stdio implementation as fallback
- Add configuration to switch between transport types
- Gradual migration path for existing clients

### Error Handling
- Comprehensive error handling for network issues
- Graceful degradation when connections fail
- Clear error messages for debugging

### Performance
- Monitor connection overhead
- Implement connection pooling if needed
- Optimize message serialization

## Success Criteria

- [x] Multiple clients can connect simultaneously
- [x] All existing MCP tools work over SSE
- [x] Web clients can connect and use the server
- [x] Connection stability and error handling work properly
- [x] Performance is acceptable for production use
- [x] Documentation is complete and accurate

---

**Created**: December 2024
**Last Updated**: December 2024
**Status**: ✅ COMPLETED
**Priority**: High

## 🎉 Migration Summary

**All 15 tasks have been successfully completed!**

### ✅ Completed Phases:
- **Phase 1**: Dependencies and Infrastructure (3/3 tasks)
- **Phase 2**: Core MCP Server Updates (3/3 tasks)  
- **Phase 3**: SSE Endpoints Implementation (3/3 tasks)
- **Phase 4**: Connection Management (3/3 tasks)
- **Phase 5**: Testing and Documentation (3/3 tasks)

### 🚀 Ready for Use:
The MCP server now supports both stdio and SSE transport modes with full feature parity. You can start the SSE server using:
```bash
yarn mcp-sse
```

### 📁 Files Created/Updated:
- New files: 6 (HttpServerWrapper, SSEServerConfig, client examples, documentation)
- Updated files: 4 (package.json, AiFetchlyMCPServer, standalone.ts, PRD)
- Total tasks completed: 15/15 (100%)
