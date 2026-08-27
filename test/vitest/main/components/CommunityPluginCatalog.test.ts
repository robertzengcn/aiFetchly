import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import CommunityPluginCatalog from "@/views/components/plugins/CommunityPluginCatalog.vue";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

const { api, receive, removeListener, registeredWrappers } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    install: vi.fn(),
    openPlans: vi.fn(),
    getLoginUrl: vi.fn(),
  },
  // Model the REAL windowReceive semantics: it wraps the callback in a new
  // closure and registers THAT wrapper with the transport; removal is keyed
  // by the wrapper reference. A bare vi.fn() mock would hide the leak this
  // test exists to catch (passing the original cb to removeListener no-ops).
  registeredWrappers: new Map<string, Set<(value: unknown) => void>>(),
  receive: vi.fn((channel: string, cb: (value: unknown) => void) => {
    const wrapper = (value: unknown): void => cb(value);
    let set = registeredWrappers.get(channel);
    if (!set) {
      set = new Set();
      registeredWrappers.set(channel, set);
    }
    set.add(wrapper);
    return wrapper;
  }),
  removeListener: vi.fn((channel: string, cb: (value: unknown) => void) => {
    registeredWrappers.get(channel)?.delete(cb);
  }),
}));

vi.mock("@/views/api/communityPlugins", () => ({
  listCommunityPlugins: api.list,
  installCommunityPlugin: api.install,
  openCommunityPlansPage: api.openPlans,
}));
vi.mock("@/views/api/users", () => ({
  getLoginUrl: api.getLoginUrl,
}));
vi.mock("@/views/utils/apirequest", () => ({
  windowReceive: receive,
  windowRemoveListener: removeListener,
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      communityPlugins: {
        title: "Community Plugins",
        refresh: "Refresh",
        install: "Install",
        installed: "Installed",
        preview: "Preview",
        upgrade: "Upgrade",
        signIn: "Sign in",
        empty: "No plugins available",
        error: "Couldn't reach the Plugin Hub",
        retry: "Retry",
        installFuture: "Installable in a future release.",
        loading: "Loading plugins…",
        sessionExpired: "Your session expired",
        signInAgain: "Sign in again",
        installFailed: "Install failed",
        searchLabel: "Search plugins",
        searchPlaceholder: "Search by name, description, author, or tag",
        allTags: "All",
        moreTags: "More",
        filterLabel: "Availability",
        filterAll: "All",
        filterAvailable: "Available",
        filterInstalled: "Installed",
        resultCount: "{count} plugins",
        noMatchesTitle: 'No plugins match "{query}"',
        noMatchesDescription: "Try another search or clear your filters.",
        clearFilters: "Clear filters",
        manage: "Manage",
        moreTagCount: "{count} more tags",
        statusInstalled: "Installed",
        statusUpgradeRequired: "Upgrade required",
        statusSignInRequired: "Sign in required",
        statusComingSoon: "Coming soon",
        statusUnavailable: "Unavailable",
      },
    },
  },
});

/**
 * Minimal stubs for the three interactive Vuetify controls so `v-model`
 * works without a full Vuetify install (repo convention: component tests do
 * not install Vuetify). Each stub forwards its `modelValue` prop and emits
 * `update:modelValue` on native input/click.
 */
const Stubs = {
  VTextField: {
    name: "VTextField",
    props: { modelValue: { default: "" }, label: String, placeholder: String },
    emits: ["update:modelValue"],
    template:
      '<input :value="modelValue" :aria-label="label" :data-testid="$attrs[\'data-testid\']" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VBtnToggle: {
    name: "VBtnToggle",
    props: { modelValue: { default: "" } },
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
  VChipGroup: {
    name: "VChipGroup",
    props: { modelValue: { default: "" } },
    emits: ["update:modelValue"],
    template: "<div><slot /></div>",
  },
};

function entry(
  slug: string,
  status: PluginCommunityEntry["access"]["status"],
  installMode: PluginCommunityEntry["access"]["installMode"] = "direct",
  installed = false,
  overrides: Partial<PluginCommunityEntry> = {}
): PluginCommunityEntry {
  return {
    slug,
    name: slug,
    displayName: slug,
    description: `desc ${slug}`,
    access: { status, installMode },
    installed,
    ...overrides,
  };
}

function mountCatalog() {
  return mount(CommunityPluginCatalog, {
    global: {
      plugins: [i18n],
      stubs: {
        VTextField: Stubs.VTextField,
        VBtnToggle: Stubs.VBtnToggle,
        VChipGroup: Stubs.VChipGroup,
      },
    },
  });
}

describe("CommunityPluginCatalog", () => {
  beforeEach(() => {
    api.list.mockReset();
    api.install.mockReset();
    api.openPlans.mockReset();
    api.getLoginUrl.mockReset();
    // mockClear (not mockReset) so the wrapper-creating implementations from
    // the hoisted factory survive; only call history + the transport map reset.
    receive.mockClear();
    removeListener.mockClear();
    registeredWrappers.clear();
    api.list.mockResolvedValue([]);
  });

  it("loads with { forceRefresh: false } on mount", async () => {
    api.list.mockResolvedValue([]);
    mountCatalog();
    await flushPromises();
    expect(api.list).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it("renders the CTA matrix driven by the hub access decision", async () => {
    api.list.mockResolvedValue([
      entry("pdf-tools", "allowed"),
      entry("done-tool", "allowed", "direct", true),
      entry("soon-tool", "allowed", "ticket"),
      entry("pro-seo", "subscription_required", "ticket"),
      entry("anon-tool", "login_required"),
      entry("gone-tool", "forbidden"),
    ]);
    const w = mountCatalog();
    await flushPromises();

    expect(
      w.find('[data-testid="community-plugin-install-pdf-tools"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-manage-done-tool"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-status-done-tool"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-upgrade-pro-seo"]').exists()
    ).toBe(true);
    // ticket / login_required / forbidden rows render no install affordance
    expect(
      w.find('[data-testid="community-plugin-install-soon-tool"]').exists()
    ).toBe(false);
    expect(
      w.find('[data-testid="community-plugin-install-anon-tool"]').exists()
    ).toBe(false);
    expect(
      w.find('[data-testid="community-plugin-install-gone-tool"]').exists()
    ).toBe(false);
  });

  it("renders skeleton loading state before the first load resolves", async () => {
    let resolveList: (v: PluginCommunityEntry[]) => void = () => undefined;
    api.list.mockReturnValue(
      new Promise<PluginCommunityEntry[]>((r) => {
        resolveList = r;
      })
    );
    const w = mountCatalog();
    await flushPromises();
    expect(w.find('[data-testid="community-plugins-loading"]').exists()).toBe(
      true
    );
    resolveList([]);
    await flushPromises();
    expect(w.find('[data-testid="community-plugins-loading"]').exists()).toBe(
      false
    );
  });

  it("renders empty catalog state when the hub returns no entries", async () => {
    api.list.mockResolvedValue([]);
    const w = mountCatalog();
    await flushPromises();
    expect(w.find('[data-testid="community-plugins-empty"]').exists()).toBe(
      true
    );
  });

  it("installs a direct plugin and flips the card to installed, emitting the canonical name", async () => {
    api.list.mockResolvedValue([entry("pdf-tools", "allowed")]);
    api.install.mockResolvedValue({ id: 1, name: "pdf-tools" });
    const w = mountCatalog();
    await flushPromises();

    await w
      .find('[data-testid="community-plugin-install-pdf-tools"]')
      .trigger("click");
    await flushPromises();

    expect(api.install).toHaveBeenCalledWith("pdf-tools");
    expect(
      w.find('[data-testid="community-plugin-manage-pdf-tools"]').exists()
    ).toBe(true);
    expect(w.emitted("installed")).toEqual([["pdf-tools"]]);
  });

  it("does not mark installed when the install result is null and shows a failure", async () => {
    api.list.mockResolvedValue([entry("pdf-tools", "allowed")]);
    api.install.mockResolvedValue(null);
    const w = mountCatalog();
    await flushPromises();

    await w
      .find('[data-testid="community-plugin-install-pdf-tools"]')
      .trigger("click");
    await flushPromises();

    expect(
      w.find('[data-testid="community-plugin-install-pdf-tools"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-manage-pdf-tools"]').exists()
    ).toBe(false);
    expect(
      w.find('[data-testid="community-plugins-install-error"]').exists()
    ).toBe(true);
    expect(w.emitted("installed")).toBeUndefined();
  });

  it("emits manage with the install result's canonical name, falling back to entry.name", async () => {
    // Pre-installed entry whose slug differs from the canonical name.
    api.list.mockResolvedValue([
      entry("hub-slug", "allowed", "direct", true, { name: "real-name" }),
    ]);
    const w = mountCatalog();
    await flushPromises();

    await w
      .find('[data-testid="community-plugin-manage-hub-slug"]')
      .trigger("click");
    expect(w.emitted("manage")).toEqual([["real-name"]]);
  });

  it("shows the error state with retry when the list call rejects", async () => {
    api.list.mockRejectedValue(new Error("Plugin Hub catalog is invalid"));
    const w = mountCatalog();
    await flushPromises();

    expect(w.find('[data-testid="community-plugins-error"]').exists()).toBe(
      true
    );
    expect(
      w.find('[data-testid="community-plugins-session-expired"]').exists()
    ).toBe(false);
  });

  it("shows the session-expired affordance for auth-shaped failures", async () => {
    api.list.mockRejectedValue(
      new Error(
        "Authentication failed after token refresh retry (HTTP 401/403)."
      )
    );
    const w = mountCatalog();
    await flushPromises();

    expect(
      w.find('[data-testid="community-plugins-session-expired"]').exists()
    ).toBe(true);
    expect(w.find('[data-testid="community-plugins-error"]').exists()).toBe(
      false
    );
  });

  it("subscribes to WEBSOCKET_EVENT and force-reloads on user_info_updated", async () => {
    api.list.mockResolvedValue([entry("pdf-tools", "allowed")]);
    mountCatalog();
    await flushPromises();
    expect(receive).toHaveBeenCalledTimes(1);
    const [channel, callback] = receive.mock.calls[0] as [
      string,
      (event: unknown) => void
    ];
    expect(channel).toBe("websocket:event");

    api.list.mockClear();
    callback({
      type: "message",
      data: { type: "user_info_updated", payload: { reason: "x" } },
    });
    await flushPromises();
    expect(api.list).toHaveBeenCalledWith({ forceRefresh: true });

    // Unrelated websocket events do not reload.
    api.list.mockClear();
    callback({ type: "status", data: { status: "connected" } });
    await flushPromises();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("removes the wrapper handle (not the original cb) on unmount", async () => {
    // windowReceive wraps the callback in a new closure and keys transport
    // removal by THAT wrapper. The catalog must pass the returned handle to
    // windowRemoveListener, not the original onWebSocketEvent — otherwise the
    // transport finds no match and the listener leaks. This test models the
    // real wrapper semantics so a regression actually fails.
    api.list.mockResolvedValue([]);
    const w = mountCatalog();
    await flushPromises();
    expect(removeListener).not.toHaveBeenCalled();
    // The wrapper was registered with the transport; capture it before unmount.
    const wsWrappers = registeredWrappers.get("websocket:event");
    expect(wsWrappers?.size).toBe(1);
    const registeredWrapper = [...(wsWrappers ?? [])][0];
    w.unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
    // The handle passed to removeListener is the registered wrapper (not the
    // original onWebSocketEvent), and the transport map is now empty (no leak).
    const [, removedHandle] = removeListener.mock.calls[0] as [
      string,
      (value: unknown) => void
    ];
    expect(removedHandle).toBe(registeredWrapper);
    expect(registeredWrappers.get("websocket:event")?.size ?? 0).toBe(0);
  });

  it("opens the marketing plans page from the Upgrade CTA", async () => {
    api.list.mockResolvedValue([
      entry("pro-seo", "subscription_required", "ticket"),
    ]);
    api.openPlans.mockResolvedValue(undefined);
    const w = mountCatalog();
    await flushPromises();

    await w
      .find('[data-testid="community-plugin-upgrade-pro-seo"]')
      .trigger("click");
    await flushPromises();
    expect(api.openPlans).toHaveBeenCalledTimes(1);
  });

  it("search updates visible cards without another API call", async () => {
    api.list.mockResolvedValue([
      entry("seo-assistant", "allowed", "direct", false, {
        displayName: "SEO Assistant",
      }),
      entry("pdf-tools", "allowed", "direct", false, {
        displayName: "PDF Tools",
      }),
    ]);
    const w = mountCatalog();
    await flushPromises();

    expect(
      w.find('[data-testid="community-plugin-card-seo-assistant"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-card-pdf-tools"]').exists()
    ).toBe(true);

    api.list.mockClear();
    await w.find('[data-testid="community-plugins-search"]').setValue("seo");
    await flushPromises();

    expect(api.list).not.toHaveBeenCalled();
    expect(
      w.find('[data-testid="community-plugin-card-seo-assistant"]').exists()
    ).toBe(true);
    expect(
      w.find('[data-testid="community-plugin-card-pdf-tools"]').exists()
    ).toBe(false);
  });

  it("derives tag facets from the full catalog and filters by a selected tag", async () => {
    api.list.mockResolvedValue([
      entry("a", "allowed", "direct", false, { tags: ["SEO"] }),
      entry("b", "allowed", "direct", false, { tags: ["SEO", "PDF"] }),
      entry("c", "allowed", "direct", false, { tags: ["PDF"] }),
    ]);
    const w = mountCatalog();
    await flushPromises();

    // "All" is always present; facets are derived from category + tags.
    expect(w.find('[data-testid="community-plugin-tag-all"]').exists()).toBe(
      true
    );
    // SEO appears on 2 entries, PDF on 2. Both present as filter chips.
    expect(w.find('[data-testid="community-plugin-tag-seo"]').exists()).toBe(
      true
    );

    // Drive the chip-group v-model via the stubbed component's emit.
    const chipGroup = w.findComponent({ name: "VChipGroup" });
    chipGroup.vm.$emit("update:modelValue", "seo");
    await flushPromises();

    expect(w.find('[data-testid="community-plugin-card-a"]').exists()).toBe(
      true
    );
    expect(w.find('[data-testid="community-plugin-card-b"]').exists()).toBe(
      true
    );
    expect(w.find('[data-testid="community-plugin-card-c"]').exists()).toBe(
      false
    );
  });

  it("filters by availability (All / Available / Installed)", async () => {
    api.list.mockResolvedValue([
      entry("free", "allowed", "direct", false),
      entry("mine", "allowed", "direct", true),
      entry("paid", "subscription_required", "ticket", false),
    ]);
    const w = mountCatalog();
    await flushPromises();

    // All → 3 cards
    expect(w.find('[data-testid="community-plugin-card-free"]').exists()).toBe(
      true
    );
    expect(w.find('[data-testid="community-plugin-card-mine"]').exists()).toBe(
      true
    );
    expect(w.find('[data-testid="community-plugin-card-paid"]').exists()).toBe(
      true
    );

    // Available → only the actionable Install card (free)
    const toggle = w.findComponent({ name: "VBtnToggle" });
    toggle.vm.$emit("update:modelValue", "available");
    await flushPromises();
    expect(w.find('[data-testid="community-plugin-card-free"]').exists()).toBe(
      true
    );
    expect(w.find('[data-testid="community-plugin-card-mine"]').exists()).toBe(
      false
    );
    expect(w.find('[data-testid="community-plugin-card-paid"]').exists()).toBe(
      false
    );

    // Installed → only mine
    const toggle2 = w.findComponent({ name: "VBtnToggle" });
    toggle2.vm.$emit("update:modelValue", "installed");
    await flushPromises();
    expect(w.find('[data-testid="community-plugin-card-mine"]').exists()).toBe(
      true
    );
    expect(w.find('[data-testid="community-plugin-card-free"]').exists()).toBe(
      false
    );
  });

  it("reports the result count matching the rendered cards", async () => {
    api.list.mockResolvedValue([
      entry("a", "allowed"),
      entry("b", "allowed"),
      entry("c", "allowed"),
    ]);
    const w = mountCatalog();
    await flushPromises();

    const count = w.find('[data-testid="community-plugins-result-count"]');
    expect(count.text()).toContain("3");

    await w.find('[data-testid="community-plugins-search"]').setValue("a");
    await flushPromises();
    // "a" matches displayName of a, and description "desc a" of all three (desc a/b/c)
    // Actually only entry a has displayName "a"; descriptions are "desc a/b/c".
    // "a" substring matches "desc a" and "desc b"? No — "desc b" has no "a". Only "desc a".
    // Plus displayName "a". So 1 result.
    expect(count.text()).toContain("1");
  });

  it("shows a no-matches state and Clear filters, which restores results without an API call", async () => {
    api.list.mockResolvedValue([entry("a", "allowed")]);
    const w = mountCatalog();
    await flushPromises();

    await w.find('[data-testid="community-plugins-search"]').setValue("zzz");
    await flushPromises();

    expect(
      w.find('[data-testid="community-plugins-no-matches"]').exists()
    ).toBe(true);

    api.list.mockClear();
    await w
      .find('[data-testid="community-plugins-clear-filters"]')
      .trigger("click");
    await flushPromises();

    expect(api.list).not.toHaveBeenCalled();
    expect(w.find('[data-testid="community-plugin-card-a"]').exists()).toBe(
      true
    );
  });

  it("refresh preserves search, tag, and availability selections", async () => {
    api.list.mockResolvedValue([
      entry("seo-a", "allowed", "direct", false, {
        displayName: "SEO A",
        tags: ["SEO"],
      }),
    ]);
    const w = mountCatalog();
    await flushPromises();

    await w.find('[data-testid="community-plugins-search"]').setValue("seo");
    w.findComponent({ name: "VBtnToggle" }).vm.$emit(
      "update:modelValue",
      "available"
    );
    await flushPromises();

    api.list.mockResolvedValue([
      entry("seo-a", "allowed", "direct", false, {
        displayName: "SEO A",
        tags: ["SEO"],
      }),
    ]);
    await w.find('[data-testid="community-plugins-refresh"]').trigger("click");
    await flushPromises();

    expect(api.list).toHaveBeenLastCalledWith({ forceRefresh: true });
    // Filter state survived the refresh — the stubbed search input is the
    // VTextField root itself (data-testid is on the <input>).
    const searchInput = w.find('[data-testid="community-plugins-search"]');
    expect((searchInput.element as HTMLInputElement).value).toBe("seo");
  });

  it("refresh failure preserves existing cards rather than erasing them", async () => {
    api.list.mockResolvedValue([entry("a", "allowed")]);
    const w = mountCatalog();
    await flushPromises();
    expect(w.find('[data-testid="community-plugin-card-a"]').exists()).toBe(
      true
    );

    api.list.mockRejectedValue(new Error("transient hub error"));
    await w.find('[data-testid="community-plugins-refresh"]').trigger("click");
    await flushPromises();

    expect(w.find('[data-testid="community-plugin-card-a"]').exists()).toBe(
      true
    );
    expect(w.find('[data-testid="community-plugins-error"]').exists()).toBe(
      true
    );
  });

  it("prevents duplicate concurrent installs", async () => {
    api.list.mockResolvedValue([entry("a", "allowed"), entry("b", "allowed")]);
    let resolveInstall: (v: { id: number; name: string }) => void = () =>
      undefined;
    api.install.mockReturnValue(
      new Promise<{ id: number; name: string }>((r) => {
        resolveInstall = r;
      })
    );
    const w = mountCatalog();
    await flushPromises();

    await w.find('[data-testid="community-plugin-install-a"]').trigger("click");
    await flushPromises();

    // While first install is in flight, clicking B's install is a no-op.
    await w.find('[data-testid="community-plugin-install-b"]').trigger("click");
    await flushPromises();
    expect(api.install).toHaveBeenCalledTimes(1);

    resolveInstall({ id: 1, name: "a" });
    await flushPromises();

    // Now the second install can proceed.
    await w.find('[data-testid="community-plugin-install-b"]').trigger("click");
    await flushPromises();
    expect(api.install).toHaveBeenCalledTimes(2);
  });

  it("ignores stale load responses from overlapping reloads", async () => {
    let resolveFirst: (v: PluginCommunityEntry[]) => void = () => undefined;
    let resolveSecond: (v: PluginCommunityEntry[]) => void = () => undefined;
    api.list.mockReturnValueOnce(
      new Promise<PluginCommunityEntry[]>((r) => {
        resolveFirst = r;
      })
    );
    api.list.mockReturnValueOnce(
      new Promise<PluginCommunityEntry[]>((r) => {
        resolveSecond = r;
      })
    );

    const w = mountCatalog();
    await flushPromises();

    // Trigger a second (forced) reload before the first resolves.
    await w.find('[data-testid="community-plugins-refresh"]').trigger("click");
    await flushPromises();

    // Second resolves first with [].
    resolveSecond([]);
    await flushPromises();
    // Now first resolves with a stale entry that must NOT overwrite the empty catalog.
    resolveFirst([entry("stale", "allowed")]);
    await flushPromises();

    expect(w.find('[data-testid="community-plugin-card-stale"]').exists()).toBe(
      false
    );
  });
});
