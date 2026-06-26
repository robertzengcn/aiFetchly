// src/service/MCPTimeoutError.ts
export class MCPTimeoutError extends Error {
  readonly serverName: string;
  readonly toolName: string;
  readonly timeoutMs: number;
  readonly telemetryMessage: string;
  readonly isTelemetrySafe = true;

  constructor(toolName: string, serverName: string, timeoutMs: number) {
    super(
      `MCP server '${serverName}' tool '${toolName}' timed out after ${timeoutMs}ms`
    );
    Object.setPrototypeOf(this, MCPTimeoutError.prototype);
    this.name = "MCPTimeoutError";
    this.serverName = serverName;
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
    this.telemetryMessage = `MCP tool timed out after ${timeoutMs}ms`;
  }
}
