import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import plist from "plist";

interface MacConfigProjection {
  appBundleId?: string;
  osxNotarizeConfigured: boolean;
  identity?: string;
  type?: string;
  provisioningProfile?: string;
  mainEntitlements?: string;
  childEntitlements?: string;
  mainTimestamp?: string;
  childTimestamp?: string;
  preAutoEntitlements?: boolean;
}

interface ProjectedConfigResult {
  status: number | null;
  projection?: MacConfigProjection;
  output: string;
}

const projectRoot = path.resolve(__dirname, "../..");
const forgeConfigPath = path.join(projectRoot, "forge.config.js");
const mainEntitlementsPath = path.join(
  projectRoot,
  "build",
  "entitlements.mas.plist"
);
const childEntitlementsPath = path.join(
  projectRoot,
  "build",
  "entitlements.mas.inherit.plist"
);

const projectionScript = `
Object.defineProperty(process, "platform", { value: "darwin" });
const config = require(${JSON.stringify(forgeConfigPath)});
const sign = config.packagerConfig.osxSign;
const mainPath = "/tmp/AiFetchly.app";
const childPath = "/tmp/AiFetchly.app/Contents/Frameworks/AiFetchly Helper.app";
process.stdout.write(JSON.stringify({
  appBundleId: config.packagerConfig.appBundleId,
  osxNotarizeConfigured: Boolean(config.packagerConfig.osxNotarize),
  identity: sign && sign.identity,
  type: sign && sign.type,
  provisioningProfile: sign && sign.provisioningProfile,
  mainEntitlements: sign && sign.optionsForFile
    ? sign.optionsForFile(mainPath).entitlements
    : undefined,
  childEntitlements: sign && sign.optionsForFile
    ? sign.optionsForFile(childPath).entitlements
    : undefined,
  mainTimestamp: sign && sign.optionsForFile
    ? sign.optionsForFile(mainPath).timestamp
    : undefined,
  childTimestamp: sign && sign.optionsForFile
    ? sign.optionsForFile(childPath).timestamp
    : undefined,
  preAutoEntitlements: sign && sign.preAutoEntitlements,
}));
`;

function projectForgeConfig(
  environment: Record<string, string | undefined>
): ProjectedConfigResult {
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
    projection:
      result.status === 0
        ? (JSON.parse(result.stdout) as MacConfigProjection)
        : undefined,
    output,
  };
}

function readEntitlements(filePath: string): Record<string, unknown> {
  return plist.parse(fs.readFileSync(filePath, "utf8")) as Record<
    string,
    unknown
  >;
}

describe("Mac App Store packaging", (): void => {
  let tempDirectory: string;
  let provisioningProfilePath: string;

  beforeEach((): void => {
    tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-mas-config-")
    );
    provisioningProfilePath = path.join(
      tempDirectory,
      "AiFetchlyDevelopment.provisionprofile"
    );
    fs.writeFileSync(provisioningProfilePath, "test profile");
  });

  afterEach((): void => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("configures a distribution-signed MAS app without notarization", (): void => {
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: "store",
      MAC_STORE_SIGNING_TYPE: "distribution",
      MAC_STORE_SIGNING_IDENTITY:
        "Apple Distribution: Test Developer (TESTTEAM)",
      MAC_STORE_PROVISIONING_PROFILE: provisioningProfilePath,
      APPLE_ID: undefined,
      APPLE_APP_SPECIFIC_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    });

    expect(result.status, result.output).to.equal(0);
    expect(result.projection).to.deep.equal({
      appBundleId: "com.aifetchly.desktop",
      osxNotarizeConfigured: false,
      identity: "Apple Distribution: Test Developer (TESTTEAM)",
      type: "distribution",
      provisioningProfile: provisioningProfilePath,
      mainEntitlements: mainEntitlementsPath,
      childEntitlements: childEntitlementsPath,
      mainTimestamp: "none",
      childTimestamp: "none",
      preAutoEntitlements: true,
    });
  });

  it("preserves development signing for local MAS sandbox testing", (): void => {
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: "store",
      MAC_STORE_SIGNING_TYPE: undefined,
      MAC_STORE_SIGNING_IDENTITY:
        "Apple Development: Test Developer (TESTTEAM)",
      MAC_STORE_PROVISIONING_PROFILE: provisioningProfilePath,
      APPLE_ID: undefined,
      APPLE_APP_SPECIFIC_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    });

    expect(result.status, result.output).to.equal(0);
    expect(result.projection?.identity).to.equal(
      "Apple Development: Test Developer (TESTTEAM)"
    );
    expect(result.projection?.type).to.equal("development");
  });

  it("does not depend on Apple's timestamp service for MAS signing", (): void => {
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: "store",
      MAC_STORE_SIGNING_TYPE: "distribution",
      MAC_STORE_SIGNING_IDENTITY:
        "Apple Distribution: Test Developer (TESTTEAM)",
      MAC_STORE_PROVISIONING_PROFILE: provisioningProfilePath,
      APPLE_ID: undefined,
      APPLE_APP_SPECIFIC_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    });

    expect(result.status, result.output).to.equal(0);
    expect(result.projection?.mainTimestamp).to.equal("none");
    expect(result.projection?.childTimestamp).to.equal("none");
  });

  it("derives Store identifiers from the provisioning profile", (): void => {
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: "store",
      MAC_STORE_SIGNING_TYPE: "distribution",
      MAC_STORE_SIGNING_IDENTITY:
        "Apple Distribution: Test Developer (TESTTEAM)",
      MAC_STORE_PROVISIONING_PROFILE: provisioningProfilePath,
      APPLE_ID: undefined,
      APPLE_APP_SPECIFIC_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    });

    expect(result.status, result.output).to.equal(0);
    expect(result.projection?.preAutoEntitlements).to.equal(true);
  });

  it("preserves notarization for direct production distribution", (): void => {
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: undefined,
      MAC_STORE_SIGNING_IDENTITY: undefined,
      MAC_STORE_PROVISIONING_PROFILE: undefined,
      APPLE_ID: "developer@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "test-password",
      APPLE_TEAM_ID: "TESTTEAM",
    });

    expect(result.status, result.output).to.equal(0);
    expect(result.projection).to.deep.equal({
      appBundleId: "com.aifetchly.desktop",
      osxNotarizeConfigured: true,
    });
  });

  it("rejects a store build without a distribution signing identity", (): void => {
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: "store",
      MAC_STORE_SIGNING_IDENTITY: undefined,
      MAC_STORE_PROVISIONING_PROFILE: provisioningProfilePath,
      APPLE_ID: undefined,
      APPLE_APP_SPECIFIC_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    });

    expect(result.status).to.not.equal(0);
    expect(result.output).to.include("MAC_STORE_SIGNING_IDENTITY");
  });

  it("rejects a store build without a provisioning profile", (): void => {
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: "store",
      MAC_STORE_SIGNING_IDENTITY:
        "Apple Distribution: Test Developer (TESTTEAM)",
      MAC_STORE_PROVISIONING_PROFILE: undefined,
      APPLE_ID: undefined,
      APPLE_APP_SPECIFIC_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    });

    expect(result.status).to.not.equal(0);
    expect(result.output).to.include("MAC_STORE_PROVISIONING_PROFILE");
  });

  it("rejects a store build when the provisioning profile does not exist", (): void => {
    const missingPath = path.join(tempDirectory, "missing.provisionprofile");
    const result = projectForgeConfig({
      NODE_ENV: "production",
      MAC_DISTRIBUTION: "store",
      MAC_STORE_SIGNING_IDENTITY:
        "Apple Distribution: Test Developer (TESTTEAM)",
      MAC_STORE_PROVISIONING_PROFILE: missingPath,
      APPLE_ID: undefined,
      APPLE_APP_SPECIFIC_PASSWORD: undefined,
      APPLE_TEAM_ID: undefined,
    });

    expect(result.status).to.not.equal(0);
    expect(result.output).to.include(missingPath);
  });

  it("grants only the approved main application entitlements", (): void => {
    expect(readEntitlements(mainEntitlementsPath)).to.deep.equal({
      "com.apple.security.app-sandbox": true,
      "com.apple.security.network.client": true,
      "com.apple.security.files.user-selected.read-write": true,
      "com.apple.security.files.bookmarks.app-scope": true,
    });
  });

  it("grants only sandbox inheritance to child processes", (): void => {
    expect(readEntitlements(childEntitlementsPath)).to.deep.equal({
      "com.apple.security.app-sandbox": true,
      "com.apple.security.inherit": true,
    });
  });
});
