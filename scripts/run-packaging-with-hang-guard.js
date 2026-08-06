#!/usr/bin/env node
"use strict";

/**
 * Wraps `electron-forge package` to guard against a CI-only hang: on GitHub
 * Actions runners, the electron-forge CLI process has been observed to never
 * exit after packaging fully completes (every lifecycle step, including the
 * final "postPackage" hook, reports success). Because the step's stdout is
 * connected straight through to the process, GitHub Actions keeps the step
 * alive waiting for that stream to close, until the step's `timeout-minutes`
 * kills it with the opaque "Error: The operation was canceled." message.
 *
 * The root cause lives upstream (electron-forge/electron-packager/
 * @electron/rebuild spawn native-module build tooling that can leave a
 * grandchild process holding an inherited stdio handle open), so instead of
 * chasing that dependency internals, this wrapper detects true completion
 * from the CLI's own log output and force-kills the whole process tree
 * rather than waiting indefinitely for a natural exit that may never come.
 *
 * Usage: node scripts/run-packaging-with-hang-guard.js [...extra forge args]
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

// electron-forge always prints this line as the last lifecycle step of
// `package`, whether or not a postPackage hook is configured.
const COMPLETION_MARKER = /Running\s+postPackage\s+hook/i;
const GRACE_PERIOD_MS = Number(process.env.PACKAGE_GUARD_GRACE_MS ?? 8000);
const HARD_TIMEOUT_MS = Number(
  process.env.PACKAGE_GUARD_HARD_TIMEOUT_MS ?? 30 * 60 * 1000
);

function resolveElectronForgeBin() {
  return path.join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-forge.cmd" : "electron-forge"
  );
}

function main() {
  const forgeBin = resolveElectronForgeBin();
  const args = ["package", ...process.argv.slice(2)];

  console.log(`[package-guard] spawning: ${forgeBin} ${args.join(" ")}`);

  const child = spawn(forgeBin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    // A detached child becomes its own process group leader on POSIX, so
    // signalling -child.pid reaches every descendant it spawned (node-gyp,
    // python, make, etc.) instead of only the direct child.
    detached: process.platform !== "win32",
    env: process.env,
  });

  let sawCompletionMarker = false;
  let graceTimer = null;
  let hardTimer = null;
  let settled = false;

  function forwardChunk(outStream, chunk) {
    outStream.write(chunk);
    if (sawCompletionMarker) {
      return;
    }
    if (COMPLETION_MARKER.test(chunk.toString("utf-8"))) {
      sawCompletionMarker = true;
      console.log(
        `\n[package-guard] detected postPackage hook completion; will force-finish in ${GRACE_PERIOD_MS}ms if the process has not exited naturally by then.`
      );
      graceTimer = setTimeout(
        () => finish(0, "grace-period-elapsed-after-completion-marker"),
        GRACE_PERIOD_MS
      );
    }
  }

  child.stdout.on("data", (chunk) => forwardChunk(process.stdout, chunk));
  child.stderr.on("data", (chunk) => forwardChunk(process.stderr, chunk));

  function killProcessTree() {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      if (process.platform === "win32") {
        child.kill();
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch (err) {
      console.warn(
        `[package-guard] failed to signal process tree: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  function finish(exitCode, reason) {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(graceTimer);
    clearTimeout(hardTimer);
    console.log(
      `\n[package-guard] finishing (reason: ${reason}, exitCode: ${exitCode})`
    );
    killProcessTree();
    setTimeout(() => process.exit(exitCode), 500);
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      finish(1, `child exited via signal ${signal}`);
      return;
    }
    finish(code ?? 1, "child exited naturally");
  });

  child.on("error", (err) => {
    console.error(
      `[package-guard] failed to spawn electron-forge: ${err.message}`
    );
    finish(1, "spawn error");
  });

  hardTimer = setTimeout(() => {
    if (!sawCompletionMarker) {
      console.error(
        `[package-guard] electron-forge package did not reach the postPackage hook within ${
          HARD_TIMEOUT_MS / 60000
        } minutes; treating this as a genuine hang and failing.`
      );
      finish(1, "hard-timeout-before-completion-marker");
    } else {
      finish(0, "hard-timeout-after-completion-marker");
    }
  }, HARD_TIMEOUT_MS);
}

main();
