//
// Builds the Playwright Electron E2E artifacts (design §6.7).
//
//   .vite/e2e/build/
//     e2e-main.js   <- E2E bootstrap entry, launched via _electron.launch()
//     preload.js    <- production preload (same source, no test bridge)
//     vec0.so|dll|dy  <- sqlite-vec native extension (copied by platformCopyPlugin)
//     icon.png|ico|icns <- platform icon (copied by platformCopyPlugin)
//
// Output order matters: the main build runs first (its platformCopyPlugin
// populates the dir + native assets), then the preload build is merged into the
// same dir with emptyOutDir:false so it never deletes e2e-main.js.
//
// Usage: yarn build:e2e

import { build } from "vite";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

// This script lives in scripts/, so the project root is one level up.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const e2eOutDir = path.resolve(projectRoot, ".vite/e2e/build");

function step(name) {
  console.log(`\n[e2e-build] ${name}`);
}

async function main() {
  step("Cleaning .vite/e2e");
  fs.rmSync(path.resolve(projectRoot, ".vite/e2e"), {
    recursive: true,
    force: true,
  });

  step("Building E2E main bundle (e2e-main.js)");
  await build({
    configFile: path.resolve(projectRoot, "vite.e2e.main.config.mjs"),
    mode: "development",
  });

  step("Building production preload into .vite/e2e/build (preload.js)");
  await build({
    configFile: path.resolve(projectRoot, "vite.e2e.preload.config.mjs"),
    mode: "development",
  });

  step("Verifying required E2E artifacts");
  const required = ["e2e-main.js", "preload.js"];
  const missing = required.filter((f) => {
    const p = path.join(e2eOutDir, f);
    return !fs.existsSync(p) || fs.statSync(p).size === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `E2E build incomplete — missing or empty outputs: ${missing.join(", ")}`
    );
  }

  // Best-effort runtime-require scan. The E2E bundle is NOT packaged (it runs
  // against the project's node_modules), so unlike the packaging pipeline we do
  // not fail the build — we only warn about packages that look like they should
  // have been kept external. This mirrors forge.config.js'
  // verifyGeneratedRuntimeRequires at a lighter weight (design §6.7.6).
  const requireWarnings = scanRuntimeRequires(e2eOutDir);
  if (requireWarnings.length > 0) {
    console.warn(
      "[e2e-build] runtime require() of non-builtin packages (informational; " +
        "ensure they resolve in node_modules at runtime):"
    );
    for (const w of requireWarnings) {
      console.warn(`  ${w}`);
    }
  }

  step("E2E artifacts ready");
  console.log(`  ${e2eOutDir}`);
  for (const f of fs.readdirSync(e2eOutDir)) {
    const full = path.join(e2eOutDir, f);
    if (fs.statSync(full).isFile()) {
      console.log(`    ${f}`);
    }
  }
}

/**
 * Collect `require("<pkg>")` calls from every generated bundle and return the
 * subset that are not Node builtins, not electron, not @/-aliased, and not
 * relative. Returned as `bundle: pkg` strings.
 */
function scanRuntimeRequires(bundleDir) {
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
    "electron",
    "electron/main",
    "electron/common",
  ]);
  const requirePattern = /(?<![`\\])\brequire\(\s*["']([^"']+)["']\s*\)/g;
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".js")) {
        const src = fs.readFileSync(full, "utf8");
        let m;
        while ((m = requirePattern.exec(src)) !== null) {
          const id = m[1];
          if (builtins.has(id)) continue;
          if (id.startsWith(".") || id.startsWith("/") || id.startsWith("@/")) {
            continue;
          }
          out.push(`${entry}: ${id}`);
        }
      }
    }
  }
  walk(bundleDir);
  return Array.from(new Set(out)).slice(0, 50);
}

main().catch((err) => {
  console.error("[e2e-build] FAILED:", err);
  process.exit(1);
});
