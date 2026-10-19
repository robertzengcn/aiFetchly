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

/**
 * HOST-04 (G01): declared execution targets the manifest's toolPolicies may
 * reference. Keyed by the UN-scoped server name (policy keys are
 * `<unscoped server>/<tool>`); the value lists the tools known to exist for
 * that server. An `undefined` (or empty) tool list means "declared, tools
 * unknown" — e.g. freshly persisted rows that have not been probed yet —
 * so only the server-level check applies for that entry.
 *
 * When no universe is supplied the registry falls back to inline `mcp`
 * declaration keys in the manifest itself; servers declared only in a file
 * (`mcp/servers.json`, `.mcp.json`) cannot be validated without the caller's
 * universe and are accepted (structurally validated only).
 */
export interface PluginPolicyTargetUniverse {
  readonly toolsByServer: ReadonlyMap<string, readonly string[] | undefined>;
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
    manifest: unknown,
    declaredTargets?: PluginPolicyTargetUniverse
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

    // Target universe (G01): the explicit caller-provided map wins; the
    // fallback derives conservative server-level knowledge from inline
    // `mcp` declarations in the manifest itself.
    let targetUniverse: PluginPolicyTargetUniverse | undefined =
      declaredTargets;
    if (!targetUniverse) {
      const inlineMcp = record.mcp;
      if (
        typeof inlineMcp === "object" &&
        inlineMcp !== null &&
        !Array.isArray(inlineMcp)
      ) {
        const toolsByServer = new Map<string, readonly string[] | undefined>();
        for (const server of Object.keys(inlineMcp as Record<string, unknown>)) {
          if (server.length > 0) toolsByServer.set(server, undefined);
        }
        if (toolsByServer.size > 0) targetUniverse = { toolsByServer };
      }
    }

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
      // The policy points at an execution surface the plugin exposes. When
      // the host knows the declared/discovered targets it MUST reject a
      // policy aimed at a server the plugin does not declare or a tool the
      // server has not declared/been discovered to provide — otherwise the
      // tool would still become reachable through fake-policy paths.
      if (targetUniverse) {
        if (!targetUniverse.toolsByServer.has(serverName)) {
          fail(
            "manifest-schema-invalid",
            `toolPolicies["${key}"] references server "${serverName}" which the plugin does not declare`,
            key
          );
          continue;
        }
        const knownTools = targetUniverse.toolsByServer.get(serverName);
        // Only a NON-EMPTY tool list is proof a tool exists (rows persist
        // an empty JSON array until the first discovery probe; an empty
        // probed server executes nothing anyway). `undefined` and `[]` both
        // mean "tools unknown": the server-level check still applies.
        if (
          knownTools !== undefined &&
          knownTools.length > 0 &&
          !knownTools.includes(toolName)
        ) {
          fail(
            "manifest-schema-invalid",
            `toolPolicies["${key}"] references tool "${toolName}" which is neither declared nor discovered for server "${serverName}"`,
            key
          );
          continue;
        }
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

/**
 * Build a HOST-04 target universe from persisted MCP rows (the
 * `applyLoadedPlugins` path and the B06 restore path) or from the normalized
 * server descriptors of an in-flight install.
 *
 * Rows store the SCOPED server name (`<plugin>__<server>`) while policy keys
 * and built policies use the UN-scoped name; `metadata.pluginServerName`
 * (written by the scoping step) is authoritative, with a strict prefix strip
 * as fallback. `tools` may arrive as a JSON string (entity column) or as an
 * already-parsed array; anything unparseable degrades to "tools unknown".
 */
export function buildPluginPolicyTargetUniverse(
  pluginName: string,
  servers: ReadonlyArray<{
    readonly serverName: string;
    readonly metadata?: Record<string, unknown> | string | null;
    readonly tools?: string | readonly string[] | null;
  }>
): PluginPolicyTargetUniverse {
  const toolsByServer = new Map<string, readonly string[] | undefined>();
  const scopedPrefix = `${pluginName}__`;

  const unscopedName = (serverName: string, metadata?: Record<string, unknown>): string => {
    const declared = metadata?.pluginServerName;
    // The scoping step writes the plain (un-scoped) server label; trust it
    // when present and never re-derive it from a scoped form.
    if (typeof declared === "string" && declared.length > 0) return declared;
    if (serverName.startsWith(scopedPrefix)) return serverName.slice(scopedPrefix.length);
    return serverName;
  };

  for (const server of servers) {
    let metadata: Record<string, unknown> | undefined;
    if (typeof server.metadata === "string") {
      try {
        const parsed: unknown = JSON.parse(server.metadata);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        metadata = undefined;
      }
    } else if (server.metadata && typeof server.metadata === "object") {
      metadata = server.metadata;
    }

    const name = unscopedName(server.serverName, metadata);
    if (name.length === 0 || toolsByServer.has(name)) continue;

    let tools: readonly string[] | undefined;
    if (typeof server.tools === "string") {
      try {
        const parsedTools: unknown = JSON.parse(server.tools);
        if (
          Array.isArray(parsedTools) &&
          parsedTools.every((t) => typeof t === "string")
        ) {
          tools = parsedTools as readonly string[];
        }
      } catch {
        tools = undefined;
      }
    } else if (Array.isArray(server.tools)) {
      tools = server.tools.every((t) => typeof t === "string")
        ? (server.tools as readonly string[])
        : undefined;
    }
    toolsByServer.set(name, tools);
  }

  return { toolsByServer };
}

export function getPluginToolPolicyRegistry(): PluginToolPolicyRegistry {
  if (!defaultRegistry) defaultRegistry = new PluginToolPolicyRegistry();
  return defaultRegistry;
}

export function setPluginToolPolicyRegistryForTest(
  registry: PluginToolPolicyRegistry | undefined
): void {
  defaultRegistry = registry;
}
