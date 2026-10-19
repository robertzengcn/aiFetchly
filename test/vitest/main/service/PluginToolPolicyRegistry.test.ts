import { describe, it, expect, beforeEach } from "vitest";
import {
  PluginToolPolicyRegistry,
  buildPluginPolicyTargetUniverse,
} from "@/service/PluginToolPolicyRegistry";
import { HOST_MAX_RUN_MS } from "@/entityTypes/pluginExecutionTypes";

const VALID_POLICY = {
  contractVersion: 1,
  timeoutClass: "async",
  maxRunMs: 1_800_000,
  supportsProgress: true,
  supportsPartialResult: true,
  cancellable: true,
  maxConcurrentPerConversation: 1,
} as const;

const MANIFEST = {
  name: "demo-scraper",
  version: "1.0.0",
  mcpServers: [".mcp.json"],
  toolPolicies: {
    "scraper/scrape_things": { ...VALID_POLICY },
    "scraper/list_platforms": {
      ...VALID_POLICY,
      timeoutClass: "fast",
      maxRunMs: 30_000,
      supportsProgress: false,
      supportsPartialResult: false,
    },
  },
};

describe("PluginToolPolicyRegistry", () => {
  let registry: PluginToolPolicyRegistry;

  beforeEach(() => {
    registry = new PluginToolPolicyRegistry();
  });

  it("registers valid policies and resolves by canonical AI tool name", () => {
    const { errors } = registry.registerFromManifest(
      "demo-scraper",
      MANIFEST
    );
    expect(errors).toEqual([]);

    const entry = registry.resolveByToolName(
      "mcp__demo-scraper__scraper__scrape_things"
    );
    expect(entry).not.toBeNull();
    expect(entry?.policy.timeoutClass).toBe("async");
    expect(entry?.policy.maxRunMs).toBe(1_800_000);

    const fast = registry.resolveByToolName(
      "mcp__demo-scraper__scraper__list_platforms"
    );
    expect(fast?.policy.timeoutClass).toBe("fast");
  });

  it("clamps plugin-declared ceilings to host maxima", () => {
    registry.registerFromManifest("demo-scraper", {
      ...MANIFEST,
      toolPolicies: {
        "scraper/scrape_things": {
          ...VALID_POLICY,
          // Schema-valid (≤ 60 min) but above the 30-min host ceiling.
          maxRunMs: HOST_MAX_RUN_MS + 10 * 60_000,
          maxConcurrentPerConversation: 4,
        },
      },
    });
    const entry = registry.resolveByToolName(
      "mcp__demo-scraper__scraper__scrape_things"
    );
    expect(entry?.policy.maxRunMs).toBe(HOST_MAX_RUN_MS);
    expect(entry?.policy.maxConcurrentPerConversation).toBe(1);
  });

  it("rejects an invalid policy shape without registering anything", () => {
    const { errors } = registry.registerFromManifest("demo-scraper", {
      ...MANIFEST,
      toolPolicies: {
        "scraper/scrape_things": { ...VALID_POLICY, timeoutClass: "whenever" },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(
      registry.resolveByToolName("mcp__demo-scraper__scraper__scrape_things")
    ).toBeNull();
  });

  it("blocks activation on an unsupported required host capability", () => {
    const { errors } = registry.registerFromManifest("demo-scraper", {
      ...MANIFEST,
      hostRequirements: {
        contractVersion: 1,
        capabilities: { "mcp-host-node": 1, "warp-drive": 2 },
      },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toContain("warp-drive");
    expect(registry.size()).toBe(0);
  });

  it("rejects malformed policy keys", () => {
    const { errors } = registry.registerFromManifest("demo-scraper", {
      toolPolicies: { "no-slash-key": { ...VALID_POLICY } },
    });
    expect(errors.length).toBe(1);
    expect(registry.size()).toBe(0);
  });

  it("unregisters a plugin's policies on disable/uninstall", () => {
    registry.registerFromManifest("demo-scraper", MANIFEST);
    expect(registry.size()).toBe(2);
    registry.unregisterPlugin("demo-scraper");
    expect(registry.size()).toBe(0);
  });

  it("replaces previous entries on re-registration (update path)", () => {
    registry.registerFromManifest("demo-scraper", MANIFEST);
    registry.registerFromManifest("demo-scraper", {
      toolPolicies: {
        "scraper/new_tool": { ...VALID_POLICY },
      },
    });
    expect(registry.size()).toBe(1);
    expect(
      registry.resolveByToolName("mcp__demo-scraper__scraper__scrape_things")
    ).toBeNull();
    expect(
      registry.resolveByToolName("mcp__demo-scraper__scraper__new_tool")
    ).not.toBeNull();
  });

  it("drops stale entries when a re-registration fails validation", () => {
    registry.registerFromManifest("demo-scraper", MANIFEST);
    const { errors } = registry.registerFromManifest("demo-scraper", {
      toolPolicies: { "scraper/bad": { contractVersion: 9 } },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(registry.size()).toBe(0);
  });

  it("resolveToolTimeoutClass returns null for unknown tools", () => {
    registry.registerFromManifest("demo-scraper", MANIFEST);
    expect(registry.resolveToolTimeoutClass("mcp__other__x__y")).toBeNull();
    expect(
      registry.resolveToolTimeoutClass("mcp__demo-scraper__scraper__scrape_things")
    ).toBe("async");
  });

  it("accepts a manifest with no toolPolicies", () => {
    const { errors } = registry.registerFromManifest("demo-scraper", {
      name: "demo-scraper",
    });
    expect(errors).toEqual([]);
    expect(registry.size()).toBe(0);
  });
});

describe("PluginToolPolicyRegistry target validation (G01)", () => {
  let registry: PluginToolPolicyRegistry;

  beforeEach(() => {
    registry = new PluginToolPolicyRegistry();
  });

  it("rejects a policy referencing a server the plugin does not declare", () => {
    const { errors } = registry.registerFromManifest(
      "demo-scraper",
      MANIFEST,
      { toolsByServer: new Map([["scraper", ["scrape_things", "list_platforms"]]]) }
    );
    expect(errors).toEqual([]);
    expect(registry.size()).toBe(2);

    const { errors: undeclared } = registry.registerFromManifest(
      "demo-scraper",
      {
        ...MANIFEST,
        toolPolicies: {
          "other_server/scrape_things": { ...VALID_POLICY },
        },
      },
      { toolsByServer: new Map([["scraper", ["scrape_things"]]]) }
    );
    expect(undeclared.length).toBe(1);
    expect(undeclared[0]?.message).toContain('does not declare');
    expect(undeclared[0]?.message).toContain("other_server");
    expect(registry.size()).toBe(0);
  });

  it("accepts a declared server when the tool list is unknown", () => {
    const { errors } = registry.registerFromManifest(
      "demo-scraper",
      MANIFEST,
      { toolsByServer: new Map([["scraper", undefined]]) }
    );
    expect(errors).toEqual([]);
    expect(registry.size()).toBe(2);
    // An empty tool list means the same thing.
    const again = registry.registerFromManifest("demo-scraper", {
      ...MANIFEST,
      toolPolicies: { "scraper/scrape_things": { ...VALID_POLICY } },
    }, { toolsByServer: new Map([["scraper", []]]) });
    expect(again.errors).toEqual([]);
  });

  it("rejects a policy targeting a tool that is neither declared nor discovered", () => {
    const { errors } = registry.registerFromManifest(
      "demo-scraper",
      {
        ...MANIFEST,
        toolPolicies: {
          "scraper/scrape_things": { ...VALID_POLICY },
          "scraper/sneaky_tool": { ...VALID_POLICY },
        },
      },
      { toolsByServer: new Map([["scraper", ["scrape_things", "list_platforms"]]]) }
    );
    expect(errors.length).toBe(1);
    if (errors[0]) {
      expect(errors[0].message).toContain("sneaky_tool");
      expect(errors[0].message).toContain("neither declared nor discovered");
    }
    expect(registry.size()).toBe(0);
  });

  it("derives server-level targets from inline mcp declarations when no universe is passed", () => {
    const inlineManifest = {
      name: "demo-scraper",
      version: "1.0.0",
      mcp: {
        scraper: { command: "node", args: ["server.js"] },
      },
      toolPolicies: {
        "scraper/scrape_things": { ...VALID_POLICY },
        "shadow/scrape_things": { ...VALID_POLICY },
      },
    };
    const { errors } = registry.registerFromManifest("demo-scraper", inlineManifest);
    expect(errors.length).toBe(1);
    if (errors[0]) expect(errors[0].message).toContain("shadow");
    expect(registry.size()).toBe(0);
  });

  it("does not constrain policies when the manifest has no inline mcp map and no universe is passed", () => {
    const { errors } = registry.registerFromManifest("demo-scraper", MANIFEST);
    expect(errors).toEqual([]);
    expect(registry.size()).toBe(2);
  });

  it("builds a universe from persisted scoped MCP rows (tool lists known)", () => {
    const universe = buildPluginPolicyTargetUniverse("demo-scraper", [
      {
        serverName: "demo-scraper__scraper",
        metadata: JSON.stringify({ pluginServerName: "scraper", pluginOwner: "demo-scraper" }),
        tools: JSON.stringify(["scrape_things"]),
      },
      // Tools column that never parsed leaves the tool level open.
      {
        serverName: "demo-scraper__other",
        metadata: null,
        tools: "{not json",
      },
    ]);
    expect([...universe.toolsByServer.keys()].sort()).toEqual(["other", "scraper"]);
    expect(universe.toolsByServer.get("other")).toBeUndefined();
    expect(universe.toolsByServer.get("scraper")).toEqual(["scrape_things"]);

    const rejected = registry.registerFromManifest(
      "demo-scraper",
      {
        ...MANIFEST,
        toolPolicies: {
          "scraper/list_platforms": { ...VALID_POLICY },
        },
      },
      universe
    );
    expect(rejected.errors.length).toBe(1);
    if (rejected.errors[0]) {
      expect(rejected.errors[0].message).toContain("list_platforms");
    }
    expect(registry.size()).toBe(0);
  });
});
