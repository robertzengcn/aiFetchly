import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * The WiX MSI leg of the Windows test build (Build Electron App run #383)
 * crashed with V8 "Fatal process out of memory: Zone" (exit code 0x80000003)
 * while light.exe mszip-compressed the whole packaged payload inside the same
 * limited GitHub Actions runner as the Forge Node process. The mitigation in
 * forge.config.js disables Media compression for NODE_ENV=test builds via the
 * maker-wix `beforeCreate` hook and keeps production builds compressed.
 *
 * forge.config.js evaluates store-mode makers at module load, so (like
 * forgeMacStorePackaging.test.ts) each scenario is projected in its own child
 * node process with the controlled environment.
 */

const projectRoot = path.resolve(__dirname, "../..");
const forgeConfigPath = path.join(projectRoot, "forge.config.js");
const realWixTemplatePath = path.join(
  projectRoot,
  "node_modules",
  "electron-wix-msi",
  "static",
  "wix.xml"
);

const MEDIA_TAG_OPEN = '<Media Id="1" Cabinet="product.cab" EmbedCab="yes"/>';
const MEDIA_TAG_NO_COMPRESSION =
  '<Media Id="1" Cabinet="product.cab" EmbedCab="yes" CompressionLevel="none"/>';

interface Projection {
  hasBeforeCreate: boolean;
  lightSwitches: string[];
  hasOpenMediaTag: boolean;
  hasNoCompressionMediaTag: boolean;
  threw: string | null;
}

const projectionScript = `
(() => {
  const result = {
    hasBeforeCreate: false,
    lightSwitches: [],
    hasOpenMediaTag: false,
    hasNoCompressionMediaTag: false,
    threw: null,
  };
  try {
    const config = require(${JSON.stringify(forgeConfigPath)});
    const maker = (config.makers ?? []).find(
      (candidate) => candidate.name === "@electron-forge/maker-wix"
    );
    if (!maker || !maker.config) throw new Error("maker-wix config missing");
    result.hasBeforeCreate = typeof maker.config.beforeCreate === "function";
    result.lightSwitches = maker.config.lightSwitches ?? [];
    // The Rendered wix template that maker-wix uses at MSI-build time is the
    // static template from the installed electron-wix-msi (forge.config.js
    // does not ship its own). Apply beforeCreate to a stub that carries it.
    const stub = {
      wixTemplate: require("fs").readFileSync(${JSON.stringify(
        realWixTemplatePath
      )}, "utf-8"),
    };
    maker.config.beforeCreate(stub);
    result.hasOpenMediaTag = stub.wixTemplate.includes(${JSON.stringify(
      MEDIA_TAG_OPEN
    )});
    result.hasNoCompressionMediaTag = stub.wixTemplate.includes(${JSON.stringify(
      MEDIA_TAG_NO_COMPRESSION
    )});
  } catch (err) {
    result.threw = String((err && err.message) || err);
  }
  process.stdout.write(JSON.stringify(result));
})();
`;

function projectForEnvironment(
  environment: Record<string, string | undefined>
): Projection {
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
    encoding: "utf-8",
    env: childEnvironment,
  });

  if (result.error) {
    throw new Error(`projection failed to spawn: ${result.error.message}`);
  }
  const stdout = (result.stdout ?? "").trim();
  if (!stdout) {
    throw new Error(
      `projection produced no output (stderr: ${result.stderr ?? ""})`
    );
  }
  return JSON.parse(stdout) as Projection;
}

describe("maker-wix MSI compression policy (run #383 memory crash mitigation)", (): void => {
  it("the real electron-wix-msi template still contains the Media tag marker", (): void => {
    const template = readFileSync(realWixTemplatePath, "utf-8");
    expect(template).to.include(MEDIA_TAG_OPEN);
  });

  it("test builds disable Media compression (CompressionLevel=none)", (): void => {
    const projection = projectForEnvironment({
      NODE_ENV: "test",
      FORGE_SKIP_NATIVE_REBUILD: undefined,
    });

    expect(
      projection.hasBeforeCreate,
      "maker-wix beforeCreate hook must be configured"
    ).to.equal(true);
    expect(projection.hasNoCompressionMediaTag).to.equal(true);
    expect(projection.hasOpenMediaTag).to.equal(false);
    expect(projection.threw).to.equal(null);
  });

  it("non-test builds keep the default (compressed) Media", (): void => {
    const projection = projectForEnvironment({
      NODE_ENV: "production",
      FORGE_SKIP_NATIVE_REBUILD: undefined,
    });

    expect(projection.hasBeforeCreate).to.equal(true);
    expect(projection.hasNoCompressionMediaTag).to.equal(false);
    expect(projection.hasOpenMediaTag).to.equal(true);
    expect(projection.threw).to.equal(null);
  });

  it("keeps lightSwitches ICE suppression intact", (): void => {
    const projection = projectForEnvironment({
      NODE_ENV: "production",
      FORGE_SKIP_NATIVE_REBUILD: undefined,
    });

    expect(projection.lightSwitches).to.deep.equal(["-sval"]);
  });
});
