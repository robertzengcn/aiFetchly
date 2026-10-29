import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPToolEntity } from "@/entity/MCPTool.entity";
import {
  PluginToolPolicyRegistry,
  setPluginToolPolicyRegistryForTest,
} from "@/service/PluginToolPolicyRegistry";
import { setPluginBrowserCapabilityServiceForTest } from "@/service/PluginBrowserCapabilityService";
import type { BrowserExecutableDescriptor } from "@/entityTypes/managedBrowserTypes";
import {
  HOST_RUNTIME_METADATA_FIELD,
  PLUGIN_MCP_HOST_RUNTIME,
} from "@/entityTypes/pluginExecutionTypes";

const clientCapture = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[] }));

vi.mock("@/service/PluginFileArtifactService", () => ({
  getPluginFileArtifactService: () => ({
    provisionStaging: (executionId: string) => `/staging/${executionId}`,
  }),
}));

vi.mock("@/modules/MCPClient", () => ({
  MCPClient: class {
    constructor(config: Record<string, unknown>) {
      clientCapture.configs.push(config);
    }
  },
}));

import { MCPToolService } from "@/service/MCPToolService";

/**
 * B11/HOST-15: execution-provisioned host context (staging directory +
 * browser descriptor) is granted ONLY to plugins whose manifest declares
 * the corresponding capability — a generic tool never gets artifact
 * staging or the browser path, and a browser-declaring tool gets the
 * descriptor whenever the host resolves one.
 */

function makeServer(partial: Partial<MCPToolEntity> = {}): MCPToolEntity {
  const server = new MCPToolEntity();
  server.serverName = "demo-plugin__scraper";
  server.transport = "stdio";
  server.pluginName = "demo-plugin";
  server.enabled = true;
  server.origin = "plugin";
  server.metadata = JSON.stringify({
    pluginServerName: "scraper",
    pluginOwner: "demo-plugin",
    [HOST_RUNTIME_METADATA_FIELD]: {
      contractVersion: 1,
      runtime: PLUGIN_MCP_HOST_RUNTIME,
      entry: "dist/index.cjs",
    },
  });
  return Object.assign(server, partial);
}

const fakeDescriptor: BrowserExecutableDescriptor = {
  path: "test/system/google-chrome",
  source: "system",
  product: "chrome",
  version: "136.0.7103.94",
  majorVersion: 136,
  architecture: "x64",
};

function registryFor(
  capabilities: Record<string, unknown> | undefined
): PluginToolPolicyRegistry {
  const reg = new PluginToolPolicyRegistry();
  reg.registerFromManifest("demo-plugin", {
    name: "demo-plugin",
    version: "1.0.0",
    capabilities,
  });
  return reg;
}

function browserServiceStub(descriptor: BrowserExecutableDescriptor | null) {
  return {
    resolve: () =>
      descriptor === null
        ? {
            errorCode: "browser_dependency_missing" as const,
            searchedPaths: [],
          }
        : { descriptor },
    describe: () => descriptor,
  };
}

function makeService(): MCPToolService {
  return new MCPToolService(
    {} as never,
    { check: () => ({ ok: true, pluginVersion: "1.0.0" }) } as never
  );
}

async function buildContext(
  capabilities: Record<string, unknown> | undefined,
  descriptor: BrowserExecutableDescriptor | null
): Promise<Record<string, unknown> | undefined> {
  clientCapture.configs.length = 0;
  setPluginToolPolicyRegistryForTest(registryFor(capabilities));
  setPluginBrowserCapabilityServiceForTest(
    browserServiceStub(descriptor) as never
  );
  const service = makeService();
  const internals = service as unknown as {
    createClientForServer: (
      server: MCPToolEntity,
      executeContext?: {
        executionId: string;
        deadlineEpochMs: number;
      }
    ) => Promise<unknown>;
  };
  await internals.createClientForServer(makeServer(), {
    executionId: "exec-b11",
    deadlineEpochMs: Date.now() + 60_000,
  });
  const config = clientCapture.configs[0] as
    | { hostRuntime?: { context?: Record<string, unknown> } }
    | undefined;
  return config?.hostRuntime?.context;
}

beforeEach(() => {
  setPluginToolPolicyRegistryForTest(undefined);
  setPluginBrowserCapabilityServiceForTest(undefined);
});

afterEach(() => {
  setPluginToolPolicyRegistryForTest(undefined);
  setPluginBrowserCapabilityServiceForTest(undefined);
});

describe("host context capability grants (B11)", () => {
  it("grants staging and browser to a plugin declaring both capabilities with a resolved browser", async () => {
    const context = await buildContext(
      { browserExecutable: true, fileArtifacts: ["json", "csv"] },
      fakeDescriptor
    );
    expect(context?.outputDirectory).toBe("/staging/exec-b11");
    expect(
      (context?.browser as { executablePath: string } | undefined)
        ?.executablePath
    ).toBe(fakeDescriptor.path);
  });

  it("grants NOTHING capability-shaped to a plugin whose manifest declares none", async () => {
    const context = await buildContext(undefined, fakeDescriptor);
    expect(context?.outputDirectory).toBeUndefined();
    expect(context?.browser).toBeUndefined();
  });

  it("grants no browser entry when the host cannot resolve a descriptor", async () => {
    const context = await buildContext(
      { browserExecutable: true, fileArtifacts: ["json"] },
      null
    );
    expect(context?.outputDirectory).toBe("/staging/exec-b11");
    expect(context?.browser).toBeUndefined();
  });

  it("keeps artifact staging absent for an artifact-less plugin even with a browser granted", async () => {
    const context = await buildContext(
      { browserExecutable: true },
      fakeDescriptor
    );
    expect(context?.outputDirectory).toBeUndefined();
    expect(
      (context?.browser as { executablePath: string } | undefined)
        ?.executablePath
    ).toBe(fakeDescriptor.path);
  });
});
