// src/config/mcpConfig.ts

/**
 * Per-call timeout for MCP tool execution. Defaults to the browser tier
 * ceiling because MCP servers typically wrap slow operations (scrapers,
 * Puppeteer, file conversions).
 *
 * Override per server via the `timeout` field on the MCPToolEntity.
 */
export const MCP_CALL_TIMEOUT_MS = 240_000;

/**
 * Connection establishment timeout. Kept short so a dead MCP server fails
 * fast instead of eating the entire call budget.
 */
export const MCP_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Per-HTTP-request timeout inside the MCP transport. Prevents a single
 * stalled SSE frame from hanging the call indefinitely. Implemented as a
 * fresh AbortSignal per request (not a reused one) per Claude Code's
 * lesson learned.
 */
export const MCP_HTTP_REQUEST_TIMEOUT_MS = 60_000;
