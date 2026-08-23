import { expect } from "chai";
import packagingHangGuard from "../../scripts/run-packaging-with-hang-guard.js";

interface PackagingHangGuardModule {
  hasCompletedPostPackageHook(output: string): boolean;
}

const guard = packagingHangGuard as PackagingHangGuardModule;

describe("packaging hang guard", (): void => {
  it("waits for postPackage to complete instead of reacting when it starts", (): void => {
    expect(
      guard.hasCompletedPostPackageHook("❯ Running postPackage hook")
    ).to.equal(false);
    expect(
      guard.hasCompletedPostPackageHook(
        "\u001b[32m✔\u001b[39m Running postPackage hook"
      )
    ).to.equal(true);
  });
});
