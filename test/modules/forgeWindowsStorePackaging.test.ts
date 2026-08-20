import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

interface ForgeMaker {
  name: string;
  config?: {
    sign?: boolean;
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
    expect(maker?.config?.windowsKitVersion).to.equal("10.0.26100.0");
    expect(maker?.config?.manifestVariables).to.include({
      packageIdentity: "12345RobertZeng.AiFetchly",
      publisher: "CN=STORE-PUBLISHER-ID",
      publisherDisplayName: "Robert Zeng",
      packageMinOSVersion: "10.0.17763.0",
      packageMaxOSVersionTested: "10.0.26100.0",
    });
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
