import type { PluginError } from "@/entityTypes/pluginTypes";

/**
 * Parses Claude-style plugin identifiers.
 *
 *   "lead-tools"                  → { name: "lead-tools" }
 *   "lead-tools@anthropics"       → { name: "lead-tools", marketplace: "anthropics" }
 *
 * Both segments must match PLUGIN_NAME_REGEX. Multiple "@" separators are
 * rejected. Empty marketplace ("foo@") is rejected.
 */

export interface ParsedPluginIdentifier {
  readonly name: string;
  readonly marketplace?: string;
}

const NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function parsePluginIdentifier(
  id: string
): { ok: true; value: ParsedPluginIdentifier } | { ok: false; error: PluginError } {
  if (typeof id !== "string" || id.length === 0) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: "Plugin identifier is empty.",
        recoverable: false,
      },
    };
  }

  const atCount = (id.match(/@/g) ?? []).length;
  if (atCount > 1) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: `Plugin identifier "${id}" contains multiple "@" separators.`,
        recoverable: false,
      },
    };
  }

  const [name, marketplace] = id.split("@");

  if (!NAME_REGEX.test(name)) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: `Plugin name "${name}" must match /^[a-z0-9][a-z0-9_-]*$/.`,
        recoverable: false,
      },
    };
  }

  if (marketplace !== undefined) {
    if (marketplace.length === 0) {
      return {
        ok: false,
        error: {
          code: "plugin-identifier-invalid",
          message: `Plugin identifier "${id}" has empty marketplace.`,
          recoverable: false,
        },
      };
    }
    if (!NAME_REGEX.test(marketplace)) {
      return {
        ok: false,
        error: {
          code: "plugin-identifier-invalid",
          message: `Plugin marketplace "${marketplace}" must match /^[a-z0-9][a-z0-9_-]*$/.`,
          recoverable: false,
        },
      };
    }
    return { ok: true, value: { name, marketplace } };
  }

  return { ok: true, value: { name } };
}
