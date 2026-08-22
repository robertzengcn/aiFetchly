#!/usr/bin/env node
"use strict";

/**
 * Wraps `electron-forge package` to guard against CI packaging hangs.
 *
 * Two distinct failure modes have been seen on GitHub Actions runners:
 *
 *   1. The CLI process never exits AFTER packaging fully completes (every
 *      lifecycle step, including the final "postPackage" hook, reports
 *      success). GitHub keeps the step alive waiting for stdout to close
 *      until `timeout-minutes` kills it with the opaque "Error: The
 *      operation was canceled." message.
 *
 *   2. Packaging stalls DURING "Copying files" / "Preparing native
 *      dependencies" / "Finalizing package" and never reaches postPackage
 *      (disk exhaustion on the 14 GB runner, or a stalled native rebuild).
 *
 * This wrapper handles both: it spawns electron-forge itself, forwards its
 * output, and:
 *   - once it sees the postPackage hook line, force-finishes shortly after
 *     (mode 1), and
 *   - if the child produces no output for a while, or never reaches
 *     postPackage within the hard timeout, it dumps disk/mem/process
 *     diagnostics and fails fast with a clear reason (mode 2) instead of
 *     letting the step be silently canceled minutes later.
 *
 * Usage: node scripts/run-packaging-with-hang-guard.js [...extra forge args]
 */

const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

// electron-forge always prints this line as the last lifecycle step of
// `package`, whether or not a postPackage hook is configured.
const COMPLETION_MARKER = /Running\s+postPackage\s+hook/i;
const GRACE_PERIOD_MS = Number(process.env.PACKAGE_GUARD_GRACE_MS ?? 8000);
// If the child never reaches the postPackage marker within this hard timeout,
// treat it as a genuine hang: dump diagnostics and fail with a clear reason.
//
// IMPORTANT: this must stay well BELOW the `timeout-minutes` on the CI step
// (currently 30). When it is, the guard — not GitHub — terminates the run,
// so the failure carries a precise reason + disk/mem diagnostics instead of
// GitHub's opaque "Error: The operation was canceled." (GitHub kills the
// whole step tree, orphaning the electron-forge child and producing that
// uninformative message). 20 min left only ~33% headroom; 15 min guarantees
// the guard fires first and still leaves ample time for a legitimate (if
// slow) package to reach the postPackage marker.
const HARD_TIMEOUT_MS = Number(
  process.env.PACKAGE_GUARD_HARD_TIMEOUT_MS ?? 15 * 60 * 1000
);
// If the child emits no output for this long, it is probably stuck; dump
// diagnostics so the CI log shows where (disk full, rebuild wedged, etc.).
const STALL_THRESHOLD_MS = Number(
  process.env.PACKAGE_GUARD_STALL_MS ?? 4 * 60 * 1000
);
const STALL_CHECK_INTERVAL_MS = 30 * 1000;

function resolveElectronForgeBin() {
  return path.join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-forge.cmd" : "electron-forge"
  );
}

function runDiagnosticCommand(label, command, args) {
  try {
    const result = spawnSync(command, args, { encoding: "utf-8" });
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    console.log(`\n[package-guard][diag] ${label}:\n${out || "(no output)"}`);
  } catch (err) {
    console.log(
      `[package-guard][diag] ${label} failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

function dumpDiagnostics(reason) {
  console.log(`\n[package-guard][diag] === diagnostics (${reason}) ===`);
  if (process.platform === "win32") {
    runDiagnosticCommand("processes", "tasklist", []);
    return;
  }
  runDiagnosticCommand("disk usage", "df", ["-h"]);
  runDiagnosticCommand("memory", "free", ["-h"]);
  runDiagnosticCommand("tmp electron-packager", "du", [
    "-sh",
    "/tmp/electron-packager",
  ]);
  runDiagnosticCommand("processes", "ps", [
    "-eo",
    "pid,ppid,pcpu,pmem,stat,etime,command",
  ]);
}

/**
 * Register SIGTERM/SIGINT handlers so that an externally-cancelled packaging
 * run (GitHub SIGTERMs the step's process tree on job cancel / runner OOM /
 * step timeout) is reported with a precise reason + diagnostics instead of
 * dying as an opaque exit 143.
 *
 * On signal: dump disk/mem/process diagnostics (so the CI log shows whether
 * it was disk full, OOM, or a wedged subprocess), then finish(1, reason).
 * `finish` is expected to kill the child tree and force-exit the guard.
 *
 * Exported (and accepts injectable callbacks) so tests can verify the contract
 * without spawning a real electron-forge child.
 *
 * Returns a teardown function that removes the listeners.
 */
function installSignalHandlers({ finish, dumpDiagnostics: dump }) {
  const onTerm = () => {
    console.error(
      "\n[package-guard] received SIGTERM (GitHub canceled the step / runner lost heartbeat); dumping diagnostics and finishing."
    );
    dump("received SIGTERM");
    finish(1, "received SIGTERM");
  };
  const onInt = () => {
    console.error(
      "\n[package-guard] received SIGINT; dumping diagnostics and finishing."
    );
    dump("received SIGINT");
    finish(1, "received SIGINT");
  };
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  return function teardown() {
    process.removeListener("SIGTERM", onTerm);
    process.removeListener("SIGINT", onInt);
  };
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
  let lastOutputAt = Date.now();
  let stallReported = false;
  let graceTimer = null;
  let hardTimer = null;
  let stallTimer = null;
  let settled = false;
  // Holds the teardown returned by installSignalHandlers(), set once finish()
  // exists. Cleared on finish() so the signal listeners are removed before the
  // guard force-exits (avoids a re-entrant signal re-triggering finish()).
  let removeSignalHandlers = null;

  function forwardChunk(outStream, chunk) {
    outStream.write(chunk);
    lastOutputAt = Date.now();
    stallReported = false;
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
    const pid = child.pid;
    if (pid === undefined || pid === null) {
      return;
    }
    try {
      if (process.platform === "win32") {
        child.kill();
      } else {
        // The child is detached (its own process group leader), so signalling
        // the negative pid reaches every descendant it spawned (node-gyp,
        // python, make, ...). Some native-rebuild descendants ignore SIGTERM
        // (stuck fs.realpath walks, wedged subprocesses), so escalate: send
        // SIGTERM to the whole group, then SIGKILL shortly after if the group
        // is still alive. Without this escalation a wedged descendant kept the
        // detached child process alive, which in turn kept the guard's stdio
        // pipes open and prevented `process.exit` from terminating the guard —
        // the step then ran until GitHub's own step timeout canceled it with
        // "The operation was canceled" instead of the guard's clear reason.
        try {
          process.kill(-pid, "SIGTERM");
        } catch (termErr) {
          console.warn(
            `[package-guard] SIGTERM failed, escalating to SIGKILL: ${
              termErr instanceof Error ? termErr.message : String(termErr)
            }`
          );
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* group already gone */
          }
          return;
        }
        setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* group already gone */
          }
        }, 3000);
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
    clearInterval(stallTimer);
    // Remove our own signal listeners before force-exiting so a re-entrant
    // SIGTERM during the 500ms exit window can't call finish() again.
    if (removeSignalHandlers) {
      removeSignalHandlers();
      removeSignalHandlers = null;
    }
    console.log(
      `\n[package-guard] finishing (reason: ${reason}, exitCode: ${exitCode})`
    );
    killProcessTree();
    // Flush any buffered diagnostics, then force-exit. Unref the timer so it
    // never keeps the event loop alive on its own; the process must exit.
    const exitTimer = setTimeout(() => process.exit(exitCode), 500);
    exitTimer.unref();
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

  // Install SIGTERM/SIGINT handlers LAST, once finish() exists. GitHub cancels
  // a stalled/oomed job by SIGTERMing the step's process tree; without these
  // handlers Node's default SIGTERM behavior killed the guard silently (exit
  // 143) with NO reason and NO diagnostics — exactly the opaque failure the
  // guard exists to prevent. Now any cancellation dumps disk/mem/process
  // diagnostics and force-finishes with a precise reason (exit 1, not 143).
  removeSignalHandlers = installSignalHandlers({
    finish,
    dumpDiagnostics,
  });

  stallTimer = setInterval(() => {
    if (settled || sawCompletionMarker) {
      return;
    }
    const idleMs = Date.now() - lastOutputAt;
    if (idleMs >= STALL_THRESHOLD_MS && !stallReported) {
      stallReported = true;
      console.warn(
        `\n[package-guard] no output for ${Math.round(
          idleMs / 1000
        )}s; the packaging step may be stuck. Dumping diagnostics.`
      );
      dumpDiagnostics("stall detected");
    }
  }, STALL_CHECK_INTERVAL_MS);

  hardTimer = setTimeout(() => {
    if (!sawCompletionMarker) {
      console.error(
        `[package-guard] electron-forge package did not reach the postPackage hook within ${
          HARD_TIMEOUT_MS / 60000
        } minutes; treating this as a genuine hang and failing.`
      );
      dumpDiagnostics("hard timeout before completion marker");
      finish(1, "hard-timeout-before-completion-marker");
    } else {
      finish(0, "hard-timeout-after-completion-marker");
    }
  }, HARD_TIMEOUT_MS);
}

// Exported for tests. `main()` runs only when this file is the entry point
// (require.main === module), not when it is required by a test.
module.exports = { installSignalHandlers };

if (require.main === module) {
  main();
}
