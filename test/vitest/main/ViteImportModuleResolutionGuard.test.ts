import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const tsconfigPath = path.join(projectRoot, "tsconfig.json");
const testRoot = path.join(projectRoot, "test");

/**
 * Strip // and /* *\/ comments so documented examples like
 * `import { build } from "vite"` in comments do not false-positive.
 */
function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Regression for Windows electron-forge packaging:
 *   TS2307: Cannot find module 'vite' ... under current 'moduleResolution'
 *
 * Root tsconfig uses moduleResolution "node". Vite 8 only exposes types via
 * package "exports", which require node16/nodenext/bundler. A static
 * `import ... from "vite"` in any tsconfig-included test file fails
 * `tsc --noEmit` and aborts packaging via vite-plugin-checker.
 */
describe("vite import vs tsconfig moduleResolution guard", () => {
  it("keeps root tsconfig moduleResolution at node", () => {
    // tsconfig.json is JSONC (comments + trailing commas); avoid JSON.parse.
    const raw = fs.readFileSync(tsconfigPath, "utf-8");
    const moduleResolution = raw.match(
      /"moduleResolution"\s*:\s*"([^"]+)"/
    )?.[1];
    const includesTestTree =
      /"include"\s*:\s*\[[\s\S]*?"test\/\*\*\/\*\.ts"/.test(raw);

    expect(moduleResolution).toBe("node");
    expect(includesTestTree).toBe(true);
  });

  it("forbids static ESM imports of vite under test/", () => {
    const offenders: string[] = [];
    const staticViteImport =
      /(?:^|\n)\s*(?:import|export)\s[\s\S]*?\bfrom\s*['"]vite['"]/;

    for (const filePath of collectTsFiles(testRoot)) {
      const source = stripTsComments(fs.readFileSync(filePath, "utf-8"));
      if (staticViteImport.test(source)) {
        offenders.push(path.relative(projectRoot, filePath));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("loads packaging Vite bundle tests without static vite ESM imports", () => {
    const packagingTests = [
      "CloneDeepViteBundle.test.ts",
      "TslibViteBundle.test.ts",
      "PdfLibViteBundle.test.ts",
      path.join("helpers", "viteCjsBundle.ts"),
    ];

    for (const relativePath of packagingTests) {
      const filePath = path.join(testRoot, "vitest", "main", relativePath);
      expect(fs.existsSync(filePath)).toBe(true);

      const code = stripTsComments(fs.readFileSync(filePath, "utf-8"));
      expect(code).not.toMatch(
        /(?:^|\n)\s*import\s[\s\S]*?\bfrom\s*['"]vite['"]/
      );

      // Either load vite via createRequire directly, or via the shared helper
      // that itself uses createRequire (PdfLib/Tslib tests).
      if (relativePath.endsWith("viteCjsBundle.ts")) {
        expect(code).toMatch(/createRequire\s*\(/);
        expect(code).toMatch(/require\s*\(\s*["']vite["']\s*\)/);
      } else if (relativePath === "CloneDeepViteBundle.test.ts") {
        expect(code).toMatch(/createRequire\s*\(/);
        expect(code).toMatch(/require\s*\(\s*["']vite["']\s*\)/);
      } else {
        expect(code).toMatch(/buildAndRunViteCjsBundle/);
      }
    }
  });
});
