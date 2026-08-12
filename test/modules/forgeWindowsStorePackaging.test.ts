import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";

interface ForgeMaker {
  name: string;
  config?: {
    sign?: boolean;
    manifestVariables?: Record<string, string>;
  };
}

interface ForgeConfig {
  makers: ForgeMaker[];
}

interface ForgeConfigModule {
  default?: ForgeConfig;
  makers?: ForgeMaker[];
}

const forgeConfigPath = path.resolve(__dirname, "../../forge.config.js");
const releaseWorkflowPath = path.resolve(
  __dirname,
  "../../.github/workflows/release.yml"
);

describe("Windows Store packaging", (): void => {
  const originalEnvironment = { ...process.env };

  afterEach((): void => {
    process.env = { ...originalEnvironment };
  });

  it("creates an unsigned MSIX with the Partner Center identity", async (): Promise<void> => {
    process.env.NODE_ENV = "production";
    process.env.WINDOWS_DISTRIBUTION = "store";
    process.env.WINDOWS_STORE_PACKAGE_IDENTITY = "12345RobertZeng.AiFetchly";
    process.env.WINDOWS_STORE_PUBLISHER = "CN=STORE-PUBLISHER-ID";
    process.env.WINDOWS_STORE_PUBLISHER_DISPLAY_NAME = "Robert Zeng";
    process.env.APPLE_ID = "store-test@example.com";
    process.env.APPLE_APP_SPECIFIC_PASSWORD = "test-password";
    process.env.APPLE_TEAM_ID = "TESTTEAMID";

    const importedConfig = (await import(forgeConfigPath)) as ForgeConfigModule;
    const config: ForgeConfig = importedConfig.default ?? {
      makers: importedConfig.makers ?? [],
    };
    const maker = config.makers.find(
      (candidate: ForgeMaker): boolean =>
        candidate.name === "@electron-forge/maker-msix"
    );

    expect(maker).to.not.equal(undefined);
    expect(maker?.config?.sign).to.equal(false);
    expect(maker?.config?.manifestVariables).to.include({
      packageIdentity: "12345RobertZeng.AiFetchly",
      publisher: "CN=STORE-PUBLISHER-ID",
      publisherDisplayName: "Robert Zeng",
    });
  });

  it("routes master builds through the Store package path", (): void => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).to.include("github.event_name == 'push' && 'store'");
    expect(workflow).to.include("WINDOWS_STORE_PACKAGE_IDENTITY");
    expect(workflow).to.include("yarn make-win:store");
    expect(workflow).to.include("out/make/**/*.msix");
    expect(workflow).to.include(
      "- name: Restore Windows signing certificate\n        if: ${{ env.BUILD_MODE == 'production' }}"
    );
    expect(workflow).to.include(
      "if: ${{ github.event_name == 'workflow_dispatch' && inputs.build_mode == 'production' }}"
    );
  });
});
