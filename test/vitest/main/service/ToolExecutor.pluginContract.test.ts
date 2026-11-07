import { describe, it, expect, vi, beforeEach } from "vitest";
import { PluginToolPolicyRegistry } from "@/service/PluginToolPolicyRegistry";
import { setPluginToolPolicyRegistryForTest } from "@/service/PluginToolPolicyRegistry";
import { ToolExecutor } from "@/service/ToolExecutor";
import type { MCPToolCallContent } from "@/modules/MCPClient";

/**
 * B02: managed-async MCP normalization must be selected by the REGISTERED
 * plugin result contract, not by any deadline/signal. A registered plugin
 * tool honors the versioned domain envelope; an unregistered tool keeps the
 * legacy generic path even when a deadline/signal is present.
 */

const { mcpToolServiceMock } = vi.hoisted(() => {
  const mcpToolServiceMock = {
    contentCalls: [] as { serverId: number | string; toolName: string; params: Record<string, unknown> }[],
    legacyCalls: [] as { serverId: number | string; toolName: string; params: Record<string, unknown> }[],
    contentResult: null as MCPToolCallContent | null,
    legacyResult: { result: { ok: true, legacy: true } } as Record<string, unknown>,
  };
  return { mcpToolServiceMock };
});

vi.mock("@/service/MCPToolService", () => {
  return {
    MCPToolService: class {
      async executeMCPToolContent(
        serverId: number | string,
        toolName: string,
        params: Record<string, unknown>
      ) {
        mcpToolServiceMock.contentCalls.push({ serverId, toolName, params });
        return mcpToolServiceMock.contentResult ?? { content: [], isError: false };
      }
      async executeMCPTool(
        serverId: number | string,
        toolName: string,
        params: Record<string, unknown>
      ) {
        mcpToolServiceMock.legacyCalls.push({ serverId, toolName, params });
        return mcpToolServiceMock.legacyResult;
      }
    },
  };
});

vi.mock("@/modules/MCPToolModule", () => ({
  MCPToolModule: class {
    async findPluginMcpByScopedName(): Promise<{ id: number } | null> {
      return { id: 9 };
    }
  },
}));

const TOOL_NAME = "mcp__demo-plugin__scraper__scrape_records";
const PLUGIN_ENVELOPE: MCPToolCallContent = {
  content: [],
  isError: false,
  structuredContent: {
    schemaVersion: 1,
    success: false,
    status: "failed",
    error: { code: "NO_RESULTS", message: "no matches", recoverable: false },
  },
};

function makeRegistry(policyRegistered: boolean): PluginToolPolicyRegistry {
  const reg = new PluginToolPolicyRegistry();
  reg.registerFromManifest("demo-plugin", {
    name: "demo-plugin",
    version: "1.0.0",
    mcpServers: policyRegistered ? [".mcp.json"] : [],
    toolPolicies: policyRegistered
      ? {
          "scraper/scrape_records": {
            contractVersion: 1,
            timeoutClass: "async",
            maxRunMs: 1_800_000,
            supportsProgress: true,
            supportsPartialResult: true,
            cancellable: true,
            maxConcurrentPerConversation: 1,
          },
        }
      : undefined,
  });
  return reg;
}

function execContext(): {
  signal: AbortSignal;
  toolCallId: string;
  timeout: null;
} {
  return {
    signal: new AbortController().signal,
    toolCallId: "tc-" + Math.random().toString(36).slice(2, 8),
    timeout: null,
  };
}

beforeEach(() => {
  mcpToolServiceMock.contentCalls = [];
  mcpToolServiceMock.legacyCalls = [];
  mcpToolServiceMock.contentResult = PLUGIN_ENVELOPE;
  mcpToolServiceMock.legacyResult = { result: { ok: true, legacy: true } };
});

describe("ToolExecutor plugin contract selection (B02)", () => {
  it("honors the versioned envelope for a registered plugin tool under a signal", async () => {
    setPluginToolPolicyRegistryForTest(makeRegistry(true));
    const result = await ToolExecutor.execute(
      TOOL_NAME,
      { query: "plumbers" },
      "conv-1",
      execContext()
    );
    expect(result.success).toBe(false);
    expect((result.error as Record<string, unknown>).code).toBe("NO_RESULTS");
    expect(mcpToolServiceMock.contentCalls).toHaveLength(1);
    expect(mcpToolServiceMock.legacyCalls).toHaveLength(0);
  });

  it("runs the legacy path for an unregistered tool even with a signal", async () => {
    setPluginToolPolicyRegistryForTest(makeRegistry(false));
    const result = await ToolExecutor.execute(
      TOOL_NAME,
      { query: "plumbers" },
      "conv-1",
      execContext()
    );
    expect(mcpToolServiceMock.contentCalls).toHaveLength(0);
    expect(mcpToolServiceMock.legacyCalls).toHaveLength(1);
    expect(result.success).toBe(true);
  });

  it("restores the previous registry after tests", () => {
    setPluginToolPolicyRegistryForTest(undefined);
  });
});
