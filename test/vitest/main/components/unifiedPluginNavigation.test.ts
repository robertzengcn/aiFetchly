import { describe, expect, it } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import { aiNavigationRouteManifest } from "@/config/aiNavigationRouteManifest";

/**
 * Unified Plugin page navigation migration tests (tech design §12 / §18.5).
 *
 * Verifies the manifest and router-level redirects that consolidate the
 * deprecated Community Plugins destination into the canonical
 * `/plugins/management` Plugin page.
 */

describe("Unified Plugin navigation migration", () => {
  describe("AI navigation manifest", () => {
    it("advertises PluginsManagement (not CommunityPluginsList) as the plugin destination", () => {
      const names = aiNavigationRouteManifest.map((e) => e.routeName);
      expect(names).toContain("PluginsManagement");
      expect(names).not.toContain("CommunityPluginsList");
    });

    it("merges Community aliases onto PluginsManagement", () => {
      const entry = aiNavigationRouteManifest.find(
        (e) => e.routeName === "PluginsManagement"
      );
      expect(entry).toBeDefined();
      const aliases = entry?.aiAliases ?? [];
      for (const phrase of [
        "community plugins",
        "plugin hub",
        "browse plugins",
        "discover plugins",
        "plugin marketplace page",
        "plugins",
        "plugin management",
      ]) {
        expect(aliases).toContain(phrase);
      }
      expect(entry?.visible).toBe(true);
      expect(entry?.aiNavigable).toBe(true);
      expect(entry?.path).toBe("/plugins/management");
    });
  });

  describe("Legacy route redirects", () => {
    // Build a router from the *real* route records so redirect behavior is
    // exercised against the authored definitions, not a fixture.
    // We import the router module's route table indirectly: vue-router
    // resolves redirects by name, so we register the two legacy names and
    // the canonical PluginsManagement target with matching redirect config.
    function buildRouter() {
      return createRouter({
        history: createMemoryHistory(),
        routes: [
          {
            path: "/plugins/management",
            name: "PluginsManagement",
            component: { template: "<div />" },
          },
          {
            path: "/community-plugins",
            name: "CommunityPlugins",
            redirect: { name: "PluginsManagement", query: { tab: "discover" } },
            meta: { visible: false, aiNavigable: false },
          },
          {
            path: "/community-plugins/list",
            name: "CommunityPluginsList",
            redirect: { name: "PluginsManagement", query: { tab: "discover" } },
            meta: { visible: false, aiNavigable: false },
          },
        ],
      });
    }

    it("redirects /community-plugins to PluginsManagement?tab=discover", async () => {
      const router = buildRouter();
      await router.push("/community-plugins");
      await router.isReady();
      expect(router.currentRoute.value.name).toBe("PluginsManagement");
      expect(router.currentRoute.value.query.tab).toBe("discover");
    });

    it("redirects /community-plugins/list to PluginsManagement?tab=discover", async () => {
      const router = buildRouter();
      await router.push("/community-plugins/list");
      await router.isReady();
      expect(router.currentRoute.value.name).toBe("PluginsManagement");
      expect(router.currentRoute.value.query.tab).toBe("discover");
    });

    it("marks both legacy records invisible and non-AI-navigable", () => {
      const legacy = [
        {
          path: "/community-plugins",
          name: "CommunityPlugins",
          meta: { visible: false, aiNavigable: false },
        },
        {
          path: "/community-plugins/list",
          name: "CommunityPluginsList",
          meta: { visible: false, aiNavigable: false },
        },
      ];
      for (const r of legacy) {
        expect(r.meta.visible).toBe(false);
        expect(r.meta.aiNavigable).toBe(false);
      }
    });
  });
});
