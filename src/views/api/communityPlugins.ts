import { windowInvoke } from "@/views/utils/apirequest";
import {
  PLUGIN_COMMUNITY_DETAIL,
  PLUGIN_COMMUNITY_INSTALL,
  PLUGIN_COMMUNITY_LIST,
  PLUGIN_COMMUNITY_OPEN_PLANS,
} from "@/config/channellist";
import type {
  PluginCommunityDetail,
  PluginCommunityEntry,
  PluginCommunityFilter,
} from "@/entityTypes/communityPluginTypes";
import type { PluginSummary } from "@/entityTypes/pluginTypes";

/**
 * Renderer API client for the Community Plugins page.
 * Source of truth: Community Plugin Page PRD §7.5.
 *
 * All calls go through the NON-AI-gated PLUGIN_COMMUNITY_* IPC channels;
 * the renderer never talks to the Plugin Hub directly and never sees the
 * marketing JWT — only already-unwrapped catalog entries.
 */

export async function listCommunityPlugins(
  filter: PluginCommunityFilter = {}
): Promise<PluginCommunityEntry[] | null> {
  return await windowInvoke(PLUGIN_COMMUNITY_LIST, filter);
}

export async function getCommunityPluginDetail(
  slug: string
): Promise<PluginCommunityDetail | null> {
  return await windowInvoke(PLUGIN_COMMUNITY_DETAIL, { slug });
}

/** Installs a free/public plugin; rejects locked (ticket) plugins. */
export async function installCommunityPlugin(
  slug: string
): Promise<PluginSummary | null> {
  return await windowInvoke(PLUGIN_COMMUNITY_INSTALL, { slug });
}

/** Opens the marketing plans page in the default browser (Upgrade CTA). */
export async function openCommunityPlansPage(): Promise<void> {
  await windowInvoke(PLUGIN_COMMUNITY_OPEN_PLANS);
}
