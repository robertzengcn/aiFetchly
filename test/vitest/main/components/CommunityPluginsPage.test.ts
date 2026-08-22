import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import CommunityPluginsPage from "@/views/pages/communityPlugins/index.vue";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

// vi.mock factories are hoisted; vi.hoisted shares the handles with tests.
const { api, receive, removeListener } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    install: vi.fn(),
    openPlans: vi.fn(),
    getLoginUrl: vi.fn(),
  },
  receive: vi.fn(),
  removeListener: vi.fn(),
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
  messages: { en: { communityPlugins: {} } },
});

function entry(
  slug: string,
  status: PluginCommunityEntry["access"]["status"],
  installMode: PluginCommunityEntry["access"]["installMode"] = "direct",
  installed = false
): PluginCommunityEntry {
  return {
    slug,
    name: slug,
    displayName: slug,
    description: `desc ${slug}`,
    access: { status, installMode },
    installed,
  };
}

function mountPage() {
  return mount(CommunityPluginsPage, {
    global: { plugins: [i18n] },
  });
}

describe("CommunityPluginsPage", () => {
  beforeEach(() => {
    api.list.mockReset();
    api.install.mockReset();
    api.openPlans.mockReset();
    api.getLoginUrl.mockReset();
    receive.mockReset();
    removeListener.mockReset();
    api.list.mockResolvedValue([]);
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
    const w = mountPage();
    await flushPromises();

    expect(w.find('[data-testid="community-plugin-install-pdf-tools"]').exists()).toBe(true);
    expect(w.find('[data-testid="community-plugin-installed-done-tool"]').exists()).toBe(true);
    expect(w.find('[data-testid="community-plugin-upgrade-pro-seo"]').exists()).toBe(true);
    // ticket / login_required / forbidden rows render no install affordance
    expect(w.find('[data-testid="community-plugin-install-soon-tool"]').exists()).toBe(false);
    expect(w.find('[data-testid="community-plugin-install-anon-tool"]').exists()).toBe(false);
    expect(w.find('[data-testid="community-plugin-install-gone-tool"]').exists()).toBe(false);
  });

  it("installs a direct plugin and flips the card to installed", async () => {
    api.list.mockResolvedValue([entry("pdf-tools", "allowed")]);
    api.install.mockResolvedValue({ id: 1, name: "pdf-tools" });
    const w = mountPage();
    await flushPromises();

    await w.find('[data-testid="community-plugin-install-pdf-tools"]').trigger("click");
    await flushPromises();

    expect(api.install).toHaveBeenCalledWith("pdf-tools");
    expect(w.find('[data-testid="community-plugin-installed-pdf-tools"]').exists()).toBe(true);
  });

  it("shows the error state with retry when the list call rejects", async () => {
    api.list.mockRejectedValue(new Error("Plugin Hub catalog is invalid"));
    const w = mountPage();
    await flushPromises();

    expect(w.find('[data-testid="community-plugins-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="community-plugins-session-expired"]').exists()).toBe(false);
  });

  it("shows the session-expired affordance for auth-shaped failures", async () => {
    api.list.mockRejectedValue(
      new Error("Authentication failed after token refresh retry (HTTP 401/403).")
    );
    const w = mountPage();
    await flushPromises();

    expect(w.find('[data-testid="community-plugins-session-expired"]').exists()).toBe(true);
    expect(w.find('[data-testid="community-plugins-error"]').exists()).toBe(false);
  });

  it("subscribes to WEBSOCKET_EVENT and force-reloads on user_info_updated", async () => {
    api.list.mockResolvedValue([entry("pdf-tools", "allowed")]);
    mountPage();
    await flushPromises();
    expect(receive).toHaveBeenCalledTimes(1);
    const [channel, callback] = receive.mock.calls[0] as [
      string,
      (event: unknown) => void,
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

  it("opens the marketing plans page from the Upgrade CTA", async () => {
    api.list.mockResolvedValue([entry("pro-seo", "subscription_required", "ticket")]);
    api.openPlans.mockResolvedValue(undefined);
    const w = mountPage();
    await flushPromises();

    await w.find('[data-testid="community-plugin-upgrade-pro-seo"]').trigger("click");
    await flushPromises();
    expect(api.openPlans).toHaveBeenCalledTimes(1);
  });
});
