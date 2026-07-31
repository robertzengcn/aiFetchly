import { expect } from "chai";
import { PluginMarketplaceModule } from "@/modules/PluginMarketplaceModule";

/**
 * Mirrors test/modules/PluginManagementModule.test.ts (Mocha pattern).
 * BaseModule falls back to a temp DB when USERSDBPATH is unset.
 */
describe("PluginMarketplaceModule", function () {
  this.timeout(15000);

  const NAME = "test-mkt-pmm";

  afterEach(async () => {
    const mod = new PluginMarketplaceModule();
    await mod.removeMarketplace(NAME);
    await mod.removeMarketplace("toggle-mkt-pmm");
  });

  it("creates a marketplace and finds it by name", async () => {
    const mod = new PluginMarketplaceModule();
    const id = await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/marketplace.json",
      manifestJson: JSON.stringify({ name: NAME, owner: { name: "Tester" }, plugins: [] }),
    });
    expect(id).to.be.a("number");

    const found = await mod.getMarketplaceByName(NAME);
    expect(found).to.not.equal(null);
    expect(found?.ownerName).to.equal("Tester");
    expect(found?.enabled).to.equal(1);
    expect(found?.health).to.equal("healthy");
  });

  it("lists enabled marketplaces", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    const enabled = await mod.listEnabledMarketplaces();
    expect(enabled.some((m) => m.name === NAME)).to.equal(true);
  });

  it("toggles enabled and health", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: "toggle-mkt-pmm",
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    expect(await mod.toggleMarketplace("toggle-mkt-pmm", false)).to.equal(true);
    const off = await mod.getMarketplaceByName("toggle-mkt-pmm");
    expect(off?.enabled).to.equal(0);
    expect(off?.health).to.equal("disabled");
  });

  it("persists structured errors and flips health", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    await mod.setMarketplaceErrors(NAME, [
      { code: "marketplace-schema-invalid", message: "bad", recoverable: false },
    ]);
    const found = await mod.getMarketplaceByName(NAME);
    expect(found?.lastErrorJson).to.contain("marketplace-schema-invalid");
    expect(found?.health).to.equal("invalid");
  });

  it("removes a marketplace", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    expect(await mod.removeMarketplace(NAME)).to.equal(true);
    expect(await mod.getMarketplaceByName(NAME)).to.equal(null);
  });
});
