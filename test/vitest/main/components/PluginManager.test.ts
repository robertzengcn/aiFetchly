import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import PluginManager from "@/views/components/plugins/PluginManager.vue";

const { api } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    toggle: vi.fn(),
    uninstall: vi.fn(),
    reload: vi.fn(),
  },
}));

vi.mock("@/views/api/plugins", () => ({
  listPlugins: api.list,
  togglePlugin: api.toggle,
  uninstallPlugin: api.uninstall,
  reloadPlugins: api.reload,
  // type-only import is erased at runtime; provide a value too.
  __esModule: true,
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel" },
      plugins: {
        title: "Plugins",
        uninstall_button: "Uninstall",
        uninstall_confirm: "Uninstall this plugin?",
        tabs: {
          discover: "Discover",
          installed: "Installed",
          sources: "Sources",
          issues: "Issues",
        },
        sources: { browse: "Browse sources", manage: "Manage sources" },
      },
    },
  },
});

const PluginInstalledTabStub = {
  name: "PluginInstalledTab",
  emits: [
    "reload",
    "import",
    "install-source",
    "select",
    "toggle",
    "uninstall",
  ],
  template: '<div data-testid="stub-installed"></div>',
};
const CommunityPluginCatalogStub = {
  name: "CommunityPluginCatalog",
  emits: ["installed", "manage"],
  setup(_props: unknown, { emit }: { emit: (e: string, v: unknown) => void }) {
    function emitInstalled(name: string): void {
      emit("installed", name);
    }
    function emitManage(name: string): void {
      emit("manage", name);
    }
    function reload(): Promise<void> {
      return Promise.resolve();
    }
    return { emitInstalled, emitManage, reload };
  },
  template: '<div data-testid="stub-catalog"></div>',
};
const PluginSourcesTabStub = {
  name: "PluginSourcesTab",
  setup() {
    function reloadBrowse(): Promise<void> {
      return Promise.resolve();
    }
    return { reloadBrowse };
  },
  template: '<div data-testid="stub-sources"></div>',
};
const PluginMarketplaceErrorsTabStub = {
  name: "PluginMarketplaceErrorsTab",
  template: '<div data-testid="stub-errors"></div>',
};
const PluginDetailPanelStub = {
  name: "PluginDetailPanel",
  props: { name: String },
  emits: ["close"],
  template: '<div data-testid="stub-detail"></div>',
};
const PluginImportDialogStub = {
  name: "PluginImportDialog",
  emits: ["imported", "update:modelValue"],
  template: '<div data-testid="stub-import"></div>',
};
const PluginInstallSourceDialogStub = {
  name: "PluginInstallSourceDialog",
  emits: ["imported", "update:modelValue"],
  template: '<div data-testid="stub-install-source"></div>',
};

async function createTestRouter(
  initialPath = "/plugins/management"
): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/plugins/management",
        name: "PluginsManagement",
        component: { template: "<div />" },
      },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  return router;
}

function mountManager(router: Router) {
  return mount(PluginManager, {
    global: {
      plugins: [i18n, router],
      stubs: {
        PluginInstalledTab: PluginInstalledTabStub,
        CommunityPluginCatalog: CommunityPluginCatalogStub,
        PluginSourcesTab: PluginSourcesTabStub,
        PluginMarketplaceErrorsTab: PluginMarketplaceErrorsTabStub,
        PluginDetailPanel: PluginDetailPanelStub,
        PluginImportDialog: PluginImportDialogStub,
        PluginInstallSourceDialog: PluginInstallSourceDialogStub,
      },
    },
  });
}

describe("PluginManager", () => {
  beforeEach(() => {
    api.list.mockReset();
    api.toggle.mockReset();
    api.uninstall.mockReset();
    api.reload.mockReset();
    api.list.mockResolvedValue([]);
  });

  it("defaults to Discover when the query is missing", async () => {
    const router = await createTestRouter("/plugins/management");
    const w = mountManager(router);
    await flushPromises();
    expect(w.find('[data-testid="stub-catalog"]').exists()).toBe(true);
  });

  it("selects each top-level section from the query", async () => {
    for (const [query, stub] of [
      ["installed", "stub-installed"],
      ["sources", "stub-sources"],
      ["issues", "stub-errors"],
      ["discover", "stub-catalog"],
    ] as const) {
      const router = await createTestRouter(`/plugins/management?tab=${query}`);
      const w = mountManager(router);
      await flushPromises();
      expect(w.find(`[data-testid="${stub}"]`).exists()).toBe(true);
    }
  });

  it("renders the four tabs in order Discover, Installed, Sources, Issues", async () => {
    const router = await createTestRouter("/plugins/management");
    const w = mountManager(router);
    await flushPromises();
    // v-tab renders as an unresolved custom element (no Vuetify in tests).
    const tabs = w.findAll("v-tab");
    expect(tabs.length).toBe(4);
    expect(tabs[0].text()).toContain("Discover");
    expect(tabs[1].text()).toContain("Installed");
    expect(tabs[2].text()).toContain("Sources");
    expect(tabs[3].text()).toContain("Issues");
  });

  it("falls back to Discover for an invalid tab query", async () => {
    const router = await createTestRouter("/plugins/management?tab=bogus");
    const w = mountManager(router);
    await flushPromises();
    expect(w.find('[data-testid="stub-catalog"]').exists()).toBe(true);
  });

  it("reloads listPlugins on the Community installed event without switching tabs", async () => {
    api.list.mockClear();
    const router = await createTestRouter("/plugins/management?tab=discover");
    const w = mountManager(router);
    await flushPromises();
    api.list.mockClear();

    const catalog = w.findComponent({ name: "CommunityPluginCatalog" });
    catalog.vm.emitInstalled("some-plugin");
    await flushPromises();

    expect(api.list).toHaveBeenCalledTimes(1);
    // Still on Discover (no automatic tab switch).
    expect(w.find('[data-testid="stub-catalog"]').exists()).toBe(true);
  });

  it("switches to Installed and opens detail on the Community manage event", async () => {
    const router = await createTestRouter("/plugins/management?tab=discover");
    const w = mountManager(router);
    await flushPromises();

    const catalog = w.findComponent({ name: "CommunityPluginCatalog" });
    catalog.vm.emitManage("real-name");
    await flushPromises();

    expect(router.currentRoute.value.query.tab).toBe("installed");
    expect(w.find('[data-testid="stub-detail"]').exists()).toBe(true);
    expect(w.findComponent(PluginDetailPanelStub).props("name")).toBe(
      "real-name"
    );
  });

  it("preserves unrelated query keys when pushing a tab change", async () => {
    const router = await createTestRouter(
      "/plugins/management?tab=discover&foo=bar"
    );
    const w = mountManager(router);
    await flushPromises();

    // Trigger a user tab selection via the catalog manage event (switches to installed).
    w.findComponent({ name: "CommunityPluginCatalog" }).vm.emitManage("x");
    await flushPromises();

    expect(router.currentRoute.value.query.tab).toBe("installed");
    expect(router.currentRoute.value.query.foo).toBe("bar");
  });

  it("uninstall reloads Installed and calls catalog reload(false)", async () => {
    api.uninstall.mockResolvedValue(undefined);
    const router = await createTestRouter("/plugins/management?tab=installed");
    const w = mountManager(router);
    await flushPromises();
    api.list.mockClear();

    // The Installed stub emits uninstall(name); the confirm dialog opens.
    w.findComponent({ name: "PluginInstalledTab" }).vm.$emit(
      "uninstall",
      "gone"
    );
    await flushPromises();

    // Click the confirm dialog's Uninstall v-btn (custom element).
    const uninstallBtn = w
      .findAll("v-btn")
      .find((b) => b.text().includes("Uninstall"));
    expect(uninstallBtn).toBeDefined();
    await uninstallBtn!.trigger("click");
    await flushPromises();

    expect(api.uninstall).toHaveBeenCalledWith("gone");
    expect(api.list).toHaveBeenCalled();
  });
});
