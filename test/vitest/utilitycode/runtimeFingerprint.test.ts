import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  listFingerprintPackages,
  resolveYarnLockVersion,
  loadReleaseConfig,
  fingerprintEquals,
  describeFingerprintDiff,
  computeRuntimeFingerprint,
  FINGERPRINT_SOURCE_PATHS,
} from "../../../scripts/lib/localAiRuntime/runtimeFingerprint.mjs";
import {
  RUNTIME_ROOTS,
  SHERPA_PLATFORM_PACKAGE,
} from "../../../scripts/lib/localAiRuntime/runtimeRoots.mjs";
import {
  decideRebuild,
  isDirectExecution,
} from "../../../scripts/should-rebuild-local-ai-runtime.mjs";
import { LOCAL_AI_RUNTIME_RELEASE } from "@/config/localAiRuntimeRelease";

const YARN_V1_FIXTURE = `# yarn lockfile v1

electron@43.4.1:
  version "43.4.1"
  resolved "https://example.test/electron.tgz"

"@xenova/transformers@^2.17.2":
  version "2.17.2"

sharp@^0.32.0, sharp@^0.35.3:
  version "0.35.3"

onnxruntime-node@1.14.0:
  version "1.14.0"
`;

describe("resolveYarnLockVersion", () => {
  it("reads unquoted, quoted, and comma-joined Yarn v1 stanzas", () => {
    expect(resolveYarnLockVersion(YARN_V1_FIXTURE, "electron")).toBe("43.4.1");
    expect(
      resolveYarnLockVersion(YARN_V1_FIXTURE, "@xenova/transformers")
    ).toBe("2.17.2");
    expect(resolveYarnLockVersion(YARN_V1_FIXTURE, "sharp")).toBe("0.35.3");
  });

  it("does not match a package name that is only a prefix of another key", () => {
    const lock = `sharp-linux@1.0.0:\n  version "1.0.0"\n`;
    expect(resolveYarnLockVersion(lock, "sharp")).toBeNull();
  });

  it("resolves runtime packages from the repository yarn.lock", () => {
    const lockText = readFileSync(path.resolve("yarn.lock"), "utf8");
    expect(resolveYarnLockVersion(lockText, "electron")).toBe("43.4.1");
    expect(resolveYarnLockVersion(lockText, "sherpa-onnx-node")).toBe("1.13.4");
    expect(resolveYarnLockVersion(lockText, "onnxruntime-node")).toBe("1.14.0");
  });
});

describe("listFingerprintPackages", () => {
  it("includes electron, embedding roots, sherpa, and every platform package", () => {
    const names = listFingerprintPackages();
    expect(names).toContain("electron");
    for (const root of RUNTIME_ROOTS["embedding-xenova"]) {
      expect(names).toContain(root);
    }
    expect(names).toContain("sherpa-onnx-node");
    for (const pkg of Object.values(SHERPA_PLATFORM_PACKAGE)) {
      expect(names).toContain(pkg);
    }
    expect(names).toEqual([...names].sort());
  });
});

describe("loadReleaseConfig", () => {
  it("loads the committed config and applies overrides", () => {
    const loaded = loadReleaseConfig(process.cwd());
    expect(loaded).toEqual(LOCAL_AI_RUNTIME_RELEASE);
    expect(
      loadReleaseConfig(process.cwd(), { runtimeVersion: "1.2.3" })
        .runtimeVersion
    ).toBe("1.2.3");
  });

  it("rejects a missing or malformed config file", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "runtime-release-config-"));
    try {
      expect(() => loadReleaseConfig(tmp)).toThrow(
        /Missing runtime release config/
      );
      mkdirSync(path.join(tmp, "src/config"), { recursive: true });
      writeFileSync(
        path.join(tmp, "src/config/localAiRuntimeRelease.json"),
        JSON.stringify({
          releaseTag: "x",
          runtimeVersion: "1",
          minAppVersion: "1.0.0",
        })
      );
      expect(() => loadReleaseConfig(tmp)).toThrow(/dotted-triple/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("fingerprint comparison", () => {
  const base = {
    schemaVersion: 1,
    electron: "43.4.1",
    packages: { electron: "43.4.1", sharp: "0.35.3" },
    sourcesSha256: "abc",
    runtimeVersion: "1.0.0",
    minAppVersion: "1.0.0",
    releaseTag: "local-ai-runtime-v1.0.0",
  };

  it("treats key order as irrelevant", () => {
    expect(
      fingerprintEquals(base, {
        releaseTag: base.releaseTag,
        minAppVersion: base.minAppVersion,
        runtimeVersion: base.runtimeVersion,
        sourcesSha256: base.sourcesSha256,
        packages: { sharp: "0.35.3", electron: "43.4.1" },
        electron: "43.4.1",
        schemaVersion: 1,
      })
    ).toBe(true);
  });

  it("describes electron, package, and source-hash changes", () => {
    expect(describeFingerprintDiff(base, null)).toMatch(/no published/);
    expect(
      describeFingerprintDiff(
        {
          ...base,
          electron: "43.5.0",
          packages: { ...base.packages, electron: "43.5.0" },
        },
        base
      )
    ).toContain("electron 43.4.1 -> 43.5.0");
    expect(
      describeFingerprintDiff(
        { ...base, packages: { ...base.packages, sharp: "0.36.0" } },
        base
      )
    ).toContain("sharp 0.35.3 -> 0.36.0");
    expect(
      describeFingerprintDiff({ ...base, sourcesSha256: "def" }, base)
    ).toContain("worker/packaging source hash changed");
  });
});

describe("decideRebuild", () => {
  const current = {
    schemaVersion: 1,
    electron: "43.4.1",
    packages: { electron: "43.4.1" },
    sourcesSha256: "aaa",
    runtimeVersion: "1.0.0",
    minAppVersion: "1.0.0",
    releaseTag: "local-ai-runtime-v1.0.0",
  };

  it("rebuilds on workflow_dispatch even when fingerprints match", () => {
    const decision = decideRebuild(current, current, true);
    expect(decision.rebuild).toBe(true);
    expect(decision.reason).toMatch(/workflow_dispatch/);
  });

  it("rebuilds when no published fingerprint exists", () => {
    expect(decideRebuild(current, null, false).rebuild).toBe(true);
  });

  it("skips the matrix when the published fingerprint matches", () => {
    const decision = decideRebuild(current, { ...current }, false);
    expect(decision.rebuild).toBe(false);
    expect(decision.reason).toMatch(/matches published/);
  });

  it("rebuilds when a fingerprint field changed", () => {
    const decision = decideRebuild(
      { ...current, runtimeVersion: "1.1.0" },
      current,
      false
    );
    expect(decision.rebuild).toBe(true);
    expect(decision.reason).toContain("runtimeVersion 1.0.0 -> 1.1.0");
  });
});

describe("computeRuntimeFingerprint", () => {
  it("produces a fingerprint from the real repository lockfile and sources", () => {
    const fingerprint = computeRuntimeFingerprint(process.cwd());
    expect(fingerprint.schemaVersion).toBe(1);
    expect(fingerprint.electron).toBe("43.4.1");
    expect(fingerprint.runtimeVersion).toBe(
      LOCAL_AI_RUNTIME_RELEASE.runtimeVersion
    );
    expect(fingerprint.releaseTag).toBe(LOCAL_AI_RUNTIME_RELEASE.releaseTag);
    expect(fingerprint.packages["sherpa-onnx-node"]).toBe("1.13.4");
    expect(fingerprint.sourcesSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(FINGERPRINT_SOURCE_PATHS.length).toBeGreaterThan(5);
  });
});

describe("should-rebuild entrypoint detection", () => {
  it("detects direct execution from a filesystem path", () => {
    const scriptPath = path.resolve(
      process.cwd(),
      "scripts/should-rebuild-local-ai-runtime.mjs"
    );
    expect(isDirectExecution(pathToFileURL(scriptPath).href, scriptPath)).toBe(
      true
    );
  });
});

describe("detect-job import graph", () => {
  it("does not import packaging code that requires node_modules", () => {
    // Run #16 failed because should-rebuild imported build-local-ai-runtime.mjs,
    // which loads deterministicZip.mjs → crc-32, and the detect job has no
    // yarn install. Keep the fingerprint chain on Node builtins + runtimeRoots.
    const fingerprint = readFileSync(
      path.resolve("scripts/lib/localAiRuntime/runtimeFingerprint.mjs"),
      "utf8"
    );
    const shouldRebuild = readFileSync(
      path.resolve("scripts/should-rebuild-local-ai-runtime.mjs"),
      "utf8"
    );
    const roots = readFileSync(
      path.resolve("scripts/lib/localAiRuntime/runtimeRoots.mjs"),
      "utf8"
    );
    expect(fingerprint).not.toMatch(/from\s+["'][^"']*build-local-ai-runtime/);
    expect(fingerprint).not.toMatch(/from\s+["'][^"']*deterministicZip/);
    expect(fingerprint).not.toMatch(/from\s+["']crc-32["']/);
    expect(shouldRebuild).not.toMatch(
      /from\s+["'][^"']*build-local-ai-runtime/
    );
    expect(shouldRebuild).not.toMatch(/from\s+["'][^"']*deterministicZip/);
    expect(shouldRebuild).not.toMatch(/from\s+["']crc-32["']/);
    expect(roots).not.toMatch(/from ["'][^./]/);
  });
});
