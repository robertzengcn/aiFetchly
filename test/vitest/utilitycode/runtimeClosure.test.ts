import { describe, expect, test, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  matchesTarget,
  resolvePackageDir,
  resolveClosure,
  copyClosure,
} from "../../../scripts/lib/localAiRuntime/runtimeClosure.mjs";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-closure-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writePkg(
  name: string,
  manifest: Record<string, unknown>,
  extraFiles: Record<string, string> = {}
) {
  const dir = path.join(root, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  for (const [rel, content] of Object.entries(extraFiles)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return dir;
}

describe("matchesTarget", () => {
  test("win32-x64 matches windows/x64 variants", () => {
    expect(matchesTarget("sherpa-onnx-win-x64", "win32", "x64")).toBe(true);
    expect(matchesTarget("sqlite-vec-windows-x64", "win32", "x64")).toBe(true);
    expect(matchesTarget("onnxruntime-win32-x64", "win32", "x64")).toBe(true);
  });
  test("foreign targets do not match", () => {
    expect(matchesTarget("sherpa-onnx-darwin-arm64", "win32", "x64")).toBe(
      false
    );
    expect(matchesTarget("sherpa-onnx-linux-x64", "darwin", "arm64")).toBe(
      false
    );
  });
  test("regression: 'darwin' must not match a 'win' token (substring trap)", () => {
    // "darwin" contains the substring "win"; naive includes() matching would
    // wrongly pull sherpa-onnx-darwin-x64 into a win32-x64 closure.
    expect(matchesTarget("sherpa-onnx-darwin-x64", "win32", "x64")).toBe(false);
    expect(matchesTarget("sherpa-onnx-win-x64", "darwin", "x64")).toBe(false);
  });
  test("darwin-arm64 matches its variant", () => {
    expect(matchesTarget("sherpa-onnx-darwin-arm64", "darwin", "arm64")).toBe(
      true
    );
    expect(matchesTarget("sherpa-onnx-darwin-x64", "darwin", "arm64")).toBe(
      false
    );
  });
});

describe("resolveClosure", () => {
  test("follows dependencies + only the matching optional variant", () => {
    writePkg("sherpa-onnx-node", {
      name: "sherpa-onnx-node",
      version: "1.13.4",
      dependencies: { "node-addon-api": "1.0" },
      optionalDependencies: {
        "sherpa-onnx-win-x64": "1.13.4",
        "sherpa-onnx-darwin-arm64": "1.13.4",
        "sherpa-onnx-linux-x64": "1.13.4",
      },
    });
    writePkg("sherpa-onnx-win-x64", {
      name: "sherpa-onnx-win-x64",
      version: "1.13.4",
    });
    writePkg("sherpa-onnx-darwin-arm64", {
      name: "sherpa-onnx-darwin-arm64",
      version: "1.13.4",
    });
    writePkg("sherpa-onnx-linux-x64", {
      name: "sherpa-onnx-linux-x64",
      version: "1.13.4",
    });
    writePkg("node-addon-api", { name: "node-addon-api", version: "1.0" });

    const closure = resolveClosure(root, ["sherpa-onnx-node"], {
      platform: "win32",
      arch: "x64",
    });
    const names = [...closure.keys()].sort();
    expect(names).toEqual([
      "node-addon-api",
      "sherpa-onnx-node",
      "sherpa-onnx-win-x64",
    ]);
    expect(closure.get("sherpa-onnx-node")?.version).toBe("1.13.4");
    // Foreign variants excluded.
    expect(closure.has("sherpa-onnx-darwin-arm64")).toBe(false);
    expect(closure.has("sherpa-onnx-linux-x64")).toBe(false);
  });

  test("resolvePackageDir returns null for missing packages", () => {
    expect(resolvePackageDir(root, "absent-pkg")).toBeNull();
  });
});

describe("copyClosure", () => {
  test("copies the closure into staging/node_modules, excluding noise", () => {
    writePkg(
      "sherpa-onnx-node",
      { name: "sherpa-onnx-node", version: "1.13.4" },
      {
        "README.md": "noise",
        "index.js": "module.exports={};",
        "test/harness.js": "tests",
        "src/types.ts": "types",
        LICENSE: "keep me",
      }
    );
    const closure = resolveClosure(root, ["sherpa-onnx-node"], {
      platform: "win32",
      arch: "x64",
    });
    const staging = path.join(root, "staging");
    const { copied, totalBytes } = copyClosure(closure, staging);
    expect(copied).toContain("sherpa-onnx-node");
    expect(totalBytes).toBeGreaterThan(0);

    const dest = path.join(staging, "node_modules", "sherpa-onnx-node");
    expect(fs.existsSync(path.join(dest, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "LICENSE"))).toBe(true);
    // Excluded.
    expect(fs.existsSync(path.join(dest, "README.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "test", "harness.js"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "src", "types.ts"))).toBe(false);
  });
});
