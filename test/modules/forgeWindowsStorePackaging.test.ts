import { expect } from "chai";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

interface ForgeMaker {
  name: string;
  config?: {
    sign?: boolean;
    packageAssets?: string;
    windowsKitVersion?: string;
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

interface WorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface ReleaseWorkflow {
  jobs?: {
    "build-windows"?: {
      steps?: WorkflowStep[];
    };
    "build-macos"?: {
      if?: string;
    };
  };
}

const forgeConfigPath = path.resolve(__dirname, "../../forge.config.js");
const releaseWorkflowPath = path.resolve(
  __dirname,
  "../../.github/workflows/release.yml"
);
const windowsStoreAssetsPath = path.resolve(
  __dirname,
  "../../src/assets/windows-store/package"
);

const requiredWindowsStoreAssets = new Map<string, readonly [number, number]>([
  ["LockScreenLogo.scale-200.png", [48, 48]],
  ["SplashScreen.scale-200.png", [1240, 600]],
  ["Square150x150Logo.png", [150, 150]],
  ["Square150x150Logo.scale-200.png", [300, 300]],
  ["Square44x44Logo.png", [44, 44]],
  ["Square44x44Logo.scale-200.png", [88, 88]],
  ["Square44x44Logo.targetsize-24_altform-unplated.png", [24, 24]],
  ["Wide310x150Logo.scale-200.png", [620, 300]],
  ["icon.png", [50, 50]],
]);

const transparentWindowsStoreAssets = new Set<string>([
  "LockScreenLogo.scale-200.png",
  "Square44x44Logo.png",
  "Square44x44Logo.scale-200.png",
  "Square44x44Logo.targetsize-24_altform-unplated.png",
  "icon.png",
]);

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
    expect(maker?.config?.packageAssets).to.equal(windowsStoreAssetsPath);
    expect(maker?.config?.windowsKitVersion).to.equal("10.0.26100.0");
    expect(maker?.config?.manifestVariables).to.include({
      packageIdentity: "12345RobertZeng.AiFetchly",
      publisher: "CN=STORE-PUBLISHER-ID",
      publisherDisplayName: "Robert Zeng",
      packageMinOSVersion: "10.0.17763.0",
      packageMaxOSVersionTested: "10.0.26100.0",
    });
  });

  it("ships the complete branded Windows Store asset set", (): void => {
    expect(existsSync(windowsStoreAssetsPath)).to.equal(true);

    const assetNames = readdirSync(windowsStoreAssetsPath)
      .filter((fileName: string): boolean => fileName.endsWith(".png"))
      .sort();
    expect(assetNames).to.deep.equal(
      Array.from(requiredWindowsStoreAssets.keys()).sort()
    );

    for (const [assetName, [expectedWidth, expectedHeight]] of
      requiredWindowsStoreAssets) {
      const asset = readFileSync(path.join(windowsStoreAssetsPath, assetName));
      expect(asset.subarray(1, 4).toString("ascii"), assetName).to.equal("PNG");
      expect(asset.readUInt32BE(16), `${assetName} width`).to.equal(
        expectedWidth
      );
      expect(asset.readUInt32BE(20), `${assetName} height`).to.equal(
        expectedHeight
      );

      if (transparentWindowsStoreAssets.has(assetName)) {
        expect([4, 6], `${assetName} PNG color type`).to.include(asset[25]);
      }

      const defaultAssetPath = path.resolve(
        __dirname,
        "../../node_modules/electron-windows-msix/static/assets",
        assetName
      );
      if (existsSync(defaultAssetPath)) {
        expect(
          asset.equals(readFileSync(defaultAssetPath)),
          `${assetName} must not use the electron-windows-msix placeholder`
        ).to.equal(false);
      }
    }
  });

  it("routes master builds through the Store package path", (): void => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).to.include("github.event_name == 'push' && 'store'");
    expect(workflow).to.include("WINDOWS_STORE_PACKAGE_IDENTITY");
    expect(workflow).to.include("yarn make-win:store");
    expect(workflow).to.include("out/make/**/*.msix");
    // Windows signing is optional (forge.config.js resolveWindowsSignConfig()
    // signs only when cert.pfx + CERTIFICATE_PASSWORD are present). Master
    // pushes produce an unsigned MSIX that Partner Center re-signs, so the
    // workflow must NOT hard-require a certificate-restore step.
    expect(workflow).to.not.include(
      "name: Restore Windows signing certificate"
    );
    expect(workflow).to.include(
      "if: ${{ github.event_name == 'workflow_dispatch' && inputs.build_mode == 'production' }}"
    );
  });

  it("adds an unsigned MSI to master push artifacts", (): void => {
    const workflow = load(
      readFileSync(releaseWorkflowPath, "utf8")
    ) as ReleaseWorkflow;
    const steps = workflow.jobs?.["build-windows"]?.steps ?? [];
    const stepByName = (name: string): WorkflowStep => {
      const step = steps.find((candidate: WorkflowStep): boolean => {
        return candidate.name === name;
      });
      expect(step, `missing workflow step: ${name}`).to.not.equal(undefined);
      return step as WorkflowStep;
    };

    expect(stepByName("Install WiX Toolset").if).to.equal(
      "${{ github.event_name == 'push' || env.BUILD_MODE != 'store' }}"
    );

    const msiStep = stepByName("Build MSI for local testing");
    expect(msiStep.if).to.equal("${{ github.event_name == 'push' }}");
    expect(msiStep.run).to.include(
      "electron-forge make --skip-package --platform=win32 --targets @electron-forge/maker-wix"
    );

    const validationStep = stepByName("Validate master Windows installers");
    expect(validationStep.if).to.equal("${{ github.event_name == 'push' }}");
    expect(validationStep.run).to.include(
      "Get-ChildItem -Path out/make -Recurse -Filter *.msix"
    );
    expect(validationStep.run).to.include(
      "Get-ChildItem -Path out/make -Recurse -Filter *.msi"
    );

    const uploadStep = stepByName("Upload Windows installers");
    expect(uploadStep.with?.path).to.include("out/make/**/*.msix");
    expect(uploadStep.with?.path).to.include("out/make/**/*.msi");
  });

  it("builds a macOS package for master pushes", (): void => {
    const workflow = load(
      readFileSync(releaseWorkflowPath, "utf8")
    ) as ReleaseWorkflow;

    expect(workflow.jobs?.["build-macos"]?.if).to.equal(
      "${{ github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.build_mode != 'store') }}"
    );
  });
});
