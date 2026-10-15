import { log } from "@/modules/Logger";
import type { PluginError } from "@/entityTypes/pluginTypes";
import {
  clampPluginToolPolicy,
  evaluateHostRequirements,
  pluginToolPolicySchema,
  pluginHostRequirementsSchema,
  type PluginToolPolicy,
} from "@/entityTypes/pluginExecutionTypes";

/**
 * PluginToolPolicyRegistry — generic, in-process registry of validated
 * plugin-declared MCP tool execution policies (plugin PRD §9, HOST-01).
 *
 * Policies are keyed by the canonical AI tool name
 * `mcp__<plugin>__<server>__<tool>` — never by a database MCP server id —
 * so the identity is stable across reinstalls (design §5.4).
 *
 * Resolution order for timeout decisions (PRD §9.4 / HOST-02):
 *   1. explicit registered built-in skill policy (query loop, unchanged)
 *   2. THIS registry — validated plugin MCP tool policy
 *   3. generic tool-name inference (existing fallback)
 *
 * An unsupported required host capability is an ACTIVATION failure: the
 * plugin's policies are not registered (no silent 90 s fallback for a tool
 * that declared it needs managed async).
 */

export interface PluginToolPolicyEntry {
  readonly pluginName: string;
  readonly serverName: string;
  readonly toolName: string;
  /** Validated and host-clamped policy. */
  readonly policy: PluginToolPolicy;
}

export class PluginToolPolicyRegistry {
  /** canonical AI tool name → entry */
  private entries = new Map<string, PluginToolPolicyEntry>();
  /** plugin name → canonical names registered for that plugin */
  private byPlugin = new Map<string, Set<string>>();

  /**
   * Register every valid policy declared in a plugin manifest.
   * Policy map keys use `<unscoped server name>/<tool name>`.
   *
   * Returns activation-blocking errors (unsupported host capability,
   * invalid policy shape, policy referencing an undeclared server). All
   * valid entries for the plugin are replaced atomically; on error the
   * plugin's previous entries (if any) are dropped so a broken update can
   * never leave stale policies live.
   */
  public registerFromManifest(
    pluginName: string,
    manifest: unknown
  ): { readonly errors: readonly PluginError[] } {
    const errors: PluginError[] = [];
    const fail = (
      code: PluginError["code"],
      message: string,
      componentName?: string
    ): void => {
      errors.push({
        code,
        componentType: "mcpServer",
        componentName,
        pluginName,
        message,
        recoverable: false,
      });
    };

    // Re-registering replaces the plugin's previous entries.
    this.unregisterPlugin(pluginName);

    if (!manifest || typeof manifest !== "object") {
      return { errors };
    }
    const record = manifest as Record<string, unknown>;

    // Host requirements gate activation (design §5.4): an unsupported
    // required capability means the plugin cannot run here — register none
    // of its policies.
    if (record.hostRequirements !== undefined) {
      const req = pluginHostRequirementsSchema.safeParse(
        record.hostRequirements
      );
      if (!req.success) {
        fail(
          "manifest-schema-invalid",
          `hostRequirements is invalid: ${req.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`
        );
        return { errors };
      }
      const evaluation = evaluateHostRequirements(req.data);
      if (!evaluation.ok) {
        fail(
          "dependency-unsatisfied",
          `Plugin requires unsupported host capabilities: ${evaluation.missing.join(", ")}`
        );
        return { errors };
      }
    }

    const toolPolicies = record.toolPolicies;
    if (toolPolicies === undefined) {
      return { errors };
    }
    if (typeof toolPolicies !== "object" || toolPolicies === null) {
      fail("manifest-schema-invalid", "toolPolicies must be an object");
      return { errors };
    }

    const canonicalFor = (plugin: string, server: string, tool: string) =>
      `mcp__${plugin}__${server}__${tool}`;

    const pending: PluginToolPolicyEntry[] = [];
    for (const [key, rawPolicy] of Object.entries(
      toolPolicies as Record<string, unknown>
    )) {
      const [serverName, toolName] = key.split("/");
      if (!serverName || !toolName || key.split("/").length !== 2) {
        fail(
          "manifest-schema-invalid",
          `toolPolicies key "${key}" must have the form "<server>/<tool>"`,
          key
        );
        continue;
      }
      const parsed = pluginToolPolicySchema.safeParse(rawPolicy);
      if (!parsed.success) {
        fail(
          "manifest-schema-invalid",
          `toolPolicies["${key}"] is invalid: ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
          key
        );
        continue;
      }
      pending.push({
        pluginName,
        serverName,
        toolName,
        policy: clampPluginToolPolicy(parsed.data),
      });
    }

    if (errors.length > 0) {
      // Drop everything for this plugin — partially-registered policies for
      // a manifest that failed validation would be misleading.
      this.unregisterPlugin(pluginName);
      return { errors };
    }

    const names = new Set<string>();
    for (const entry of pending) {
      const canonical = canonicalFor(
        entry.pluginName,
        entry.serverName,
        entry.toolName
      );
      this.entries.set(canonical, entry);
      names.add(canonical);
    }
    this.byPlugin.set(pluginName, names);
    return { errors };
  }

  /** Remove every policy registered for a plugin (disable/uninstall/update). */
  public unregisterPlugin(pluginName: string): void {
    const names = this.byPlugin.get(pluginName);
    if (!names) return;
    for (const canonical of names) {
      this.entries.delete(canonical);
    }
    this.byPlugin.delete(pluginName);
  }

  /** Resolve a policy by canonical AI tool name (`mcp__plugin__server__tool`). */
  public resolveByToolName(aiToolName: string): PluginToolPolicyEntry | null {
    return this.entries.get(aiToolName) ?? null;
  }

  /** Resolve a timeout class for a tool name; null when no policy exists. */
  public resolveToolTimeoutClass(
    aiToolName: string
  ): PluginToolPolicy["timeoutClass"] | null {
    return this.entries.get(aiToolName)?.policy.timeoutClass ?? null;
  }

  /** Test/telemetry support. */
  public size(): number {
    return this.entries.size;
  }

  public clearForTest(): void {
    this.entries.clear();
    this.byPlugin.clear();
  }
}

let defaultRegistry: PluginToolPolicyRegistry | undefined;

export function getPluginToolPolicyRegistry(): PluginToolPolicyRegistry {
  if (!defaultRegistry) defaultRegistry = new PluginToolPolicyRegistry();
  return defaultRegistry;
}

export function setPluginToolPolicyRegistryForTest(
  registry: PluginToolPolicyRegistry | undefined
): void {
  defaultRegistry = registry;
}
