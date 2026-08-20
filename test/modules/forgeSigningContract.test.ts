import { expect } from "chai";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { load } from "js-yaml";

/**
 * Contract tests that lock the macOS production signing path against the two
 * classes of drift that previously shipped broken builds:
 *
 * 1. Forge-config regression — `osxSign` stopped forwarding the CI keychain
 *    and `@electron/packager`'s `continueOnError: true` default silently
 *    swallowed the signing failure, so the app shipped adhoc-signed and failed
 *    at notarization with a confusing dump (see fix commit b25f3965).
 * 2. Workflow↔config desync — a workflow step was removed without updating
 *    the config that depended on it (see fix commit 93215dad). These tests
 *    assert the env vars the workflow exports are the ones the config reads.
 */

interface ProjectedMacSignConfig {
  status: number | null;
  output: string;
  keychain?: string;
  continueOnError?: boolean;
  notarizeConfigured?: boolean;
  notarizeAppleId?: string;
  notarizeAppleIdPassword?: string;
  notarizeTeamId?: string;
}

interface WorkflowStep {
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs?: Record<string, WorkflowJob>;
}

const projectRoot = path.resolve(__dirname, "../..");
const forgeConfigPath = path.join(projectRoot, "forge.config.js");
const releaseWorkflowPath = path.join(
  projectRoot,
  ".github",
  "workflows",
  "release.yml"
);

const projectionScript = `
Object.defineProperty(process, "platform", { value: "darwin" });
const config = require(${JSON.stringify(forgeConfigPath)});
const sign = config.packagerConfig.osxSign || {};
const notarize = config.packagerConfig.osxNotarize || {};
process.stdout.write(JSON.stringify({
  keychain: sign.keychain,
  continueOnError: sign.continueOnError,
  notarizeConfigured: Boolean(config.packagerConfig.osxNotarize),
  notarizeAppleId: notarize.appleId,
  notarizeAppleIdPassword: notarize.appleIdPassword,
  notarizeTeamId: notarize.teamId,
}));
`;

function projectMacSignConfig(
  environment: Record<string, string | undefined>
): ProjectedMacSignConfig {
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete childEnvironment[name];
    } else {
      childEnvironment[name] = value;
    }
  }

  const result = spawnSync(process.execPath, ["-e", projectionScript], {
    cwd: projectRoot,
    env: childEnvironment,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  return {
    status: result.status,
    output,
    ...(result.status === 0
      ? (JSON.parse(result.stdout) as Omit<
          ProjectedMacSignConfig,
          "status" | "output"
        >)
      : {}),
  };
}

function readBuildMacosJob(): WorkflowJob {
  const workflow = load(
    readFileSync(releaseWorkflowPath, "utf8")
  ) as ReleaseWorkflow;
  const job = workflow.jobs?.["build-macos"];
  expect(job, "missing build-macos job").to.not.equal(undefined);
  return job as WorkflowJob;
}

function findStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job.steps?.find(
    (candidate: WorkflowStep): boolean => candidate.name === name
  );
  expect(step, `missing workflow step: ${name}`).to.not.equal(undefined);
  return step as WorkflowStep;
}

describe("macOS production signing contract", (): void => {
  describe("forge.config.js osxSign", (): void => {
    it("forwards the CI keychain so @electron/osx-sign searches it for the Developer ID cert", (): void => {
      const keychainPath = "/tmp/aifetchly-build.keychain-db";
      const result = projectMacSignConfig({
        NODE_ENV: "production",
        MAC_DISTRIBUTION: undefined,
        MACOS_KEYCHAIN_PATH: keychainPath,
        APPLE_ID: "developer@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "test-password",
        APPLE_TEAM_ID: "TESTTEAM",
      });

      expect(result.status, result.output).to.equal(0);
      expect(result.keychain).to.equal(keychainPath);
    });

    it("omits keychain when MACOS_KEYCHAIN_PATH is unset (local dev fallback)", (): void => {
      const result = projectMacSignConfig({
        NODE_ENV: "production",
        MAC_DISTRIBUTION: undefined,
        MACOS_KEYCHAIN_PATH: undefined,
        APPLE_ID: "developer@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "test-password",
        APPLE_TEAM_ID: "TESTTEAM",
      });

      expect(result.status, result.output).to.equal(0);
      expect(result.keychain).to.equal(undefined);
    });

    it("fails hard on signing errors (continueOnError === false)", (): void => {
      // @electron/packager defaults continueOnError to true, which swallows
      // signing failures as warnings and leaves the app adhoc-signed. The
      // config must explicitly disable this so failures surface at signing.
      const result = projectMacSignConfig({
        NODE_ENV: "production",
        MAC_DISTRIBUTION: undefined,
        MACOS_KEYCHAIN_PATH: "/tmp/aifetchly-build.keychain-db",
        APPLE_ID: "developer@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "test-password",
        APPLE_TEAM_ID: "TESTTEAM",
      });

      expect(result.status, result.output).to.equal(0);
      expect(result.continueOnError).to.equal(false);
    });

    it("configures notarization with the required Apple credentials", (): void => {
      const result = projectMacSignConfig({
        NODE_ENV: "production",
        MAC_DISTRIBUTION: undefined,
        MACOS_KEYCHAIN_PATH: "/tmp/aifetchly-build.keychain-db",
        APPLE_ID: "developer@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "test-password",
        APPLE_TEAM_ID: "TESTTEAM",
      });

      expect(result.status, result.output).to.equal(0);
      expect(result.notarizeConfigured).to.equal(true);
      expect(result.notarizeAppleId).to.equal("developer@example.com");
      expect(result.notarizeAppleIdPassword).to.equal("test-password");
      expect(result.notarizeTeamId).to.equal("TESTTEAM");
    });

    it("rejects a direct production build without Apple notarization credentials", (): void => {
      const result = projectMacSignConfig({
        NODE_ENV: "production",
        MAC_DISTRIBUTION: undefined,
        MACOS_KEYCHAIN_PATH: "/tmp/aifetchly-build.keychain-db",
        APPLE_ID: undefined,
        APPLE_APP_SPECIFIC_PASSWORD: undefined,
        APPLE_TEAM_ID: undefined,
      });

      expect(result.status).to.not.equal(0);
      expect(result.output).to.include("APPLE_ID");
    });
  });

  describe("release.yml ↔ forge.config.js env contract", (): void => {
    it("exports MACOS_KEYCHAIN_PATH from the keychain setup step", (): void => {
      const step = findStep(
        readBuildMacosJob(),
        "Configure macOS signing keychain"
      );
      expect(step.run).to.include(
        'echo "MACOS_KEYCHAIN_PATH=$keychain_path" >> "$GITHUB_ENV"'
      );
    });

    it("passes Apple notarization credentials to the build step", (): void => {
      const step = findStep(readBuildMacosJob(), "Build application");
      expect(step.env?.APPLE_ID).to.equal("${{ secrets.APPLE_ID }}");
      expect(step.env?.APPLE_APP_SPECIFIC_PASSWORD).to.equal(
        "${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}"
      );
      expect(step.env?.APPLE_TEAM_ID).to.equal("${{ secrets.APPLE_TEAM_ID }}");
    });

    it("runs make-mac:prod for production builds", (): void => {
      const step = findStep(readBuildMacosJob(), "Build application");
      expect(step.run).to.include("yarn make-mac:prod");
    });

    it("always removes the temporary keychain", (): void => {
      const step = findStep(
        readBuildMacosJob(),
        "Remove macOS signing keychain"
      );
      expect(step.if).to.equal(
        "${{ always() && env.BUILD_MODE == 'production' }}"
      );
      expect(step.run).to.include(
        'security delete-keychain "$MACOS_KEYCHAIN_PATH"'
      );
    });

    it("does NOT contain a Windows certificate-restore step (signing is optional)", (): void => {
      // Regression guard for commit 93215dad: the Windows signing step was
      // intentionally removed because forge.config.js resolveWindowsSignConfig()
      // signs only when cert.pfx + CERTIFICATE_PASSWORD are present. A future
      // re-add must be a conscious decision, not an accidental revert.
      const workflow = readFileSync(releaseWorkflowPath, "utf8");
      expect(workflow).to.not.include(
        "name: Restore Windows signing certificate"
      );
    });
  });
});
