import { z } from "zod";
import type { ToolTimeoutClass } from "@/service/ToolTimeoutPolicy";

/**
 * Plugin execution contracts — shared typed surface for plugin-declared tool
 * policies, host requirements, and the host-managed MCP runtime.
 *
 * Source of truth: docs/prd/yellow-pages-scraper-plugin-prd.md §9 (manifest +
 * tool policy), §19.5 (host-managed runtime declaration) and
 * docs/prd/yellow-pages-scraper-plugin-technical-design.md §5, §6.
 *
 * These are generic host contracts — nothing Yellow Pages specific may appear
 * here (PRD §24.4 maintainability).
 */

/**
 * Reserved host-owned MCP metadata key carrying the normalized runtime
 * descriptor. `PluginImportService` must reject this key when it appears in
 * package-supplied metadata and write its own validated value instead
 * (design §5.3).
 */
export const HOST_RUNTIME_METADATA_FIELD = "_aifetchlyRuntimeV1" as const;

/** The only host-managed JavaScript runtime kind in contract v1. */
export const PLUGIN_MCP_HOST_RUNTIME = "aifetchly-node" as const;
export type PluginMcpHostRuntime = typeof PLUGIN_MCP_HOST_RUNTIME;

/** Generic versioned plugin result envelope identity (design §5.1). */
export const PLUGIN_TOOL_POLICY_RESULT_CONTRACT =
  "aifetchly.plugin-result.v1" as const;

// ---------------------------------------------------------------------------
// Zod schemas (validated at manifest load / policy registration boundaries)
// ---------------------------------------------------------------------------

export const pluginToolPolicySchema = z.object({
  contractVersion: z.literal(1),
  timeoutClass: z.enum(["fast", "network", "browser", "async"]),
  /** Hard ceiling for one execution of this tool, before host clamping. */
  maxRunMs: z.number().int().min(1_000).max(60 * 60_000),
  supportsProgress: z.boolean(),
  supportsPartialResult: z.boolean(),
  cancellable: z.boolean(),
  maxConcurrentPerConversation: z.number().int().min(1).max(4),
  resultContract: z.literal(PLUGIN_TOOL_POLICY_RESULT_CONTRACT).optional(),
});

export const pluginHostRequirementsSchema = z.object({
  contractVersion: z.literal(1),
  /** Capability name → minimum contract version the plugin requires. */
  capabilities: z.record(z.number().int().min(1)),
});

export const pluginCapabilitiesSchema = z.object({
  browserExecutable: z.boolean().optional(),
  fileArtifacts: z.array(z.enum(["json", "csv"])).optional(),
});

/** Persisted runtime descriptor (host-owned; rides in MCP metadata). */
export const pluginRuntimeDescriptorSchema = z.object({
  contractVersion: z.literal(1),
  runtime: z.literal(PLUGIN_MCP_HOST_RUNTIME),
  /** Plugin-relative entry path; lexically validated at persist AND launch. */
  entry: z.string().min(1).max(512),
});

export type PluginToolPolicy = z.infer<typeof pluginToolPolicySchema>;
export type PluginHostRequirements = z.infer<
  typeof pluginHostRequirementsSchema
>;
export type PluginCapabilities = z.infer<typeof pluginCapabilitiesSchema>;
export type PluginRuntimeDescriptor = z.infer<
  typeof pluginRuntimeDescriptorSchema
>;

/** Host capabilities this build actually implements (name → contract version). */
export const HOST_CAPABILITY_VERSIONS: Readonly<Record<string, number>> = {
  "mcp-host-node": 1,
  "mcp-managed-async": 1,
  "browser-executable": 1,
  "plugin-file-artifacts": 1,
};

/** Host-side ceilings plugin policies are clamped to (PRD §11.8: 30 min). */
export const HOST_MAX_RUN_MS = 30 * 60_000;
export const HOST_MAX_CONCURRENT_PER_CONVERSATION = 1;
/** Tail of the deadline reserved for cleanup escalation (design §9.1). */
export const HOST_CLEANUP_RESERVE_MS = 5_000;

/** Clamp a validated plugin policy to host maxima (design §5.4). */
export function clampPluginToolPolicy(
  policy: PluginToolPolicy
): PluginToolPolicy {
  return {
    ...policy,
    maxRunMs: Math.min(policy.maxRunMs, HOST_MAX_RUN_MS),
    maxConcurrentPerConversation: Math.min(
      policy.maxConcurrentPerConversation,
      HOST_MAX_CONCURRENT_PER_CONVERSATION
    ),
  };
}

/**
 * Evaluate a plugin's declared host requirements against this build.
 * An unmet required capability is an activation failure — never a silent
 * fallback to default timeouts (design §5.4).
 */
export function evaluateHostRequirements(
  req: PluginHostRequirements
): { readonly ok: boolean; readonly missing: readonly string[] } {
  const missing: string[] = [];
  for (const [name, version] of Object.entries(req.capabilities)) {
    const have = HOST_CAPABILITY_VERSIONS[name];
    if (have === undefined || have < version) {
      missing.push(name);
    }
  }
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Execution options threaded host → service → client (managed async)
// ---------------------------------------------------------------------------

/**
 * Options for a managed-async MCP tool call. Presence of this object selects
 * the deadline-aware path; absence keeps the legacy foreground behavior
 * (240 s race) untouched (PRD §24.3 compatibility).
 */
export interface PluginToolExecutionOptions {
  /** Authoritative wall-clock deadline for the whole call. */
  readonly deadlineEpochMs?: number;
  /** Registry-owned abort signal propagated to the SDK request. */
  readonly signal?: AbortSignal;
  /** Progress sink fed from validated MCP progress notifications. */
  readonly onProgress?: (progress: {
    readonly phase:
      | "queued"
      | "running"
      | "fetching"
      | "extracting"
      | "finalizing";
    readonly message: string;
    readonly progress: number | null;
    readonly partialCount: number | null;
    readonly expectedCount: number | null;
  }) => void;
}

// ---------------------------------------------------------------------------
// Host context file v1 (written by the resolver, read by the plugin entry)
// ---------------------------------------------------------------------------

/** Trusted host context delivered via `--host-context-file` (design §6.2). */
export interface PluginHostContextV1 {
  readonly version: 1;
  readonly mode: "discovery" | "execute";
  readonly executionId: string;
  readonly pluginName: string;
  readonly pluginVersion: string;
  /** Host-provisioned per-job staging directory for result files. */
  readonly outputDirectory?: string;
  /** Host-approved browser executable (capability-gated). */
  readonly browser?: {
    readonly executablePath: string;
    readonly version: string;
  };
  readonly deadlineEpochMs?: number;
}

/** Extract a validated runtime descriptor from raw MCP metadata, if any. */
export function readRuntimeDescriptorFromMetadata(
  metadata: Record<string, unknown> | undefined | null
): PluginRuntimeDescriptor | null {
  if (!metadata) return null;
  const raw = metadata[HOST_RUNTIME_METADATA_FIELD];
  if (!raw || typeof raw !== "object") return null;
  const parsed = pluginRuntimeDescriptorSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
