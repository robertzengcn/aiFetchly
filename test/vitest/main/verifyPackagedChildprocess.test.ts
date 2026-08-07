import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const verify = require("../../../scripts/verify-packaged-childprocess.js") as {
  extractRuntimePackageRequires: (source: string) => Set<string>;
  isAllowedAsarRequireForUnpackedWorker: (packageName: string) => boolean;
  isUnpackedBundleLocation: (location: string) => boolean;
  verifyRuntimeRequires: (resourcesDir: string) => boolean;
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeResourcesFixture(options: {
  readonly workerRequires: string;
  readonly asarOnlyPackages?: readonly string[];
  readonly unpackedPackages?: readonly string[];
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-verify-pkg-"));
  tempDirs.push(root);
  const resourcesDir = path.join(root, "resources");
  const unpackedBuild = path.join(
    resourcesDir,
    "app.asar.unpacked",
    ".vite",
    "build"
  );
  fs.mkdirSync(unpackedBuild, { recursive: true });
  fs.writeFileSync(
    path.join(unpackedBuild, "taskCode.js"),
    options.workerRequires
  );

  // Minimal fake asar is expensive; verifyRuntimeRequires tolerates missing
  // asar and still enforces the unpacked-only policy via asarEntries=empty
  // plus optional unpacked node_modules.
  for (const packageName of options.unpackedPackages ?? []) {
    const pkgDir = path.join(
      resourcesDir,
      "app.asar.unpacked",
      "node_modules",
      ...packageName.split("/")
    );
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: packageName, main: "index.js" })
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};");
  }

  // Seed extracted-style asar packages by creating app.asar as a directory
  // marker is not enough — verify extracts real asar. For unit tests we only
  // need the unpacked policy path (asarEntries empty => inAsar false).
  void options.asarOnlyPackages;

  return resourcesDir;
}

describe("verify-packaged-childprocess unpacked worker policy", () => {
  it("treats app.asar.unpacked paths as unpacked on Windows and POSIX", () => {
    expect(
      verify.isUnpackedBundleLocation(
        "E:\\\\aifetchly\\\\app\\\\resources\\\\app.asar.unpacked\\\\.vite\\\\build\\\\taskCode.js"
      )
    ).toBe(true);
    expect(
      verify.isUnpackedBundleLocation(
        "/opt/AiFetchly/resources/app.asar.unpacked/.vite/build/taskCode.js"
      )
    ).toBe(true);
    expect(
      verify.isUnpackedBundleLocation(
        "/opt/AiFetchly/resources/app.asar/.vite/build/taskCode.js"
      )
    ).toBe(false);
  });

  it("allowlists intentional heavy externals but not electron-store/sanitize-html", () => {
    expect(verify.isAllowedAsarRequireForUnpackedWorker("puppeteer")).toBe(
      true
    );
    expect(
      verify.isAllowedAsarRequireForUnpackedWorker(
        "puppeteer-extra-plugin-stealth"
      )
    ).toBe(true);
    expect(verify.isAllowedAsarRequireForUnpackedWorker("lodash")).toBe(true);
    expect(verify.isAllowedAsarRequireForUnpackedWorker("electron-store")).toBe(
      false
    );
    expect(verify.isAllowedAsarRequireForUnpackedWorker("sanitize-html")).toBe(
      false
    );
    expect(verify.isAllowedAsarRequireForUnpackedWorker("cheerio")).toBe(true);
    expect(verify.isAllowedAsarRequireForUnpackedWorker("chokidar")).toBe(true);
    expect(verify.isAllowedAsarRequireForUnpackedWorker("isolated-vm")).toBe(
      true
    );
    expect(verify.isAllowedAsarRequireForUnpackedWorker("uuid")).toBe(false);
    expect(verify.isAllowedAsarRequireForUnpackedWorker("zod")).toBe(false);
    expect(verify.isAllowedAsarRequireForUnpackedWorker("turndown")).toBe(false);
  });

  it("extracts package roots from worker require() calls", () => {
    const packages = verify.extractRuntimePackageRequires(
      'require("electron-store"); require("lodash/map.js"); require("path");'
    );
    expect([...packages].sort()).toEqual(["electron-store", "lodash"]);
  });

  it("ignores require() text embedded in template literals", () => {
    const packages = verify.extractRuntimePackageRequires(
      'const x = require("puppeteer"); const code = `require("ajv/dist/runtime/validation_error")`;'
    );
    expect([...packages]).toEqual(["puppeteer"]);
  });

  it("fails when an unpacked worker requires asar-only pure-JS deps", () => {
    const resourcesDir = makeResourcesFixture({
      workerRequires:
        'require("electron-store"); require("puppeteer"); require("path");',
    });

    const previousError = console.error;
    const errors: string[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      expect(verify.verifyRuntimeRequires(resourcesDir)).toBe(false);
    } finally {
      console.error = previousError;
    }

    expect(errors.join("\n")).toMatch(/electron-store/);
    expect(errors.join("\n")).toMatch(/app\.asar\.unpacked\/node_modules/);
  });

  it("passes allowlisted heavy externals even when only resolvable via search paths setup", () => {
    // puppeteer allowlisted: policy does not emit the asar-only pure-JS error.
    // Resolution may still fail without a real asar extract; seed unpacked copy
    // so require.resolve succeeds in this unit fixture.
    const resourcesDir = makeResourcesFixture({
      workerRequires: 'require("puppeteer"); require("path");',
      unpackedPackages: ["puppeteer"],
    });

    const previousLog = console.log;
    console.log = () => undefined;
    try {
      expect(verify.verifyRuntimeRequires(resourcesDir)).toBe(true);
    } finally {
      console.log = previousLog;
    }
  });
});
