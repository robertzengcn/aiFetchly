import { describe, expect, it } from "vitest";
import {
  MCPToolService,
  buildSanitizedToolSchemas,
} from "@/service/MCPToolService";
import type { MCPToolEntity } from "@/entity/MCPTool.entity";
import type { MCPToolModule } from "@/modules/MCPToolModule";

const MARKER = "... [truncated]";

function makeFakeServer(overrides: Partial<MCPToolEntity> = {}): MCPToolEntity {
  return {
    id: 7,
    serverName: "big-mcp",
    transport: "stdio",
    enabled: true,
    authType: "none",
    timeout: 30000,
    tools: JSON.stringify(["search_things"]),
    toolConfig: JSON.stringify({ search_things: { enabled: true } }),
    metadata: JSON.stringify({
      toolSchemas: {
        search_things: {
          description: "x".repeat(30000),
          inputSchema: {
            type: "object",
            properties: {
              a: { type: "string", examples: ["e".repeat(15000)] },
            },
          },
        },
      },
    }),
    ...overrides,
  } as unknown as MCPToolEntity;
}

function makeFakeModule(servers: MCPToolEntity[]): MCPToolModule {
  return {
    getEnabledMCPTools: async () => servers,
  } as unknown as MCPToolModule;
}

describe("buildSanitizedToolSchemas (discover-time cap)", () => {
  it("caps an oversized description before persistence", () => {
    const schemas = buildSanitizedToolSchemas([
      {
        name: "search_things",
        description: "x".repeat(30000),
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    expect(schemas.search_things.description!.length).toBeLessThanOrEqual(
      2048 + MARKER.length
    );
    expect(schemas.search_things.description!.endsWith(MARKER)).toBe(true);
  });

  it("prunes oversized schemas before persistence", () => {
    const schemas = buildSanitizedToolSchemas([
      {
        name: "search_things",
        description: "small",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "string", examples: ["e".repeat(15000)] },
          },
        },
      },
    ]);
    const json = JSON.stringify(schemas.search_things.inputSchema);
    // examples removed -> far smaller than 15000+ chars
    expect(json.length).toBeLessThan(15000);
    // structure preserved
    expect(schemas.search_things.inputSchema!.type).toBe("object");
  });
});

describe("MCPToolService.getEnabledMCPToolsAsFunctions (defense in depth)", () => {
  it("caps oversized stored description and schema when converting to ToolFunction", async () => {
    const svc = new MCPToolService(makeFakeModule([makeFakeServer()]));
    const fns = await svc.getEnabledMCPToolsAsFunctions();
    expect(fns.length).toBe(1);
    expect(fns[0].name).toBe("mcp_7_search_things");
    expect(fns[0].description!.length).toBeLessThanOrEqual(
      2048 + MARKER.length
    );
    expect(fns[0].description!.length).toBeLessThan(30000);
    // schema pruned (examples removed)
    const paramJson = JSON.stringify(fns[0].parameters);
    expect(paramJson.length).toBeLessThan(15000);
    expect(
      (fns[0].parameters as Record<string, unknown>).type
    ).toBe("object");
  });

  it("uses fallback description when none stored", async () => {
    const server = makeFakeServer({
      metadata: JSON.stringify({ toolSchemas: { search_things: {} } }),
    });
    const svc = new MCPToolService(makeFakeModule([server]));
    const fns = await svc.getEnabledMCPToolsAsFunctions();
    expect(fns[0].description).toBe(
      "MCP tool search_things from big-mcp"
    );
  });
});
