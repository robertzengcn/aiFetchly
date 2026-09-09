//
// Packaged smoke diagnostic (temporary — root-causing T-13 firstWindow hang).
//
// The Playwright-driven packaged-smoke.mjs shows: the packaged Electron binary
// launches but produces ZERO output for 33s, then firstWindow times out. None
// of the 5 startup canaries fire — not even line 6 of background.ts. This rules
// out an import-time crash; the main script never executes at all.
//
// This script isolates the cause by bypassing Playwright's CDP launch entirely:
//   1. Verify resources/app/package.json `main` resolves to a real file.
//   2. Verify resources/app/.vite/build/background.js exists and contains the
//      startup canary (proves the build output, not just the source, has it).
//   3. Spawn the packaged binary DIRECTLY via child_process (no Playwright, no
//      --remote-debugging-port, no CDP pipe) with --enable-logging and dump
//      every byte of stdout/stderr for 12s. If the canary fires here, the
//      problem is Playwright's launch; if it doesn't, the problem is the
//      packaged Electron app not loading its main entry at all.
//
// Usage: node scripts/packaged-smoke-diagnose.mjs
// Exit 0 always (diagnostic only — the T-13 gate is packaged-smoke.mjs).
//

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function resolvePackagedExecutable() {
  const outDir = path.join(projectRoot, "out");
  if (!fs.existsSync(outDir)) return null;
  const candidates = [];
  const isExec = (full) => {
    try {
      return fs.statSync(full).isFile() && fs.accessSync(full, fs.constants.X_OK) === undefined;
    } catch {
      return false;
    }
  };
  for (const entry of fs.readdirSync(outDir)) {
    const dir = path.join(outDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (isExec(full)) candidates.push(full);
    }
    const unpacked = path.join(dir, "linux-unpacked");
    if (fs.existsSync(unpacked)) {
      for (const f of fs.readdirSync(unpacked)) {
        const full = path.join(unpacked, f);
        if (isExec(full)) candidates.push(full);
      }
    }
  }
  return (
    candidates.find(
      (c) => !/helper|crashpad|vulkan|swiftshader|chrome|nacl|sandbox/i.test(path.basename(c))
    ) ??
    candidates[0] ??
    null
  );
}

function main() {
  const exe = resolvePackagedExecutable();
  if (!exe) {
    console.log("[diagnose] SKIP: no packaged executable found under out/.");
    process.exit(0);
  }
  const exeDir = path.dirname(exe);
  console.log(`[diagnose] executable: ${exe}`);
  console.log(`[diagnose] exeDir: ${exeDir}`);

  // --- 1. package.json main field ---
  // The unpacked (FORGE_DISABLE_ASAR=1) layout puts the app at resources/app/.
  // The asar layout puts it inside resources/app.asar (we'd need @electron/asar
  // to read it). CI uses unpacked, so check resources/app/package.json first.
  const appDirUnpacked = path.join(exeDir, "resources", "app");
  const pkgJsonPath = path.join(appDirUnpacked, "package.json");
  let mainField = null;
  let appRoot = null;
  if (fs.existsSync(pkgJsonPath)) {
    appRoot = appDirUnpacked;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      mainField = pkg.main;
      console.log(`[diagnose] package.json main = ${JSON.stringify(mainField)}`);
    } catch (err) {
      console.log(`[diagnose] package.json exists but UNREADABLE: ${err.message}`);
    }
  } else {
    console.log(`[diagnose] resources/app/package.json NOT FOUND at ${pkgJsonPath}`);
    console.log(`[diagnose] contents of resources/:`);
    const resDir = path.join(exeDir, "resources");
    if (fs.existsSync(resDir)) {
      for (const f of fs.readdirSync(resDir)) console.log(`[diagnose]   resources/${f}`);
    } else {
      console.log(`[diagnose]   resources/ dir does not exist`);
    }
  }

  // --- 2. background.js exists + canary present? ---
  if (mainField) {
    const bgPath = path.resolve(appRoot, mainField);
    if (fs.existsSync(bgPath)) {
      const stat = fs.statSync(bgPath);
      const content = fs.readFileSync(bgPath, "utf8");
      const canaryCount = (content.match(/canary/g) || []).length;
      console.log(
        `[diagnose] background.js EXISTS (${stat.size} bytes), canary occurrences: ${canaryCount}`
      );
      if (canaryCount === 0) {
        console.log(`[diagnose] *** background.js has NO canary — build output is stale/missing!`);
      } else {
        // Show the first canary line context.
        const idx = content.indexOf("[canary]");
        if (idx >= 0) {
          console.log(
            `[diagnose] first canary context: ...${content.slice(Math.max(0, idx - 40), idx + 80)}...`
          );
        }
      }
    } else {
      console.log(`[diagnose] *** background.js MISSING at ${bgPath} (package.json main points nowhere!)`);
    }
  }

  // --- 3. Direct spawn (no Playwright/CDP) ---
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-diagnose-"));
  console.log(`[diagnose] spawning binary directly (no Playwright) for 12s...`);
  const child = spawn(
    exe,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--enable-logging=stderr",
      "--v=1",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_USER_DATA_PATH: userData },
    }
  );
  let sawCanary = false;
  const onOut = (tag) => (chunk) => {
    const text = chunk.toString();
    if (text.includes("[canary]")) sawCanary = true;
    process.stdout.write(`[diagnose][${tag}] ${text}`);
  };
  child.stdout.on("data", onOut("app:stdout"));
  child.stderr.on("data", onOut("app:stderr"));
  child.on("exit", (code, sig) => {
    console.log(`[diagnose] child exited code=${code} sig=${sig}`);
  });
  const killer = setTimeout(() => {
    console.log(`[diagnose] 12s elapsed; killing direct-spawn child. sawCanary=${sawCanary}`);
    child.kill("SIGKILL");
  }, 12_000);
  child.on("exit", () => clearTimeout(killer));

  child.on("exit", () => {
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    console.log(
      sawCanary
        ? `[diagnose] CANARY FIRED in direct spawn — the packaged main script DOES run; Playwright launch is the culprit.`
        : `[diagnose] NO CANARY in direct spawn — the packaged Electron app does not execute background.js at all (packaging/load failure).`
    );
    // Exit 0 always — diagnostic only.
    process.exit(0);
  });
}

main();
