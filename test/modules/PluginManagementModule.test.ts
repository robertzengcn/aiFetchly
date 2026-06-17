import { expect } from "chai";
import { PluginManagementModule } from "@/modules/PluginManagementModule";

/**
 * Tests for PluginManagementModule. Mirrors the test/modules/ Mocha pattern.
 * These tests require an initialized database connection (BaseModule falls back
 * to a temp directory when USERSDBPATH is unset).
 */
describe("PluginManagementModule", function () {
  this.timeout(15000);

  const TEST_PLUGIN = {
    name: "test-plugin-pmm",
    version: "1.0.0",
    description: "test plugin",
    installPath: "/tmp/test-plugin-pmm",
    manifestJson: JSON.stringify({ name: "test-plugin-pmm", version: "1.0.0" }),
    source: "local" as const,
  };

  afterEach(async () => {
    const mod = new PluginManagementModule();
    await mod.uninstallPlugin("test-plugin-pmm");
    await mod.uninstallPlugin("toggle-plugin-pmm");
    await mod.uninstallPlugin("update-plugin-pmm");
  });

  it("creates a plugin and retrieves it by name", async () => {
    const mod = new PluginManagementModule();
    const id = await mod.createPlugin(TEST_PLUGIN);
    expect(id).to.be.a("number");

    const found = await mod.getPluginByName("test-plugin-pmm");
    expect(found).to.not.equal(null);
    expect(found?.version).to.equal("1.0.0");
    expect(found?.enabled).to.equal(1);
    expect(found?.health).to.equal("healthy");
  });

  it("lists installed plugins", async () => {
    const mod = new PluginManagementModule();
    await mod.createPlugin(TEST_PLUGIN);
    const all = await mod.listInstalledPlugins();
    expect(all.some((p) => p.name === "test-plugin-pmm")).to.equal(true);
    const enabled = await mod.listEnabledPlugins();
    expect(enabled.some((p) => p.name === "test-plugin-pmm")).to.equal(true);
  });

  it("toggles plugin enabled state", async () => {
    const mod = new PluginManagementModule();
    await mod.createPlugin({
      name: "toggle-plugin-pmm",
      version: "1.0.0",
      description: "d",
      installPath: "/tmp",
      manifestJson: "{}",
      source: "local",
    });

    expect(await mod.togglePlugin("toggle-plugin-pmm", false)).to.equal(true);
    const disabled = await mod.getPluginByName("toggle-plugin-pmm");
    expect(disabled?.enabled).to.equal(0);
    expect(await mod.listEnabledPlugins()).to.satisfy(
      (arr: Array<{ name: string }>) =>
        !arr.some((p) => p.name === "toggle-plugin-pmm")
    );

    expect(await mod.togglePlugin("toggle-plugin-pmm", true)).to.equal(true);
    const reEnabled = await mod.getPluginByName("toggle-plugin-pmm");
    expect(reEnabled?.enabled).to.equal(1);
  });

  it("updates plugin state", async () => {
    const mod = new PluginManagementModule();
    await mod.createPlugin({
      name: "update-plugin-pmm",
      version: "1.0.0",
      description: "d",
      installPath: "/tmp",
      manifestJson: "{}",
      source: "local",
    });

    const ok = await mod.updatePluginState({
      name: "update-plugin-pmm",
      version: "2.0.0",
      description: "updated",
      health: "needs_configuration",
    });
    expect(ok).to.equal(true);

    const updated = await mod.getPluginByName("update-plugin-pmm");
    expect(updated?.version).to.equal("2.0.0");
    expect(updated?.description).to.equal("updated");
    expect(updated?.health).to.equal("needs_configuration");
  });

  it("persists load errors and component state", async () => {
    const mod = new PluginManagementModule();
    await mod.createPlugin(TEST_PLUGIN);

    const errs = await mod.setLoadErrors("test-plugin-pmm", [
      { code: "component-not-found", message: "missing skill", recoverable: true },
    ]);
    expect(errs).to.equal(true);

    const ok = await mod.updateComponentState("test-plugin-pmm", {
      skills: { "lead-enrichment": { enabled: true } },
    });
    expect(ok).to.equal(true);

    const found = await mod.getPluginByName("test-plugin-pmm");
    expect(found?.lastLoadErrorsJson).to.contain("component-not-found");
    expect(found?.componentStateJson).to.contain("lead-enrichment");
  });

  it("returns null for unknown plugin", async () => {
    const mod = new PluginManagementModule();
    expect(await mod.getPluginByName("does-not-exist-pmm")).to.equal(null);
  });

  it("uninstalls a plugin and returns a result", async () => {
    const mod = new PluginManagementModule();
    await mod.createPlugin(TEST_PLUGIN);

    const result = await mod.uninstallPlugin("test-plugin-pmm");
    expect(result.removedPlugin).to.equal(true);
    expect(await mod.getPluginByName("test-plugin-pmm")).to.equal(null);
  });
});
