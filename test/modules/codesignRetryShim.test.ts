import { expect } from "chai";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SHIM_PATH = path.resolve(__dirname, "../../scripts/codesign-retry-shim/codesign");
const TRANSIENT_MARKER = "The timestamp service is not available";

interface ShimRunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runShim(args: string[], env: Record<string, string>): ShimRunResult {
  const result = spawnSync("bash", [SHIM_PATH, ...args], {
    cwd: mkTempDir(),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function mkTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "codesign-shim-test-"));
}

/**
 * Builds a fake `codesign` binary that fails the first `failTimes` invocations
 * with `stderrMessage`, then succeeds. Returns the env entry pointing at it and
 * a counter file path for asserting the attempt count.
 */
function makeFakeCodesign(
  dir: string,
  failTimes: number,
  stderrMessage: string
): { fakeBinEnv: Record<string, string>; counterFile: string } {
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const fakeBin = path.join(binDir, "fake-codesign");
  const counterFile = path.join(dir, "attempts");
  writeFileSync(counterFile, "0");
  writeFileSync(
    fakeBin,
    [
      "#!/usr/bin/env bash",
      'n=$(cat "$FAKE_COUNTER_FILE" 2>/dev/null || echo 0)',
      "n=$((n + 1))",
      'echo "$n" > "$FAKE_COUNTER_FILE"',
      'if [ "$n" -le "$FAKE_FAIL_TIMES" ]; then',
      `  echo '${stderrMessage.replace(/'/g, "'\\''")}' >&2`,
      "  exit 1",
      "fi",
      'echo "signed on attempt $n"',
      "exit 0",
      "",
    ].join("\n")
  );
  chmodSync(fakeBin, 0o755);
  return {
    fakeBinEnv: {
      CODESIGN_SHIM_REAL_BIN: fakeBin,
      FAKE_COUNTER_FILE: counterFile,
      FAKE_FAIL_TIMES: String(failTimes),
    },
    counterFile,
  };
}

function attemptCount(counterFile: string): number {
  return Number.parseInt(spawnSync("cat", [counterFile], { encoding: "utf8" }).stdout ?? "0", 10) || 0;
}

function baseShimEnv(): Record<string, string> {
  // Zero backoff keeps the suite fast; the real job uses 30s.
  return { CODESIGN_SHIM_BACKOFF_SECONDS: "0" };
}

describe("codesign retry shim", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkTempDir();
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("is executable and committed with the exec bit", () => {
    const mode = spawnSync("stat", ["-f", "%Lp", SHIM_PATH], { encoding: "utf8" });
    // stat -f is BSD (macOS); fall back to a test -x check on Linux CI.
    if (mode.status === 0) {
      expect(mode.stdout?.trim()).to.match(/^[0-7]*[1357]$/);
    } else {
      expect(spawnSync("test", ["-x", SHIM_PATH]).status).to.equal(0);
    }
  });

  it("retries and succeeds when the timestamp service recovers", () => {
    const { fakeBinEnv, counterFile } = makeFakeCodesign(dir, 2, `f.icc: ${TRANSIENT_MARKER}`);
    const result = runShim(["--timestamp", "--options", "runtime", "out/App.app"], {
      ...baseShimEnv(),
      ...fakeBinEnv,
      CODESIGN_SHIM_RETRIES: "5",
    });

    expect(result.status).to.equal(0);
    expect(attemptCount(counterFile)).to.equal(3);
    expect(result.stderr).to.contain("transient timestamp-service error");
    // The shim forwards the real binary's stdout to its stderr.
    expect(result.stderr).to.contain("signed on attempt 3");
  });

  it("passes non-transient failures through immediately with the real exit code", () => {
    const { fakeBinEnv, counterFile } = makeFakeCodesign(dir, 1, "no identity found");
    const result = runShim(["--sign", "out/App.app"], {
      ...baseShimEnv(),
      ...fakeBinEnv,
      CODESIGN_SHIM_RETRIES: "5",
    });

    expect(result.status).to.equal(1);
    expect(attemptCount(counterFile)).to.equal(1, "non-transient errors must not be retried");
    expect(result.stderr).to.contain("no identity found");
    expect(result.stderr).to.not.contain("retrying");
  });

  it("gives up with the real exit code when the transient error persists", () => {
    const { fakeBinEnv, counterFile } = makeFakeCodesign(dir, 99, `locale.pak: ${TRANSIENT_MARKER}`);
    const result = runShim(["--timestamp", "out/App.app"], {
      ...baseShimEnv(),
      ...fakeBinEnv,
      CODESIGN_SHIM_RETRIES: "2",
    });

    expect(result.status).to.equal(1);
    // 1 first try + CODESIGN_SHIM_RETRIES retries, then give up.
    expect(attemptCount(counterFile)).to.equal(3);
    expect(result.stderr).to.contain("giving up after 3 attempts");
    expect(result.stderr).to.contain(TRANSIENT_MARKER);
  });

  it("exits 127 when the real codesign binary is missing", () => {
    const result = runShim(["--version"], {
      ...baseShimEnv(),
      CODESIGN_SHIM_REAL_BIN: path.join(dir, "does-not-exist"),
    });

    expect(result.status).to.equal(127);
    expect(result.stderr).to.contain("not found or not executable");
  });

  it("passes a zero exit code through without touching the log", () => {
    const { fakeBinEnv, counterFile } = makeFakeCodesign(dir, 0, "unused");
    const result = runShim(["--verify", "out/App.app"], {
      ...baseShimEnv(),
      ...fakeBinEnv,
    });

    expect(result.status).to.equal(0);
    expect(attemptCount(counterFile)).to.equal(1);
    expect(result.stderr).to.not.contain("codesign-retry-shim:");
  });
});
