import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

interface WorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface WorkflowJob {
  if?: string;
  "runs-on"?: string;
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs?: Record<string, WorkflowJob>;
}

const releaseWorkflowPath = path.resolve(
  __dirname,
  "../../.github/workflows/release.yml"
);

function readStoreJob(): WorkflowJob {
  const workflow = load(
    readFileSync(releaseWorkflowPath, "utf8")
  ) as ReleaseWorkflow;
  const job = workflow.jobs?.["build-macos-store"];
  expect(job, "missing build-macos-store job").to.not.equal(undefined);
  return job as WorkflowJob;
}

function findStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps?.find(
    (candidate: WorkflowStep): boolean => candidate.name === name
  );
  expect(step, `missing workflow step: ${name}`).to.not.equal(undefined);
  return step as WorkflowStep;
}

describe("Mac App Store release workflow", (): void => {
  it("runs the dedicated package job only for manually dispatched Store builds", (): void => {
    const job = readStoreJob();

    expect(job.if).to.equal(
      "${{ github.event_name == 'workflow_dispatch' && inputs.build_mode == 'store' }}"
    );
    expect(job["runs-on"]).to.equal("macos-latest");
  });

  it("restores every required Store credential into a temporary keychain", (): void => {
    const step = findStep(
      readStoreJob(),
      "Configure Mac App Store signing"
    );

    expect(step.env).to.deep.equal({
      APPLE_DISTRIBUTION_CERTIFICATE_BASE64:
        "${{ secrets.APPLE_DISTRIBUTION_CERTIFICATE_BASE64 }}",
      MAC_INSTALLER_DISTRIBUTION_CERTIFICATE_BASE64:
        "${{ secrets.MAC_INSTALLER_DISTRIBUTION_CERTIFICATE_BASE64 }}",
      MAC_STORE_PROVISIONING_PROFILE_BASE64:
        "${{ secrets.MAC_STORE_PROVISIONING_PROFILE_BASE64 }}",
      APPLE_CERTIFICATE_PASSWORD:
        "${{ secrets.APPLE_CERTIFICATE_PASSWORD }}",
      MAC_STORE_SIGNING_IDENTITY:
        "${{ secrets.MAC_STORE_SIGNING_IDENTITY }}",
      APPLE_TEAM_ID: "${{ secrets.APPLE_TEAM_ID }}",
      APPLE_ID: "${{ secrets.APPLE_ID }}",
      APPLE_APP_SPECIFIC_PASSWORD:
        "${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}",
    });
    expect(step.run).to.include(
      'printf \'%s\' "$APPLE_DISTRIBUTION_CERTIFICATE_BASE64" | base64 --decode'
    );
    expect(step.run).to.include(
      'printf \'%s\' "$MAC_INSTALLER_DISTRIBUTION_CERTIFICATE_BASE64" | base64 --decode'
    );
    expect(step.run).to.include(
      'printf \'%s\' "$MAC_STORE_PROVISIONING_PROFILE_BASE64" | base64 --decode'
    );
    expect(step.run).to.include(
      'echo "MAC_STORE_PROVISIONING_PROFILE=$provisioning_profile_path" >> "$GITHUB_ENV"'
    );
    expect(step.run).to.include(
      'echo "MAC_STORE_KEYCHAIN_PATH=$keychain_path" >> "$GITHUB_ENV"'
    );
  });

  it("builds and verifies the MAS app before creating a signed installer", (): void => {
    const job = readStoreJob();
    const buildStep = findStep(job, "Build Mac App Store application");
    const packageStep = findStep(
      job,
      "Create signed Mac App Store installer"
    );

    expect(buildStep.env).to.deep.equal({
      MAC_STORE_SIGNING_IDENTITY:
        "${{ secrets.MAC_STORE_SIGNING_IDENTITY }}",
      MAC_STORE_SIGNING_TYPE: "distribution",
    });
    expect(buildStep.run).to.include("yarn package-mac:store");
    expect(buildStep.run).to.include('yarn verify-mac:store "$app_path"');
    expect(packageStep.run).to.include(
      'productbuild --component "$app_path" /Applications'
    );
    expect(packageStep.run).to.include(
      '--sign "$MAC_INSTALLER_SIGNING_IDENTITY"'
    );
    expect(packageStep.run).to.include(
      'codesign --verify --deep --strict --verbose=2 "$app_path"'
    );
    expect(packageStep.run).to.include('pkgutil --check-signature "$pkg_path"');
  });

  it("uploads only the signed pkg and always removes the temporary keychain", (): void => {
    const job = readStoreJob();
    const uploadStep = findStep(job, "Upload Mac App Store package");
    const cleanupStep = findStep(
      job,
      "Remove Mac App Store signing keychain"
    );

    expect(uploadStep.uses).to.equal("actions/upload-artifact@v7");
    expect(uploadStep.with?.path).to.equal("out/mac-app-store/*.pkg");
    expect(uploadStep.with?.["if-no-files-found"]).to.equal("error");
    expect(cleanupStep.if).to.equal("${{ always() }}");
    expect(cleanupStep.run).to.include(
      'security delete-keychain "$MAC_STORE_KEYCHAIN_PATH"'
    );
  });
});
