import type { PluginError, PluginHealth } from "@/entityTypes/pluginTypes";

/**
 * Decide plugin health from load diagnostics.
 *
 * Recoverable `agent-unsupported-field` warnings (ignored privilege fields,
 * Claude model aliases, tools AiFetchly cannot run) stay visible in
 * diagnostics and do not mark the plugin `partial_load`. A plugin is
 * partially loaded when some other component actually failed.
 */
export function pluginHealthForLoadErrors(
  errors: readonly PluginError[],
  current?: PluginHealth
): PluginHealth {
  if (
    current === "invalid" ||
    current === "missing_files" ||
    current === "disabled"
  ) {
    return current;
  }
  if (errors.some((error) => error.code === "dependency-unsatisfied")) {
    return "needs_configuration";
  }
  if (errors.length === 0) return "healthy";
  const onlyAgentWarnings = errors.every(
    (error) => error.recoverable && error.code === "agent-unsupported-field"
  );
  if (onlyAgentWarnings) return "healthy";
  return "partial_load";
}

export function isPluginHealth(value: string): value is PluginHealth {
  return (
    value === "healthy" ||
    value === "disabled" ||
    value === "needs_configuration" ||
    value === "partial_load" ||
    value === "invalid" ||
    value === "missing_files"
  );
}
