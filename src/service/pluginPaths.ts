import * as path from "path";
import { getElectronUserDataPath } from "@/service/SkillEnvironmentManager";

/**
 * Filesystem layout helpers for installed plugins.
 * Source of truth: Design §8.1, §19.1.
 *
 * Plugin-owned skill files live UNDER the plugin install root (not under
 * userData/installed_skills/). Standalone skills continue to use
 * userData/installed_skills/<name>/.
 */

/** Top-level directory holding all installed plugins. */
export function getPluginsRoot(): string {
  const root = path.join(getElectronUserDataPath(), "plugins", "installed");
  return root;
}

/** Install directory for a single plugin by name. */
export function getPluginInstallRoot(pluginName: string): string {
  return path.join(getPluginsRoot(), pluginName);
}

/**
 * Install directory for a skill owned by a plugin.
 * Plugin-owned skills are nested under the plugin install root so that
 * uninstalling a plugin cleanly removes its skill files too.
 */
export function getPluginOwnedSkillRoot(
  pluginName: string,
  skillName: string
): string {
  return path.join(getPluginInstallRoot(pluginName), "skills", skillName);
}
