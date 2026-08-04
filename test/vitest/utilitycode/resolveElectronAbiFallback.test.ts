import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  resolveAbiFromNodeAbiLoaders,
  buildNodeAbiLoaders,
  resolveAbiFromNodeAbi,
} from "../../../scripts/resolve-electron-build-metadata.mjs";

/**
 * These tests guard the CI regression where a stale, hoisted top-level
 * `node-abi@3.x` threw `Could not detect abi for version 43.x`, forcing the
 * verifier into its GUI-Electron binary fallback — which works on Windows/macOS
 * runners but cannot start on a headless Linux runner (`ubuntu-22.04`, no X),
 * surfacing as `Could not run Electron to resolve ABI: exit null` and failing
 * the whole release. The fix resolves node-abi from @electron/rebuild's nested
 * authoritative copy FIRST, then the top-level copy, trying each until one
 * returns a numeric ABI.
 */

/** Fake node-abi module that mimics a release that predates an Electron major. */
function staleNodeAbi() {
  return {
    getAbi() {
      throw new Error(
        "Could not detect abi for version 43.2.0 and runtime electron."
      );
    },
  };
}

/** Fake node-abi module that knows electron 43.2.0 -> 148. */
function freshNodeAbi() {
  return {
    getAbi(version: string) {
      return version === "43.2.0" ? "148" : null;
    },
  };
}

describe("resolveAbiFromNodeAbiLoaders", () => {
  it("returns the numeric ABI from the first loader that produces one", () => {
    const loaders = [() => freshNodeAbi(), () => staleNodeAbi()];
    expect(resolveAbiFromNodeAbiLoaders("43.2.0", loaders)).toBe("148");
  });

  it("skips a loader whose getAbi throws (stale copy) and falls through to the next", () => {
    // Order matters: stale first, fresh second. The stale loader must not abort
    // the resolution — that was the root cause of the Linux failure.
    const loaders = [() => staleNodeAbi(), () => freshNodeAbi()];
    expect(resolveAbiFromNodeAbiLoaders("43.2.0", loaders)).toBe("148");
  });

  it("returns null when no loader knows the version", () => {
    const loaders = [() => staleNodeAbi(), () => freshNodeAbi()];
    expect(resolveAbiFromNodeAbiLoaders("99.0.0", loaders)).toBeNull();
  });

  it("returns null for an empty loader list", () => {
    expect(resolveAbiFromNodeAbiLoaders("43.2.0", [])).toBeNull();
  });

  it("ignores a loader that throws on require / returns nothing", () => {
    const loaders = [
      () => {
        throw new Error("module not found");
      },
      () => null,
      () => freshNodeAbi(),
    ];
    expect(resolveAbiFromNodeAbiLoaders("43.2.0", loaders)).toBe("148");
  });

  it("rejects a non-numeric ABI (e.g. undefined) and keeps looking", () => {
    const loaders = [() => ({ getAbi: () => undefined }), () => freshNodeAbi()];
    expect(resolveAbiFromNodeAbiLoaders("43.2.0", loaders)).toBe("148");
  });
});

describe("buildNodeAbiLoaders + resolveAbiFromNodeAbi (node_modules layout)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-nodeabi-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeNodeAbi(dir: string, body: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "node-abi", version: "0.0.0", main: "index.js" })
    );
    fs.writeFileSync(path.join(dir, "index.js"), body);
  }

  it("prefers @electron/rebuild's nested fresh copy over a stale top-level copy", () => {
    // Top-level copy is stale (throws on 43.x) — simulates hoisted node-abi 3.x.
    writeNodeAbi(
      path.join(root, "node_modules/node-abi"),
      "module.exports = { getAbi() { throw new Error('stale'); } };"
    );
    // @electron/rebuild ships a fresh nested copy — simulates node-abi 4.x.
    writeNodeAbi(
      path.join(root, "node_modules/@electron/rebuild/node_modules/node-abi"),
      "module.exports = { getAbi(v) { return v === '43.2.0' ? '148' : null; } };"
    );
    fs.mkdirSync(path.join(root, "node_modules/@electron/rebuild"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "node_modules/@electron/rebuild/package.json"),
      JSON.stringify({ name: "@electron/rebuild", version: "4.0.0" })
    );

    const loaders = buildNodeAbiLoaders(root);
    // The authoritative (rebuild) loader must come first.
    expect(loaders.length).toBeGreaterThanOrEqual(2);
    // End-to-end: stale top-level must NOT force the binary fallback.
    expect(resolveAbiFromNodeAbi("43.2.0", root)).toBe("148");
  });

  it("still resolves via top-level when @electron/rebuild is absent", () => {
    writeNodeAbi(
      path.join(root, "node_modules/node-abi"),
      "module.exports = { getAbi(v) { return v === '43.2.0' ? '148' : null; } };"
    );
    expect(resolveAbiFromNodeAbi("43.2.0", root)).toBe("148");
  });

  it("returns null when no installed node-abi copy knows the version", () => {
    writeNodeAbi(
      path.join(root, "node_modules/node-abi"),
      "module.exports = { getAbi() { throw new Error('stale'); } };"
    );
    expect(resolveAbiFromNodeAbi("43.2.0", root)).toBeNull();
  });
});
