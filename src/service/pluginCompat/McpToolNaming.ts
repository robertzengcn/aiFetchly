/**
 * Dual-format MCP tool naming.
 *
 * Two coexisting formats:
 *
 *   Legacy (non-plugin servers):    mcp_<serverId>_<toolName>
 *     - serverId is the MCPToolEntity DB row ID (integer)
 *     - toolName may contain underscores; the 3rd+ segments join with _
 *
 *   Plugin (plugin-owned servers):  mcp__<plugin>__<server>__<toolName>
 *     - plugin is the plugin name (matches PluginManifest.name)
 *     - server is the UN-SCOPED server name (without the <plugin>__ prefix)
 *     - toolName may contain underscores
 *
 * The `__` separator is chosen because plugin names and unscoped server
 * names match PLUGIN_NAME_REGEX (only [a-z0-9_-], never `__` themselves),
 * so the format is unambiguous.
 *
 * PRD AC-6: "An MCP tool from a Claude plugin is callable from AiChatV2
 * with the mcp__<plugin>__<server>__<tool> naming."
 */

export function buildPluginToolName(
  pluginName: string,
  unscopedServerName: string,
  toolName: string
): string {
  return `mcp__${pluginName}__${unscopedServerName}__${toolName}`;
}

export function buildLegacyToolName(
  serverId: number,
  toolName: string
): string {
  return `mcp_${serverId}_${toolName}`;
}

export function isPluginOwnedToolName(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

export type ParsedMcpToolName =
  | { ok: true; kind: "legacy"; serverId: number; toolName: string }
  | { ok: true; kind: "plugin"; pluginName: string; unscopedServerName: string; toolName: string }
  | { ok: false; error: string };

export function parseMcpToolName(toolName: string): ParsedMcpToolName {
  if (!toolName.startsWith("mcp")) {
    return { ok: false, error: `Not an MCP tool name: ${toolName}` };
  }

  if (toolName.startsWith("mcp__")) {
    // Plugin format: mcp__<plugin>__<server>__<tool...>
    // Split on __ — segments after the empty leading one.
    const segments = toolName.split("__");
    // segments[0] = "mcp"
    // segments[1] = plugin name
    // segments[2] = unscoped server name
    // segments[3..] = tool name parts (re-joined with __)
    if (segments.length < 4) {
      return {
        ok: false,
        error: `Plugin MCP tool name needs at least 4 segments: ${toolName}`,
      };
    }
    const pluginName = segments[1];
    const unscopedServerName = segments[2];
    const toolNamePart = segments.slice(3).join("__");
    if (!pluginName || !unscopedServerName || !toolNamePart) {
      return { ok: false, error: `Empty segment in ${toolName}` };
    }
    return { ok: true, kind: "plugin", pluginName, unscopedServerName, toolName: toolNamePart };
  }

  // Legacy format: mcp_<serverId>_<tool...>
  if (!toolName.startsWith("mcp_")) {
    return { ok: false, error: `Unknown MCP tool prefix: ${toolName}` };
  }
  const parts = toolName.split("_");
  // parts[0] = "mcp", parts[1] = serverId, parts[2..] = tool name parts
  if (parts.length < 3) {
    return { ok: false, error: `Legacy MCP tool name needs at least 3 segments: ${toolName}` };
  }
  const serverId = parseInt(parts[1], 10);
  if (isNaN(serverId)) {
    return { ok: false, error: `Invalid server ID in ${toolName}` };
  }
  const toolNamePart = parts.slice(2).join("_");
  return { ok: true, kind: "legacy", serverId, toolName: toolNamePart };
}

/**
 * Strip the `<plugin>__` prefix from a scoped server name to recover the
 * original unscoped name. Returns the input unchanged if no prefix is
 * present.
 */
export function unscopeServerName(
  pluginName: string,
  scopedServerName: string
): string {
  const prefix = `${pluginName}__`;
  return scopedServerName.startsWith(prefix)
    ? scopedServerName.slice(prefix.length)
    : scopedServerName;
}
