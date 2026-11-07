// B13 regression suite — plugin MCP runtime launch-time ownership contract.
//
// The persisted MCP row is never authority on its own: launch must fail
// when the descriptor is forged/missing, the owner row is missing/disabled/
// unhealthy, or the on-disk servers.json no longer matches the row entry.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  PluginMcpOwnershipChecker,
  type McpRuntimeOwnershipRow,
} from "@/service/PluginMcpOwnershipChecker";
import { HOST_RUNTIME_METADATA_FIELD } from "@/entityTypes/pluginExecutionTypes";

let tmp: string;
let installRoot: string;
let serversJsonPath: string;

const ROW_SERVER = "demo-plugin__demo-mcp";
const ENTRY = "dist/server.cjs";

function descriptorMetadata(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pluginServerName: "demo-mcp",
    pluginOwner: "demo-plugin",
    [HOST_RUNTIME_METADATA_FIELD]: { contractVersion: 1, runtime: "aifetchly-node", entry: ENTRY },
    ...extra,
  };
}

interface FakeRow extends McpRuntimeOwnershipRow {
  name: string;
}

let fakeRow: FakeRow | null;
let missingRow = false;

function checker(): PluginMcpOwnershipChecker {
  return new PluginMcpOwnershipChecker({
    pluginByName: async (name: string) => {
      if (missingRow) return null;
      if (!fakeRow || fakeRow.name !== name) return null;
      return { ...fakeRow };
    },
  });
}

function writeServersJson(content: string): void {
  fs.mkdirSync(path.dirname(serversJsonPath), { recursive: true });
  fs.writeFileSync(serversJsonPath, content);
}

function validServersJson(entry = ENTRY): string {
  return JSON.stringify({
    mcpServers: {
      "demo-mcp": { runtime: "aifetchly-node", entry },
    },
  });
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yp-ownership-"));
  installRoot = path.join(tmp, "plugins", "demo-plugin");
  serversJsonPath = path.join(installRoot, "mcp", "servers.json");
  writeServersJson(validServersJson());
});

afterEach(() => {
  missingRow = false;
  fakeRow = null;
  writeServersJson(validServersJson());
});

// Shared base row used by the tests (assigned in each scenario).
const baseRow: {
  name: string;
  version: string;
  enabled: number;
  health: string;
  manifestJson: string;
  installPath: string;
} = {
  name: "demo-plugin",
  version: "1.4.2",
  enabled: 1,
  health: "healthy",
  manifestJson: JSON.stringify({
    name: "demo-plugin",
    version: "1.4.2",
    description: "ok",
    format: "aifetchly",
    mcpServers: ["mcp/servers.json"],
  }),
  installPath: "",
};

function setInputRow(): void {
  baseRow.installPath = installRoot;
  baseRow.enabled = 1;
  baseRow.health = "healthy";
  fakeRow = baseRow;
}

describe("PluginMcpOwnershipChecker", () => {
  it("passes for a consistent, enabled, healthy owner with a matching entry", async () => {
    setInputRow();
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: descriptorMetadata(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pluginVersion).toBe("1.4.2");
      expect(result.descriptor.entry).toBe(ENTRY);
    }
  });

  it("fails when the row metadata carries no host runtime descriptor", async () => {
    setInputRow();
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: { pluginServerName: "demo-mcp" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no valid host runtime descriptor/);
  });

  it("fails a forged descriptor (malformed runtime shape)", async () => {
    setInputRow();
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: {
        [HOST_RUNTIME_METADATA_FIELD]: { runtime: "evil-node", entry: ENTRY },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no valid host runtime descriptor/);
  });

  it("fails when the owner plugin row is missing", async () => {
    setInputRow();
    missingRow = true;
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: descriptorMetadata(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not installed/);
  });

  it("fails when the owner plugin is disabled or unhealthy", async () => {
    setInputRow();
    baseRow.enabled = 0;
    const disabled = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: descriptorMetadata(),
    });
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error).toMatch(/disabled/);

    baseRow.enabled = 1;
    baseRow.health = "degraded";
    const unhealthy = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: descriptorMetadata(),
    });
    expect(unhealthy.ok).toBe(false);
    if (!unhealthy.ok) expect(unhealthy.error).toMatch(/unhealthy/);
  });

  it("fails when the manifest declaration was modified to a different entry", async () => {
    setInputRow();
    writeServersJson(validServersJson("dist/other.cjs"));
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: descriptorMetadata(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not match the current installed declaration/);
  });

  it("fails when the server declaration was removed from the manifest", async () => {
    setInputRow();
    writeServersJson(
      JSON.stringify({ mcpServers: { "another-server": { command: "npx" } } })
    );
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: descriptorMetadata(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not present in the current installed manifest/);
  });

  it("fails when the on-disk declaration no longer declares a host runtime", async () => {
    setInputRow();
    writeServersJson(
      JSON.stringify({ mcpServers: { "demo-mcp": { command: "node", args: [ENTRY] } } })
    );
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: descriptorMetadata(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no longer declares a host runtime/);
  });

  it("falls back to the unscoped row server name when pluginServerName is absent", async () => {
    setInputRow();
    const metadata = descriptorMetadata();
    delete metadata.pluginServerName;
    const result = await checker().check({
      pluginName: "demo-plugin",
      rowServerName: ROW_SERVER,
      rowMetadata: metadata,
    });
    expect(result.ok).toBe(true);
  });
});
