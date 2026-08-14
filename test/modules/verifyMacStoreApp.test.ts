import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import plist from "plist";

type RunCommand = (command: string, args: readonly string[]) => string;

interface VerificationDependencies {
  existsSync: (filePath: string) => boolean;
  runCommand: RunCommand;
}

interface VerificationResult {
  appPath: string;
  bundleIdentifier: string;
  helperCount: number;
}

interface VerifierModule {
  verifyMacStoreApp: (
    appPath: string,
    dependencies: VerificationDependencies
  ) => VerificationResult;
}

const verifier = require("../../scripts/verify-mac-store-app.js") as VerifierModule;

const MAIN_ENTITLEMENTS = {
  "com.apple.security.app-sandbox": true,
  "com.apple.security.network.client": true,
  "com.apple.security.files.user-selected.read-write": true,
  "com.apple.security.files.bookmarks.app-scope": true,
};

const CHILD_ENTITLEMENTS = {
  "com.apple.security.app-sandbox": true,
  "com.apple.security.inherit": true,
};

function createApplicationFixture(root: string, includeHelper = true): string {
  const appPath = path.join(root, "AiFetchly.app");
  fs.mkdirSync(path.join(appPath, "Contents", "Frameworks"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), "fixture");

  if (includeHelper) {
    fs.mkdirSync(
      path.join(
        appPath,
        "Contents",
        "Frameworks",
        "AiFetchly Helper.app",
        "Contents"
      ),
      { recursive: true }
    );
  }

  return appPath;
}

function createDependencies(options?: {
  bundleIdentifier?: string;
  mainEntitlements?: Record<string, unknown>;
  childEntitlements?: Record<string, unknown>;
}): VerificationDependencies {
  const bundleIdentifier =
    options?.bundleIdentifier ?? "com.aifetchly.desktop";
  const mainEntitlements = options?.mainEntitlements ?? MAIN_ENTITLEMENTS;
  const childEntitlements = options?.childEntitlements ?? CHILD_ENTITLEMENTS;

  return {
    existsSync: fs.existsSync,
    runCommand: (command: string, args: readonly string[]): string => {
      if (command === "plutil") {
        return bundleIdentifier;
      }
      if (command === "codesign") {
        const targetPath = args.at(-1) ?? "";
        return plist.build(
          targetPath.includes(" Helper.app")
            ? childEntitlements
            : mainEntitlements
        );
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  };
}

describe("Mac App Store application verifier", (): void => {
  let tempDirectory: string;

  beforeEach((): void => {
    tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-mas-verifier-")
    );
  });

  afterEach((): void => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("accepts the expected bundle ID and sandboxed Electron helpers", (): void => {
    const appPath = createApplicationFixture(tempDirectory);

    const result = verifier.verifyMacStoreApp(
      appPath,
      createDependencies()
    );

    expect(result).to.deep.equal({
      appPath,
      bundleIdentifier: "com.aifetchly.desktop",
      helperCount: 1,
    });
  });

  it("rejects an application with a different bundle ID", (): void => {
    const appPath = createApplicationFixture(tempDirectory);

    expect(() =>
      verifier.verifyMacStoreApp(
        appPath,
        createDependencies({ bundleIdentifier: "com.example.wrong" })
      )
    ).to.throw(
      "Expected bundle ID com.aifetchly.desktop, received com.example.wrong."
    );
  });

  it("rejects a main application without App Sandbox", (): void => {
    const appPath = createApplicationFixture(tempDirectory);
    const mainEntitlements: Record<string, unknown> = {
      ...MAIN_ENTITLEMENTS,
    };
    delete mainEntitlements["com.apple.security.app-sandbox"];

    expect(() =>
      verifier.verifyMacStoreApp(
        appPath,
        createDependencies({ mainEntitlements })
      )
    ).to.throw("com.apple.security.app-sandbox");
  });

  it("rejects a main application without outgoing network access", (): void => {
    const appPath = createApplicationFixture(tempDirectory);
    const mainEntitlements: Record<string, unknown> = {
      ...MAIN_ENTITLEMENTS,
    };
    delete mainEntitlements["com.apple.security.network.client"];

    expect(() =>
      verifier.verifyMacStoreApp(
        appPath,
        createDependencies({ mainEntitlements })
      )
    ).to.throw("com.apple.security.network.client");
  });

  it("rejects a helper that does not inherit its sandbox", (): void => {
    const appPath = createApplicationFixture(tempDirectory);
    const childEntitlements = {
      "com.apple.security.app-sandbox": true,
    };

    expect(() =>
      verifier.verifyMacStoreApp(
        appPath,
        createDependencies({ childEntitlements })
      )
    ).to.throw("com.apple.security.inherit");
  });

  it("rejects an application without Electron helper applications", (): void => {
    const appPath = createApplicationFixture(tempDirectory, false);

    expect(() =>
      verifier.verifyMacStoreApp(appPath, createDependencies())
    ).to.throw("No Electron helper applications found");
  });
});
