import { describe, it, expect, beforeAll } from "vitest";
import { MCPToolModel } from "@/model/MCPTool.model";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import { HOST_RUNTIME_METADATA_FIELD, PLUGIN_MCP_HOST_RUNTIME } from "@/entityTypes/pluginExecutionTypes";
import { evaluateMcpRowHealth } from "@/service/PluginLoaderService";

/**
 * B11/HOST-15 model-level behavior:
 *  1. hostDisabledReason marker scoping in findBrowserDisabledByPluginName
 *  2. clearBrowserDisabledMarker re-enables + unmarks
 *  3. loader health accepts runtime-descriptor stdio rows without a command
 */

process.env.AIFETCHLY_TEST_DBPATH = "/tmp/opencode/b11-test-db";

describe("MCP row repair + health (B11)", () => {
  let model: MCPToolModel;

  let idMarkerDisabled: number;
  let idUserDisabled: number;
  let idEnabled: number;

  beforeAll(async () => {
    model = new MCPToolModel("/tmp/opencode/b11-test-db/aifetchly.db");
    idMarkerDisabled = await model.saveMCPTool(markerRow());
    idUserDisabled = await model.saveMCPTool(userDisabledRow());
    idEnabled = await model.saveMCPTool(enabledRow());
  });

  function markerRow(): MCPToolEntity {
    const e = new MCPToolEntity();
    e.serverName = "demo-plugin__scraper";
    e.transport = "stdio";
    e.pluginName = "demo-plugin";
    e.enabled = false;
    e.metadata = JSON.stringify({
      hostDisabledReason: "browser-missing",
      pluginServerName: "scraper",
    });
    return e;
  }

  function userDisabledRow(): MCPToolEntity {
    const e = new MCPToolEntity();
    e.serverName = "demo-plugin__scraper2";
    e.transport = "stdio";
    e.pluginName = "demo-plugin";
    e.enabled = false;
    e.metadata = JSON.stringify({ pluginServerName: "scraper2" });
    return e;
  }

  function enabledRow(): MCPToolEntity {
    const e = new MCPToolEntity();
    e.serverName = "demo-plugin__scraper3";
    e.transport = "stdio";
    e.pluginName = "demo-plugin";
    e.enabled = true;
    e.metadata = JSON.stringify({ pluginServerName: "scraper3" });
    return e;
  }

  it("finds ONLY marker rows as browser-disabled (explicit user disables are preserved)", async () => {
    const rows = await model.findBrowserDisabledByPluginName("demo-plugin");
    expect(rows.map((r) => r.id).sort()).toEqual(
      [idMarkerDisabled, idUserDisabled, idEnabled]
        .filter((id) => id === idMarkerDisabled)
        .sort()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(idMarkerDisabled);
  });

  it("none are found for an unrelated plugin", async () => {
    const rows = await model.findBrowserDisabledByPluginName("other-plugin");
    expect(rows).toEqual([]);
  });

  it("clearBrowserDisabledMarker re-enables and removes the marker", async () => {
    const ok = await model.clearBrowserDisabledMarker(idMarkerDisabled);
    expect(ok).toBe(true);
    const row = await model.getMCPToolById(idMarkerDisabled);
    expect(row?.enabled).toBe(true);
    const metadata = row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
    expect(metadata["hostDisabledReason"]).toBeUndefined();

    // The repaired row no longer counts as browser-disabled.
    const remaining = await model.findBrowserDisabledByPluginName("demo-plugin");
    expect(remaining).toHaveLength(0);
  });

  it("clears nothing for a missing id", async () => {
    expect(await model.clearBrowserDisabledMarker(999999)).toBe(false);
  });
});

describe("evaluateMcpRowHealth (B11)", () => {
  it("treats a command-less runtime-descriptor stdio row as healthy", () => {
    const health = evaluateMcpRowHealth({
      transport: "stdio",
      command: null,
      metadata: JSON.stringify({
        [HOST_RUNTIME_METADATA_FIELD]: {
          contractVersion: 1,
          runtime: PLUGIN_MCP_HOST_RUNTIME,
          entry: "dist/index.cjs",
        },
      }),
    });
    expect(health.healthy).toBe(true);
    expect(health.viaRuntimeDescriptor).toBe(true);
  });

  it("keeps needs_configuration for a stdio row with neither command nor descriptor", () => {
    expect(evaluateMcpRowHealth({ transport: "stdio", metadata: JSON.stringify({ other: 1 }) }).healthy).toBe(false);
    expect(evaluateMcpRowHealth({ transport: "stdio" }).healthy).toBe(false);
  });

  it("treats malformed metadata as an explicit-command decision only", () => {
    expect(evaluateMcpRowHealth({ transport: "stdio", metadata: "not-json{[", command: "node" }).healthy).toBe(true);
    expect(evaluateMcpRowHealth({ transport: "stdio", metadata: "not-json{[" }).healthy).toBe(false);
  });

  it("keeps sse/ws rows on host-or-url health", () => {
    expect(evaluateMcpRowHealth({ transport: "sse", host: "h" }).healthy).toBe(true);
    expect(evaluateMcpRowHealth({ transport: "websocket", url: "u" }).healthy).toBe(true);
    expect(evaluateMcpRowHealth({ transport: "sse" }).healthy).toBe(false);
  });
});
