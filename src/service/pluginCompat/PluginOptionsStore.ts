import * as fs from "fs";
import * as path from "path";
import { getPluginOptionsFile } from "@/service/pluginPaths";

/**
 * Per-plugin MCP options store.
 *
 * Stores user-supplied MCP option values (API keys, etc.) keyed by scoped
 * server name. Used at spawn time to resolve ${VAR} placeholders in MCP
 * server `env` blocks.
 *
 * On-disk shape (~/.aifetchly/plugins/installed/<plugin>/options.json):
 *   {
 *     "<plugin>__<server>": {
 *       "API_KEY": "abc123",
 *       "DEBUG": "true"
 *     }
 * }
 *
 * NOTE: values are stored as plaintext in this version. Encrypting secrets
 * with Electron safeStorage is a documented follow-up (PRD §8.2). The
 * resolution mechanics are unaffected by encryption.
 *
 * All methods are static; the store is filesystem-backed and stateless.
 */

const PLACEHOLDER_RE = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

export interface PluginOptionsMap {
  readonly [scopedServerName: string]: Readonly<Record<string, string>>;
}

export class PluginOptionsStore {
  /**
   * Read the options file for a plugin. Returns an empty map when the file
   * does not exist or fails to parse (treated as no options configured).
   */
  static read(pluginName: string): PluginOptionsMap {
    const file = getPluginOptionsFile(pluginName);
    if (!fs.existsSync(file)) return {};
    try {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      return parsed as PluginOptionsMap;
    } catch {
      return {};
    }
  }

  /**
   * Write the options file for a plugin. Creates parent directories as
   * needed. Atomic write via temp file + rename.
   */
  static write(pluginName: string, options: PluginOptionsMap): void {
    const file = getPluginOptionsFile(pluginName);
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(options, null, 2), "utf-8");
    fs.renameSync(tmp, file);
  }

  /**
   * Resolve ${VAR} placeholders in an env block using the option values
   * for a specific scoped server name.
   *
   * Returns:
   *   - { ok: true, env } on success (placeholders resolved, plain values
   *     preserved)
   *   - { ok: false, missing } when one or more placeholders cannot be
   *     resolved (caller should fail with a structured error rather than
   *     spawn a server with unresolved env)
   */
  static resolveEnv(
    pluginName: string,
    scopedServerName: string,
    env: Readonly<Record<string, string>>
  ): { ok: true; env: Record<string, string> } | { ok: false; missing: string[] } {
    const options = PluginOptionsStore.read(pluginName);
    const serverOptions = options[scopedServerName] ?? {};
    const resolved: Record<string, string> = {};
    const missing: string[] = [];
    for (const [k, v] of Object.entries(env)) {
      const match = v.match(PLACEHOLDER_RE);
      if (match) {
        const varName = match[1];
        if (varName in serverOptions) {
          resolved[k] = serverOptions[varName];
        } else {
          missing.push(varName);
        }
      } else {
        resolved[k] = v;
      }
    }
    if (missing.length > 0) return { ok: false, missing };
    return { ok: true, env: resolved };
  }

  /**
   * Set a single option value for a scoped server. Reads current options,
   * updates the value, writes back atomically.
   */
  static setOption(
    pluginName: string,
    scopedServerName: string,
    varName: string,
    value: string
  ): void {
    const options = PluginOptionsStore.read(pluginName);
    const serverOpts = {
      ...(options[scopedServerName] ?? {}),
      [varName]: value,
    };
    PluginOptionsStore.write(pluginName, {
      ...options,
      [scopedServerName]: serverOpts,
    });
  }

  /**
   * Discover the set of ${VAR} placeholders declared by a plugin's MCP
   * servers. Used by the Plugin Manager UI to render an options editor.
   *
   * Caller passes in the env blocks keyed by scoped server name (typically
   * obtained from the loaded plugin's mcpServers list).
   */
  static discoverPlaceholders(
    envsByScopedName: Readonly<Record<string, Readonly<Record<string, string>>>>
  ): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [scopedName, env] of Object.entries(envsByScopedName)) {
      const placeholders: string[] = [];
      for (const v of Object.values(env)) {
        const m = v.match(PLACEHOLDER_RE);
        if (m) placeholders.push(m[1]);
      }
      if (placeholders.length > 0) out[scopedName] = placeholders;
    }
    return out;
  }
}
