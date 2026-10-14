import { describe, it, expect } from "vitest";
import {
  pluginToolPolicySchema,
  pluginHostRequirementsSchema,
  pluginRuntimeDescriptorSchema,
  clampPluginToolPolicy,
  evaluateHostRequirements,
  readRuntimeDescriptorFromMetadata,
  HOST_CAPABILITY_VERSIONS,
  HOST_MAX_RUN_MS,
  HOST_RUNTIME_METADATA_FIELD,
} from "@/entityTypes/pluginExecutionTypes";

const VALID_POLICY = {
  contractVersion: 1,
  timeoutClass: "async",
  maxRunMs: 1_800_000,
  supportsProgress: true,
  supportsPartialResult: true,
  cancellable: true,
  maxConcurrentPerConversation: 1,
} as const;

describe("pluginToolPolicySchema", () => {
  it("accepts a valid async policy", () => {
    const r = pluginToolPolicySchema.safeParse(VALID_POLICY);
    expect(r.success).toBe(true);
  });

  it("rejects an unknown timeout class", () => {
    const r = pluginToolPolicySchema.safeParse({
      ...VALID_POLICY,
      timeoutClass: "whenever",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a zero/negative maxRunMs", () => {
    expect(
      pluginToolPolicySchema.safeParse({ ...VALID_POLICY, maxRunMs: 0 }).success
    ).toBe(false);
  });

  it("rejects an unknown contract version", () => {
    const r = pluginToolPolicySchema.safeParse({
      ...VALID_POLICY,
      contractVersion: 2,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown result contract", () => {
    const r = pluginToolPolicySchema.safeParse({
      ...VALID_POLICY,
      resultContract: "something.else.v9",
    });
    expect(r.success).toBe(false);
  });
});

describe("pluginHostRequirementsSchema + evaluateHostRequirements", () => {
  it("accepts a satisfied requirement set", () => {
    const parsed = pluginHostRequirementsSchema.safeParse({
      contractVersion: 1,
      capabilities: { "mcp-host-node": 1, "mcp-managed-async": 1 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(evaluateHostRequirements(parsed.data).ok).toBe(true);
    }
  });

  it("reports a missing capability as activation-blocking", () => {
    const parsed = pluginHostRequirementsSchema.safeParse({
      contractVersion: 1,
      capabilities: { "warp-drive": 1 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const evaluation = evaluateHostRequirements(parsed.data);
      expect(evaluation.ok).toBe(false);
      expect(evaluation.missing).toContain("warp-drive");
    }
  });

  it("reports a capability whose required version exceeds the host", () => {
    const parsed = pluginHostRequirementsSchema.safeParse({
      contractVersion: 1,
      capabilities: { "mcp-host-node": 99 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(evaluateHostRequirements(parsed.data).ok).toBe(false);
    }
  });

  it("hosts at least the four v1 capabilities", () => {
    for (const name of [
      "mcp-host-node",
      "mcp-managed-async",
      "browser-executable",
      "plugin-file-artifacts",
    ]) {
      expect(HOST_CAPABILITY_VERSIONS[name]).toBeDefined();
    }
  });
});

describe("clampPluginToolPolicy", () => {
  it("clamps maxRunMs and concurrency to host maxima", () => {
    const clamped = clampPluginToolPolicy({
      ...VALID_POLICY,
      maxRunMs: HOST_MAX_RUN_MS * 10,
      maxConcurrentPerConversation: 4,
    });
    expect(clamped.maxRunMs).toBe(HOST_MAX_RUN_MS);
    expect(clamped.maxConcurrentPerConversation).toBe(1);
  });

  it("keeps already-compliant values untouched", () => {
    const clamped = clampPluginToolPolicy(VALID_POLICY);
    expect(clamped.maxRunMs).toBe(VALID_POLICY.maxRunMs);
  });
});

describe("pluginRuntimeDescriptorSchema + metadata reading", () => {
  it("accepts a valid descriptor", () => {
    const r = pluginRuntimeDescriptorSchema.safeParse({
      contractVersion: 1,
      runtime: "aifetchly-node",
      entry: "dist/yellow-pages-mcp.cjs",
    });
    expect(r.success).toBe(true);
  });

  it("validates shape only — path containment is enforced downstream", () => {
    // The schema accepts any non-empty string; lexical/realpath containment
    // is enforced by normalizeMcpDeclaration and PluginMcpRuntimeResolver.
    expect(
      pluginRuntimeDescriptorSchema.safeParse({
        contractVersion: 1,
        runtime: "aifetchly-node",
        entry: "../outside.cjs",
      }).success
    ).toBe(true);
  });

  it("reads a descriptor from metadata under the reserved key", () => {
    const descriptor = readRuntimeDescriptorFromMetadata({
      [HOST_RUNTIME_METADATA_FIELD]: {
        contractVersion: 1,
        runtime: "aifetchly-node",
        entry: "dist/server.cjs",
      },
    });
    expect(descriptor).not.toBeNull();
    expect(descriptor?.entry).toBe("dist/server.cjs");
  });

  it("returns null for missing or malformed descriptors", () => {
    expect(readRuntimeDescriptorFromMetadata(undefined)).toBeNull();
    expect(readRuntimeDescriptorFromMetadata({})).toBeNull();
    expect(
      readRuntimeDescriptorFromMetadata({
        [HOST_RUNTIME_METADATA_FIELD]: { runtime: "something-else" },
      })
    ).toBeNull();
  });
});
