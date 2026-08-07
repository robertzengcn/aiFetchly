import { describe, expect, it } from "vitest";

import {
  parseRuntimeFileName,
  checkFilenameContract,
} from "../../../scripts/verify-local-ai-runtime.mjs";

describe("parseRuntimeFileName", () => {
  it("parses a well-formed embedding runtime filename into its components", () => {
    // The exact name shape produced by build-local-ai-runtime.mjs.
    const parsed = parseRuntimeFileName(
      "embedding-runtime-darwin-x64-1.0.0.zip"
    );
    expect(parsed).toEqual({
      prefix: "embedding",
      platform: "darwin",
      arch: "x64",
      version: "1.0.0",
    });
  });

  it("parses every supported platform/arch combination", () => {
    const cases: Array<[string, string, string]> = [
      ["embedding-runtime-win32-x64-1.0.0.zip", "win32", "x64"],
      ["embedding-runtime-darwin-arm64-2.3.4.zip", "darwin", "arm64"],
      ["voice-runtime-linux-x64-0.1.0.zip", "linux", "x64"],
      ["voice-runtime-win32-arm64-10.20.30.zip", "win32", "arm64"],
    ];
    for (const [name, platform, arch] of cases) {
      const parsed = parseRuntimeFileName(name);
      expect(parsed, name).not.toBeNull();
      expect(parsed?.platform, name).toBe(platform);
      expect(parsed?.arch, name).toBe(arch);
      // Regression guard for the m[5]-undefined bug: version MUST parse to the
      // trailing semver, never undefined. Previously the verifier read capture
      // group 5 of a 4-group regex, so every manifest/version cross-check read
      // `undefined` and every verification failed.
      expect(parsed?.version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("returns null for names that do not match the runtime contract", () => {
    expect(parseRuntimeFileName("not-a-runtime.zip")).toBeNull();
    // Wrong platform token.
    expect(parseRuntimeFileName("embedding-runtime-freebsd-x64-1.0.0.zip")).toBeNull();
    // Wrong arch token.
    expect(parseRuntimeFileName("embedding-runtime-darwin-ia32-1.0.0.zip")).toBeNull();
    // Missing version segment.
    expect(parseRuntimeFileName("embedding-runtime-darwin-x64.zip")).toBeNull();
    // Non-semver version.
    expect(parseRuntimeFileName("embedding-runtime-darwin-x64-1.0.zip")).toBeNull();
  });
});

describe("checkFilenameContract", () => {
  it("produces no violations when the filename matches the verification target", () => {
    // The exact trio that failed in CI (win32-x64, darwin-x64, darwin-arm64).
    expect(
      checkFilenameContract("embedding-runtime-win32-x64-1.0.0.zip", "win32", "x64")
    ).toEqual([]);
    expect(
      checkFilenameContract("embedding-runtime-darwin-x64-1.0.0.zip", "darwin", "x64")
    ).toEqual([]);
    expect(
      checkFilenameContract(
        "embedding-runtime-darwin-arm64-1.0.0.zip",
        "darwin",
        "arm64"
      )
    ).toEqual([]);
  });

  it("reports a platform mismatch without confusing platform with arch or version", () => {
    // Regression for the off-by-one: the old code compared m[3] (arch) against
    // --platform and m[4] (version) against --arch, so a correct filename was
    // reported as `Filename target (x64/1.0.0) != verification target (darwin/x64)`.
    const violations = checkFilenameContract(
      "embedding-runtime-linux-x64-1.0.0.zip",
      "darwin",
      "x64"
    );
    expect(violations).toHaveLength(1);
    // The reported filename target must be platform/arch (linux/x64), NOT
    // arch/version (x64/1.0.0).
    expect(violations[0]).toContain("linux/x64");
    expect(violations[0]).toContain("darwin/x64");
    expect(violations[0]).not.toContain("1.0.0");
  });

  it("reports an arch mismatch", () => {
    const violations = checkFilenameContract(
      "embedding-runtime-darwin-arm64-1.0.0.zip",
      "darwin",
      "x64"
    );
    expect(violations).toEqual([
      "Filename target (darwin/arm64) != verification target (darwin/x64)",
    ]);
  });

  it("rejects a name that does not match the contract at all", () => {
    const violations = checkFilenameContract("garbage.zip", "darwin", "x64");
    expect(violations).toEqual([
      "Filename does not match the runtime contract: garbage.zip",
    ]);
  });
});
